/**
 * Storage for terminal shortcut buttons (the "Run Serve", "npm run dev",
 * etc. quick-actions that appear above the in-app xterm).
 *
 * Tiny electron-store wrapper — kept separate from `terminal.ts` so the
 * PTY runtime stays focused on shells and IO.
 */

import Store from 'electron-store';
import type { TerminalShortcut } from '@shared/types';

interface ShortcutStoreShape {
  shortcuts: TerminalShortcut[];
}

const store = new Store<ShortcutStoreShape>({
  name: 'inzone-terminal-shortcuts',
  defaults: { shortcuts: [] },
});

export function listShortcuts(): TerminalShortcut[] {
  return store.get('shortcuts', []);
}

export function saveShortcut(s: TerminalShortcut): TerminalShortcut[] {
  const next = store.get('shortcuts', []);
  const idx = next.findIndex((x) => x.id === s.id);
  if (idx >= 0) next[idx] = s;
  else next.push(s);
  store.set('shortcuts', next);
  return next;
}

export function deleteShortcut(id: string): TerminalShortcut[] {
  const next = store.get('shortcuts', []).filter((x) => x.id !== id);
  store.set('shortcuts', next);
  return next;
}

export function reorderShortcuts(
  ids: string[],
): TerminalShortcut[] {
  const cur = store.get('shortcuts', []);
  const byId = new Map(cur.map((s) => [s.id, s]));
  const ordered = ids.map((id) => byId.get(id)).filter((s): s is TerminalShortcut => !!s);
  // Append any that weren't in `ids` (defensive).
  for (const s of cur) {
    if (!ids.includes(s.id)) ordered.push(s);
  }
  store.set('shortcuts', ordered);
  return ordered;
}
