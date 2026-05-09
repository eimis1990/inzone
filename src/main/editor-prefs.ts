/**
 * User-level editor preferences (vim mode, etc.).
 *
 * Lives in its own electron-store JSON file rather than piggy-backing
 * on the main app state — these are personal, machine-local settings
 * and we want them to survive even if the user nukes their workspace
 * state (for debugging or a fresh start). Same pattern used by
 * voice.ts.
 *
 * Listeners (BrowserWindow webContents) are registered here so the
 * IPC layer can re-broadcast `editorPrefs:changed` to every renderer
 * window after a save — matters for users running multiple INZONE
 * windows side-by-side, so toggling vim mode in one window flips it
 * everywhere without a reload.
 */

import Store from 'electron-store';
import type { EditorPreferences } from '@shared/types';

interface EditorPrefsStoreShape {
  prefs: EditorPreferences;
}

const store = new Store<EditorPrefsStoreShape>({
  name: 'inzone-editor-prefs',
  defaults: { prefs: {} },
});

export function getEditorPreferences(): EditorPreferences {
  return store.get('prefs', {});
}

export function saveEditorPreferences(next: EditorPreferences): void {
  const current = store.get('prefs', {});
  // Merge — undefined fields preserve current value, explicit booleans
  // overwrite. This keeps the IPC flexible for future fields (theme,
  // font size, etc.) without forcing every caller to send the full
  // object.
  const merged: EditorPreferences = {
    vimMode:
      next.vimMode !== undefined ? !!next.vimMode : current.vimMode,
  };
  store.set('prefs', merged);
}
