/**
 * MCP server config loader/saver.
 *
 * Files we read & write, in the order Claude Code itself looks at them:
 *
 *   1. `~/.claude.json` — user scope. The CLI's main settings file. We
 *      preserve every other field on save and only touch `mcpServers`.
 *   2. `~/.claude/.mcp.json` — legacy/fallback user-scope file. We read
 *      it but only ever write to `~/.claude.json` so the CLI sees us.
 *   3. `<cwd>/.mcp.json` — project scope, sitting at the workspace root.
 *
 * On a key collision (same server name in both scopes), project wins,
 * matching how Claude Code resolves it.
 *
 * Each file's `mcpServers` is a map of `<name>` -> `McpServerConfig`.
 * The `type` field can be omitted in legacy files (older CLI versions
 * defaulted to stdio when `command` was present) — we infer it on read.
 */

import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';
import type {
  McpScope,
  McpServerConfig,
  McpServerDraft,
  McpServerEntry,
} from '@shared/types';

const USER_SETTINGS = path.join(homedir(), '.claude.json');
const USER_MCP_FALLBACK = path.join(homedir(), '.claude', '.mcp.json');

export function projectMcpPath(cwd: string): string {
  return path.join(cwd, '.mcp.json');
}

interface RawFile {
  mcpServers?: Record<string, RawServerConfig>;
  // anything else we don't touch on writes
  [k: string]: unknown;
}

interface RawServerConfig {
  type?: string;
  command?: string;
  args?: unknown;
  env?: unknown;
  url?: string;
  headers?: unknown;
  // anything else we preserve on writes verbatim
  [k: string]: unknown;
}

async function readJsonFile(filePath: string): Promise<RawFile | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    if (raw.trim().length === 0) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as RawFile;
    }
    return {};
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return null;
    console.warn(`[mcp-config] failed to read ${filePath}:`, err);
    return null;
  }
}

/**
 * Normalize a raw entry to our discriminated union.
 * - If `type` is missing and `command` is present, infer 'stdio'.
 * - If `type` is missing and `url` is present, infer 'http' (modern default
 *   for Streamable HTTP transport; users can switch to 'sse' if needed).
 */
function normalizeServer(raw: RawServerConfig): McpServerConfig | null {
  let type = (raw.type ?? '').toLowerCase().trim();
  if (!type) {
    if (typeof raw.command === 'string') type = 'stdio';
    else if (typeof raw.url === 'string') type = 'http';
    else return null;
  }
  if (type === 'stdio') {
    if (typeof raw.command !== 'string' || raw.command.trim().length === 0) {
      return null;
    }
    const args =
      Array.isArray(raw.args) &&
      raw.args.every((a): a is string => typeof a === 'string')
        ? raw.args
        : undefined;
    const env =
      raw.env && typeof raw.env === 'object' && !Array.isArray(raw.env)
        ? Object.fromEntries(
            Object.entries(raw.env as Record<string, unknown>).filter(
              (kv): kv is [string, string] => typeof kv[1] === 'string',
            ),
          )
        : undefined;
    return {
      type: 'stdio',
      command: raw.command,
      ...(args ? { args } : {}),
      ...(env && Object.keys(env).length > 0 ? { env } : {}),
    };
  }
  if (type === 'sse' || type === 'http') {
    if (typeof raw.url !== 'string' || raw.url.trim().length === 0) {
      return null;
    }
    const headers =
      raw.headers && typeof raw.headers === 'object' && !Array.isArray(raw.headers)
        ? Object.fromEntries(
            Object.entries(raw.headers as Record<string, unknown>).filter(
              (kv): kv is [string, string] => typeof kv[1] === 'string',
            ),
          )
        : undefined;
    return {
      type,
      url: raw.url,
      ...(headers && Object.keys(headers).length > 0 ? { headers } : {}),
    };
  }
  // Unknown transport — skip rather than crash the whole list.
  return null;
}

function entriesFromFile(
  raw: RawFile | null,
  scope: McpScope,
  filePath: string,
  projectPath?: string,
): McpServerEntry[] {
  if (!raw || !raw.mcpServers || typeof raw.mcpServers !== 'object') return [];
  const out: McpServerEntry[] = [];
  for (const [name, value] of Object.entries(raw.mcpServers)) {
    if (!value || typeof value !== 'object') continue;
    const cfg = normalizeServer(value as RawServerConfig);
    if (!cfg) continue;
    out.push({
      name,
      scope,
      filePath,
      config: cfg,
      ...(projectPath ? { projectPath } : {}),
    });
  }
  return out;
}

/** Read user-scope entries. Tries `~/.claude.json` first, then the legacy file. */
export async function readUserEntries(): Promise<McpServerEntry[]> {
  const primary = await readJsonFile(USER_SETTINGS);
  if (primary && primary.mcpServers) {
    return entriesFromFile(primary, 'user', USER_SETTINGS);
  }
  const legacy = await readJsonFile(USER_MCP_FALLBACK);
  return entriesFromFile(legacy, 'user', USER_MCP_FALLBACK);
}

export async function readProjectEntries(
  cwd: string | undefined,
): Promise<McpServerEntry[]> {
  if (!cwd) return [];
  const filePath = projectMcpPath(cwd);
  const raw = await readJsonFile(filePath);
  return entriesFromFile(raw, 'project', filePath);
}

/**
 * Claude Code stores per-project MCP servers under
 * `~/.claude.json` -> `projects.<cwd>.mcpServers` (its "local" scope —
 * NOT the same as `<cwd>/.mcp.json`, which is "project" scope). The CLI
 * shows them as "Local MCPs" in the `/mcp` panel. Surface them here as
 * `'project'` scope so users see them alongside `<cwd>/.mcp.json`.
 *
 * Best-effort: returns empty if the projects map or the cwd entry isn't
 * present. INZONE never writes to this section — edits land in
 * `<cwd>/.mcp.json` instead.
 */
export async function readClaudeProjectLocalEntries(
  cwd: string | undefined,
): Promise<McpServerEntry[]> {
  if (!cwd) return [];
  const raw = await readJsonFile(USER_SETTINGS);
  if (!raw) return [];
  const projects = raw.projects;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) {
    return [];
  }
  const projectsMap = projects as Record<string, unknown>;
  const entry = projectsMap[cwd];
  if (!entry || typeof entry !== 'object') return [];
  const wrapper = entry as RawFile;
  return entriesFromFile(wrapper, 'project', USER_SETTINGS);
}

/**
 * Read MCP servers configured under `~/.claude.json` `projects.*.mcpServers`
 * for project folders OTHER than the current cwd. Surfaces them under
 * the `'project-other'` scope so users can see every server Claude Code
 * knows about — including ones from projects they aren't currently
 * working in (e.g. a JIRA server they configured for their day-job repo
 * while INZONE is opened on a side project).
 *
 * Each entry carries its source `projectPath` so the UI can show which
 * folder it belongs to. INZONE never writes back here — edits/deletes
 * that target an other-project entry are routed to the file that owns
 * it via the same `<cwd>/.mcp.json` rule, so this is read-only.
 */
export async function readOtherProjectsLocalEntries(
  cwd: string | undefined,
): Promise<McpServerEntry[]> {
  const raw = await readJsonFile(USER_SETTINGS);
  if (!raw) return [];
  const projects = raw.projects;
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) {
    return [];
  }
  const projectsMap = projects as Record<string, unknown>;
  const out: McpServerEntry[] = [];
  for (const [projectPath, entry] of Object.entries(projectsMap)) {
    if (cwd && projectPath === cwd) continue; // current cwd handled separately
    if (!entry || typeof entry !== 'object') continue;
    const wrapper = entry as RawFile;
    if (!wrapper.mcpServers || typeof wrapper.mcpServers !== 'object') continue;
    out.push(
      ...entriesFromFile(
        wrapper,
        'project-other',
        USER_SETTINGS,
        projectPath,
      ),
    );
  }
  return out;
}

/**
 * Merged list. Project entries override user entries with the same name.
 * Other-project entries are kept separate (different scope) so they
 * never silently shadow servers in the current workspace.
 * Sorted alphabetically for stable display.
 */
export async function listMcpServers(cwd?: string): Promise<McpServerEntry[]> {
  const [user, project, projectLocal, otherProjects] = await Promise.all([
    readUserEntries(),
    readProjectEntries(cwd),
    readClaudeProjectLocalEntries(cwd),
    readOtherProjectsLocalEntries(cwd),
  ]);
  // Active scopes (user + current project) merge by name with project
  // winning on collision — Claude Code's own precedence rule.
  const active = new Map<string, McpServerEntry>();
  for (const e of user) active.set(e.name, e);
  for (const e of projectLocal) active.set(e.name, e);
  for (const e of project) active.set(e.name, e);
  // Other-project entries don't merge with active — they're informational
  // and keyed by `${projectPath}:${name}` so duplicates across folders
  // each get their own row.
  const otherKeyed = otherProjects.map((e) => ({
    ...e,
    // No merge needed; just dedup pathologically-identical entries.
  }));
  return [...active.values(), ...otherKeyed].sort((a, b) => {
    // Active scopes first, then other-project at the bottom.
    const score = (e: McpServerEntry) => (e.scope === 'project-other' ? 1 : 0);
    const sa = score(a);
    const sb = score(b);
    if (sa !== sb) return sa - sb;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Build the SDK-shape map (`{ name -> config }`) the Claude Agent SDK
 * expects under its `mcpServers` option. Optionally narrow to a specific
 * subset of names (used later for per-agent opt-in).
 */
export async function buildSdkMcpMap(args: {
  cwd?: string;
  allowed?: string[];
}): Promise<Record<string, McpServerConfig>> {
  const all = await listMcpServers(args.cwd);
  const allow = args.allowed ? new Set(args.allowed) : null;
  const out: Record<string, McpServerConfig> = {};
  for (const entry of all) {
    // We DO include `project-other` entries when the agent has explicitly
    // opted into them — Claude Code's `settingSources` won't auto-load
    // those, so it falls to us. The user effectively says "I configured
    // this once for another folder; please reuse it here too."
    if (allow && !allow.has(entry.name)) continue;
    out[entry.name] = await injectStoredAuth(entry.config);
  }
  return out;
}

/**
 * Augment a remote (sse/http) MCP config with an `Authorization` header
 * carrying a stored OAuth access token, when we have one for that URL.
 * This is what makes "Connect via OAuth" actually pay off at agent
 * runtime: without it, the SDK subprocess sees a bare URL and gets 401
 * because it doesn't share INZONE's encrypted token cache.
 *
 * Stdio configs are returned untouched. Existing `Authorization`
 * headers (set explicitly by the user) win — we never clobber them.
 */
async function injectStoredAuth(
  cfg: McpServerConfig,
): Promise<McpServerConfig> {
  if (cfg.type === 'stdio') return cfg;
  const existing = cfg.headers ?? {};
  if (
    Object.keys(existing).some((k) => k.toLowerCase() === 'authorization')
  ) {
    console.log(
      `[mcp-config] ${cfg.url} already has explicit Authorization header — leaving alone`,
    );
    return cfg;
  }
  // Lazy-loaded so the main bundle doesn't depend on Electron when this
  // module is imported from a non-Electron context (tests, etc).
  const { getBearerForUrl } = await import('./mcp-oauth');
  const bearer = await getBearerForUrl(cfg.url);
  if (!bearer) {
    // Surface this loudly: the user thinks they're "Connected" because
    // a token exists in our cache, but `getBearerForUrl` returned null
    // (token expired without a refresh_token, refresh failed, or no
    // creds at all). Without this hint the SDK gets a bare URL, the
    // server returns 401, and the agent silently has no tools.
    console.warn(
      `[mcp-config] no usable bearer for ${cfg.url} — agent will hit MCP without auth (401 likely). Click Disconnect + Reconnect in Settings → MCP servers.`,
    );
    return cfg;
  }
  console.log(
    `[mcp-config] injected Bearer for ${cfg.url}` +
      (bearer.expires_at
        ? ` (expires ${new Date(bearer.expires_at).toISOString()})`
        : ''),
  );
  return {
    ...cfg,
    headers: { ...existing, Authorization: `Bearer ${bearer.access_token}` },
  };
}

const NAME_SAFE = /^[A-Za-z0-9_-]+$/;

function validateDraft(draft: McpServerDraft): void {
  const name = draft.name.trim();
  if (!name) throw new Error('Server name cannot be empty.');
  if (!NAME_SAFE.test(name)) {
    throw new Error(
      'Server name may only contain letters, numbers, dashes, and underscores.',
    );
  }
  if (draft.config.type === 'stdio') {
    if (!draft.config.command || !draft.config.command.trim()) {
      throw new Error('A stdio server needs a command.');
    }
  } else {
    if (!draft.config.url || !draft.config.url.trim()) {
      throw new Error(`A ${draft.config.type} server needs a URL.`);
    }
    try {
      new URL(draft.config.url);
    } catch {
      throw new Error('URL is not valid.');
    }
  }
}

/**
 * Compact a config so we don't write empty `args` / `env` / `headers`.
 * Keeps the `.mcp.json` files tidy and diff-friendly.
 */
function compactConfig(cfg: McpServerConfig): McpServerConfig {
  if (cfg.type === 'stdio') {
    return {
      type: 'stdio',
      command: cfg.command,
      ...(cfg.args && cfg.args.length > 0 ? { args: cfg.args } : {}),
      ...(cfg.env && Object.keys(cfg.env).length > 0 ? { env: cfg.env } : {}),
    };
  }
  return {
    type: cfg.type,
    url: cfg.url,
    ...(cfg.headers && Object.keys(cfg.headers).length > 0
      ? { headers: cfg.headers }
      : {}),
  };
}

async function writeRawFile(filePath: string, raw: RawFile): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(raw, null, 2) + '\n', 'utf8');
}

async function loadOrInit(filePath: string): Promise<RawFile> {
  const existing = await readJsonFile(filePath);
  return existing ?? {};
}

/**
 * Save (create or update) one MCP server entry in the file matching its
 * scope. Existing fields in the file are preserved verbatim — we only
 * touch the `mcpServers.<name>` key (and the old name on rename).
 */
export async function saveMcpServer(
  draft: McpServerDraft,
  cwd: string | undefined,
): Promise<McpServerEntry> {
  validateDraft(draft);
  if (draft.scope === 'project-other') {
    throw new Error(
      "Servers from other Claude Code projects are read-only here. Open that project in Claude Code (or switch INZONE's workspace to that folder) to edit them.",
    );
  }
  const filePath =
    draft.scope === 'project'
      ? projectMcpPath(requireCwd(cwd))
      : USER_SETTINGS;
  const raw = await loadOrInit(filePath);
  if (!raw.mcpServers || typeof raw.mcpServers !== 'object') {
    raw.mcpServers = {};
  }
  const map = raw.mcpServers as Record<string, RawServerConfig>;
  if (draft.originalName && draft.originalName !== draft.name) {
    delete map[draft.originalName];
  }
  map[draft.name] = compactConfig(draft.config) as unknown as RawServerConfig;
  await writeRawFile(filePath, raw);
  return {
    name: draft.name,
    scope: draft.scope,
    filePath,
    config: compactConfig(draft.config),
  };
}

export async function deleteMcpServer(args: {
  name: string;
  scope: McpScope;
  cwd?: string;
}): Promise<void> {
  if (args.scope === 'project-other') {
    throw new Error(
      "Servers from other Claude Code projects are read-only here.",
    );
  }
  const filePath =
    args.scope === 'project' ? projectMcpPath(requireCwd(args.cwd)) : USER_SETTINGS;
  const raw = await readJsonFile(filePath);
  if (!raw || !raw.mcpServers) return;
  const map = raw.mcpServers as Record<string, RawServerConfig>;
  if (!(args.name in map)) return;
  delete map[args.name];
  await writeRawFile(filePath, raw);
}

function requireCwd(cwd: string | undefined): string {
  if (!cwd || cwd.trim().length === 0) {
    throw new Error(
      'Project-scope MCP edits require an open workspace folder.',
    );
  }
  return cwd;
}
