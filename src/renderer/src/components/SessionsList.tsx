import { useEffect, useMemo, useRef, useState } from 'react';
import type { WindowState } from '@shared/types';
import { useStore } from '../store';
import { WorktreeCreateModal } from './WorktreeCreateModal';
import { WorktreeRemoveModal } from './WorktreeRemoveModal';

/**
 * Top section of the left sidebar. Lists every session that's been
 * opened (each = one workspace context with its own folder, layout,
 * mode, and Lead pane), highlights the active one, and offers
 * `+ New session` plus a per-row `⋯` menu for Rename / Close.
 */
export function SessionsList() {
  // Subscribe to the raw slices and derive the filtered/ordered list
  // via useMemo. Computing the list directly inside the Zustand
  // selector returns a new array reference every render, which Zustand
  // sees as a state change and triggers infinite re-renders.
  const allSessions = useStore((s) => s.sessions);
  const workspaces = useStore((s) => s.workspaces);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const sessions = useMemo(() => {
    const ws = workspaces.find((w) => w.id === activeWorkspaceId);
    if (!ws) return allSessions;
    // Projects owned by *any* workspace are considered placed; only
    // truly unowned projects (which shouldn't happen in normal flow but
    // can after a botched migration) get appended at the end so the
    // user can see them and clean them up. Projects owned by *another*
    // workspace must NOT show in the current sidebar — that was the
    // earlier bug where switching workspaces still showed everything.
    const ownedByAnyWorkspace = new Set<string>();
    for (const w of workspaces) {
      for (const pid of w.projectIds) ownedByAnyWorkspace.add(pid);
    }
    const ordered: typeof allSessions = [];
    for (const id of ws.projectIds) {
      const found = allSessions.find((x) => x.id === id);
      if (found) ordered.push(found);
    }
    for (const x of allSessions) {
      if (!ownedByAnyWorkspace.has(x.id)) ordered.push(x);
    }
    return ordered;
  }, [allSessions, workspaces, activeWorkspaceId]);

  // Build a parent → worktree-children map so we can render worktrees
  // indented under their parent. We derive a render order that puts
  // each parent immediately followed by its worktree children, then
  // moves on to the next parent. Orphans (parent missing from current
  // workspace, e.g. archived) render flat at their normal position.
  const renderRows = useMemo(() => {
    const idSet = new Set(sessions.map((s) => s.id));
    const childrenByParent = new Map<string, WindowState[]>();
    for (const s of sessions) {
      if (s.parentProjectId && idSet.has(s.parentProjectId)) {
        const arr = childrenByParent.get(s.parentProjectId) ?? [];
        arr.push(s);
        childrenByParent.set(s.parentProjectId, arr);
      }
    }
    const out: Array<{
      session: WindowState;
      depth: number;
      isWorktree: boolean;
    }> = [];
    const seen = new Set<string>();
    for (const s of sessions) {
      if (seen.has(s.id)) continue;
      // If this is a worktree whose parent IS in the list, it'll be
      // pulled in under its parent below — skip on the top-level pass.
      if (s.parentProjectId && idSet.has(s.parentProjectId)) continue;
      out.push({ session: s, depth: 0, isWorktree: false });
      seen.add(s.id);
      const kids = childrenByParent.get(s.id);
      if (kids) {
        for (const k of kids) {
          out.push({ session: k, depth: 1, isWorktree: true });
          seen.add(k.id);
        }
      }
    }
    // Anything still unseen (orphan worktree whose parent was archived)
    // gets shown flat at the end so the user can still clean it up.
    for (const s of sessions) {
      if (!seen.has(s.id)) {
        out.push({ session: s, depth: 0, isWorktree: !!s.parentProjectId });
      }
    }
    return out;
  }, [sessions]);
  const activeId = useStore((s) => s.windowId);
  const switchSession = useStore((s) => s.switchSession);
  const createSession = useStore((s) => s.createSession);
  const closeSession = useStore((s) => s.closeSession);
  const renameSession = useStore((s) => s.renameSession);

  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(
    null,
  );
  const [renameFor, setRenameFor] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Worktree modals — open with a chosen project as their target.
  const [worktreeCreateFor, setWorktreeCreateFor] = useState<WindowState | null>(
    null,
  );
  const [worktreeRemoveFor, setWorktreeRemoveFor] = useState<WindowState | null>(
    null,
  );

  // Click-outside to close the per-row menu.
  useEffect(() => {
    if (!menuFor) return;
    const onClick = () => {
      setMenuFor(null);
      setMenuPos(null);
    };
    window.addEventListener('mousedown', onClick);
    // Close on scroll too — keeps the floating menu from drifting away
    // from its trigger when the sessions list scrolls underneath it.
    const onScroll = () => {
      setMenuFor(null);
      setMenuPos(null);
    };
    window.addEventListener('scroll', onScroll, true);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [menuFor]);

  useEffect(() => {
    if (renameFor) {
      const t = setTimeout(() => renameInputRef.current?.select(), 0);
      return () => clearTimeout(t);
    }
  }, [renameFor]);

  const startRename = (id: string, currentName: string) => {
    setRenameValue(currentName);
    setRenameFor(id);
    setMenuFor(null);
    setMenuPos(null);
  };

  /** Toggle the menu for a row, anchoring it to the clicked trigger. */
  const toggleMenu = (sessionId: string, trigger: HTMLElement) => {
    if (menuFor === sessionId) {
      setMenuFor(null);
      setMenuPos(null);
      return;
    }
    const rect = trigger.getBoundingClientRect();
    // Anchor below the trigger, right-aligned to its right edge so the
    // menu opens flush with the ⋯ button regardless of sidebar width.
    setMenuPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
    setMenuFor(sessionId);
  };

  const commitRename = async () => {
    if (renameFor) {
      await renameSession(renameFor, renameValue);
    }
    setRenameFor(null);
  };

  return (
    <div className="sessions-section">
      {/* Full-width "add" card with a dashed border framing the accent
          button — matches the session-row width and corner radius so the
          two share a visual rhythm. */}
      <div className="sessions-new-card">
        <button
          type="button"
          className="sessions-new-btn"
          onClick={() => void createSession()}
          title="Open another folder as a new project"
        >
          + New Project
        </button>
      </div>

      {sessions.length === 0 && (
        <div className="sessions-empty">
          No saved projects yet. Click <strong>+ New</strong> or pick a
          folder from the workspace bar to begin.
        </div>
      )}

      <div className="sessions-list">
        {renderRows.map(({ session: s, depth, isWorktree }) => {
          const isActive = s.id === activeId;
          const displayName = s.name?.trim() || deriveName(s.cwd);
          const isRenaming = renameFor === s.id;
          return (
            <div
              key={s.id}
              className={
                'session-row' +
                (isActive ? ' active' : '') +
                (isWorktree ? ' worktree' : '') +
                (depth > 0 ? ' indent' : '')
              }
              onClick={(e) => {
                if (isRenaming) return;
                // Don't switch when clicking the menu trigger.
                if ((e.target as HTMLElement).closest('.session-menu-btn'))
                  return;
                if (!isActive) void switchSession(s.id);
              }}
              title={s.cwd}
            >
              {depth > 0 && (
                <span className="session-row-tree" aria-hidden />
              )}
              <span className="session-dot" aria-hidden />
              <div className="session-row-body">
                {isRenaming ? (
                  <input
                    ref={renameInputRef}
                    className="session-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onBlur={() => void commitRename()}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void commitRename();
                      if (e.key === 'Escape') setRenameFor(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                  />
                ) : (
                  <div className="session-name-row">
                    <div className="session-name">{displayName}</div>
                    {isWorktree && (
                      <span
                        className="worktree-chip"
                        title={
                          s.worktreeBase
                            ? `Worktree off ${s.worktreeBase}`
                            : 'Git worktree'
                        }
                      >
                        wt
                      </span>
                    )}
                  </div>
                )}
                <div className="session-cwd">
                  {isWorktree && s.worktreeBranch
                    ? `↳ ${s.worktreeBranch}`
                    : shortCwd(s.cwd)}
                </div>
              </div>
              <button
                type="button"
                className="session-menu-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMenu(s.id, e.currentTarget);
                }}
                aria-label="Project menu"
              >
                ⋯
              </button>
            </div>
          );
        })}
      </div>

      {/* Floating menu lives outside the scroll container so it can't be
          clipped by the sessions list's overflow. Positioned with fixed
          coords computed from the trigger button's bounding rect. */}
      {menuFor && menuPos && (() => {
        const target = sessions.find((x) => x.id === menuFor);
        const isWt = !!target?.parentProjectId;
        return (
          <div
            className="session-menu floating"
            style={{ top: menuPos.top, right: menuPos.right }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="session-menu-item"
              onClick={() => {
                if (target) {
                  startRename(
                    target.id,
                    target.name?.trim() || deriveName(target.cwd),
                  );
                }
              }}
            >
              Rename
            </button>
            <button
              type="button"
              className="session-menu-item"
              onClick={async () => {
                setMenuFor(null);
                setMenuPos(null);
                if (!target?.cwd) return;
                try {
                  const res = await window.cowork.system.openPath({
                    path: target.cwd,
                  });
                  if (!res.ok && res.error) {
                    alert(`Couldn't open folder: ${res.error}`);
                  }
                } catch (err) {
                  alert(
                    `Couldn't open folder: ${err instanceof Error ? err.message : String(err)}`,
                  );
                }
              }}
            >
              Open folder
            </button>
            {!isWt && (
              <button
                type="button"
                className="session-menu-item"
                onClick={() => {
                  setMenuFor(null);
                  setMenuPos(null);
                  if (target) setWorktreeCreateFor(target);
                }}
              >
                Branch off in worktree…
              </button>
            )}
            {isWt ? (
              <button
                type="button"
                className="session-menu-item danger"
                onClick={() => {
                  setMenuFor(null);
                  setMenuPos(null);
                  if (target) setWorktreeRemoveFor(target);
                }}
              >
                Remove worktree…
              </button>
            ) : (
              <button
                type="button"
                className="session-menu-item danger"
                onClick={() => {
                  const id = menuFor;
                  setMenuFor(null);
                  setMenuPos(null);
                  if (id) void closeSession(id);
                }}
              >
                Close project
              </button>
            )}
          </div>
        );
      })()}
      <WorktreeCreateModal
        open={worktreeCreateFor !== null}
        parent={worktreeCreateFor}
        onClose={() => setWorktreeCreateFor(null)}
      />
      <WorktreeRemoveModal
        open={worktreeRemoveFor !== null}
        target={worktreeRemoveFor}
        onClose={() => setWorktreeRemoveFor(null)}
      />
    </div>
  );
}

function deriveName(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, '');
  return trimmed.split('/').pop() || 'Project';
}

function shortCwd(cwd: string): string {
  // Replace home with ~ for readability.
  const home = navigator.userAgent.includes('Mac')
    ? null // we don't have access to homedir from renderer; do a simple shorten
    : null;
  void home;
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length <= 3) return cwd;
  return '…/' + parts.slice(-2).join('/');
}
