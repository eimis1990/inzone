/**
 * Curated list of MCP servers INZONE recommends to users.
 *
 * Two flavours covered in one list:
 *   - **Local stdio** entries that spawn an npm package via `npx`.
 *     Most are zero-config; a few need an API key or a path arg
 *     (carry a `setupGuide` for those). One-click install writes
 *     them to `~/.claude.json` and the server is usable immediately
 *     (provided any env vars are set in the user's shell).
 *   - **Remote SSE/HTTP** entries pointing at hosted MCP servers
 *     (Atlassian, Linear, Notion, etc.). One-click install writes
 *     the URL into `~/.claude.json` and kicks off the standard MCP
 *     OAuth handshake via `window.cowork.mcp.auth.start` so the
 *     user authenticates in a browser tab and gets back a token
 *     INZONE stores encrypted.
 *
 * Adding a new entry — checklist:
 *   1. Confirm the package / endpoint is still actively maintained.
 *   2. Pick a stable kebab-case `id` (also the default `installAs`
 *      name in `~/.claude.json`).
 *   3. For stdio: verify the npm package name + that `npx -y <pkg>`
 *      works without prior install.
 *   4. For sse/http: verify the URL is current; remote MCPs do move.
 *   5. If env vars or args need filling in, write a `setupGuide` so
 *      the detail modal walks the user through it.
 *
 * Surface order: stdio first (no auth step, lowest friction),
 * remote second. Renderer renders the list verbatim — no sorting.
 */

import type { RecommendedMcp } from './types';

export const RECOMMENDED_MCPS: RecommendedMcp[] = [
  // ── Local stdio servers — modelcontextprotocol/servers + community
  {
    id: 'filesystem',
    name: 'Filesystem',
    emoji: '📁',
    description:
      "Read, write, and search local files inside a folder you whitelist. The most-asked-for MCP — gives agents a sandboxed filesystem they can't escape from.",
    transport: 'stdio',
    installAs: 'filesystem',
    command: 'npx',
    args: [
      '-y',
      '@modelcontextprotocol/server-filesystem',
      '<folder to expose>',
    ],
    license: 'MIT',
    author: 'Model Context Protocol · Anthropic',
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/filesystem',
    tags: ['local', 'files'],
    setupGuide: {
      shortLabel: 'Pick a folder',
      instructions: [
        'The filesystem server needs at least one folder to expose. INZONE will open the entry in the editor with `<folder to expose>` pre-filled — replace it with an absolute path before saving.',
        '',
        'You can list multiple folders by repeating the path arg (each whitelisted folder becomes one root the agent can navigate). Common picks:',
        '',
        '- `~/Documents` — your working notes',
        '- The current project root — what you\'d type as `cwd` for a coding agent',
        '- `~/Downloads` — for ingest-from-disk workflows',
        '',
        'The server treats these as a hard sandbox — agents can\'t escape via `..` traversal.',
      ].join('\n'),
    },
  },
  {
    id: 'memory',
    name: 'Memory',
    emoji: '🧠',
    description:
      'Persistent knowledge graph the agent can read from and write to across turns. Lets agents remember entities, relations, and observations between sessions without re-fetching from chat history.',
    transport: 'stdio',
    installAs: 'memory',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-memory'],
    license: 'MIT',
    author: 'Model Context Protocol · Anthropic',
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/memory',
    tags: ['local', 'memory'],
  },
  {
    id: 'sequential-thinking',
    name: 'Sequential Thinking',
    emoji: '🪜',
    description:
      'Structured chain-of-thought scratchpad — the agent breaks a problem into numbered steps, revises earlier steps as it learns more, and the tool keeps the trail organised. Useful for planning-heavy tasks.',
    transport: 'stdio',
    installAs: 'sequential-thinking',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
    license: 'MIT',
    author: 'Model Context Protocol · Anthropic',
    sourceUrl:
      'https://github.com/modelcontextprotocol/servers/tree/main/src/sequentialthinking',
    tags: ['local', 'reasoning'],
  },
  {
    id: 'everything',
    name: 'Everything (demo)',
    emoji: '🧪',
    description:
      "Reference MCP server that implements every spec primitive — tools, resources, prompts, sampling, completions. Not for production use; install it to inspect what an MCP server can do and to demo Inzone's MCP wiring.",
    transport: 'stdio',
    installAs: 'everything',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-everything'],
    license: 'MIT',
    author: 'Model Context Protocol · Anthropic',
    sourceUrl:
      'https://github.com/modelcontextprotocol/servers/tree/main/src/everything',
    tags: ['local', 'demo', 'reference'],
  },
  {
    id: 'playwright',
    name: 'Playwright',
    emoji: '🎭',
    description:
      "Browser automation from Microsoft's Playwright team — navigate pages, click, type, take screenshots, fill forms, extract DOM. The actively-maintained successor to the now-deprecated Puppeteer MCP, with a stronger selector engine and headed/headless toggle.",
    transport: 'stdio',
    installAs: 'playwright',
    command: 'npx',
    args: ['-y', '@playwright/mcp@latest'],
    license: 'Apache-2.0',
    author: 'Microsoft · Playwright',
    sourceUrl: 'https://github.com/microsoft/playwright-mcp',
    tags: ['local', 'browser', 'scraping'],
  },
  {
    id: 'brave-search',
    name: 'Brave Search',
    emoji: '🦁',
    description:
      "Web search via Brave's independent index. Privacy-focused alternative to Google for agents that need to look things up — 2,000 free queries/month, paid tiers for more.",
    transport: 'stdio',
    installAs: 'brave-search',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-brave-search'],
    env: { BRAVE_API_KEY: '<your Brave Search API key>' },
    license: 'MIT',
    author: 'Brave · Model Context Protocol',
    sourceUrl:
      'https://github.com/modelcontextprotocol/servers/tree/main/src/brave-search',
    tags: ['local', 'search', 'web'],
    setupGuide: {
      shortLabel: 'Brave API key',
      signupUrl: 'https://api.search.brave.com/',
      envVar: 'BRAVE_API_KEY',
      instructions: [
        '**1.** Sign up at [api.search.brave.com](https://api.search.brave.com/) — free tier gives 2,000 queries/month, plenty for casual use. Generate an API key from the dashboard.',
        '',
        '**2.** Paste the key into the `BRAVE_API_KEY` env field when INZONE opens the editor. It gets stored in `~/.claude.json` under this server\'s `env` block and is read by the spawned process at runtime.',
        '',
        '**3.** Save the entry — Brave Search is immediately usable. Agents will see two tools: `brave_web_search` and `brave_local_search`.',
      ].join('\n'),
    },
  },
  {
    id: 'postgres',
    name: 'PostgreSQL',
    emoji: '🐘',
    description:
      'Read-only SQL queries against a Postgres database. Agents can inspect schemas, run analytics, and answer questions grounded in real data — without write access so they can\'t accidentally clobber prod.',
    transport: 'stdio',
    installAs: 'postgres',
    command: 'npx',
    args: [
      '-y',
      '@modelcontextprotocol/server-postgres',
      '<postgres connection string>',
    ],
    license: 'MIT',
    author: 'Model Context Protocol · Anthropic',
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/postgres',
    tags: ['local', 'database', 'sql'],
    setupGuide: {
      shortLabel: 'Postgres connection string',
      instructions: [
        'The server takes one positional argument: a Postgres connection string. INZONE opens the entry in the editor pre-filled with `<postgres connection string>` — replace it with your real URL before saving.',
        '',
        'Typical shape:',
        '',
        '```',
        'postgres://username:password@host:5432/database_name',
        '```',
        '',
        'For local development against a Docker Postgres:',
        '',
        '```',
        'postgres://postgres:postgres@localhost:5432/mydb',
        '```',
        '',
        'The server connects **read-only** — DDL or DML statements will be rejected. Safe to point at production if you trust the agent with the data.',
      ].join('\n'),
    },
  },
  {
    id: 'sqlite',
    name: 'SQLite',
    emoji: '🗄️',
    description:
      'Read-only queries against a local SQLite database file. Same idea as Postgres but for single-file SQLite stores — useful for analysing app databases, exports, or anything else with a `.db` extension.',
    transport: 'stdio',
    installAs: 'sqlite',
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sqlite', '<path to .db file>'],
    license: 'MIT',
    author: 'Model Context Protocol · community',
    sourceUrl: 'https://github.com/modelcontextprotocol/servers/tree/main/src/sqlite',
    tags: ['local', 'database', 'sql'],
    setupGuide: {
      shortLabel: 'Path to .db file',
      instructions: [
        'The server takes one positional argument: an absolute path to a `.db` file. Editor opens with `<path to .db file>` pre-filled — replace before saving.',
        '',
        'Example: `~/Documents/notes.db` (expanded to the absolute path).',
        '',
        'The server enforces read-only — agents can run SELECT but not UPDATE/INSERT/DELETE. Schema is discoverable through the server\'s tool list.',
      ].join('\n'),
    },
  },

  // ── Remote SSE / streamable-HTTP — Anthropic-vetted OAuth connectors
  // Each writes the URL into `~/.claude.json` and triggers the standard
  // MCP OAuth flow on install. INZONE caches tokens encrypted under the
  // canonical resource URL so subsequent agent sessions sign requests
  // automatically.
  {
    id: 'atlassian',
    name: 'Atlassian (Jira + Confluence)',
    emoji: '🟦',
    description:
      "Hosted MCP for Jira issue search, transitions, comments, and Confluence page reads. Same backing service Claude.ai's Atlassian Connector uses; OAuth via your Atlassian account on install.",
    transport: 'sse',
    installAs: 'atlassian',
    url: 'https://mcp.atlassian.com/v1/sse',
    license: 'Proprietary',
    author: 'Atlassian',
    sourceUrl: 'https://www.atlassian.com/blog/announcements/remote-mcp-server',
    tags: ['remote', 'oauth', 'productivity', 'project-management'],
  },
  {
    id: 'linear',
    name: 'Linear',
    emoji: '📐',
    description:
      "Hosted MCP from Linear themselves — issues, projects, cycles, comments, status updates. Read + write. OAuth via your Linear workspace on install; works against the same workspace your team already uses.",
    transport: 'sse',
    installAs: 'linear',
    url: 'https://mcp.linear.app/sse',
    license: 'Proprietary',
    author: 'Linear',
    sourceUrl: 'https://linear.app/changelog/2025-mcp',
    tags: ['remote', 'oauth', 'project-management'],
  },
  {
    id: 'asana',
    name: 'Asana',
    emoji: '🪐',
    description:
      "Hosted MCP for Asana — search tasks, update statuses, post comments, navigate projects. OAuth via your Asana account on install.",
    transport: 'sse',
    installAs: 'asana',
    url: 'https://mcp.asana.com/sse',
    license: 'Proprietary',
    author: 'Asana',
    sourceUrl: 'https://developers.asana.com/docs/mcp-server',
    tags: ['remote', 'oauth', 'project-management'],
  },
  {
    id: 'notion',
    name: 'Notion',
    emoji: '📓',
    description:
      "Hosted MCP from Notion — search pages and databases, read content, update properties. OAuth on install grants access to whichever Notion workspaces you authorize.",
    transport: 'http',
    installAs: 'notion',
    url: 'https://mcp.notion.com/mcp',
    license: 'Proprietary',
    author: 'Notion',
    sourceUrl: 'https://developers.notion.com/docs/mcp',
    tags: ['remote', 'oauth', 'knowledge-base'],
  },
  {
    id: 'stripe',
    name: 'Stripe',
    emoji: '💳',
    description:
      "Hosted MCP from Stripe — customer / charge / subscription / refund queries against your live Stripe account, plus a curated set of write actions. OAuth on install scopes the connection to one Stripe account.",
    transport: 'sse',
    installAs: 'stripe',
    url: 'https://mcp.stripe.com/v1/sse',
    license: 'Proprietary',
    author: 'Stripe',
    sourceUrl: 'https://docs.stripe.com/mcp',
    tags: ['remote', 'oauth', 'payments'],
  },
];
