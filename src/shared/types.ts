// Shared types used by main, preload, and renderer.

export type PaneId = string;
export type WindowId = string;

/**
 * An agent definition discovered on disk under ~/.claude/agents/*.md
 * or inside a project's .claude/agents directory.
 *
 * INzone runs all agents on Anthropic via the Claude Agent SDK. The SDK
 * picks up either an `ANTHROPIC_API_KEY` env var or the user's
 * `claude login` subscription credentials automatically.
 */
export interface AgentDef {
  /** Unique identifier (name from frontmatter, falling back to filename). */
  name: string;
  /** Short human description from frontmatter. */
  description?: string;
  /** Model hint from frontmatter (e.g. "sonnet", "opus"). Optional. */
  model?: string;
  /** Allowed tools from frontmatter, if restricted. */
  tools?: string[];
  /** Skill names the agent is allowed to use (empty/undefined = none). */
  skills?: string[];
  /**
   * Names of MCP servers (from `~/.claude.json` / `./.mcp.json`) the agent
   * is opted into. `undefined` or `[]` = the agent has no MCP access.
   */
  mcpServers?: string[];
  /** Palette color name (e.g. "sky"). Rendered in the pane header. */
  color?: string;
  /**
   * Optional single emoji character for the agent. Surfaced in pane
   * headers next to the name as a quick visual identifier — e.g. 🦄
   * for "Solo Founder", 🛠️ for a refactoring agent, etc.
   */
  emoji?: string;
  /**
   * Optional one-line "vibe" — a more vivid sibling of `description`.
   * Designed for personality-heavy agents where you want a tagline as
   * well as a formal description. Optional; UI shows whichever is set.
   */
  vibe?: string;
  /** The markdown body (used as system prompt addition). */
  body: string;
  /** Absolute path to the source file. */
  filePath: string;
  /** 'user' (~/.claude) or 'project' (./.claude). */
  scope: 'user' | 'project';
  /** Last-modified time of the source file, in epoch milliseconds.
   *  Captured via fs.stat at parse time so the Agents table can sort
   *  by recency without each row hitting the disk. Optional because
   *  legacy persisted entries may not carry it. */
  modifiedAt?: number;
}

/**
 * A skill discovered at ~/.claude/skills/<name>/SKILL.md.
 * We mostly surface these for display; the SDK autoloads them
 * when settingSources includes 'user'.
 */
export interface SkillDef {
  name: string;
  description?: string;
  body: string;
  filePath: string;
  scope: 'user' | 'project';
}

/** State of a Claude Agent SDK session bound to a pane. */
export type SessionStatus =
  | 'idle'
  | 'starting'
  | 'streaming'
  | 'waiting_for_input'
  | 'error'
  | 'stopped';

/** An image attached to a user message. */
export interface MessageImage {
  /** e.g. "image/png", "image/jpeg" */
  mime: string;
  /** base64-encoded bytes (no data: prefix) */
  base64: string;
  /** original filename for display */
  filename?: string;
}

/** An event streamed from a pane's session to the renderer. */
export type SessionEvent =
  | { kind: 'status'; paneId: PaneId; status: SessionStatus; error?: string }
  | { kind: 'user'; paneId: PaneId; text: string; images?: MessageImage[]; ts: number }
  | { kind: 'assistant_text'; paneId: PaneId; text: string; ts: number }
  | {
      kind: 'tool_use';
      paneId: PaneId;
      toolUseId: string;
      name: string;
      input: unknown;
      ts: number;
    }
  | {
      kind: 'tool_result';
      paneId: PaneId;
      toolUseId: string;
      content: unknown;
      isError?: boolean;
      ts: number;
    }
  | {
      kind: 'result';
      paneId: PaneId;
      subtype: string;
      sessionId?: string;
      durationMs?: number;
      totalCostUsd?: number;
      numTurns?: number;
      ts: number;
    };

/** Configuration to start a session in a pane. */
export interface StartSessionParams {
  paneId: PaneId;
  windowId: WindowId;
  agentName: string;
  cwd: string;
  /** Optional prior session id to resume. */
  resumeSessionId?: string;
  /** Names of other agents currently live in the same window. */
  otherAgentNames?: string[];
  /**
   * If true, this pane's agent is the Lead — it gets orchestrator tools
   * (message_agent, spawn_agent, list_live_agents, stop_agent) and a
   * system prompt addendum explaining its role.
   */
  isLead?: boolean;
  /**
   * If true, the window is currently in Lead mode and this pane is a
   * sub-agent (not the Lead itself). Used to suppress CLAUDE.md injection
   * for sub-agents.
   */
  isSubAgent?: boolean;
  /** CLAUDE.md scope to apply for this session. */
  memoryScope?: MemoryScope;
}

/** Which interaction mode a window is in. */
export type WindowMode = 'multi' | 'lead';

/**
 * Payload the main process sends when the Lead's `spawn_agent` tool
 * calls for a new sub-agent pane to appear in the renderer.
 */
export interface PaneSpawnRequest {
  paneId: PaneId;
  agentName: string;
}

/** Shape of the pane tree inside a window. */
export type PaneNode =
  | {
      kind: 'leaf';
      id: PaneId;
      agentName?: string;
      /**
       * Optional user-set display name for the pane (e.g. "Frontend",
       * "API server"). When unset the UI falls back to "Pane N" where
       * N is the leaf's position in the tree.
       */
      paneName?: string;
      /**
       * What kind of "worker" occupies this pane. Defaults to 'agent'
       * for back-compat with every previously-saved session — those
       * leaves are agent-kind even though the field is missing.
       *
       * 'terminal' kind panes spawn a PTY with `presetId`'s command
       * (see shared/worker-presets) instead of an agent SDK session;
       * `agentName` is ignored on terminal leaves.
       */
      workerKind?: 'agent' | 'terminal';
      /**
       * Which CLI preset spawned this terminal pane (e.g. 'claude-code',
       * 'codex', 'terminal'). Only meaningful when workerKind === 'terminal'.
       * The preset table lives in shared/worker-presets.ts; we store
       * the id (not the command) so renames / command changes flow
       * through to existing panes on next spawn.
       */
      presetId?: string;
    }
  | {
      kind: 'split';
      direction: 'horizontal' | 'vertical';
      children: PaneNode[];
      /** 0-1 sizes for each child, must sum to 100 when scaled. */
      sizes?: number[];
    };

/** Persisted snapshot of the Lead pane (when window is in Lead mode). */
export interface LeadPaneState {
  paneId: PaneId;
  agentName?: string;
  /** Optional user-set name; defaults to "Lead pane" in the UI. */
  paneName?: string;
}

/**
 * How CLAUDE.md should be sourced for a given workspace.
 *
 *  - 'project': inject the file at `<cwd>/CLAUDE.md`.
 *  - 'global':  inject the file at `~/.claude/CLAUDE.md`.
 *  - 'both':    inject project then global, separated by a divider.
 *  - 'none':    skip CLAUDE.md entirely for this workspace.
 */
export type MemoryScope = 'project' | 'global' | 'both' | 'none';

/** Saved workspace preset: folder + tree + agent assignments + window mode. */
export interface WorkspacePreset {
  id: string;
  name: string;
  cwd: string;
  tree: PaneNode;
  /** Multi vs Lead at save time. Defaults to 'multi' if missing. */
  windowMode?: WindowMode;
  /** Lead pane info (only meaningful when windowMode === 'lead'). */
  lead?: LeadPaneState;
  /** CLAUDE.md scope for this workspace. Defaults to 'project'. */
  memoryScope?: MemoryScope;
  createdAt: number;
  updatedAt: number;
}

/**
 * Per-session saved state, restored on launch. INzone surfaces these as
 * "Sessions" in the left sidebar — multiple of them can coexist as tabs
 * inside a single Electron window, each with its own folder, layout,
 * mode, and Lead pane.
 *
 * The type is still called `WindowState` for historical reasons (the
 * persisted JSON file uses `windows: []` as its top-level key), but the
 * UI concept is "session". Treat them as interchangeable.
 */
export interface WindowState {
  id: WindowId;
  /** Human-readable name shown in the sidebar Sessions list. */
  name?: string;
  cwd: string;
  tree: PaneNode;
  /** Multi vs Lead at last save. Defaults to 'multi' if missing. */
  windowMode?: WindowMode;
  /** Lead pane info (only meaningful when windowMode === 'lead'). */
  lead?: LeadPaneState;
  /** CLAUDE.md scope for this workspace. Defaults to 'project'. */
  memoryScope?: MemoryScope;
  /** Map of paneId to last-known session id, for resume. */
  lastSessionIds?: Record<PaneId, string>;
  /**
   * Last URL the user previewed in this session (manual entry or
   * accepted detection). Persists across reloads so the Preview button
   * remembers what you were looking at.
   */
  previewUrl?: string;
  /**
   * Set to true when an agent in this project completes a turn while
   * the user is viewing a different project. Surfaces as a green dot
   * on the project row in the sidebar and (aggregated) on the
   * workspace pill so the user knows where to look. Cleared when the
   * user switches into this project. Not persisted across app
   * restarts — stale on relaunch since agents don't survive.
   */
  hasUnreadCompletion?: boolean;
  /**
   * If this project is a git worktree spawned from another project,
   * this points back at the parent project's id. The sidebar uses it
   * to render the worktree indented under its parent and to surface
   * the right ⋯ menu actions (Remove worktree vs. Branch off…).
   */
  parentProjectId?: string;
  /** The branch this worktree has checked out (only set for worktrees). */
  worktreeBranch?: string;
  /** The base branch this worktree was branched off from. */
  worktreeBase?: string;
  /**
   * Pipeline definition + last run state for the project. Surfaces a
   * board view in the main pane area where the user chains existing
   * panes into a sequential workflow ("step A finishes → step B
   * picks up"). Only meaningful in Multi mode; ignored in Lead mode
   * where the orchestrator handles routing.
   */
  pipeline?: Pipeline;
}

/**
 * Sequential agent workflow definition. Each step references an
 * existing pane in this project; running the pipeline sends each
 * step's prompt to its pane in order, waiting for the previous step
 * to finish before starting the next. The previous step's last
 * assistant message is exposed to the next step's prompt as
 * `{previous}`.
 */
export interface Pipeline {
  /**
   * Ordered steps. Auto-synced with the project's current panes on
   * every entry to the Flow view — stale paneIds get pruned, new
   * panes get appended at the end.
   */
  steps: PipelineStep[];
  /**
   * When `true`, the renderer wires up a flow-advance side effect:
   * any successful `result` event for a pane in `steps` automatically
   * fires the next pane in order with the previous pane's final
   * assistant text as its prompt. When `false`, panes run
   * independently as usual. User toggles this from the Flow board.
   */
  enabled?: boolean;
  /** Optional, deprecated — kept on the type for back-compat with old persisted data. */
  kickoff?: string;
  /** Optional, deprecated — last/current run state from the old runPipeline path. */
  lastRun?: PipelineRun;
}

export interface PipelineStep {
  /** Stable id for keys + drag-drop tracking. */
  id: string;
  /** Pane in this project this step messages. */
  paneId: PaneId;
  /**
   * Prompt sent to the pane when this step runs. May contain the
   * literal `{previous}` placeholder, which gets replaced with the
   * prior step's final assistant text on dispatch.
   * (Currently unused — Flow v2 sends previous output verbatim.)
   */
  prompt: string;
  /**
   * Free-form canvas position, in pixels relative to the flow board's
   * scrollable area. Persisted so the user's hand-arranged layout
   * survives reloads. When missing the renderer falls back to a
   * horizontal row layout based on step index.
   */
  position?: { x: number; y: number };
  /**
   * Optional delay (in ms) inserted before this step fires after the
   * previous step finishes. Default 0 means "right away". UI surfaces
   * a small dropdown of common values: 0 / 1000 / 2000 / 5000.
   */
  delayMs?: number;
}

export interface PipelineRun {
  status: 'running' | 'completed' | 'error' | 'stopped';
  /** Index of the step currently executing (or that errored). */
  currentStepIndex: number;
  startedAt: number;
  finishedAt?: number;
  /** Per-step result, indexed parallel to Pipeline.steps. */
  results: PipelineStepResult[];
  /** When `status === 'error'`, the message that's surfaced in the UI. */
  error?: string;
}

export interface PipelineStepResult {
  /** stepId of the step this result is for (matches PipelineStep.id). */
  stepId: string;
  status: 'pending' | 'running' | 'completed' | 'error';
  /** Final assistant message captured for the {previous} substitution. */
  output?: string;
  /** Per-step error string when `status === 'error'`. */
  error?: string;
  startedAt?: number;
  finishedAt?: number;
}

/**
 * A workspace is a container of projects. Switching workspaces filters
 * the project list in the sidebar — only `projectIds` belonging to the
 * active workspace are surfaced. Each project (a `WindowState`) lives
 * in exactly one workspace; project state (panes, agents) auto-saves
 * to the WindowState itself, so workspaces stay light — they're just
 * an ordered set of project ids plus a name.
 */
export interface Workspace {
  id: string;
  name: string;
  /** Ordered project (session) ids in this workspace. */
  projectIds: string[];
  createdAt: number;
  updatedAt: number;
}

/** Top-level persisted app state. */
export interface AppState {
  windows: WindowState[];
  workspaces: Workspace[];
  /** Which workspace should be active when the app reopens. */
  activeWorkspaceId?: string;
  /** Which entry in `windows` should be active when the app reopens. */
  activeSessionId?: string;
  /**
   * Legacy per-project preset list. Pre-v0.2 (before workspaces became
   * containers), this stored single-project snapshots. We keep it on
   * the type so older state files still parse, but the new UI ignores
   * it and the on-load migration removes it from disk.
   */
  presets?: WorkspacePreset[];
}

/** A single entry in a pane's transcript JSONL file. */
export type TranscriptEntry = Exclude<
  SessionEvent,
  { kind: 'status' }
>;

/**
 * One recorded turn's worth of usage, appended to disk on every
 * session `result` event so totals survive app restarts and pane churn.
 */
export interface UsageEvent {
  ts: number;
  paneId: PaneId;
  windowId: WindowId;
  agentName: string;
  model?: string;
  /** result subtype: 'success', 'error_max_turns', etc. */
  subtype: string;
  costUsd?: number;
  durationMs?: number;
  numTurns?: number;
  sessionId?: string;
}

/** Aggregated view computed from the ledger. */
export interface UsageSummary {
  totalCostUsd: number;
  totalTurns: number;
  todayCostUsd: number;
  todayTurns: number;
  last7DaysCostUsd: number;
  byDay: Array<{ day: string; costUsd: number; turns: number }>;
  byAgent: Array<{ agent: string; costUsd: number; turns: number }>;
  byModel: Array<{ model: string; costUsd: number; turns: number }>;
}

/**
 * Editable agent payload. `originalFilePath` is set when updating an
 * existing agent; if the name changes the old file is renamed.
 */
export interface AgentDraft {
  name: string;
  description?: string;
  model?: string;
  tools?: string[];
  skills?: string[];
  mcpServers?: string[];
  color?: string;
  emoji?: string;
  vibe?: string;
  body: string;
  scope: 'user' | 'project';
  originalFilePath?: string;
  /** When creating a NEW project-scoped agent (no originalFilePath
   *  to derive the folder from), the renderer must pass the active
   *  project's cwd so the main process knows where to write
   *  `<cwd>/.claude/agents/<name>.md`. Ignored for user-scoped saves
   *  and for edits of existing project agents (where the location is
   *  inferred from `originalFilePath`). */
  projectCwd?: string;
}

/**
 * Editable skill payload. Skills live as folders under ~/.claude/skills/
 * containing a SKILL.md file; renaming a skill renames its folder.
 */
export interface SkillDraft {
  name: string;
  description?: string;
  body: string;
  scope: 'user' | 'project';
  originalFilePath?: string;
  /** Same as AgentDraft.projectCwd — required only when creating a
   *  NEW project-scoped skill where there's no original path to
   *  derive the folder from. */
  projectCwd?: string;
}

/**
 * Voice agent settings. Stored locally; the API key only ever leaves the
 * machine to mint a signed URL with ElevenLabs's REST API at session
 * start. Empty values disable the voice section.
 */
export interface VoiceSettings {
  /** ElevenLabs API key (xi-api-key). Optional for public agents. */
  apiKey?: string;
  /** ElevenLabs Conversational AI Agent ID. */
  agentId?: string;
}

/**
 * One quick-action button shown above the in-app terminal. Clicking
 * sends `command + \r` to the active PTY (types and runs).
 */
export interface TerminalShortcut {
  id: string;
  /** Label printed on the button (e.g. "Run Serve"). */
  title: string;
  /** Shell command to send (e.g. "npx serve"). */
  command: string;
}

/**
 * One MCP server's connection info. Matches the shape the Claude Agent
 * SDK and Claude Code CLI both accept under `mcpServers.<name>` in
 * `~/.claude.json` and `<cwd>/.mcp.json`.
 */
export type McpServerConfig =
  | {
      type: 'stdio';
      command: string;
      args?: string[];
      env?: Record<string, string>;
    }
  | {
      type: 'sse';
      url: string;
      headers?: Record<string, string>;
    }
  | {
      type: 'http';
      url: string;
      headers?: Record<string, string>;
    };

/**
 * Where a given MCP server config came from.
 *
 * - `user`     — `~/.claude.json` `mcpServers` (top-level, every workspace)
 * - `project`  — current workspace's `<cwd>/.mcp.json` *or*
 *                `~/.claude.json` `projects[<cwd>].mcpServers`
 * - `project-other` — `~/.claude.json` `projects[<other>].mcpServers` for
 *                a project folder *other than* the current cwd. Surfaced
 *                so users can see everything Claude Code knows about,
 *                even when it isn't active in this workspace.
 */
export type McpScope = 'user' | 'project' | 'project-other';

/** A configured MCP server, augmented with provenance for the UI. */
export interface McpServerEntry {
  name: string;
  scope: McpScope;
  /** Absolute path of the file this entry lives in. */
  filePath: string;
  /**
   * For `project-other` entries: the project folder this entry was
   * configured for (the key in `~/.claude.json` `projects.*`). UI uses
   * this so the user can tell which workspace it belongs to.
   */
  projectPath?: string;
  config: McpServerConfig;
}

/** Editable MCP entry payload sent from renderer -> main on save. */
export interface McpServerDraft {
  name: string;
  scope: McpScope;
  config: McpServerConfig;
  /** Original name when editing — set so a rename removes the old entry. */
  originalName?: string;
}

/**
 * Result of a one-shot connection probe against an MCP server. We do a
 * minimal `initialize` handshake (matching the MCP spec) and report
 * whether it answered. `tools` is the count returned by `tools/list`
 * when the handshake succeeded — matches what `/mcp` shows in the CLI.
 */
export interface McpProbeResult {
  ok: boolean;
  /** Short human-readable error if `ok === false`. */
  error?: string;
  /** Tools advertised by the server after initialize, when known. */
  tools?: number;
  /** Server-reported name/version, when the handshake returned them. */
  serverName?: string;
  serverVersion?: string;
  /** ms it took the probe to complete. */
  durationMs?: number;
}

// ── Diff Review + PR Workflow ───────────────────────────────────────
// The "review" feature lets the user inspect the changes an agent
// made inside a worktree, accept or reject individual hunks, and
// either ship the result as a GitHub PR (via `gh`) or merge locally
// into the parent branch. These types model that pipeline end-to-end.

/** Status flag for a file in a diff. */
export type ReviewFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed';

/** A single file's high-level change record (path + counts). */
export interface ReviewFile {
  /** Repo-relative path (post-rename if renamed). */
  path: string;
  /** Original path, only set for renames. */
  oldPath?: string;
  status: ReviewFileStatus;
  /** Number of added lines (sum across all hunks of this file). */
  additions: number;
  /** Number of removed lines. */
  deletions: number;
  /** Stable hunk ids belonging to this file, in source order. */
  hunkIds: string[];
  /** True when the file is binary — we can't show a textual diff. */
  binary?: boolean;
}

/** A single hunk inside a file's diff (one `@@ ... @@` section). */
export interface ReviewHunk {
  /** Stable id ("<file>:<oldStart>:<newStart>"). Used as the dictionary key
   *  for per-hunk decisions in the store. */
  id: string;
  /** Owning file's path (matches a ReviewFile.path). */
  file: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  /** Header line ("@@ -1,3 +1,5 @@ functionName(…)"). */
  header: string;
  /** Raw diff body for this hunk (lines starting with ' ', '+', '-'). */
  content: string;
}

/** User's decision on a single hunk. */
export type HunkDecision = 'pending' | 'approve' | 'reject';

/** Snapshot of a worktree's diff vs. its parent branch — what the
 *  Review view renders. Built by the main process on every loadDiff
 *  IPC call; the renderer holds the latest one in store state. */
export interface ReviewState {
  /** Branch under review. */
  worktreeBranch: string;
  /** Branch we're diffing against (typically `main` or the original
   *  branch the worktree was forked from). */
  baseBranch: string;
  /** Files changed, in stable order. */
  files: ReviewFile[];
  /** All hunks across all files, indexed by id for cheap lookup. */
  hunksById: Record<string, ReviewHunk>;
  /** True if the worktree's working tree has uncommitted changes
   *  beyond what HEAD already reflects. We use the working-tree diff
   *  vs. base, so this is informational only. */
  isDirty: boolean;
  /** Set when the diff is empty — nothing to review. */
  isEmpty: boolean;
  /** Total lines added across all files. */
  totalAdditions: number;
  /** Total lines removed across all files. */
  totalDeletions: number;
}

/** PR description payload sent to `gh pr create`. The renderer can
 *  edit any field before submission. */
export interface PRDraft {
  baseBranch: string;
  headBranch: string;
  title: string;
  body: string;
  /** Open as a draft PR? Defaults to false. */
  draft?: boolean;
}

/** Detection of what's available to ship a PR with — we prefer the
 *  `gh` CLI when present + authenticated, otherwise fall back to a
 *  user-supplied PAT (Phase 4). */
export interface GhStatus {
  /** `gh` binary on PATH? */
  installed: boolean;
  /** `gh auth status` returned authenticated? */
  authenticated: boolean;
  /** "owner/repo" parsed from the worktree's `origin` remote, if any. */
  repoSlug?: string;
  /** Default branch reported by the remote (used as PR base default). */
  defaultBranch?: string;
  /** Protocol of the origin remote URL. SSH means git push goes
   *  through ssh-agent (gh auth switch can't influence it); HTTPS
   *  means gh credentials drive the push. Surfaces a "switch to
   *  HTTPS" affordance when SSH is detected with multiple gh accounts. */
  remoteProtocol?: 'ssh' | 'https' | 'other';
  /** Raw origin remote URL — useful for display. */
  remoteUrl?: string;
}

/**
 * Claude auth detection surfaced in Settings → Profile. Mirrors the
 * SDK's resolution order: ANTHROPIC_API_KEY env var first, falling
 * back to `claude login` subscription credentials. Driven by the
 * main-process detector in src/main/claude-auth.ts.
 */
export interface ClaudeAuthInfo {
  method: 'api-key' | 'subscription' | 'none' | 'unknown';
  email?: string;
  plan?: string;
  cliInstalled: boolean;
  raw?: string;
}

/** A single gh-authed account. Users with multiple GitHub accounts
 *  (personal + work) end up with several entries; only one is active
 *  at a time. The PR modal uses this list to surface a "Push as"
 *  dropdown so the right credentials get picked up. */
export interface GhAccount {
  /** GitHub username. */
  login: string;
  /** True for the currently-active account (the one git push will
   *  use as its credentials when gh is the credential helper). */
  active: boolean;
}

// ─────────────────────────────────────────────────────────────────────
//  Pull request inbox
//
//  INZONE shows GitHub pull requests for the current project so the
//  diff → PR → review → fix loop never has to leave the app. All
//  data is sourced from `gh` CLI (`gh pr list`, `gh pr view`,
//  `gh pr checks`, `gh run view`) — re-using the auth the user has
//  already set up rather than introducing a separate OAuth flow.
//  See src/main/pr.ts for the gh wrappers.
// ─────────────────────────────────────────────────────────────────────

/** High-level state surfaced in the PR pill / list view. The "merged"
 *  state is distinct from "closed" — gh exposes both. */
export type PrState = 'open' | 'closed' | 'merged';

/** GitHub's reviewDecision aggregated from the PR's reviewers. */
export type PrReviewDecision =
  | 'APPROVED'
  | 'CHANGES_REQUESTED'
  | 'REVIEW_REQUIRED'
  | 'COMMENTED';

/** Aggregate state of a single check run on the PR head commit.
 *  Maps gh's separate `state` (queued/in_progress/completed) and
 *  `conclusion` (success/failure/skipped/...) into one terminal
 *  enum the UI can paint without doing the join. */
export type CheckState =
  | 'pending'
  | 'running'
  | 'success'
  | 'failure'
  | 'skipped'
  | 'cancelled'
  | 'unknown';

export interface CheckRun {
  /** Display name from the workflow (e.g. "Continuous integration / Lint"). */
  name: string;
  state: CheckState;
  /** Human-readable conclusion verbatim from gh, if any (e.g.
   *  "neutral", "action_required"). Mostly for tooltip detail. */
  conclusion?: string;
  /** Direct URL to the run on GitHub — used by the "Open on GitHub"
   *  button when the user wants the full log. */
  detailsUrl?: string;
  /** Numeric run id for `gh run view <id> --log-failed`. */
  runId?: string;
  startedAt?: string;
  completedAt?: string;
  /** Optional duration string already formatted by gh ("2m 14s"). */
  durationLabel?: string;
}

/** Lightweight PR row — what the list view renders, what the polling
 *  refresh fetches en masse. Detail data (full body, comments,
 *  per-check logs) is loaded lazily when the user opens a PR. */
export interface PrSummary {
  number: number;
  title: string;
  url: string;
  state: PrState;
  isDraft: boolean;
  /** Branch the PR is FROM (e.g. "feature/checkout-redesign"). */
  headRef: string;
  /** Branch the PR is INTO (e.g. "main"). */
  baseRef: string;
  /** Login of the PR author. */
  author: string;
  reviewDecision?: PrReviewDecision;
  /** Aggregate check counts so the list can paint a single status
   *  pill without re-walking the array. */
  checksTotal: number;
  checksPassed: number;
  checksFailed: number;
  checksPending: number;
  /** Total of issue-level + review comments. Used for the comment
   *  badge on the PR card. */
  commentCount: number;
  /** ISO timestamp of the most recent activity. */
  updatedAt: string;
  /** ISO timestamp of when the PR was created. */
  createdAt: string;
  /** GitHub mergeable state — useful as a hint when the user is
   *  about to merge. Optional because gh sometimes returns null
   *  while it computes. */
  mergeable?: 'MERGEABLE' | 'CONFLICTING' | 'UNKNOWN';
}

/** Top-level PR comment (issue comment) — the conversation tab on
 *  GitHub. Distinct from review comments, which live on diff lines. */
export interface PrComment {
  id: string;
  author: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
  url: string;
}

/** Inline review comment on a specific file + line. The diff hunk
 *  field is what GitHub renders as the 3-line code preview; we keep
 *  it here so the UI can show the same context. */
export interface PrReviewComment {
  id: string;
  author: string;
  body: string;
  /** File path relative to repo root. */
  path: string;
  /** Resolved line number in the new file (gh's `line`). May be
   *  absent for outdated comments where the line no longer exists. */
  line?: number;
  /** Original GitHub diff hunk — multi-line string starting with
   *  @@ markers. Rendered verbatim above the comment. */
  diffHunk?: string;
  createdAt: string;
  updatedAt?: string;
  url: string;
  /** ID of the parent comment if this one is a reply. */
  inReplyTo?: string;
}

/** Full detail loaded when the user opens a specific PR. Extends the
 *  summary with the heavyweight stuff: body, full check list with
 *  details urls, and both comment kinds. */
export interface PrDetail extends PrSummary {
  /** Markdown body of the PR description. */
  body: string;
  checks: CheckRun[];
  comments: PrComment[];
  reviewComments: PrReviewComment[];
}

/** Last-fetched PR list for a project, plus sync metadata for the
 *  refresh button + "last synced N min ago" label. Lives at the top
 *  level of the renderer store, keyed by project id, so switching
 *  projects shows whatever was cached for the new one immediately
 *  while a fresh poll runs in the background. */
export interface PrInbox {
  /** ISO timestamp of when this snapshot was fetched. */
  syncedAt: number;
  prs: PrSummary[];
  /** True while a fetch is in flight. Used to show a spinner on the
   *  refresh button and gray the list. */
  syncing: boolean;
  /** Most recent error from the gh wrapper, surfaced as a banner.
   *  Cleared on successful sync. */
  error?: string;
  /** True if `gh` is missing or unauthenticated for this repo. The
   *  UI uses this to render an inline "install gh" / "gh auth login"
   *  hint instead of an opaque error. */
  notAvailable?: boolean;
}

// ─────────────────────────────────────────────────────────────────────
//  LLM Wiki — Karpathy-style persistent project knowledge base
//
//  Lives at <project>/.inzone/wiki/ — a folder of markdown pages the
//  LLM owns and maintains. Three layers:
//    1. Raw sources — the codebase itself (immutable from wiki's POV).
//    2. The wiki    — markdown pages, cross-linked with [[wikilinks]],
//                     each page lists its provenance (cited source
//                     files / commits) so we can detect staleness.
//    3. The schema  — wiki-schema.md, the contract that turns the LLM
//                     into a disciplined wiki maintainer.
//
//  See src/main/wiki.ts for file ops + safety guards.
// ─────────────────────────────────────────────────────────────────────

/** One page in the wiki — metadata only (no body). Returned by the
 *  list-pages call so the UI can render a tree without loading every
 *  page's content. */
export interface WikiPageMeta {
  /** Path relative to the wiki root (e.g. "decisions/api-versioning.md"
   *  or "log.md"). Always uses forward slashes regardless of OS. */
  path: string;
  /** Just the filename (e.g. "api-versioning.md"). */
  name: string;
  /** Size in bytes, for "this page is huge" hints. */
  bytes: number;
  /** ISO timestamp of last filesystem mtime. */
  modifiedAt: string;
  /** True for the schema page itself, so the UI can show it
   *  differently (it's not a content page; it's the contract). */
  isSchema: boolean;
}

/** Result of initializing or probing a wiki. Always returned — the UI
 *  decides whether to show "Welcome, set up the wiki?" or live data
 *  based on `initialized`. */
export interface WikiStatus {
  initialized: boolean;
  /** Absolute path to the wiki root, even when not yet initialized
   *  — the UI shows it as a hint ("will be created at …"). */
  rootPath: string;
  /** Total page count (excluding the cache directory). */
  pageCount: number;
  /** ISO timestamp of the most-recent page mtime, for "last updated"
   *  display. Undefined when there are no pages yet. */
  lastUpdatedAt?: string;
  /** True once log.md has at least one `ingest`-typed entry beyond
   *  the initial bootstrap marker — i.e. an agent has actually
   *  populated the wiki with grounded content at least once. The UI
   *  uses this to retire the prominent "Scan project" CTA: after the
   *  first real ingest, inline auto-update from agent turns keeps the
   *  wiki current, so the big button becomes redundant chrome.
   *  False before the first ingest, false when the wiki isn't
   *  initialized at all. */
  hasIngested: boolean;
  /** ISO date (YYYY-MM-DD) of the most-recent `ingest` entry in
   *  log.md, parsed from the entry header. Undefined when no ingest
   *  has happened yet. Drives the dashboard strip's "last ingest"
   *  field. */
  lastIngestAt?: string;
  /** Most-recent log entries (any type), newest first. Capped at
   *  WIKI_RECENT_ENTRIES_MAX in the main process so the IPC payload
   *  stays bounded as the log grows. The dashboard uses these to
   *  render the expanded "recent activity" panel without a second
   *  IPC round trip. */
  recentEntries: WikiLogEntry[];
}

/** One parsed entry from log.md. The schema asks the LLM to format
 *  entries with a header line `## [YYYY-MM-DD] <type> | <title>`;
 *  `body` collects everything between this entry's header and the
 *  next, with surrounding whitespace trimmed. We don't lex sub-bullets
 *  or otherwise structure the body — the dashboard renders it as
 *  pre-wrapped text. */
export interface WikiLogEntry {
  /** YYYY-MM-DD as it appeared in the header, trimmed. */
  date: string;
  /** init | ingest | edit | lint | query | decide | ... */
  type: string;
  /** Short title from after the `|` separator. */
  title: string;
  /** Body lines following the header (excluding sub-headers
   *  belonging to the same entry are NOT split — body keeps the
   *  whole block verbatim). Trimmed; may be empty. */
  body: string;
}

/* ------------------------------------------------------------------- */
/* Settings → About                                                    */
/* ------------------------------------------------------------------- */

/** One bullet from a parsed CHANGELOG.md release section. The first
 *  sentence (terminated by `.`, `?`, `!`, or `:`) becomes `title` so
 *  the renderer can display it as a clickable summary; remaining
 *  prose lands in `body`. Empty `body` means the bullet was a single
 *  sentence. */
export interface ReleaseItem {
  title: string;
  body: string;
}

/** Group of bullets under one `### Heading` (Added | Changed | Fixed |
 *  Removed | Deprecated | Security) inside a release entry. The
 *  heading is preserved verbatim so the renderer can colour or icon
 *  by type. */
export interface ReleaseSection {
  heading: string;
  items: ReleaseItem[];
}

/** One CHANGELOG release entry, e.g. `## [1.5.1] — 2026-05-06`. The
 *  About page renders these as collapsible cards. */
export interface ReleaseEntry {
  version: string;
  /** ISO `YYYY-MM-DD` when supplied in the CHANGELOG header; empty
   *  string when the header was version-only. */
  date: string;
  sections: ReleaseSection[];
}

/** Result of a manual "Check for updates" tap in the About page.
 *  electron-updater drives the actual download + restart dialog so
 *  this object only needs to express *whether* a newer version was
 *  found, not the bytes-transferred state.
 *
 *  status values:
 *   - 'current' — running the latest available
 *   - 'available' — a newer version exists; auto-update.ts handles
 *     download progress + the Restart now / Later prompt
 *   - 'downloading' — currently fetching (rare in this flow)
 *   - 'ready' — download finished, awaiting restart
 *   - 'error' — the check itself failed (network etc.)
 *
 *  `devMode: true` means the app is unpackaged and the updater is
 *  intentionally inert — the renderer should show a "Updates disabled
 *  in dev" affordance instead of a check button. */
export interface UpdateCheckResult {
  status: 'current' | 'available' | 'downloading' | 'ready' | 'error';
  currentVersion: string;
  latestVersion?: string;
  error?: string;
  devMode?: boolean;
}
