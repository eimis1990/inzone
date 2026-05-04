import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { primeAudio } from '../chime';
import { LayoutsModal } from './LayoutsModal';
import { fmt } from './UsageModal';
import { SettingsDrawer } from './SettingsDrawer';
import type { SettingsSection } from './settings/types';
import { AppLogo } from './AppLogo';
import { PreviewButton } from './PreviewButton';
import { PrButton } from './PrButton';
import {
  BellIcon,
  BellOffIcon,
  BotIcon,
  ChevronDownIcon,
  FolderIcon,
  LayoutsIcon,
  MissionControlIcon,
  MultiAgentsIcon,
  PanelLeftIcon,
  SettingsIcon,
  SplitHIcon,
  SplitVIcon,
  WorkspacesIcon,
} from './icons';

export function WorkspaceBar() {
  const cwd = useStore((s) => s.cwd);
  const pickFolder = useStore((s) => s.pickFolder);
  const windowId = useStore((s) => s.windowId);
  const sessions = useStore((s) => s.sessions);
  const activeSession = sessions.find((s) => s.id === windowId);
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const createWorkspace = useStore((s) => s.createWorkspace);
  const switchWorkspace = useStore((s) => s.switchWorkspace);
  const renameWorkspace = useStore((s) => s.renameWorkspace);
  const deleteWorkspaceById = useStore((s) => s.deleteWorkspaceById);
  const activePaneId = useStore((s) => s.activePaneId);
  const splitPane = useStore((s) => s.splitPane);
  const sidebarCollapsed = useStore((s) => s.sidebarCollapsed);
  const toggleSidebarCollapsed = useStore((s) => s.toggleSidebarCollapsed);
  const soundEnabled = useStore((s) => s.soundEnabled);
  const toggleSound = useStore((s) => s.toggleSound);
  const usage = useStore((s) => s.usage);
  const setMissionControlOpen = useStore((s) => s.setMissionControlOpen);
  const [showPresets, setShowPresets] = useState(false);
  const [renamingWorkspaceId, setRenamingWorkspaceId] = useState<string | null>(
    null,
  );
  const [renameDraft, setRenameDraft] = useState('');
  const [showLayouts, setShowLayouts] = useState(false);
  const [drawerSection, setDrawerSection] = useState<SettingsSection | null>(
    null,
  );
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const presetsRef = useRef<HTMLDivElement>(null);

  // Close the Workspaces dropdown when clicking anywhere outside it.
  useEffect(() => {
    if (!showPresets) return;
    const handler = (e: MouseEvent) => {
      if (
        presetsRef.current &&
        !presetsRef.current.contains(e.target as Node)
      ) {
        setShowPresets(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPresets]);

  // Cross-component "open settings to section X" — used by sidebar
  // shortcuts (e.g. "+ Create Agent" pill) so they don't have to thread
  // a callback through every component in between.
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<SettingsSection>).detail;
      if (detail) setDrawerSection(detail);
    };
    window.addEventListener('inzone:open-settings', handler);
    return () => window.removeEventListener('inzone:open-settings', handler);
  }, []);

  const handleCreateWorkspace = async () => {
    const name = newWorkspaceName.trim();
    setNewWorkspaceName('');
    setShowPresets(false);
    // Empty name is fine — the store falls back to "Workspace N".
    await createWorkspace(name || undefined);
  };

  const shortCwd = cwd ? cwd.replace(/^.*\//, '…/') : 'Choose folder';
  const homeDir = '/Users/'; // best-effort match for $HOME prefix
  function shortenPath(p: string): string {
    if (p.startsWith(homeDir)) {
      const rest = p.slice(homeDir.length);
      const idx = rest.indexOf('/');
      if (idx > 0) {
        // strip the username segment, keep the rest with a ~ prefix
        return '~/' + rest.slice(idx + 1);
      }
    }
    return p;
  }
  const canSplit = !!activePaneId;

  // Any project anywhere with an unread completion — highlights the
  // pill so the user notices when work finished while they were
  // looking at a different project. Cleared per-project on switch.
  const globalHasUnread = sessions.some((s) => s.hasUnreadCompletion);

  // Per-workspace flag — used to dot the row in the dropdown so the
  // user can see which workspace contains the project that just
  // completed without having to scan every project name.
  const workspaceHasUnread = new Map<string, boolean>();
  for (const w of workspaces) {
    workspaceHasUnread.set(
      w.id,
      w.projectIds.some(
        (pid) =>
          sessions.find((s) => s.id === pid)?.hasUnreadCompletion ?? false,
      ),
    );
  }

  return (
    <div className="workspace-bar">
      {/* Left cluster: sidebar toggle + folder + workspaces */}
      <div className="wb-group">
        <IconButton
          label={sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
          onClick={toggleSidebarCollapsed}
          active={!sidebarCollapsed}
        >
          <PanelLeftIcon closed={sidebarCollapsed} />
        </IconButton>

        {/* Review chip lives here (where the session-name pill used to
            sit) — visible only on worktree projects. The session name
            already shows in the Projects sidebar so we don't need it
            duplicated in the bar. On non-worktree projects this slot
            gracefully collapses; the workspaces dropdown shifts left. */}
        <ReviewChip />
        {/* When no session is open at all (first launch), surface the
            folder picker here so the user has somewhere to start. */}
        {!activeSession && (
          <button
            className="wb-pill"
            onClick={() => void pickFolder()}
            title="Choose a folder to start your first session"
          >
            <FolderIcon />
            <span className="wb-pill-label">{shortCwd}</span>
          </button>
        )}

        <div className="presets" ref={presetsRef}>
          {(() => {
            const currentWorkspace = workspaces.find(
              (w) => w.id === activeWorkspaceId,
            );
            const triggerLabel = currentWorkspace
              ? currentWorkspace.name
              : 'Workspaces';
            return (
              <>
                <button
                  className={
                    'wb-pill' +
                    (currentWorkspace ? ' wb-pill-has-current' : '') +
                    (globalHasUnread ? ' wb-pill-has-unread' : '')
                  }
                  onClick={() => setShowPresets((v) => !v)}
                  title={
                    globalHasUnread
                      ? 'An agent finished while you were elsewhere — open the dropdown to see which project'
                      : currentWorkspace
                        ? (() => {
                            const n = countTopLevelProjects(
                              currentWorkspace.projectIds,
                              sessions,
                            );
                            return `On workspace "${currentWorkspace.name}" (${n} project${n === 1 ? '' : 's'})`;
                          })()
                        : 'No workspace yet — create one'
                  }
                >
                  <WorkspacesIcon />
                  <span className="wb-pill-label">{triggerLabel}</span>
                  {globalHasUnread && (
                    <span className="wb-pill-unread-dot" aria-hidden />
                  )}
                  <ChevronDownIcon size={12} />
                </button>
                {showPresets && (
                  <div className="dropdown workspaces-dropdown">
                    {/* Header — just a label, no chrome. */}
                    <div className="ws-dropdown-header">
                      <span className="ws-dropdown-title">Workspaces</span>
                      <span className="ws-dropdown-count">
                        {workspaces.length}
                      </span>
                    </div>

                    {/* Unified list — current workspace gets a tinted
                        accent treatment instead of being duplicated in
                        a separate section. Hover reveals rename + delete
                        icons so the chrome stays out of the way at rest. */}
                    <div className="ws-list">
                      {workspaces.length === 0 && (
                        <div className="ws-empty">
                          No workspaces yet — create one below to start
                          organising your projects.
                        </div>
                      )}
                      {workspaces.map((w) => {
                        const isActive = w.id === activeWorkspaceId;
                        const isRenaming = renamingWorkspaceId === w.id;
                        // Worktrees are siblings of their parent in
                        // projectIds[], but conceptually they're "branches
                        // of" the parent project. Don't count them as
                        // separate projects in the sidebar / dropdown
                        // labels — that's confusing when the user thinks
                        // "I have 2 projects" and the UI says 3.
                        const topLevelCount = countTopLevelProjects(
                          w.projectIds,
                          sessions,
                        );
                        const projectCountLabel = `${topLevelCount} project${topLevelCount === 1 ? '' : 's'}`;
                        return (
                          <div
                            key={w.id}
                            className={
                              'ws-row' + (isActive ? ' ws-row-active' : '')
                            }
                          >
                            <button
                              type="button"
                              className="ws-row-main"
                              onClick={() => {
                                if (isRenaming) return;
                                if (isActive) {
                                  setShowPresets(false);
                                  return;
                                }
                                void switchWorkspace(w.id);
                                setShowPresets(false);
                              }}
                              disabled={isRenaming}
                            >
                              <span
                                className={
                                  'ws-row-dot' +
                                  (isActive ? ' ws-row-dot-active' : '') +
                                  (workspaceHasUnread.get(w.id)
                                    ? ' ws-row-dot-unread'
                                    : '')
                                }
                                aria-hidden
                                title={
                                  workspaceHasUnread.get(w.id)
                                    ? 'A project in this workspace has completed work waiting for you'
                                    : undefined
                                }
                              />
                              <span className="ws-row-text">
                                {isRenaming ? (
                                  <input
                                    autoFocus
                                    className="ws-row-rename-input"
                                    value={renameDraft}
                                    onChange={(e) =>
                                      setRenameDraft(e.target.value)
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                    onBlur={async () => {
                                      await renameWorkspace(w.id, renameDraft);
                                      setRenamingWorkspaceId(null);
                                    }}
                                    onKeyDown={async (e) => {
                                      e.stopPropagation();
                                      if (e.key === 'Enter') {
                                        await renameWorkspace(
                                          w.id,
                                          renameDraft,
                                        );
                                        setRenamingWorkspaceId(null);
                                      }
                                      if (e.key === 'Escape') {
                                        setRenamingWorkspaceId(null);
                                      }
                                    }}
                                    spellCheck={false}
                                  />
                                ) : (
                                  <span className="ws-row-name">{w.name}</span>
                                )}
                                <span className="ws-row-meta">
                                  {projectCountLabel}
                                </span>
                              </span>
                            </button>
                            {!isRenaming && (
                              <div className="ws-row-actions">
                                <button
                                  type="button"
                                  className="ws-row-action"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setRenameDraft(w.name);
                                    setRenamingWorkspaceId(w.id);
                                  }}
                                  title="Rename workspace"
                                  aria-label="Rename workspace"
                                >
                                  <PencilIcon />
                                </button>
                                <button
                                  type="button"
                                  className="ws-row-action ws-row-action-danger"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void deleteWorkspaceById(w.id);
                                    setShowPresets(false);
                                  }}
                                  title="Delete workspace and its projects"
                                  aria-label="Delete workspace"
                                >
                                  ✕
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* Create — single inline row at the foot. The
                        Create button kicks off the folder picker, so
                        the input is purely the (optional) name. */}
                    <div className="ws-create-row">
                      <input
                        className="ws-create-input"
                        value={newWorkspaceName}
                        onChange={(e) => setNewWorkspaceName(e.target.value)}
                        placeholder="New workspace name (optional)"
                        onKeyDown={(e) => {
                          if (e.key === 'Enter')
                            void handleCreateWorkspace();
                        }}
                      />
                      <button
                        type="button"
                        className="ws-create-btn"
                        onClick={() => void handleCreateWorkspace()}
                        title="Pick a folder to start the workspace's first project"
                      >
                        + New
                      </button>
                    </div>
                    <div className="ws-create-hint">
                      You'll pick a folder for the first project right
                      after.
                    </div>
                  </div>
                )}
              </>
            );
          })()}
        </div>

        <PrButton />
        <PreviewButton />
      </div>

      <div className="wb-divider" aria-hidden />

      {/* Middle cluster: pane-layout actions */}
      <div className="wb-group">
        <IconButton
          label="Split horizontally"
          onClick={() => activePaneId && splitPane(activePaneId, 'horizontal')}
          disabled={!canSplit}
        >
          <SplitHIcon />
        </IconButton>
        <IconButton
          label="Split vertically"
          onClick={() => activePaneId && splitPane(activePaneId, 'vertical')}
          disabled={!canSplit}
        >
          <SplitVIcon />
        </IconButton>
        <IconButton label="Layout templates" onClick={() => setShowLayouts(true)}>
          <LayoutsIcon />
        </IconButton>
      </div>

      <div className="wb-spacer" />

      {/* Centered: window mode switch (Multi Agents has an embedded
          "Flow" chip when the project has ≥2 panes). The Review chip
          used to live next to it but moved to the left cluster (in
          place of the old session-name pill) — closer to the sidebar
          where the user thinks about projects. */}
      <ModeSwitch />

      <div className="wb-spacer" />

      {/* Right cluster: state */}
      <div className="wb-group wb-group-state">
        <button
          className="wb-pill wb-cost"
          onClick={() => setDrawerSection('usage')}
          title={`Today ${fmt(usage?.todayCostUsd ?? 0)} · Lifetime ${fmt(usage?.totalCostUsd ?? 0)}`}
        >
          <span className="wb-cost-amount">
            {fmt(usage?.todayCostUsd ?? 0)}
          </span>
          <span className="wb-cost-label">today</span>
        </button>
      </div>

      <div className="wb-divider" aria-hidden />

      {/* Utilities cluster: sound first, then settings */}
      <div className="wb-group wb-group-utils">
        <button
          type="button"
          className={'wb-switch' + (soundEnabled ? ' on' : ' off')}
          onClick={() => {
            primeAudio();
            toggleSound();
          }}
          title={
            soundEnabled
              ? 'Completion chime is on — click to mute'
              : 'Completion chime is off — click to unmute'
          }
          aria-pressed={soundEnabled}
          aria-label="Toggle completion chime"
        >
          <span className="wb-switch-track">
            <span className="wb-switch-knob" aria-hidden>
              {soundEnabled ? (
                <BellIcon size={12} stroke={2} />
              ) : (
                <BellOffIcon size={12} stroke={2} />
              )}
            </span>
          </span>
        </button>

        <IconButton
          label="Mission Control (⌘⇧M)"
          onClick={() => setMissionControlOpen(true)}
          // Same chrome treatment as Settings so the two utility
          // buttons read as a pair — quiet but present.
          active
        >
          <MissionControlIcon />
        </IconButton>

        <IconButton
          label="Settings"
          onClick={() => setDrawerSection('agents')}
          // Keep the same subtle background as the collapse button's
          // active state — gives the gear a quiet but present chrome
          // so it doesn't read as a stray ghost icon.
          active
        >
          <SettingsIcon />
        </IconButton>
      </div>

      <div className="wb-brand" title="INZONE">
        <span className="wb-wordmark" aria-hidden>
          INZONE
        </span>
        <AppLogo size={30} />
      </div>

      <LayoutsModal open={showLayouts} onClose={() => setShowLayouts(false)} />
      <SettingsDrawer
        open={drawerSection !== null}
        initialSection={drawerSection ?? undefined}
        onClose={() => setDrawerSection(null)}
      />
    </div>
  );
}

interface IconButtonProps {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
}

function IconButton({
  label,
  onClick,
  children,
  active,
  disabled,
}: IconButtonProps) {
  return (
    <button
      type="button"
      className={
        'wb-icon-btn' + (active ? ' active' : '') + (disabled ? ' disabled' : '')
      }
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

/**
 * Multi Agents / Lead Agent segmented control. The Multi Agents segment
 * has an embedded "Flow" chip that appears only when the project has
 * ≥2 panes — a visual hint that flows are an extension of Multi mode.
 */
function ModeSwitch() {
  const mode = useStore((s) => s.windowMode);
  const setWindowMode = useStore((s) => s.setWindowMode);
  // Pane count gate: Flow needs at least two AGENT panes to be useful.
  // Terminal-kind panes (Claude Code, Codex, Aider, Gemini, plain
  // shell) aren't part of the chain — they appear as info-only cards
  // on the board if the chip is shown, but they don't satisfy the
  // gate on their own. We also include the Lead pane in the count
  // when present (it's outside the tree but a real participant).
  const paneCount = useStore((s) => {
    const tree = s.tree;
    let n = 0;
    const walk = (node: typeof s.tree): void => {
      if (node.kind === 'leaf') {
        if (node.workerKind !== 'terminal') n += 1;
      } else for (const c of node.children) walk(c);
    };
    walk(tree);
    if (s.leadPaneId) n += 1;
    return n;
  });
  const hasFlowChip = mode === 'multi' && paneCount >= 2;

  return (
    <div
      className="mode-switch mode-switch-large"
      role="tablist"
      aria-label="Window mode"
    >
      <button
        role="tab"
        aria-selected={mode === 'multi'}
        className={'mode-btn' + (mode === 'multi' ? ' active' : '')}
        onClick={() => setWindowMode('multi')}
        title="Multi Agents mode — each pane runs independently"
      >
        <MultiAgentsIcon size={14} stroke={2} />
        <span>Multi Agents</span>
        {hasFlowChip && <FlowChip />}
      </button>
      <button
        role="tab"
        aria-selected={mode === 'lead'}
        className={'mode-btn' + (mode === 'lead' ? ' active' : '')}
        onClick={() => setWindowMode('lead')}
        title="Lead Agent mode — one orchestrator drives the sub-agents"
      >
        <BotIcon size={14} stroke={2} />
        <span>Lead Agent</span>
      </button>
    </div>
  );
}

/**
 * The "Flow" sub-button embedded inside the active Multi Agents pill.
 * Toggles the pipeline-board view in place of the panes view.
 *
 * Lives as its own component so we can stop click propagation —
 * clicking the chip should toggle the view without re-firing the
 * Multi Agents tab selector.
 */
function FlowChip() {
  const view = useStore((s) => s.pipelineView);
  const setView = useStore((s) => s.setPipelineView);
  const flowEnabled = useStore((s) => s.pipeline?.enabled === true);
  // Two pieces of state for the chip: which view is showing (board vs.
  // panes), and whether flow is enabled. The chip is "active-look" only
  // when board view is open. The little glowing dot indicates flow is
  // ON regardless of which view you're in — visible reminder that
  // sends are being chained behind the scenes.
  const showingBoard = view === 'board';
  return (
    <span
      role="button"
      tabIndex={0}
      className={
        'mode-flow-chip' +
        (showingBoard ? ' active' : '') +
        (flowEnabled ? ' enabled' : '')
      }
      onClick={(e) => {
        e.stopPropagation();
        setView(showingBoard ? 'panes' : 'board');
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          e.stopPropagation();
          setView(showingBoard ? 'panes' : 'board');
        }
      }}
      title={
        showingBoard
          ? 'Back to panes view'
          : flowEnabled
            ? 'Flow is ON — sends to one pane chain to the next.'
            : 'Open Flow to chain panes into a sync sequence.'
      }
    >
      {/* Inline icon — fill-only shapes (no strokes) so the visual
          weight matches the text when both inherit currentColor.
          Idle: a 2×2 panes grid (this is what the chip lets you go
          BACK to, and reads as "multiple panes"). Active: a stepped
          diagonal flow that maps to the Flow board's bezier-line
          visual. The geometry swap reinforces the view transition. */}
      {showingBoard ? (
        <svg
          width="20"
          height="12"
          viewBox="0 0 24 14"
          fill="currentColor"
          aria-hidden
        >
          <circle cx="3" cy="3.5" r="2.4" />
          <rect x="5" y="2.6" width="6" height="1.8" rx="0.9" />
          <circle cx="13" cy="3.5" r="2.4" />
          <rect x="11.5" y="4.5" width="1.8" height="5" rx="0.9" />
          <rect x="13" y="9.5" width="6" height="1.8" rx="0.9" />
          <circle cx="21" cy="10.5" r="2.4" />
        </svg>
      ) : (
        <svg
          width="22"
          height="10"
          viewBox="0 0 26 8"
          fill="currentColor"
          aria-hidden
        >
          <circle cx="3" cy="4" r="2.2" />
          <rect x="5" y="3.1" width="6" height="1.8" rx="0.9" />
          <circle cx="13" cy="4" r="2.2" />
          <rect x="15" y="3.1" width="6" height="1.8" rx="0.9" />
          <circle cx="23" cy="4" r="2.2" />
        </svg>
      )}
      <span>Flow</span>
      {flowEnabled && <span className="mode-flow-dot" aria-hidden />}
    </span>
  );
}

/**
 * "Review" chip — sits in the left cluster (replacing the old
 * session-name pill) when the active project is a worktree. Toggles
 * the main pane area into the diff Review view.
 *
 * Hidden on non-worktree projects because there's no parent branch
 * to diff against. Styled like the rest of the wb-pills (folder /
 * workspace) so the bar reads as one cohesive row of pills, with an
 * accent active state when the review view is open.
 */
function ReviewChip() {
  const view = useStore((s) => s.pipelineView);
  const setView = useStore((s) => s.setPipelineView);
  const loadReview = useStore((s) => s.loadReview);
  // Only worktree projects show the chip — gated on the active
  // session's worktreeBranch + worktreeBase fields.
  const isWorktree = useStore((s) => {
    const session = s.sessions.find((p) => p.id === s.windowId);
    return !!session?.worktreeBranch && !!session?.worktreeBase;
  });
  if (!isWorktree) return null;

  const showingReview = view === 'review';
  const onToggle = () => {
    if (showingReview) {
      setView('panes');
    } else {
      setView('review');
      // Kick off the diff load right away so the view doesn't sit
      // empty waiting for the user to do anything else.
      void loadReview();
    }
  };

  return (
    <button
      type="button"
      className={'wb-pill wb-review-pill' + (showingReview ? ' active' : '')}
      onClick={onToggle}
      title={
        showingReview
          ? 'Back to panes view'
          : 'Review changes in this worktree before shipping'
      }
    >
      {/* Inline icon — checkmark over diff lines, signalling
          "review what changed and approve". */}
      <svg
        width="16"
        height="14"
        viewBox="0 0 18 16"
        fill="currentColor"
        aria-hidden
      >
        <rect x="2" y="2" width="9" height="1.6" rx="0.8" />
        <rect x="2" y="6" width="11" height="1.6" rx="0.8" />
        <rect x="2" y="10" width="7" height="1.6" rx="0.8" />
        <path
          d="M 11.5 11 L 13.2 13 L 16.5 9.5"
          stroke="currentColor"
          strokeWidth="1.6"
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="wb-pill-label">Review</span>
    </button>
  );
}

/**
 * Count how many top-level (non-worktree) projects a workspace owns.
 * Worktrees live in `projectIds[]` alongside their parents, but the
 * user thinks of them as branches of a project — not separate
 * projects — so the displayed count should exclude them. Falls back
 * to the raw length when a session can't be found (defensive).
 */
function countTopLevelProjects(
  projectIds: string[],
  sessions: import('@shared/types').WindowState[],
): number {
  let n = 0;
  for (const id of projectIds) {
    const session = sessions.find((s) => s.id === id);
    if (!session) {
      // Stale id — count it conservatively so the user's number
      // doesn't drift below reality.
      n += 1;
      continue;
    }
    if (!session.parentProjectId) n += 1;
  }
  return n;
}

/** Pencil glyph used for the per-row rename action in the
 *  workspaces dropdown. Mirrors the version in Pane.tsx. */
function PencilIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}
