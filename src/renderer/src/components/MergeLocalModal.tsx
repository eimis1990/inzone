import { useEffect, useState } from 'react';
import { useStore } from '../store';

interface MergeLocalModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * "Merge locally" modal — alternative to the PR flow for cases where
 * pushing to GitHub isn't useful (solo work, prototypes, no remote).
 *
 * Sequence:
 *   1. User confirms the commit message + base branch.
 *   2. We commit any uncommitted worktree changes.
 *   3. Switch the parent's checkout to baseBranch (if needed).
 *   4. Run `git merge <branch>` in the parent.
 *   5. Show success + offer to remove the worktree.
 *
 * Doesn't require gh, doesn't push anywhere. Refuses if the parent's
 * working tree is dirty (the backend will surface that as an error).
 */
export function MergeLocalModal({ open, onClose }: MergeLocalModalProps) {
  const session = useStore((s) =>
    s.sessions.find((p) => p.id === s.windowId),
  );
  const parent = useStore((s) => {
    const sess = s.sessions.find((p) => p.id === s.windowId);
    if (!sess?.parentProjectId) return null;
    return s.sessions.find((p) => p.id === sess.parentProjectId) ?? null;
  });
  const status = useStore((s) => s.mergeWorkflowStatus);
  const result = useStore((s) => s.mergeResult);
  const error = useStore((s) => s.mergeError);
  const mergeLocally = useStore((s) => s.mergeLocally);
  const resetMergeWorkflow = useStore((s) => s.resetMergeWorkflow);

  const [commitMessage, setCommitMessage] = useState('');
  const [baseBranch, setBaseBranch] = useState('');

  // Prefill base branch from worktreeBase on open.
  useEffect(() => {
    if (open && session?.worktreeBase && !baseBranch) {
      setBaseBranch(session.worktreeBase);
    }
    // Default commit message — derive from the branch name.
    if (open && session?.worktreeBranch && !commitMessage) {
      const tail = session.worktreeBranch.slice(
        session.worktreeBranch.lastIndexOf('/') + 1,
      );
      const humanized = tail.replace(/[-_]+/g, ' ').trim();
      const capitalized = humanized
        ? humanized.charAt(0).toUpperCase() + humanized.slice(1)
        : '';
      setCommitMessage(capitalized || `Changes on ${session.worktreeBranch}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, session]);

  const handleClose = () => {
    if (status === 'committing' || status === 'merging') {
      // Don't allow closing mid-flight — git would be in an
      // ambiguous state.
      return;
    }
    resetMergeWorkflow();
    setCommitMessage('');
    setBaseBranch('');
    onClose();
  };

  if (!open) return null;

  const formDisabled =
    status === 'committing' || status === 'merging';
  const canSubmit =
    !formDisabled &&
    commitMessage.trim().length > 0 &&
    baseBranch.trim().length > 0 &&
    session != null &&
    parent != null;

  const submit = () => {
    if (!canSubmit) return;
    void mergeLocally({ commitMessage, baseBranch });
  };

  return (
    <div className="modal-backdrop" onMouseDown={handleClose}>
      <div
        className="modal ship-pr-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Merge locally</h2>
          <p className="modal-sub">
            Commit any uncommitted changes in this worktree, then merge
            its branch into{' '}
            <code>{baseBranch || session?.worktreeBase || 'the base branch'}</code>{' '}
            in the parent project. No push, no PR.
          </p>
        </div>

        <div className="modal-body">
          {/* Destination chip — mirrors the PR modal. */}
          {parent && session && (
            <div className="ship-pr-destination">
              <span className="ship-pr-destination-label">Will merge into</span>
              <code>{parent.name ?? parent.cwd}</code>
              <span className="ship-pr-destination-arrow">·</span>
              <code>{baseBranch || session.worktreeBase}</code>
            </div>
          )}

          {!parent && (
            <div className="ship-pr-banner ship-pr-banner-error">
              <strong>Parent project not loaded.</strong>
              <div className="ship-pr-banner-body">
                Switch to the parent project once first so INZONE can
                find its folder, then come back and try again.
              </div>
            </div>
          )}

          {/* Live workflow status. */}
          {(formDisabled || status === 'done' || status === 'error') && (
            <MergeProgress
              status={status}
              result={result}
              error={error}
              onRetry={() => resetMergeWorkflow()}
            />
          )}

          {/* Form — hidden during/after the run. */}
          {!formDisabled && status !== 'done' && status !== 'error' && (
            <>
              <label className="kv-row stacked">
                <span>Commit message</span>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="Subject line for the squash commit"
                  maxLength={120}
                />
                <span className="kv-hint">
                  Used when there are uncommitted changes. Skipped if
                  the working tree is already clean.
                </span>
              </label>

              <label className="kv-row stacked">
                <span>Base branch</span>
                <input
                  type="text"
                  value={baseBranch}
                  onChange={(e) => setBaseBranch(e.target.value)}
                  placeholder={session?.worktreeBase ?? 'main'}
                />
                <span className="kv-hint">
                  Must already be checked out in the parent project.
                  Parent's working tree must be clean.
                </span>
              </label>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="ghost"
            onClick={handleClose}
            disabled={formDisabled}
          >
            {status === 'done' ? 'Close' : 'Cancel'}
          </button>
          {!formDisabled && status !== 'done' && status !== 'error' && (
            <button
              type="button"
              className="primary"
              onClick={submit}
              disabled={!canSubmit}
              title={
                !parent
                  ? 'Parent project not loaded.'
                  : !commitMessage.trim() || !baseBranch.trim()
                    ? 'Fill in commit message + base branch.'
                    : 'Commit + merge into base'
              }
            >
              Merge into {baseBranch || 'base'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface MergeProgressProps {
  status: 'idle' | 'committing' | 'merging' | 'done' | 'error';
  result: { sha?: string; fastForward: boolean } | null;
  error: string | null;
  onRetry: () => void;
}

function MergeProgress({ status, result, error, onRetry }: MergeProgressProps) {
  if (status === 'done' && result) {
    return (
      <div className="ship-pr-success">
        <div className="ship-pr-success-icon">✓</div>
        <div className="ship-pr-success-body">
          <strong>Merged</strong>
          <span className="ship-pr-success-link">
            {result.fastForward
              ? `Fast-forwarded to ${result.sha ?? 'HEAD'}`
              : `Merge commit ${result.sha ?? 'created'}`}
          </span>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="ship-pr-error">
        <strong>Merge failed.</strong>
        <div className="ship-pr-error-msg">{error}</div>
        <button type="button" className="primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  const steps: Array<{ key: typeof status; label: string }> = [
    { key: 'committing', label: 'Committing changes' },
    { key: 'merging', label: 'Merging into base' },
  ];
  const currentIdx = steps.findIndex((s) => s.key === status);

  return (
    <ol className="ship-pr-steps">
      {steps.map((s, i) => {
        let cls = 'ship-pr-step';
        if (i < currentIdx) cls += ' ship-pr-step-done';
        else if (i === currentIdx) cls += ' ship-pr-step-active';
        else cls += ' ship-pr-step-pending';
        return (
          <li key={s.key} className={cls}>
            <span className="ship-pr-step-icon">
              {i < currentIdx ? '✓' : i === currentIdx ? '⟳' : '·'}
            </span>
            <span className="ship-pr-step-label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}
