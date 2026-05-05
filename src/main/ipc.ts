import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { IPC } from '@shared/ipc-channels';
import type {
  AgentDraft,
  MessageImage,
  PaneId,
  SessionEvent,
  SkillDraft,
  StartSessionParams,
  WindowState,
  Workspace,
} from '@shared/types';
import {
  deleteAgent,
  deleteSkill,
  listAgents,
  listSkills,
  saveAgent,
  saveSkill,
} from './agents';
import { buildLeadPrompt, createLeadToolServer } from './lead-tools';
import {
  createAskUserQuestionServer,
  resolveAnswer,
  type AskUserQuestionAnswer,
} from './ask-user-question-tool';
import { generateAgentBody } from './agent-generator';
import {
  composeMemoryForScope,
  ensureProjectMemory,
  globalMemoryPath,
  projectMemoryPath,
  readMemoryFile,
  writeMemoryFile,
} from './memory';
import { getUsageSummary } from './usage';
import { deleteSessionState } from './session-store';
import {
  deleteMcpServer,
  listMcpServers,
  saveMcpServer,
} from './mcp-config';
import { probeMcpServer } from './mcp-probe';
import {
  checkCommandsAvailable,
  getGitBranch,
  getListenerPidsForPort,
  killPort,
  listGitBranches,
  parsePortFromUrl,
  worktreeCreate,
  worktreeRemove,
  worktreeStatus,
  gitInit,
  type WorktreeCreateArgs,
  type WorktreeRemoveArgs,
} from './system';
import { loadDiff, type LoadDiffArgs } from './git-diff';
import { applyDecisions, type ApplyDecisionsArgs } from './git-apply';
import {
  detectGh,
  commitChanges,
  pushBranch,
  createPR,
  listGhAccounts,
  switchGhAccount,
  switchRemoteToHttps,
  setRemoteUrl,
  ensureRemoteBranch,
  pullBranch,
  type CommitArgs,
  type PushArgs,
} from './gh-cli';
import {
  summarizePR,
  type PRSummarizeInput,
} from './pr-summarize';
import { localMerge, type LocalMergeArgs } from './git-merge';
import {
  getCheckRunLogs,
  getPullRequestDetail,
  isGhAvailable,
  listPullRequests,
} from './pr';
import {
  appendLogEntry,
  deletePage as wikiDeletePage,
  getWikiStatus,
  initWiki,
  listAllPages as listWikiPages,
  readPage as readWikiPage,
  writePage as writeWikiPage,
} from './wiki';
import {
  applyStoredApiKey,
  clearStoredApiKey,
  getClaudeAuthInfo,
  hasStoredApiKey,
  testApiKey,
  writeStoredApiKey,
} from './claude-auth';
import type { PRDraft } from '@shared/types';
import {
  authenticateMcpServer,
  disconnectMcpServer,
  listAuthedResources,
} from './mcp-oauth';
import {
  getVoiceSettings,
  resolveVoiceStartCreds,
  saveVoiceSettings,
} from './voice';
import {
  killTerminal,
  resizeTerminal,
  spawnTerminal,
  writeTerminal,
} from './terminal';
import {
  deleteShortcut,
  listShortcuts,
  reorderShortcuts,
  saveShortcut,
} from './terminal-shortcuts';
import type { TerminalShortcut } from '@shared/types';
import type {
  McpScope,
  McpServerConfig,
  McpServerDraft,
  VoiceSettings,
} from '@shared/types';
import { SessionPool } from './sessions';
import {
  deleteWindowState,
  deleteWorkspace,
  getState,
  deleteTranscript,
  loadTranscript,
  saveWindowState,
  saveWorkspace,
  setActiveSessionId,
  setActiveWorkspaceId,
} from './persistence';

/**
 * Broadcasts a session event to the window that owns the originating pane.
 * We keep a Map paneId -> windowId so events go to the right renderer even
 * across multiple open windows.
 */
const paneToWindow = new Map<PaneId, number>();

function broadcastEvent(event: SessionEvent): void {
  const winId = paneToWindow.get(event.paneId);
  if (winId === undefined) return;
  const win = BrowserWindow.fromId(winId);
  if (!win || win.isDestroyed()) return;
  win.webContents.send(IPC.SESSION_EVENT, event);
  // On every result event, nudge renderers to refresh their usage chips.
  if (event.kind === 'result') {
    broadcastUsageTick();
  }
}

export const sessionPool = new SessionPool(broadcastEvent);

export function registerIpcHandlers(): void {
  // -- Agents & skills ------------------------------------------------------
  ipcMain.handle(IPC.AGENTS_LIST, async (_e, projectDir?: string) => {
    return listAgents(projectDir);
  });
  ipcMain.handle(IPC.AGENTS_SAVE, async (_e, draft: AgentDraft) => {
    return saveAgent(draft);
  });
  ipcMain.handle(IPC.AGENTS_DELETE, async (_e, filePath: string) => {
    await deleteAgent(filePath);
    return { ok: true };
  });
  ipcMain.handle(
    IPC.AGENTS_GENERATE,
    async (_e, args: { name: string; description: string }) => {
      return generateAgentBody(args);
    },
  );
  ipcMain.handle(IPC.SKILLS_LIST, async (_e, projectDir?: string) => {
    return listSkills(projectDir);
  });
  ipcMain.handle(IPC.SKILLS_SAVE, async (_e, draft: SkillDraft) => {
    return saveSkill(draft);
  });
  ipcMain.handle(IPC.SKILLS_DELETE, async (_e, filePath: string) => {
    await deleteSkill(filePath);
    return { ok: true };
  });

  // -- Sessions -------------------------------------------------------------
  ipcMain.handle(
    IPC.SESSION_START,
    async (event, params: StartSessionParams) => {
      // Pass `params.cwd` to both listers so project-scoped definitions
      // (`<cwd>/.claude/agents/...`, `<cwd>/.claude/skills/...`) are
      // visible to the lookup. Without this, the renderer can SEE a
      // project agent in the sidebar (its lister gets cwd) but
      // assigning the agent to a pane fails with "Agent not found"
      // because this handler was scanning only the user-scope folder.
      const [agents, skills] = await Promise.all([
        listAgents(params.cwd),
        listSkills(params.cwd),
      ]);
      const agent = agents.find((a) => a.name === params.agentName);
      if (!agent) {
        throw new Error(`Agent not found: ${params.agentName}`);
      }
      // Track which window owns this pane so we can route events back.
      const winId = BrowserWindow.fromWebContents(event.sender)?.id;
      if (winId !== undefined) {
        paneToWindow.set(params.paneId, winId);
      }

      // Every pane (Lead or otherwise) gets the AskUserQuestion
      // server so agents can present structured multi-choice
      // prompts without crashing the SDK on a missing tool. Lead
      // panes additionally get the orchestrator server + prompt
      // addendum that explains the orchestrator role.
      let leadExtras:
        | {
            mcpServers: Record<string, unknown>;
            leadPrompt?: string;
          }
        | undefined;
      if (winId !== undefined) {
        const askServer = createAskUserQuestionServer({
          paneId: params.paneId,
          windowId: winId,
        });
        const mcpServers: Record<string, unknown> = {
          AskUserQuestion: askServer,
        };
        let leadPrompt: string | undefined;
        if (params.isLead) {
          mcpServers['lead-orchestrator'] = createLeadToolServer({
            pool: sessionPool,
            windowId: winId,
            leadPaneId: params.paneId,
            cwd: params.cwd,
            // Same project-scope inclusion as session start — without
            // cwd, the Lead's spawn_agent tool would refuse to spawn
            // any project-scoped agent ("Agent not found").
            getAvailableAgents: () => listAgents(params.cwd),
          });
          leadPrompt = buildLeadPrompt(agents);
        }
        leadExtras = { mcpServers, leadPrompt };
      }

      // Resolve CLAUDE.md content based on workspace scope.
      // Sub-agents in Lead mode never get the project memory — only the
      // Lead does, per the user-chosen behaviour.
      let memoryBlock = '';
      if (!params.isSubAgent) {
        memoryBlock = await composeMemoryForScope(
          params.cwd,
          params.memoryScope ?? 'project',
        );
      }

      await sessionPool.start(params, agent, skills, leadExtras, memoryBlock);
      return { ok: true };
    },
  );

  ipcMain.handle(
    IPC.SESSION_SEND,
    async (_e, paneId: PaneId, text: string, images?: MessageImage[]) => {
      sessionPool.send(paneId, text, images ?? []);
      return { ok: true };
    },
  );

  ipcMain.handle(IPC.SESSION_INTERRUPT, async (_e, paneId: PaneId) => {
    await sessionPool.interrupt(paneId);
    return { ok: true };
  });

  ipcMain.handle(IPC.SESSION_STOP, async (_e, paneId: PaneId) => {
    await sessionPool.stop(paneId);
    paneToWindow.delete(paneId);
    // Closing a pane is an explicit "throw this away" — drop its
    // persisted session state too so a later rebind starts clean.
    await deleteSessionState(paneId);
    return { ok: true };
  });

  // -- Workspace ------------------------------------------------------------
  ipcMain.handle(IPC.WORKSPACE_PICK_FOLDER, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const result = await dialog.showOpenDialog(win ?? undefined!, {
      title: 'Choose a project folder',
      properties: ['openDirectory', 'createDirectory'],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  });

  // -- System helpers (Preview port picker) ---------------------------------
  ipcMain.handle(
    IPC.SYSTEM_PORT_LISTENERS,
    async (_e, args: { url?: string; port?: number }) => {
      const port =
        typeof args.port === 'number'
          ? args.port
          : args.url
            ? parsePortFromUrl(args.url)
            : null;
      if (!port) return [];
      return getListenerPidsForPort(port);
    },
  );
  ipcMain.handle(
    IPC.SYSTEM_KILL_PORT,
    async (_e, args: { url?: string; port?: number }) => {
      const port =
        typeof args.port === 'number'
          ? args.port
          : args.url
            ? parsePortFromUrl(args.url)
            : null;
      if (!port) {
        return { port: 0, killed: [], errors: [{ pid: 0, message: 'Could not parse port from URL.' }] };
      }
      return killPort(port);
    },
  );
  ipcMain.handle(
    IPC.SYSTEM_OPEN_PATH,
    async (_e, args: { path: string }) => {
      // shell.openPath returns '' on success or an error string. We
      // surface that through to the renderer so a missing folder
      // (deleted on disk) doesn't fail silently.
      const result = await shell.openPath(args.path);
      return { ok: result === '', error: result || undefined };
    },
  );
  ipcMain.handle(
    IPC.SYSTEM_GIT_BRANCH,
    async (_e, args: { cwd: string }) => getGitBranch(args.cwd),
  );
  ipcMain.handle(
    IPC.SYSTEM_GIT_BRANCHES,
    async (_e, args: { cwd: string }) => listGitBranches(args.cwd),
  );
  ipcMain.handle(
    IPC.SYSTEM_WORKTREE_CREATE,
    async (_e, args: WorktreeCreateArgs) => worktreeCreate(args),
  );
  ipcMain.handle(
    IPC.SYSTEM_WORKTREE_REMOVE,
    async (_e, args: WorktreeRemoveArgs) => worktreeRemove(args),
  );
  ipcMain.handle(
    IPC.SYSTEM_WORKTREE_STATUS,
    async (_e, args: { cwd: string }) => worktreeStatus(args.cwd),
  );
  ipcMain.handle(
    IPC.SYSTEM_GIT_INIT,
    async (_e, args: { cwd: string }) => gitInit(args.cwd),
  );
  ipcMain.handle(
    IPC.SYSTEM_CHECK_COMMANDS,
    async (_e, args: { commands: string[] }) =>
      checkCommandsAvailable(args.commands),
  );

  // -- AskUserQuestion --------------------------------------------------------
  // The renderer fires this once the user submits the in-pane form.
  // We resolve the matching pending Promise so the agent's tool call
  // returns and the conversation continues.
  ipcMain.handle(
    IPC.ASK_USER_QUESTION_ANSWER,
    async (
      _e,
      args: { requestId: string; answer: AskUserQuestionAnswer },
    ) => {
      const ok = resolveAnswer(args.requestId, args.answer);
      return { ok };
    },
  );

  // -- Diff Review ----------------------------------------------------------
  ipcMain.handle(
    IPC.REVIEW_LOAD_DIFF,
    async (_e, args: LoadDiffArgs) => loadDiff(args),
  );
  ipcMain.handle(
    IPC.REVIEW_APPLY_DECISIONS,
    async (_e, args: ApplyDecisionsArgs) => applyDecisions(args),
  );
  ipcMain.handle(
    IPC.REVIEW_GH_STATUS,
    async (_e, args: { cwd: string }) => detectGh(args),
  );
  ipcMain.handle(IPC.REVIEW_GH_ACCOUNTS, async () => listGhAccounts());
  ipcMain.handle(
    IPC.REVIEW_GH_SWITCH,
    async (_e, args: { login: string }) => switchGhAccount(args),
  );
  ipcMain.handle(
    IPC.REVIEW_REMOTE_TO_HTTPS,
    async (_e, args: { cwd: string }) => switchRemoteToHttps(args),
  );
  ipcMain.handle(
    IPC.REVIEW_SET_REMOTE_URL,
    async (_e, args: { cwd: string; url: string }) => setRemoteUrl(args),
  );
  ipcMain.handle(
    IPC.REVIEW_COMMIT,
    async (_e, args: CommitArgs) => commitChanges(args),
  );
  ipcMain.handle(
    IPC.REVIEW_PUSH,
    async (_e, args: PushArgs) => pushBranch(args),
  );
  ipcMain.handle(
    IPC.REVIEW_ENSURE_REMOTE_BRANCH,
    async (_e, args: { cwd: string; branch: string }) =>
      ensureRemoteBranch(args),
  );
  ipcMain.handle(
    IPC.REVIEW_PULL,
    async (_e, args: { cwd: string; branch: string }) => pullBranch(args),
  );
  ipcMain.handle(
    IPC.REVIEW_CREATE_PR,
    async (_e, args: { cwd: string; draft: PRDraft }) => createPR(args),
  );
  ipcMain.handle(
    IPC.REVIEW_SUMMARIZE_PR,
    async (_e, args: PRSummarizeInput) => summarizePR(args),
  );
  ipcMain.handle(
    IPC.REVIEW_LOCAL_MERGE,
    async (_e, args: LocalMergeArgs) => localMerge(args),
  );

  // -- PR inbox -------------------------------------------------------------
  // gh-CLI backed; renderer polls every 5 minutes plus on user
  // refresh tap. Errors bubble back to the renderer untouched so it
  // can show "install gh" hints when isGhAvailable returns false.
  ipcMain.handle(IPC.PR_LIST, async (_e, args: { cwd: string }) =>
    listPullRequests(args.cwd),
  );
  ipcMain.handle(
    IPC.PR_DETAIL,
    async (_e, args: { cwd: string; number: number }) =>
      getPullRequestDetail(args.cwd, args.number),
  );
  ipcMain.handle(
    IPC.PR_CHECK_LOGS,
    async (_e, args: { cwd: string; runId: string; lines?: number }) =>
      getCheckRunLogs(args.cwd, args.runId, args.lines),
  );
  ipcMain.handle(IPC.PR_AVAILABLE, async (_e, args: { cwd: string }) =>
    isGhAvailable(args.cwd),
  );

  // -- LLM Wiki -------------------------------------------------------------
  // Storage layer for the project's persistent knowledge base. The
  // renderer + agents drive ingest/query/lint workflows; this layer
  // is just safe CRUD over <cwd>/.inzone/wiki/.
  ipcMain.handle(IPC.WIKI_STATUS, async (_e, args: { cwd: string }) =>
    getWikiStatus(args.cwd),
  );
  ipcMain.handle(IPC.WIKI_INIT, async (_e, args: { cwd: string }) =>
    initWiki(args.cwd),
  );
  ipcMain.handle(IPC.WIKI_LIST_PAGES, async (_e, args: { cwd: string }) =>
    listWikiPages(args.cwd),
  );
  ipcMain.handle(
    IPC.WIKI_READ_PAGE,
    async (_e, args: { cwd: string; relPath: string }) =>
      readWikiPage(args.cwd, args.relPath),
  );
  ipcMain.handle(
    IPC.WIKI_WRITE_PAGE,
    async (_e, args: { cwd: string; relPath: string; content: string }) => {
      await writeWikiPage(args.cwd, args.relPath, args.content);
      return { ok: true } as const;
    },
  );
  ipcMain.handle(
    IPC.WIKI_APPEND_LOG,
    async (_e, args: { cwd: string; entry: string }) => {
      await appendLogEntry(args.cwd, args.entry);
      return { ok: true } as const;
    },
  );
  ipcMain.handle(
    IPC.WIKI_DELETE_PAGE,
    async (_e, args: { cwd: string; relPath: string }) => {
      await wikiDeletePage(args.cwd, args.relPath);
      return { ok: true } as const;
    },
  );

  // -- Profile (Settings → Profile) -----------------------------------------
  ipcMain.handle(IPC.PROFILE_CLAUDE_AUTH, async () => getClaudeAuthInfo());

  // Inspect / mutate the encrypted API key stored under userData.
  // The renderer never receives the actual key — only a boolean for
  // "is one stored?" and a snapshot of the active env-var source.
  ipcMain.handle(IPC.PROFILE_API_KEY_STATUS, async () => {
    const stored = await hasStoredApiKey();
    const envSet = (process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0;
    // We only flag the env-var as "external" when there's no stored
    // key OR the env-var value differs from what we'd inject from
    // storage. Practically: if applyStoredApiKey() ran on boot and
    // populated the env-var from storage, those will match and we
    // consider the source 'stored' for UI purposes.
    let source: 'env-external' | 'stored' | 'env-from-stored' | 'none';
    if (!envSet) source = 'none';
    else if (!stored) source = 'env-external';
    else source = 'env-from-stored';
    return { hasStoredKey: stored, envSet, source };
  });
  ipcMain.handle(
    IPC.PROFILE_API_KEY_SAVE,
    async (_e, args: { key: string }) => {
      await writeStoredApiKey(args.key);
      // Re-apply so process.env picks up the new key without an app
      // restart. applyStoredApiKey respects an existing env var, but
      // here the user just wrote a new key — they expect it active
      // immediately. Force-set in that case.
      const userEnvWasExternal =
        (process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0 &&
        // Heuristic: if the value differs from what we just wrote,
        // it was set by the user externally; leave it alone.
        process.env.ANTHROPIC_API_KEY?.trim() !== args.key.trim();
      if (!userEnvWasExternal) {
        process.env.ANTHROPIC_API_KEY = args.key.trim();
      }
      return { ok: true };
    },
  );
  ipcMain.handle(IPC.PROFILE_API_KEY_CLEAR, async () => {
    await clearStoredApiKey();
    // Drop our injected env var if the value matches what we had
    // stored. We can't know for sure here, so the safe move is to
    // unset only when applyStoredApiKey would no-op (i.e. nothing
    // else set it). Power users can always restart to reload.
    const stillStored = await hasStoredApiKey();
    if (!stillStored) {
      // We can't reliably distinguish "user-set external env" from
      // "we set it from storage". Only clear when there's nothing
      // left in storage. The renderer message tells the user a
      // restart finalises the change.
      delete process.env.ANTHROPIC_API_KEY;
      // Re-apply in case there's a fresh stored key (race-safe).
      await applyStoredApiKey();
    }
    return { ok: true };
  });
  ipcMain.handle(
    IPC.PROFILE_API_KEY_TEST,
    async (_e, args: { key: string }) => testApiKey(args.key),
  );

  // -- Persistence ----------------------------------------------------------
  ipcMain.handle(IPC.STATE_GET, async () => getState());

  ipcMain.handle(
    IPC.STATE_SAVE_WINDOW,
    async (_e, windowState: WindowState) => {
      saveWindowState(windowState);
      return { ok: true };
    },
  );

  ipcMain.handle(IPC.STATE_DELETE_WINDOW, async (_e, id: string) => {
    deleteWindowState(id);
    return { ok: true };
  });

  ipcMain.handle(
    IPC.STATE_SET_ACTIVE_SESSION,
    async (_e, id: string | undefined) => {
      setActiveSessionId(id);
      return { ok: true };
    },
  );

  ipcMain.handle(IPC.STATE_SAVE_WORKSPACE, async (_e, ws: Workspace) => {
    saveWorkspace(ws);
    return { ok: true };
  });

  ipcMain.handle(IPC.STATE_DELETE_WORKSPACE, async (_e, id: string) => {
    deleteWorkspace(id);
    return { ok: true };
  });

  ipcMain.handle(
    IPC.STATE_SET_ACTIVE_WORKSPACE,
    async (_e, id: string | undefined) => {
      setActiveWorkspaceId(id);
      return { ok: true };
    },
  );

  ipcMain.handle(IPC.TRANSCRIPT_LOAD, async (_e, paneId: PaneId) => {
    return loadTranscript(paneId);
  });
  ipcMain.handle(IPC.TRANSCRIPT_DELETE, async (_e, paneId: PaneId) => {
    await deleteTranscript(paneId);
    // Also wipe the persisted session-state so a re-bind starts fresh
    // rather than auto-resuming the SDK session whose transcript we
    // just threw away.
    await deleteSessionState(paneId);
    return { ok: true };
  });

  ipcMain.handle(IPC.USAGE_SUMMARY, async (_e, windowId?: string) => {
    return getUsageSummary(windowId);
  });

  // CLAUDE.md memory files. The renderer asks for a specific scope or
  // path and gets back the file's content (or '' if missing).
  ipcMain.handle(
    IPC.MEMORY_READ,
    async (
      _e,
      args: { scope: 'project' | 'global'; cwd?: string },
    ): Promise<{ filePath: string; content: string }> => {
      const filePath =
        args.scope === 'global'
          ? globalMemoryPath()
          : projectMemoryPath(args.cwd ?? '');
      const content = await readMemoryFile(filePath);
      return { filePath, content };
    },
  );
  ipcMain.handle(
    IPC.MEMORY_WRITE,
    async (
      _e,
      args: { scope: 'project' | 'global'; cwd?: string; content: string },
    ): Promise<{ filePath: string }> => {
      const filePath =
        args.scope === 'global'
          ? globalMemoryPath()
          : projectMemoryPath(args.cwd ?? '');
      await writeMemoryFile(filePath, args.content);
      return { filePath };
    },
  );
  ipcMain.handle(IPC.MEMORY_ENSURE, async (_e, cwd: string) => {
    await ensureProjectMemory(cwd);
    return { ok: true };
  });

  // -- MCP servers ----------------------------------------------------------
  ipcMain.handle(IPC.MCP_LIST, async (_e, cwd?: string) => {
    return listMcpServers(cwd);
  });
  ipcMain.handle(
    IPC.MCP_SAVE,
    async (_e, args: { draft: McpServerDraft; cwd?: string }) => {
      return saveMcpServer(args.draft, args.cwd);
    },
  );
  ipcMain.handle(
    IPC.MCP_DELETE,
    async (
      _e,
      args: { name: string; scope: McpScope; cwd?: string },
    ) => {
      await deleteMcpServer(args);
      return { ok: true };
    },
  );
  ipcMain.handle(
    IPC.MCP_PROBE,
    async (_e, args: { config: McpServerConfig }) => {
      return probeMcpServer(args.config);
    },
  );
  ipcMain.handle(
    IPC.MCP_AUTH_START,
    async (_e, args: { url: string; scopes?: string[] }) => {
      try {
        const result = await authenticateMcpServer(args);
        return { ok: true as const, result };
      } catch (err) {
        return {
          ok: false as const,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    },
  );
  ipcMain.handle(
    IPC.MCP_AUTH_DISCONNECT,
    async (_e, args: { url: string }) => {
      const removed = await disconnectMcpServer(args.url);
      return { ok: true as const, removed };
    },
  );
  ipcMain.handle(IPC.MCP_AUTH_LIST, async () => {
    return listAuthedResources();
  });

  // -- Voice agent ----------------------------------------------------------
  ipcMain.handle(IPC.VOICE_GET, async () => getVoiceSettings());
  ipcMain.handle(IPC.VOICE_SAVE, async (_e, settings: VoiceSettings) => {
    saveVoiceSettings(settings);
    return { ok: true };
  });
  ipcMain.handle(IPC.VOICE_GET_START_CREDS, async () => {
    return resolveVoiceStartCreds();
  });

  // -- Terminal (PTY) -------------------------------------------------------
  ipcMain.handle(
    IPC.TERM_SPAWN,
    async (
      event,
      args: {
        cwd: string;
        cols: number;
        rows: number;
        // Optional — used by per-pane terminal workers that auto-launch
        // a CLI like `claude` or `codex` after the shell warms up.
        initialCommand?: string;
      },
    ) => {
      const winId = BrowserWindow.fromWebContents(event.sender)?.id;
      if (winId === undefined) {
        throw new Error('Cannot determine sender window for terminal.');
      }
      return spawnTerminal({
        cwd: args.cwd,
        cols: args.cols,
        rows: args.rows,
        initialCommand: args.initialCommand,
        webContentsId: winId,
      });
    },
  );
  ipcMain.handle(
    IPC.TERM_INPUT,
    async (_e, args: { id: string; data: string }) => {
      writeTerminal(args.id, args.data);
      return { ok: true };
    },
  );
  ipcMain.handle(
    IPC.TERM_RESIZE,
    async (_e, args: { id: string; cols: number; rows: number }) => {
      resizeTerminal(args.id, args.cols, args.rows);
      return { ok: true };
    },
  );
  ipcMain.handle(IPC.TERM_KILL, async (_e, id: string) => {
    killTerminal(id);
    return { ok: true };
  });

  // -- Terminal shortcuts ---------------------------------------------------

  /**
   * Broadcast the latest shortcut list to every renderer so any open
   * terminal panels live-update without an app restart.
   */
  function broadcastShortcuts(next: TerminalShortcut[]): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) {
        win.webContents.send(IPC.TERM_SHORTCUTS_CHANGED, next);
      }
    }
  }

  ipcMain.handle(IPC.TERM_SHORTCUTS_LIST, async () => listShortcuts());
  ipcMain.handle(
    IPC.TERM_SHORTCUTS_SAVE,
    async (_e, s: TerminalShortcut) => {
      const next = saveShortcut(s);
      broadcastShortcuts(next);
      return next;
    },
  );
  ipcMain.handle(
    IPC.TERM_SHORTCUTS_DELETE,
    async (_e, id: string) => {
      const next = deleteShortcut(id);
      broadcastShortcuts(next);
      return next;
    },
  );
  ipcMain.handle(
    IPC.TERM_SHORTCUTS_REORDER,
    async (_e, ids: string[]) => {
      const next = reorderShortcuts(ids);
      broadcastShortcuts(next);
      return next;
    },
  );
}

/** Broadcast a result event as a usage update so renderers can refresh chips. */
export function broadcastUsageTick(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.USAGE_EVENT);
  }
}
