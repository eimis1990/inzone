/**
 * PTY pool — wraps `node-pty-prebuilt-multiarch` so the renderer can
 * spin up a real shell (zsh / bash on macOS, falling back to whatever's
 * in $SHELL) and stream its stdout/stderr back. One PTY per terminal id.
 *
 * The renderer treats the terminal as a single global panel — it spawns
 * a PTY on first open, reuses the same id while INZONE stays running,
 * and closing the panel just hides the UI; the PTY survives until the
 * window closes (or the user explicitly kills it).
 */

import { spawn, type IPty } from 'node-pty-prebuilt-multiarch';
import { nanoid } from 'nanoid';
import { BrowserWindow } from 'electron';
import { IPC } from '@shared/ipc-channels';

interface PtySession {
  id: string;
  pty: IPty;
  cwd: string;
  /** Renderer windowId to route output events back to. */
  rendererWebContentsId: number;
}

const sessions = new Map<string, PtySession>();

/**
 * Pick a sensible login shell. macOS defaults to zsh; fall back to bash;
 * use `$SHELL` if the user has overridden it.
 */
function pickShell(): string {
  if (process.env.SHELL && process.env.SHELL.length > 0) {
    return process.env.SHELL;
  }
  if (process.platform === 'win32') return 'powershell.exe';
  return '/bin/zsh';
}

/** Default args: an interactive login shell so the user's rc files load. */
function pickShellArgs(): string[] {
  if (process.platform === 'win32') return [];
  return ['-l', '-i'];
}

export interface SpawnTerminalArgs {
  cwd: string;
  cols: number;
  rows: number;
  webContentsId: number;
  /**
   * Optional command to type into the shell once it's prompt-ready.
   * Used for CLI preset panes (Claude Code, Codex, Aider, Gemini) so
   * the PTY launches straight into the chosen tool while keeping a
   * real shell underneath — when the CLI exits, the user is back at
   * their normal prompt instead of having the pane die. Empty string
   * or undefined means "plain shell, no command".
   */
  initialCommand?: string;
}

export function spawnTerminal(args: SpawnTerminalArgs): {
  id: string;
} {
  const id = nanoid(10);
  const shell = pickShell();
  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  };
  const pty = spawn(shell, pickShellArgs(), {
    name: 'xterm-256color',
    cols: Math.max(20, Math.floor(args.cols)),
    rows: Math.max(5, Math.floor(args.rows)),
    cwd: args.cwd,
    env,
  });

  const session: PtySession = {
    id,
    pty,
    cwd: args.cwd,
    rendererWebContentsId: args.webContentsId,
  };
  sessions.set(id, session);

  // Forward every byte the shell prints back to the renderer that asked
  // for it. The data event fires whenever the shell writes to its PTY.
  pty.onData((data) => {
    const win = BrowserWindow.fromId(args.webContentsId);
    if (!win || win.isDestroyed()) return;
    win.webContents.send(IPC.TERM_OUTPUT, { id, data });
  });

  pty.onExit(({ exitCode, signal }) => {
    const win = BrowserWindow.fromId(args.webContentsId);
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC.TERM_EXIT, { id, exitCode, signal });
    }
    sessions.delete(id);
  });

  // After the shell prompt has had time to initialise, type the
  // initial command. We delay slightly because writing into the PTY
  // before zsh/bash finishes sourcing rc files results in the
  // command being interpreted by something that isn't fully set up
  // — visible as "command not found" for tools that depend on PATH
  // tweaks made by .zshrc / .bashrc. 250ms is empirically enough for
  // most rc files; users with very heavy shells can re-run the
  // command via the pane header (Phase 3).
  const cmd = args.initialCommand?.trim();
  if (cmd) {
    setTimeout(() => {
      const s = sessions.get(id);
      if (!s) return;
      try {
        s.pty.write(cmd + '\r');
      } catch {
        // PTY may have died during the warm-up window.
      }
    }, 250);
  }

  return { id };
}

export function writeTerminal(id: string, data: string): void {
  const s = sessions.get(id);
  if (!s) return;
  s.pty.write(data);
}

export function resizeTerminal(id: string, cols: number, rows: number): void {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.pty.resize(Math.max(20, Math.floor(cols)), Math.max(5, Math.floor(rows)));
  } catch {
    // PTY may have been killed since the renderer last sent a resize.
  }
}

export function killTerminal(id: string): void {
  const s = sessions.get(id);
  if (!s) return;
  try {
    s.pty.kill();
  } catch {
    // already dead
  }
  sessions.delete(id);
}

/** Best-effort cleanup on app quit so we don't leave zombie shells. */
export function killAllTerminals(): void {
  for (const id of [...sessions.keys()]) killTerminal(id);
}
