import type {
  AgentDef,
  AgentDraft,
  AppState,
  CavemanSettings,
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
  PrDetail,
  PrSummary,
  ReleaseEntry,
  UpdateCheckResult,
  WikiPageMeta,
  WikiStatus,
  ReviewHunk,
  ReviewState,
  SessionEvent,
  SkillDef,
  SkillDraft,
  StartSessionParams,
  TaskTemplate,
  TerminalShortcut,
  TranscriptEntry,
  UsageSummary,
  EditorPreferences,
  VoiceSettings,
  WindowState,
  Workspace,
} from './types';
import type { Platform } from './worker-presets';
import type { RecommendedSkill } from './recommended-skills';

/**
 * Result of asking main for the credential to start an ElevenLabs
 * conversation. Either returns an `agentId` (public agent flow) or a
 * `signedUrl` (private agent flow), or an error message we surface in
 * the sidebar so the user knows what went wrong.
 */
export type VoiceStartCreds =
  | { ok: true; agentId: string }
  | { ok: true; signedUrl: string }
  | { ok: false; error: string };

/**
 * Shape of the preload-exposed API, kept in the shared project so both
 * the preload build (which defines it) and the renderer build (which
 * types `window.cowork`) can reference it without crossing project
 * boundaries.
 */
export interface CoworkApi {
  agents: {
    list(projectDir?: string): Promise<AgentDef[]>;
    save(draft: AgentDraft): Promise<AgentDef>;
    delete(filePath: string): Promise<{ ok: true }>;
    generate(args: { name: string; description: string }): Promise<string>;
    /** Rewrite a short agent description into a richer, role-grounded one
     *  using Haiku. Returns the original input if the model returns nothing. */
    enhanceDescription(args: {
      name: string;
      description: string;
    }): Promise<string>;
    onWatch(listener: () => void): () => void;
  };
  skills: {
    list(projectDir?: string): Promise<SkillDef[]>;
    save(draft: SkillDraft): Promise<SkillDef>;
    delete(filePath: string): Promise<{ ok: true }>;
    /** One-click install of a curated community skill via shallow
     *  git clone into ~/.claude/skills/. Idempotent — subsequent
     *  calls report `alreadyInstalled: true` without doing anything. */
    installRecommended(skill: RecommendedSkill): Promise<
      | { ok: true; alreadyInstalled: boolean; installedAt: string }
      | { ok: false; error: string }
    >;
  };
  session: {
    start(params: StartSessionParams): Promise<{ ok: true }>;
    send(
      paneId: PaneId,
      text: string,
      images?: MessageImage[],
    ): Promise<{ ok: true }>;
    interrupt(paneId: PaneId): Promise<{ ok: true }>;
    stop(paneId: PaneId): Promise<{ ok: true }>;
    onEvent(listener: (event: SessionEvent) => void): () => void;
    onPaneSpawn(
      listener: (payload: PaneSpawnRequest) => void,
    ): () => void;
    onPaneStopRemote(
      listener: (payload: { paneId: PaneId }) => void,
    ): () => void;
  };
  workspace: {
    pickFolder(): Promise<string | null>;
  };
  system: {
    /**
     * Return the listening processes (PID + command) for the port in
     * the given localhost URL. Empty array when nothing is listening.
     */
    portListeners(args: {
      url?: string;
      port?: number;
    }): Promise<Array<{ pid: number; command?: string }>>;
    /**
     * SIGTERM (then SIGKILL) every listener on the port. Used by the
     * Preview picker's kill button.
     */
    killPort(args: {
      url?: string;
      port?: number;
    }): Promise<{
      port: number;
      killed: number[];
      errors: { pid: number; message: string }[];
    }>;
    /** Reveal a folder in Finder (or open a file in its default app). */
    openPath(args: { path: string }): Promise<{ ok: boolean; error?: string }>;
    /**
     * Active git branch for a folder (reads `.git/HEAD` directly), or
     * null when the folder isn't a git repo / HEAD is detached.
     */
    gitBranch(args: { cwd: string }): Promise<string | null>;
    /** Local branches in this repo, current first. */
    gitBranches(args: { cwd: string }): Promise<string[]>;
    /**
     * Create a new git worktree off `parentCwd`. Returns the new
     * worktree's folder path so the renderer can open it as a project.
     */
    worktreeCreate(args: {
      parentCwd: string;
      branchName: string;
      baseBranch: string | 'current';
      copyEnv: boolean;
    }): Promise<{
      worktreeCwd: string;
      branch: string;
      base: string;
      copiedFiles: string[];
    }>;
    /**
     * Remove a worktree. Pass `force: true` to discard uncommitted
     * changes; pass `deleteBranch: '<name>'` to also drop its branch.
     */
    worktreeRemove(args: {
      cwd: string;
      force?: boolean;
      deleteBranch?: string;
    }): Promise<{
      removed: boolean;
      branchDeleted: boolean;
      warnings: string[];
    }>;
    /** Detect whether a folder is a linked worktree and find its parent. */
    worktreeStatus(args: { cwd: string }): Promise<{
      isWorktree: boolean;
      parentCwd?: string;
      branch?: string;
    }>;
    /**
     * Initialize git in a previously-non-git folder. Creates the repo
     * on the user's `init.defaultBranch` (or `main`/`master` fallback)
     * and stages + commits whatever's already there as
     * "Initial commit (via INZONE)" so worktrees can branch off
     * something. Throws if `.git` already exists.
     */
    gitInit(args: { cwd: string }): Promise<{
      branch: string;
      hasInitialCommit: boolean;
      filesCommitted: number;
    }>;
    /**
     * For each command in `commands`, return whether `command -v
     * <name>` succeeds on the user's PATH (with Homebrew paths added
     * back since Electron windows often miss them). Used by the
     * Workers tab to mark CLI presets as installed / not installed.
     */
    checkCommands(args: {
      commands: string[];
    }): Promise<Record<string, boolean>>;
    /**
     * Synchronous host platform getter. Returns one of the standard
     * Node platform values ('darwin', 'win32', 'linux', ...). The
     * renderer uses this to pick platform-specific install commands
     * (Workers tab) and any other UX that branches on OS. We use the
     * shared `Platform` alias so the renderer-side build doesn't
     * need `@types/node`.
     */
    platform(): Platform;
  };
  /**
   * Settings → About page. Surfaces the running app version, a manual
   * "check for updates" trigger that delegates to electron-updater
   * (so a found update lands at the same Restart-now/Later dialog as
   * the background poll), and a parsed view of CHANGELOG.md so the
   * About page can double as in-app release notes.
   */
  about: {
    version(): Promise<string>;
    checkForUpdates(): Promise<UpdateCheckResult>;
    releaseNotes(args?: { limit?: number }): Promise<ReleaseEntry[]>;
  };
  /**
   * Diff Review + PR Workflow APIs. Surfaces git diff inspection plus
   * (in later phases) hunk-level approve/reject, commit, push, and PR
   * creation via the `gh` CLI.
   */
  /**
   * Profile (Settings → Profile) — surfaces auth state for each
   * provider INZONE supports. Currently only Claude is live; the
   * other providers (OpenAI, Gemini) are stubbed in the UI.
   */
  profile: {
    /**
     * Detect the active Claude auth path. Returns method
     * (api-key/subscription/none/unknown) plus email + plan when
     * `claude auth status` is available to enumerate them.
     */
    claudeAuth(): Promise<ClaudeAuthInfo>;
    /**
     * In-app stored API key plumbing. The actual key value never
     * leaves main — the renderer only sees boolean status flags
     * and the result of test calls.
     */
    apiKeyStatus(): Promise<{
      hasStoredKey: boolean;
      envSet: boolean;
      source: 'env-external' | 'stored' | 'env-from-stored' | 'none';
    }>;
    apiKeySave(args: { key: string }): Promise<{ ok: true }>;
    apiKeyClear(): Promise<{ ok: true }>;
    apiKeyTest(args: {
      key: string;
    }): Promise<{ ok: boolean; status?: number; error?: string }>;
  };
  /**
   * AskUserQuestion in-process tool plumbing. Main pushes a `show`
   * event when an agent calls the tool; the renderer renders an
   * inline question card and replies via `answer`, which resolves
   * the pending Promise so the SDK turn unblocks.
   */
  askUserQuestion: {
    onShow(
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
    ): () => void;
    answer(args: {
      requestId: string;
      answer: {
        answers: Array<{ question: string; chosen: string[] }>;
      };
    }): Promise<{ ok: boolean }>;
  };
  review: {
    /**
     * Load the structured diff for a worktree vs. its base branch.
     * Combines committed diff (HEAD vs base merge-base) with working-
     * tree diff (uncommitted changes vs HEAD) into a single ReviewState.
     */
    loadDiff(args: {
      cwd: string;
      baseBranch: string;
      worktreeBranch: string;
    }): Promise<ReviewState>;
    /**
     * Reverse-apply the rejected hunks against the worktree's
     * working tree. Files where every hunk is rejected get a clean
     * `git checkout HEAD --` instead of a partial patch (cheaper +
     * handles add/delete uniformly).
     */
    applyDecisions(args: {
      cwd: string;
      rejectedHunks: ReviewHunk[];
      hunksByFile: Record<string, ReviewHunk[]>;
    }): Promise<{ revertedFiles: string[]; warnings: string[] }>;
    /**
     * Probe whether `gh` is installed + authenticated, and look up
     * the worktree's origin remote (owner/repo + default branch).
     * Surfaces the setup state for the PR modal.
     */
    ghStatus(args: { cwd: string }): Promise<GhStatus>;
    /**
     * List every gh-authed account. Surfaces multi-account setups
     * (personal + work) so the renderer can offer a "Push as"
     * dropdown when the active account doesn't match the repo owner.
     */
    ghAccounts(): Promise<GhAccount[]>;
    /**
     * Switch the active gh account. Used right before push when the
     * user's selected login differs from the currently-active one.
     */
    ghSwitch(args: { login: string }): Promise<{ ok: true }>;
    /**
     * Convert this repo's `origin` remote from SSH to HTTPS. SSH
     * pushes go through ssh-agent and ignore gh credentials, which
     * breaks multi-account switching. After conversion, gh drives
     * the credentials and ghSwitch works as expected.
     */
    remoteToHttps(args: {
      cwd: string;
    }): Promise<{ url: string; changed: boolean }>;
    /**
     * Manual escape hatch — set the repo's origin to an arbitrary
     * URL the user pastes. Useful when auto-detection picks the
     * wrong protocol or the user wants to point at a fork.
     */
    setRemoteUrl(args: {
      cwd: string;
      url: string;
    }): Promise<{ url: string }>;
    /**
     * Stage everything in the worktree and commit it as a single
     * squash commit. Skipped silently when the working tree is
     * already clean (e.g. agent committed its own changes).
     */
    commit(args: {
      cwd: string;
      message: string;
      body?: string;
    }): Promise<{ sha?: string; skipped: boolean }>;
    /**
     * Push the worktree's branch to origin. Sets upstream so
     * subsequent `git push` from the user's terminal works
     * without re-typing -u.
     */
    push(args: {
      cwd: string;
      branch: string;
      setUpstream?: boolean;
    }): Promise<{ ok: true }>;
    /**
     * Ensure `branch` exists on origin. Probes via `ls-remote` and
     * pushes the local ref if not. Used before `gh pr create` so the
     * PR API can resolve the base branch — without this, repos that
     * were init'd locally (where main was never pushed) trip the
     * "Base ref must be a branch" / "No commits between" errors.
     */
    ensureRemoteBranch(args: {
      cwd: string;
      branch: string;
    }): Promise<{ existed: boolean; pushed: boolean }>;
    /**
     * `git pull origin <branch>` in `cwd`. Used in the post-merge
     * wrap-up flow to bring the merged PR commits back to the
     * parent project's checkout. Refuses if the working tree is
     * dirty.
     */
    pull(args: {
      cwd: string;
      branch: string;
    }): Promise<{ ok: true }>;
    /**
     * Run `gh pr create` with the given draft. Reads body from
     * stdin to avoid shell-quoting issues with markdown content.
     * Returns the PR's URL + (when parseable) PR number.
     */
    createPR(args: {
      cwd: string;
      draft: PRDraft;
    }): Promise<{ url: string; number?: number }>;
    /**
     * Ask Claude to draft a PR title + body from the agent's
     * transcript + diff summary. Always resolves — falls back to a
     * generic auto-generated description if Claude misbehaves.
     */
    summarizePR(args: {
      branch: string;
      baseBranch: string;
      files: string[];
      additions: number;
      deletions: number;
      userPrompt?: string;
      agentReply?: string;
    }): Promise<{ title: string; body: string }>;
    /**
     * Merge the worktree's branch into its base in the parent
     * project's working tree. Refuses if the parent has uncommitted
     * changes (would corrupt the merge). Switches the parent to
     * baseBranch if needed before merging.
     */
    localMerge(args: {
      worktreeCwd: string;
      parentCwd: string;
      branch: string;
      baseBranch: string;
    }): Promise<{ sha?: string; fastForward: boolean }>;
  };
  pr: {
    /** List PRs for the repo at `cwd` (most recent 30, any state). */
    list(cwd: string): Promise<PrSummary[]>;
    /** Full detail for one PR (body + checks + comments). */
    detail(cwd: string, number: number): Promise<PrDetail>;
    /** Last `lines` (default 80) of the failed-step output for a
     *  GitHub Actions run id. */
    checkLogs(cwd: string, runId: string, lines?: number): Promise<string>;
    /** Boolean: is gh installed AND authenticated for this repo? */
    available(cwd: string): Promise<boolean>;
    /** v1.5 — Send a PR comment to Haiku for a sanity check before
     *  the user hands it off to a coding agent. Returns a verdict
     *  (good / caution / bad) plus a 1-2 sentence reasoning. */
    validateComment(args: {
      commentBody: string;
      location: string;
      diffHunk?: string;
    }): Promise<{
      verdict: 'good' | 'caution' | 'bad';
      reasoning: string;
    }>;
    /** v1.5 — Draft a friendly summary reply for a PR comment after
     *  the agent made the requested change. Caller passes a snippet
     *  of the agent's recent transcript so the model can describe
     *  what was actually done. Returns suggested reply text the user
     *  can edit before posting. */
    suggestReply(args: {
      commentBody: string;
      location: string;
      agentSummary: string;
    }): Promise<string>;
    /** v1.5 — Post a reply to a PR comment via gh. For review
     *  comments (inline diff), threads under the original via
     *  `/pulls/{n}/comments/{id}/replies`. For issue comments, posts
     *  a new top-level comment via `/issues/{n}/comments`. Returns
     *  the new comment's GitHub URL. */
    postReply(args: {
      cwd: string;
      prNumber: number;
      body: string;
      kind: 'review' | 'issue';
      reviewCommentId?: string;
    }): Promise<{ url: string }>;
  };
  wiki: {
    /** Probe whether <cwd>/.inzone/wiki/ is set up. */
    status(cwd: string): Promise<WikiStatus>;
    /** Idempotent first-run init: create the starter folder, schema,
     *  and skeleton pages. Returns the new status. */
    init(cwd: string): Promise<WikiStatus>;
    /** List every page (excluding cache) for the sidebar tree. */
    listPages(cwd: string): Promise<WikiPageMeta[]>;
    /** Read one page's full markdown contents. */
    readPage(cwd: string, relPath: string): Promise<string>;
    /** Create or overwrite a page. */
    writePage(
      cwd: string,
      relPath: string,
      content: string,
    ): Promise<{ ok: true }>;
    /** Append a chronological entry to log.md. */
    appendLog(cwd: string, entry: string): Promise<{ ok: true }>;
    /** Remove a page. Refuses to delete the schema file. */
    deletePage(cwd: string, relPath: string): Promise<{ ok: true }>;
    /** Case-insensitive substring search across every wiki page.
     *  Returns up to `limit` pages (default 5, max 20) sorted by
     *  match count with a few short snippets each. */
    search(
      cwd: string,
      query: string,
      limit?: number,
    ): Promise<
      Array<{ path: string; count: number; snippets: string[] }>
    >;
  };
  state: {
    get(): Promise<AppState>;
    saveWindow(state: WindowState): Promise<{ ok: true }>;
    deleteWindow(id: string): Promise<{ ok: true }>;
    setActiveSession(id: string | undefined): Promise<{ ok: true }>;
    saveWorkspace(ws: Workspace): Promise<{ ok: true }>;
    /** Persist the user's custom task templates list. We replace the
     *  whole list rather than incremental ops because the renderer
     *  is the source of truth and there are typically only a few. */
    saveCustomTaskTemplates(list: TaskTemplate[]): Promise<{ ok: true }>;
    deleteWorkspace(id: string): Promise<{ ok: true }>;
    setActiveWorkspace(id: string | undefined): Promise<{ ok: true }>;
    loadTranscript(paneId: PaneId): Promise<TranscriptEntry[]>;
    /**
     * Throw away a pane's persisted transcript + saved SDK session-id.
     * Used by the per-pane "Clear session" button — after this the
     * next setPaneAgent / setLeadAgent call starts a brand-new session
     * with no resume state.
     */
    deleteTranscript(paneId: PaneId): Promise<{ ok: true }>;
  };
  usage: {
    summary(windowId?: string): Promise<UsageSummary>;
    onTick(listener: () => void): () => void;
  };
  memory: {
    read(args: {
      scope: 'project' | 'global';
      cwd?: string;
    }): Promise<{ filePath: string; content: string }>;
    write(args: {
      scope: 'project' | 'global';
      cwd?: string;
      content: string;
    }): Promise<{ filePath: string }>;
    ensure(cwd: string): Promise<{ ok: true }>;
  };
  mcp: {
    list(cwd?: string): Promise<McpServerEntry[]>;
    save(args: {
      draft: McpServerDraft;
      cwd?: string;
    }): Promise<McpServerEntry>;
    delete(args: {
      name: string;
      scope: McpScope;
      cwd?: string;
    }): Promise<{ ok: true }>;
    probe(args: { config: McpServerConfig }): Promise<McpProbeResult>;
    /**
     * Run the native OAuth flow for a remote MCP server URL: discovery
     * → DCR → PKCE → localhost callback → token exchange. Tokens get
     * encrypted and stored under the canonical resource URL; future
     * probes/agent sessions reuse them automatically.
     */
    authStart(args: {
      url: string;
      scopes?: string[];
    }): Promise<
      | {
          ok: true;
          result: {
            ok: true;
            resource: string;
            scopes: string[];
            serverIssuer?: string;
            expiresAt?: number;
          };
        }
      | { ok: false; error: string }
    >;
    /** Forget any stored tokens for this URL. */
    authDisconnect(args: { url: string }): Promise<{ ok: true; removed: boolean }>;
    /** Canonical URLs we currently hold tokens for. */
    authList(): Promise<string[]>;
  };
  voice: {
    get(): Promise<VoiceSettings>;
    save(settings: VoiceSettings): Promise<{ ok: true }>;
    getStartCreds(): Promise<VoiceStartCreds>;
  };
  editorPrefs: {
    /** Read the current preferences (vim mode etc.). */
    get(): Promise<EditorPreferences>;
    /** Persist preferences. Triggers an `onChanged` broadcast to every
     *  open INZONE window so multi-window setups stay in sync. */
    save(prefs: EditorPreferences): Promise<{ ok: true }>;
    /** Subscribe to changes. Returns an unsubscribe function. */
    onChanged(listener: (prefs: EditorPreferences) => void): () => void;
  };
  caveman: {
    /** Read the current caveman-mode settings (enabled + level). */
    get(): Promise<CavemanSettings>;
    /** Persist settings. Triggers an `onChanged` broadcast to every
     *  open INZONE window so the Experiments toggle stays in sync.
     *  Effect on agent system prompts applies to the *next*
     *  session start — already-running sessions keep their current
     *  prompt because the SDK doesn't re-inject system prompts on
     *  in-flight turns. */
    save(prefs: CavemanSettings): Promise<{ ok: true }>;
    /** Subscribe to changes. Returns an unsubscribe function. */
    onChanged(listener: (prefs: CavemanSettings) => void): () => void;
  };
  terminal: {
    spawn(args: {
      cwd: string;
      cols: number;
      rows: number;
      /**
       * Optional initial command to type into the shell once it's
       * prompt-ready. Used by per-pane terminal workers (Claude Code,
       * Codex, Aider, Gemini) so the PTY launches the chosen CLI
       * automatically and falls back to a plain shell when the CLI
       * exits.
       */
      initialCommand?: string;
    }): Promise<{ id: string }>;
    input(args: { id: string; data: string }): Promise<{ ok: true }>;
    resize(args: {
      id: string;
      cols: number;
      rows: number;
    }): Promise<{ ok: true }>;
    kill(id: string): Promise<{ ok: true }>;
    onOutput(
      listener: (payload: { id: string; data: string }) => void,
    ): () => void;
    onExit(
      listener: (payload: {
        id: string;
        exitCode: number;
        signal?: number;
      }) => void,
    ): () => void;
    listShortcuts(): Promise<TerminalShortcut[]>;
    saveShortcut(s: TerminalShortcut): Promise<TerminalShortcut[]>;
    deleteShortcut(id: string): Promise<TerminalShortcut[]>;
    reorderShortcuts(ids: string[]): Promise<TerminalShortcut[]>;
    onShortcutsChanged(
      listener: (next: TerminalShortcut[]) => void,
    ): () => void;
  };
}
