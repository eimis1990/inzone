import { useEffect, useState } from 'react';
import type { WindowState } from '@shared/types';
import { useStore } from '../store';

interface WorktreeRemoveModalProps {
  open: boolean;
  target: WindowState | null;
  onClose: () => void;
}

/**
 * Confirmation + branch-cleanup picker for `Remove worktree…`. Shows
 * the worktree's branch + folder, lets the user opt into deleting the
 * branch and into a forced removal (when the worktree has uncommitted
 * changes, plain `git worktree remove` refuses).
 */
export function WorktreeRemoveModal({
  open,
  target,
  onClose,
}: WorktreeRemoveModalProps) {
  const removeWorktreeProject = useStore((s) => s.removeWorktreeProject);
  const [deleteBranch, setDeleteBranch] = useState(false);
  const [force, setForce] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDeleteBranch(false);
      setForce(false);
      setError(null);
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !submitting) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose, submitting]);

  const submit = async () => {
    if (!target || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await removeWorktreeProject({
        projectId: target.id,
        force,
        deleteBranch,
      });
      if (res.warnings.length > 0) {
        // Surface non-fatal warnings (e.g. "couldn't delete branch
        // because it has unmerged commits") in an alert before closing.
        alert(res.warnings.join('\n'));
      }
      onClose();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If git refused because the worktree is dirty, suggest --force
      // so the user can re-attempt without re-entering the dialog.
      if (msg.includes('contains modified or untracked files')) {
        setError(
          'The worktree has uncommitted changes. Tick "Force remove" below if you want to drop them anyway.',
        );
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open || !target) return null;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal worktree-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Remove worktree</h2>
          <p className="modal-sub">
            Removes the worktree's folder and unlinks it from the repo.
            The parent project and its history aren't touched.
          </p>
        </div>

        <div className="modal-body">
          <div className="kv-row stacked">
            <span>Worktree</span>
            <code className="worktree-folder-preview">{target.cwd}</code>
            {target.worktreeBranch && (
              <span className="kv-hint">
                Branch: <code>{target.worktreeBranch}</code>
                {target.worktreeBase ? (
                  <>
                    {' '}· branched from <code>{target.worktreeBase}</code>
                  </>
                ) : null}
              </span>
            )}
          </div>

          {target.worktreeBranch && (
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={deleteBranch}
                onChange={(e) => setDeleteBranch(e.target.checked)}
              />
              <div>
                <div>
                  Also delete branch <code>{target.worktreeBranch}</code>
                </div>
                <span className="kv-hint">
                  Runs <code>git branch -D</code>. If the branch has
                  unmerged commits, deletion may fail and you'll see a
                  warning — the worktree itself still gets removed.
                </span>
              </div>
            </label>
          )}

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={force}
              onChange={(e) => setForce(e.target.checked)}
            />
            <div>
              <div>Force remove (discard uncommitted changes)</div>
              <span className="kv-hint">
                Adds <code>--force</code>. Only tick if you're sure
                nothing in the worktree is worth saving.
              </span>
            </div>
          </label>

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="ghost"
            onClick={onClose}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="primary danger"
            onClick={() => void submit()}
            disabled={submitting}
          >
            {submitting ? 'Removing…' : 'Remove worktree'}
          </button>
        </div>
      </div>
    </div>
  );
}
