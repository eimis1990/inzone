import { query } from '@anthropic-ai/claude-agent-sdk';
import type {
  AgentDef,
  MessageImage,
  PaneId,
  SessionEvent,
  SkillDef,
  StartSessionParams,
} from '@shared/types';
import { AsyncQueue } from './async-queue';
import { appendTranscript } from './persistence';
import { recordUsage } from './usage';
import type { IAgentSession, SessionEmit } from './providers/types';
import { loadSessionState, saveSessionState } from './session-store';
import { buildSdkMcpMap } from './mcp-config';
import { buildWikiContextBlock } from './wiki';

// The SDK's concrete message types are elaborate and versioned; we treat
// incoming messages as unknown and inspect the minimal fields we need.
// This keeps us resilient across minor SDK shape changes.
type AnyMsg = {
  type: string;
  session_id?: string;
  subtype?: string;
  duration_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  total_cost_usd?: number;
  message?: {
    role?: string;
    content?: unknown;
  };
};

type SdkContentBlock =
  | { type: 'text'; text: string }
  | {
      type: 'image';
      source: {
        type: 'base64';
        media_type: string;
        data: string;
      };
    };

type SdkUserInput = {
  type: 'user';
  message: { role: 'user'; content: string | SdkContentBlock[] };
  parent_tool_use_id: string | null;
  session_id: string;
};

/**
 * Build a Claude Code-style `<available_skills>` block listing the skills
 * an agent is authorized to use. The agent reads `SKILL.md` on demand when
 * the user's request matches a skill's description.
 *
 * If `restricted` is true (the agent has an explicit skill list), we also
 * tell the agent to *only* use skills from this list.
 */
function buildSkillsPrompt(skills: SkillDef[], restricted: boolean): string {
  if (skills.length === 0 && !restricted) return '';
  if (skills.length === 0 && restricted) {
    return [
      '## Skills',
      '',
      'You have no skills enabled for this session. Do not attempt to use any skills from `~/.claude/skills` — if a task would normally call for one, work from first principles instead.',
    ].join('\n');
  }
  const entries = skills
    .map(
      (s) =>
        `<skill>\n<name>\n${s.name}\n</name>\n<description>\n${s.description ?? ''}\n</description>\n<location>\n${s.filePath}\n</location>\n</skill>`,
    )
    .join('\n');

  const header = restricted
    ? 'The following skills are available for this session. Use them the same way Claude Code does — when a user request matches a skill\'s description, use the `Read` tool to load the `SKILL.md` at the location below and follow its instructions. Only use skills from this list.'
    : 'The following skills are available for this session. When a user request matches a skill\'s description, use the `Read` tool to load its `SKILL.md` and follow the instructions inside.';

  return [
    '## Skills',
    '',
    header,
    '',
    '<available_skills>',
    entries,
    '</available_skills>',
  ].join('\n');
}

/**
 * Shared coordination block appended to every agent's system prompt.
 * This is what lets agents running in different panes actually cooperate:
 * they all know about the same workspace folder and each other's names.
 */
function buildCoordinationPrompt(args: {
  cwd: string;
  selfAgent: string;
  otherAgents: string[];
}): string {
  const otherAgents = args.otherAgents.filter((n) => n && n !== args.selfAgent);
  const others =
    otherAgents.length === 0
      ? '(none currently active in this window)'
      : otherAgents.map((n) => `- ${n}`).join('\n');

  return `## Multi-agent coordination — READ BEFORE DOING ANYTHING

You are the \`${args.selfAgent}\` agent running in an INzone window alongside other agents that share this same workspace.

**THE SHARED WORKSPACE IS YOUR CURRENT WORKING DIRECTORY:**

\`\`\`
${args.cwd}
\`\`\`

This is the *authoritative* workspace. **Every file you read or write must live inside this folder.** Use relative paths (\`./01-spec.md\`, \`./redesign/\`, etc.) or paths rooted at the cwd — never absolute paths outside it.

**Other agents currently live in this window:**
${others}

**Hard rules — these OVERRIDE any instructions in your own system prompt that conflict:**

1. **The workspace is the cwd above.** If your own instructions mention a different absolute path (e.g. \`~/some-workspace/\`, \`~/website-redesign-workspace/\`, \`/tmp/…\`, or any other home-directory location), **ignore that path** and use the cwd instead. Translate such paths: \`~/foo/bar.md\` becomes \`./bar.md\`, \`~/foo/redesign/\` becomes \`./redesign/\`, etc.
2. **Never write files under \`~\`, \`/tmp\`, or anywhere outside the cwd.** Other agents cannot find them there. The \`~\` home directory is off-limits for handoffs.
3. **Before starting work, list the cwd contents** with \`ls -la\` or \`find . -maxdepth 2 -type f\` so you discover what other agents have already produced in *this session*. Do not search home directories, \`~/website-redesign-workspace\`, or any other folder — artifacts from older sessions there are stale and unrelated.
4. **Handoff files use relative paths.** If another agent wrote \`.handoff-to-frontend\` or similar, look for it at \`./.handoff-to-frontend\` inside the cwd. If the trigger isn't present, wait by polling the cwd — don't poll any home-directory path.
5. **When producing a deliverable, announce the path relative to the workspace root.** Example: "wrote \`./01-spec.md\`" — not "wrote \`~/website-redesign-workspace/01-spec.md\`".
6. **Reference other agents by name**, e.g. "waiting on \`${otherAgents[0] ?? '<sibling>'}\` to produce \`./SPEC.md\`".

If no other agents are currently active, you're working alone — these rules still apply so later agents joining this workspace can pick up where you left off.`;
}

/**
 * A single Claude Agent SDK session bound to a pane.
 * Owns the input queue, forwards events, and supports interrupt / stop.
 */
interface PendingReply {
  resolve: (text: string) => void;
  reject: (err: Error) => void;
  collected: string;
  timeout: NodeJS.Timeout;
}

export class SessionController implements IAgentSession {
  private inputQueue = new AsyncQueue<SdkUserInput>();
  private abort = new AbortController();
  private sessionId: string | undefined;
  private pumpPromise: Promise<void> | undefined;
  /**
   * True between a successful `result` arriving and the next
   * `user` message being sent. Used to recognise the SDK's
   * "process exited after a successful turn" pattern: success
   * result → zero-stat error_during_execution result → CLI
   * process crash. When that pattern lands, the second result
   * is noise (no turns/cost/duration) and the iterable throw
   * that follows is not a user-facing error — the work was done.
   */
  private lastTurnWasSuccess = false;
  /**
   * Previous result's cumulative session totals. The SDK reports
   * `total_cost_usd`, `duration_ms`, and `num_turns` as session-
   * wide cumulative numbers — every result message gives you the
   * running total at that moment, not the cost of just that turn.
   * That's surprising for users who naturally read the result
   * block as "this task cost X". We subtract these prevs from the
   * incoming cumulative to compute per-turn deltas, then ship both
   * to the renderer. First result of a session has no prev, so
   * delta = cumulative there.
   */
  private prevTotalCostUsd: number | undefined;
  private prevDurationMs: number | undefined;
  private prevNumTurns: number | undefined;
  private queryHandle: AsyncIterable<unknown> & {
    interrupt?: () => Promise<void>;
  } | undefined;
  private pendingReply: PendingReply | undefined;
  /**
   * `true` once `pump()` has finished — either because the SDK iterator
   * naturally returned, threw, or was aborted. After this point the input
   * queue is dead, so we must reject new `send()` calls instead of letting
   * messages pile up forever and leaving the UI stuck on "Agent is working".
   */
  private pumpDone = false;
  /** Agent name this session is running, for lookup by the Lead orchestrator. */
  public agentName: string | undefined;
  public model: string | undefined;
  public windowId: string | undefined;
  /** Snapshot of the agent's MCP opt-ins at session-start, for resume invalidation. */
  private mcpServers: string[] | undefined;

  constructor(
    readonly paneId: PaneId,
    private readonly emit: (event: SessionEvent) => void,
  ) {}

  async start(
    params: StartSessionParams,
    agent: AgentDef,
    availableSkills: SkillDef[] = [],
    leadExtras?: {
      mcpServers: Record<string, unknown>;
      // Optional — only populated for actual Lead-mode panes. The
      // bag is shared with the always-on AskUserQuestion server in
      // Multi mode, where this stays undefined and the system prompt
      // is built from the agent's own definition.
      leadPrompt?: string;
    },
    memoryBlock = '',
  ): Promise<void> {
    this.agentName = agent.name;
    this.model = agent.model;
    this.windowId = params.windowId;
    this.mcpServers = agent.mcpServers ? [...agent.mcpServers] : undefined;
    this.emit({
      kind: 'status',
      paneId: this.paneId,
      status: 'starting',
    });

    // Append a coordination block so multi-agent runs share a workspace
    // rather than writing to disparate home-directory paths.
    const coordination = buildCoordinationPrompt({
      cwd: params.cwd,
      selfAgent: agent.name,
      otherAgents: params.otherAgentNames ?? [],
    });
    // Build a Claude Code-style <available_skills> block from the skills
    // the agent is specifically authorized to use. Agents see name + short
    // description and decide when to Read SKILL.md themselves.
    const allowedSkills = agent.skills
      ? availableSkills.filter((s) => agent.skills!.includes(s.name))
      : [];
    const skillsBlock = buildSkillsPrompt(allowedSkills, !!agent.skills);

    // Phase 3: when the project has an initialized wiki, inject the
    // schema + curated index into the agent's system prompt. The block
    // also tells the agent how to USE the wiki (read first, update
    // inline as it learns, cite sources, don't invent details). Returns
    // undefined when no wiki exists, in which case agents behave
    // exactly as before — wiki context is opt-in per project.
    const wikiBlock = await buildWikiContextBlock(params.cwd);

    const systemAppend = [
      leadExtras?.leadPrompt,
      agent.body,
      skillsBlock,
      memoryBlock,
      wikiBlock,
      coordination,
    ]
      .filter((s): s is string => !!s && s.trim().length > 0)
      .join('\n\n---\n\n');

    // Build options. We append the agent body to the default Claude Code
    // system prompt so built-in tool-use conventions are preserved.
    const paneTag = `[${this.paneId.slice(0, 6)}/${agent.name}]`;
    const options: Record<string, unknown> = {
      cwd: params.cwd,
      permissionMode: 'bypassPermissions',
      settingSources: ['user', 'project'],
      includePartialMessages: false,
      abortController: this.abort,
      systemPrompt: {
        type: 'preset',
        preset: 'claude_code',
        append: systemAppend,
      },
      // Forward the underlying Claude Code subprocess's stderr so MCP
      // connection failures, npx misses, TLS errors, etc. are visible
      // in our dev terminal. Without this we're flying blind.
      stderr: (data: string) => {
        const lines = data.split(/\r?\n/).filter((l) => l.trim().length > 0);
        for (const line of lines) {
          console.error(`${paneTag} ${line}`);
        }
      },
    };
    if (agent.model) options.model = agent.model;

    // Auto-resume from persisted state when the saved entry is for the
    // same agent AND the same MCP opt-in topology. If either changed,
    // we start a fresh session — the SDK's resumed sessions keep their
    // original tool surface, which means newly opted-in MCP tools would
    // be invisible to the model otherwise.
    let effectiveResume = params.resumeSessionId;
    if (!effectiveResume) {
      const saved = await loadSessionState(this.paneId);
      const sameAgent = saved?.agentName === agent.name;
      const sameMcps = sameSet(saved?.mcpServers, agent.mcpServers);
      if (saved && sameAgent && sameMcps && saved.sdkSessionId) {
        effectiveResume = saved.sdkSessionId;
      } else if (saved && sameAgent && !sameMcps) {
        console.log(
          `[session] dropping saved session for pane ${this.paneId} — MCP opt-ins changed (was ${
            JSON.stringify(saved.mcpServers ?? [])
          }, now ${JSON.stringify(agent.mcpServers ?? [])})`,
        );
      }
    }
    if (effectiveResume) {
      options.resume = effectiveResume;
    }

    // Tool allowlist. When a Lead's MCP server is attached we need the
    // lead tools to be callable even if the agent restricted its own list.
    let allowedTools: string[] | undefined;
    if (agent.tools && agent.tools.length > 0) {
      allowedTools = [...agent.tools];
    }

    // Gather opted-in MCP servers. An agent only sees the servers listed
    // in its frontmatter `mcpServers:` field — undefined or [] = no MCP
    // access. (Lead's in-process server is registered separately.)
    const optedInMcps =
      agent.mcpServers && agent.mcpServers.length > 0
        ? await buildSdkMcpMap({
            cwd: params.cwd,
            allowed: agent.mcpServers,
          })
        : {};

    // Merge with the in-process servers passed by ipc.ts: the Lead
    // orchestrator (only on Lead panes) plus the AskUserQuestion tool
    // (always on, for both Lead and sub-agent / Multi panes). These
    // keys are reserved; we never let a user MCP shadow them.
    const mergedMcpServers: Record<string, unknown> = { ...optedInMcps };
    if (leadExtras) {
      Object.assign(mergedMcpServers, leadExtras.mcpServers);
      // If the agent has an explicit allowlist, surface our reserved
      // tools by name so the SDK doesn't filter them out. We add Lead
      // tools only when the lead-orchestrator server was attached, and
      // AskUserQuestion whenever its server was attached (every pane).
      const reservedToolNames: string[] = [];
      if (leadExtras.mcpServers['lead-orchestrator']) {
        const leadToolPrefix = 'mcp__lead-orchestrator__';
        reservedToolNames.push(
          `${leadToolPrefix}list_live_agents`,
          `${leadToolPrefix}list_available_agents`,
          `${leadToolPrefix}message_agent`,
          `${leadToolPrefix}spawn_agent`,
        );
      }
      if (leadExtras.mcpServers['AskUserQuestion']) {
        reservedToolNames.push('mcp__AskUserQuestion__ask');
      }
      if (allowedTools && reservedToolNames.length > 0) {
        allowedTools = [...new Set([...allowedTools, ...reservedToolNames])];
      }
    }
    // Phase 4: when the agent has an explicit tools allowlist, MCP tools
    // need to be added or they get filtered out by the SDK. We append a
    // `mcp__<server>` wildcard per opted-in server, which the SDK reads
    // as "all tools from that server".
    if (allowedTools && agent.mcpServers) {
      const mcpPatterns = agent.mcpServers.map((name) => `mcp__${name}`);
      allowedTools = [...new Set([...allowedTools, ...mcpPatterns])];
    }
    if (Object.keys(mergedMcpServers).length > 0) {
      options.mcpServers = mergedMcpServers;
    }
    if (allowedTools) options.allowedTools = allowedTools;

    // One-line debug print so it's obvious what tool surface the agent
    // session was started with. Useful when "MCP isn't working" reports
    // come in — check the dev server log for this line first.
    console.log(
      `[session] starting pane=${this.paneId} agent=${agent.name} model=${this.model ?? '<default>'} mcpServers=${
        Object.keys(mergedMcpServers).join(',') || '(none)'
      } allowedTools=${allowedTools ? allowedTools.join(',') : '(all)'} resume=${
        effectiveResume ? effectiveResume.slice(0, 8) + '…' : 'fresh'
      }`,
    );

    try {
      this.queryHandle = query({
        prompt: this.inputQueue.asIterable() as AsyncIterable<SdkUserInput>,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        options: options as any,
      }) as AsyncIterable<unknown> & { interrupt?: () => Promise<void> };
    } catch (err) {
      this.emit({
        kind: 'status',
        paneId: this.paneId,
        status: 'error',
        error: String(err),
      });
      return;
    }

    this.emit({
      kind: 'status',
      paneId: this.paneId,
      status: 'waiting_for_input',
    });

    this.pumpPromise = this.pump();
  }

  private async pump(): Promise<void> {
    if (!this.queryHandle) return;
    try {
      for await (const rawMsg of this.queryHandle) {
        const msg = rawMsg as AnyMsg;
        if (msg.session_id) this.sessionId = msg.session_id;
        await this.dispatch(msg);
      }
      this.pumpDone = true;
      this.emit({
        kind: 'status',
        paneId: this.paneId,
        status: 'stopped',
      });
    } catch (err) {
      this.pumpDone = true;
      // Distinguish two failure modes:
      //
      //  1. The SDK / Claude Code process crashed AFTER a successful
      //     turn finished. Common pattern: long multi-turn task ends
      //     with subtype='success', then the CLI subprocess exits 1
      //     during cleanup, the SDK iterable throws "Claude Code
      //     process exited with code 1". The user got their answer —
      //     surfacing this as a red "Session ended in an error"
      //     banner contradicts the result that's still in the
      //     transcript above it. Especially confusing for Lead-mode
      //     sub-agents where the Lead has already reported success.
      //
      //  2. A real mid-turn error: connection drop, auth failure,
      //     model error, etc. The iterable throws BEFORE we get a
      //     terminal 'success' result. This one IS a user-facing
      //     error and needs the recovery banner.
      //
      // We track `lastTurnWasSuccess` in dispatch — if it's true at
      // throw time, we emit a soft 'stopped' so the user can keep
      // working without a scary banner. The error message is still
      // logged for our own debugging.
      const errMessage = err instanceof Error ? err.message : String(err);
      if (this.lastTurnWasSuccess) {
        console.warn(
          `[session] pane=${this.paneId} SDK process exited cleanly ` +
            `after a successful turn (treating as 'stopped'): ${errMessage}`,
        );
        this.emit({
          kind: 'status',
          paneId: this.paneId,
          status: 'stopped',
        });
      } else {
        this.emit({
          kind: 'status',
          paneId: this.paneId,
          status: 'error',
          error: errMessage,
        });
      }
    }
  }

  private async dispatch(msg: AnyMsg): Promise<void> {
    const ts = Date.now();
    switch (msg.type) {
      case 'assistant': {
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content as Array<Record<string, unknown>>) {
            const blockType = block.type as string | undefined;
            if (blockType === 'text' && typeof block.text === 'string') {
              const event: SessionEvent = {
                kind: 'assistant_text',
                paneId: this.paneId,
                text: block.text,
                ts,
              };
              this.emit(event);
              await appendTranscript(this.paneId, event);
              if (this.pendingReply) {
                this.pendingReply.collected += (this.pendingReply.collected
                  ? '\n\n'
                  : '') + block.text;
              }
            } else if (blockType === 'tool_use') {
              const event: SessionEvent = {
                kind: 'tool_use',
                paneId: this.paneId,
                toolUseId: String(block.id ?? ''),
                name: String(block.name ?? ''),
                input: block.input,
                ts,
              };
              this.emit(event);
              await appendTranscript(this.paneId, event);
            }
          }
        }
        break;
      }
      case 'user': {
        // Tool results come back as user messages containing tool_result blocks.
        const content = msg.message?.content;
        if (Array.isArray(content)) {
          for (const block of content as Array<Record<string, unknown>>) {
            if (block.type === 'tool_result') {
              const event: SessionEvent = {
                kind: 'tool_result',
                paneId: this.paneId,
                toolUseId: String(block.tool_use_id ?? ''),
                content: block.content,
                isError: Boolean(block.is_error),
                ts,
              };
              this.emit(event);
              await appendTranscript(this.paneId, event);
            }
          }
        }
        break;
      }
      case 'result': {
        const subtype = msg.subtype ?? 'unknown';
        // Suppress the SDK's "post-success error stub" — a second
        // result with subtype='error_during_execution' and zero
        // duration / cost / turns that arrives right after a real
        // success. It's the SDK telling us the CLI process is about
        // to crash on cleanup; the next iteration of the for-await
        // will throw and we handle that in `pump`. Forwarding this
        // stub to the transcript would render a red ERROR_DURING_
        // EXECUTION block that contradicts the green SUCCESS block
        // immediately above it — see the conversation trace for the
        // Lead-mode sub-agent case where this is most jarring.
        const isPostSuccessStub =
          this.lastTurnWasSuccess &&
          subtype === 'error_during_execution' &&
          !msg.duration_ms &&
          !msg.total_cost_usd &&
          !msg.num_turns;
        if (isPostSuccessStub) {
          console.warn(
            `[session] pane=${this.paneId} suppressed post-success ` +
              `error_during_execution stub (zero stats)`,
          );
          break;
        }
        // Track for the pump's catch-handler heuristic. A non-stub
        // error result resets it — we're back in "any later throw
        // is a real error" territory.
        this.lastTurnWasSuccess = subtype === 'success';
        // Compute per-turn deltas against the previous result's
        // cumulative totals. The SDK reports cumulative session-wide
        // numbers in every result message, so the "this task cost X"
        // value users actually want is the delta from the prior
        // result. First result of a session has no prior, so we
        // attribute the full cumulative to this single turn (which
        // is correct: it IS the first turn).
        const totalCostUsd = msg.total_cost_usd;
        const durationMs = msg.duration_ms;
        const numTurns = msg.num_turns;
        const deltaCostUsd =
          totalCostUsd === undefined
            ? undefined
            : this.prevTotalCostUsd === undefined
              ? totalCostUsd
              : Math.max(0, totalCostUsd - this.prevTotalCostUsd);
        const deltaDurationMs =
          durationMs === undefined
            ? undefined
            : this.prevDurationMs === undefined
              ? durationMs
              : Math.max(0, durationMs - this.prevDurationMs);
        const deltaNumTurns =
          numTurns === undefined
            ? undefined
            : this.prevNumTurns === undefined
              ? numTurns
              : Math.max(0, numTurns - this.prevNumTurns);
        // Save the new cumulative for the next result's delta. Do
        // this AFTER computing the deltas so we don't subtract from
        // ourselves.
        this.prevTotalCostUsd = totalCostUsd;
        this.prevDurationMs = durationMs;
        this.prevNumTurns = numTurns;
        const event: SessionEvent = {
          kind: 'result',
          paneId: this.paneId,
          subtype,
          sessionId: msg.session_id,
          durationMs,
          totalCostUsd,
          numTurns,
          deltaDurationMs,
          deltaCostUsd,
          deltaNumTurns,
          ts,
        };
        this.emit(event);
        await appendTranscript(this.paneId, event);
        // Record to the append-only usage ledger for cross-session totals.
        void recordUsage({
          ts,
          paneId: this.paneId,
          windowId: this.windowId ?? '',
          agentName: this.agentName ?? 'unknown',
          model: this.model,
          subtype: msg.subtype ?? 'unknown',
          costUsd: msg.total_cost_usd,
          durationMs: msg.duration_ms,
          numTurns: msg.num_turns,
          sessionId: msg.session_id,
        });
        // Persist the SDK session id so we can resume after a restart.
        if (msg.session_id && this.agentName) {
          void saveSessionState({
            paneId: this.paneId,
            agentName: this.agentName,
            model: this.model,
            sdkSessionId: msg.session_id,
            mcpServers: this.mcpServers,
            updatedAt: ts,
          });
        }
        this.emit({
          kind: 'status',
          paneId: this.paneId,
          status: 'waiting_for_input',
        });
        // Resolve any caller waiting on this turn to finish.
        if (this.pendingReply) {
          const { resolve, collected, timeout } = this.pendingReply;
          clearTimeout(timeout);
          this.pendingReply = undefined;
          resolve(
            collected.trim().length > 0
              ? collected
              : `(${this.agentName ?? 'agent'} completed without text output)`,
          );
        }
        break;
      }
      // 'system' and partial messages are ignored for now.
      default:
        break;
    }
  }

  send(text: string, images: MessageImage[] = []): void {
    const ts = Date.now();
    // If the SDK loop has already ended (error, abort, natural close),
    // the input queue is dead — pushing into it would just hang. Surface
    // a clear error and bail instead of letting the UI sit on "working".
    if (this.pumpDone) {
      this.emit({
        kind: 'status',
        paneId: this.paneId,
        status: 'error',
        error:
          'Session ended after a previous error. Click "Clear session" in the pane menu to start a fresh one.',
      });
      return;
    }
    // Clear the post-success heuristic — we're starting a new turn,
    // so any error that bubbles out is a real new-turn error, not a
    // stale "process crashed after success" carry-over.
    this.lastTurnWasSuccess = false;

    // Emit + persist the user turn locally.
    const event: SessionEvent = {
      kind: 'user',
      paneId: this.paneId,
      text,
      images: images.length > 0 ? images : undefined,
      ts,
    };
    this.emit(event);
    void appendTranscript(this.paneId, event);

    this.emit({
      kind: 'status',
      paneId: this.paneId,
      status: 'streaming',
    });

    // Build content blocks when images are attached; otherwise a plain
    // string keeps the wire format minimal.
    let content: string | SdkContentBlock[];
    if (images.length === 0) {
      content = text;
    } else {
      const blocks: SdkContentBlock[] = images.map((img) => ({
        type: 'image',
        source: {
          type: 'base64',
          media_type: img.mime,
          data: img.base64,
        },
      }));
      if (text.trim().length > 0) {
        blocks.push({ type: 'text', text });
      }
      content = blocks;
    }

    this.inputQueue.push({
      type: 'user',
      message: { role: 'user', content },
      parent_tool_use_id: null,
      session_id: this.sessionId ?? '',
    });
  }

  /**
   * Push a message and resolve with the agent's next-turn text reply.
   * Used by the Lead orchestrator's `message_agent` and `spawn_agent` tools.
   */
  sendAndWait(text: string, timeoutMs = 10 * 60 * 1000): Promise<string> {
    if (this.pendingReply) {
      return Promise.reject(
        new Error(
          `Agent ${this.agentName ?? this.paneId} is still handling a previous request.`,
        ),
      );
    }
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingReply = undefined;
        reject(
          new Error(
            `Timed out waiting for ${this.agentName ?? 'agent'} to reply (${Math.round(timeoutMs / 1000)}s).`,
          ),
        );
      }, timeoutMs);
      this.pendingReply = { resolve, reject, collected: '', timeout };
      this.send(text);
    });
  }

  async interrupt(): Promise<void> {
    // Prefer the SDK's built-in interrupt, but never let it block us — if
    // it doesn't return promptly, fall through to abort. This is what
    // makes the Stop button actually stop a hung session.
    if (this.queryHandle && typeof this.queryHandle.interrupt === 'function') {
      try {
        await Promise.race([
          this.queryHandle.interrupt(),
          new Promise<void>((_, rej) =>
            setTimeout(() => rej(new Error('SDK interrupt timed out')), 3000),
          ),
        ]);
      } catch {
        // fall through to abort
      }
    }
    this.abort.abort();
    // Force a terminal status if the pump didn't already emit one (e.g.
    // because the SDK iterator was hung and never observed the abort).
    // Without this the UI stays on "Agent is working" forever.
    if (!this.pumpDone) {
      this.pumpDone = true;
      this.emit({
        kind: 'status',
        paneId: this.paneId,
        status: 'stopped',
      });
    }
  }

  async stop(): Promise<void> {
    this.inputQueue.close();
    this.abort.abort();
    if (this.pendingReply) {
      clearTimeout(this.pendingReply.timeout);
      this.pendingReply.reject(new Error('Session stopped'));
      this.pendingReply = undefined;
    }
    if (this.pumpPromise) {
      // Race against a 3s ceiling so a hung SDK iterator can't keep us
      // stuck — at worst we leak the iterator (it gets GC'd anyway).
      try {
        await Promise.race([
          this.pumpPromise,
          new Promise<void>((resolve) => setTimeout(resolve, 3000)),
        ]);
      } catch {
        // pump already surfaced any error via events
      }
    }
    if (!this.pumpDone) {
      this.pumpDone = true;
      this.emit({
        kind: 'status',
        paneId: this.paneId,
        status: 'stopped',
      });
    }
  }

  getSessionId(): string | undefined {
    return this.sessionId;
  }
}

/** Pool of active session controllers keyed by paneId. */
export class SessionPool {
  private controllers = new Map<PaneId, IAgentSession>();

  constructor(private readonly emit: SessionEmit) {}

  get(paneId: PaneId): IAgentSession | undefined {
    return this.controllers.get(paneId);
  }

  async start(
    params: StartSessionParams,
    agent: AgentDef,
    availableSkills: SkillDef[] = [],
    leadExtras?: {
      mcpServers: Record<string, unknown>;
      // Optional — only populated for actual Lead-mode panes. The
      // bag is shared with the always-on AskUserQuestion server in
      // Multi mode, where this stays undefined and the system prompt
      // is built from the agent's own definition.
      leadPrompt?: string;
    },
    memoryBlock = '',
  ): Promise<void> {
    await this.stop(params.paneId);
    const controller = new SessionController(params.paneId, this.emit);
    this.controllers.set(params.paneId, controller);
    await controller.start(params, agent, availableSkills, leadExtras, memoryBlock);
  }

  send(paneId: PaneId, text: string, images: MessageImage[] = []): void {
    const controller = this.controllers.get(paneId);
    if (!controller) throw new Error(`No active session for pane ${paneId}`);
    controller.send(text, images);
  }

  /** Find a non-Lead session by agent name (Lead orchestrator lookup). */

  async interrupt(paneId: PaneId): Promise<void> {
    await this.controllers.get(paneId)?.interrupt();
  }

  async stop(paneId: PaneId): Promise<void> {
    const controller = this.controllers.get(paneId);
    if (!controller) return;
    this.controllers.delete(paneId);
    await controller.stop();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.controllers.values()].map((c) => c.stop()));
    this.controllers.clear();
  }

  lastSessionIds(): Record<PaneId, string> {
    const out: Record<PaneId, string> = {};
    for (const [paneId, ctrl] of this.controllers) {
      const id = ctrl.getSessionId();
      if (id) out[paneId] = id;
    }
    return out;
  }

  /**
   * Find a live controller by agent name. The `sessionId` filter is
   * critical for correctness: SessionPool is global to the app, so
   * controllers from every workspace/project the user has visited
   * stay alive in `controllers`. Without filtering by session, a
   * Lead in workspace B asking `message_agent("frontend-developer")`
   * could route the message to a long-lived pane in workspace A —
   * which is a different project, different cwd, different repo.
   * Always pass `sessionId` from the Lead orchestrator (it's the
   * Lead's own `windowId`).
   */
  findByAgentName(
    name: string,
    excludePaneId?: PaneId,
    sessionId?: string,
  ): IAgentSession | undefined {
    for (const ctrl of this.controllers.values()) {
      if (ctrl.paneId === excludePaneId) continue;
      if (sessionId && ctrl.windowId !== sessionId) continue;
      if (ctrl.agentName === name) return ctrl;
    }
    return undefined;
  }

  listActiveAgents(
    excludePaneId?: PaneId,
    sessionId?: string,
  ): Array<{ paneId: PaneId; agentName: string }> {
    const out: Array<{ paneId: PaneId; agentName: string }> = [];
    for (const ctrl of this.controllers.values()) {
      if (ctrl.paneId === excludePaneId) continue;
      if (sessionId && ctrl.windowId !== sessionId) continue;
      if (ctrl.agentName) {
        out.push({ paneId: ctrl.paneId, agentName: ctrl.agentName });
      }
    }
    return out;
  }
}

/** Compare two optional string arrays as unordered sets. */
function sameSet(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = new Set(a ?? []);
  const right = new Set(b ?? []);
  if (left.size !== right.size) return false;
  for (const v of left) if (!right.has(v)) return false;
  return true;
}
