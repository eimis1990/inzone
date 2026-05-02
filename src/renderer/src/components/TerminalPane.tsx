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
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { PaneId } from '@shared/types';
import { findWorkerPreset } from '@shared/worker-presets';
import { useStore } from '../store';
import { CloseIcon } from './icons';
import { WorkerPresetIcon } from './worker-presets';

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
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const ptyIdRef = useRef<string | null>(null);
  const detachOutputRef = useRef<(() => void) | null>(null);
  const detachExitRef = useRef<(() => void) | null>(null);
  // Strict-mode guards: in dev React mounts → unmounts → mounts again
  // and we don't want the first mount's effect to spawn a PTY only
  // for the cleanup of the *second* mount to kill it. Track whether
  // we've actually spawned one for THIS mount.
  const spawnedRef = useRef(false);

  const [error, setError] = useState<string | undefined>();
  // Bumped by the Reset action to force the spawn effect to re-run
  // with a fresh PTY + xterm. Cleaner than yanking refs imperatively
  // and lets the cleanup function in the effect handle teardown
  // exactly as it does on unmount.
  const [resetCounter, setResetCounter] = useState(0);

  // Spawn + wire xterm on mount. We re-spawn whenever the preset id
  // changes (user dropped a different CLI on the pane) — that's
  // signalled via the dependency array so the effect re-runs.
  useLayoutEffect(() => {
    const host = containerRef.current;
    if (!host || !cwd || !preset) return;
    if (spawnedRef.current) return;
    spawnedRef.current = true;

    const term = new Terminal({
      fontFamily:
        'Menlo, Monaco, "SF Mono", "JetBrains Mono", Consolas, monospace',
      fontSize: 12.5,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: '#0c0e12',
        foreground: '#e6e8ee',
        cursor: '#e4d947',
        cursorAccent: '#0c0e12',
        selectionBackground: 'rgba(228, 217, 71, 0.28)',
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    try {
      fit.fit();
    } catch {
      // Host may not have measured yet; the resize observer below
      // will fit again once layout settles.
    }
    xtermRef.current = term;
    fitRef.current = fit;

    let cancelled = false;
    void window.cowork.terminal
      .spawn({
        cwd,
        cols: term.cols,
        rows: term.rows,
        // Empty command = plain shell (the 'Terminal' preset).
        // Anything else gets typed into the shell after rc files
        // load, so users keep a working shell behind the CLI.
        initialCommand: preset.command || undefined,
      })
      .then(({ id: ptyId }) => {
        if (cancelled) {
          // Component already unmounted before main responded; kill
          // the orphan immediately.
          void window.cowork.terminal.kill(ptyId);
          return;
        }
        ptyIdRef.current = ptyId;
        setPanePtyId(id, ptyId);

        // Pipe shell stdout → xterm. Tee through the localhost-URL
        // detector so `npm run dev` etc. populate the Preview button
        // even when no agent is active in the project.
        const noteTerminalOutput = useStore.getState().noteTerminalOutput;
        detachOutputRef.current = window.cowork.terminal.onOutput(
          (payload) => {
            if (payload.id !== ptyId) return;
            term.write(payload.data);
            noteTerminalOutput(payload.data);
          },
        );
        detachExitRef.current = window.cowork.terminal.onExit((payload) => {
          if (payload.id !== ptyId) return;
          term.write(
            `\r\n\x1b[2m[exit ${payload.exitCode}${
              payload.signal ? ` signal ${payload.signal}` : ''
            }]\x1b[0m\r\n`,
          );
        });
        // Pipe xterm keystrokes → shell stdin.
        term.onData((data) => {
          void window.cowork.terminal.input({ id: ptyId, data });
        });
        // Notify main when xterm resizes (font / window changes).
        term.onResize(({ cols, rows }) => {
          void window.cowork.terminal.resize({ id: ptyId, cols, rows });
        });
      })
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
      detachOutputRef.current?.();
      detachOutputRef.current = null;
      detachExitRef.current?.();
      detachExitRef.current = null;
      const ptyId = ptyIdRef.current;
      if (ptyId) {
        void window.cowork.terminal.kill(ptyId);
        ptyIdRef.current = null;
        setPanePtyId(id, null);
      }
      try {
        term.dispose();
      } catch {
        // ignore — DOM may already be torn down
      }
      xtermRef.current = null;
      fitRef.current = null;
      spawnedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, preset?.id, resetCounter]);

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
    setResetCounter((n) => n + 1);
  }, [preset?.name]);

  // Refit on container resize. Pane resize comes from the
  // react-resizable-panels splitter, which doesn't fire window
  // resize. ResizeObserver on the host is the right tool.
  useEffect(() => {
    const host = containerRef.current;
    if (!host) return;
    const refit = () => {
      try {
        fitRef.current?.fit();
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
  }, []);

  // Focus xterm when the pane becomes active so keystrokes flow into
  // the shell without an extra click. We refocus on every active
  // transition because layout templates / layout shuffles can leave
  // focus on a button rather than the terminal body.
  useEffect(() => {
    if (!isActive) return;
    requestAnimationFrame(() => {
      try {
        xtermRef.current?.focus();
      } catch {
        // ignore
      }
    });
  }, [isActive]);

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
