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
 * the canonical install path from each tool's docs at the time of
 * writing; users on different stacks can adapt. The plain Terminal
 * preset is always available, so it isn't listed here.
 */
export function installCommandFor(id: string): string | undefined {
  switch (id) {
    case 'aider':
      // Aider is distributed via PyPI — `aider-chat` is the package
      // name; it installs an `aider` binary on PATH.
      return 'pip install aider-chat';
    case 'claude-code':
      // Anthropic recommends Homebrew on macOS; their docs also
      // point to a curl installer for other platforms.
      return 'brew install anthropics/cli/claude';
    case 'codex':
      // OpenAI's Codex CLI is on npm.
      return 'npm install -g @openai/codex';
    case 'gemini':
      // Google's Gemini CLI is also on npm.
      return 'npm install -g @google/gemini-cli';
    default:
      return undefined;
  }
}
