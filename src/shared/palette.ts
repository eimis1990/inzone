/**
 * Agent color palette. Each entry has:
 *  - `name`: persisted in frontmatter (e.g. `color: sky`)
 *  - `pale`: translucent tint for backgrounds on a dark UI
 *  - `vivid`: saturated hex used for text / accents
 *
 * The tints are low-opacity so they read as "pale" on top of the dark
 * theme without overwhelming the rest of the UI.
 */
export interface AgentColor {
  name: string;
  label: string;
  pale: string;
  vivid: string;
}

/**
 * 19 clearly-distinguishable hues. `pale` is saturated enough at
 * 30% alpha to read as a real colour wash on the dark UI (previous 20%
 * washed out into grey). `vivid` is the companion accent for borders,
 * text, and chips. Names are persisted in frontmatter so don't rename
 * them — only add or extend.
 */
export const AGENT_COLORS: AgentColor[] = [
  // Original twelve.
  { name: 'sky',     label: 'Sky',     pale: 'rgba(92, 168, 255, 0.32)',  vivid: '#5ca8ff' },
  { name: 'mint',    label: 'Mint',    pale: 'rgba(61, 220, 151, 0.32)',  vivid: '#3ddc97' },
  { name: 'rose',    label: 'Rose',    pale: 'rgba(255, 107, 136, 0.32)', vivid: '#ff6b88' },
  { name: 'amber',   label: 'Amber',   pale: 'rgba(255, 181, 71, 0.32)',  vivid: '#ffb547' },
  { name: 'lilac',   label: 'Lilac',   pale: 'rgba(178, 138, 255, 0.32)', vivid: '#b28aff' },
  { name: 'peach',   label: 'Peach',   pale: 'rgba(255, 153, 102, 0.32)', vivid: '#ff9966' },
  { name: 'seafoam', label: 'Seafoam', pale: 'rgba(74, 217, 197, 0.32)',  vivid: '#4ad9c5' },
  { name: 'butter',  label: 'Butter',  pale: 'rgba(242, 215, 78, 0.32)',  vivid: '#f2d74e' },
  { name: 'blush',   label: 'Blush',   pale: 'rgba(255, 143, 204, 0.32)', vivid: '#ff8fcc' },
  { name: 'moss',    label: 'Moss',    pale: 'rgba(178, 198, 92, 0.32)',  vivid: '#b2c65c' },
  { name: 'coral',   label: 'Coral',   pale: 'rgba(255, 122, 92, 0.32)',  vivid: '#ff7a5c' },
  { name: 'indigo',  label: 'Indigo',  pale: 'rgba(138, 138, 255, 0.32)', vivid: '#8a8aff' },
  // Added in v0.2 — wider palette for users who run lots of agents.
  { name: 'crimson', label: 'Crimson', pale: 'rgba(232, 76, 92, 0.32)',   vivid: '#e84c5c' },
  { name: 'plum',    label: 'Plum',    pale: 'rgba(186, 104, 200, 0.32)', vivid: '#ba68c8' },
  { name: 'teal',    label: 'Teal',    pale: 'rgba(64, 191, 196, 0.32)',  vivid: '#40bfc4' },
  { name: 'lime',    label: 'Lime',    pale: 'rgba(196, 232, 88, 0.32)',  vivid: '#c4e858' },
  { name: 'sand',    label: 'Sand',    pale: 'rgba(216, 188, 142, 0.32)', vivid: '#d8bc8e' },
  { name: 'aqua',    label: 'Aqua',    pale: 'rgba(95, 211, 250, 0.32)',  vivid: '#5fd3fa' },
  { name: 'slate',   label: 'Slate',   pale: 'rgba(141, 158, 178, 0.32)', vivid: '#8d9eb2' },
  // Added in v0.3 — extra options for users who keep many agents and
  // need more visually distinct colors.
  { name: 'violet',  label: 'Violet',  pale: 'rgba(167, 110, 230, 0.32)', vivid: '#a76ee6' },
  { name: 'forest',  label: 'Forest',  pale: 'rgba(102, 173, 110, 0.32)', vivid: '#66ad6e' },
  { name: 'sunset',  label: 'Sunset',  pale: 'rgba(255, 138, 99, 0.32)',  vivid: '#ff8a63' },
  { name: 'ice',     label: 'Ice',     pale: 'rgba(180, 222, 240, 0.32)', vivid: '#b4def0' },
  { name: 'magenta', label: 'Magenta', pale: 'rgba(220, 95, 195, 0.32)',  vivid: '#dc5fc3' },
];

export function getAgentColor(name?: string): AgentColor | undefined {
  if (!name) return undefined;
  return AGENT_COLORS.find((c) => c.name === name);
}

/** Canonical list of tools an agent can be restricted to. */
export const AGENT_TOOL_CHOICES = [
  'Bash',
  'Read',
  'Write',
  'Edit',
  'MultiEdit',
  'Glob',
  'Grep',
  'WebFetch',
  'WebSearch',
  'Task',
  'TodoWrite',
  'NotebookEdit',
] as const;
export type AgentToolChoice = (typeof AGENT_TOOL_CHOICES)[number];

/** Models surfaced in the editor dropdown. Users can pick a specific
 *  dated id or an alias that always tracks the latest. */
export const MODEL_CHOICES: { value: string; label: string }[] = [
  { value: '', label: 'Default (inherit)' },
  /* Specific dated/version IDs first, then aliases for "always latest". */
  { value: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
  { value: 'sonnet', label: 'Sonnet (alias — latest)' },
  { value: 'claude-opus-4-6', label: 'Opus 4.6' },
  { value: 'opus', label: 'Opus (alias — latest)' },
  { value: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
  { value: 'haiku', label: 'Haiku (alias — latest)' },
];
