/**
 * Read-only hook over user-level editor preferences (Settings →
 * Editor). Re-renders on change events broadcast from the main
 * process so a vim-mode toggle takes effect everywhere instantly.
 *
 * Returns a stable object with one boolean today (`vimMode`); future
 * additions (theme, font size) flow through the same shape so call
 * sites don't have to be re-plumbed.
 */

import { useEffect, useState } from 'react';
import type { EditorPreferences } from '@shared/types';

const DEFAULT: Required<EditorPreferences> = {
  vimMode: false,
};

export function useEditorPreferences(): Required<EditorPreferences> {
  const [prefs, setPrefs] = useState<Required<EditorPreferences>>(DEFAULT);

  useEffect(() => {
    let cancelled = false;
    void window.cowork.editorPrefs
      .get()
      .then((next) => {
        if (cancelled) return;
        setPrefs({ ...DEFAULT, ...next });
      })
      .catch(() => {
        // bridge not ready, default-off is fine
      });
    const off = window.cowork.editorPrefs.onChanged((next) => {
      setPrefs({ ...DEFAULT, ...next });
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return prefs;
}
