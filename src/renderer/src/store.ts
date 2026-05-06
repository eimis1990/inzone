import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { playErrorTone, playSuccessChime } from './chime';
import { destroyTerminalSession } from './components/terminal-sessions';
import type {
  AgentDef,
  AgentDraft,
  MemoryScope,
  MessageImage,
  PaneId,
  PaneNode,
  PaneSpawnRequest,
  Pipeline,
  PipelineRun,
  PipelineStep,
  PipelineStepResult,
  SessionEvent,
  SessionStatus,
  SkillDef,
  SkillDraft,
  UsageSummary,
  WindowId,
  WindowMode,
  WindowState,
  Workspace,
} from '@shared/types';

/**
 * Strip Electron's IPC wrapper from a thrown error so the user-facing
 * message is just our friendly text. Errors that bubble out of
 * ipcMain.handle come back to the renderer wrapped like:
 *   "Error invoking remote method 'pr:list': GhError: <our message>"
 * We strip everything up to and including the last ":" before our
 * actual message.
 */
function cleanIpcError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Match "Error invoking remote method '...': SomeErrorName: <rest>"
  const m = raw.match(
    /^Error invoking remote method '[^']+':\s*(?:\w+Error:\s*)?(.+)$/s,
  );
  return (m ? m[1] : raw).trim();
}

// ── PR comment dispatch persistence ─────────────────────────────────
// We store the "I sent this comment to that pane at this timestamp"
// records in localStorage so they survive an app restart. The map is
// small (capped at MAX_PR_COMMENT_DISPATCHES) and deserialising on
// boot is microsecond-cheap. Without this, hitting a usage-limit pause
// + restarting the app cleared the dispatch in memory and the Reply
// button stayed disabled even though the agent had finished its work.

const PR_COMMENT_DISPATCHES_KEY = 'inzone.prCommentDispatches.v1';
const MAX_PR_COMMENT_DISPATCHES = 100;

function loadPrCommentDispatches(): Record<
  string,
  { paneId: PaneId; sentAt: number }
> {
  try {
    const raw = localStorage.getItem(PR_COMMENT_DISPATCHES_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, { paneId: PaneId; sentAt: number }> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      const entry = v as { paneId?: unknown; sentAt?: unknown };
      if (
        typeof entry?.paneId === 'string' &&
        typeof entry?.sentAt === 'number'
      ) {
        out[k] = { paneId: entry.paneId, sentAt: entry.sentAt };
      }
    }
    return out;
  } catch {
    // Corrupt JSON, quota exceeded, or storage disabled — start fresh.
    return {};
  }
}

function savePrCommentDispatches(
  map: Record<string, { paneId: PaneId; sentAt: number }>,
): void {
  try {
    localStorage.setItem(PR_COMMENT_DISPATCHES_KEY, JSON.stringify(map));
  } catch {
    // Storage full or unavailable — best-effort. The in-memory copy
    // still works for the rest of the session.
  }
}

export type EditorDraft =
  | { kind: 'agent'; draft: AgentDraft }
  | { kind: 'skill'; draft: SkillDraft };

/** A single rendered item in a pane's chat stream. */
export type ChatItem =
  | {
      id: string;
      kind: 'user';
      text: string;
      images?: MessageImage[];
      ts: number;
    }
  | { id: string; kind: 'assistant_text'; text: string; ts: number }
  | {
      id: string;
      kind: 'tool_use';
      toolUseId: string;
      name: string;
      input: unknown;
      ts: number;
    }
  | {
      id: string;
      kind: 'tool_result';
      toolUseId: string;
      content: unknown;
      isError?: boolean;
      ts: number;
    }
  | {
      id: string;
      kind: 'result';
      subtype: string;
      durationMs?: number;
      totalCostUsd?: number;
      numTurns?: number;
      ts: number;
    }
  /**
   * Synthetic item: an AskUserQuestion form. Inserted into the pane's
   * chat stream when main pushes a SHOW event for that pane. The
   * renderer collects answers locally and submits to main via
   * cowork.askUserQuestion.answer; the resulting tool_result then
   * arrives via the regular session-event stream and the agent
   * continues.
   */
  | {
      id: string;
      kind: 'ask_user_question';
      requestId: string;
      questions: Array<{
        question: string;
        header?: string;
        options: Array<{ label: string; description?: string }>;
        multiSelect?: boolean;
      }>;
      /** Filled in once the user submits. Until then this is undefined. */
      answers?: Array<{ question: string; chosen: string[] }>;
      ts: number;
    };

export interface PaneRuntime {
  id: PaneId;
  agentName?: string;
  status: SessionStatus;
  error?: string;
  items: ChatItem[];
  sessionId?: string;
  /**
   * What occupies this pane. 'agent' (default) is the legacy chat
   * pane; 'terminal' means a CLI worker preset (Claude Code, Codex,
   * Aider, Gemini, plain shell) — `agentName`/`items`/`sessionId`
   * are unused for terminal kind. Mirrored on the persisted tree
   * leaf so a saved session restores its pane mix correctly.
   */
  workerKind?: 'agent' | 'terminal';
  /**
   * For terminal-kind panes: which preset spawned this PTY
   * (matches WorkerPresetId). The pane header reads this to label
   * itself; respawning a killed PTY uses the preset's command.
   */
  presetId?: string;
  /**
   * Live PTY id for terminal-kind panes. Set when TerminalPane
   * mounts and successfully spawns a shell; cleared on unmount /
   * pane close. Don't persist this — PTY ids are ephemeral and a
   * stored value would dangle on next launch.
   */
  ptyId?: string;
}

interface StoreState {
  /**
   * Session id of the currently rendered session. Same value as
   * `activeSessionId`; kept under the historical `windowId` name because
   * many places (StartSessionParams, lead-tools, usage ledger) still
   * use that label.
   */
  windowId: string;
  cwd: string | null;
  tree: PaneNode;
  activePaneId: PaneId | null;
  panes: Record<PaneId, PaneRuntime>;
  agents: AgentDef[];
  skills: SkillDef[];
  /**
   * All workspaces known to the app. Each workspace is a container of
   * project ids — switching workspaces filters which sessions show up
   * in the sidebar.
   */
  workspaces: Workspace[];
  /** The currently-active workspace id; null only on first launch. */
  activeWorkspaceId: string | null;
  /**
   * Every session known to the app (the persisted `windows[]` array).
   * Top-level fields (cwd/tree/windowMode/etc.) mirror whichever entry
   * matches `windowId` — switching sessions copies state in and out.
   * The sidebar filters this list by the active workspace's projectIds.
   */
  sessions: WindowState[];
  editor: EditorDraft | null;
  editorError?: string;
  editorSaving?: boolean;
  sidebarCollapsed: boolean;
  soundEnabled: boolean;
  windowMode: WindowMode;
  /** Pane id of the Lead agent when windowMode === 'lead'. */
  leadPaneId: PaneId | null;
  /**
   * Optional user-set display name for the Lead pane. Lives outside
   * the main tree (the Lead is rendered as a separate top pane), so
   * we can't piggyback on `PaneNode.paneName` for it.
   */
  leadPaneName: string | null;
  /** CLAUDE.md scope for the current window. Defaults to 'project'. */
  memoryScope: MemoryScope;
  usage: UsageSummary | null;
  /**
   * URL the active session's Preview window is pointed at (manual or
   * detection-accepted). Persists per session via WindowState.previewUrl.
   */
  previewUrl: string | null;
  /** Whether the Preview modal is open right now (transient). */
  previewOpen: boolean;
  /** Whether the Mission Control overlay is open. Spans every project
   *  across the workspace — a top-level "what's running everywhere"
   *  view. Transient; never persisted. */
  missionControlOpen: boolean;

  // ── Pull request inbox ─────────────────────────────────────────
  /** Cached PR snapshots, keyed by project (windowId). The active
   *  project polls every 5 minutes (paused when window blurs);
   *  inactive projects keep whatever was cached on their last
   *  switch-out. Transient; never persisted to disk. */
  prInboxes: Record<WindowId, import('@shared/types').PrInbox>;
  /** Fully-loaded detail for one PR, fetched lazily when the user
   *  opens a PR card. Keyed by PR number (per active project). */
  prDetail: import('@shared/types').PrDetail | null;
  /** Loading flag for the lazy detail fetch above. */
  prDetailLoading: boolean;
  /** Most recent fetch error for the detail call (banner above the
   *  detail body until cleared by next successful fetch). */
  prDetailError: string | null;
  /** Whether the PR modal/overlay is open. Transient. */
  prModalOpen: boolean;
  /** Loaded log buffer for a check run, plus loading + error state.
   *  Cleared between check selections. */
  prCheckLog:
    | { runId: string; text: string }
    | null;
  prCheckLogLoading: boolean;
  prCheckLogError: string | null;

  /**
   * Cache of fully-loaded PR details, keyed by PR number for the
   * active project. Warmed in the background by refreshPrs() so the
   * detail view opens instantly when the user clicks a card.
   * Re-fetched on a per-PR basis when the list reports a newer
   * `updatedAt` than the cached snapshot. Cleared on session switch.
   */
  prDetails: Record<number, import('@shared/types').PrDetail>;
  /**
   * Cache of failed-step logs, keyed by GitHub Actions run id. Logs
   * don't change for a given run id (the id changes on re-run), so
   * caching is straightforward and large.
   */
  prCheckLogs: Record<string, string>;

  /**
   * v1.5 — Records each PR comment that's been dispatched via
   * "Send to agent": which pane received the prompt, and the
   * timestamp of dispatch. The Reply composer reads this map to
   * decide which pane's transcript to summarise (and from which
   * point in time) when drafting a reply, instead of guessing
   * based on the currently focused pane (which often points at
   * unrelated work). Keyed by GitHub comment id (string). Items
   * stay around until the PR drawer is closed and re-opened — the
   * user might want to re-reply if the agent keeps iterating.
   */
  prCommentDispatches: Record<
    string,
    { paneId: PaneId; sentAt: number }
  >;

  /**
   * One-shot "seed text" delivery to a specific pane's composer.
   * The Send-to-agent flow drops a prepared prompt here; the
   * targeted Pane component watches this field and copies the text
   * into its local input state, then clears the slot. Tracking it
   * as state rather than an event lets us avoid race conditions on
   * mount + makes it inspectable while debugging.
   */
  pendingPaneSeed: { paneId: PaneId; text: string; nonce: number } | null;
  /**
   * Which view the project's main area is showing — the regular pane
   * tree, the pipeline board, or the diff Review view. Transient;
   * resets to 'panes' on app launch so users don't get surprised by
   * any non-pane view on startup.
   */
  pipelineView: 'panes' | 'board' | 'review';
  /**
   * Latest loaded diff for the active worktree project. Cleared when
   * leaving review view or switching projects. Loaded on demand by
   * `loadReview()`.
   */
  reviewState: import('@shared/types').ReviewState | undefined;
  /** Loading flag — true while loadReview() is awaiting the IPC. */
  reviewLoading: boolean;
  /** Error from the most recent loadReview() attempt, if any. */
  reviewError: string | null;
  /** Currently-selected file path in the review view. Drives the
   *  diff viewer's right-pane content. */
  reviewSelectedFile: string | null;
  /** Per-hunk decisions: 'pending' (default), 'approve', or 'reject'.
   *  Keyed by hunk id. Cleared on reload + on project switch. */
  reviewHunkDecisions: Record<string, 'pending' | 'approve' | 'reject'>;
  /** True while applyDecisions() is talking to git. */
  reviewApplying: boolean;
  /** Cached `gh` detection result — `null` until first probe. */
  ghStatus: import('@shared/types').GhStatus | null;
  /** Cached list of gh-authed accounts — populated on PR modal open
   *  alongside ghStatus. Empty array when gh isn't installed. */
  ghAccounts: import('@shared/types').GhAccount[];
  /** PR-creation workflow status. */
  prWorkflowStatus:
    | 'idle'
    | 'committing'
    | 'pushing'
    | 'creating-pr'
    | 'done'
    | 'error';
  /** Last PR creation result (URL + number) — set on success. */
  prResult: { url: string; number?: number } | null;
  /** Last PR creation error message — set on failure. */
  prError: string | null;
  /** Post-merge wrap-up workflow status. */
  wrapUpStatus:
    | 'idle'
    | 'pulling'
    | 'removing'
    | 'done'
    | 'error';
  /** Last wrap-up error message — set on failure. */
  wrapUpError: string | null;
  /** Local-merge workflow status (parallel to PR workflow but
   *  smaller — no push step, no PR creation). */
  mergeWorkflowStatus:
    | 'idle'
    | 'committing'
    | 'merging'
    | 'done'
    | 'error';
  /** Last merge result — short SHA of the merge commit. */
  mergeResult: { sha?: string; fastForward: boolean } | null;
  /** Last merge error verbatim from git. */
  mergeError: string | null;
  /**
   * Live snapshot of the current project's pipeline (mirrors the
   * matching session's `pipeline` field). Kept here so components can
   * subscribe directly without reaching into the sessions array.
   */
  pipeline: Pipeline | undefined;
  /**
   * Localhost URLs surfaced by the in-app terminal (PTY) output. The
   * Preview button merges these with whatever the agents have printed in
   * their chat transcripts, so things like `npx serve` get picked up
   * even when there's no agent running. Newest first, deduped, capped.
   */
  terminalLocalhostUrls: string[];
  /** Guards against double-invocation under React.StrictMode. */
  _initialized: boolean;
}

interface StoreActions {
  init: () => Promise<void>;
  refreshAgents: () => Promise<void>;
  setCwd: (cwd: string) => void;
  pickFolder: () => Promise<void>;

  setActivePane: (id: PaneId) => void;
  setPaneAgent: (id: PaneId, agentName: string) => Promise<void>;
  /**
   * Submit an answer to an in-pane AskUserQuestion form. Updates the
   * matching chat item to mark it answered (so the form re-renders
   * as a "answered" summary), then forwards the answer to main so
   * the agent's tool call resolves and the SDK turn unblocks.
   */
  submitAskUserQuestion: (
    paneId: PaneId,
    requestId: string,
    answers: Array<{ question: string; chosen: string[] }>,
  ) => Promise<void>;
  /**
   * Bind a pane to a non-agent terminal worker (Claude Code, Codex,
   * Aider, Gemini, plain shell). Stops any running agent session for
   * the pane, kills any existing PTY, then flips the leaf to
   * 'terminal' kind. The actual PTY spawn happens when the
   * TerminalPane component mounts, so this action is synchronous on
   * the store side. Idempotent — re-running with the same preset is
   * a no-op once the runtime entry already matches.
   */
  setPaneToTerminal: (id: PaneId, presetId: string) => Promise<void>;
  /**
   * TerminalPane registers/unregisters its PTY id here. The store
   * uses this so closePane / setPaneAgent can kill the PTY before
   * tearing down the pane. Pass null to clear.
   */
  setPanePtyId: (id: PaneId, ptyId: string | null) => void;
  splitPane: (id: PaneId, direction: 'horizontal' | 'vertical') => void;
  closePane: (id: PaneId) => Promise<void>;
  updateSizes: (path: number[], sizes: number[]) => void;
  /** Set or clear (empty string → unset) the user-chosen pane name. */
  setPaneName: (id: PaneId, name: string) => void;
  /**
   * Wipe a pane's conversation: stop its SDK session, delete the
   * on-disk transcript + saved session id, reset the runtime items.
   * The pane keeps its agent binding and re-starts a fresh session
   * via setPaneAgent / setLeadAgent on next interaction.
   */
  clearPane: (id: PaneId) => Promise<void>;

  sendMessage: (
    id: PaneId,
    text: string,
    images?: MessageImage[],
  ) => Promise<void>;
  interrupt: (id: PaneId) => Promise<void>;

  handleEvent: (e: SessionEvent) => void;

  saveWindow: () => Promise<void>;

  /** Workspaces (containers of projects). */
  createWorkspace: (name?: string) => Promise<void>;
  switchWorkspace: (id: string) => Promise<void>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  deleteWorkspaceById: (id: string) => Promise<void>;

  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebarCollapsed: () => void;
  applyLayoutTemplate: (cols: number, rows: number) => void;
  toggleSound: () => void;
  setWindowMode: (mode: WindowMode) => void;
  setLeadAgent: (agentName: string) => Promise<void>;
  refreshUsage: () => Promise<void>;
  setMemoryScope: (scope: MemoryScope) => void;

  // -- Preview window -----------------------------------------------------
  /** Set (or clear) the preview URL for the active session. */
  setPreviewUrl: (url: string | null) => void;
  openPreview: () => void;
  closePreview: () => void;
  /**
   * Push a chunk of terminal output through the localhost-URL detector
   * — newly seen URLs get prepended to `terminalLocalhostUrls` so the
   * Preview button can offer them. Called on every PTY data event.
   */
  noteTerminalOutput: (chunk: string) => void;
  /** Drop a URL from the auto-detected list (e.g. after killing it). */
  forgetLocalhostUrl: (url: string) => void;
  /** Drop EVERY auto-detected URL whose port matches `port`. Used by
   *  the preview kill flow because killing a port takes down all the
   *  URLs serving from it (e.g. `:3001` and `:3001/kainos` are both
   *  served by the same listener — the X button on either should
   *  clear both). */
  forgetLocalhostPort: (port: number) => void;

  // -- Sessions (multiple workspace tabs) ---------------------------------
  /** Spawn a new empty session and switch to it. Opens folder picker first. */
  createSession: () => Promise<void>;
  /** Switch the active session by id; saves current state and loads target. */
  switchSession: (id: string) => Promise<void>;
  /** Close a session: stop its panes, drop persisted state, activate next. */
  closeSession: (id: string) => Promise<void>;
  /** Rename a session in-place. */
  renameSession: (id: string, name: string) => Promise<void>;
  /**
   * Spawn a git worktree off an existing project, register it as a new
   * project under the same workspace (linked via parentProjectId), and
   * switch to it.
   */
  createWorktreeProject: (args: {
    parentProjectId: string;
    branchName: string;
    baseBranch: string | 'current';
    copyEnv: boolean;
  }) => Promise<void>;
  /**
   * Remove a worktree project: shuts down its panes, runs `git worktree
   * remove`, optionally deletes the branch, drops persistence, and
   * activates a sibling project.
   */
  removeWorktreeProject: (args: {
    projectId: string;
    force: boolean;
    deleteBranch: boolean;
  }) => Promise<{ warnings: string[] }>;

  // -- Flow (sync agent execution) -----------------------------------------
  /** Move a step to a specific 0-based index in the execution order. */
  setStepOrder: (stepId: string, targetIndex: number) => void;
  /** Persist a card's free-form canvas position. */
  setStepPosition: (stepId: string, x: number, y: number) => void;
  /** Set the post-previous-step delay (ms) before this step fires. */
  setStepDelay: (stepId: string, delayMs: number) => void;
  /** Set the prompt template for a step (used when Run Flow fires). */
  setStepPrompt: (stepId: string, prompt: string) => void;
  /** Kick off the chain — sends step 1's prompt to its pane. */
  runFlow: () => Promise<void>;
  /**
   * Turn flow on/off for the current project. When ON, any successful
   * pane result auto-fires the next pane in order with the previous
   * pane's last assistant text as its message. When OFF, panes run
   * independently as before.
   */
  togglePipelineEnabled: () => void;
  /** Toggle the project's main view between panes view and the flow board. */
  setPipelineView: (view: 'panes' | 'board' | 'review') => void;
  /** Toggle the Mission Control overlay. */
  setMissionControlOpen: (open: boolean) => void;

  // ── PR inbox actions ──────────────────────────────────────────
  /** Open or close the PR overlay. Opening also kicks off a fresh
   *  list-fetch if the cached data is stale or absent. */
  setPrModalOpen: (open: boolean) => void;
  /** Fetch the PR list for the active project. No-op when there's no
   *  cwd. Sets prInboxes[windowId].syncing while in flight. */
  refreshPrs: () => Promise<void>;
  /** Lazy-load full detail for one PR (body, all checks, comments). */
  openPrDetail: (number: number) => Promise<void>;
  /** Force-refresh a PR's full detail, bypassing the cache. Used
   *  after posting a reply so the new comment shows up in the
   *  thread without the user having to close + reopen the PR. */
  refreshPrDetail: (number: number) => Promise<void>;
  /** Clear the PR detail view (used when going back to the list). */
  closePrDetail: () => void;
  /** Fetch the failed-step output for a check's run id. */
  openCheckLog: (runId: string) => Promise<void>;
  /** Clear the loaded check log (also dismisses the log modal). */
  closeCheckLog: () => void;
  /** Drop a prepared prompt into a pane's composer + focus that
   *  pane. Used by the PR Send-to-agent flow. */
  seedPaneInput: (paneId: PaneId, text: string) => void;
  /** Called by a Pane after it has consumed the seed, to clear
   *  it and prevent re-application on subsequent renders. */
  consumePaneSeed: () => void;
  /** v1.5 — Record that a PR comment was just dispatched to an
   *  agent pane. The Reply composer reads this to summarise the
   *  RIGHT pane's transcript-since-dispatch when drafting a reply. */
  recordPrCommentDispatch: (commentId: string, paneId: PaneId) => void;
  /** Refresh the review state for the active worktree project. Sets
   *  reviewLoading while in flight, populates reviewState on success,
   *  reviewError on failure. */
  loadReview: () => Promise<void>;
  /** Set the file selected in the review file tree. */
  setReviewSelectedFile: (path: string | null) => void;
  /** Toggle / set a hunk's decision. Passing the current decision
   *  clears it back to pending. */
  setHunkDecision: (
    hunkId: string,
    decision: 'pending' | 'approve' | 'reject',
  ) => void;
  /** Bulk set: approve every pending hunk in the current diff. */
  approveAllHunks: () => void;
  /** Apply current hunk decisions to the worktree's working tree.
   *  Reverts rejected hunks via git apply --reverse, then reloads
   *  the diff so the UI reflects the new state. */
  applyHunkDecisions: () => Promise<{
    revertedFiles: string[];
    warnings: string[];
  }>;
  /** Revert the rejected hunks AND post a comment into the agent's
   *  pane explaining what to fix, asking them to revise. The pane
   *  selection happens by paneId arg — pickers in the UI prompt the
   *  user when a worktree has more than one agent. */
  sendBackToAgent: (args: {
    paneId: import('@shared/types').PaneId;
    note: string;
  }) => Promise<void>;
  /** Probe `gh` + remote info for the active worktree. Cached in
   *  `ghStatus`; the modal calls this on open. */
  loadGhStatus: () => Promise<void>;
  /** List gh-authed accounts (cached in `ghAccounts`). */
  loadGhAccounts: () => Promise<void>;
  /** Ask Claude to draft a PR title + body from the active pane's
   *  transcript + the loaded diff. Returns the draft for the modal
   *  to populate its inputs. */
  generatePRDescription: () => Promise<{ title: string; body: string }>;
  /** Run the full ship sequence: switch gh user (if needed) →
   *  commit (when dirty) → push → PR. Updates `prWorkflowStatus`
   *  as it goes; on success populates `prResult`; on failure sets
   *  `prError`. Throws nothing — the caller observes via state.
   *  `pushAs` is the gh login to push as (no-op if it matches the
   *  active account). */
  shipPR: (args: {
    commitMessage: string;
    title: string;
    body: string;
    baseBranch: string;
    draft?: boolean;
    pushAs?: string;
  }) => Promise<void>;
  /** Reset PR workflow back to idle (clears result/error). Called
   *  when the user closes the success/error sheet. */
  resetPRWorkflow: () => void;
  /** Post-merge wrap-up: pull base branch on the parent project,
   *  remove the worktree (with branch deletion), and switch the
   *  active session to the parent. Triggered from the "Wrap up"
   *  button in the PR-success card after the user has merged the
   *  PR on GitHub. */
  wrapUpAfterMerge: () => Promise<void>;
  /** Reset wrap-up state (used by the success card to dismiss
   *  the post-merge banner without doing anything else). */
  resetWrapUp: () => void;
  /** Run the local-merge sequence: commit (when dirty) → switch
   *  parent to baseBranch if needed → merge. Updates
   *  `mergeWorkflowStatus` as it goes. */
  mergeLocally: (args: {
    commitMessage: string;
    baseBranch: string;
  }) => Promise<void>;
  /** Reset local-merge workflow back to idle. */
  resetMergeWorkflow: () => void;

  openAgentEditor: (agent?: AgentDef) => void;
  openSkillEditor: (skill?: SkillDef) => void;
  updateEditor: (patch: Partial<AgentDraft & SkillDraft>) => void;
  closeEditor: () => void;
  saveEditor: () => Promise<void>;
  deleteFromEditor: () => Promise<void>;
}

export type Store = StoreState & StoreActions;

function initialTree(): PaneNode {
  return { kind: 'leaf', id: nanoid(8) };
}

/** Walk the tree to find a leaf by id. Returns path (indices) or null. */
function findPath(node: PaneNode, id: PaneId, path: number[] = []): number[] | null {
  if (node.kind === 'leaf') {
    return node.id === id ? path : null;
  }
  for (let i = 0; i < node.children.length; i++) {
    const found = findPath(node.children[i], id, [...path, i]);
    if (found) return found;
  }
  return null;
}

/** Collect all leaf ids in the tree. */
function collectLeaves(node: PaneNode, out: PaneId[] = []): PaneId[] {
  if (node.kind === 'leaf') {
    out.push(node.id);
  } else {
    for (const c of node.children) collectLeaves(c, out);
  }
  return out;
}

/**
 * Find which session (project) owns a given pane id. Walks both the
 * tree leaves and the lead pane id of every session — the first match
 * wins. Returns null if the pane belongs to no known session (e.g. a
 * pane that's been removed in a race with its final result event).
 */
function findSessionIdForPane(
  sessions: WindowState[],
  paneId: PaneId,
): WindowId | null {
  for (const s of sessions) {
    if (s.lead?.paneId === paneId) return s.id;
    if (treeContainsPane(s.tree, paneId)) return s.id;
  }
  return null;
}

function treeContainsPane(node: PaneNode, paneId: PaneId): boolean {
  if (node.kind === 'leaf') return node.id === paneId;
  for (const c of node.children) {
    if (treeContainsPane(c, paneId)) return true;
  }
  return false;
}

/** Collect all leaves with their associated agent (if any). */
/**
 * Convert a flat transcript-entry array (loaded from disk) into the
 * renderer's ChatItem shape. Used by setPaneAgent and setLeadAgent so
 * a freshly-bound pane immediately shows its history while the SDK
 * resumes underneath.
 */
function transcriptToItems(
  transcript: Array<{
    kind: string;
    [k: string]: unknown;
  }>,
): ChatItem[] {
  const items: ChatItem[] = [];
  for (const t of transcript as unknown as Array<{
    kind: ChatItem['kind'];
    [k: string]: unknown;
  }>) {
    switch (t.kind) {
      case 'user':
        items.push({
          id: nanoid(8),
          kind: 'user',
          text: t.text as string,
          images: t.images as MessageImage[] | undefined,
          ts: t.ts as number,
        });
        break;
      case 'assistant_text':
        items.push({
          id: nanoid(8),
          kind: 'assistant_text',
          text: t.text as string,
          ts: t.ts as number,
        });
        break;
      case 'tool_use':
        items.push({
          id: nanoid(8),
          kind: 'tool_use',
          toolUseId: t.toolUseId as string,
          name: t.name as string,
          input: t.input,
          ts: t.ts as number,
        });
        break;
      case 'tool_result':
        items.push({
          id: nanoid(8),
          kind: 'tool_result',
          toolUseId: t.toolUseId as string,
          content: t.content,
          isError: t.isError as boolean | undefined,
          ts: t.ts as number,
        });
        break;
      case 'result':
        items.push({
          id: nanoid(8),
          kind: 'result',
          subtype: t.subtype as 'success' | 'error_max_turns' | 'error_during_execution',
          durationMs: t.durationMs as number,
          totalCostUsd: t.totalCostUsd as number | undefined,
          numTurns: t.numTurns as number | undefined,
          ts: t.ts as number,
        });
        break;
    }
  }
  return items;
}

interface LeafMeta {
  id: PaneId;
  agentName?: string;
  workerKind?: 'agent' | 'terminal';
  presetId?: string;
}

export function collectLeavesWithAgents(
  node: PaneNode,
  out: LeafMeta[] = [],
): LeafMeta[] {
  if (node.kind === 'leaf') {
    out.push({
      id: node.id,
      agentName: node.agentName,
      workerKind: node.workerKind,
      presetId: node.presetId,
    });
  } else {
    for (const c of node.children) collectLeavesWithAgents(c, out);
  }
  return out;
}

/**
 * For every loaded project whose folder is a linked git worktree but
 * whose `parentProjectId` field is missing, look at the sibling list
 * for a project pointing at the parent checkout and persist the link.
 *
 * Runs once on app load (fire-and-forget). Without this, projects
 * created before we tracked worktree metadata (or whose data was
 * snapshot-stripped on a previous build) keep showing flat in the
 * sidebar instead of indented under their parent.
 */
async function backfillWorktreeLinks(sessions: WindowState[]): Promise<void> {
  // Index sessions by their cwd so we can map from "this is the parent
  // checkout path" → "this is the project id that owns it".
  const idByCwd = new Map<string, string>();
  for (const s of sessions) {
    idByCwd.set(s.cwd, s.id);
  }

  for (const s of sessions) {
    // Run for any session that's missing one of the three worktree
    // fields — earlier saveWindow() bugs could leave parentProjectId
    // intact but strip worktreeBranch/worktreeBase, breaking the
    // Review chip even though the indent + WT badge still showed.
    if (s.parentProjectId && s.worktreeBranch && s.worktreeBase) continue;
    try {
      const status = await window.cowork.system.worktreeStatus({
        cwd: s.cwd,
      });
      if (!status.isWorktree || !status.parentCwd) continue;
      const parentId = idByCwd.get(status.parentCwd) ?? s.parentProjectId;
      if (!parentId || parentId === s.id) continue;
      // Re-derive worktreeBase from the parent project's branch when
      // we don't already have it. The parent's checked-out branch is
      // the closest analog to "the branch this worktree forked from"
      // in the absence of other info — accurate in the common case
      // where the user branches off the parent's HEAD.
      const parentSession = sessions.find((p) => p.id === parentId);
      const parentBranch =
        parentSession?.worktreeBranch ??
        (await window.cowork.system
          .gitBranch({ cwd: parentSession?.cwd ?? '' })
          .catch(() => null));
      const patched: WindowState = {
        ...s,
        parentProjectId: parentId,
        worktreeBranch: status.branch ?? s.worktreeBranch,
        worktreeBase: s.worktreeBase ?? parentBranch ?? 'main',
      };
      await window.cowork.state.saveWindow(patched);
      // Reflect the change in the in-memory sessions list as well so
      // the SessionsList rerenders with the indent immediately.
      // We use the store API rather than a closure on `set` because
      // this helper sits outside the Zustand factory.
      useStore.setState((cur) => ({
        sessions: cur.sessions.map((x) => (x.id === s.id ? patched : x)),
      }));
    } catch {
      // Folder might be gone, not a git repo, etc. — silent skip.
    }
  }
}

/**
 * Called whenever a pane emits a successful `result` event. If flow is
 * enabled on the active project AND the finishing pane has a successor
 * in the flow's step order, send that successor the prior pane's final
 * assistant text. This is what makes "send to Pane 1 → chain runs"
 * work without the user clicking anything else.
 *
 * Only the active project's flow advances — flows on background
 * projects don't fire (we don't even subscribe their events here).
 */
function advanceFlowAfterResult(
  get: () => Store,
  paneId: PaneId,
): void {
  const flow = get().pipeline;
  if (!flow?.enabled) return;
  const idx = flow.steps.findIndex((s) => s.paneId === paneId);
  if (idx < 0 || idx >= flow.steps.length - 1) return;
  const nextStep = flow.steps[idx + 1];
  // Sanity-check the next pane still exists with an agent. If it
  // doesn't we just stop the chain — the user can fix it and rerun.
  const nextRuntime = get().panes[nextStep.paneId];
  if (!nextRuntime?.agentName) return;

  // Walk this pane's chat items backwards to find the *latest* user
  // turn, then collect every assistant_text after it. That gives us
  // the agent's final response for this turn, joined into one block.
  const pane = get().panes[paneId];
  if (!pane) return;
  let lastUserIdx = -1;
  for (let i = pane.items.length - 1; i >= 0; i--) {
    if (pane.items[i].kind === 'user') {
      lastUserIdx = i;
      break;
    }
  }
  const collected = pane.items
    .slice(lastUserIdx + 1)
    .filter((it) => it.kind === 'assistant_text')
    .map((it) => (it as { text: string }).text)
    .join('\n\n')
    .trim();
  if (collected.length === 0) return;

  // Compose the next step's actual message:
  //   - If the user set a prompt on this step in the Flow board, send
  //     that, with `{previous}` swapped for the prior pane's output.
  //   - If the prompt is empty, fall back to just the previous output
  //     so the chain still functions for users who skipped prompts.
  const userPrompt = (nextStep.prompt ?? '').trim();
  const message = userPrompt
    ? userPrompt.includes('{previous}')
      ? userPrompt.replace(/\{previous\}/g, collected)
      : `${userPrompt}\n\n---\n\n${collected}`
    : collected;

  // Fire the next pane on a microtask so we don't reentrantly call
  // into the IPC layer from inside the event handler. Honor the
  // user-configured delay (delayMs) on the next step — useful for
  // pacing rate-limited APIs or just letting the previous output
  // settle in the UI before the next pane starts streaming.
  const delay = Math.max(0, nextStep.delayMs ?? 0);
  if (delay > 0) {
    setTimeout(() => {
      void window.cowork.session.send(nextStep.paneId, message);
    }, delay);
  } else {
    queueMicrotask(() => {
      void window.cowork.session.send(nextStep.paneId, message);
    });
  }
}

/**
 * After a hot reload / app restart, any pipeline that was running gets
 * frozen mid-flight. Rather than show a stale "running" state forever,
 * clamp it to 'stopped' so the UI shows the user where it left off and
 * lets them re-run.
 */
function normalizeRehydratedPipeline(pipeline: Pipeline): Pipeline {
  if (!pipeline.lastRun || pipeline.lastRun.status !== 'running') {
    return pipeline;
  }
  return {
    ...pipeline,
    lastRun: {
      ...pipeline.lastRun,
      status: 'stopped',
      finishedAt: pipeline.lastRun.finishedAt ?? Date.now(),
    },
  };
}

/**
 * Persist the pipeline back onto the active project's WindowState so it
 * survives an app restart. Both the renderer's mirror copy and the
 * sessions array entry get updated. Pass `undefined` to clear.
 */
async function persistActivePipeline(
  get: () => Store,
  set: (partial: Partial<Store>) => void,
  pipeline: Pipeline | undefined,
): Promise<void> {
  const activeId = get().windowId;
  const sessions = get().sessions.map((s) =>
    s.id === activeId ? { ...s, pipeline } : s,
  );
  set({ sessions });
  const target = sessions.find((s) => s.id === activeId);
  if (target) {
    try {
      await window.cowork.state.saveWindow(target);
    } catch {
      // Persistence failure shouldn't break the in-memory state — the
      // user will still see their pipeline; it just won't survive a
      // restart. Logging avoids silent corruption in dev.
      console.warn('[pipeline] saveWindow failed for active project');
    }
  }
}

/**
 * Send a prompt to a pane and resolve with its final assistant text
 * once the SDK emits a `result`. Used by `runPipeline` to chain steps.
 *
 * Implementation: we subscribe to `session.onEvent`, accumulate any
 * `assistant_text` events for the target pane, and resolve when we see
 * the next `result`. On `subtype: 'error_during_execution'` we reject
 * so `runPipeline` can stop the chain.
 */
function runPipelineStep(paneId: PaneId, prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let collected = '';
    let unsubscribe: (() => void) | null = null;
    const cleanup = () => {
      if (unsubscribe) {
        unsubscribe();
        unsubscribe = null;
      }
    };
    unsubscribe = window.cowork.session.onEvent((ev: SessionEvent) => {
      if (ev.paneId !== paneId) return;
      if (ev.kind === 'assistant_text') {
        collected += (collected ? '\n\n' : '') + ev.text;
      } else if (ev.kind === 'result') {
        cleanup();
        if (ev.subtype === 'success') {
          resolve(collected.trim());
        } else {
          reject(
            new Error(
              `Step failed (${ev.subtype}). Open the pane to see the agent's last message for details.`,
            ),
          );
        }
      } else if (ev.kind === 'status' && ev.status === 'error') {
        cleanup();
        reject(new Error(ev.error ?? 'Pane reported an error.'));
      }
    });
    // Fire the message AFTER the listener is in place so we never miss
    // the result for a fast-completing step.
    window.cowork.session.send(paneId, prompt).catch((err) => {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    });
  });
}

/**
 * Convert an agent slug to a human-readable title.
 *   "frontend-developer"  -> "Frontend Developer"
 *   "lead_users_agent"    -> "Lead Users Agent"
 *
 * Used for default pane titles when an agent is bound and the user
 * hasn't explicitly renamed the pane, plus by other surfaces (PR
 * "Send to agent" picker) that need a friendly label for an agent.
 */
export function humanizeAgentName(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

/**
 * Resolve a pane's display name. Returns the user-set `paneName` from
 * the tree if there is one, otherwise "Pane N" where N is the leaf's
 * 1-based DOM-order index. The Lead pane lives outside the main tree
 * (rendered separately in App.tsx as a sibling of PaneTree), so when
 * the id doesn't appear in `tree` we look at `leadPane` and fall back
 * to "Lead pane" — there's only one.
 */
export function getPaneDisplayName(
  tree: PaneNode,
  id: PaneId,
  leadPane?: { paneId: PaneId; paneName?: string } | null,
): { name: string; isCustom: boolean } {
  let index = 0;
  let custom: string | undefined;
  let found = false;
  const walk = (node: PaneNode): void => {
    if (found) return;
    if (node.kind === 'leaf') {
      index += 1;
      if (node.id === id) {
        custom = node.paneName;
        found = true;
      }
    } else {
      for (const c of node.children) walk(c);
    }
  };
  walk(tree);
  if (found) {
    if (custom && custom.trim()) return { name: custom.trim(), isCustom: true };
    return { name: `Pane ${index}`, isCustom: false };
  }
  // Not in the tree — must be the Lead pane (which renders outside it).
  if (leadPane && leadPane.paneId === id) {
    if (leadPane.paneName && leadPane.paneName.trim()) {
      return { name: leadPane.paneName.trim(), isCustom: true };
    }
    return { name: 'Lead pane', isCustom: false };
  }
  return { name: 'Pane', isCustom: false };
}

/** Immutably replace the node at `path` inside `root`. */
function replaceAtPath(
  root: PaneNode,
  path: number[],
  next: PaneNode,
): PaneNode {
  if (path.length === 0) return next;
  if (root.kind !== 'split') return root;
  const [idx, ...rest] = path;
  const newChildren = root.children.slice();
  newChildren[idx] = replaceAtPath(root.children[idx], rest, next);
  return { ...root, children: newChildren };
}

/** Get node at path. */
function nodeAt(root: PaneNode, path: number[]): PaneNode | null {
  let cur: PaneNode = root;
  for (const i of path) {
    if (cur.kind !== 'split') return null;
    cur = cur.children[i];
  }
  return cur;
}

/**
 * Return a new tree where each leaf's agentName matches the current panes map.
 *
 * Preserves any `paneName` already on the leaf — without this, every
 * call to `bakeAgentsIntoTree` (snapshot on session switch, save preset,
 * update preset, etc.) would strip user-entered pane names because they
 * live on the persisted leaf rather than in the runtime panes map.
 */
function bakeAgentsIntoTree(
  node: PaneNode,
  panes: Record<string, PaneRuntime>,
): PaneNode {
  if (node.kind === 'leaf') {
    // Prefer the runtime panes map (the user's *current* binding) over
    // the leaf's stored value, but fall back to the leaf for inactive
    // sessions whose runtime may not be hydrated yet. Same fallback
    // pattern applies to workerKind/presetId — terminal panes need
    // their preset to survive a save even if the runtime map is bare.
    const runtime = panes[node.id];
    const agentName = runtime?.agentName ?? node.agentName;
    const workerKind = runtime?.workerKind ?? node.workerKind;
    const presetId = runtime?.presetId ?? node.presetId;
    return {
      kind: 'leaf',
      id: node.id,
      // Only emit agentName for agent-kind leaves so a terminal pane
      // doesn't carry stale agent state in storage.
      ...(workerKind === 'terminal' ? {} : agentName ? { agentName } : {}),
      ...(node.paneName ? { paneName: node.paneName } : {}),
      ...(workerKind ? { workerKind } : {}),
      ...(workerKind === 'terminal' && presetId ? { presetId } : {}),
    };
  }
  return {
    ...node,
    children: node.children.map((c) => bakeAgentsIntoTree(c, panes)),
  };
}

/**
 * Clone a tree giving every leaf a fresh pane id so sessions start clean
 * and don't inherit on-disk transcripts keyed by the old id. Populates
 * `outAgents` with (newId -> agentName) for each leaf that had one.
 */
function cloneTreeFresh(
  node: PaneNode,
  outAgents: Record<string, string>,
): PaneNode {
  if (node.kind === 'leaf') {
    const newId = nanoid(8);
    if (node.agentName && node.workerKind !== 'terminal') {
      outAgents[newId] = node.agentName;
    }
    return {
      kind: 'leaf',
      id: newId,
      // Carry the worker kind + preset over to the cloned leaf so
      // applying a layout-template to a session with terminal panes
      // keeps them as terminals (with fresh PTYs once they remount).
      ...(node.workerKind !== 'terminal' && node.agentName
        ? { agentName: node.agentName }
        : {}),
      ...(node.workerKind ? { workerKind: node.workerKind } : {}),
      ...(node.workerKind === 'terminal' && node.presetId
        ? { presetId: node.presetId }
        : {}),
    };
  }
  return {
    ...node,
    children: node.children.map((c) => cloneTreeFresh(c, outAgents)),
  };
}

/**
 * Build an equal-size grid of `cols × rows` leaves as a nested PaneNode.
 * 1×1 → a single leaf. 2×1 → horizontal split. n×m → horizontal of n
 * vertical splits, each with m leaves, yielding an even grid.
 */
function buildGridTree(cols: number, rows: number): PaneNode {
  const makeLeaf = (): PaneNode => ({ kind: 'leaf', id: nanoid(8) });
  if (cols <= 1 && rows <= 1) return makeLeaf();

  const buildColumn = (): PaneNode => {
    if (rows === 1) return makeLeaf();
    const leaves: PaneNode[] = Array.from({ length: rows }, makeLeaf);
    return {
      kind: 'split',
      direction: 'vertical',
      children: leaves,
      sizes: leaves.map(() => 100 / rows),
    };
  };

  if (cols === 1) return buildColumn();
  const columns = Array.from({ length: cols }, buildColumn);
  return {
    kind: 'split',
    direction: 'horizontal',
    children: columns,
    sizes: columns.map(() => 100 / cols),
  };
}

/** Remove a leaf by id, collapsing singleton splits. Returns [newTree, removed]. */
function removeLeaf(
  root: PaneNode,
  id: PaneId,
): { tree: PaneNode | null; removed: boolean } {
  if (root.kind === 'leaf') {
    if (root.id === id) return { tree: null, removed: true };
    return { tree: root, removed: false };
  }
  let removed = false;
  const newChildren: PaneNode[] = [];
  for (const c of root.children) {
    const r = removeLeaf(c, id);
    if (r.tree) newChildren.push(r.tree);
    if (r.removed) removed = true;
  }
  if (newChildren.length === 0) return { tree: null, removed };
  if (newChildren.length === 1) return { tree: newChildren[0], removed };
  return { tree: { ...root, children: newChildren }, removed };
}

export const useStore = create<Store>((set, get) => ({
  windowId: nanoid(10),
  cwd: null,
  tree: initialTree(),
  activePaneId: null,
  panes: {},
  agents: [],
  skills: [],
  workspaces: [],
  activeWorkspaceId: null,
  sessions: [],
  editor: null,
  editorError: undefined,
  editorSaving: false,
  sidebarCollapsed: false,
  soundEnabled: true,
  windowMode: 'multi',
  leadPaneId: null,
  leadPaneName: null,
  memoryScope: 'project' as MemoryScope,
  usage: null,
  previewUrl: null,
  previewOpen: false,
  missionControlOpen: false,

  prInboxes: {},
  prDetail: null,
  prDetailLoading: false,
  prDetailError: null,
  prModalOpen: false,
  prCheckLog: null,
  prCheckLogLoading: false,
  prCheckLogError: null,
  prDetails: {},
  prCheckLogs: {},
  prCommentDispatches: loadPrCommentDispatches(),
  pendingPaneSeed: null,
  pipelineView: 'panes' as 'panes' | 'board' | 'review',
  pipeline: undefined as Pipeline | undefined,
  reviewState: undefined,
  reviewLoading: false,
  reviewError: null,
  reviewSelectedFile: null,
  reviewHunkDecisions: {} as Record<string, 'pending' | 'approve' | 'reject'>,
  reviewApplying: false,
  ghStatus: null,
  ghAccounts: [],
  prWorkflowStatus: 'idle' as
    | 'idle'
    | 'committing'
    | 'pushing'
    | 'creating-pr'
    | 'done'
    | 'error',
  prResult: null,
  prError: null,
  wrapUpStatus: 'idle' as
    | 'idle'
    | 'pulling'
    | 'removing'
    | 'done'
    | 'error',
  wrapUpError: null,
  mergeWorkflowStatus: 'idle' as
    | 'idle'
    | 'committing'
    | 'merging'
    | 'done'
    | 'error',
  mergeResult: null,
  mergeError: null,
  terminalLocalhostUrls: [],
  _initialized: false,

  init: async () => {
    // In React.StrictMode the mount effect runs twice in dev. Without this
    // guard we'd register the IPC listeners twice and every session event
    // would be appended to the chat twice.
    if (get()._initialized) return;
    set({ _initialized: true });
    const [agents, skills, state] = await Promise.all([
      window.cowork.agents.list(),
      window.cowork.skills.list(),
      window.cowork.state.get(),
    ]);

    // Restore all known sessions. We pick the previously-active one (or
    // fall back to the most recently-saved) and hydrate top-level state
    // from it. Panes for inactive sessions are also created in `panes`
    // so their transcripts can load and their agent sessions stay live.
    const sessions: WindowState[] = state.windows.filter(
      (w) => typeof w.cwd === 'string' && !!w.cwd,
    );

    // Back-fill worktree linkage for projects that were created before
    // we tracked it (or whose snapshot dropped the field on a previous
    // version). For each session whose `.git` says it's a worktree, find
    // a sibling session whose cwd matches the parent path and copy the
    // link onto it. We do this in the background so init isn't blocked,
    // but the result lands in `sessions[]` via saveWindow + a refresh
    // tick.
    void backfillWorktreeLinks(sessions);
    const targetSession =
      sessions.find((w) => w.id === state.activeSessionId) ??
      sessions[sessions.length - 1];

    let tree: PaneNode;
    let panes: Record<PaneId, PaneRuntime> = {};
    let windowId: string;
    let cwd: string | null;

    // Pre-populate panes for EVERY session so transcripts and agents are
    // ready when the user switches tabs. This keeps inactive sessions
    // warm in the SessionPool.
    for (const w of sessions) {
      for (const meta of collectLeavesWithAgents(w.tree)) {
        panes[meta.id] = {
          id: meta.id,
          agentName: meta.agentName,
          status: 'idle',
          items: [],
          // Carry through worker-kind metadata so terminal panes
          // restore their preset binding on session switch — without
          // this the leaf would still say 'terminal' but the runtime
          // map would forget which CLI to spawn.
          workerKind: meta.workerKind,
          presetId: meta.presetId,
        };
      }
      if (w.windowMode === 'lead' && w.lead) {
        const { paneId: leadId, agentName: leadAgent } = w.lead;
        panes[leadId] = {
          id: leadId,
          agentName: leadAgent,
          status: 'idle',
          items: [],
        };
      }
    }

    if (targetSession) {
      tree = targetSession.tree;
      windowId = targetSession.id;
      cwd = targetSession.cwd;
    } else {
      tree = get().tree;
      windowId = get().windowId;
      cwd = null;
      panes = {};
      for (const id of collectLeaves(tree)) {
        panes[id] = { id, status: 'idle', items: [] };
      }
    }

    const willRestore = !!targetSession;
    const firstLeaf = collectLeaves(tree)[0] ?? null;
    const restoredMode: WindowMode =
      willRestore ? targetSession!.windowMode ?? 'multi' : 'multi';
    const restoredLeadId: PaneId | null =
      willRestore && targetSession!.windowMode === 'lead' && targetSession!.lead
        ? targetSession!.lead.paneId
        : null;
    const restoredLeadName: string | null =
      willRestore && targetSession!.windowMode === 'lead' && targetSession!.lead
        ? (targetSession!.lead.paneName ?? null)
        : null;
    const restoredScope: MemoryScope =
      willRestore ? targetSession!.memoryScope ?? 'project' : 'project';

    // Resolve the active workspace. Migration in main creates a default
    // "My Workspace" containing every existing project; on first ever
    // launch the workspaces array is empty and we leave activeWorkspaceId
    // null until the user creates one (which auto-creates a project).
    const workspaces = state.workspaces ?? [];
    const restoredWorkspaceId =
      state.activeWorkspaceId &&
      workspaces.some((w) => w.id === state.activeWorkspaceId)
        ? state.activeWorkspaceId
        : workspaces[0]?.id ?? null;

    set({
      agents,
      skills,
      workspaces,
      activeWorkspaceId: restoredWorkspaceId,
      sessions,
      tree,
      panes,
      windowId,
      cwd,
      activePaneId: restoredLeadId ?? firstLeaf,
      windowMode: restoredMode,
      leadPaneId: restoredLeadId,
      leadPaneName: restoredLeadName,
      memoryScope: restoredScope,
      previewUrl: targetSession?.previewUrl ?? null,
      // Hydrate pipeline mirror; lastRun.status === 'running' from a
      // killed session gets normalized so the UI doesn't think it's
      // still going.
      pipeline: targetSession?.pipeline
        ? normalizeRehydratedPipeline(targetSession.pipeline)
        : undefined,
    });
    if (willRestore && cwd) {
      void window.cowork.memory.ensure(cwd).catch(() => undefined);
    }

    // The initial agents/skills fetch above ran without a cwd because
    // we hadn't loaded the saved state yet. Now that cwd is hydrated
    // from the active session, kick off a second fetch so any
    // project-scoped agents (`<cwd>/.claude/agents/`) actually appear
    // in the sidebar at first paint instead of "sometime later when I
    // click around" (the current symptom). Cheap; one IPC round trip.
    if (cwd) {
      void get().refreshAgents();
    }

    // Watch for agent/skill file changes.
    window.cowork.agents.onWatch(() => {
      void get().refreshAgents();
    });
    // Route session events into the store.
    window.cowork.session.onEvent((ev) => {
      get().handleEvent(ev);
      // Flow advance: when a pane in the active flow finishes a turn
      // successfully and flow is enabled, automatically fire the next
      // pane in order with the previous pane's final assistant text.
      // Errors and stops break the chain.
      if (ev.kind === 'result' && ev.subtype === 'success') {
        advanceFlowAfterResult(get, ev.paneId);
      }
    });
    // Auto-spawn from Lead: main created a new sub-agent session; we
    // insert the pane into the tree so the UI reflects it.
    window.cowork.session.onPaneSpawn((payload: PaneSpawnRequest) => {
      set((s) => {
        if (s.panes[payload.paneId]) return s;
        const nextPanes: Record<PaneId, PaneRuntime> = {
          ...s.panes,
          [payload.paneId]: {
            id: payload.paneId,
            agentName: payload.agentName,
            status: 'starting',
            items: [],
          },
        };
        const newLeaf: PaneNode = {
          kind: 'leaf',
          id: payload.paneId,
          agentName: payload.agentName,
        };
        const nextTree: PaneNode =
          s.tree.kind === 'leaf' && !s.panes[s.tree.id]?.agentName
            ? newLeaf
            : s.tree.kind === 'split'
              ? {
                  ...s.tree,
                  children: [...s.tree.children, newLeaf],
                  sizes: undefined,
                }
              : {
                  kind: 'split',
                  direction: 'horizontal',
                  children: [s.tree, newLeaf],
                  sizes: [50, 50],
                };
        return {
          panes: nextPanes,
          tree: nextTree,
          activePaneId: s.activePaneId ?? payload.paneId,
        };
      });
    });
    // Lead stopped a sub-agent remotely.
    window.cowork.session.onPaneStopRemote(({ paneId }) => {
      void get().closePane(paneId);
    });

    // AskUserQuestion: when the agent calls the in-process MCP tool,
    // main pushes a SHOW event with the question payload. We append a
    // synthetic 'ask_user_question' chat item to the target pane;
    // Message.tsx renders it as an inline form. Submitting fires
    // submitAskUserQuestion below, which talks back to main.
    window.cowork.askUserQuestion?.onShow((payload) => {
      set((s) => {
        const pane = s.panes[payload.paneId];
        if (!pane) return s;
        return {
          panes: {
            ...s.panes,
            [payload.paneId]: {
              ...pane,
              items: [
                ...pane.items,
                {
                  id: 'auq-' + payload.requestId,
                  kind: 'ask_user_question',
                  requestId: payload.requestId,
                  questions: payload.payload.questions,
                  ts: Date.now(),
                },
              ],
            },
          },
        };
      });
    });

    // Seed + auto-refresh the usage summary on every recorded turn.
    window.cowork.usage.onTick(() => {
      void get().refreshUsage();
    });
    void get().refreshUsage();

    // Kick off auto-resume for every pane in the ACTIVE session only.
    // Inactive sessions stay cold until the user switches into them
    // (switchSession does the lazy hydration for whichever tab they
    // visit). setPaneAgent reads the live top-level cwd/windowId etc.,
    // so calling it for non-active sessions would associate panes with
    // the wrong session context.
    if (willRestore && cwd && targetSession) {
      const activePaneIds = new Set(collectLeaves(targetSession.tree));
      if (
        targetSession.windowMode === 'lead' &&
        targetSession.lead?.paneId
      ) {
        activePaneIds.add(targetSession.lead.paneId);
      }
      for (const pane of Object.values(panes)) {
        if (!activePaneIds.has(pane.id)) continue;
        if (pane.agentName) {
          void get().setPaneAgent(pane.id, pane.agentName);
        }
      }
    }
  },

  refreshAgents: async () => {
    const [agents, skills] = await Promise.all([
      window.cowork.agents.list(get().cwd ?? undefined),
      window.cowork.skills.list(get().cwd ?? undefined),
    ]);
    set({ agents, skills });
  },

  setCwd: (cwd) => {
    set({ cwd });
    void get().refreshAgents();
    void get().saveWindow();
  },

  pickFolder: async () => {
    const folder = await window.cowork.workspace.pickFolder();
    if (!folder) return;
    if (folder === get().cwd) return; // same folder — nothing to do.

    // Make sure ./CLAUDE.md exists in this folder so the user can curate it
    // straight from Settings without having to create it manually.
    void window.cowork.memory.ensure(folder).catch(() => undefined);

    // If the chosen folder matches an existing project in the active
    // workspace, just switch to it instead of creating a duplicate.
    const existingProject = get().sessions.find((s) => s.cwd === folder);
    if (existingProject) {
      await get().switchSession(existingProject.id);
      return;
    }

    // Fresh folder — reset to a clean Multi window so we don't drag
    // stale agents from a different project into this folder.
    for (const p of Object.values(get().panes)) {
      try {
        await window.cowork.session.stop(p.id);
      } catch {
        // ignore
      }
    }
    const id = nanoid(8);
    set({
      cwd: folder,
      tree: { kind: 'leaf', id },
      panes: { [id]: { id, status: 'idle', items: [] } },
      activePaneId: id,
      windowMode: 'multi',
      leadPaneId: null,
  leadPaneName: null,
          memoryScope: 'project',
    });
    void get().refreshAgents();
    void get().saveWindow();
  },

  setActivePane: (id) => set({ activePaneId: id }),

  // -- Preview window -----------------------------------------------------

  setPreviewUrl: (url) => {
    set({ previewUrl: url });
    void get().saveWindow();
  },
  openPreview: () => set({ previewOpen: true }),
  closePreview: () => set({ previewOpen: false }),

  /**
   * Mine a freshly arrived chunk of PTY output for localhost URLs and
   * prepend any new ones to `terminalLocalhostUrls`. Cap at 10 so the
   * picker stays manageable even after a long debug session.
   *
   * Strips ANSI escape sequences first — `npx serve` colours its
   * output, and the colour codes can split a URL across what looks like
   * separate matches otherwise.
   */
  noteTerminalOutput: (chunk) => {
    if (!chunk) return;
    // Drop ANSI/CSI/OSC sequences. Doesn't need to be perfect — just
    // enough that LOCALHOST_RE sees a contiguous URL.
    const stripped = chunk.replace(
      /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g,
      '',
    );
    const matches = stripped.match(LOCALHOST_RE);
    if (!matches) return;
    const current = get().terminalLocalhostUrls;
    const seen = new Set(current);
    const fresh: string[] = [];
    for (const m of matches) {
      const normalized = m.replace(/\/$/, '');
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      fresh.push(normalized);
    }
    if (fresh.length === 0) return;
    // Newest first. Cap at 10 to keep the picker tidy.
    const next = [...fresh, ...current].slice(0, 10);
    set({ terminalLocalhostUrls: next });
  },

  forgetLocalhostUrl: (url) => {
    const norm = url.replace(/\/$/, '');
    const filtered = get().terminalLocalhostUrls.filter((u) => u !== norm);
    const updates: Partial<Store> = { terminalLocalhostUrls: filtered };
    // If the manual previewUrl was pointing at this same URL (e.g. user
    // just killed the dev server it's loading), drop it too so the
    // modal goes back to the empty state instead of trying to reach a
    // dead port.
    if (get().previewUrl?.replace(/\/$/, '') === norm) {
      updates.previewUrl = null;
    }
    set(updates);
    if (updates.previewUrl !== undefined) {
      void get().saveWindow();
    }
  },

  forgetLocalhostPort: (port) => {
    if (!Number.isInteger(port) || port <= 0) return;
    const portFromUrl = (u: string): number | null => {
      try {
        const parsed = new URL(u);
        return parsed.port ? Number(parsed.port) : null;
      } catch {
        return null;
      }
    };
    const filtered = get().terminalLocalhostUrls.filter(
      (u) => portFromUrl(u) !== port,
    );
    const updates: Partial<Store> = { terminalLocalhostUrls: filtered };
    const cur = get().previewUrl;
    if (cur && portFromUrl(cur) === port) {
      updates.previewUrl = null;
    }
    set(updates);
    if (updates.previewUrl !== undefined) {
      void get().saveWindow();
    }
  },

  setPaneName: (id, name) => {
    const trimmed = name.trim();
    // The Lead pane lives outside the tree — store its name on the
    // dedicated `leadPaneName` slot instead of recursing the tree.
    if (id === get().leadPaneId) {
      set({ leadPaneName: trimmed.length > 0 ? trimmed : null });
      void get().saveWindow();
      return;
    }
    // Walk the tree and update the matching leaf node's `paneName`.
    // Empty string clears the override so the UI falls back to "Pane N".
    const replace = (node: PaneNode): PaneNode => {
      if (node.kind === 'leaf') {
        if (node.id !== id) return node;
        const { paneName: _existing, ...rest } = node;
        if (trimmed.length === 0) return rest;
        return { ...rest, paneName: trimmed };
      }
      return { ...node, children: node.children.map(replace) };
    };
    set((s) => ({ tree: replace(s.tree) }));
    void get().saveWindow();
  },

  clearPane: async (id) => {
    // Stop the running SDK session — main also drops the saved session
    // state on stop so the next bind starts fresh, but we explicitly
    // call deleteTranscript afterwards to wipe the JSONL on disk.
    try {
      await window.cowork.session.stop(id);
    } catch {
      /* ignore — session may already be gone */
    }
    try {
      await window.cowork.state.deleteTranscript(id);
    } catch {
      /* ignore */
    }
    // Reset the renderer-side runtime, preserving the agent binding
    // so the same agent can re-bind on the next interaction.
    const existing = get().panes[id];
    if (!existing) return;
    set((s) => ({
      panes: {
        ...s.panes,
        [id]: {
          id,
          agentName: existing.agentName,
          status: 'idle',
          items: [],
          sessionId: undefined,
          error: undefined,
        },
      },
    }));
    // Auto-restart so the user can keep working — same agent, blank slate.
    if (existing.agentName) {
      if (id === get().leadPaneId) {
        void get().setLeadAgent(existing.agentName);
      } else {
        void get().setPaneAgent(id, existing.agentName);
      }
    }
  },

  setPaneAgent: async (id, agentName) => {
    // If this is the Lead pane, route through the Lead-specific start
    // path so the orchestrator MCP tools are wired up.
    if (id === get().leadPaneId) {
      await get().setLeadAgent(agentName);
      return;
    }
    // If the pane was previously a terminal worker, kill its PTY so
    // we don't leak a shell when the pane flips back to an agent.
    // We ALSO strip workerKind / presetId from the persisted tree
    // leaf — otherwise bakeAgentsIntoTree's fallback (`runtime?.workerKind
    // ?? node.workerKind`) sees the empty new runtime and resurrects
    // the leaf's stale 'terminal' kind on the next save. That bug
    // surfaced as "I swapped Gemini CLI to an agent, locked my
    // laptop, came back, and the agent pane was gone — Gemini was
    // back". The agentName replacement still happens via the runtime
    // overwrite below; this just ensures the leaf doesn't lie.
    const previous = get().panes[id];
    if (previous?.workerKind === 'terminal') {
      // Terminal-to-agent swap: tear down the pooled session so the
      // PTY + xterm don't linger after the pane re-binds. Same fn
      // closePane uses; both are safe if the session was already
      // gone.
      try {
        await destroyTerminalSession(id);
      } catch {
        // already gone — fine.
      }
      const stripTerminalMarkers = (node: PaneNode): PaneNode => {
        if (node.kind === 'leaf') {
          if (node.id !== id) return node;
          const {
            workerKind: _wk,
            presetId: _pid,
            agentName: _an,
            ...rest
          } = node;
          return rest;
        }
        return {
          ...node,
          children: node.children.map(stripTerminalMarkers),
        };
      };
      set((s) => ({ tree: stripTerminalMarkers(s.tree) }));
    }
    const { cwd, windowId } = get();
    if (!cwd) {
      // Use the function form of set() so we merge against the latest
      // panes object — concurrent setPaneAgent calls (e.g. from a voice
      // tool dispatching multiple add_pane_to_session in parallel) would
      // otherwise stomp each other's writes.
      set((s) => ({
        panes: {
          ...s.panes,
          [id]: {
            ...(s.panes[id] ?? { id, status: 'idle', items: [] }),
            error: 'Pick a project folder first.',
            status: 'error',
          },
        },
      }));
      return;
    }

    // Load transcript if it exists (resume case).
    const transcript = await window.cowork.state.loadTranscript(id);
    const items = transcriptToItems(transcript);

    // Function-form set() so we merge against the latest panes — see
    // the no-cwd branch above for the rationale (concurrent voice tool
    // dispatch was clobbering one pane's binding when two calls fired
    // in quick succession).
    set((s) => ({
      panes: {
        ...s.panes,
        [id]: {
          id,
          agentName,
          status: 'starting',
          items,
          error: undefined,
        },
      },
    }));

    const otherAgentNames = Object.values(get().panes)
      .filter((p) => p.id !== id && p.agentName)
      .map((p) => p.agentName as string);

    const { windowMode, leadPaneId, memoryScope } = get();
    // In Lead mode every non-Lead pane is a sub-agent — sub-agents
    // never get the project memory injected (per design).
    const isSubAgent = windowMode === 'lead' && id !== leadPaneId;

    try {
      await window.cowork.session.start({
        paneId: id,
        windowId,
        agentName,
        cwd,
        otherAgentNames,
        isSubAgent,
        memoryScope,
      });
      void get().saveWindow();
    } catch (err) {
      set((s) => ({
        panes: {
          ...s.panes,
          [id]: {
            ...(s.panes[id] ?? { id, status: 'idle', items: [] }),
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          },
        },
      }));
    }
  },

  splitPane: (id, direction) => {
    const { tree, panes } = get();
    const path = findPath(tree, id);
    if (!path) return;
    const leaf = nodeAt(tree, path);
    if (!leaf || leaf.kind !== 'leaf') return;
    const newLeaf: PaneNode = { kind: 'leaf', id: nanoid(8) };
    const splitNode: PaneNode = {
      kind: 'split',
      direction,
      children: [leaf, newLeaf],
      sizes: [50, 50],
    };
    const nextTree = replaceAtPath(tree, path, splitNode);
    set({
      tree: nextTree,
      panes: {
        ...panes,
        [newLeaf.kind === 'leaf' ? newLeaf.id : '']: {
          id: newLeaf.kind === 'leaf' ? newLeaf.id : '',
          status: 'idle',
          items: [],
        },
      },
      activePaneId: newLeaf.kind === 'leaf' ? newLeaf.id : id,
    });
    void get().saveWindow();
  },

  closePane: async (id) => {
    const { tree, panes, activePaneId } = get();
    const closing = panes[id];
    const { tree: next } = removeLeaf(tree, id);
    const newTree = next ?? initialTree();
    const nextPanes = { ...panes };
    delete nextPanes[id];
    // Ensure remaining leaves have runtime entries.
    for (const leafId of collectLeaves(newTree)) {
      if (!nextPanes[leafId]) {
        nextPanes[leafId] = { id: leafId, status: 'idle', items: [] };
      }
    }
    // Stop whatever was driving this pane. Agent panes have an SDK
    // session in main; terminal panes have a pooled session that
    // owns the PTY + xterm. Either way we want a clean shutdown so
    // we don't leak processes on close.
    //
    // For terminals we route through `destroyTerminalSession` (which
    // kills the PTY AND drops the pool entry + disposes xterm).
    // We can't just `terminal.kill(ptyId)` directly any more — the
    // pool would leave a dangling session reference around, and on
    // a future pane bind to the same id it'd reuse the dead PTY.
    if (closing?.workerKind === 'terminal') {
      try {
        await destroyTerminalSession(id);
      } catch {
        // already gone — ignore
      }
    } else {
      try {
        await window.cowork.session.stop(id);
      } catch {
        // ignore
      }
    }
    let newActive = activePaneId;
    if (newActive === id || !nextPanes[newActive ?? '']) {
      newActive = collectLeaves(newTree)[0] ?? null;
    }
    set({ tree: newTree, panes: nextPanes, activePaneId: newActive });
    void get().saveWindow();
  },

  submitAskUserQuestion: async (paneId, requestId, answers) => {
    // Mark the chat item as answered FIRST — gives the user instant
    // feedback that their submission registered, even before main
    // round-trips. The form component checks `answers !== undefined`
    // to switch to its summary view.
    set((s) => {
      const pane = s.panes[paneId];
      if (!pane) return s;
      const idx = pane.items.findIndex(
        (it) => it.kind === 'ask_user_question' && it.requestId === requestId,
      );
      if (idx === -1) return s;
      const target = pane.items[idx];
      if (target.kind !== 'ask_user_question') return s;
      const nextItems = [...pane.items];
      nextItems[idx] = { ...target, answers };
      return {
        panes: {
          ...s.panes,
          [paneId]: { ...pane, items: nextItems },
        },
      };
    });
    try {
      await window.cowork.askUserQuestion?.answer({
        requestId,
        answer: { answers },
      });
    } catch {
      // Main's resolveAnswer just returns { ok }; even if the IPC
      // round-trip failed (window torn down etc.), the form is
      // already marked answered, so the user sees a stable UI.
    }
  },

  setPaneToTerminal: async (id, presetId) => {
    // Lead-pane is reserved for orchestrator agents. Trying to drop a
    // CLI preset there would break the Lead-mode invariants, so we
    // silently noop. The UI also gates the click but defence-in-depth.
    if (id === get().leadPaneId) return;
    const previous = get().panes[id];
    // Idempotent: same preset already bound = nothing to do.
    if (
      previous?.workerKind === 'terminal' &&
      previous.presetId === presetId
    ) {
      return;
    }
    // Tear down whatever was previously running in this pane.
    // Terminal preset swap (codex → claude-code, say) goes through
    // destroyTerminalSession so the renderer-side xterm pool stays
    // in sync with main's PTY teardown.
    if (previous?.workerKind === 'terminal') {
      try {
        await destroyTerminalSession(id);
      } catch {
        // already gone
      }
    } else if (previous?.agentName) {
      try {
        await window.cowork.session.stop(id);
      } catch {
        // ignore
      }
    }
    // Flip the runtime entry. TerminalPane will see workerKind ===
    // 'terminal' on mount, find no ptyId, and spawn a fresh one. We
    // also clear agent-flavoured fields so the chat UI doesn't
    // briefly flash before the branch happens in Pane.tsx.
    set((s) => ({
      panes: {
        ...s.panes,
        [id]: {
          id,
          status: 'idle',
          items: [],
          workerKind: 'terminal',
          presetId,
        },
      },
    }));
    // Mirror the change onto the persisted tree leaf so a save / app
    // reload sees the same kind on next launch.
    const updateLeaf = (node: PaneNode): PaneNode => {
      if (node.kind === 'leaf') {
        if (node.id !== id) return node;
        const { agentName: _stripped, ...rest } = node;
        return {
          ...rest,
          workerKind: 'terminal',
          presetId,
        };
      }
      return { ...node, children: node.children.map(updateLeaf) };
    };
    set((s) => ({ tree: updateLeaf(s.tree) }));
    void get().saveWindow();
  },

  setPanePtyId: (id, ptyId) => {
    set((s) => {
      const existing = s.panes[id];
      if (!existing) return s;
      return {
        panes: {
          ...s.panes,
          [id]: {
            ...existing,
            ptyId: ptyId ?? undefined,
          },
        },
      };
    });
  },

  updateSizes: (path, sizes) => {
    const { tree } = get();
    const target = nodeAt(tree, path);
    if (!target || target.kind !== 'split') return;
    const updated: PaneNode = { ...target, sizes };
    set({ tree: replaceAtPath(tree, path, updated) });
    // Debounce: saveWindow is called on other transitions; we skip saving on drag.
  },

  sendMessage: async (id, text, images) => {
    const hasText = text.trim().length > 0;
    const hasImages = !!images && images.length > 0;
    if (!hasText && !hasImages) return;
    await window.cowork.session.send(id, text, images);
  },

  interrupt: async (id) => {
    await window.cowork.session.interrupt(id);
  },

  handleEvent: (ev) => {
    set((s) => {
      const pane = s.panes[ev.paneId];
      if (!pane) return s;
      const nextPane: PaneRuntime = { ...pane, items: pane.items.slice() };
      switch (ev.kind) {
        case 'status':
          nextPane.status = ev.status;
          if (ev.error) nextPane.error = ev.error;
          break;
        case 'user':
          nextPane.items.push({
            id: nanoid(8),
            kind: 'user',
            text: ev.text,
            images: ev.images,
            ts: ev.ts,
          });
          break;
        case 'assistant_text':
          nextPane.items.push({
            id: nanoid(8),
            kind: 'assistant_text',
            text: ev.text,
            ts: ev.ts,
          });
          break;
        case 'tool_use':
          nextPane.items.push({
            id: nanoid(8),
            kind: 'tool_use',
            toolUseId: ev.toolUseId,
            name: ev.name,
            input: ev.input,
            ts: ev.ts,
          });
          break;
        case 'tool_result':
          nextPane.items.push({
            id: nanoid(8),
            kind: 'tool_result',
            toolUseId: ev.toolUseId,
            content: ev.content,
            isError: ev.isError,
            ts: ev.ts,
          });
          break;
        case 'result':
          nextPane.items.push({
            id: nanoid(8),
            kind: 'result',
            subtype: ev.subtype,
            durationMs: ev.durationMs,
            totalCostUsd: ev.totalCostUsd,
            numTurns: ev.numTurns,
            ts: ev.ts,
          });
          if (ev.sessionId) nextPane.sessionId = ev.sessionId;
          if (s.soundEnabled) {
            if (ev.subtype === 'success') playSuccessChime();
            else playErrorTone();
          }
          break;
      }

      // If a result lands in a project the user isn't currently
      // viewing, mark that session so the sidebar / workspace pill
      // can surface a green "completed work elsewhere" indicator.
      // Cleared when the user switches into that project.
      let nextSessions = s.sessions;
      if (ev.kind === 'result' && ev.subtype === 'success') {
        const ownerId = findSessionIdForPane(s.sessions, ev.paneId);
        if (ownerId && ownerId !== s.windowId) {
          nextSessions = s.sessions.map((sess) =>
            sess.id === ownerId
              ? { ...sess, hasUnreadCompletion: true }
              : sess,
          );
        }
      }
      return {
        panes: { ...s.panes, [ev.paneId]: nextPane },
        sessions: nextSessions,
      };
    });
  },

  saveWindow: async () => {
    const { windowId, cwd, tree, panes, windowMode, leadPaneId, memoryScope, sessions, previewUrl } = get();
    if (!cwd) return;
    const lastSessionIds: Record<PaneId, string> = {};
    for (const p of Object.values(panes)) {
      if (p.sessionId) lastSessionIds[p.id] = p.sessionId;
    }
    const lead =
      windowMode === 'lead' && leadPaneId
        ? {
            paneId: leadPaneId,
            agentName: panes[leadPaneId]?.agentName,
            ...(get().leadPaneName ? { paneName: get().leadPaneName! } : {}),
          }
        : undefined;
    // Preserve any existing name for this session; default to the folder
    // basename so new sessions look reasonable in the SessionsList until
    // the user renames them.
    const existing = sessions.find((s) => s.id === windowId);
    const name =
      existing?.name && existing.name.trim().length > 0
        ? existing.name
        : deriveSessionName(cwd);
    const next: WindowState = {
      id: windowId,
      name,
      cwd,
      tree: bakeAgentsIntoTree(tree, panes),
      windowMode,
      lead,
      memoryScope,
      lastSessionIds,
      previewUrl: previewUrl ?? undefined,
      // Preserve fields that don't live in top-level reactive state
      // but belong to the project: worktree linkage and the flow
      // definition. Without these the saved snapshot would silently
      // strip them on every preview-URL save / pane add — that's how
      // the worktree indentation, WT badge, and Review chip kept
      // disappearing after innocuous actions like opening Preview.
      // Mirrors the same preservation pass in snapshotActive().
      parentProjectId: existing?.parentProjectId,
      worktreeBranch: existing?.worktreeBranch,
      worktreeBase: existing?.worktreeBase,
      pipeline: get().pipeline ?? existing?.pipeline,
    };
    await window.cowork.state.saveWindow(next);
    // Mirror the saved entry in our in-memory sessions list so the
    // SessionsList sidebar shows live state without a round-trip.
    set((s) => {
      const idx = s.sessions.findIndex((x) => x.id === next.id);
      const nextSessions =
        idx >= 0
          ? s.sessions.map((x, i) => (i === idx ? next : x))
          : [...s.sessions, next];
      return { sessions: nextSessions };
    });
  },

  /**
   * Create a new workspace. Pops the folder picker so the user can
   * give the workspace its first project — without a project a
   * workspace would just be a label with nothing in it. If the user
   * cancels the folder picker, we still create the workspace (empty)
   * and switch to it; they can click "+ New" to add projects later.
   */
  createWorkspace: async (name) => {
    const id = nanoid(10);
    const trimmed = (name ?? '').trim();
    const folder = await window.cowork.workspace.pickFolder();
    let firstProjectId: string | undefined;
    if (folder) {
      void window.cowork.memory.ensure(folder).catch(() => undefined);
      const newSessionId = nanoid(10);
      const newPaneId = nanoid(8);
      const project: WindowState = {
        id: newSessionId,
        name: deriveSessionName(folder),
        cwd: folder,
        tree: { kind: 'leaf', id: newPaneId },
        windowMode: 'multi',
        memoryScope: 'project',
        lastSessionIds: {},
      };
      await window.cowork.state.saveWindow(project);
      firstProjectId = newSessionId;
      set((s) => ({
        sessions: [...s.sessions, project],
        panes: {
          ...s.panes,
          [newPaneId]: { id: newPaneId, status: 'idle', items: [] },
        },
      }));
    }

    const ws: Workspace = {
      id,
      name:
        trimmed.length > 0
          ? trimmed
          : `Workspace ${get().workspaces.length + 1}`,
      projectIds: firstProjectId ? [firstProjectId] : [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    await window.cowork.state.saveWorkspace(ws);
    await window.cowork.state.setActiveWorkspace(ws.id);
    set((s) => ({
      workspaces: [...s.workspaces, ws],
      activeWorkspaceId: ws.id,
    }));

    if (firstProjectId) {
      await get().switchSession(firstProjectId);
    }
    // If the user cancelled the folder picker we leave existing
    // sessions running. They belong to the previous workspace's
    // projects and will resume cleanly when the user switches back.
  },

  /**
   * Switch to a different workspace. Sessions in the outgoing
   * workspace stay alive in the SessionPool — coming back later
   * resumes them. Each project keeps its own pane state on its
   * WindowState, so the panes map can grow across workspaces without
   * conflicts.
   */
  switchWorkspace: async (id) => {
    if (id === get().activeWorkspaceId) return;
    const target = get().workspaces.find((w) => w.id === id);
    if (!target) return;

    snapshotActive(get, set);
    set({ activeWorkspaceId: id });
    await window.cowork.state.setActiveWorkspace(id);

    if (target.projectIds.length === 0) {
      // Empty workspace — clear the *foreground* but leave the panes
      // map alone. Sessions for the previous workspace's panes keep
      // running in the SessionPool and reconnect when the user
      // switches back to a workspace that owns them.
      const placeholderLeafId = nanoid(8);
      set((s) => ({
        windowId: nanoid(10),
        cwd: null,
        tree: { kind: 'leaf', id: placeholderLeafId },
        activePaneId: placeholderLeafId,
        windowMode: 'multi',
        leadPaneId: null,
        leadPaneName: null,
        previewUrl: null,
        terminalLocalhostUrls: [],
        panes: {
          ...s.panes,
          [placeholderLeafId]: {
            id: placeholderLeafId,
            status: 'idle',
            items: [],
          },
        },
      }));
      await window.cowork.state.setActiveSession(undefined);
      return;
    }
    await get().switchSession(target.projectIds[0]);
  },

  /** Rename a workspace in place. */
  renameWorkspace: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const existing = get().workspaces.find((w) => w.id === id);
    if (!existing || existing.name === trimmed) return;
    const updated: Workspace = {
      ...existing,
      name: trimmed,
      updatedAt: Date.now(),
    };
    await window.cowork.state.saveWorkspace(updated);
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === id ? updated : w)),
    }));
  },

  /**
   * Delete a workspace and every project inside it. If the active
   * workspace is the one being deleted, switch to another workspace
   * if any, or clear to the empty state.
   */
  deleteWorkspaceById: async (id) => {
    const ws = get().workspaces.find((w) => w.id === id);
    if (!ws) return;
    const isActive = get().activeWorkspaceId === id;
    if (isActive && get().workspaces.length === 1) {
      alert(
        "Can't delete the only workspace — create another one first.",
      );
      return;
    }
    const ok = confirm(
      `Delete workspace "${ws.name}" and close its ${ws.projectIds.length} project(s)? Transcripts and agent files are not affected.`,
    );
    if (!ok) return;

    for (const projectId of ws.projectIds) {
      const session = get().sessions.find((s) => s.id === projectId);
      if (!session) continue;
      const paneIds = collectLeaves(session.tree);
      if (session.windowMode === 'lead' && session.lead) {
        paneIds.push(session.lead.paneId);
      }
      for (const paneId of paneIds) {
        try {
          await window.cowork.session.stop(paneId);
        } catch {
          /* ignore */
        }
      }
      await window.cowork.state.deleteWindow(projectId);
    }
    await window.cowork.state.deleteWorkspace(id);

    const remainingSessions = get().sessions.filter(
      (s) => !ws.projectIds.includes(s.id),
    );
    const remainingWorkspaces = get().workspaces.filter((w) => w.id !== id);

    if (isActive) {
      const next = remainingWorkspaces[0];
      set({
        sessions: remainingSessions,
        workspaces: remainingWorkspaces,
        activeWorkspaceId: next?.id ?? null,
      });
      if (next) {
        await window.cowork.state.setActiveWorkspace(next.id);
        if (next.projectIds.length > 0) {
          await get().switchSession(next.projectIds[0]);
        } else {
          // Empty workspace — clear foreground but keep panes alive
          // (they may still be referenced by other workspaces).
          set({
            windowId: nanoid(10),
            cwd: null,
            tree: { kind: 'leaf', id: nanoid(8) },
            activePaneId: null,
          });
          await window.cowork.state.setActiveSession(undefined);
        }
      } else {
        await window.cowork.state.setActiveWorkspace(undefined);
      }
    } else {
      set({
        sessions: remainingSessions,
        workspaces: remainingWorkspaces,
      });
    }
  },

  // -- UI toggles -----------------------------------------------------------

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),

  setMissionControlOpen: (open) => set({ missionControlOpen: open }),

  // -- PR inbox actions ---------------------------------------------------
  setPrModalOpen: (open) => {
    set({ prModalOpen: open });
    // Opening with stale or missing data → kick off a fresh fetch.
    if (open) {
      const s = get();
      const inbox = s.prInboxes[s.windowId];
      const stale =
        !inbox ||
        inbox.notAvailable ||
        Date.now() - inbox.syncedAt > 5 * 60 * 1000;
      if (stale && !inbox?.syncing) void s.refreshPrs();
    }
  },

  refreshPrs: async () => {
    const { cwd, windowId } = get();
    if (!cwd || !windowId) return;
    set((s) => ({
      prInboxes: {
        ...s.prInboxes,
        [windowId]: {
          ...(s.prInboxes[windowId] ?? {
            syncedAt: 0,
            prs: [],
          }),
          syncing: true,
        },
      },
    }));
    try {
      // Fast availability probe first — if gh isn't set up, render an
      // inline hint in the modal instead of an opaque error banner.
      const available = await window.cowork.pr.available(cwd);
      if (!available) {
        set((s) => ({
          prInboxes: {
            ...s.prInboxes,
            [windowId]: {
              syncedAt: Date.now(),
              prs: [],
              syncing: false,
              notAvailable: true,
            },
          },
        }));
        return;
      }
      const prs = await window.cowork.pr.list(cwd);
      set((s) => ({
        prInboxes: {
          ...s.prInboxes,
          [windowId]: {
            syncedAt: Date.now(),
            prs,
            syncing: false,
            notAvailable: false,
          },
        },
      }));
      // Prefetch full details for open PRs in the background so the
      // detail view opens instantly. Only fetches PRs that are
      // missing from the cache OR whose updatedAt has advanced —
      // skips ones whose snapshot is still fresh.
      void prefetchOpenPrDetails(get, set);
    } catch (err) {
      set((s) => ({
        prInboxes: {
          ...s.prInboxes,
          [windowId]: {
            ...(s.prInboxes[windowId] ?? { syncedAt: 0, prs: [] }),
            syncing: false,
            error: cleanIpcError(err),
          },
        },
      }));
    }
  },

  openPrDetail: async (number) => {
    const { cwd, prDetails, prInboxes, windowId } = get();
    if (!cwd) return;
    const cached = prDetails[number];
    const summary = prInboxes[windowId]?.prs.find((p) => p.number === number);
    // If we have a cache hit and it's not obviously stale (the
    // summary's updatedAt didn't advance), show the cached detail
    // immediately — instant open, no spinner.
    const stale =
      cached && summary && summary.updatedAt !== cached.updatedAt;
    if (cached && !stale) {
      set({ prDetail: cached, prDetailLoading: false, prDetailError: null });
      return;
    }
    // Cache miss or stale: paint cached entry first if any (so the
    // user sees something while the fresh fetch lands), then fetch.
    if (cached) {
      set({ prDetail: cached, prDetailLoading: true, prDetailError: null });
    } else {
      set({ prDetailLoading: true, prDetailError: null });
    }
    try {
      const detail = await window.cowork.pr.detail(cwd, number);
      set((s) => ({
        prDetail: detail,
        prDetailLoading: false,
        prDetails: { ...s.prDetails, [number]: detail },
      }));
    } catch (err) {
      set({
        prDetailLoading: false,
        prDetailError: cleanIpcError(err),
      });
    }
  },

  closePrDetail: () =>
    set({ prDetail: null, prDetailError: null, prDetailLoading: false }),

  refreshPrDetail: async (number) => {
    const { cwd } = get();
    if (!cwd) return;
    try {
      const detail = await window.cowork.pr.detail(cwd, number);
      set((s) => ({
        // Only swap the active prDetail if it's still pointing at
        // this PR — the user might have navigated away during the
        // fetch. The cache update is unconditional.
        prDetail:
          s.prDetail?.number === number ? detail : s.prDetail,
        prDetails: { ...s.prDetails, [number]: detail },
      }));
    } catch {
      // Best-effort. If the refetch fails (network blip, gh auth
      // expired), the user can hit the manual refresh button.
    }
  },

  openCheckLog: async (runId) => {
    const { cwd, prCheckLogs } = get();
    if (!cwd) return;
    // Logs don't change for a given run id (re-runs get new ids), so
    // a cache hit always wins — no spinner, no fetch.
    const cached = prCheckLogs[runId];
    if (cached !== undefined) {
      set({
        prCheckLog: { runId, text: cached },
        prCheckLogLoading: false,
        prCheckLogError: null,
      });
      return;
    }
    set({
      prCheckLogLoading: true,
      prCheckLogError: null,
      prCheckLog: { runId, text: '' },
    });
    try {
      const text = await window.cowork.pr.checkLogs(cwd, runId);
      set((s) => ({
        prCheckLog: { runId, text },
        prCheckLogLoading: false,
        prCheckLogs: { ...s.prCheckLogs, [runId]: text },
      }));
    } catch (err) {
      set({
        prCheckLogLoading: false,
        prCheckLogError: cleanIpcError(err),
      });
    }
  },

  closeCheckLog: () =>
    set({
      prCheckLog: null,
      prCheckLogError: null,
      prCheckLogLoading: false,
    }),

  seedPaneInput: (paneId, text) => {
    // Bring the target pane to focus first so the user lands on it
    // when the PR drawer dismisses. The Pane component picks up the
    // seed via its own effect.
    set({
      pendingPaneSeed: { paneId, text, nonce: Date.now() },
      activePaneId: paneId,
    });
  },

  consumePaneSeed: () => set({ pendingPaneSeed: null }),

  recordPrCommentDispatch: (commentId, paneId) => {
    set((s) => {
      // Cap to the most-recent N entries so the map doesn't grow
      // unbounded across months of use. Drop the oldest by sentAt.
      const next: typeof s.prCommentDispatches = {
        ...s.prCommentDispatches,
        [commentId]: { paneId, sentAt: Date.now() },
      };
      const entries = Object.entries(next);
      if (entries.length > MAX_PR_COMMENT_DISPATCHES) {
        entries.sort((a, b) => b[1].sentAt - a[1].sentAt);
        const trimmed = Object.fromEntries(
          entries.slice(0, MAX_PR_COMMENT_DISPATCHES),
        );
        savePrCommentDispatches(trimmed);
        return { prCommentDispatches: trimmed };
      }
      savePrCommentDispatches(next);
      return { prCommentDispatches: next };
    });
  },

  setMemoryScope: (scope) => {
    set({ memoryScope: scope });
    void get().saveWindow();
  },

  toggleSidebarCollapsed: () =>
    set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

  refreshUsage: async () => {
    try {
      const summary = await window.cowork.usage.summary();
      set({ usage: summary });
    } catch {
      // ignore — telemetry should never break the app
    }
  },

  setWindowMode: (mode) => {
    if (mode === get().windowMode) return;
    set({ windowMode: mode });
    if (mode === 'lead') {
      // Materialize a Lead pane if we don't have one yet, and focus it
      // so the next agent-click in the sidebar assigns the Lead role.
      const { leadPaneId, panes } = get();
      let id = leadPaneId;
      if (!id || !panes[id]) {
        id = nanoid(8);
        set({
          leadPaneId: id,
          panes: {
            ...panes,
            [id]: { id, status: 'idle', items: [] },
          },
        });
      }
      set({ activePaneId: id });
    }
  },

  setLeadAgent: async (agentName) => {
    const { cwd, windowId, leadPaneId, panes } = get();
    if (!cwd) return;
    const paneId = leadPaneId ?? nanoid(8);
    if (!leadPaneId) {
      set({
        leadPaneId: paneId,
        panes: {
          ...panes,
          [paneId]: { id: paneId, status: 'idle', items: [] },
        },
      });
    }
    // Load existing transcript so a hydrated lead pane shows its
    // history immediately. Without this, project-switching back to a
    // Lead-mode session would re-show an empty conversation while the
    // SDK silently resumed the underlying session id from disk.
    const transcript = await window.cowork.state
      .loadTranscript(paneId)
      .catch(() => []);
    const items = transcriptToItems(transcript);
    set((s) => ({
      panes: {
        ...s.panes,
        [paneId]: {
          ...(s.panes[paneId] ?? { id: paneId, status: 'idle', items: [] }),
          agentName,
          status: 'starting',
          items,
          error: undefined,
        },
      },
    }));
    const otherAgentNames = Object.values(get().panes)
      .filter((p) => p.id !== paneId && p.agentName)
      .map((p) => p.agentName as string);
    const { memoryScope } = get();
    try {
      await window.cowork.session.start({
        paneId,
        windowId,
        agentName,
        cwd,
        otherAgentNames,
        isLead: true,
        memoryScope,
      });
    } catch (err) {
      set((s) => ({
        panes: {
          ...s.panes,
          [paneId]: {
            ...(s.panes[paneId] ?? { id: paneId, status: 'idle', items: [] }),
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          },
        },
      }));
    }
  },

  applyLayoutTemplate: (cols, rows) => {
    const { panes, leadPaneId } = get();
    // Stop every current sub-agent session — the tree is about to be
    // replaced. The Lead pane lives outside the tree so we leave it
    // running untouched.
    for (const p of Object.values(panes)) {
      if (p.id === leadPaneId) continue;
      void window.cowork.session.stop(p.id);
    }
    const tree = buildGridTree(cols, rows);
    const nextPanes: Record<PaneId, PaneRuntime> = {};
    // Preserve the Lead pane verbatim so its agent + session + transcript
    // survive template application.
    if (leadPaneId && panes[leadPaneId]) {
      nextPanes[leadPaneId] = panes[leadPaneId];
    }
    for (const leafId of collectLeaves(tree)) {
      nextPanes[leafId] = { id: leafId, status: 'idle', items: [] };
    }
    set({
      tree,
      panes: nextPanes,
      activePaneId: collectLeaves(tree)[0] ?? leadPaneId ?? null,
    });
    void get().saveWindow();
  },

  toggleSound: () => set((s) => ({ soundEnabled: !s.soundEnabled })),

  // -- Editor ---------------------------------------------------------------

  openAgentEditor: (agent) => {
    const draft: AgentDraft = agent
      ? {
          name: agent.name,
          description: agent.description,
          // Carry every editable field through, otherwise reopening the
          // editor and saving would silently strip values like skills,
          // color, emoji, or vibe from the agent's frontmatter.
          model: agent.model,
          tools: agent.tools,
          skills: agent.skills,
          mcpServers: agent.mcpServers,
          color: agent.color,
          emoji: agent.emoji,
          vibe: agent.vibe,
          body: agent.body,
          scope: agent.scope,
          originalFilePath: agent.filePath,
        }
      : {
          name: '',
          description: '',
          model: '',
          body: '',
          scope: 'user',
        };
    set({
      editor: { kind: 'agent', draft },
      editorError: undefined,
      editorSaving: false,
    });
  },

  openSkillEditor: (skill) => {
    const draft: SkillDraft = skill
      ? {
          name: skill.name,
          description: skill.description,
          body: skill.body,
          scope: skill.scope,
          originalFilePath: skill.filePath,
        }
      : {
          name: '',
          description: '',
          body: '',
          scope: 'user',
        };
    set({
      editor: { kind: 'skill', draft },
      editorError: undefined,
      editorSaving: false,
    });
  },

  updateEditor: (patch) => {
    set((s) => {
      if (!s.editor) return s;
      if (s.editor.kind === 'agent') {
        return {
          editor: {
            kind: 'agent',
            draft: { ...s.editor.draft, ...(patch as Partial<AgentDraft>) },
          },
          editorError: undefined,
        };
      }
      return {
        editor: {
          kind: 'skill',
          draft: { ...s.editor.draft, ...(patch as Partial<SkillDraft>) },
        },
        editorError: undefined,
      };
    });
  },

  closeEditor: () => set({ editor: null, editorError: undefined }),

  saveEditor: async () => {
    const { editor, cwd } = get();
    if (!editor) return;
    set({ editorSaving: true, editorError: undefined });
    try {
      // Attach the active project's cwd so the main process can write
      // new project-scoped agents/skills into `<cwd>/.claude/<kind>/`.
      // Edits of existing project files don't strictly need this (the
      // location is derived from `originalFilePath`), but passing it
      // anyway is harmless and lets the renderer stay agnostic.
      const draft = { ...editor.draft, projectCwd: cwd ?? undefined };
      if (editor.kind === 'agent') {
        await window.cowork.agents.save(draft);
      } else {
        await window.cowork.skills.save(draft);
      }
      await get().refreshAgents();
      set({ editor: null, editorSaving: false });
    } catch (err) {
      set({
        editorSaving: false,
        editorError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  deleteFromEditor: async () => {
    const { editor } = get();
    if (!editor) return;
    const filePath = editor.draft.originalFilePath;
    if (!filePath) {
      set({ editor: null });
      return;
    }
    set({ editorSaving: true, editorError: undefined });
    try {
      if (editor.kind === 'agent') {
        await window.cowork.agents.delete(filePath);
      } else {
        await window.cowork.skills.delete(filePath);
      }
      await get().refreshAgents();
      set({ editor: null, editorSaving: false });
    } catch (err) {
      set({
        editorSaving: false,
        editorError: err instanceof Error ? err.message : String(err),
      });
    }
  },

  // -- Sessions ----------------------------------------------------------

  createSession: async () => {
    const folder = await window.cowork.workspace.pickFolder();
    if (!folder) return;
    // Snapshot whatever's on screen so we don't lose it.
    snapshotActive(get, set);

    // The new project belongs to the active workspace. If somehow there
    // isn't one yet (first ever launch + cancelled folder pick race),
    // mint a default workspace so the project has a home.
    let activeWorkspaceId = get().activeWorkspaceId;
    if (!activeWorkspaceId) {
      const ws: Workspace = {
        id: nanoid(10),
        name: 'My Workspace',
        projectIds: [],
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      await window.cowork.state.saveWorkspace(ws);
      await window.cowork.state.setActiveWorkspace(ws.id);
      activeWorkspaceId = ws.id;
      set((s) => ({
        workspaces: [...s.workspaces, ws],
        activeWorkspaceId: ws.id,
      }));
    }

    const newId = nanoid(10);
    const newPaneId = nanoid(8);
    const name = deriveSessionName(folder);
    const initialState: WindowState = {
      id: newId,
      name,
      cwd: folder,
      tree: { kind: 'leaf', id: newPaneId },
      windowMode: 'multi',
      memoryScope: 'project',
      lastSessionIds: {},
    };
    void window.cowork.memory.ensure(folder).catch(() => undefined);
    set((s) => ({
      sessions: [...s.sessions, initialState],
      windowId: newId,
      cwd: folder,
      tree: initialState.tree,
      panes: {
        ...s.panes,
        [newPaneId]: { id: newPaneId, status: 'idle', items: [] },
      },
      activePaneId: newPaneId,
      windowMode: 'multi',
      leadPaneId: null,
      leadPaneName: null,
      memoryScope: 'project',
    }));
    await window.cowork.state.saveWindow(initialState);
    await window.cowork.state.setActiveSession(newId);

    // Append the new project id to the active workspace.
    const updatedWs: Workspace = {
      ...get().workspaces.find((w) => w.id === activeWorkspaceId)!,
      projectIds: [
        ...get().workspaces.find((w) => w.id === activeWorkspaceId)!.projectIds,
        newId,
      ],
      updatedAt: Date.now(),
    };
    await window.cowork.state.saveWorkspace(updatedWs);
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === activeWorkspaceId ? updatedWs : w,
      ),
    }));

    void get().refreshAgents();
  },

  createWorktreeProject: async ({
    parentProjectId,
    branchName,
    baseBranch,
    copyEnv,
  }) => {
    const parent = get().sessions.find((s) => s.id === parentProjectId);
    if (!parent) throw new Error('Parent project not found');

    snapshotActive(get, set);

    // Run the git worktree add (and env copy) in main; result is the
    // new folder we open as a project.
    const result = await window.cowork.system.worktreeCreate({
      parentCwd: parent.cwd,
      branchName,
      baseBranch,
      copyEnv,
    });

    void window.cowork.memory.ensure(result.worktreeCwd).catch(() => undefined);

    const newId = nanoid(10);
    const newPaneId = nanoid(8);
    // Name the project after the branch — it'll read as "Linodas Web ·
    // feature-x" mentally because the parent name is right above it
    // in the indented sidebar tree.
    const initialState: WindowState = {
      id: newId,
      name: branchName,
      cwd: result.worktreeCwd,
      tree: { kind: 'leaf', id: newPaneId },
      windowMode: 'multi',
      memoryScope: 'project',
      lastSessionIds: {},
      parentProjectId,
      worktreeBranch: result.branch,
      worktreeBase: result.base,
    };
    set((s) => ({
      sessions: [...s.sessions, initialState],
      windowId: newId,
      cwd: result.worktreeCwd,
      tree: initialState.tree,
      panes: {
        ...s.panes,
        [newPaneId]: { id: newPaneId, status: 'idle', items: [] },
      },
      activePaneId: newPaneId,
      windowMode: 'multi',
      leadPaneId: null,
      leadPaneName: null,
      memoryScope: 'project',
    }));
    await window.cowork.state.saveWindow(initialState);
    await window.cowork.state.setActiveSession(newId);

    // Insert the new project into the same workspace as its parent,
    // right after the parent in the project order so the sidebar
    // group reads naturally (parent → its worktrees → next project).
    const ws = get().workspaces.find((w) =>
      w.projectIds.includes(parentProjectId),
    );
    if (ws) {
      const parentIdx = ws.projectIds.indexOf(parentProjectId);
      // Find the last sibling worktree to insert after, so order stays
      // parent · wt1 · wt2 · wt3 even if we add them one by one.
      const sessions = get().sessions;
      let insertAfterIdx = parentIdx;
      for (let i = parentIdx + 1; i < ws.projectIds.length; i++) {
        const candidate = sessions.find((s) => s.id === ws.projectIds[i]);
        if (candidate?.parentProjectId === parentProjectId) {
          insertAfterIdx = i;
        } else {
          break;
        }
      }
      const updatedWs: Workspace = {
        ...ws,
        projectIds: [
          ...ws.projectIds.slice(0, insertAfterIdx + 1),
          newId,
          ...ws.projectIds.slice(insertAfterIdx + 1),
        ],
        updatedAt: Date.now(),
      };
      await window.cowork.state.saveWorkspace(updatedWs);
      set((s) => ({
        workspaces: s.workspaces.map((w) =>
          w.id === ws.id ? updatedWs : w,
        ),
      }));
    }

    void get().refreshAgents();
  },

  removeWorktreeProject: async ({ projectId, force, deleteBranch }) => {
    const project = get().sessions.find((s) => s.id === projectId);
    if (!project) return { warnings: [] };
    if (!project.parentProjectId) {
      throw new Error('Not a worktree — use closeSession instead.');
    }

    // Stop every pane in this project so we don't leave SDK processes
    // running against a folder we're about to delete.
    for (const leafId of collectLeaves(project.tree)) {
      try {
        await window.cowork.session.stop(leafId);
      } catch {
        /* ignore */
      }
    }
    if (project.lead?.paneId) {
      try {
        await window.cowork.session.stop(project.lead.paneId);
      } catch {
        /* ignore */
      }
    }

    let warnings: string[] = [];
    try {
      const res = await window.cowork.system.worktreeRemove({
        cwd: project.cwd,
        force,
        deleteBranch:
          deleteBranch && project.worktreeBranch
            ? project.worktreeBranch
            : undefined,
      });
      warnings = res.warnings;
    } catch (err) {
      throw err instanceof Error ? err : new Error(String(err));
    }

    // Drop persisted state and prune from workspaces.
    await window.cowork.state.deleteWindow(projectId);

    // Decide which project to switch to: prefer the parent, fall back
    // to whatever's left in the current workspace.
    const sessions = get().sessions.filter((s) => s.id !== projectId);
    const remainingPaneIds = new Set<PaneId>();
    for (const s of sessions) {
      for (const id of collectLeaves(s.tree)) remainingPaneIds.add(id);
      if (s.lead?.paneId) remainingPaneIds.add(s.lead.paneId);
    }
    const nextPanes: Record<PaneId, PaneRuntime> = {};
    for (const [id, pane] of Object.entries(get().panes)) {
      if (remainingPaneIds.has(id as PaneId)) nextPanes[id as PaneId] = pane;
    }

    set((s) => ({
      sessions,
      panes: nextPanes,
      workspaces: s.workspaces.map((w) =>
        w.projectIds.includes(projectId)
          ? {
              ...w,
              projectIds: w.projectIds.filter((id) => id !== projectId),
              updatedAt: Date.now(),
            }
          : w,
      ),
    }));

    // Persist the workspace prune.
    const ws = get().workspaces.find((w) => w.projectIds.length >= 0);
    void ws; // already updated in the set() above; main mirrors via deleteWindow's prune

    if (get().windowId === projectId) {
      const ws = get().workspaces.find((w) => w.id === get().activeWorkspaceId);
      const fallback = ws?.projectIds.includes(project.parentProjectId)
        ? project.parentProjectId
        : ws?.projectIds[0];
      if (fallback) {
        await get().switchSession(fallback);
      } else {
        set({
          windowId: nanoid(10),
          cwd: null,
          tree: { kind: 'leaf', id: nanoid(8) },
          activePaneId: null,
        });
        await window.cowork.state.setActiveSession(undefined);
      }
    }

    return { warnings };
  },

  // ── Pipeline ──────────────────────────────────────────────────────────
  // The pipeline definition lives on the active project's WindowState
  // (so it persists with saveWindow). We mirror the active pipeline
  // into top-level `pipeline` so components can subscribe to a single
  // source of truth without diffing the sessions array on every render.
  setPipelineView: (view) => {
    // Every entry to the board view re-syncs steps with the current
    // panes: drop steps whose paneId no longer exists, append new
    // panes at the end, preserve user-set ordering for ones that
    // survived. This is what makes the view stay correct when the
    // user adds/removes panes outside flow view.
    if (view === 'board') {
      const tree = get().tree;
      // Flow is a Multi-mode-only feature for AGENT panes only.
      // Terminal-kind panes (Claude Code, Codex, Aider, Gemini,
      // plain shell) are not part of the chain — they're rendered
      // by PipelineBoard as standalone info cards instead, since
      // we don't drive their PTYs from the flow runner. Filter
      // them out at every step so existing pipelines drop terminal
      // entries automatically when the user swaps a pane's kind.
      const allLeaves = collectLeavesWithAgents(tree);
      const agentLeaves = allLeaves.filter(
        (l) => l.workerKind !== 'terminal',
      );
      const agentLeafIds = new Set(agentLeaves.map((l) => l.id));
      const leadId = get().leadPaneId;
      const treeOrder: PaneId[] = agentLeaves.map((l) => l.id);

      const existing = get().pipeline;
      const existingSteps = existing?.steps ?? [];
      // Keep steps whose pane is (still) an agent pane AND isn't
      // the lead pane, in their saved order. A pane that was
      // converted to a terminal worker since the last visit is
      // no longer eligible and gets dropped.
      const survivors = existingSteps.filter(
        (s) => agentLeafIds.has(s.paneId) && s.paneId !== leadId,
      );
      const survivingIds = new Set(survivors.map((s) => s.paneId));
      // Append any live agent pane that wasn't in the saved order.
      // Terminals are deliberately omitted — see filter above.
      const newSteps: PipelineStep[] = [...survivors];
      for (const id of treeOrder) {
        if (!survivingIds.has(id)) {
          newSteps.push({
            id: nanoid(8),
            paneId: id,
            prompt: '',
          });
        }
      }

      if (newSteps.length === 0) {
        set({ pipelineView: view, pipeline: undefined });
        void persistActivePipeline(get, set, undefined);
        return;
      }

      const synced: Pipeline = {
        ...(existing ?? {}),
        steps: newSteps,
      };
      // Only persist if something actually changed, to avoid noisy writes.
      const changed =
        !existing ||
        existing.steps.length !== newSteps.length ||
        existing.steps.some(
          (s, i) =>
            newSteps[i].paneId !== s.paneId || newSteps[i].id !== s.id,
        );
      set({ pipeline: synced, pipelineView: view });
      if (changed) void persistActivePipeline(get, set, synced);
      return;
    }
    set({ pipelineView: view });
  },

  // ── Diff Review ──────────────────────────────────────────────────────
  // Loads the structured diff for the active worktree project against
  // its base branch. Only valid on worktree projects (where the
  // current session has worktreeBranch + worktreeBase set). On other
  // projects this is a no-op that surfaces an explanatory error.
  loadReview: async () => {
    const id = get().windowId;
    const session = get().sessions.find((s) => s.id === id);
    if (!session) {
      set({
        reviewError: 'No active project to review.',
        reviewState: undefined,
        reviewLoading: false,
      });
      return;
    }
    const baseBranch = session.worktreeBase;
    const worktreeBranch = session.worktreeBranch;
    if (!baseBranch || !worktreeBranch) {
      set({
        reviewError:
          'Diff review is available on worktree projects only — this project has no parent branch.',
        reviewState: undefined,
        reviewLoading: false,
      });
      return;
    }
    set({ reviewLoading: true, reviewError: null });
    try {
      const next = await window.cowork.review.loadDiff({
        cwd: session.cwd,
        baseBranch,
        worktreeBranch,
      });
      // If the user already had a file selected and it still exists in
      // the new diff, keep it; otherwise default to the first file.
      const prevSelected = get().reviewSelectedFile;
      const stillThere =
        prevSelected && next.files.some((f) => f.path === prevSelected);
      const selected = stillThere
        ? prevSelected
        : next.files[0]?.path ?? null;
      // Reset decisions on reload — hunk ids may have shifted (the
      // file changed under us), so prior decisions can't be safely
      // re-applied. Default everyone to pending, fresh slate.
      set({
        reviewState: next,
        reviewLoading: false,
        reviewError: null,
        reviewSelectedFile: selected,
        reviewHunkDecisions: {},
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({
        reviewLoading: false,
        reviewError: msg,
      });
    }
  },

  setReviewSelectedFile: (path) => set({ reviewSelectedFile: path }),

  setHunkDecision: (hunkId, decision) => {
    const current = get().reviewHunkDecisions;
    // Toggle off: clicking the active state clears it back to pending.
    const existing = current[hunkId];
    const next = existing === decision ? 'pending' : decision;
    set({
      reviewHunkDecisions: { ...current, [hunkId]: next },
    });
  },

  approveAllHunks: () => {
    const state = get().reviewState;
    if (!state) return;
    const next: Record<string, 'pending' | 'approve' | 'reject'> = {
      ...get().reviewHunkDecisions,
    };
    for (const hunkId of Object.keys(state.hunksById)) {
      // Only flip pending → approve. Don't override an explicit
      // reject — if the user said no, we respect that.
      if (next[hunkId] !== 'reject') next[hunkId] = 'approve';
    }
    set({ reviewHunkDecisions: next });
  },

  applyHunkDecisions: async () => {
    const state = get().reviewState;
    const decisions = get().reviewHunkDecisions;
    if (!state) {
      return { revertedFiles: [], warnings: ['No review loaded.'] };
    }
    const session = get().sessions.find((s) => s.id === get().windowId);
    if (!session) {
      return { revertedFiles: [], warnings: ['No active project.'] };
    }
    // Collect rejected hunks; build per-file map of ALL hunks for
    // the all-rejected detection in main.
    const rejected = Object.entries(decisions)
      .filter(([, d]) => d === 'reject')
      .map(([id]) => state.hunksById[id])
      .filter(Boolean);
    if (rejected.length === 0) {
      // Nothing to do — all hunks are approved or pending. Pending
      // hunks stay in the working tree as-is (they ship with the
      // approved set in Phase 3 unless explicitly rejected).
      return { revertedFiles: [], warnings: [] };
    }
    const hunksByFile: Record<
      string,
      import('@shared/types').ReviewHunk[]
    > = {};
    for (const h of Object.values(state.hunksById)) {
      const arr = hunksByFile[h.file] ?? [];
      arr.push(h);
      hunksByFile[h.file] = arr;
    }

    set({ reviewApplying: true });
    try {
      const result = await window.cowork.review.applyDecisions({
        cwd: session.cwd,
        rejectedHunks: rejected,
        hunksByFile,
      });
      // Refresh diff so the UI reflects the post-apply state.
      await get().loadReview();
      set({ reviewApplying: false });
      return result;
    } catch (err) {
      set({ reviewApplying: false });
      const msg = err instanceof Error ? err.message : String(err);
      return { revertedFiles: [], warnings: [msg] };
    }
  },

  sendBackToAgent: async ({ paneId, note }) => {
    // Two steps: (1) revert the rejected hunks (so the agent sees a
    // clean slate for the parts we didn't accept), (2) post the
    // explanation note as a new user message in the agent's pane,
    // which kicks off a new turn.
    const trimmed = note.trim();
    if (!trimmed) return;

    // Apply pending rejects first so the working tree matches what
    // we're about to ask the agent to redo.
    await get().applyHunkDecisions();

    // Then post the note. window.cowork.session.send drives a normal
    // user-turn into the pane, including the agent's full reply
    // event stream — same code path as typing in the composer.
    try {
      await window.cowork.session.send(paneId, trimmed);
    } catch {
      // Surfaced via the pane's own error path — nothing to do here.
    }
  },

  loadGhStatus: async () => {
    const session = get().sessions.find((s) => s.id === get().windowId);
    if (!session) return;
    try {
      const status = await window.cowork.review.ghStatus({ cwd: session.cwd });
      set({ ghStatus: status });
    } catch {
      // Detection itself shouldn't throw — but if it does, treat as
      // "not installed" so the UI can show the setup hints.
      set({ ghStatus: { installed: false, authenticated: false } });
    }
  },

  loadGhAccounts: async () => {
    try {
      const accounts = await window.cowork.review.ghAccounts();
      set({ ghAccounts: accounts });
    } catch {
      // If gh isn't installed, the call rejects — fine, we just
      // surface an empty list and the modal hides the dropdown.
      set({ ghAccounts: [] });
    }
  },

  generatePRDescription: async () => {
    const state = get();
    const session = state.sessions.find((s) => s.id === state.windowId);
    if (!session) {
      throw new Error('No active project.');
    }
    const review = state.reviewState;
    if (!review) {
      throw new Error('Diff is not loaded yet.');
    }

    // Pick the "primary" pane to source the transcript from. For v1
    // we just take the first pane that has an agent assigned. Most
    // worktrees have a single pane; multi-agent worktrees are rare
    // enough that "use the first one" is a fine default — the user
    // can edit the result anyway.
    const primaryPane = Object.values(state.panes).find(
      (p) => p.agentName,
    );

    // Pull the most recent user prompt + assistant text from the
    // pane's items, if we have one.
    let userPrompt: string | undefined;
    let agentReply: string | undefined;
    if (primaryPane) {
      // Walk backwards collecting the most recent user + assistant
      // turns. There can be multiple assistant text blocks per turn
      // (intermediate thoughts) — concatenate them.
      const items = primaryPane.items;
      for (let i = items.length - 1; i >= 0; i--) {
        const item = items[i];
        if (item.kind === 'assistant_text' && !agentReply) {
          // Concatenate consecutive assistant texts ending here.
          let buf = item.text;
          for (let j = i - 1; j >= 0; j--) {
            const prev = items[j];
            if (prev.kind === 'assistant_text') {
              buf = prev.text + '\n' + buf;
            } else {
              break;
            }
          }
          agentReply = buf;
        }
        if (item.kind === 'user' && !userPrompt) {
          userPrompt = item.text;
          break;
        }
      }
    }

    return await window.cowork.review.summarizePR({
      branch: review.worktreeBranch,
      baseBranch: review.baseBranch,
      files: review.files.map((f) => f.path),
      additions: review.totalAdditions,
      deletions: review.totalDeletions,
      userPrompt,
      agentReply,
    });
  },

  shipPR: async ({ commitMessage, title, body, baseBranch, draft, pushAs }) => {
    const state = get();
    const session = state.sessions.find((s) => s.id === state.windowId);
    if (!session) {
      set({
        prWorkflowStatus: 'error',
        prError: 'No active project.',
      });
      return;
    }
    const branch = session.worktreeBranch;
    if (!branch) {
      set({
        prWorkflowStatus: 'error',
        prError: 'Active project is not a worktree.',
      });
      return;
    }

    set({ prWorkflowStatus: 'committing', prError: null, prResult: null });

    try {
      // 0) Switch gh account if the user picked a different one
      //    than the currently-active account. Skips when pushAs is
      //    falsy or already matches active. This only helps when gh
      //    is the credential helper (HTTPS); SSH-only setups need
      //    ~/.ssh/config aliases instead — surfaced in the modal hint.
      if (pushAs) {
        const active = state.ghAccounts.find((a) => a.active);
        if (!active || active.login !== pushAs) {
          await window.cowork.review.ghSwitch({ login: pushAs });
          // Refresh the cached account list so the active flag is
          // correct for any subsequent renders.
          void get().loadGhAccounts();
        }
      }

      // 1) Commit (no-op if working tree is clean).
      await window.cowork.review.commit({
        cwd: session.cwd,
        message: commitMessage,
        body: body, // body doubles as commit body when provided
      });

      // 2a) Make sure the base branch exists on origin. For repos
      //     initialized locally (gitInit) the user might never have
      //     pushed `main`, in which case `gh pr create` fails with
      //     "Base ref must be a branch". Push it from the worktree
      //     cwd — refs are shared with the parent so this works
      //     even though main isn't checked out here.
      await window.cowork.review.ensureRemoteBranch({
        cwd: session.cwd,
        branch: baseBranch,
      });

      // 2b) Push the feature branch.
      set({ prWorkflowStatus: 'pushing' });
      await window.cowork.review.push({
        cwd: session.cwd,
        branch,
        setUpstream: true,
      });

      // 3) Create PR.
      set({ prWorkflowStatus: 'creating-pr' });
      const result = await window.cowork.review.createPR({
        cwd: session.cwd,
        draft: {
          baseBranch,
          headBranch: branch,
          title,
          body,
          draft: !!draft,
        },
      });

      set({ prWorkflowStatus: 'done', prResult: result });

      // After a successful ship the working tree should be clean,
      // so refresh the diff to confirm + drop the file list. The
      // user is probably about to close the modal.
      void get().loadReview();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ prWorkflowStatus: 'error', prError: msg });
    }
  },

  resetPRWorkflow: () =>
    set({ prWorkflowStatus: 'idle', prError: null, prResult: null }),

  wrapUpAfterMerge: async () => {
    const state = get();
    const session = state.sessions.find((s) => s.id === state.windowId);
    if (!session) {
      set({
        wrapUpStatus: 'error',
        wrapUpError: 'No active project.',
      });
      return;
    }
    const parentId = session.parentProjectId;
    const baseBranch = session.worktreeBase;
    if (!parentId || !baseBranch) {
      set({
        wrapUpStatus: 'error',
        wrapUpError:
          'Active project is not a worktree (or its parent linkage is missing).',
      });
      return;
    }
    const parent = state.sessions.find((s) => s.id === parentId);
    if (!parent) {
      set({
        wrapUpStatus: 'error',
        wrapUpError:
          'Parent project not loaded. Switch to it once and try again.',
      });
      return;
    }

    set({ wrapUpStatus: 'pulling', wrapUpError: null });
    try {
      // 1) Bring the merged PR commits into the parent's checkout.
      await window.cowork.review.pull({
        cwd: parent.cwd,
        branch: baseBranch,
      });

      // 2) Remove the worktree + delete the local branch. The
      //    existing removeWorktreeProject action handles stopping
      //    panes, deleting persisted state, pruning the workspace,
      //    and switching the active session to the parent.
      set({ wrapUpStatus: 'removing' });
      await get().removeWorktreeProject({
        projectId: session.id,
        force: false,
        deleteBranch: true,
      });

      set({ wrapUpStatus: 'done' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ wrapUpStatus: 'error', wrapUpError: msg });
    }
  },

  resetWrapUp: () =>
    set({ wrapUpStatus: 'idle', wrapUpError: null }),

  mergeLocally: async ({ commitMessage, baseBranch }) => {
    const state = get();
    const session = state.sessions.find((s) => s.id === state.windowId);
    if (!session) {
      set({
        mergeWorkflowStatus: 'error',
        mergeError: 'No active project.',
      });
      return;
    }
    const branch = session.worktreeBranch;
    const parentProjectId = session.parentProjectId;
    if (!branch || !parentProjectId) {
      set({
        mergeWorkflowStatus: 'error',
        mergeError: 'Active project is not a worktree.',
      });
      return;
    }
    // Find the parent project's cwd — we need it to run `git merge`
    // since the merge happens in the parent's working tree (where
    // the base branch is checked out), not in the worktree.
    const parent = state.sessions.find((s) => s.id === parentProjectId);
    if (!parent) {
      set({
        mergeWorkflowStatus: 'error',
        mergeError:
          'Parent project is no longer available. Switch to it once before merging.',
      });
      return;
    }

    set({
      mergeWorkflowStatus: 'committing',
      mergeError: null,
      mergeResult: null,
    });

    try {
      // 1) Commit any uncommitted worktree changes (no-op if clean).
      await window.cowork.review.commit({
        cwd: session.cwd,
        message: commitMessage,
      });

      // 2) Merge into parent.
      set({ mergeWorkflowStatus: 'merging' });
      const result = await window.cowork.review.localMerge({
        worktreeCwd: session.cwd,
        parentCwd: parent.cwd,
        branch,
        baseBranch,
      });

      set({ mergeWorkflowStatus: 'done', mergeResult: result });

      // Refresh the diff so the user sees the post-merge state
      // (typically empty — everything's been merged into base).
      void get().loadReview();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      set({ mergeWorkflowStatus: 'error', mergeError: msg });
    }
  },

  resetMergeWorkflow: () =>
    set({
      mergeWorkflowStatus: 'idle',
      mergeError: null,
      mergeResult: null,
    }),

  setStepOrder: (stepId, targetIndex) => {
    const current = get().pipeline;
    if (!current) return;
    const idx = current.steps.findIndex((s) => s.id === stepId);
    if (idx < 0) return;
    const clamped = Math.max(
      0,
      Math.min(targetIndex, current.steps.length - 1),
    );
    if (clamped === idx) return;
    const steps = current.steps.slice();
    const [moved] = steps.splice(idx, 1);
    steps.splice(clamped, 0, moved);
    const next: Pipeline = { ...current, steps };
    set({ pipeline: next });
    void persistActivePipeline(get, set, next);
  },

  setStepPosition: (stepId, x, y) => {
    const current = get().pipeline;
    if (!current) return;
    const next: Pipeline = {
      ...current,
      steps: current.steps.map((s) =>
        s.id === stepId ? { ...s, position: { x, y } } : s,
      ),
    };
    set({ pipeline: next });
    void persistActivePipeline(get, set, next);
  },

  setStepDelay: (stepId, delayMs) => {
    const current = get().pipeline;
    if (!current) return;
    const next: Pipeline = {
      ...current,
      steps: current.steps.map((s) =>
        s.id === stepId
          ? { ...s, delayMs: delayMs > 0 ? delayMs : undefined }
          : s,
      ),
    };
    set({ pipeline: next });
    void persistActivePipeline(get, set, next);
  },

  setStepPrompt: (stepId, prompt) => {
    const current = get().pipeline;
    if (!current) return;
    const next: Pipeline = {
      ...current,
      steps: current.steps.map((s) =>
        s.id === stepId ? { ...s, prompt } : s,
      ),
    };
    set({ pipeline: next });
    void persistActivePipeline(get, set, next);
  },

  runFlow: async () => {
    const flow = get().pipeline;
    if (!flow || !flow.enabled || flow.steps.length === 0) return;
    const first = flow.steps[0];
    const prompt = (first.prompt ?? '').trim();
    if (!prompt) return;
    // Step 1 just sends its own prompt — no `{previous}` substitution
    // because there's no previous step. The chain continues via
    // `advanceFlowAfterResult` once this pane returns a `result`.
    try {
      await window.cowork.session.send(first.paneId, prompt);
    } catch {
      // Surface failures via the pane's own error path; nothing to do here.
    }
  },

  togglePipelineEnabled: () => {
    const current = get().pipeline;
    if (!current) return;
    const next: Pipeline = { ...current, enabled: !current.enabled };
    set({ pipeline: next });
    void persistActivePipeline(get, set, next);
  },

  switchSession: async (id) => {
    if (id === get().windowId) return;
    const target = get().sessions.find((s) => s.id === id);
    if (!target) return;

    snapshotActive(get, set);

    // Clear the "completed work elsewhere" flag on the session we're
    // entering — the user is about to see whatever happened, no need
    // to keep nudging.
    if (target.hasUnreadCompletion) {
      set((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === id ? { ...sess, hasUnreadCompletion: false } : sess,
        ),
      }));
    }

    // Hydrate top-level state from the target session. Reset the
    // terminal-detected URL list — those URLs belong to the previous
    // session's processes and won't be reachable from the new cwd
    // (especially since the terminal itself respawns on cwd change).
    set({
      windowId: target.id,
      cwd: target.cwd,
      tree: target.tree,
      windowMode: target.windowMode ?? 'multi',
      leadPaneId:
        target.windowMode === 'lead' && target.lead
          ? target.lead.paneId
          : null,
      leadPaneName:
        target.windowMode === 'lead' && target.lead?.paneName
          ? target.lead.paneName
          : null,
      memoryScope: target.memoryScope ?? 'project',
      activePaneId:
        target.windowMode === 'lead' && target.lead
          ? target.lead.paneId
          : collectLeaves(target.tree)[0] ?? null,
      previewUrl: target.previewUrl ?? null,
      // Mirror the project's pipeline into top-level state so components
      // can subscribe to one source of truth. Reset the view to panes
      // on every switch — landing in board view would be disorienting.
      pipeline: target.pipeline,
      pipelineView: 'panes',
      // Switching projects invalidates any loaded review — different
      // worktree, different diff. Renderer will refetch on entry.
      reviewState: undefined,
      reviewLoading: false,
      reviewError: null,
      reviewSelectedFile: null,
      reviewHunkDecisions: {},
      reviewApplying: false,
      ghStatus: null,
      ghAccounts: [],
      prWorkflowStatus: 'idle',
      prResult: null,
      prError: null,
      wrapUpStatus: 'idle',
      wrapUpError: null,
      mergeWorkflowStatus: 'idle',
      mergeResult: null,
      mergeError: null,
      terminalLocalhostUrls: [],
    });
    await window.cowork.state.setActiveSession(id);
    void get().refreshAgents();

    // Make sure the Lead pane runtime exists in `panes` map. Without
    // this, switching to a Lead-mode project that wasn't loaded at app
    // start (e.g. created mid-session in another window) leaves
    // `panes[leadPaneId]` undefined and the Pane component renders
    // "No pane." even though leadPaneId is set.
    if (target.windowMode === 'lead' && target.lead) {
      const leadId = target.lead.paneId;
      if (!get().panes[leadId]) {
        set((s) => ({
          panes: {
            ...s.panes,
            [leadId]: {
              id: leadId,
              agentName: target.lead!.agentName,
              status: 'idle',
              items: [],
            },
          },
        }));
      }
    }

    // Defensive sweep: every leaf in the target tree must have a
    // runtime entry, even leaves with no agent assigned. Empty panes
    // need a `panes[id]` so the UI shows the "Pick an agent" empty
    // state instead of the "No pane." placeholder.
    {
      const currentPanes = get().panes;
      const missing: Record<PaneId, PaneRuntime> = {};
      for (const { id: leafId, agentName } of collectLeavesWithAgents(
        target.tree,
      )) {
        if (!currentPanes[leafId]) {
          missing[leafId] = {
            id: leafId,
            agentName,
            status: 'idle',
            items: [],
          };
        }
      }
      if (Object.keys(missing).length > 0) {
        set((s) => ({ panes: { ...s.panes, ...missing } }));
      }
    }

    // Lazy-hydrate: any leaf in the target tree that has an agent name
    // but no live runtime gets a setPaneAgent call so its session boots.
    const session = target;
    for (const { id: paneId, agentName } of collectLeavesWithAgents(session.tree)) {
      if (!agentName) continue;
      const pane = get().panes[paneId];
      if (pane && pane.status !== 'idle') continue;
      void get().setPaneAgent(paneId, agentName);
    }
    // Same lazy-hydrate for the Lead pane (which lives outside the
    // tree). The auto-resume path in main reuses the saved sdk session
    // id when agent + MCPs match, so the lead picks up its
    // conversation transparently.
    if (target.windowMode === 'lead' && target.lead?.agentName) {
      const leadId = target.lead.paneId;
      const pane = get().panes[leadId];
      if (!pane || pane.status === 'idle') {
        void get().setLeadAgent(target.lead.agentName);
      }
    }
  },

  closeSession: async (id) => {
    const sessions = get().sessions;
    const target = sessions.find((s) => s.id === id);
    if (!target) return;
    // Workspaces are containers — closing the last project leaves an
    // empty workspace, which is fine. No "can't close the last one" gate.
    if (false) {
      alert('Can\u2019t close the last session — create another one first.');
      return;
    }
    const ok = confirm(
      `Close session "${target.name ?? deriveSessionName(target.cwd)}"? Its agents will be stopped.`,
    );
    if (!ok) return;

    // Stop every pane belonging to this session. We collect ids from the
    // saved tree (plus the Lead pane id, which may not appear in the tree
    // when the saved layout puts it outside).
    const paneIds = collectLeaves(target.tree);
    if (target.windowMode === 'lead' && target.lead) {
      paneIds.push(target.lead.paneId);
    }
    for (const paneId of paneIds) {
      try {
        await window.cowork.session.stop(paneId);
      } catch {
        // ignore
      }
    }
    await window.cowork.state.deleteWindow(id);

    // Mirror the main process's workspace cleanup: drop this project id
    // from whichever workspace owned it. main/persistence's
    // deleteWindowState already updated the disk copy; we have to
    // mirror that into our local `workspaces` array so the sidebar
    // reflects it without a roundtrip.
    set((s) => {
      const nextPanes = { ...s.panes };
      for (const paneId of paneIds) delete nextPanes[paneId];
      const nextSessions = s.sessions.filter((x) => x.id !== id);
      const nextWorkspaces = s.workspaces.map((w) =>
        w.projectIds.includes(id)
          ? {
              ...w,
              projectIds: w.projectIds.filter((pid) => pid !== id),
              updatedAt: Date.now(),
            }
          : w,
      );
      return {
        panes: nextPanes,
        sessions: nextSessions,
        workspaces: nextWorkspaces,
      };
    });

    if (id === get().windowId) {
      // Switch to another project in the SAME workspace if possible.
      const ws = get().workspaces.find(
        (w) => w.id === get().activeWorkspaceId,
      );
      const next =
        ws && ws.projectIds.length > 0
          ? get().sessions.find((s) => s.id === ws.projectIds[0])
          : null;
      if (next) {
        await get().switchSession(next.id);
      } else {
        set({
          cwd: null,
          tree: initialTree(),
          windowId: nanoid(10),
          activePaneId: null,
          windowMode: 'multi',
          leadPaneId: null,
  leadPaneName: null,
                  memoryScope: 'project',
        });
        await window.cowork.state.setActiveSession(undefined);
      }
    }
  },

  renameSession: async (id, name) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const target = get().sessions.find((s) => s.id === id);
    if (!target) return;
    const updated: WindowState = { ...target, name: trimmed };
    set((s) => ({
      sessions: s.sessions.map((x) => (x.id === id ? updated : x)),
    }));
    await window.cowork.state.saveWindow(updated);
  },
}));

/**
 * After a PR list refresh, warm the detail cache for every open PR
 * whose snapshot we don't have or whose `updatedAt` has advanced.
 * Capped at 3 concurrent fetches so we don't blow GH rate limits or
 * stall the gh CLI on big repos. Errors per-PR are swallowed
 * (logged) so one bad PR doesn't stop the others.
 */
async function prefetchOpenPrDetails(
  get: () => Store,
  set: (
    partial: Partial<Store> | ((s: Store) => Partial<Store>),
  ) => void,
): Promise<void> {
  const { cwd, windowId, prInboxes, prDetails } = get();
  if (!cwd || !windowId) return;
  const prs = prInboxes[windowId]?.prs ?? [];
  // Open-only — closed/merged details are far less likely to be
  // opened and not worth pre-spending budget on.
  const openPrs = prs.filter((p) => p.state === 'open');
  const queue = openPrs.filter((p) => {
    const cached = prDetails[p.number];
    if (!cached) return true;
    return cached.updatedAt !== p.updatedAt; // refresh on activity
  });
  if (queue.length === 0) return;

  const CONCURRENCY = 3;
  const workers: Array<Promise<void>> = [];
  let cursor = 0;
  for (let w = 0; w < CONCURRENCY; w++) {
    workers.push(
      (async () => {
        while (true) {
          const i = cursor;
          cursor += 1;
          if (i >= queue.length) return;
          const num = queue[i].number;
          try {
            const detail = await window.cowork.pr.detail(cwd, num);
            set((s) => ({
              prDetails: { ...s.prDetails, [num]: detail },
            }));
          } catch (err) {
            console.warn(
              `[pr-prefetch] PR #${num} detail failed:`,
              err instanceof Error ? err.message : err,
            );
          }
        }
      })(),
    );
  }
  await Promise.all(workers);
}

/**
 * Helper: write the live top-level state back into the matching entry in
 * `sessions[]` so a later switch can restore it. Used by createSession,
 * switchSession, and closeSession.
 */
function snapshotActive(
  get: () => Store,
  set: (
    partial: Partial<Store> | ((s: Store) => Partial<Store>),
  ) => void,
): void {
  const s = get();
  if (!s.cwd) return;
  // If the active session id was just removed from `sessions[]` (e.g. by
  // closeSession), bail rather than resurrect a deleted entry.
  const existing = s.sessions.find((x) => x.id === s.windowId);
  if (!existing) return;
  const lead =
    s.windowMode === 'lead' && s.leadPaneId
      ? {
          paneId: s.leadPaneId,
          agentName: s.panes[s.leadPaneId]?.agentName,
          ...(s.leadPaneName ? { paneName: s.leadPaneName } : {}),
        }
      : undefined;
  const lastSessionIds: Record<PaneId, string> = {};
  for (const p of Object.values(s.panes)) {
    if (p.sessionId) lastSessionIds[p.id] = p.sessionId;
  }
  const snapshot: WindowState = {
    id: s.windowId,
    name: existing.name ?? deriveSessionName(s.cwd),
    cwd: s.cwd,
    tree: bakeAgentsIntoTree(s.tree, s.panes),
    windowMode: s.windowMode,
    lead,
    memoryScope: s.memoryScope,
    lastSessionIds,
    previewUrl: s.previewUrl ?? undefined,
    // Preserve fields that don't live in top-level reactive state but
    // belong to the project: worktree linkage and the flow definition.
    // Without these the snapshot would silently strip them on every
    // session switch — that's how worktree indentation got lost earlier.
    parentProjectId: existing.parentProjectId,
    worktreeBranch: existing.worktreeBranch,
    worktreeBase: existing.worktreeBase,
    pipeline: s.pipeline ?? existing.pipeline,
  };
  set((cur) => {
    const idx = cur.sessions.findIndex((x) => x.id === snapshot.id);
    if (idx < 0) return {};
    const next = cur.sessions.slice();
    next[idx] = snapshot;
    return { sessions: next };
  });
  // Persist quietly; we don't await so the UI swap stays snappy.
  void window.cowork.state.saveWindow(snapshot);
}

/** Friendly default session name from a folder path: just the basename. */
function deriveSessionName(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, '');
  const base = trimmed.split('/').pop();
  return base && base.length > 0 ? base : 'Project';
}

/**
 * Walk every pane in a session and pull out any localhost / 127.0.0.1
 * URLs the agents have mentioned in their replies (or that came back
 * inside tool results from Bash / dev-server commands). Returns most
 * recent first so the Preview button can default to the latest URL.
 *
 * Catches dev-server output like:
 *   "Local:   http://localhost:5173/"
 *   "ready - started server on http://127.0.0.1:3000"
 *   "Server running at http://localhost:8080"
 */
const LOCALHOST_RE =
  /\bhttps?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s'"<>)\]}]*)?/gi;

export function detectLocalhostUrls(
  paneIds: Iterable<PaneId>,
  panes: Record<PaneId, PaneRuntime>,
): string[] {
  // (paneId, ts, url) triples so we can sort newest-first.
  const hits: Array<{ url: string; ts: number }> = [];
  for (const paneId of paneIds) {
    const pane = panes[paneId];
    if (!pane) continue;
    for (const item of pane.items) {
      // Only mine text-bearing items; tool_use input is usually not a URL.
      let text: string | undefined;
      if (item.kind === 'assistant_text') text = item.text;
      else if (item.kind === 'tool_result') {
        // tool_result content can be string or an array of blocks.
        text = stringifyToolResultContent(item.content);
      } else if (item.kind === 'user') text = item.text;
      if (!text) continue;
      const matches = text.match(LOCALHOST_RE);
      if (!matches) continue;
      for (const m of matches) {
        // Strip a trailing slash for de-dupe consistency, then normalize
        // back to canonical form (no trailing /) — the webview is happy.
        const normalized = m.replace(/\/$/, '');
        hits.push({ url: normalized, ts: item.ts });
      }
    }
  }
  // Newest first, dedupe by URL.
  hits.sort((a, b) => b.ts - a.ts);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of hits) {
    if (seen.has(h.url)) continue;
    seen.add(h.url);
    out.push(h.url);
  }
  return out;
}

function stringifyToolResultContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map((b) => {
        if (
          b &&
          typeof b === 'object' &&
          (b as { type?: string }).type === 'text'
        ) {
          return String((b as { text?: string }).text ?? '');
        }
        return '';
      })
      .join('\n');
  }
  return '';
}
