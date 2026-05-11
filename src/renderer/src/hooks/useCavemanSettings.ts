/**
 * Read-only hook over user-level Caveman-mode settings (Settings →
 * Experiments). Re-renders on change events broadcast from the main
 * process so the in-message "Caveman" badge appears / disappears
 * instantly when the user flips the toggle.
 *
 * Returns the settings with defaults filled in — `enabled` is always
 * a real boolean and `level` always a real `CavemanLevel`, so call
 * sites can read the fields without null checks.
 */

import { useEffect, useState } from 'react';
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

export function useCavemanSettings(): ResolvedCavemanSettings {
  const [prefs, setPrefs] = useState<ResolvedCavemanSettings>(DEFAULT);

  useEffect(() => {
    let cancelled = false;
    void window.cowork.caveman
      .get()
      .then((next) => {
        if (cancelled) return;
        setPrefs(resolve(next));
      })
      .catch(() => {
        // bridge not ready, default-off is fine — the message header
        // just won't show the Caveman badge until the bridge wires up.
      });
    const off = window.cowork.caveman.onChanged((next) => {
      setPrefs(resolve(next));
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return prefs;
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
