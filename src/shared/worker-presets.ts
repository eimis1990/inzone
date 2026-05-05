/**
 * Worker preset definitions — shared between renderer and main.
 *
 * A "preset" is a non-agent thing the user can drop into a pane: a
 * plain terminal, or a CLI tool wrapped around the user's login
 * shell (claude code, codex, aider, gemini). Phase 2 spawns a PTY in
 * the project's cwd and types the preset's command into the shell —
 * so when the CLI exits, the user keeps a working shell behind it.
 *
 * The renderer renders the cards (with icons defined renderer-side
 * in `components/worker-presets.tsx`); the main process consults
 * this same table when spawning a per-pane PTY for a given presetId.
 */

export type WorkerPresetId =
  | 'aider'
  | 'claude-code'
  | 'codex'
  | 'gemini'
  | 'terminal';

export interface WorkerPreset {
  /** Stable id used in pane state. */
  id: WorkerPresetId;
  /** Display name shown on the card and pane header. */
  name: string;
  /** One-line blurb shown under the name on the card. */
  description: string;
  /**
   * Shell command executed inside the PTY after spawn. Empty string
   * means "no command — just the user's login shell". When non-empty,
   * we type the command into the shell so the user keeps a working
   * shell after the CLI exits.
   */
  command: string;
}

/**
 * Shadow of `NodeJS.Platform` for the renderer side, which doesn't
 * pull in `@types/node`. Using this alias instead of `NodeJS.Platform`
 * keeps the same string set without making the shared module require
 * a Node typings dependency. Update if Node ever adds new values
 * (rare).
 */
export type Platform =
  | 'aix'
  | 'android'
  | 'cygwin'
  | 'darwin'
  | 'freebsd'
  | 'haiku'
  | 'linux'
  | 'netbsd'
  | 'openbsd'
  | 'sunos'
  | 'win32';

export const WORKER_PRESETS: WorkerPreset[] = [
  // Descriptions are deliberately single-line. The card UI clips
  // overflow with ellipsis but the source string sets the tone —
  // keep them tight, no em-dashes, no double-clauses.
  {
    id: 'aider',
    name: 'Aider',
    description: 'AI pair programmer for your repo.',
    command: 'aider',
  },
  {
    id: 'claude-code',
    name: 'Claude Code',
    description: "Anthropic's coding CLI.",
    command: 'claude',
  },
  {
    id: 'codex',
    name: 'Codex CLI',
    description: "OpenAI's coding agent in the shell.",
    command: 'codex',
  },
  {
    id: 'gemini',
    name: 'Gemini CLI',
    description: "Google's Gemini in your terminal.",
    command: 'gemini',
  },
  {
    id: 'terminal',
    name: 'Terminal',
    description: 'Plain shell in the project folder.',
    command: '',
  },
];

/** Look up a preset by id. Returns undefined for unknown ids. */
export function findWorkerPreset(
  id: string | undefined,
): WorkerPreset | undefined {
  if (!id) return undefined;
  return WORKER_PRESETS.find((p) => p.id === id);
}

/**
 * Best-guess install command for each CLI preset, surfaced by the
 * Workers tab when the user clicks a not-installed preset. We pick
 * a command that works on the user's actual platform — brew is
 * mac-only, so suggesting `brew install …` on Windows or Linux just
 * makes the install fail confusingly. For Claude Code we ship the
 * npm path everywhere (it's an official cross-platform distribution
 * that also avoids requiring Homebrew on macOS, which not everyone
 * has). The plain Terminal preset is always available, so it isn't
 * listed here.
 *
 * `platform` is passed in by the caller (renderer reads it from
 * `window.cowork.system.platform()` or similar). Defaults to the
 * Unix command set since "best effort" is better than "no
 * suggestion" if the caller forgets.
 */
export function installCommandFor(
  id: string,
  // Currently every command we suggest is cross-platform, so we don't
  // branch on `platform` yet — but it's kept on the signature so the
  // call site (and future per-OS variants like apt / scoop / winget)
  // stay easy to add without changing the API. The `_` prefix tells
  // both TypeScript's `noUnusedParameters` and most lint configs that
  // the parameter is intentionally unused for now.
  _platform: Platform = 'linux',
): string | undefined {
  switch (id) {
    case 'aider':
      // Aider is distributed via PyPI — `aider-chat` is the package
      // name; it installs an `aider` binary on PATH. `pip` works on
      // every platform that has Python; for Python 3.x the binary is
      // sometimes `pip3` — we go with `pip` since most modern setups
      // alias it. (Users on `pip3`-only setups can adjust.)
      return 'pip install aider-chat';
    case 'claude-code':
      // Claude Code ships to npm as @anthropic-ai/claude-code and
      // works the same on macOS / Windows / Linux. We previously
      // recommended brew, which failed for Windows users entirely.
      return 'npm install -g @anthropic-ai/claude-code';
    case 'codex':
      // OpenAI's Codex CLI is on npm — npm works cross-platform.
      return 'npm install -g @openai/codex';
    case 'gemini':
      // Google's Gemini CLI is also on npm.
      return 'npm install -g @google/gemini-cli';
    default:
      return undefined;
  }
}
