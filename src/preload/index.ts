import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from '@shared/ipc-channels';
import type { CoworkApi, VoiceStartCreds } from '@shared/cowork-api';
import type {
  AgentDef,
  AgentDraft,
  AppState,
  McpProbeResult,
  McpScope,
  McpServerConfig,
  McpServerDraft,
  McpServerEntry,
  MessageImage,
  PaneId,
  ClaudeAuthInfo,
  GhAccount,
  GhStatus,
  PaneSpawnRequest,
  PRDraft,
  ReviewHunk,
  ReviewState,
  SessionEvent,
  SkillDef,
  SkillDraft,
  StartSessionParams,
  TerminalShortcut,
  TranscriptEntry,
  UsageSummary,
  VoiceSettings,
  WindowState,
  Workspace,
} from '@shared/types';

const api: CoworkApi = {
  agents: {
    list: (projectDir?: string): Promise<AgentDef[]> =>
      ipcRenderer.invoke(IPC.AGENTS_LIST, projectDir),
    save: (draft: AgentDraft): Promise<AgentDef> =>
      ipcRenderer.invoke(IPC.AGENTS_SAVE, draft),
    delete: (filePath: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.AGENTS_DELETE, filePath),
    generate: (args: { name: string; description: string }): Promise<string> =>
      ipcRenderer.invoke(IPC.AGENTS_GENERATE, args),
    onWatch: (listener: () => void): (() => void) => {
      const handler = () => listener();
      ipcRenderer.on(IPC.AGENTS_WATCH, handler);
      return () => ipcRenderer.removeListener(IPC.AGENTS_WATCH, handler);
    },
  },
  skills: {
    list: (projectDir?: string): Promise<SkillDef[]> =>
      ipcRenderer.invoke(IPC.SKILLS_LIST, projectDir),
    save: (draft: SkillDraft): Promise<SkillDef> =>
      ipcRenderer.invoke(IPC.SKILLS_SAVE, draft),
    delete: (filePath: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.SKILLS_DELETE, filePath),
  },
  session: {
    start: (params: StartSessionParams): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.SESSION_START, params),
    send: (
      paneId: PaneId,
      text: string,
      images?: MessageImage[],
    ): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.SESSION_SEND, paneId, text, images),
    interrupt: (paneId: PaneId): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.SESSION_INTERRUPT, paneId),
    stop: (paneId: PaneId): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.SESSION_STOP, paneId),
    onEvent: (listener: (event: SessionEvent) => void): (() => void) => {
      const handler = (_e: unknown, event: SessionEvent) => listener(event);
      ipcRenderer.on(IPC.SESSION_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.SESSION_EVENT, handler);
    },
    onPaneSpawn: (
      listener: (payload: PaneSpawnRequest) => void,
    ): (() => void) => {
      const handler = (_e: unknown, payload: PaneSpawnRequest) =>
        listener(payload);
      ipcRenderer.on(IPC.PANE_SPAWN, handler);
      return () => ipcRenderer.removeListener(IPC.PANE_SPAWN, handler);
    },
    onPaneStopRemote: (
      listener: (payload: { paneId: PaneId }) => void,
    ): (() => void) => {
      const handler = (_e: unknown, payload: { paneId: PaneId }) =>
        listener(payload);
      ipcRenderer.on(IPC.PANE_STOP_REMOTE, handler);
      return () =>
        ipcRenderer.removeListener(IPC.PANE_STOP_REMOTE, handler);
    },
  },
  workspace: {
    pickFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(IPC.WORKSPACE_PICK_FOLDER),
  },
  system: {
    portListeners: (args: { url?: string; port?: number }) =>
      ipcRenderer.invoke(IPC.SYSTEM_PORT_LISTENERS, args),
    killPort: (args: { url?: string; port?: number }) =>
      ipcRenderer.invoke(IPC.SYSTEM_KILL_PORT, args),
    openPath: (args: { path: string }) =>
      ipcRenderer.invoke(IPC.SYSTEM_OPEN_PATH, args),
    gitBranch: (args: { cwd: string }): Promise<string | null> =>
      ipcRenderer.invoke(IPC.SYSTEM_GIT_BRANCH, args),
    gitBranches: (args: { cwd: string }): Promise<string[]> =>
      ipcRenderer.invoke(IPC.SYSTEM_GIT_BRANCHES, args),
    worktreeCreate: (args: {
      parentCwd: string;
      branchName: string;
      baseBranch: string | 'current';
      copyEnv: boolean;
    }) => ipcRenderer.invoke(IPC.SYSTEM_WORKTREE_CREATE, args),
    worktreeRemove: (args: {
      cwd: string;
      force?: boolean;
      deleteBranch?: string;
    }) => ipcRenderer.invoke(IPC.SYSTEM_WORKTREE_REMOVE, args),
    worktreeStatus: (args: { cwd: string }) =>
      ipcRenderer.invoke(IPC.SYSTEM_WORKTREE_STATUS, args),
    gitInit: (args: { cwd: string }) =>
      ipcRenderer.invoke(IPC.SYSTEM_GIT_INIT, args),
    /** Probe whether each command resolves on PATH (Workers tab). */
    checkCommands: (
      args: { commands: string[] },
    ): Promise<Record<string, boolean>> =>
      ipcRenderer.invoke(IPC.SYSTEM_CHECK_COMMANDS, args),
  },
  profile: {
    /** Detect the active Claude auth path (API key vs subscription),
     *  plus email/plan when discoverable via `claude auth status`. */
    claudeAuth: (): Promise<ClaudeAuthInfo> =>
      ipcRenderer.invoke(IPC.PROFILE_CLAUDE_AUTH),
    /** Check whether an encrypted API key is stored, and whether
     *  ANTHROPIC_API_KEY is currently set in the SDK process env. */
    apiKeyStatus: (): Promise<{
      hasStoredKey: boolean;
      envSet: boolean;
      source: 'env-external' | 'stored' | 'env-from-stored' | 'none';
    }> => ipcRenderer.invoke(IPC.PROFILE_API_KEY_STATUS),
    /** Persist an API key (encrypted via safeStorage) and inject it
     *  into the live process env so new sessions pick it up. */
    apiKeySave: (args: { key: string }): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.PROFILE_API_KEY_SAVE, args),
    /** Delete the stored key. */
    apiKeyClear: (): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.PROFILE_API_KEY_CLEAR),
    /** Hit Anthropic's /v1/models with the supplied key to verify
     *  it works. Returns { ok, status, error } — render accordingly. */
    apiKeyTest: (args: {
      key: string;
    }): Promise<{ ok: boolean; status?: number; error?: string }> =>
      ipcRenderer.invoke(IPC.PROFILE_API_KEY_TEST, args),
  },
  askUserQuestion: {
    /** Subscribe to "render this question form" events from main. */
    onShow: (
      listener: (payload: {
        paneId: PaneId;
        requestId: string;
        payload: {
          questions: Array<{
            question: string;
            header?: string;
            options: Array<{ label: string; description?: string }>;
            multiSelect?: boolean;
          }>;
        };
      }) => void,
    ) => {
      const handler = (
        _e: unknown,
        payload: {
          paneId: PaneId;
          requestId: string;
          payload: {
            questions: Array<{
              question: string;
              header?: string;
              options: Array<{ label: string; description?: string }>;
              multiSelect?: boolean;
            }>;
          };
        },
      ) => listener(payload);
      ipcRenderer.on(IPC.ASK_USER_QUESTION_SHOW, handler);
      return () =>
        ipcRenderer.removeListener(IPC.ASK_USER_QUESTION_SHOW, handler);
    },
    /** Send the user's answer back; main resolves the agent's
     *  pending tool call so the SDK turn unblocks. */
    answer: (args: {
      requestId: string;
      answer: {
        answers: Array<{ question: string; chosen: string[] }>;
      };
    }): Promise<{ ok: boolean }> =>
      ipcRenderer.invoke(IPC.ASK_USER_QUESTION_ANSWER, args),
  },
  review: {
    /** Load the structured diff for a worktree vs. its base branch.
     *  Returns a `ReviewState` ready to render. */
    loadDiff: (args: {
      cwd: string;
      baseBranch: string;
      worktreeBranch: string;
    }): Promise<ReviewState> =>
      ipcRenderer.invoke(IPC.REVIEW_LOAD_DIFF, args),
    /** Reverse-apply the rejected hunks against the worktree's
     *  working tree. Returns the files that were touched and any
     *  per-file warnings (apply continues file-by-file). */
    applyDecisions: (args: {
      cwd: string;
      rejectedHunks: ReviewHunk[];
      hunksByFile: Record<string, ReviewHunk[]>;
    }): Promise<{ revertedFiles: string[]; warnings: string[] }> =>
      ipcRenderer.invoke(IPC.REVIEW_APPLY_DECISIONS, args),
    /** Probe whether `gh` is installed + authenticated, plus look
     *  up the worktree's origin remote (owner/repo + default branch). */
    ghStatus: (args: { cwd: string }): Promise<GhStatus> =>
      ipcRenderer.invoke(IPC.REVIEW_GH_STATUS, args),
    /** List every gh-authed account (parsed from `gh auth status`).
     *  Drives the "Push as" dropdown for users with multiple accounts. */
    ghAccounts: (): Promise<GhAccount[]> =>
      ipcRenderer.invoke(IPC.REVIEW_GH_ACCOUNTS),
    /** Switch the active gh account before push. No-op when the
     *  target login is already active. */
    ghSwitch: (args: { login: string }): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.REVIEW_GH_SWITCH, args),
    /** Switch this repo's `origin` remote from SSH to HTTPS so git
     *  push uses gh's stored credentials (which respect ghSwitch). */
    remoteToHttps: (args: {
      cwd: string;
    }): Promise<{ url: string; changed: boolean }> =>
      ipcRenderer.invoke(IPC.REVIEW_REMOTE_TO_HTTPS, args),
    /** Set the repo's origin URL to whatever the caller passes —
     *  the manual escape hatch for users who want to paste their
     *  preferred URL (e.g. HTTPS) when auto-detection misfires. */
    setRemoteUrl: (args: {
      cwd: string;
      url: string;
    }): Promise<{ url: string }> =>
      ipcRenderer.invoke(IPC.REVIEW_SET_REMOTE_URL, args),
    /** Stage everything in the worktree and commit it as a single
     *  squash commit. Skips silently if the working tree is clean. */
    commit: (args: {
      cwd: string;
      message: string;
      body?: string;
    }): Promise<{ sha?: string; skipped: boolean }> =>
      ipcRenderer.invoke(IPC.REVIEW_COMMIT, args),
    /** Push the worktree's branch to origin (sets upstream by default). */
    push: (args: {
      cwd: string;
      branch: string;
      setUpstream?: boolean;
    }): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.REVIEW_PUSH, args),
    /** Make sure `branch` exists on origin — push it if it doesn't.
     *  Used before `gh pr create` so the base branch is resolvable
     *  on GitHub for repos that were initialized locally. */
    ensureRemoteBranch: (args: {
      cwd: string;
      branch: string;
    }): Promise<{ existed: boolean; pushed: boolean }> =>
      ipcRenderer.invoke(IPC.REVIEW_ENSURE_REMOTE_BRANCH, args),
    /** `git pull origin <branch>` in `cwd`. Switches to the branch
     *  first if it's not checked out. Used in the post-merge
     *  wrap-up to bring the merged commits back to the parent. */
    pull: (args: {
      cwd: string;
      branch: string;
    }): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.REVIEW_PULL, args),
    /** Run `gh pr create` with the given draft. Returns the PR URL
     *  + number on success. */
    createPR: (args: {
      cwd: string;
      draft: PRDraft;
    }): Promise<{ url: string; number?: number }> =>
      ipcRenderer.invoke(IPC.REVIEW_CREATE_PR, args),
    /** Ask Claude (via the Agent SDK) to draft a PR title + body
     *  from the agent's transcript + diff summary. Always resolves
     *  to a usable string pair — falls back to a generic auto-
     *  generated description if Claude misbehaves. */
    summarizePR: (args: {
      branch: string;
      baseBranch: string;
      files: string[];
      additions: number;
      deletions: number;
      userPrompt?: string;
      agentReply?: string;
    }): Promise<{ title: string; body: string }> =>
      ipcRenderer.invoke(IPC.REVIEW_SUMMARIZE_PR, args),
    /** Merge the worktree's branch into its base in the parent
     *  project's working tree. Caller commits any uncommitted
     *  worktree changes first via `commit()`. Returns the new
     *  HEAD's short SHA + whether it was a fast-forward. */
    localMerge: (args: {
      worktreeCwd: string;
      parentCwd: string;
      branch: string;
      baseBranch: string;
    }): Promise<{ sha?: string; fastForward: boolean }> =>
      ipcRenderer.invoke(IPC.REVIEW_LOCAL_MERGE, args),
  },
  state: {
    get: (): Promise<AppState> => ipcRenderer.invoke(IPC.STATE_GET),
    saveWindow: (state: WindowState): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.STATE_SAVE_WINDOW, state),
    deleteWindow: (id: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.STATE_DELETE_WINDOW, id),
    setActiveSession: (id: string | undefined): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.STATE_SET_ACTIVE_SESSION, id),
    saveWorkspace: (ws: Workspace): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.STATE_SAVE_WORKSPACE, ws),
    deleteWorkspace: (id: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.STATE_DELETE_WORKSPACE, id),
    setActiveWorkspace: (id: string | undefined): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.STATE_SET_ACTIVE_WORKSPACE, id),
    loadTranscript: (paneId: PaneId): Promise<TranscriptEntry[]> =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_LOAD, paneId),
    deleteTranscript: (paneId: PaneId): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.TRANSCRIPT_DELETE, paneId),
  },
  usage: {
    summary: (windowId?: string): Promise<UsageSummary> =>
      ipcRenderer.invoke(IPC.USAGE_SUMMARY, windowId),
    onTick: (listener: () => void): (() => void) => {
      const handler = () => listener();
      ipcRenderer.on(IPC.USAGE_EVENT, handler);
      return () => ipcRenderer.removeListener(IPC.USAGE_EVENT, handler);
    },
  },
  memory: {
    read: (args: { scope: 'project' | 'global'; cwd?: string }) =>
      ipcRenderer.invoke(IPC.MEMORY_READ, args),
    write: (args: {
      scope: 'project' | 'global';
      cwd?: string;
      content: string;
    }) => ipcRenderer.invoke(IPC.MEMORY_WRITE, args),
    ensure: (cwd: string): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.MEMORY_ENSURE, cwd),
  },
  mcp: {
    list: (cwd?: string): Promise<McpServerEntry[]> =>
      ipcRenderer.invoke(IPC.MCP_LIST, cwd),
    save: (args: {
      draft: McpServerDraft;
      cwd?: string;
    }): Promise<McpServerEntry> => ipcRenderer.invoke(IPC.MCP_SAVE, args),
    delete: (args: {
      name: string;
      scope: McpScope;
      cwd?: string;
    }): Promise<{ ok: true }> => ipcRenderer.invoke(IPC.MCP_DELETE, args),
    probe: (args: { config: McpServerConfig }): Promise<McpProbeResult> =>
      ipcRenderer.invoke(IPC.MCP_PROBE, args),
    authStart: (args: { url: string; scopes?: string[] }) =>
      ipcRenderer.invoke(IPC.MCP_AUTH_START, args),
    authDisconnect: (args: { url: string }) =>
      ipcRenderer.invoke(IPC.MCP_AUTH_DISCONNECT, args),
    authList: (): Promise<string[]> => ipcRenderer.invoke(IPC.MCP_AUTH_LIST),
  },
  voice: {
    get: (): Promise<VoiceSettings> => ipcRenderer.invoke(IPC.VOICE_GET),
    save: (settings: VoiceSettings): Promise<{ ok: true }> =>
      ipcRenderer.invoke(IPC.VOICE_SAVE, settings),
    getStartCreds: (): Promise<VoiceStartCreds> =>
      ipcRenderer.invoke(IPC.VOICE_GET_START_CREDS),
  },
  terminal: {
    spawn: (args: {
      cwd: string;
      cols: number;
      rows: number;
      // Optional initial command — typed into the shell after the
      // prompt is ready. Per-pane terminal workers use this to launch
      // claude / codex / aider / gemini, leaving a real shell behind
      // so the user keeps a working terminal when the CLI exits.
      initialCommand?: string;
    }) => ipcRenderer.invoke(IPC.TERM_SPAWN, args),
    input: (args: { id: string; data: string }) =>
      ipcRenderer.invoke(IPC.TERM_INPUT, args),
    resize: (args: { id: string; cols: number; rows: number }) =>
      ipcRenderer.invoke(IPC.TERM_RESIZE, args),
    kill: (id: string) => ipcRenderer.invoke(IPC.TERM_KILL, id),
    onOutput: (
      listener: (payload: { id: string; data: string }) => void,
    ) => {
      const handler = (
        _e: unknown,
        payload: { id: string; data: string },
      ) => listener(payload);
      ipcRenderer.on(IPC.TERM_OUTPUT, handler);
      return () => ipcRenderer.removeListener(IPC.TERM_OUTPUT, handler);
    },
    onExit: (
      listener: (payload: {
        id: string;
        exitCode: number;
        signal?: number;
      }) => void,
    ) => {
      const handler = (
        _e: unknown,
        payload: { id: string; exitCode: number; signal?: number },
      ) => listener(payload);
      ipcRenderer.on(IPC.TERM_EXIT, handler);
      return () => ipcRenderer.removeListener(IPC.TERM_EXIT, handler);
    },
    listShortcuts: (): Promise<TerminalShortcut[]> =>
      ipcRenderer.invoke(IPC.TERM_SHORTCUTS_LIST),
    saveShortcut: (s: TerminalShortcut): Promise<TerminalShortcut[]> =>
      ipcRenderer.invoke(IPC.TERM_SHORTCUTS_SAVE, s),
    deleteShortcut: (id: string): Promise<TerminalShortcut[]> =>
      ipcRenderer.invoke(IPC.TERM_SHORTCUTS_DELETE, id),
    reorderShortcuts: (ids: string[]): Promise<TerminalShortcut[]> =>
      ipcRenderer.invoke(IPC.TERM_SHORTCUTS_REORDER, ids),
    onShortcutsChanged: (
      listener: (next: TerminalShortcut[]) => void,
    ) => {
      const handler = (_e: unknown, next: TerminalShortcut[]) =>
        listener(next);
      ipcRenderer.on(IPC.TERM_SHORTCUTS_CHANGED, handler);
      return () =>
        ipcRenderer.removeListener(IPC.TERM_SHORTCUTS_CHANGED, handler);
    },
  },
};

contextBridge.exposeInMainWorld('cowork', api);
