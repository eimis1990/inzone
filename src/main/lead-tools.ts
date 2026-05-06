import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { BrowserWindow } from 'electron';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { IPC } from '@shared/ipc-channels';
import type {
  AgentDef,
  PaneId,
  PaneSpawnRequest,
  StartSessionParams,
} from '@shared/types';
import { SessionPool } from './sessions';

/**
 * Build the in-process MCP server the Lead agent uses to orchestrate
 * sub-agents. Each tool takes care of:
 *  - finding / creating a SessionController in the pool
 *  - pushing a message
 *  - awaiting the sub-agent's next-turn reply
 *  - returning that reply as a text-content tool result
 *
 * Two distinct ids are baked in:
 *
 *   - `browserWindowId` (number) — the Electron BrowserWindow id.
 *     Used only for `BrowserWindow.fromId(...)` so we can dispatch
 *     pane-spawn IPC events to the right renderer window.
 *
 *   - `leadSessionId` (string) — INZONE's per-project session id
 *     (a.k.a. `windowId` on `StartSessionParams` / SessionController).
 *     Used to scope every pool lookup to THIS workspace's session,
 *     so the Lead can't accidentally route a message to a stale
 *     pane left over from another workspace. SessionPool is global
 *     to the app and keeps panes alive across workspace switches —
 *     filtering by session id is the only thing standing between a
 *     Lead in workspace B and a frontend-developer pane from
 *     workspace A. New panes spawned by `spawn_agent` inherit this
 *     same session id so future lookups continue to scope correctly.
 */
export function createLeadToolServer(args: {
  pool: SessionPool;
  browserWindowId: number;
  leadSessionId: string;
  leadPaneId: PaneId;
  cwd: string;
  getAvailableAgents: () => Promise<AgentDef[]>;
}) {
  const {
    pool,
    browserWindowId,
    leadSessionId,
    leadPaneId,
    cwd,
    getAvailableAgents,
  } = args;

  function mainWindow(): BrowserWindow | null {
    const w = BrowserWindow.fromId(browserWindowId);
    return w && !w.isDestroyed() ? w : null;
  }

  return createSdkMcpServer({
    name: 'lead-orchestrator',
    version: '1.0.0',
    tools: [
      tool(
        'list_live_agents',
        'List sub-agents currently running in this window, by their names. Use before picking who to message.',
        {},
        async () => {
          const entries = pool.listActiveAgents(leadPaneId, leadSessionId);
          if (entries.length === 0) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'No sub-agents are currently running. Use spawn_agent to start one.',
                },
              ],
            };
          }
          const lines = entries.map((e) => `- ${e.agentName}`).join('\n');
          return {
            content: [
              {
                type: 'text',
                text: `Active sub-agents:\n${lines}`,
              },
            ],
          };
        },
      ),

      tool(
        'list_available_agents',
        'List agents that can be spawned (from ~/.claude/agents). Use to discover who is available before calling spawn_agent.',
        {},
        async () => {
          const agents = await getAvailableAgents();
          if (agents.length === 0) {
            return {
              content: [{ type: 'text', text: 'No agent definitions found.' }],
            };
          }
          const lines = agents
            .map(
              (a) =>
                `- **${a.name}**${a.description ? ` — ${a.description}` : ''}`,
            )
            .join('\n');
          return {
            content: [
              { type: 'text', text: `Agents available to spawn:\n${lines}` },
            ],
          };
        },
      ),

      tool(
        'message_agent',
        'Send a message to a live sub-agent and wait for its reply. Returns the sub-agent\'s text response for this turn. Use this to delegate a step, ask for status, or give direction.',
        {
          agent_name: z
            .string()
            .describe('Name of the sub-agent (as shown by list_live_agents).'),
          message: z.string().describe('The message to send.'),
          timeout_seconds: z
            .number()
            .int()
            .min(10)
            .max(3600)
            .optional()
            .describe('Max seconds to wait for a reply (default 600).'),
        },
        async ({ agent_name, message, timeout_seconds }) => {
          const ctrl = pool.findByAgentName(
            agent_name,
            leadPaneId,
            leadSessionId,
          );
          if (!ctrl) {
            return {
              content: [
                {
                  type: 'text',
                  text: `No sub-agent named "${agent_name}" is running. Call list_live_agents to see who's active, or spawn_agent to start one.`,
                },
              ],
              isError: true,
            };
          }
          try {
            const reply = await ctrl.sendAndWait(
              message,
              (timeout_seconds ?? 600) * 1000,
            );
            return {
              content: [{ type: 'text', text: reply }],
            };
          } catch (err) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Error talking to ${agent_name}: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
            };
          }
        },
      ),

      tool(
        'spawn_agent',
        'Create a new sub-agent pane and hand it an initial task. Returns the sub-agent\'s first reply. Use only when no existing sub-agent fits — prefer message_agent for live ones.',
        {
          agent_name: z
            .string()
            .describe(
              'Name of an agent definition to spawn (from list_available_agents).',
            ),
          initial_message: z
            .string()
            .describe('The task to assign to the newly spawned agent.'),
          timeout_seconds: z
            .number()
            .int()
            .min(10)
            .max(3600)
            .optional()
            .describe('Max seconds to wait for the first reply (default 600).'),
        },
        async ({ agent_name, initial_message, timeout_seconds }) => {
          const agents = await getAvailableAgents();
          const agent = agents.find((a) => a.name === agent_name);
          if (!agent) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Agent definition "${agent_name}" not found. Call list_available_agents first.`,
                },
              ],
              isError: true,
            };
          }

          // Only allow one live pane per agent name within THIS
          // session — reuse if present. Workspace A and workspace B
          // can each have their own frontend-developer; we never
          // cross-route between them.
          const existing = pool.findByAgentName(
            agent_name,
            leadPaneId,
            leadSessionId,
          );
          if (existing) {
            try {
              const reply = await existing.sendAndWait(
                initial_message,
                (timeout_seconds ?? 600) * 1000,
              );
              return { content: [{ type: 'text', text: reply }] };
            } catch (err) {
              return {
                content: [
                  {
                    type: 'text',
                    text: `Sub-agent already exists but failed to reply: ${err instanceof Error ? err.message : String(err)}`,
                  },
                ],
                isError: true,
              };
            }
          }

          const newPaneId = nanoid(8);
          const others = pool
            .listActiveAgents(leadPaneId, leadSessionId)
            .map((e) => e.agentName);
          // Critical: stamp the new pane's `windowId` with the
          // Lead's session id (NOT the Electron BrowserWindow id).
          // Without this, when the user later switches workspaces
          // and a new Lead asks `message_agent` for the same name,
          // our session-scoped filter wouldn't find this pane —
          // but worse, a stale pane from a previous workspace
          // could match instead. Inheriting `leadSessionId` keeps
          // the filter correct across the whole pane lifecycle.
          const params: StartSessionParams = {
            paneId: newPaneId,
            windowId: leadSessionId,
            agentName: agent_name,
            cwd,
            otherAgentNames: others,
          };
          try {
            await pool.start(params, agent);
          } catch (err) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Failed to start ${agent_name}: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
            };
          }

          // Tell the renderer about the new pane so it shows up in the UI.
          const spawn: PaneSpawnRequest = {
            paneId: newPaneId,
            agentName: agent_name,
          };
          mainWindow()?.webContents.send(IPC.PANE_SPAWN, spawn);

          const ctrl = pool.get(newPaneId);
          if (!ctrl) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Started ${agent_name} but controller was not found.`,
                },
              ],
              isError: true,
            };
          }
          try {
            const reply = await ctrl.sendAndWait(
              initial_message,
              (timeout_seconds ?? 600) * 1000,
            );
            return {
              content: [
                {
                  type: 'text',
                  text: `Spawned ${agent_name}. First reply:\n\n${reply}`,
                },
              ],
            };
          } catch (err) {
            return {
              content: [
                {
                  type: 'text',
                  text: `Spawned ${agent_name} but timed out waiting for reply: ${err instanceof Error ? err.message : String(err)}`,
                },
              ],
              isError: true,
            };
          }
        },
      ),

    ],
  });
}

/** System prompt addendum explaining the Lead's role and tools. */
export function buildLeadPrompt(availableAgents: AgentDef[]): string {
  const rows = availableAgents
    .map(
      (a) =>
        `- **${a.name}**${a.description ? ` — ${a.description}` : ''}`,
    )
    .join('\n');
  const agentList = rows || '- (none yet)';

  return `## Lead Agent role

You are the **Lead orchestrator** in an INzone window. Your job is to break the user's task into subtasks, delegate them to the sub-agents the user has already added to this window, and iterate back and forth with them until the goal is met.

**Sub-agents available to spawn (definitions):**
${agentList}

**Your tools:**
- \`list_live_agents\` — which sub-agents are currently live in this window. **Call this first** so you know who's already at work.
- \`list_available_agents\` — which agent definitions exist on disk and could be spawned.
- \`message_agent(agent_name, message)\` — send a message to a live sub-agent and get its reply. **This is your primary tool.**
- \`spawn_agent(agent_name, initial_message)\` — last resort. Only call this when **no live sub-agent matches the next subtask** and the user clearly needs another. Prefer messaging existing live agents.

**How to operate:**
1. Always start with \`list_live_agents\` so you know what panes the user added. Treat that list as your team — work with them.
2. Prefer \`message_agent\` heavily. Existing live sub-agents are your first choice for every subtask. Re-message the same agent for follow-ups.
3. Use \`spawn_agent\` only if **none** of the live sub-agents fit the subtask and you genuinely need a new role. Mention to the user why you're spawning.
4. You may run multiple sub-agents in parallel by calling \`message_agent\` concurrently in a single turn — independent subtasks should be parallelized.
5. After each round, read the replies carefully and decide the next step.
6. When the whole goal is achieved, give the user a clear summary (what was done, where artifacts live, any caveats).
7. If a sub-agent fails or times out, tell the user and propose what to do next — do not silently retry forever.

**Hard rules — these are absolute:**
- **Never close, remove, or stop sub-agents.** The user controls which panes exist. You only message them.
- **Never refuse to talk to a sub-agent the user added.** If \`list_live_agents\` returns three agents, all three are your team.
- Only use these tools to interact with sub-agents. Do not impersonate them or fabricate their replies.
- Keep messages to sub-agents specific and self-contained. They do not see your conversation with the user.
- Never claim a sub-agent finished something unless its \`message_agent\` reply actually confirmed it.
- Produce your final answer for the user in your own words, not as a paste of a sub-agent's output.`;
}
