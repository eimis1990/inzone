import { useEffect, useMemo, useState } from 'react';
import { useStore } from '../store';
import type { PaneId, ReviewFile, ReviewHunk } from '@shared/types';
import { ShipPRModal } from './ShipPRModal';
import { MergeLocalModal } from './MergeLocalModal';

/**
 * Diff Review view — renders the structured diff for the active
 * worktree project. Two-column layout: file tree on the left, diff
 * viewer on the right. Each hunk in the right pane has Approve and
 * Reject toggle buttons; rejected hunks are reverted in the working
 * tree when the toolbar's "Apply rejects" button is pressed. A
 * "Send back to agent" affordance reverts AND posts a revision note
 * into the chosen pane to kick off another agent turn.
 *
 * Auto-loads the diff on mount (the chip's onClick already kicks one
 * off, but if the user reloads the app while review is the active
 * view, we need to hydrate again here).
 */
export function ReviewView() {
  const reviewState = useStore((s) => s.reviewState);
  const reviewLoading = useStore((s) => s.reviewLoading);
  const reviewError = useStore((s) => s.reviewError);
  const selectedPath = useStore((s) => s.reviewSelectedFile);
  const setSelected = useStore((s) => s.setReviewSelectedFile);
  const loadReview = useStore((s) => s.loadReview);
  const [shipOpen, setShipOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);

  // Self-hydrate when arriving here without state already loaded.
  useEffect(() => {
    if (!reviewState && !reviewLoading && !reviewError) {
      void loadReview();
    }
    // We intentionally don't include reviewError in deps - we only
    // want to retry on demand (the toolbar's Reload button).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reviewState, reviewLoading]);

  const selectedFile = useMemo(() => {
    if (!reviewState || !selectedPath) return null;
    return reviewState.files.find((f) => f.path === selectedPath) ?? null;
  }, [reviewState, selectedPath]);

  return (
    <div className="review-view">
      <ReviewToolbar
        onOpenShip={() => setShipOpen(true)}
        onOpenMerge={() => setMergeOpen(true)}
      />
      <ShipPRModal open={shipOpen} onClose={() => setShipOpen(false)} />
      <MergeLocalModal open={mergeOpen} onClose={() => setMergeOpen(false)} />
      {reviewLoading && !reviewState && (
        <div className="review-empty">Loading diff...</div>
      )}
      {reviewError && (
        <div className="review-error">
          <strong>Could not load diff.</strong>
          <div className="review-error-msg">{reviewError}</div>
          <button type="button" onClick={() => void loadReview()}>
            Try again
          </button>
        </div>
      )}
      {reviewState && reviewState.isEmpty && (
        <div className="review-empty">
          No changes against{' '}
          <code className="review-base-pill">{reviewState.baseBranch}</code>
          {' '}- nothing to review yet.
        </div>
      )}
      {reviewState && !reviewState.isEmpty && (
        <div className="review-body">
          <ReviewFileTree
            files={reviewState.files}
            selectedPath={selectedPath}
            onSelect={setSelected}
          />
          <div className="review-diff-pane">
            {selectedFile ? (
              <ReviewDiffPane file={selectedFile} />
            ) : (
              <div className="review-empty review-empty-inline">
                Select a file on the left to see its diff.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

interface ToolbarProps {
  onOpenShip: () => void;
  onOpenMerge: () => void;
}

/**
 * Top toolbar - branch direction, change totals, decision counts,
 * and the action buttons: Approve all, Apply rejects, Reload, Open
 * PR, Merge locally.
 */
function ReviewToolbar({ onOpenShip, onOpenMerge }: ToolbarProps) {
  const reviewState = useStore((s) => s.reviewState);
  const reviewLoading = useStore((s) => s.reviewLoading);
  const reviewApplying = useStore((s) => s.reviewApplying);
  const decisions = useStore((s) => s.reviewHunkDecisions);
  const loadReview = useStore((s) => s.loadReview);
  const approveAll = useStore((s) => s.approveAllHunks);
  const applyDecisions = useStore((s) => s.applyHunkDecisions);

  const counts = useMemo(() => {
    let approved = 0;
    let rejected = 0;
    let pending = 0;
    if (!reviewState) return { approved, rejected, pending, total: 0 };
    for (const id of Object.keys(reviewState.hunksById)) {
      const d = decisions[id] ?? 'pending';
      if (d === 'approve') approved += 1;
      else if (d === 'reject') rejected += 1;
      else pending += 1;
    }
    return {
      approved,
      rejected,
      pending,
      total: Object.keys(reviewState.hunksById).length,
    };
  }, [reviewState, decisions]);

  const hasRejects = counts.rejected > 0;

  return (
    <div className="review-toolbar">
      {/* Row 1 — title + branch info on the left, action buttons
          on the right. Branch info stays on a single line; the
          decision-count chips drop to row 2 underneath. */}
      <div className="review-toolbar-row">
        <div className="review-toolbar-title">
          <span className="review-toolbar-label">Review</span>
          {reviewState && (
            <span className="review-branch-row">
              <code className="review-base-pill">
                {reviewState.worktreeBranch}
              </code>
              <span className="review-arrow">→</span>
              <code className="review-base-pill">
                {reviewState.baseBranch}
              </code>
              <span className="review-counts">
                <span className="review-count-add">
                  +{reviewState.totalAdditions}
                </span>{' '}
                <span className="review-count-del">
                  −{reviewState.totalDeletions}
                </span>
              </span>
            </span>
          )}
        </div>
        {/* No spacer here — `.review-toolbar-title` has flex: 1, which
            pushes the buttons to the right naturally. A second flex: 1
            spacer would split the row in half and squeeze the title's
            branch pills to ~50% width (caused "main" to render as
            "ma..." even on a wide window). */}
        {reviewState && counts.pending > 0 && (
          <button
            type="button"
            className="review-toolbar-btn"
            onClick={() => approveAll()}
            title="Mark every pending hunk as approved"
          >
            Approve all
          </button>
        )}
        {hasRejects && (
          <button
            type="button"
            className="review-toolbar-btn review-toolbar-btn-danger"
            onClick={() => void applyDecisions()}
            disabled={reviewApplying}
            title="Revert the rejected hunks in the worktree"
          >
            {reviewApplying
              ? 'Applying...'
              : `Apply rejects (${counts.rejected})`}
          </button>
        )}
        <button
          type="button"
          className="review-toolbar-btn"
          onClick={() => void loadReview()}
          disabled={reviewLoading}
          title="Reload the diff from disk"
        >
          {reviewLoading ? 'Loading...' : '↻ Reload'}
        </button>
        {/* "Open PR" — only show when there's something to ship.
            Disabled while pending rejects exist (user should resolve
            them first, otherwise rejected hunks would ship as part of
            the PR). */}
        {reviewState && !reviewState.isEmpty && (
          <>
            <button
              type="button"
              className="review-toolbar-btn"
              onClick={onOpenMerge}
              disabled={counts.rejected > 0 || reviewApplying}
              title={
                counts.rejected > 0
                  ? 'Apply or clear the rejected hunks first.'
                  : 'Merge into the parent branch locally (no push, no PR).'
              }
            >
              Merge locally
            </button>
            <button
              type="button"
              className="review-toolbar-btn review-toolbar-btn-primary"
              onClick={onOpenShip}
              disabled={counts.rejected > 0 || reviewApplying}
              title={
                counts.rejected > 0
                  ? 'Apply or clear the rejected hunks first.'
                  : 'Commit, push, and open a PR via gh.'
              }
            >
              Open PR
            </button>
          </>
        )}
      </div>

      {/* Row 2 — decision chips. Lives on its own line beneath the
          title/buttons row so the long branch name has room to
          breathe. Hidden when there's nothing to count. */}
      {reviewState && counts.total > 0 && (
        <div className="review-decision-counts">
          <span className="review-decision-chip review-decision-approved">
            ✓ {counts.approved}
          </span>
          <span className="review-decision-chip review-decision-rejected">
            ✕ {counts.rejected}
          </span>
          <span className="review-decision-chip review-decision-pending">
            • {counts.pending}
          </span>
        </div>
      )}
    </div>
  );
}

interface FileTreeProps {
  files: ReviewFile[];
  selectedPath: string | null;
  onSelect: (path: string | null) => void;
}

/**
 * Flat file list. Each row shows status icon, path, and per-file
 * +N/-M counts. Folding into a real tree is left for a later polish
 * pass - flat lists scale fine to a few hundred files.
 */
function ReviewFileTree({ files, selectedPath, onSelect }: FileTreeProps) {
  return (
    <ul className="review-file-tree">
      {files.map((f) => (
        <li
          key={f.path}
          className={
            'review-file-row' +
            (f.path === selectedPath ? ' review-file-row-active' : '')
          }
          onClick={() => onSelect(f.path)}
        >
          <span
            className={'review-file-status review-file-status-' + f.status}
            title={f.status}
            aria-hidden
          >
            {statusGlyph(f.status)}
          </span>
          <span className="review-file-path" title={f.path}>
            {f.path}
          </span>
          <span className="review-file-counts">
            <span className="review-count-add">+{f.additions}</span>
            <span className="review-count-del">−{f.deletions}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

interface DiffPaneProps {
  file: ReviewFile;
}

/**
 * Right pane: list of HunkCards for the selected file plus a
 * SendBackPanel footer that surfaces when the user has rejected
 * something.
 */
function ReviewDiffPane({ file }: DiffPaneProps) {
  // Subscribe to the hunk dictionary as a stable reference; derive
  // the per-file hunk array via useMemo so we don't return a fresh
  // array out of the selector on every render (Zustand v5's Object.is
  // comparison would treat a new array as a state change → infinite
  // re-render → grey-screen crash, the same bug we hit in PipelineBoard).
  const hunksById = useStore((s) => s.reviewState?.hunksById);
  const hunks = useMemo(() => {
    if (!hunksById) return [] as ReviewHunk[];
    return file.hunkIds.map((id) => hunksById[id]).filter(Boolean);
  }, [hunksById, file.hunkIds]);

  if (file.binary) {
    return (
      <div className="review-empty review-empty-inline">
        Binary file - no textual diff.
      </div>
    );
  }
  if (hunks.length === 0) {
    return (
      <div className="review-empty review-empty-inline">
        No hunks to display.
      </div>
    );
  }

  return (
    <div className="review-hunks">
      {hunks.map((h) => (
        <ReviewHunkCard key={h.id} hunk={h} />
      ))}
      <SendBackPanel file={file} />
    </div>
  );
}

interface HunkCardProps {
  hunk: ReviewHunk;
}

/** Single hunk card: header with Approve/Reject toggles + diff body.
 *  The card border tints to reflect the current decision so the user
 *  can scan a long diff and see what is decided at a glance. */
function ReviewHunkCard({ hunk }: HunkCardProps) {
  const decision = useStore(
    (s) => s.reviewHunkDecisions[hunk.id] ?? 'pending',
  );
  const setDecision = useStore((s) => s.setHunkDecision);

  const lines = useMemo(() => hunk.content.split('\n'), [hunk.content]);

  return (
    <div className={'review-hunk review-hunk-' + decision}>
      <div className="review-hunk-header">
        <code>{hunk.header}</code>
        <div className="review-hunk-actions">
          <button
            type="button"
            className={
              'review-hunk-btn review-hunk-btn-approve' +
              (decision === 'approve' ? ' active' : '')
            }
            onClick={() => setDecision(hunk.id, 'approve')}
            title="Approve this hunk"
          >
            Approve
          </button>
          <button
            type="button"
            className={
              'review-hunk-btn review-hunk-btn-reject' +
              (decision === 'reject' ? ' active' : '')
            }
            onClick={() => setDecision(hunk.id, 'reject')}
            title="Reject and revert this hunk on Apply"
          >
            Reject
          </button>
        </div>
      </div>
      <pre className="review-hunk-body">
        {lines.map((line, i) => {
          let cls = 'review-line';
          if (line.startsWith('+') && !line.startsWith('+++')) {
            cls += ' review-line-add';
          } else if (line.startsWith('-') && !line.startsWith('---')) {
            cls += ' review-line-del';
          } else {
            cls += ' review-line-ctx';
          }
          return (
            <div key={i} className={cls}>
              {line || ' '}
            </div>
          );
        })}
      </pre>
    </div>
  );
}

interface SendBackPanelProps {
  file: ReviewFile;
}

/** Per-file footer: opens a small form with a pane picker (when more
 *  than one pane is in the worktree) plus a textarea. Submitting
 *  reverts the rejected hunks AND posts the note to the picked pane,
 *  starting a fresh agent turn. */
function SendBackPanel({ file }: SendBackPanelProps) {
  void file;
  const decisions = useStore((s) => s.reviewHunkDecisions);
  const sendBack = useStore((s) => s.sendBackToAgent);
  const reviewApplying = useStore((s) => s.reviewApplying);

  // Subscribe to the panes map as a stable reference; derive the
  // filtered list via useMemo to avoid returning a fresh array out of
  // the selector on every render (would otherwise trip Zustand's
  // equality check and cause infinite renders).
  const panesMap = useStore((s) => s.panes);
  const panes = useMemo(
    () =>
      Object.values(panesMap)
        .filter((p) => p.agentName)
        .map((p) => ({ id: p.id, agentName: p.agentName! })),
    [panesMap],
  );

  const [note, setNote] = useState('');
  const [paneId, setPaneId] = useState<PaneId | null>(
    panes.length === 1 ? panes[0].id : null,
  );
  const [open, setOpen] = useState(false);

  const rejectCountAll = useMemo(() => {
    let n = 0;
    for (const v of Object.values(decisions)) if (v === 'reject') n += 1;
    return n;
  }, [decisions]);

  if (rejectCountAll === 0 && !open) return null;

  const canSend = !!paneId && note.trim().length > 0 && !reviewApplying;

  const handleSend = async () => {
    if (!canSend || !paneId) return;
    await sendBack({ paneId, note });
    setNote('');
    setOpen(false);
  };

  return (
    <div className="review-sendback">
      {!open ? (
        <button
          type="button"
          className="review-sendback-open"
          onClick={() => setOpen(true)}
        >
          Send back to agent...
        </button>
      ) : (
        <div className="review-sendback-form">
          <div className="review-sendback-head">
            <strong>Send back to agent</strong>
            <span className="review-sendback-sub">
              Reverts rejected hunks ({rejectCountAll}) and posts your note
              as a new turn so the agent can revise.
            </span>
          </div>
          {panes.length > 1 && (
            <label className="review-sendback-pane">
              <span>Which pane?</span>
              <select
                value={paneId ?? ''}
                onChange={(e) => setPaneId(e.target.value || null)}
              >
                <option value="">Pick a pane...</option>
                {panes.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.agentName}
                  </option>
                ))}
              </select>
            </label>
          )}
          <textarea
            className="review-sendback-note"
            placeholder="Tell the agent what to fix..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={4}
            spellCheck={false}
          />
          <div className="review-sendback-actions">
            <button
              type="button"
              className="review-toolbar-btn"
              onClick={() => {
                setOpen(false);
                setNote('');
              }}
            >
              Cancel
            </button>
            <button
              type="button"
              className="review-toolbar-btn review-toolbar-btn-primary"
              disabled={!canSend}
              onClick={() => void handleSend()}
              title={
                !paneId
                  ? 'Pick a pane to send to'
                  : !note.trim()
                    ? 'Write a note for the agent'
                    : 'Revert and send the note'
              }
            >
              {reviewApplying ? 'Applying...' : 'Revert & send'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function statusGlyph(status: ReviewFile['status']): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'modified':
      return 'M';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    default:
      return '?';
  }
}
