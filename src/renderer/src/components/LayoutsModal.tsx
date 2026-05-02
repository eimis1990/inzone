import { useEffect } from 'react';
import { useStore } from '../store';

interface LayoutsModalProps {
  open: boolean;
  onClose: () => void;
}

interface Template {
  label: string;
  cols: number;
  rows: number;
}

const TEMPLATES: Template[] = [
  { label: 'Single', cols: 1, rows: 1 },
  { label: '2 Sessions', cols: 2, rows: 1 },
  { label: '4 Sessions', cols: 2, rows: 2 },
  { label: '6 Sessions', cols: 3, rows: 2 },
  { label: '8 Sessions', cols: 4, rows: 2 },
  { label: '10 Sessions', cols: 5, rows: 2 },
];

export function LayoutsModal({ open, onClose }: LayoutsModalProps) {
  const applyLayoutTemplate = useStore((s) => s.applyLayoutTemplate);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

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
          <div className="layouts-grid">
            {TEMPLATES.map((t) => (
              <button
                key={t.label}
                className="layout-card"
                onClick={() => {
                  applyLayoutTemplate(t.cols, t.rows);
                  onClose();
                }}
                title={`Arrange panes as ${t.cols}×${t.rows}`}
              >
                <LayoutPreview cols={t.cols} rows={t.rows} />
                <div className="layout-label">{t.label}</div>
              </button>
            ))}
          </div>
          <div className="layouts-footnote">
            Applying a template replaces the current pane layout. Sessions in
            existing panes will be stopped.
          </div>
        </div>
      </div>
    </div>
  );
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
