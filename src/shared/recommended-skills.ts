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
/**
 * How a recommended skill gets onto the user's disk.
 *
 *  - `'git'` (default): shallow git clone of `repoUrl`, copy
 *    `subPath` (or the whole repo) into ~/.claude/skills/<installAs>/.
 *    Optionally generate a SKILL.md wrapper via `generateSkillMd`
 *    when the source doesn't ship one.
 *  - `'printing-press'`: invoke
 *    `npx -y @mvanhorn/printing-press install <printingPressName>`.
 *    The Press CLI itself handles the install: it drops the Go
 *    binary on PATH and writes a SKILL.md into ~/.claude/skills/
 *    pp-<name>/. No git clone, no manual file shuffling on our end.
 */
export type RecommendedSkillInstallMethod = 'git' | 'printing-press';

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
  /** SPDX licence identifier (e.g. "MIT", "Apache-2.0"). Shown in
   *  the card so users know what they're installing. */
  license: string;
  /** Author / maintainer string for credit (org or individual). */
  author: string;
  /** Optional tags for future filtering. Not surfaced yet. */
  tags?: string[];
  /** How to install. Defaults to `'git'` for backwards compat with
   *  pre-v1.12.2 entries that didn't have this field. */
  via?: RecommendedSkillInstallMethod;
  /** URL shown next to the card as "View source". Falls back to
   *  `repoUrl` for git entries. For printing-press entries this
   *  should point at the library entry (e.g. github.com/mvanhorn/
   *  printing-press-library/tree/main/library/.../<name>). */
  sourceUrl?: string;

  // -- Git-clone fields (via === 'git') --------------------------------
  /** GitHub repo URL — cloned at install time. Required for `'git'`. */
  repoUrl?: string;
  /** Branch to clone. Defaults to 'main' when omitted. */
  branch?: string;
  /** Optional subdirectory inside the repo where the actual skill
   *  lives. When set, only that subtree is copied into the target
   *  skill folder. Leave undefined if the whole repo IS the skill. */
  subPath?: string;
  /** Folder name created under `~/.claude/skills/`. Defaults to `id`
   *  when omitted. */
  installAs?: string;
  /**
   * Some repos ship raw resources (DESIGN.md collections, template
   * libraries, etc.) rather than pre-packaged Claude skills with
   * frontmatter. For those, INZONE generates a thin SKILL.md
   * wrapper at the install target's root explaining how agents
   * should navigate the bundled resources.
   *
   * Set this when the source doesn't already have a SKILL.md.
   * Falls back to deriving name + description from the card's
   * fields if individual properties are omitted.
   */
  generateSkillMd?: {
    /** Frontmatter `name:`. Falls back to `installAs` / `id`. */
    name?: string;
    /** Frontmatter `description:`. Falls back to the card's
     *  `description`. This is what other agents see when deciding
     *  whether to invoke the skill, so make it action-oriented. */
    description?: string;
    /** SKILL.md body content (after the frontmatter). Should tell
     *  agents how to use the resources in the folder. */
    body: string;
  };

  // -- Printing-Press fields (via === 'printing-press') ----------------
  /** The Printing Press library entry name to pass to
   *  `printing-press install <name>`. The Press CLI handles the
   *  install (Go binary + SKILL.md) — we just shell out.
   *  Required for `'printing-press'`. */
  printingPressName?: string;
}

/**
 * URL prefix for the Printing Press library repo, used to construct
 * "View source" links for each library-entry recommended skill.
 * Each entry is at `<prefix>/library/<category>/<name>/`.
 */
const PP_LIB_URL = 'https://github.com/mvanhorn/printing-press-library/tree/main/library';

export const RECOMMENDED_SKILLS: RecommendedSkill[] = [
  // --- Printing Press library entries -------------------------------
  // Each becomes a one-click install of an agent-native CLI + the
  // matching Claude skill, via `printing-press install <name>`.
  // We seed with six high-signal entries covering different
  // categories (productivity, dev tools, payments, design, news,
  // commerce); the rest of the 60+-entry library stays accessible
  // via the Press CLI directly for power users.
  {
    id: 'pp-slack',
    name: 'Slack',
    emoji: '💬',
    description:
      'Send messages, search conversations, monitor channels, and manage your Slack workspace from the terminal. Your agents can post status updates, summarise threads, and ping teammates as part of a workflow.',
    via: 'printing-press',
    printingPressName: 'slack',
    sourceUrl: `${PP_LIB_URL}/productivity/slack`,
    license: 'MIT',
    author: 'Matt Van Horn · Printing Press',
    tags: ['messaging', 'productivity'],
  },
  {
    id: 'pp-linear',
    name: 'Linear',
    emoji: '📋',
    description:
      "Every Linear feature plus a local SQLite mirror — query 'blocked issues whose blocker hasn't moved in 7 days' in 50ms, work offline, and surface compound questions Linear's own API can't answer.",
    via: 'printing-press',
    printingPressName: 'linear',
    sourceUrl: `${PP_LIB_URL}/productivity/linear`,
    license: 'MIT',
    author: 'Matt Van Horn · Printing Press',
    tags: ['project-management', 'dev-tools'],
  },
  {
    id: 'pp-stripe',
    name: 'Stripe',
    emoji: '💳',
    description:
      'Every Stripe feature plus a local SQLite mirror with full-text search, cross-entity SQL, and analytics no other Stripe tool ships. Your agents can debug failed charges, reconcile customers, and pull cohort revenue without round-tripping the API.',
    via: 'printing-press',
    printingPressName: 'stripe',
    sourceUrl: `${PP_LIB_URL}/payments/stripe`,
    license: 'MIT',
    author: 'Chris Rodriguez · Printing Press',
    tags: ['payments', 'analytics'],
  },
  {
    id: 'pp-notion',
    name: 'Notion',
    emoji: '📓',
    description:
      'Every Notion database queryable offline — cross-workspace SQL joins, stale-page detection, relation graph traversal, and a local mirror so agents can answer "what changed in the engineering wiki this week" without hitting the rate limit.',
    via: 'printing-press',
    printingPressName: 'notion',
    sourceUrl: `${PP_LIB_URL}/productivity/notion`,
    license: 'MIT',
    author: 'Nikica Jokic · Printing Press',
    tags: ['knowledge-base', 'productivity'],
  },
  {
    id: 'pp-hackernews',
    name: 'Hacker News',
    emoji: '📰',
    description:
      'Hacker News from your terminal — with a local SQLite store, snapshot history, and agent-native output no other HN tool has. Track a topic over time, surface trending domains, or have an agent draft your morning skim.',
    via: 'printing-press',
    printingPressName: 'hackernews',
    sourceUrl: `${PP_LIB_URL}/media-and-entertainment/hackernews`,
    license: 'MIT',
    author: 'Trevin Chow · Printing Press',
    tags: ['news', 'research'],
  },
  {
    id: 'pp-shopify',
    name: 'Shopify',
    emoji: '🛒',
    description:
      'Operate a Shopify store from the terminal with curated Admin GraphQL commands, a local sync, analytics queries, and bulk exports. For solo founders running storefronts where agent-driven ops actually saves real time.',
    via: 'printing-press',
    printingPressName: 'shopify',
    sourceUrl: `${PP_LIB_URL}/commerce/shopify`,
    license: 'MIT',
    author: 'Cathryn Lavery · Printing Press',
    tags: ['commerce', 'solo-founder'],
  },

  // --- Git-clone entries --------------------------------------------
  {
    id: 'awesome-design',
    name: 'Awesome Design',
    emoji: '🎨',
    description:
      'Drop-in DESIGN.md collection reverse-engineered from 30+ developer-focused brand design systems (Stripe, Figma, Vercel, Apple, Linear, Claude, Cursor, and more). Lets your frontend agents scaffold pixel-accurate UIs by referencing real design tokens, typography, spacing, and component patterns.',
    repoUrl: 'https://github.com/VoltAgent/awesome-design-md',
    branch: 'main',
    // No subPath — install the whole repo so the MIT LICENSE +
    // README + CONTRIBUTING come along (legal hygiene + context).
    // The repo doesn't ship a SKILL.md, so we generate one below.
    installAs: 'awesome-design',
    license: 'MIT',
    author: 'VoltAgent',
    tags: ['frontend', 'design', 'ui'],
    generateSkillMd: {
      name: 'awesome-design',
      description:
        'Pixel-accurate UI in real brand styles — Stripe, Figma, Vercel, Apple, Linear, Cursor, Notion, and 25+ more. When the user names a brand or asks for UI in a specific site\'s style, read design-md/<brand>/DESIGN.md from this skill and follow the documented design tokens, typography, spacing, depth, and component patterns.',
      body: `## How to use this skill

This skill bundles **DESIGN.md** files extracted from 30+ real
websites. Each one is a complete design system document covering
visual theme, color palette, typography rules, component stylings,
layout principles, depth & elevation, do's/don'ts, responsive
behavior, and an agent prompt guide.

### When to read which file

When the user asks for UI in a specific brand's style, OR wants a
page that "looks like \\\<site\\\>":

1. Look in \`design-md/<brand>/\` — \`<brand>\` is the lowercase site
   name (e.g. \`design-md/stripe/\`, \`design-md/figma/\`,
   \`design-md/linear.app/\`).
2. Read \`DESIGN.md\` in that folder — it's the full design system.
3. Optionally check \`preview.html\` / \`preview-dark.html\` for
   rendered examples of the components and color application.
4. Apply the documented tokens and patterns to the UI you generate.

### Available brands

**AI & ML:** claude, cohere, minimax, mistral.ai, ollama,
opencode.ai, replicate, runwayml, together.ai, voltagent, x.ai

**Developer tools:** cursor, expo, linear.app, lovable, mintlify,
sentry, supabase, vercel, zapier

**Infrastructure:** clickhouse, composio, hashicorp, sanity, stripe

**Design & productivity:** figma, notion

**Enterprise & consumer:** apple, ibm, nvidia, uber

If the user names a brand not in this list, list \`design-md/\` to
confirm coverage before claiming it's missing — the upstream repo
may have added more.

### Don't

- Don't combine multiple brands' tokens into a single UI without
  the user asking — each DESIGN.md is internally consistent and
  mixing them looks incoherent.
- Don't paraphrase the design tokens from memory — read the actual
  DESIGN.md every time. Hex values, font weights, and spacing
  scales matter.

### Source

This skill is a copy of [VoltAgent/awesome-design-md](https://github.com/VoltAgent/awesome-design-md)
(MIT). See \`LICENSE\` in this folder for the full license text.
`,
    },
  },
];
