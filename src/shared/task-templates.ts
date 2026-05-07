import type { TaskTemplate } from './types';

/**
 * Built-in task templates surfaced in the Tasks modal.
 *
 * Each template is a one-click recipe: switch to the right mode,
 * (optionally) pick a Lead agent, and create one pane per entry in
 * `agents` with that agent pre-assigned. A template is only shown to
 * the user when every agent it references is present in their
 * library — so a fresh install with only the bundled starter agents
 * sees a smaller list than someone who's added specialised agents.
 *
 * Adding a new template:
 *   1. Pick a stable id (kebab-case).
 *   2. List the agent slugs in the order you want panes created.
 *   3. If lead mode, set `leadAgent` to the slug filling the Lead pane.
 *   4. Source is always 'builtin' here.
 *
 * Naming conventions follow the bundled-resources/agents/ slugs and
 * common community-built agent names users tend to install.
 */
export const BUILTIN_TASK_TEMPLATES: TaskTemplate[] = [
  {
    id: 'website-redesign',
    emoji: '🎨',
    name: 'Website Redesign',
    description:
      'Modernize a legacy site: extract spec → redesign UI → implement → review.',
    mode: 'lead',
    leadAgent: 'lead-users-agent',
    agents: [
      'website-data-extractor',
      'frontend-website-redesign',
      'frontend-developer',
      'code-reviewer',
    ],
    source: 'builtin',
  },
  {
    id: 'mobile-feature',
    emoji: '📱',
    name: 'Mobile Feature',
    description:
      'Ship a feature on iOS / Android with mobile design + code review in the loop.',
    mode: 'lead',
    leadAgent: 'lead-users-agent',
    agents: ['mobile-design', 'mobile-developer', 'mobile-code-reviewer'],
    source: 'builtin',
  },
  {
    id: 'greenfield',
    emoji: '🚀',
    name: 'Greenfield Project',
    description:
      'Start a new product: lead-coordinated frontend + backend + fullstack + review.',
    mode: 'lead',
    leadAgent: 'lead-users-agent',
    agents: [
      'frontend-developer',
      'backend-developer',
      'fullstack-developer',
      'code-reviewer',
    ],
    source: 'builtin',
  },
  {
    id: 'bug-fix',
    emoji: '🐛',
    name: 'Bug Fix',
    description:
      'Lead-coordinated bug fix with a fullstack dev and a reviewer.',
    mode: 'lead',
    leadAgent: 'lead-users-agent',
    agents: ['fullstack-developer', 'code-reviewer'],
    source: 'builtin',
  },
  {
    id: 'code-review',
    emoji: '🔍',
    name: 'Code Review',
    description:
      'Review a branch with a reviewer + a developer paired side-by-side.',
    mode: 'multi',
    agents: ['code-reviewer', 'fullstack-developer'],
    source: 'builtin',
  },
  {
    id: 'browser-automation',
    emoji: '🌐',
    name: 'Browser Automation',
    description:
      'Drive a real browser to scrape / log in / fill forms, with review.',
    mode: 'multi',
    agents: ['browser-agent', 'code-reviewer'],
    source: 'builtin',
  },
  {
    id: 'frontend-sprint',
    emoji: '🎯',
    name: 'Frontend Sprint',
    description: 'Frontend dev paired with a reviewer for fast iteration.',
    mode: 'multi',
    agents: ['frontend-developer', 'code-reviewer'],
    source: 'builtin',
  },
  {
    id: 'backend-sprint',
    emoji: '🛠️',
    name: 'Backend Sprint',
    description: 'Backend dev paired with a reviewer for API/server work.',
    mode: 'multi',
    agents: ['backend-developer', 'code-reviewer'],
    source: 'builtin',
  },
  {
    id: 'solo-builder',
    emoji: '🦄',
    name: 'Solo Builder',
    description: 'Single-pane solo founder workflow — talk-it-out style.',
    mode: 'multi',
    agents: ['solo-founder'],
    source: 'builtin',
  },
];

/**
 * Compact, comparable signature of a window's pane setup. Used to
 * detect whether the current window matches an existing template
 * (built-in or custom) so we can either highlight the matching
 * template or surface a "save current setup" affordance when no
 * template matches.
 *
 * Format: `<mode>|[<leadAgent>?]|<sorted agent list>`
 *
 * - mode is `lead` or `multi`
 * - leadAgent is the Lead pane's agent name, or empty in multi mode
 *   (or when lead mode is on without a Lead agent assigned)
 * - agent list is alphabetically sorted so {A,B,C} matches {C,B,A}
 *
 * Sort is alphabetical to keep the comparison order-independent —
 * the user shouldn't have to recreate panes in the exact same order
 * to get a match.
 */
export function fingerprintTaskState(args: {
  mode: 'lead' | 'multi';
  leadAgent?: string;
  agents: string[];
}): string {
  const sorted = [...args.agents].filter((a) => a && a.trim()).sort();
  return `${args.mode}|${args.leadAgent ?? ''}|${sorted.join(',')}`;
}

/** Build a fingerprint for a TaskTemplate so it can be compared
 *  against `fingerprintTaskState`'s output. */
export function fingerprintTaskTemplate(t: TaskTemplate): string {
  return fingerprintTaskState({
    mode: t.mode,
    leadAgent: t.leadAgent,
    agents: t.agents,
  });
}
