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

  // -- Post-install setup -----------------------------------------------
  /**
   * Optional setup guide for skills whose CLI needs credentials (API
   * key, OAuth token, etc.) before it can be used. When set:
   *  - the card surfaces a small "Needs setup" chip so the user
   *    knows there's a step beyond Install;
   *  - the detail modal renders a "Setup instructions" section
   *    with the signup link, the expected env-var name(s), and a
   *    short step-by-step.
   *
   * Inzone doesn't manage the env var itself — agents read it from
   * the shell that spawned them. The instructions tell the user
   * where to put it (typically `~/.zshrc` / `~/.bashrc` so it
   * survives a relaunch).
   */
  setupGuide?: {
    /** Short label for the card chip (e.g. "Firecrawl API key"). */
    shortLabel: string;
    /** URL the user opens to get the credential. */
    signupUrl?: string;
    /** Env var name(s) the CLI looks for, e.g. "FIRECRAWL_API_KEY". */
    envVar?: string | string[];
    /** Free-form markdown body shown in the detail modal — should
     *  walk the user through obtaining + exporting the credential. */
    instructions: string;
  };
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

  // --- v1.13 additions ---------------------------------------------
  // Six more Printing Press entries spanning web scraping, registry
  // search, social-data scraping, crypto, design tools, and X/Twitter.
  // Two are zero-config (docker-hub, coingecko free tier); four need
  // an API key — each carries a `setupGuide` so the detail modal
  // walks the user through obtaining + exporting the credential.
  {
    id: 'pp-firecrawl',
    name: 'Firecrawl',
    emoji: '🕷️',
    description:
      'Web scraping + crawling for agents — render JavaScript-heavy pages, extract structured data, follow links, and pipe results to your Claude agent. Backed by the Firecrawl service; the CLI handles auth, pagination, and rate limits for you.',
    via: 'printing-press',
    printingPressName: 'firecrawl',
    sourceUrl: `${PP_LIB_URL}/developer-tools/firecrawl`,
    license: 'MIT',
    author: 'Hiten Shah · Printing Press',
    tags: ['scraping', 'web', 'data'],
    setupGuide: {
      shortLabel: 'Firecrawl API key',
      signupUrl: 'https://www.firecrawl.dev/',
      envVar: 'FIRECRAWL_API_KEY',
      instructions: [
        '**1.** Sign up at [firecrawl.dev](https://www.firecrawl.dev/) and create an API key from your dashboard. Firecrawl has a free tier suitable for small-scale scraping.',
        '',
        '**2.** Export the key in the shell that launches INZONE so agent Bash tool calls inherit it. Add this line to `~/.zshrc` (or your shell\'s rc file):',
        '',
        '```sh',
        'export FIRECRAWL_API_KEY="fc-xxxxxxxxxxxxxxxx"',
        '```',
        '',
        '**3.** Restart INZONE so the new environment is picked up by spawned agent processes. Verify by running `printenv FIRECRAWL_API_KEY` in any INZONE terminal pane.',
      ].join('\n'),
    },
  },
  {
    id: 'pp-docker-hub',
    name: 'Docker Hub',
    emoji: '🐳',
    description:
      'Search the world\'s largest container registry from the terminal — find images, browse tags, check sizes, inspect Dockerfiles. No authentication needed for public repositories (rate limited to ~18 requests/min).',
    via: 'printing-press',
    printingPressName: 'docker-hub',
    sourceUrl: `${PP_LIB_URL}/developer-tools/docker-hub`,
    license: 'MIT',
    author: 'Hiten Shah · Printing Press',
    tags: ['dev-tools', 'containers', 'registry'],
  },
  {
    id: 'pp-scrape-creators',
    name: 'Scrape Creators',
    emoji: '🎥',
    description:
      'Pull public social-media data from the terminal — profiles, posts, videos, comments, ads, and transcripts across TikTok, Instagram, YouTube, Twitter/X, LinkedIn, Facebook, Reddit, Threads, Bluesky, and 15+ creator services. One CLI, one credential, one schema.',
    via: 'printing-press',
    printingPressName: 'scrape-creators',
    sourceUrl: `${PP_LIB_URL}/developer-tools/scrape-creators`,
    license: 'MIT',
    author: 'Adrian Horning · Printing Press',
    tags: ['scraping', 'social', 'research'],
    setupGuide: {
      shortLabel: 'Scrape Creators API key',
      signupUrl: 'https://scrapecreators.com/',
      envVar: 'SCRAPE_CREATORS_API_KEY',
      instructions: [
        '**1.** Sign up at [scrapecreators.com](https://scrapecreators.com/) and copy your API key from the dashboard. Scrape Creators is a paid service with a free trial — pricing scales with request volume.',
        '',
        '**2.** Export the key in the shell that launches INZONE so spawned agent processes inherit it. Append to `~/.zshrc` (or your shell\'s rc file):',
        '',
        '```sh',
        'export SCRAPE_CREATORS_API_KEY="sc_xxxxxxxxxxxxxxxx"',
        '```',
        '',
        '**3.** Restart INZONE. Verify with `printenv SCRAPE_CREATORS_API_KEY` in an INZONE terminal pane.',
      ].join('\n'),
    },
  },
  {
    id: 'pp-coingecko',
    name: 'CoinGecko',
    emoji: '🦎',
    description:
      'Cryptocurrency prices, market caps, exchanges, and on-chain data from CoinGecko\'s free public API. No key required for the basic endpoints. Agents can quote prices, build watchlists, and answer "what is BTC doing this week" without round-tripping a flaky web search.',
    via: 'printing-press',
    printingPressName: 'coingecko',
    sourceUrl: `${PP_LIB_URL}/payments/coingecko`,
    license: 'MIT',
    author: 'Hiten Shah · Printing Press',
    tags: ['crypto', 'finance', 'free-api'],
  },
  {
    id: 'pp-figma',
    name: 'Figma',
    emoji: '🎨',
    description:
      'Every Figma endpoint plus codegen-ready frame extracts, comments audit, orphans finder, design-tokens diff, and webhook management. Your agents can pull a Figma frame, generate matching JSX, and verify it back against the live design.',
    via: 'printing-press',
    printingPressName: 'figma',
    sourceUrl: `${PP_LIB_URL}/productivity/figma`,
    license: 'MIT',
    author: 'Giuliano Giacaglia · Printing Press',
    tags: ['design', 'codegen', 'productivity'],
    setupGuide: {
      shortLabel: 'Figma personal access token',
      signupUrl: 'https://www.figma.com/developers/api#access-tokens',
      envVar: 'FIGMA_TOKEN',
      instructions: [
        '**1.** Open [Figma → Settings → Personal access tokens](https://www.figma.com/developers/api#access-tokens). Click "Create new token" and grant the scopes the CLI needs — at minimum **File content (read)** and **Comments (read/write)** for the full toolset.',
        '',
        '**2.** Copy the token (Figma only shows it once). Export it in the shell that launches INZONE by appending to `~/.zshrc` (or your shell\'s rc file):',
        '',
        '```sh',
        'export FIGMA_TOKEN="figd_xxxxxxxxxxxxxxxx"',
        '```',
        '',
        '**3.** Restart INZONE so the new environment lands in spawned agent processes. Verify with `printenv FIGMA_TOKEN` in any INZONE terminal pane.',
      ].join('\n'),
    },
  },
  {
    id: 'pp-x-twitter',
    name: 'X (Twitter)',
    emoji: '𝕏',
    description:
      'Read and write to X (Twitter) from the terminal — combined CLI fronting the v2 API + supporting services. Pull a user\'s recent posts, search by keyword, monitor mentions, or have an agent draft replies — with one shared credential and consistent output shape.',
    via: 'printing-press',
    printingPressName: 'x-twitter',
    sourceUrl: `${PP_LIB_URL}/social-and-messaging/x-twitter`,
    license: 'MIT',
    author: 'Cathryn Lavery · Printing Press',
    tags: ['social', 'messaging', 'api'],
    setupGuide: {
      shortLabel: 'X (Twitter) API bearer token',
      signupUrl: 'https://developer.x.com/en/portal/dashboard',
      envVar: 'X_BEARER_TOKEN',
      instructions: [
        '**1.** Go to the [X Developer Portal](https://developer.x.com/en/portal/dashboard) → create a project + app (free tier supports limited read endpoints; paid Basic/Pro tiers unlock the full surface). Generate a **Bearer Token** under your app\'s Keys & Tokens tab.',
        '',
        '**2.** Export the token in the shell that launches INZONE by appending to `~/.zshrc` (or your shell\'s rc file):',
        '',
        '```sh',
        'export X_BEARER_TOKEN="AAAAAAAAAAAAAAAAAAAAxxxxxxxxxxxxxxxxxxxxxxx"',
        '```',
        '',
        '**3.** Restart INZONE so spawned agent processes inherit the credential. Verify with `printenv X_BEARER_TOKEN` in an INZONE terminal pane.',
        '',
        '_Note: the X API\'s rate limits are tier-dependent and aggressive. If an agent reports 429s, you may need to upgrade to Basic ($100/month) for higher quotas._',
      ].join('\n'),
    },
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
