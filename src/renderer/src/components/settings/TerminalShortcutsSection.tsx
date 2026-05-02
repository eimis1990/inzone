/**
 * Settings tab: Terminal shortcuts.
 *
 * Lets the user create / rename / delete the quick-action buttons that
 * appear above the in-app terminal (e.g. "Run Serve" → `npx serve`).
 * Persisted via electron-store; changes broadcast through IPC so any
 * open terminal panel updates live.
 */

import { useEffect, useState } from 'react';
import { nanoid } from 'nanoid';
import type { TerminalShortcut } from '@shared/types';

export function TerminalShortcutsSection() {
  const [shortcuts, setShortcuts] = useState<TerminalShortcut[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<TerminalShortcut | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void window.cowork.terminal
      .listShortcuts()
      .then((s) => setShortcuts(s))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  // Listen for changes broadcast by main (e.g. another renderer added one).
  useEffect(() => {
    return window.cowork.terminal.onShortcutsChanged((next) => {
      setShortcuts(next);
    });
  }, []);

  const startNew = () => {
    setEditingId(null);
    setDraft({ id: nanoid(10), title: '', command: '' });
  };
  const startEdit = (s: TerminalShortcut) => {
    setEditingId(s.id);
    setDraft({ ...s });
  };
  const cancel = () => {
    setEditingId(null);
    setDraft(null);
  };

  const save = async () => {
    if (!draft) return;
    if (!draft.title.trim()) {
      setError('Give the shortcut a title.');
      return;
    }
    if (!draft.command.trim()) {
      setError('Give the shortcut a command.');
      return;
    }
    setError(undefined);
    try {
      const next = await window.cowork.terminal.saveShortcut({
        ...draft,
        title: draft.title.trim(),
        command: draft.command.trim(),
      });
      setShortcuts(next);
      cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const remove = async (s: TerminalShortcut) => {
    const ok = confirm(`Delete the "${s.title}" shortcut?`);
    if (!ok) return;
    try {
      const next = await window.cowork.terminal.deleteShortcut(s.id);
      setShortcuts(next);
      if (editingId === s.id) cancel();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="settings-pane">
      <div className="settings-pane-header">
        <h2>Terminal</h2>
        <p className="settings-pane-sub">
          Quick-action buttons that appear above the in-app terminal.
          Click one to type and run the command (sends{' '}
          <code>command + ⏎</code>). Use them for things like{' '}
          <code>npx serve</code>, <code>npm run dev</code>, or{' '}
          <code>git status</code>.
        </p>
      </div>

      <div className="settings-pane-body">
        <div className="settings-toolbar">
          <div style={{ flex: 1 }} />
          <button
            className="primary small"
            onClick={startNew}
            title="Add a shortcut button"
          >
            + Add shortcut
          </button>
        </div>

        {error && <div className="modal-error">{error}</div>}

        {loading && <div className="settings-empty">Loading shortcuts…</div>}
        {!loading && shortcuts.length === 0 && !draft && (
          <div className="settings-empty">
            No shortcuts yet. Click <strong>+ Add shortcut</strong> to
            create one.
          </div>
        )}

        <div className="term-shortcut-list">
          {shortcuts.map((s) => (
            <div className="term-shortcut-row" key={s.id}>
              <div className="term-shortcut-row-body">
                <div className="term-shortcut-title">{s.title}</div>
                <code className="term-shortcut-command">{s.command}</code>
              </div>
              <div className="term-shortcut-actions">
                <button
                  type="button"
                  className="ghost small"
                  onClick={() => startEdit(s)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className="ghost small danger"
                  onClick={() => void remove(s)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {draft && (
          <div className="term-shortcut-editor">
            <div className="term-shortcut-editor-head">
              <h3>{editingId ? 'Edit shortcut' : 'New shortcut'}</h3>
            </div>
            <label className="field">
              <span className="field-label">Title</span>
              <input
                // Auto-focus only on initial mount of the editor so
                // typing into the command field doesn't bounce focus
                // back here on every keystroke.
                autoFocus
                value={draft.title}
                onChange={(e) =>
                  setDraft({ ...draft, title: e.target.value })
                }
                placeholder="Run Serve"
                spellCheck={false}
              />
              <span className="field-hint">
                Short label printed on the button.
              </span>
            </label>
            <label className="field">
              <span className="field-label">Command</span>
              <input
                value={draft.command}
                onChange={(e) =>
                  setDraft({ ...draft, command: e.target.value })
                }
                placeholder="npx serve"
                spellCheck={false}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              <span className="field-hint">
                Sent to the terminal followed by Enter, so the command
                runs immediately. Example: <code>npm run dev</code>.
              </span>
            </label>
            <div className="term-shortcut-editor-actions">
              <button className="ghost" onClick={cancel}>
                Cancel
              </button>
              <div className="spacer" />
              <button className="primary" onClick={() => void save()}>
                {editingId ? 'Save changes' : 'Add shortcut'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
