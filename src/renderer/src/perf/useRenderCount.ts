/**
 * Dev-only hook: increments `renderCounts[name]` every time the
 * calling component renders. Pair with the PerfOverlay to see
 * live numbers.
 *
 * Tree-shaken in production: callers wrap usage in
 * `if (import.meta.env.DEV) useRenderCount(...)` — actually no,
 * conditional hook calls violate the rules of hooks. Instead, the
 * hook itself is a no-op in production via the env check at the
 * very top. Vite inlines `import.meta.env.DEV` as a constant, so
 * the body branch is eliminated in the production bundle.
 */

import { useEffect, useRef } from 'react';
import { bump, recordRenderMs } from './perfStats';

export function useRenderCount(name: string, instanceKey?: string): void {
  if (!import.meta.env.DEV) return;
  // Stamp render-start in a ref so we can subtract in the effect.
  // (Setting state from here would itself trigger a re-render —
  // we're measuring, not feedback-looping.)
  const startRef = useRef(0);
  startRef.current = performance.now();
  // Record the bump synchronously so the overlay always sees the
  // up-to-date count even if the effect hasn't fired yet.
  bump(name, instanceKey);
  useEffect(() => {
    const delta = performance.now() - startRef.current;
    recordRenderMs(name, delta);
  });
}
