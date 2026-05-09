/**
 * Curated list of community-built skills INZONE recommends to users.
 *
 * Each entry describes a skill we've vetted enough to suggest, with
 * everything the install flow needs: repo URL, optional subdirectory
 * inside the repo, target install name, license, and credit. Users
 * see this list under Settings → Skills → Recommended; clicking
 * Install does a shallow git clone, copies the relevant subtree
 * into `~/.claude/skills/<installAs>/`, and the regular skill
 * watcher picks it up.
 *
 * Adding a new entry — quick checklist:
 *   1. Confirm the repo's licence permits redistribution / install.
 *   2. Pick a stable `id` (kebab-case) — used for state tracking.
 *   3. Set `installAs` to the folder name we want under
 *      `~/.claude/skills/`. Often equals `id`.
 *   4. If the SKILL.md lives in a subdirectory rather than at the
 *      repo root, set `subPath`.
 *
 * The Install action is idempotent at the filesystem level — we
 * skip the clone if `~/.claude/skills/<installAs>/SKILL.md` is
 * already present.
 */
export interface RecommendedSkill {
  /** Stable kebab-case identifier. Used for state tracking + as the
   *  fallback `installAs` folder name. */
  id: string;
  /** Display name for the card. */
  name: string;
  /** Single emoji shown in the card head. */
  emoji: string;
  /** One-paragraph description (~20–40 words). */
  description: string;
  /** GitHub repo URL — used both for cloning and for the "View
   *  source" link in the card. */
  repoUrl: string;
  /** Branch to clone. Defaults to 'main' when omitted. */
  branch?: string;
  /** Optional subdirectory inside the repo where the actual skill
   *  lives. When set, only that subtree is copied into the target
   *  skill folder. Leave undefined if the whole repo IS the skill. */
  subPath?: string;
  /** Folder name created under `~/.claude/skills/`. Defaults to `id`
   *  when omitted. */
  installAs?: string;
  /** SPDX licence identifier (e.g. "MIT", "Apache-2.0"). Shown in
   *  the card so users know what they're installing. */
  license: string;
  /** Author / maintainer string for credit (org or individual). */
  author: string;
  /** Optional tags for future filtering. Not surfaced yet. */
  tags?: string[];
}

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  {
    id: 'awesome-design',
    name: 'Awesome Design',
    emoji: '🎨',
    description:
      'Drop-in DESIGN.md collection reverse-engineered from 55+ developer-focused brand design systems (Stripe, Figma, Vercel, Apple, Cursor, and more). Lets your frontend agents scaffold pixel-accurate UIs by referencing real design tokens, typography, spacing, and component patterns.',
    repoUrl: 'https://github.com/VoltAgent/awesome-design-md',
    branch: 'main',
    subPath: 'design-md/claude',
    installAs: 'awesome-design',
    license: 'MIT',
    author: 'VoltAgent',
    tags: ['frontend', 'design', 'ui'],
  },
];
