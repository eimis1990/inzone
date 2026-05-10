/**
 * Dev-only renderer perf stats.
 *
 * Module-level mutable counters that components ping via
 * `useRenderCount(name)`. The overlay reads them on each animation
 * frame (it lives outside React's render path so the act of
 * measuring doesn't inflate the numbers we're trying to measure).
 *
 * Production builds dead-code-eliminate this whole module via
 * `import.meta.env.DEV` checks at every call site, so there is no
 * runtime cost when shipped.
 *
 * Design notes:
 *  - No React state. The overlay polls via rAF and re-renders itself.
 *    If we put renders into Zustand, every render-count update would
 *    trigger a renderer re-render, which would trigger another count,
 *    which would... you get the idea.
 *  - Counts are *cumulative since app start*. The overlay computes
 *    per-second rates by snapshotting at intervals.
 *  - We track BOTH a name (e.g. "Pane") and a fine-grained id (e.g.
 *    a paneId) so the overlay can show "Pane: 412 total, 3 unique".
 */

/** Lifetime render count per component name (e.g. "Pane",
 *  "MessageView", "Markdown"). */
export const renderCounts: Record<string, number> = Object.create(null);

/** Last-observed render duration (ms) per component name — measured
 *  from a tiny rAF probe inside `useRenderCount`. Approximation only;
 *  React doesn't expose true commit timings without the official
 *  Profiler API. */
export const lastRenderMs: Record<string, number> = Object.create(null);

/** Optional per-instance counts (e.g. renders for pane abc123).
 *  Useful for spotting "one pane is re-rendering 10x more than the
 *  others". Cleared when paneId disappears (best effort — we don't
 *  GC orphans). */
export const renderCountsByInstance: Record<
  string,
  Record<string, number>
> = Object.create(null);

/**
 * Increment a counter. Cheap — just two object property mutations.
 * Designed to be called from inside a component's render. The
 * `renderStartedAt` companion captures a timestamp the overlay can
 * read to derive a per-render delta.
 */
export function bump(name: string, instanceKey?: string): void {
  renderCounts[name] = (renderCounts[name] ?? 0) + 1;
  if (instanceKey) {
    const bucket =
      renderCountsByInstance[name] ?? (renderCountsByInstance[name] = {});
    bucket[instanceKey] = (bucket[instanceKey] ?? 0) + 1;
  }
}

/** Capture a render-end timestamp via microtask so we can subtract
 *  from the render-start in the same effect. Effects run after the
 *  commit, so the delta approximates "render + commit" time. */
export function recordRenderMs(name: string, ms: number): void {
  lastRenderMs[name] = ms;
}

/** Reset every counter — used by the overlay's "Reset" button so
 *  the user can mark a fresh window (e.g. "send this message →
 *  reset → measure"). */
export function resetAll(): void {
  for (const k of Object.keys(renderCounts)) delete renderCounts[k];
  for (const k of Object.keys(lastRenderMs)) delete lastRenderMs[k];
  for (const k of Object.keys(renderCountsByInstance)) {
    delete renderCountsByInstance[k];
  }
}
