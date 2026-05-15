/**
 * Plugins — main-process operations behind Settings → Plugins.
 *
 * A Claude Code plugin is a folder containing:
 *   - `.claude-plugin/plugin.json` — manifest (name, version, etc.)
 *   - any combination of `agents/*.md`, `skills/<name>/SKILL.md`,
 *     `commands/*.md`, `mcp.json`, `hooks/*.json`
 *
 * Inzone installs plugins under `~/.claude/plugins/<plugin-name>/`.
 * Plugin contents get picked up by our existing agent / skill / MCP
 * / slash-command surfaces because Claude Code reads from these
 * same wells — there's nothing plugin-specific in the rest of the
 * app once a plugin is on disk.
 *
 * A marketplace is a git repo whose root contains
 * `.claude-plugin/marketplace.json`:
 *
 * ```json
 * { "name": "my-marketplace",
 *   "plugins": [
 *     { "name": "foo", "source": "./plugins/foo", "version": "1.0.0", ... }
 *   ]
 * }
 * ```
 *
 * Inzone keeps a list of the user's added marketplaces in
 * `~/.claude/plugins/marketplaces.json` (Inzone-owned). Catalog
 * fetches shallow-clone the marketplace into a temp dir, read the
 * JSON, and discard the clone.
 *
 * Install flow: shallow-clone the marketplace, copy the plugin's
 * `source` subdir into `~/.claude/plugins/<plugin-name>/`. Uninstall
 * is just `rm -rf` of the plugin folder.
 *
 * All operations resolve to `{ ok, ... }` results so the renderer
 * can surface friendly errors without try/catching IPC calls.
 */

import { promises as fs } from 'fs';
import { homedir, tmpdir } from 'os';
import path from 'path';
import { spawn } from 'child_process';
import type {
  InstalledPlugin,
  Marketplace,
  MarketplaceCatalog,
  MarketplacePluginEntry,
  PluginManifest,
} from '../shared/types';

const PLUGINS_DIR = path.join(homedir(), '.claude', 'plugins');
const MARKETPLACES_FILE = path.join(PLUGINS_DIR, 'marketplaces.json');
const CLAUDE_SETTINGS_FILE = path.join(homedir(), '.claude', 'settings.json');

// ─── Result types ────────────────────────────────────────────────

export type PluginActionResult =
  | { ok: true; installPath?: string; plugin?: InstalledPlugin }
  | { ok: false; error: string };

export type MarketplaceActionResult =
  | { ok: true; marketplace: Marketplace }
  | { ok: false; error: string };

// ─── Installed plugins ───────────────────────────────────────────

/**
 * Scan `~/.claude/plugins/` for installed plugins. Each immediate
 * subdirectory containing `.claude-plugin/plugin.json` counts.
 * Returns plugins sorted by display name (case-insensitive) so the
 * UI has a stable order.
 *
 * Failure modes are non-fatal — we log and skip plugins that fail
 * to parse rather than failing the whole list. That way a single
 * malformed manifest doesn't hide every other working plugin.
 */
export async function listInstalledPlugins(): Promise<InstalledPlugin[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(PLUGINS_DIR);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    console.warn('[plugins] failed to read plugins dir:', err);
    return [];
  }

  const results: InstalledPlugin[] = [];
  for (const entry of entries) {
    // Skip the marketplaces.json file (not a plugin folder) and any
    // dotfiles / cache directories that may live alongside plugins.
    if (entry === 'marketplaces.json' || entry.startsWith('.')) continue;
    const installPath = path.join(PLUGINS_DIR, entry);
    try {
      const stat = await fs.stat(installPath);
      if (!stat.isDirectory()) continue;
    } catch {
      continue;
    }
    const plugin = await readInstalledPlugin(installPath);
    if (plugin) results.push(plugin);
  }
  results.sort((a, b) =>
    pluginDisplayName(a).localeCompare(pluginDisplayName(b)),
  );
  return results;
}

function pluginDisplayName(p: InstalledPlugin): string {
  return (p.manifest.displayName ?? p.manifest.name).toLowerCase();
}

async function readInstalledPlugin(
  installPath: string,
): Promise<InstalledPlugin | null> {
  const manifestPath = path.join(installPath, '.claude-plugin', 'plugin.json');
  let raw: string;
  try {
    raw = await fs.readFile(manifestPath, 'utf8');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') return null;
    console.warn(`[plugins] failed to read manifest at ${manifestPath}:`, err);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.warn(`[plugins] invalid JSON at ${manifestPath}:`, err);
    return null;
  }
  const manifest = coerceManifest(parsed, path.basename(installPath));
  if (!manifest) return null;
  const contributes = await countContributions(installPath);
  // `source` + `installedAt` come from a sidecar `.inzone-install.json`
  // we drop alongside the manifest when WE install a plugin. Plugins
  // installed externally (via Claude Code CLI or manual copy) won't
  // have this — leave both fields undefined and the UI shows
  // "Discovered on disk" instead of "Installed via Inzone".
  // `enabled` defaults to true when the sidecar is missing (we assume
  // plugins discovered on disk should be on) or absent (older sidecars).
  const sidecar = await readSidecar(installPath);
  return {
    manifest,
    installPath,
    contributes,
    enabled: sidecar?.enabled ?? true,
    source: sidecar?.source,
    installedAt: sidecar?.installedAt,
  };
}

function coerceManifest(raw: unknown, fallbackName: string): PluginManifest | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const name =
    typeof obj.name === 'string' && obj.name.trim().length > 0
      ? obj.name.trim()
      : fallbackName;
  const m: PluginManifest = { name };
  if (typeof obj.displayName === 'string') m.displayName = obj.displayName;
  if (typeof obj.version === 'string') m.version = obj.version;
  if (typeof obj.description === 'string') m.description = obj.description;
  if (typeof obj.author === 'string') m.author = obj.author;
  else if (
    obj.author &&
    typeof obj.author === 'object' &&
    typeof (obj.author as { name?: unknown }).name === 'string'
  ) {
    m.author = (obj.author as { name: string }).name;
  }
  if (typeof obj.license === 'string') m.license = obj.license;
  if (typeof obj.homepage === 'string') m.homepage = obj.homepage;
  if (Array.isArray(obj.keywords))
    m.keywords = obj.keywords.filter((k): k is string => typeof k === 'string');
  return m;
}

async function countContributions(
  installPath: string,
): Promise<InstalledPlugin['contributes']> {
  const counts = { agents: 0, skills: 0, commands: 0, mcpServers: 0, hooks: 0 };
  counts.agents = await countMdFiles(path.join(installPath, 'agents'));
  counts.commands = await countMdFiles(path.join(installPath, 'commands'));
  counts.hooks = await countJsonFiles(path.join(installPath, 'hooks'));
  // Skills are folders, each with a SKILL.md inside.
  counts.skills = await countSkillFolders(path.join(installPath, 'skills'));
  // MCP servers live in an `mcp.json` (or `.mcp.json`) under the
  // plugin root. Count the entries in the `mcpServers` map.
  counts.mcpServers = await countMcpEntries(installPath);
  return counts;
}

async function countMdFiles(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter(
      (e) => e.toLowerCase().endsWith('.md') && !e.startsWith('.'),
    ).length;
  } catch {
    return 0;
  }
}

async function countJsonFiles(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir);
    return entries.filter(
      (e) => e.toLowerCase().endsWith('.json') && !e.startsWith('.'),
    ).length;
  } catch {
    return 0;
  }
}

async function countSkillFolders(dir: string): Promise<number> {
  try {
    const entries = await fs.readdir(dir);
    let n = 0;
    for (const e of entries) {
      if (e.startsWith('.')) continue;
      try {
        const stat = await fs.stat(path.join(dir, e));
        if (!stat.isDirectory()) continue;
      } catch {
        continue;
      }
      // A skill folder must have SKILL.md to count.
      try {
        await fs.access(path.join(dir, e, 'SKILL.md'));
        n += 1;
      } catch {
        /* not a real skill */
      }
    }
    return n;
  } catch {
    return 0;
  }
}

async function countMcpEntries(installPath: string): Promise<number> {
  for (const filename of ['mcp.json', '.mcp.json']) {
    try {
      const raw = await fs.readFile(
        path.join(installPath, filename),
        'utf8',
      );
      const parsed = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
      const servers = parsed.mcpServers;
      if (servers && typeof servers === 'object') {
        return Object.keys(servers).length;
      }
    } catch {
      /* try next candidate */
    }
  }
  return 0;
}

// ─── Inzone install sidecar (.inzone-install.json) ───────────────
// Records `source` + `installedAt` so we can show "installed by
// Inzone from X" in the detail view, and `enabled` so the user's
// toggle persists across restarts. Persisted alongside the manifest
// so it survives across app restarts. All fields optional on read
// for backwards compatibility — sidecars written before v1.20 don't
// have `enabled`, so missing means enabled.

interface InstallSidecar {
  source?: string;
  installedAt?: number;
  enabled?: boolean;
}

async function readSidecar(installPath: string): Promise<InstallSidecar | null> {
  try {
    const raw = await fs.readFile(
      path.join(installPath, '.claude-plugin', '.inzone-install.json'),
      'utf8',
    );
    const parsed = JSON.parse(raw) as InstallSidecar;
    const out: InstallSidecar = {};
    if (typeof parsed.source === 'string') out.source = parsed.source;
    if (typeof parsed.installedAt === 'number')
      out.installedAt = parsed.installedAt;
    if (typeof parsed.enabled === 'boolean') out.enabled = parsed.enabled;
    return out;
  } catch {
    /* missing or malformed — fine, plugin was installed outside Inzone */
  }
  return null;
}

async function writeSidecar(
  installPath: string,
  data: InstallSidecar,
): Promise<void> {
  const dir = path.join(installPath, '.claude-plugin');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(
    path.join(dir, '.inzone-install.json'),
    JSON.stringify(data, null, 2) + '\n',
    'utf8',
  );
}

/**
 * Toggle a plugin's enabled flag.
 *
 * Writes through to the sidecar AND mirrors the change in Claude
 * Code's own `~/.claude/settings.json` `enabledPlugins` array so
 * the two apps stay in sync. The CLI uses a `<plugin>@<source>`
 * key shape for that array but Inzone-installed plugins just
 * include the plugin name — both forms are accepted on read.
 *
 * Idempotent — toggling to the current value is a no-op (avoids
 * gratuitous file writes that would invalidate FS watchers).
 */
export async function setPluginEnabled(
  name: string,
  enabled: boolean,
): Promise<PluginActionResult> {
  if (!name.trim()) {
    return { ok: false, error: 'Plugin name is required.' };
  }
  const installPath = path.join(PLUGINS_DIR, name);
  try {
    await fs.access(installPath);
  } catch {
    return { ok: false, error: `Plugin "${name}" isn't installed.` };
  }
  const existing = (await readSidecar(installPath)) ?? {};
  // If the value matches, skip the writes entirely.
  if ((existing.enabled ?? true) === enabled) {
    const plugin = await readInstalledPlugin(installPath);
    return { ok: true, plugin: plugin ?? undefined };
  }
  await writeSidecar(installPath, { ...existing, enabled });
  // Mirror to Claude Code settings.json — best-effort, never blocks
  // the toggle from succeeding. The CLI's `enabledPlugins` field is
  // an array of strings; we add/remove the plugin's name on the
  // user's behalf. If settings.json doesn't exist or has a different
  // shape than expected we just leave it alone.
  try {
    await syncClaudeCodeEnabledPlugins(name, enabled);
  } catch (err) {
    console.warn('[plugins] failed to sync Claude Code settings.json:', err);
  }
  const plugin = await readInstalledPlugin(installPath);
  return { ok: true, plugin: plugin ?? undefined };
}

async function syncClaudeCodeEnabledPlugins(
  name: string,
  enabled: boolean,
): Promise<void> {
  let raw: string;
  let existed = false;
  try {
    raw = await fs.readFile(CLAUDE_SETTINGS_FILE, 'utf8');
    existed = true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    // Don't create settings.json just to write enabledPlugins —
    // Claude Code may not be installed at all, and creating a file
    // it doesn't otherwise own would be presumptuous. Bail out
    // silently when the file isn't there.
    if (code === 'ENOENT') return;
    throw err;
  }
  // Parse defensively — never throw on JSON parse failures. Claude
  // Code's settings.json sometimes has comments or trailing commas
  // depending on whether the user edited it by hand; if our parse
  // fails we shouldn't clobber it.
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return;
  }
  const current = Array.isArray(parsed.enabledPlugins)
    ? (parsed.enabledPlugins as string[]).filter(
        (s): s is string => typeof s === 'string',
      )
    : [];
  // Normalise: match by exact name OR `name@source` prefix so we
  // handle both Inzone's flat-name convention and the CLI's keyed
  // form.
  const has = current.some(
    (s) => s === name || s.startsWith(`${name}@`),
  );
  let next: string[];
  if (enabled && !has) {
    next = [...current, name];
  } else if (!enabled && has) {
    next = current.filter((s) => s !== name && !s.startsWith(`${name}@`));
  } else {
    return; // already in desired state
  }
  parsed.enabledPlugins = next;
  // Preserve indentation by re-using 2-space pretty print (matches
  // what Claude Code itself writes).
  await fs.writeFile(
    CLAUDE_SETTINGS_FILE,
    JSON.stringify(parsed, null, 2) + (existed ? '\n' : ''),
    'utf8',
  );
}

/**
 * Walk `~/.claude/plugins/*` and return only the enabled ones.
 * Used by the agents/skills/commands/MCP loaders to expand their
 * search beyond `~/.claude/...` into each enabled plugin's
 * subfolder.
 */
export async function listEnabledPlugins(): Promise<InstalledPlugin[]> {
  const all = await listInstalledPlugins();
  return all.filter((p) => p.enabled);
}

// ─── Marketplaces ────────────────────────────────────────────────

/**
 * Read the user's added marketplaces from disk. Missing file is
 * not an error — just an empty list (most fresh users will be in
 * this state until they add the first marketplace).
 */
export async function listMarketplaces(): Promise<Marketplace[]> {
  try {
    const raw = await fs.readFile(MARKETPLACES_FILE, 'utf8');
    const parsed = JSON.parse(raw) as { marketplaces?: Marketplace[] };
    if (Array.isArray(parsed.marketplaces)) {
      return parsed.marketplaces.filter(
        (m): m is Marketplace =>
          typeof m === 'object' &&
          m !== null &&
          typeof m.name === 'string' &&
          typeof m.source === 'string',
      );
    }
    return [];
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    console.warn('[plugins] failed to read marketplaces.json:', err);
    return [];
  }
}

async function writeMarketplaces(list: Marketplace[]): Promise<void> {
  await fs.mkdir(PLUGINS_DIR, { recursive: true });
  await fs.writeFile(
    MARKETPLACES_FILE,
    JSON.stringify({ marketplaces: list }, null, 2) + '\n',
    'utf8',
  );
}

/**
 * Add a marketplace by URL. Validates the source by fetching its
 * marketplace.json first — if we can't parse it, we refuse to
 * save. Duplicate sources are deduped silently (the existing entry
 * wins). Returns the saved entry on success.
 */
export async function addMarketplace(
  source: string,
): Promise<MarketplaceActionResult> {
  const trimmed = source.trim();
  if (!trimmed) {
    return { ok: false, error: 'Source URL is required.' };
  }
  // Verify the marketplace.json is parseable before persisting.
  let catalogName: string;
  let description: string | undefined;
  try {
    const fetched = await fetchMarketplaceJson(trimmed);
    catalogName = fetched.name ?? deriveNameFromSource(trimmed);
    description = fetched.description;
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't load that marketplace: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
  const entry: Marketplace = {
    name: catalogName,
    source: trimmed,
    addedAt: Date.now(),
    description,
  };
  const current = await listMarketplaces();
  const existing = current.find((m) => m.source === trimmed);
  if (existing) {
    return { ok: true, marketplace: existing };
  }
  current.push(entry);
  await writeMarketplaces(current);
  return { ok: true, marketplace: entry };
}

/**
 * Remove a marketplace by source URL (the unique identifier — name
 * could collide). No-op when the source isn't in the list.
 */
export async function removeMarketplace(
  source: string,
): Promise<{ ok: true; removed: boolean }> {
  const current = await listMarketplaces();
  const filtered = current.filter((m) => m.source !== source);
  const removed = filtered.length !== current.length;
  if (removed) await writeMarketplaces(filtered);
  return { ok: true, removed };
}

/**
 * Fetch + parse a marketplace's catalog. The renderer calls this
 * when the user clicks Browse on a marketplace card. We shallow-
 * clone the source repo into a temp dir, read the
 * `.claude-plugin/marketplace.json`, then discard the clone.
 * GitHub URLs short-circuit via raw URL when we can.
 */
export async function fetchMarketplaceCatalog(
  source: string,
): Promise<MarketplaceCatalog | { ok: false; error: string }> {
  try {
    const parsed = await fetchMarketplaceJson(source);
    const marketplace: Marketplace = {
      name: parsed.name ?? deriveNameFromSource(source),
      source,
      addedAt: 0, // not stored, just echoing context
      description: parsed.description,
    };
    return { marketplace, plugins: parsed.plugins };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface ParsedMarketplaceJson {
  name?: string;
  description?: string;
  plugins: MarketplacePluginEntry[];
}

/**
 * Two-mode fetcher: raw GitHub URL first (fast path), shallow git
 * clone as fallback. Returns a normalized `{ name, description,
 * plugins }` regardless of which mode succeeded.
 */
async function fetchMarketplaceJson(
  source: string,
): Promise<ParsedMarketplaceJson> {
  // Fast path — GitHub raw URL. Skips the git clone entirely.
  const rawUrl = githubRawMarketplaceUrl(source);
  if (rawUrl) {
    try {
      const text = await fetchText(rawUrl);
      return normaliseMarketplaceJson(text);
    } catch {
      /* fall through to clone */
    }
  }
  // Generic path — shallow clone the repo, read the file, delete.
  const tmp = await fs.mkdtemp(path.join(tmpdir(), 'inzone-marketplace-'));
  try {
    await runProcess('git', [
      'clone',
      '--depth=1',
      '--filter=blob:none',
      source,
      tmp,
    ]);
    const text = await fs.readFile(
      path.join(tmp, '.claude-plugin', 'marketplace.json'),
      'utf8',
    );
    return normaliseMarketplaceJson(text);
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

function normaliseMarketplaceJson(text: string): ParsedMarketplaceJson {
  const parsed = JSON.parse(text) as {
    name?: unknown;
    description?: unknown;
    plugins?: unknown;
  };
  const pluginsRaw = Array.isArray(parsed.plugins) ? parsed.plugins : [];
  const plugins: MarketplacePluginEntry[] = [];
  for (const entry of pluginsRaw) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    if (typeof obj.name !== 'string' || obj.name.trim().length === 0) continue;
    const source =
      typeof obj.source === 'string' && obj.source.trim().length > 0
        ? obj.source.trim()
        : `./${obj.name}`;
    const out: MarketplacePluginEntry = {
      name: obj.name.trim(),
      source,
    };
    if (typeof obj.version === 'string') out.version = obj.version;
    if (typeof obj.description === 'string') out.description = obj.description;
    if (typeof obj.author === 'string') out.author = obj.author;
    else if (
      obj.author &&
      typeof obj.author === 'object' &&
      typeof (obj.author as { name?: unknown }).name === 'string'
    ) {
      out.author = (obj.author as { name: string }).name;
    }
    if (typeof obj.license === 'string') out.license = obj.license;
    if (typeof obj.homepage === 'string') out.homepage = obj.homepage;
    if (Array.isArray(obj.keywords))
      out.keywords = obj.keywords.filter(
        (k): k is string => typeof k === 'string',
      );
    plugins.push(out);
  }
  return {
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    description:
      typeof parsed.description === 'string' ? parsed.description : undefined,
    plugins,
  };
}

/**
 * Try to construct the raw GitHub URL for the marketplace.json
 * given a repo URL. Falls back to null when the URL doesn't match
 * GitHub's pattern (the caller then uses git clone).
 *
 * Handles `https://github.com/<org>/<repo>` and
 * `https://github.com/<org>/<repo>.git` shapes; default branch is
 * `main` (we try one shot, if it 404s the caller falls through).
 */
function githubRawMarketplaceUrl(source: string): string | null {
  const m = /^https:\/\/github\.com\/([^\/]+)\/([^\/?#]+?)(?:\.git)?\/?$/i.exec(
    source.trim(),
  );
  if (!m) return null;
  return `https://raw.githubusercontent.com/${m[1]}/${m[2]}/main/.claude-plugin/marketplace.json`;
}

function deriveNameFromSource(source: string): string {
  try {
    const url = new URL(source);
    const tail = url.pathname.split('/').filter(Boolean).pop() ?? source;
    return tail.replace(/\.git$/i, '');
  } catch {
    return source;
  }
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching ${url}`);
  }
  return res.text();
}

// ─── Install / uninstall ─────────────────────────────────────────

export interface InstallPluginArgs {
  /** Marketplace source URL we're installing from. Used to clone
   *  the marketplace repo so we can copy out the plugin subdir. */
  marketplaceSource: string;
  /** The plugin's `source` field from the marketplace.json — a
   *  subpath like `./plugins/foo` relative to the marketplace
   *  repo root. */
  pluginSource: string;
  /** Plugin name (used as the install folder name). */
  pluginName: string;
}

/**
 * Install a plugin by cloning the marketplace repo, copying the
 * `pluginSource` subdir into `~/.claude/plugins/<pluginName>/`,
 * and writing the Inzone install sidecar so the UI knows where
 * the plugin came from.
 *
 * Refuses to clobber an already-installed plugin — the user has
 * to uninstall first. (Avoids surprise downgrade or feature loss
 * if the user re-clicks Install on a plugin they've customised.)
 */
export async function installPlugin(
  args: InstallPluginArgs,
): Promise<PluginActionResult> {
  const { marketplaceSource, pluginSource, pluginName } = args;
  if (!pluginName.trim()) {
    return { ok: false, error: 'Plugin name is required.' };
  }
  const target = path.join(PLUGINS_DIR, pluginName);
  try {
    await fs.access(target);
    return {
      ok: false,
      error: `A plugin named "${pluginName}" is already installed. Uninstall it first to reinstall.`,
    };
  } catch {
    /* doesn't exist — good, proceed */
  }

  const tmp = await fs.mkdtemp(path.join(tmpdir(), 'inzone-plugin-install-'));
  try {
    await runProcess('git', [
      'clone',
      '--depth=1',
      marketplaceSource,
      tmp,
    ]);
    // Resolve plugin source relative to the clone root. Strip a
    // leading "./" to keep `path.join` happy with bare subpaths.
    const subPath = pluginSource.replace(/^\.\/+/, '');
    const src = path.join(tmp, subPath);
    try {
      const stat = await fs.stat(src);
      if (!stat.isDirectory()) {
        return {
          ok: false,
          error: `Plugin source "${pluginSource}" inside the marketplace isn't a directory.`,
        };
      }
    } catch {
      return {
        ok: false,
        error: `Plugin source "${pluginSource}" not found inside the marketplace repo.`,
      };
    }
    await fs.mkdir(PLUGINS_DIR, { recursive: true });
    await fs.cp(src, target, { recursive: true, errorOnExist: false });
    // Default to enabled — the user just explicitly chose to install
    // this plugin, so they almost certainly want it active. They can
    // toggle it off from the detail modal afterwards if needed.
    await writeSidecar(target, {
      source: marketplaceSource,
      installedAt: Date.now(),
      enabled: true,
    });
    // Mirror the enable into Claude Code's settings.json so the two
    // apps share state for this plugin. Best-effort — never blocks
    // the install from succeeding.
    try {
      await syncClaudeCodeEnabledPlugins(pluginName, true);
    } catch (err) {
      console.warn(
        '[plugins] failed to mirror enable to Claude Code settings.json:',
        err,
      );
    }
    const plugin = await readInstalledPlugin(target);
    return { ok: true, installPath: target, plugin: plugin ?? undefined };
  } catch (err) {
    // Best-effort cleanup of a partial install.
    try {
      await fs.rm(target, { recursive: true, force: true });
    } catch {
      /* nothing to clean up */
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await fs.rm(tmp, { recursive: true, force: true });
  }
}

/**
 * Uninstall a plugin by removing its folder under
 * `~/.claude/plugins/`. Idempotent — uninstalling a plugin that
 * isn't installed returns `removed: false` rather than erroring.
 *
 * Sanity-checks the resolved path stays inside `PLUGINS_DIR` so a
 * malicious `name` like `../../foo` can't be used to delete
 * arbitrary directories.
 */
export async function uninstallPlugin(
  name: string,
): Promise<{ ok: true; removed: boolean } | { ok: false; error: string }> {
  if (!name.trim() || name.includes('/') || name.includes('\\') || name === '..') {
    return { ok: false, error: 'Invalid plugin name.' };
  }
  const target = path.join(PLUGINS_DIR, name);
  const resolved = path.resolve(target);
  if (!resolved.startsWith(path.resolve(PLUGINS_DIR) + path.sep)) {
    return { ok: false, error: 'Refusing to remove a path outside the plugins folder.' };
  }
  try {
    await fs.access(resolved);
  } catch {
    return { ok: true, removed: false };
  }
  try {
    await fs.rm(resolved, { recursive: true, force: true });
    return { ok: true, removed: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Shared subprocess helper ────────────────────────────────────
// Same recipe as `skills-install.ts` `runProcess` — augments PATH
// so git is reachable in Electron's stripped environment.

function runProcess(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const pathAugment = [
      process.env.PATH ?? '',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      `${process.env.HOME ?? ''}/.npm/bin`,
      `${process.env.HOME ?? ''}/.local/bin`,
    ]
      .filter(Boolean)
      .join(':');
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: pathAugment },
    });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
    proc.stderr?.on('data', (b: Buffer) => (stderr += b.toString('utf8')));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            stderr.trim() || `${cmd} ${args[0]} exited with code ${code}`,
          ),
        );
    });
  });
}
