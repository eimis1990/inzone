/**
 * Settings → Editor.
 *
 * One small home for personal preferences that apply to every
 * CodeMirror surface in the app: agent / skill prompt editor, wiki
 * page editor, CLAUDE.md editor, MCP raw-JSON editor.
 *
 * Today: just a Vim-mode toggle. Future: theme picker, font size,
 * line wrapping. Keeping the section in the nav so future additions
 * have an obvious home.
 *
 * Persistence + sync:
 *  - Reads / writes through `window.cowork.editorPrefs` which talks
 *    to a dedicated electron-store JSON in the user's app-data dir.
 *  - Writes broadcast `editorPrefs:changed` to every BrowserWindow,
 *    so toggling the switch in one INZONE window updates editors
 *    open in another window without a reload.
 *  - `useEditorPreferences()` hook is what every CodeMirror call
 *    site uses to pick up the live value.
 */

import { useEffect, useState } from 'react';
import type { EditorPreferences } from '@shared/types';

export function EditorSection() {
  const [prefs, setPrefs] = useState<EditorPreferences>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.cowork.editorPrefs
      .get()
      .then((next) => {
        if (cancelled) return;
        setPrefs(next);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    // Pick up changes from other windows so this UI stays in sync.
    const off = window.cowork.editorPrefs.onChanged((next) => {
      setPrefs(next);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const updateVim = async (vimMode: boolean) => {
    setPrefs((p) => ({ ...p, vimMode }));
    try {
      await window.cowork.editorPrefs.save({ vimMode });
    } catch {
      // Save failure rolls the toggle back to whatever main currently
      // has — re-fetch defensively.
      const current = await window.cowork.editorPrefs.get();
      setPrefs(current);
    }
  };

  return (
    <div className="settings-pane">
      <div className="settings-pane-header">
        <h2>Editor</h2>
        <p className="settings-pane-sub">
          Preferences that apply to every code editor inside INZONE — the
          agent / skill prompt editor, the wiki page editor, CLAUDE.md, and
          the MCP raw-JSON view.
        </p>
      </div>

      <div className="settings-pane-body">
        <section className="settings-section">
          <h3>Vim mode</h3>
          <p className="settings-section-sub">
            Modal editing across every CodeMirror surface. Press{' '}
            <kbd className="shortcut-key">Esc</kbd> for normal mode,{' '}
            <kbd className="shortcut-key">i</kbd> to insert. Visual mode,
            registers, marks, search and dot-repeat all work — backed by{' '}
            <code>@replit/codemirror-vim</code>.
          </p>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={!!prefs.vimMode}
              disabled={!loaded}
              onChange={(e) => void updateVim(e.target.checked)}
            />
            <span className="toggle-label">
              {prefs.vimMode ? 'Enabled' : 'Disabled'}
            </span>
          </label>
          <p className="settings-section-hint">
            Off by default. Toggling takes effect immediately in every
            open editor — no reload needed.
          </p>
        </section>
      </div>
    </div>
  );
}
