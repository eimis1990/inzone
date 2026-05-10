/**
 * Dev-only floating perf overlay.
 *
 * Renders nothing in production (gated by `import.meta.env.DEV`).
 * In dev, shows a corner widget with:
 *   - FPS (median over 60 frames)
 *   - JS heap (Chrome-only — `performance.memory.usedJSHeapSize`)
 *   - Per-component render counts + ms (since last reset)
 *   - "Reset" button so you can mark a window: send a message,
 *     reset, watch the numbers climb during the response, then
 *     reset and try again after an optimisation.
 *
 * Toggle with ⌘⇧P (or Ctrl+Shift+P on Windows/Linux). Off by default
 * so it doesn't visually distract during normal dev.
 *
 * The overlay polls via `requestAnimationFrame` and re-renders itself
 * with `useState`. The components it measures use mutable counters
 * (see perfStats.ts) — never React state — so the act of measuring
 * doesn't itself trigger renders in the measured components.
 */

import { useEffect, useState } from 'react';
import {
  lastRenderMs,
  renderCounts,
  renderCountsByInstance,
  resetAll,
} from './perfStats';

// Memory API isn't in the TS lib but Chromium ships it.
interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

export function PerfOverlay() {
  // Production: render nothing, ever. Vite inlines the constant.
  if (!import.meta.env.DEV) return null;

  // Visible by default off — toggled by ⌘⇧P. We persist the state
  // in localStorage so it stays open across reloads during a
  // measurement session.
  const [open, setOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem('inzone.perfOverlay.open') === '1';
    } catch {
      return false;
    }
  });

  // Tick state to force re-render on each animation frame while open.
  const [, setTick] = useState(0);
  // FPS sample buffer: keep the last 60 frame deltas.
  const [fps, setFps] = useState(60);
  const [heapMb, setHeapMb] = useState<number | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() !== 'p') return;
      if (!(e.metaKey || e.ctrlKey)) return;
      if (!e.shiftKey) return;
      if (e.altKey) return;
      e.preventDefault();
      setOpen((v) => {
        const next = !v;
        try {
          localStorage.setItem(
            'inzone.perfOverlay.open',
            next ? '1' : '0',
          );
        } catch {
          // localStorage unavailable — fine, state stays in-memory
        }
        return next;
      });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Only run the rAF loop while the overlay is open — otherwise we'd
  // be doing the very thing we're trying to measure (eat CPU). Off
  // = zero overhead.
  useEffect(() => {
    if (!open) return;
    let raf = 0;
    let last = performance.now();
    const samples: number[] = [];
    const tick = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      // Frame delta → instant FPS; keep a rolling buffer for the
      // median (less jumpy than raw rates).
      samples.push(1000 / dt);
      if (samples.length > 60) samples.shift();
      const sorted = [...samples].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)] ?? 60;
      setFps(Math.round(median));
      const mem = (performance as PerformanceWithMemory).memory;
      if (mem) setHeapMb(Math.round(mem.usedJSHeapSize / (1024 * 1024)));
      setTick((t) => (t + 1) % 1024);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [open]);

  if (!open) return null;

  const rows = Object.entries(renderCounts).sort((a, b) => b[1] - a[1]);

  return (
    <div className="perf-overlay">
      <div className="perf-overlay-head">
        <span className="perf-overlay-title">perf</span>
        <span className="perf-overlay-fps">
          {fps} fps
          {heapMb != null && (
            <span className="perf-overlay-heap"> · {heapMb} MB heap</span>
          )}
        </span>
        <button
          type="button"
          className="perf-overlay-reset"
          onClick={() => {
            resetAll();
            setTick((t) => (t + 1) % 1024);
          }}
          title="Reset all counters"
        >
          reset
        </button>
        <button
          type="button"
          className="perf-overlay-close"
          onClick={() => setOpen(false)}
          title="Close (⌘⇧P)"
        >
          ×
        </button>
      </div>
      <table className="perf-overlay-table">
        <thead>
          <tr>
            <th>component</th>
            <th>renders</th>
            <th>last ms</th>
            <th>inst</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, count]) => {
            const ms = lastRenderMs[name];
            const instances = Object.keys(
              renderCountsByInstance[name] ?? {},
            ).length;
            return (
              <tr key={name}>
                <td>{name}</td>
                <td className="perf-num">{count}</td>
                <td className="perf-num">{ms != null ? ms.toFixed(1) : '–'}</td>
                <td className="perf-num">{instances || '–'}</td>
              </tr>
            );
          })}
          {rows.length === 0 && (
            <tr>
              <td colSpan={4} className="perf-empty">
                no renders recorded yet — interact with the app
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div className="perf-overlay-hint">⌘⇧P to toggle</div>
    </div>
  );
}
