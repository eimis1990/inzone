import { useEffect } from 'react';
import type { PaneNode } from '@shared/types';
import { useStore } from '../store';

interface LayoutsModalProps {
  open: boolean;
  onClose: () => void;
}

interface Template {
  label: string;
  cols: number;
  rows: number;
  /** A short, action-y description shown under the preview. */
  hint: string;
}

const TEMPLATES: Template[] = [
  { label: 'Single', cols: 1, rows: 1, hint: 'One focused pane' },
  { label: '2 Sessions', cols: 2, rows: 1, hint: 'Side-by-side pair' },
  { label: '4 Sessions', cols: 2, rows: 2, hint: 'Quad — small team' },
  { label: '6 Sessions', cols: 3, rows: 2, hint: 'Six-pack' },
  { label: '8 Sessions', cols: 4, rows: 2, hint: 'Wide grid' },
  { label: '10 Sessions', cols: 5, rows: 2, hint: 'Maximum spread' },
];

/**
 * Layouts modal — picks a uniform N×M grid for the pane tree and
 * applies it. Two safety details:
 *
 *  1. **Agent-loss confirmation** — if any pane currently has an
 *     agent bound (or the Lead pane is in use), the apply path
 *     `confirm()`s first so the user can't blow away an in-flight
 *     session by accident. When every pane is empty (just-opened
 *     project), we apply directly.
 *
 *  2. **Visual language matches the Tasks modal** — gradient bloom
 *     on hover, accent-tinted borders, themed preview cells. Reads
 *     as a sibling rather than a separate aesthetic.
 */
export function LayoutsModal({ open, onClose }: LayoutsModalProps) {
  const applyLayoutTemplate = useStore((s) => s.applyLayoutTemplate);
  const panes = useStore((s) => s.panes);
  const leadPaneId = useStore((s) => s.leadPaneId);
  // The store keeps inactive sessions warm — `panes` holds runtime
  // entries for every pane across every project. The current
  // session's panes are the leaves in `tree` (plus the Lead pane
  // when in Lead mode). Filtering by these so the confirmation
  // dialog and the apply action only touch the active session's
  // sessions, not every project the user has open.
  const tree = useStore((s) => s.tree);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  // Restrict the bound-agents list to JUST the current session.
  // Walk the active tree for sub-panes; add the Lead pane id when
  // the active session is in Lead mode. Other sessions' panes —
  // even though they live in the same `panes` map — stay untouched.
  const activePaneIds = new Set<string>();
  walkLeafIds(tree, activePaneIds);
  if (leadPaneId) activePaneIds.add(leadPaneId);

  const boundAgents: string[] = [];
  for (const id of activePaneIds) {
    const p = panes[id];
    if (!p?.agentName) continue;
    if (id === leadPaneId) {
      boundAgents.push(`Lead: ${p.agentName}`);
    } else {
      boundAgents.push(p.agentName);
    }
  }
  const hasLiveAgents = boundAgents.length > 0;

  const onPick = (t: Template) => {
    if (hasLiveAgents) {
      const list = boundAgents
        .map((a) => `  • ${a}`)
        .join('\n');
      const ok = confirm(
        `Replace the current pane layout with "${t.label}"?\n\n` +
          `These running sessions will be stopped:\n${list}\n\n` +
          `The Lead pane (when used) is preserved — its agent is rebound. ` +
          `This action cannot be undone.`,
      );
      if (!ok) return;
    }
    applyLayoutTemplate(t.cols, t.rows);
    onClose();
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal layouts-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        <div className="modal-header">
          <h2>Layout templates</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">
          <p className="layouts-intro">
            Pick a uniform grid for the pane tree.
            {hasLiveAgents && (
              <>
                {' '}
                Currently running sessions will be confirmed before they're
                stopped.
              </>
            )}
          </p>
          <div className="layouts-grid">
            {TEMPLATES.map((t) => (
              <button
                key={t.label}
                className="layout-card"
                onClick={() => onPick(t)}
                title={`Arrange panes as ${t.cols}×${t.rows}`}
              >
                <div className="layout-card-body">
                  <LayoutPreview cols={t.cols} rows={t.rows} />
                  <div className="layout-meta">
                    <div className="layout-label">{t.label}</div>
                    <div className="layout-hint">{t.hint}</div>
                  </div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Walk the pane tree depth-first and collect leaf ids into the
 *  given set. Local helper so we don't have to widen the store's
 *  internal `collectLeaves` export surface. */
function walkLeafIds(node: PaneNode, out: Set<string>): void {
  if (node.kind === 'leaf') {
    out.add(node.id);
    return;
  }
  for (const c of node.children) walkLeafIds(c, out);
}

function LayoutPreview({ cols, rows }: { cols: number; rows: number }) {
  const cells: JSX.Element[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      cells.push(<div className="layout-cell" key={`${r}-${c}`} />);
    }
  }
  return (
    <div
      className="layout-preview"
      style={{
        gridTemplateColumns: `repeat(${cols}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
      }}
    >
      {cells}
    </div>
  );
}
