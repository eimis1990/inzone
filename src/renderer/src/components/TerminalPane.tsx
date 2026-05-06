/**
 * TerminalPane — a full pane occupied by an embedded xterm.js
 * connected to a per-pane PTY. This is the runtime side of the
 * "Workers → Other → Claude Code / Codex / Aider / Gemini /
 * Terminal" preset cards: when the user drops a preset on a pane
 * (Phase 2), the store flips that pane's leaf to `workerKind:
 * 'terminal'`, and the Pane component branches here instead of
 * rendering the chat UI.
 *
 * Lifecycle:
 *  - On mount: spawn a PTY in the project's cwd. If the preset has a
 *    `command`, the main process types it into the shell after a
 *    short rc-file warm-up; the user keeps a real shell behind the
 *    CLI so it's still usable when the CLI exits.
 *  - On unmount: kill the PTY and clear the runtime mapping. We do
 *    NOT keep PTYs alive across project switches in v1 — matches the
 *    bottom-bar Terminal's behaviour and keeps the resource model
 *    simple (no detached buffers, no reconnection logic).
 *  - On project cwd change: nothing special to do — closePane and
 *    setPaneAgent kill the PTY for us, and remounting under a new
 *    project yields a fresh shell in the new cwd.
 *
 * The wrapper chrome (active-pane border, header, drag-to-set-active)
 * mirrors the regular agent Pane so terminal panes feel like native
 * peers in the layout, not a different control surface.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import '@xterm/xterm/css/xterm.css';
import type { PaneId } from '@shared/types';
import { findWorkerPreset } from '@shared/worker-presets';
import { useStore } from '../store';
import { CloseIcon } from './icons';
import { WorkerPresetIcon } from './worker-presets';
import {
  attachTerminalSession,
  createTerminalSession,
  destroyTerminalSession,
  detachTerminalSession,
  getTerminalSession,
} from './terminal-sessions';

interface Props {
  id: PaneId;
}

export function TerminalPane({ id }: Props) {
  const pane = useStore((s) => s.panes[id]);
  const cwd = useStore((s) => s.cwd);
  const isActive = useStore((s) => s.activePaneId === id);
  const setActivePane = useStore((s) => s.setActivePane);
  const closePane = useStore((s) => s.closePane);
  const setPanePtyId = useStore((s) => s.setPanePtyId);

  const preset = findWorkerPreset(pane?.presetId);
  // Terminal panes are always identified by their preset (Codex CLI,
  // Claude Code, etc.) — we deliberately ignore any pane name a
  // previous agent left on this leaf, since it referred to an
  // identity that no longer applies. Drop on a different preset and
  // the title updates accordingly.
  const headerTitle = preset?.name ?? 'Terminal';

  const containerRef = useRef<HTMLDivElement | null>(null);

  const [error, setError] = useState<string | undefined>();
  // Bumped by the Reset action to force the spawn effect to re-run
  // with a fresh PTY + xterm. We destroy the existing pooled session
  // imperatively in the reset handler, then this counter triggers
  // the layout effect to recreate.
  const [resetCounter, setResetCounter] = useState(0);

  // Mount: attach (or create) a pooled terminal session, move its
  // host DOM into our container. Unmount: ONLY detach the host —
  // never destroy the session. The PTY + xterm live in the pool
  // across React unmount/remount cycles, which is what protects a
  // running CLI (Codex, Claude Code, long shell job) from getting
  // killed when the surrounding pane tree restructures (e.g. a
  // sibling closing, collapsing the split). The pool's
  // `destroyTerminalSession` is called only on explicit close
  // (store.closePane) or on Reset.
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || !cwd || !preset) return;

    // If a pooled session exists for a DIFFERENT preset/cwd, it's
    // stale (user dropped a different CLI on this pane, or the
    // project changed). Tear it down before recreating.
    const existing = getTerminalSession(id);
    if (
      existing &&
      (existing.presetId !== preset.id || existing.cwd !== cwd)
    ) {
      void destroyTerminalSession(id);
    }

    let cancelled = false;
    const noteTerminalOutput = useStore.getState().noteTerminalOutput;

    const pooled = getTerminalSession(id);
    if (pooled && pooled.presetId === preset.id && pooled.cwd === cwd) {
      // Reuse — no PTY spawn, no listener churn. Just reattach the
      // host DOM into our container and refit.
      attachTerminalSession(id, container);
      setPanePtyId(id, pooled.ptyId);
    } else {
      void createTerminalSession({
        paneId: id,
        cwd,
        presetId: preset.id,
        // Empty command = plain shell (the 'Terminal' preset).
        // Anything else gets typed into the shell after rc files
        // load, so users keep a working shell behind the CLI.
        command: preset.command,
        onOutput: (data) => noteTerminalOutput(data),
      })
        .then((session) => {
          if (cancelled) {
            // Component unmounted before spawn completed. Tear down
            // the orphan immediately rather than leaving a runaway
            // PTY in the pool.
            void destroyTerminalSession(id);
            return;
          }
          attachTerminalSession(id, container);
          setPanePtyId(id, session.ptyId);
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
        });
    }

    return () => {
      cancelled = true;
      // Move the host out of our container (back to body, hidden) so
      // React can safely unmount the component tree without yanking
      // xterm's DOM. The session itself stays alive.
      detachTerminalSession(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, cwd, preset?.id, resetCounter]);

  /**
   * Reset action — kill the current PTY + xterm and spawn fresh.
   * Bumping `resetCounter` re-runs the spawn effect, whose cleanup
   * tears down the old shell first. We confirm because Reset
   * irrecoverably loses the in-pane scrollback and any half-typed
   * input, which feels like enough to warrant a check.
   */
  const reset = useCallback(() => {
    const ok = confirm(
      `Restart this ${preset?.name ?? 'terminal'} pane? The current shell will be killed and a fresh one started in the project folder.`,
    );
    if (!ok) return;
    setError(undefined);
    // Tear down the pooled session imperatively. The layout effect
    // (depending on resetCounter) will then create a fresh one.
    void destroyTerminalSession(id);
    setResetCounter((n) => n + 1);
  }, [preset?.name, id]);

  // Refit on container resize. Pane resize comes from the
  // react-resizable-panels splitter, which doesn't fire window
  // resize. ResizeObserver on the host is the right tool. The
  // pooled session's `fit` addon is what we drive — it walks
  // xterm's DOM (which is already attached to our container) and
  // sizes columns/rows.
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const refit = () => {
      const s = getTerminalSession(id);
      if (!s) return;
      try {
        s.fit.fit();
      } catch {
        // host may be hidden during transitions
      }
    };
    const ro = new ResizeObserver(() => refit());
    ro.observe(host);
    // Also listen to window resize to catch font-size changes / DPI shifts.
    window.addEventListener('resize', refit);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', refit);
    };
  }, [id]);

  // Focus xterm when the pane becomes active so keystrokes flow into
  // the shell without an extra click. We refocus on every active
  // transition because layout templates / layout shuffles can leave
  // focus on a button rather than the terminal body.
  useEffect(() => {
    if (!isActive) return;
    requestAnimationFrame(() => {
      try {
        getTerminalSession(id)?.term.focus();
      } catch {
        // ignore
      }
    });
  }, [isActive, id]);

  if (!pane) {
    return <div className="pane empty">No pane.</div>;
  }

  return (
    <div
      className={'pane terminal-pane' + (isActive ? ' active' : '')}
      onMouseDown={() => setActivePane(id)}
    >
      <div
        className={
          'pane-header pane-header-terminal' +
          (isActive ? ' pane-header-active' : '')
        }
      >
        <div className="pane-emoji terminal-pane-icon" aria-hidden>
          {preset && <WorkerPresetIcon icon={preset.id} />}
        </div>
        <div className="pane-titles">
          <div className="pane-title-row">
            <span
              className="pane-title terminal-pane-title"
              title={headerTitle}
            >
              {headerTitle}
            </span>
          </div>
          <div className="pane-subtitle">
            <span className="pane-agent-name terminal-pane-cmd">
              {preset?.command ? `$ ${preset.command}` : '$ shell'}
            </span>
          </div>
        </div>
        <div className="pane-actions">
          <TerminalPaneMenu
            onReset={reset}
            onClose={() => {
              const ok = confirm(
                'Close this terminal pane? The shell will be killed.',
              );
              if (ok) void closePane(id);
            }}
          />
        </div>
      </div>
      {error && <div className="terminal-pane-error">{error}</div>}
      <div className="terminal-pane-host" ref={containerRef} />
    </div>
  );
}

/**
 * Compact ⋮ menu for terminal panes — Reset (kill + respawn the
 * shell with the same preset) and Close. Uses the same visual shape
 * as agent panes' more-menu so the two pane kinds feel consistent.
 *
 * Click-outside dismisses; Esc closes; menu items are real <button>s
 * for accessibility.
 */
function TerminalPaneMenu({
  onReset,
  onClose,
}: {
  onReset: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const onMouse = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onMouse);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onMouse);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="pane-more" ref={wrapRef}>
      <button
        type="button"
        className="pane-icon-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <svg
          width={14}
          height={14}
          viewBox="0 0 24 24"
          fill="currentColor"
          aria-hidden
        >
          <circle cx="12" cy="5" r="1.6" />
          <circle cx="12" cy="12" r="1.6" />
          <circle cx="12" cy="19" r="1.6" />
        </svg>
      </button>
      {open && (
        <div className="pane-more-menu" role="menu">
          <button
            type="button"
            role="menuitem"
            className="pane-more-item"
            onClick={() => {
              setOpen(false);
              onReset();
            }}
          >
            <span className="pane-more-icon" aria-hidden>
              <svg
                width={13}
                height={13}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.75}
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
                <path d="M21 3v5h-5" />
                <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
                <path d="M3 21v-5h5" />
              </svg>
            </span>
            Reset shell
          </button>
          <button
            type="button"
            role="menuitem"
            className="pane-more-item danger"
            onClick={() => {
              setOpen(false);
              onClose();
            }}
          >
            <span className="pane-more-icon" aria-hidden>
              <CloseIcon size={13} />
            </span>
            Close pane
          </button>
        </div>
      )}
    </div>
  );
}
