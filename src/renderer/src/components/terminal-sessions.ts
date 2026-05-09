/**
 * Terminal-pane session pool.
 *
 * The xterm instance + main-process PTY for each terminal pane lives
 * here, in a module-level Map keyed by pane id, NOT inside the
 * TerminalPane component's React state. This is the only safe place
 * to put them: React can (and does) unmount + remount the
 * TerminalPane component when the surrounding tree restructures —
 * for example, closing a sibling pane in a 2-way split collapses the
 * `split` node to a `leaf`, which changes the React fiber chain and
 * triggers an unmount/remount on the surviving pane. If the PTY +
 * xterm lived inside the component, that "innocent" tree restructure
 * would kill the PTY, taking the running CLI (Codex / Claude Code /
 * a long-running shell) with it. The user reported losing 7 minutes
 * of Codex session this way; this pool is the fix.
 *
 * The component remains responsible for:
 *   - laying out the host element (positioning, resize observer)
 *   - calling `attachTerminalSession` on mount + `detachTerminalSession`
 *     on unmount (just moves the DOM, doesn't kill anything)
 *   - calling `getOrCreateTerminalSession` to spawn the first time
 *
 * The store is responsible for:
 *   - calling `destroyTerminalSession` from `closePane` when the user
 *     explicitly closes a terminal pane (kills PTY, disposes xterm,
 *     drops the entry)
 */

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';

export interface TerminalSessionInit {
  paneId: string;
  cwd: string;
  presetId: string;
  /** Empty string = plain shell. Anything else gets typed into the
   *  shell after spawn so the user keeps a working shell after the
   *  CLI exits. */
  command: string;
  /** Called with each chunk of PTY output so the renderer can mine
   *  it for localhost URLs (Preview button auto-detection). The
   *  session keeps this callback alive for the PTY's lifetime. */
  onOutput?: (data: string) => void;
}

export interface TerminalSession {
  /** Permanent DOM host owned by the session. We move it between
   *  the TerminalPane component's container ref and document.body
   *  (when detached). xterm holds an internal pointer to this
   *  element; keeping it stable is what lets the xterm renderer
   *  survive React remounts. */
  host: HTMLDivElement;
  term: Terminal;
  fit: FitAddon;
  ptyId: string;
  /** Tracked so we can decide whether to recreate when the user
   *  drops a different preset on the same pane. */
  presetId: string;
  cwd: string;
}

interface InternalSession extends TerminalSession {
  detachOutput: () => void;
  detachExit: () => void;
}

const sessions = new Map<string, InternalSession>();

/** Hidden parking spot for hosts that aren't currently attached to a
 *  TerminalPane component (e.g. between unmount + remount). Living
 *  in the body keeps xterm's renderer happy without showing the
 *  host visually. */
function getDetachedParent(): HTMLElement {
  // document.body is fine — xterm just needs SOME parent.
  return document.body;
}

/** Look up an existing session without creating one. Used to decide
 *  whether to call createTerminalSession or just reattach. */
export function getTerminalSession(paneId: string): TerminalSession | null {
  return sessions.get(paneId) ?? null;
}

/**
 * Move a session's host DOM into a new container element. Typically
 * called from `TerminalPane`'s mount effect after looking up an
 * existing session. Idempotent: if the host is already inside the
 * container it just refits.
 */
export function attachTerminalSession(
  paneId: string,
  container: HTMLElement,
): void {
  const session = sessions.get(paneId);
  if (!session) return;
  // Restore visibility — we hide on detach to keep an invisible
  // floating xterm from showing up if anyone styles the body.
  session.host.style.display = '';
  if (session.host.parentElement !== container) {
    container.appendChild(session.host);
  }
  // Refit to the new container size.
  try {
    session.fit.fit();
  } catch {
    // Container may not have measured yet (DOM still settling) —
    // the TerminalPane's resize observer will fit again once
    // layout finishes.
  }
}

/**
 * Move the host out of its current container BACK to document.body
 * (and hide it). Called from `TerminalPane`'s unmount cleanup so
 * React can tear down its component tree without yanking xterm's
 * DOM out from under it. The session itself stays in the pool — only
 * `destroyTerminalSession` actually tears it down.
 */
export function detachTerminalSession(paneId: string): void {
  const session = sessions.get(paneId);
  if (!session) return;
  const parking = getDetachedParent();
  if (session.host.parentElement !== parking) {
    parking.appendChild(session.host);
  }
  session.host.style.display = 'none';
}

/**
 * Create a brand-new session: build a host div, instantiate xterm,
 * spawn the PTY, wire up listeners. The `host` is appended to
 * document.body initially (hidden). The caller is expected to
 * follow with `attachTerminalSession` once the React container is
 * available.
 *
 * Returns the session, or null if PTY spawn fails (caller should
 * surface the error to the user).
 */
export async function createTerminalSession(
  init: TerminalSessionInit,
): Promise<TerminalSession> {
  // Defensive: if there's already a session for this id, return it
  // unchanged. Shouldn't happen if callers check first via
  // getTerminalSession, but a stale concurrent mount could race.
  const existing = sessions.get(init.paneId);
  if (existing) return existing;

  const host = document.createElement('div');
  host.className = 'terminal-pane-host';
  host.style.width = '100%';
  host.style.height = '100%';
  host.style.display = 'none';
  getDetachedParent().appendChild(host);

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
    },
    scrollback: 4000,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.open(host);

  // WebGL renderer — drastically smoother under heavy output
  // (build logs, `npm install`, test runners). xterm renders to a
  // GPU-backed canvas instead of the default DOM/canvas2d fallback.
  // Must be loaded AFTER `term.open()` because the addon needs the
  // host to be in the DOM to acquire a WebGL context. We catch
  // construction failures (rare — old Linux + headless GPUs) and
  // fall back silently to the default renderer; xterm continues to
  // work, it just isn't GPU-accelerated. If the GPU process crashes
  // mid-session we get a `webglcontextlost` event — also drop the
  // addon then so xterm reverts to canvas2d cleanly.
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      try {
        webgl.dispose();
      } catch {
        // already gone
      }
    });
    term.loadAddon(webgl);
  } catch {
    // No WebGL — xterm still works, it just falls back to canvas2d.
  }

  try {
    fit.fit();
  } catch {
    // Host might not have a measurable size yet (it's hidden in
    // document.body) — that's fine, the next attach + fit will
    // do the real sizing.
  }

  const { id: ptyId } = await window.cowork.terminal.spawn({
    cwd: init.cwd,
    cols: term.cols,
    rows: term.rows,
    initialCommand: init.command || undefined,
  });

  const detachOutput = window.cowork.terminal.onOutput((payload) => {
    if (payload.id !== ptyId) return;
    term.write(payload.data);
    init.onOutput?.(payload.data);
  });
  const detachExit = window.cowork.terminal.onExit((payload) => {
    if (payload.id !== ptyId) return;
    term.write(
      `\r\n\x1b[2m[exit ${payload.exitCode}${
        payload.signal ? ` signal ${payload.signal}` : ''
      }]\x1b[0m\r\n`,
    );
  });
  // Keystrokes → shell stdin.
  term.onData((data) => {
    void window.cowork.terminal.input({ id: ptyId, data });
  });
  // Resize from xterm → main (font / window changes).
  term.onResize(({ cols, rows }) => {
    void window.cowork.terminal.resize({ id: ptyId, cols, rows });
  });

  const session: InternalSession = {
    host,
    term,
    fit,
    ptyId,
    presetId: init.presetId,
    cwd: init.cwd,
    detachOutput,
    detachExit,
  };
  sessions.set(init.paneId, session);
  return session;
}

/**
 * Tear a session down for good. Called by:
 *   - the store's `closePane` action when the user clicks the pane's
 *     close button;
 *   - the TerminalPane's "Reset" action when the user explicitly
 *     wants a fresh shell;
 *   - whenever the user drops a different preset on the same pane
 *     (we recreate with the new command).
 */
export async function destroyTerminalSession(paneId: string): Promise<void> {
  const session = sessions.get(paneId);
  if (!session) return;
  sessions.delete(paneId);
  try {
    session.detachOutput();
  } catch {
    // ignore
  }
  try {
    session.detachExit();
  } catch {
    // ignore
  }
  try {
    session.term.dispose();
  } catch {
    // DOM may already be gone
  }
  try {
    session.host.remove();
  } catch {
    // ignore — already detached
  }
  try {
    await window.cowork.terminal.kill(session.ptyId);
  } catch {
    // PTY may already be dead — fine.
  }
}
