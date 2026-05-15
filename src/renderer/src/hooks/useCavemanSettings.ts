/**
 * Read-only hook over user-level Caveman-mode settings (Settings →
 * Experiments). Re-renders on change events broadcast from the main
 * process so the in-message "Caveman" badge appears / disappears
 * instantly when the user flips the toggle.
 *
 * Implementation note — singleton subscription
 *   The hook is called from `AssistantMessage`, which is mounted once
 *   per chat bubble. A naïve `useEffect` that calls
 *   `window.cowork.caveman.onChanged(...)` per mount registers a fresh
 *   IPC listener every time, which trips Electron's
 *   `MaxListenersExceededWarning: 11 caveman:changed listeners …`
 *   warning the moment more than ten assistant bubbles are on screen
 *   (and a pane-mode swap re-mounts many of them at once).
 *
 *   To fix that, we keep ONE module-level IPC listener and ONE module-
 *   level snapshot, plus a small set of React subscribers. The hook
 *   uses `useSyncExternalStore` so every consumer reads from the same
 *   snapshot and React handles re-render coalescing.
 *
 * Returns the settings with defaults filled in — `enabled` is always
 * a real boolean and `level` always a real `CavemanLevel`, so call
 * sites can read the fields without null checks.
 */

import { useSyncExternalStore } from 'react';
import type { CavemanLevel, CavemanSettings } from '@shared/types';

interface ResolvedCavemanSettings {
  enabled: boolean;
  level: CavemanLevel;
}

const DEFAULT: ResolvedCavemanSettings = {
  enabled: false,
  level: 'full',
};

function resolve(raw: CavemanSettings | undefined): ResolvedCavemanSettings {
  return {
    enabled: !!raw?.enabled,
    level: (raw?.level ?? 'full') as CavemanLevel,
  };
}

// ── Singleton store ─────────────────────────────────────────────
// One IPC listener for the whole renderer; multiple React components
// subscribe to its snapshot via useSyncExternalStore below.

let snapshot: ResolvedCavemanSettings = DEFAULT;
const listeners = new Set<() => void>();
let ipcUnsubscribe: (() => void) | null = null;
let primed = false;

function notify() {
  for (const l of listeners) l();
}

function ensureWired(): void {
  // First subscriber kicks off the initial fetch + IPC subscription.
  // Subsequent subscribers just join the listener set.
  if (primed) return;
  primed = true;
  void window.cowork?.caveman
    ?.get()
    .then((next) => {
      snapshot = resolve(next);
      notify();
    })
    .catch(() => {
      // bridge not ready yet — DEFAULT is already in `snapshot`.
    });
  ipcUnsubscribe =
    window.cowork?.caveman?.onChanged((next) => {
      snapshot = resolve(next);
      notify();
    }) ?? null;
}

function subscribe(cb: () => void): () => void {
  ensureWired();
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
    // We deliberately KEEP the singleton IPC listener alive even when
    // listeners.size hits 0 — the next mount will reuse it instead of
    // re-registering. This avoids churn during the common
    // "settings drawer closes, badge unmounts, settings drawer
    // reopens" cycle. The listener is harmless when idle.
    void ipcUnsubscribe; // silence unused-var lint
  };
}

function getSnapshot(): ResolvedCavemanSettings {
  return snapshot;
}

export function useCavemanSettings(): ResolvedCavemanSettings {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Friendly display label for a level. Used by the in-message badge
 * tooltip so hovering tells the user which intensity is active
 * without having to open Settings.
 */
export function formatCavemanLevel(level: CavemanLevel): string {
  switch (level) {
    case 'lite':
      return 'lite';
    case 'full':
      return 'full';
    case 'ultra':
      return 'ultra';
    case 'wenyan-lite':
      return 'wenyan · lite';
    case 'wenyan-full':
      return 'wenyan · full';
    case 'wenyan-ultra':
      return 'wenyan · ultra';
    default:
      return level;
  }
}
