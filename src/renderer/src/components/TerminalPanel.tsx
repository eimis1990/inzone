/**
 * Terminal panel pinned to the bottom of the pane host.
 *
 * Closed: a thin "Terminal" strip with an Open chevron — clicking it
 * (or the strip itself) lifts a panel up that hovers over the panes,
 * sized to ~40% of the host's height.
 *
 * Open: an `xterm.js` instance bound to a PTY spawned in the main
 * process (cwd = active session's folder). The PTY is created lazily
 * on first open and reused across open/close toggles for the lifetime
 * of the app.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TerminalShortcut } from '@shared/types';
import { useStore } from '../store';
import { CloseIcon } from './icons';

export function TerminalPanel() {
  const cwd = useStore((s) => s.cwd);
  const [open, setOpen] = useState(false);
  const [termId, setTermId] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [shortcuts, setShortcuts] = useState<TerminalShortcut[]>([]);
  // Stash for a queued command (e.g. an install command dispatched
  // from the Workers tab "Install" dialog). When the panel opens and
  // the PTY is ready, we type the command + Enter and clear the ref.
  // We use a ref instead of state so writing to it doesn't trigger a
  // re-render race against the spawn promise.
  const queuedCommandRef = useRef<string | null>(null);

  // Load shortcuts on mount + subscribe to live changes (Settings →
  // Terminal edits broadcast through main).
  useEffect(() => {
    void window.cowork.terminal.listShortcuts().then(setShortcuts).catch(() => {});
    return window.cowork.terminal.onShortcutsChanged(setShortcuts);
  }, []);

  /** Type the command into the active PTY and press Enter. */
  const runShortcut = useCallback(
    (s: TerminalShortcut) => {
      if (!termId) return;
      void window.cowork.terminal.input({
        id: termId,
        data: s.command + '\r',
      });
    },
    [termId],
  );

  const containerRef = useRef<HTMLDivElement | null>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const detachOutputRef = useRef<(() => void) | null>(null);
  const detachExitRef = useRef<(() => void) | null>(null);

  /** Tear xterm instance down completely. */
  const teardown = useCallback(() => {
    detachOutputRef.current?.();
    detachOutputRef.current = null;
    detachExitRef.current?.();
    detachExitRef.current = null;
    xtermRef.current?.dispose();
    xtermRef.current = null;
    fitRef.current = null;
  }, []);

  /** First-open: build xterm, spawn the PTY in main, wire IO. */
  const ensureSpawned = useCallback(async () => {
    if (xtermRef.current) return; // already alive
    const host = containerRef.current;
    if (!host) return;

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
    fit.fit();
    term.focus();
    xtermRef.current = term;
    fitRef.current = fit;

    const cols = term.cols;
    const rows = term.rows;
    try {
      // cwd is always set when this component renders (App.tsx gates on
      // it), but pass a safe fallback so main has something to spawn in.
      const { id } = await window.cowork.terminal.spawn({
        cwd: cwd ?? '/',
        cols,
        rows,
      });
      setTermId(id);

      // Pipe shell stdout → xterm. Also tee the chunk through the
      // localhost-URL detector so the Preview button picks up things
      // like `npx serve` / `pnpm dev` output even when no agent is
      // running. Detection is regex-only and very cheap; ANSI scrubbing
      // happens inside `noteTerminalOutput`.
      const noteTerminalOutput = useStore.getState().noteTerminalOutput;
      detachOutputRef.current = window.cowork.terminal.onOutput((payload) => {
        if (payload.id !== id) return;
        term.write(payload.data);
        noteTerminalOutput(payload.data);
      });
      detachExitRef.current = window.cowork.terminal.onExit((payload) => {
        if (payload.id !== id) return;
        term.write(
          `\r\n\x1b[2m[exit ${payload.exitCode}${payload.signal ? ` signal ${payload.signal}` : ''}]\x1b[0m\r\n`,
        );
      });
      // Pipe xterm keystrokes → shell stdin.
      term.onData((data) => {
        void window.cowork.terminal.input({ id, data });
      });
      // Notify main when xterm resizes (font / window changes).
      term.onResize(({ cols: c, rows: r }) => {
        void window.cowork.terminal.resize({ id, cols: c, rows: r });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      teardown();
    }
  }, [cwd, teardown]);

  // Lazy-mount xterm only after the panel actually opens. Tearing down
  // when closed isn't free (you'd lose terminal scrollback), so we keep
  // it alive but hidden.
  useLayoutEffect(() => {
    if (!open) return;
    void ensureSpawned();
  }, [open, ensureSpawned]);

  /**
   * Respawn the PTY when the session's working directory changes. This
   * is what makes the terminal "follow" session switches (and any
   * future folder-pick action). Without this, switching from session A
   * (cwd=/foo) to session B (cwd=/bar) would leave the prompt in /foo,
   * which is misleading and led to "I ran `pnpm dev` and it failed
   * because the terminal was in the wrong folder" bug reports.
   *
   * If the panel is closed when cwd changes we still kill the old
   * PTY and tear down xterm — the next time the user opens the panel
   * they should land in the *current* session's folder, not whatever
   * was active when they last had it open.
   */
  const prevCwdRef = useRef(cwd);
  useEffect(() => {
    if (prevCwdRef.current === cwd) return;
    prevCwdRef.current = cwd;
    if (termId) {
      void window.cowork.terminal.kill(termId);
      setTermId(null);
    }
    teardown();
    if (open) {
      // Yield a microtask so React commits the teardown before xterm
      // re-mounts in `ensureSpawned`. Without this the new Terminal()
      // instance can race the old one's DOM removal.
      queueMicrotask(() => {
        void ensureSpawned();
      });
    }
  }, [cwd, open, termId, teardown, ensureSpawned]);

  // Refit on panel open + on any window resize.
  useEffect(() => {
    if (!open) return;
    const onResize = () => {
      try {
        fitRef.current?.fit();
      } catch {
        // host might be hidden; safe to skip
      }
    };
    window.addEventListener('resize', onResize);
    // Run once after layout settles so the panel reaches its open height
    // before we measure cols/rows.
    const t = setTimeout(onResize, 50);
    return () => {
      window.removeEventListener('resize', onResize);
      clearTimeout(t);
    };
  }, [open]);

  // Make sure we kill the PTY when the user navigates away (closes the
  // window). Re-open after a kill spawns a fresh one.
  useEffect(() => {
    return () => {
      if (termId) {
        void window.cowork.terminal.kill(termId);
      }
      teardown();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Global ⌘T (or Ctrl+T) toggles the terminal panel open/closed. We
  // also accept Esc as an extra "close" affordance when it's open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 't') {
        e.preventDefault();
        setOpen((v) => !v);
        return;
      }
      if (open && e.key === 'Escape') {
        // Don't steal Esc from a focused xterm — only close if the
        // user isn't typing into the shell. We let xterm receive Esc
        // first; the panel stays open. Comment this out by leaving
        // the early-exit path noop.
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Cross-component "open the terminal and run this command" — used
  // by the Workers tab's Install dialog. A custom event is the
  // cleanest path here since the panel is mounted at App-level and
  // the dispatcher (sidebar card click) doesn't have a direct
  // reference to it. We stash the command in a ref so the spawn
  // useEffect below can flush it after termId is set.
  useEffect(() => {
    const handler = (e: Event) => {
      const cmd = (e as CustomEvent<string>).detail;
      if (typeof cmd !== 'string' || cmd.trim().length === 0) return;
      queuedCommandRef.current = cmd;
      setOpen(true);
      // If the PTY is already alive we can write immediately.
      // Otherwise the effect below picks the queue up after spawn.
      if (termId) {
        void window.cowork.terminal.input({
          id: termId,
          data: queuedCommandRef.current + '\r',
        });
        queuedCommandRef.current = null;
      }
    };
    window.addEventListener('inzone:terminal-run', handler);
    return () => window.removeEventListener('inzone:terminal-run', handler);
  }, [termId]);

  // When the PTY transitions from null → alive, flush any pending
  // command. Covers the "panel was closed, user clicked Install,
  // we opened the panel which lazy-spawns" path.
  useEffect(() => {
    if (!termId) return;
    const cmd = queuedCommandRef.current;
    if (!cmd) return;
    queuedCommandRef.current = null;
    // Tiny delay so the freshly-spawned shell has its prompt ready
    // before our input lands; matches the rc-warmup window we use
    // for terminal-pane preset commands.
    const t = setTimeout(() => {
      void window.cowork.terminal.input({ id: termId, data: cmd + '\r' });
    }, 250);
    return () => clearTimeout(t);
  }, [termId]);

  return (
    <div
      className={'terminal-dock' + (open ? ' open' : '')}
      aria-expanded={open}
    >
      {/* Scrim is always mounted so the open/close transitions both
          animate; CSS toggles its opacity off the dock's `.open` class. */}
      <div
        className="terminal-scrim"
        onClick={() => setOpen(false)}
        aria-hidden
      />

      {/* Overlay is also always mounted — keeps xterm attached to the
          same host div so we don't lose the shell or scrollback when
          the panel is closed. CSS slides it in/out via transform. */}
      <div className="terminal-overlay" aria-hidden={!open}>
        {error && <div className="terminal-error">{error}</div>}
        {shortcuts.length > 0 && (
          <div className="terminal-shortcuts">
            {shortcuts.map((s) => (
              <button
                key={s.id}
                type="button"
                className="terminal-shortcut-btn"
                onClick={() => runShortcut(s)}
                title={s.command}
                disabled={!termId}
              >
                {s.title}
              </button>
            ))}
          </div>
        )}
        <div ref={containerRef} className="terminal-host" />
      </div>

      <button
        type="button"
        className="terminal-bar"
        onClick={() => setOpen((v) => !v)}
        title={open ? 'Close terminal (it keeps running)' : 'Open terminal'}
      >
        {cwd && (
          <span className="terminal-cwd" title={cwd}>
            {shortCwd(cwd)}
          </span>
        )}
        <span className="terminal-bar-spacer" />
        <span className="terminal-bar-label">Terminal</span>
        <span className="terminal-bar-action">
          {open ? 'Close ▾' : 'Open ▴'}
        </span>
      </button>
    </div>
  );
}

function shortCwd(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  if (parts.length <= 3) return cwd;
  return '…/' + parts.slice(-2).join('/');
}
