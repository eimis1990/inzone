/**
 * Settings → Workspaces tab.
 *
 * Lists every workspace, shows project counts, lets the user switch /
 * rename / delete them. Workspaces are containers of projects; the
 * actual layout / agents persist on the projects themselves, not on
 * the workspace, so there's no "save changes" concept here.
 */

import { useState } from 'react';
import { useStore } from '../../store';

export function WorkspacesSection() {
  const workspaces = useStore((s) => s.workspaces);
  const sessions = useStore((s) => s.sessions);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const switchWorkspace = useStore((s) => s.switchWorkspace);
  const renameWorkspace = useStore((s) => s.renameWorkspace);
  const deleteWorkspaceById = useStore((s) => s.deleteWorkspaceById);
  const createWorkspace = useStore((s) => s.createWorkspace);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');

  return (
    <div className="settings-pane">
      <div className="settings-pane-header">
        <h2>Workspaces</h2>
        <p className="settings-pane-sub">
          Workspaces are containers of projects. Each project keeps its
          own pane layout and agent assignments; switching workspaces
          just changes which projects appear in the sidebar.
        </p>
      </div>
      <div className="settings-pane-body">
        <div className="settings-toolbar">
          <div style={{ flex: 1 }} />
          <button
            className="primary small"
            onClick={() => void createWorkspace()}
            title="Create a new workspace and pick a folder for its first project"
          >
            + New workspace
          </button>
        </div>
        {workspaces.length === 0 && (
          <div className="settings-empty">
            No workspaces yet. Click <strong>+ New workspace</strong>{' '}
            above to create one.
          </div>
        )}
        <div className="workspace-list">
          {workspaces.map((w) => {
            const selected = w.id === activeWorkspaceId;
            const isRenaming = renamingId === w.id;
            return (
              <div
                key={w.id}
                className={'workspace-card' + (selected ? ' selected' : '')}
              >
                <div className="workspace-card-main">
                  {isRenaming ? (
                    <input
                      autoFocus
                      className="workspaces-rename-input"
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={async () => {
                        await renameWorkspace(w.id, renameDraft);
                        setRenamingId(null);
                      }}
                      onKeyDown={async (e) => {
                        if (e.key === 'Enter') {
                          await renameWorkspace(w.id, renameDraft);
                          setRenamingId(null);
                        }
                        if (e.key === 'Escape') setRenamingId(null);
                      }}
                      spellCheck={false}
                    />
                  ) : (
                    <div className="workspace-card-name">
                      {selected && (
                        <span className="workspace-current-dot" aria-hidden />
                      )}
                      {w.name}
                    </div>
                  )}
                  <div className="workspace-card-meta">
                    <span className="workspace-mode">
                      {(() => {
                        // Count top-level projects only — worktrees
                        // are siblings in projectIds[] but they read
                        // as branches of the parent, not standalone
                        // projects.
                        let n = 0;
                        for (const id of w.projectIds) {
                          const session = sessions.find(
                            (p) => p.id === id,
                          );
                          if (!session) {
                            n += 1;
                          } else if (!session.parentProjectId) {
                            n += 1;
                          }
                        }
                        return `${n} project${n === 1 ? '' : 's'}`;
                      })()}
                    </span>
                  </div>
                </div>
                <div className="workspace-card-actions">
                  {!selected && (
                    <button
                      className="ghost small"
                      onClick={() => void switchWorkspace(w.id)}
                    >
                      Switch
                    </button>
                  )}
                  <button
                    className="ghost small"
                    onClick={() => {
                      setRenameDraft(w.name);
                      setRenamingId(w.id);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    className="danger small"
                    onClick={() => void deleteWorkspaceById(w.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
