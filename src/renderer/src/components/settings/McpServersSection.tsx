/**
 * Settings tab: MCP servers.
 *
 * Reads/writes from `~/.claude.json` (user scope) and `<cwd>/.mcp.json`
 * (project scope) — the same files the Claude Code CLI uses, so anything
 * configured in the CLI shows up here and vice versa.
 *
 * Wizard design:
 *  - The user picks a preset tile (Figma, Context7, Supabase, …) or
 *    "Custom server".
 *  - Each preset declares its own short list of user-facing fields
 *    (e.g. "Folder to expose" for Filesystem; "Personal access token"
 *    for GitHub). The preset knows how to turn those values into the
 *    underlying `command + args + env` the MCP server needs — the user
 *    never sees those raw fields unless they expand "Show advanced".
 *  - "Custom server" or editing an existing entry start directly in
 *    the advanced view since there's no preset to guide them.
 */

import { useEffect, useMemo, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { json } from '@codemirror/lang-json';
import { oneDark } from '@codemirror/theme-one-dark';
import { vim } from '@replit/codemirror-vim';
import { useEditorPreferences } from '../../hooks/useEditorPreferences';
import { useStore } from '../../store';
import type {
  McpProbeResult,
  McpScope,
  McpServerConfig,
  McpServerDraft,
  McpServerEntry,
} from '@shared/types';

/**
 * Per-entry probe state. Keyed by `${scope}:${name}` so collisions
 * across scopes don't shadow each other.
 */
type ProbeState =
  | { status: 'idle' }
  | { status: 'probing' }
  | { status: 'ok'; result: McpProbeResult }
  | { status: 'error'; result: McpProbeResult };

function entryKey(e: McpServerEntry): string {
  return `${e.scope}:${e.name}`;
}

/**
 * Module-scoped probe cache so opening Settings after a tab switch
 * doesn't drop every entry back to "Untested" and re-spam probes —
 * which was making the JIRA "constantly disconnects" complaint look
 * worse than it was. Entries older than this TTL are re-probed.
 */
const PROBE_CACHE_TTL_MS = 2 * 60 * 1000;
interface ProbeCacheEntry {
  state: ProbeState;
  at: number;
}
const probeCache = new Map<string, ProbeCacheEntry>();
function readProbeCache(): Record<string, ProbeState> {
  const out: Record<string, ProbeState> = {};
  const cutoff = Date.now() - PROBE_CACHE_TTL_MS;
  for (const [k, v] of probeCache) {
    if (v.at < cutoff) probeCache.delete(k);
    else out[k] = v.state;
  }
  return out;
}
function writeProbeCache(key: string, state: ProbeState): void {
  // Don't cache transient "probing" — only resolved states.
  if (state.status === 'probing' || state.status === 'idle') return;
  probeCache.set(key, { state, at: Date.now() });
}

/**
 * Is this stdio config already running through mcp-remote? We use it
 * to decide whether the "Connect" button should re-probe (refresh
 * tokens) instead of wrapping again.
 */
function looksLikeMcpRemoteConfig(cfg: McpServerConfig): boolean {
  if (cfg.type !== 'stdio') return false;
  if (cfg.command.includes('mcp-remote')) return true;
  return (cfg.args ?? []).some((a) => a.includes('mcp-remote'));
}

/**
 * Mirror of `canonicalResourceKey` from the main process. Renderer-side
 * because we want to ask "do we have tokens for this entry?" without an
 * IPC round-trip per card. Keep these two implementations in sync.
 */
function canonicalize(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    u.search = '';
    let pathname = u.pathname.replace(/\/+$/, '');
    if (!pathname) pathname = '/';
    return `${u.origin}${pathname}`;
  } catch {
    return rawUrl;
  }
}

type PresetInputType = 'text' | 'password' | 'folder';

interface PresetInput {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  type: PresetInputType;
  required?: boolean;
}

interface Preset {
  id: string;
  label: string;
  description: string;
  nameSuggestion: string;
  /** User-visible fields. Empty = no extra input needed. */
  inputs: PresetInput[];
  /** Build the underlying MCP config from the user's filled-in values. */
  buildConfig: (values: Record<string, string>) => McpServerConfig;
  /** Optional one-line note shown below the inputs. */
  hint?: string;
}

const PRESETS: Preset[] = [
  {
    id: 'figma',
    label: 'Figma Dev Mode',
    description: 'Local Figma desktop bridge for design context',
    nameSuggestion: 'figma',
    inputs: [],
    buildConfig: () => ({ type: 'sse', url: 'http://127.0.0.1:3845/sse' }),
    hint: 'Make sure Figma desktop is running with Dev Mode MCP enabled (View → Dev Mode → Enable MCP server).',
  },
  {
    id: 'context7',
    label: 'Context7',
    description: 'Up-to-date docs for popular libraries',
    nameSuggestion: 'context7',
    inputs: [],
    // Context7 exposes both /sse and /mcp; the SSE handshake silently
    // fails to register tools with the Agent SDK while Streamable HTTP
    // ("/mcp") works reliably, so default to HTTP.
    buildConfig: () => ({ type: 'http', url: 'https://mcp.context7.com/mcp' }),
    hint: 'Public hosted service — no auth needed.',
  },
  {
    id: 'atlassian',
    label: 'Atlassian (JIRA + Confluence)',
    description: 'Official remote MCP for Jira & Confluence',
    nameSuggestion: 'atlassian',
    inputs: [],
    buildConfig: () => ({ type: 'sse', url: 'https://mcp.atlassian.com/v1/sse' }),
    hint: 'On the first call, Claude opens an OAuth window in your browser to log in.',
  },
  {
    id: 'supabase',
    label: 'Supabase',
    description: 'Database, auth, and storage tools',
    nameSuggestion: 'supabase',
    inputs: [
      {
        key: 'token',
        label: 'Access token',
        placeholder: 'sbp_…',
        help: 'Create one at supabase.com → Account → Access Tokens.',
        type: 'password',
        required: true,
      },
    ],
    buildConfig: (v) => ({
      type: 'stdio',
      command: 'npx',
      args: [
        '-y',
        '@supabase/mcp-server-supabase@latest',
        '--access-token',
        v.token,
      ],
    }),
  },
  {
    id: 'github',
    label: 'GitHub',
    description: 'Repos, PRs, issues, code search',
    nameSuggestion: 'github',
    inputs: [
      {
        key: 'token',
        label: 'Personal access token',
        placeholder: 'ghp_…',
        help: 'Create one at github.com/settings/tokens with the `repo` and `read:user` scopes.',
        type: 'password',
        required: true,
      },
    ],
    buildConfig: (v) => ({
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: v.token },
    }),
  },
  {
    id: 'filesystem',
    label: 'Filesystem',
    description: 'Read/write files inside a specific folder',
    nameSuggestion: 'filesystem',
    inputs: [
      {
        key: 'folder',
        label: 'Folder to expose',
        placeholder: '/Users/you/Documents/project',
        help: 'The agent will be able to read and write files inside this folder. Click Browse to pick.',
        type: 'folder',
        required: true,
      },
    ],
    buildConfig: (v) => ({
      type: 'stdio',
      command: 'npx',
      args: [
        '-y',
        '@modelcontextprotocol/server-filesystem',
        v.folder || '/',
      ],
    }),
  },
];

type EditorMode =
  | { kind: 'pick' }
  | { kind: 'guided'; preset: Preset; values: Record<string, string> }
  | { kind: 'advanced' };

/** Empty-state stdio config used by the "Custom" mode. */
const EMPTY_STDIO: McpServerConfig = { type: 'stdio', command: '' };

export function McpServersSection() {
  const cwd = useStore((s) => s.cwd);
  const [entries, setEntries] = useState<McpServerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<McpServerDraft | null>(null);
  const [error, setError] = useState<string | undefined>();
  const [query, setQuery] = useState('');
  const [probes, setProbes] = useState<Record<string, ProbeState>>(() =>
    readProbeCache(),
  );
  /** Set of canonical resource URLs we hold OAuth tokens for. */
  const [authedResources, setAuthedResources] = useState<Set<string>>(
    new Set(),
  );

  const refreshAuthList = async () => {
    try {
      const list = await window.cowork.mcp.authList();
      setAuthedResources(new Set(list));
    } catch {
      /* non-fatal — UI just won't show "Authenticated" tag */
    }
  };
  useEffect(() => {
    void refreshAuthList();
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      if (!window.cowork?.mcp) {
        throw new Error(
          'MCP bridge unavailable — please fully restart INzone (⌘Q + relaunch) so the preload picks up the new APIs.',
        );
      }
      const next = await window.cowork.mcp.list(cwd ?? undefined);
      setEntries(next);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  /**
   * Single source of truth for setting a probe's state — also writes
   * the resolved state through to the module-level cache so it
   * survives the user navigating away from this Settings tab.
   */
  const setProbeState = (key: string, state: ProbeState) => {
    setProbes((prev) => ({ ...prev, [key]: state }));
    writeProbeCache(key, state);
  };

  /**
   * Probe a single entry. Updates `probes` state with intermediate
   * "probing" so the UI shows a spinner immediately. Wrapped in a stable
   * callback so we can call it from row buttons and from "Test all".
   */
  const probeOne = async (entry: McpServerEntry) => {
    const key = entryKey(entry);
    setProbeState(key, { status: 'probing' });
    try {
      const result = await window.cowork.mcp.probe({ config: entry.config });
      setProbeState(
        key,
        result.ok ? { status: 'ok', result } : { status: 'error', result },
      );
    } catch (err) {
      setProbeState(key, {
        status: 'error',
        result: {
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        },
      });
    }
  };

  const probeAll = async () => {
    // Run in parallel — probes are short-lived and most of the time they
    // wait on network or subprocess startup, not on each other.
    await Promise.all(entries.map((e) => probeOne(e)));
  };

  // Auto-probe once whenever the list changes. Skip if there are no
  // entries — nothing to do — and skip individual entries we already
  // have a result for so re-renders don't spam the network.
  useEffect(() => {
    if (entries.length === 0) return;
    for (const entry of entries) {
      const key = entryKey(entry);
      if (!probes[key]) {
        void probeOne(entry);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter((e) =>
      [e.name, summarize(e.config), e.config.type]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [entries, query]);

  const grouped = useMemo(() => {
    const userScope: McpServerEntry[] = [];
    const projectScope: McpServerEntry[] = [];
    const otherProjects: McpServerEntry[] = [];
    for (const e of filtered) {
      if (e.scope === 'project') projectScope.push(e);
      else if (e.scope === 'project-other') otherProjects.push(e);
      else userScope.push(e);
    }
    return { userScope, projectScope, otherProjects };
  }, [filtered]);

  const anyProbing = Object.values(probes).some((p) => p.status === 'probing');

  const startNew = () => {
    setEditing({ name: '', scope: 'user', config: { ...EMPTY_STDIO } });
  };
  const startEdit = (entry: McpServerEntry) => {
    setEditing({
      name: entry.name,
      scope: entry.scope,
      config: cloneConfig(entry.config),
      originalName: entry.name,
    });
  };
  const cancel = () => setEditing(null);

  const save = async (draft: McpServerDraft) => {
    await window.cowork.mcp.save({ draft, cwd: cwd ?? undefined });
    setEditing(null);
    await refresh();
  };

  const remove = async (entry: McpServerEntry) => {
    const ok = confirm(
      `Delete the "${entry.name}" MCP server from ${entry.scope === 'project' ? 'this project' : 'your user config'}?`,
    );
    if (!ok) return;
    try {
      await window.cowork.mcp.delete({
        name: entry.name,
        scope: entry.scope,
        cwd: cwd ?? undefined,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Build the `npx -y mcp-remote <url> [--header K: V …]` arg vector
   * for a remote MCP entry. Used only for the "Copy cmd" escape hatch
   * now — the in-app Connect button uses the native OAuth flow below.
   */
  const buildMcpRemoteArgs = (
    config: Extract<McpServerConfig, { type: 'sse' | 'http' }>,
  ): string[] => {
    const args = ['-y', 'mcp-remote', config.url];
    for (const [k, v] of Object.entries(config.headers ?? {})) {
      args.push('--header', `${k}: ${v}`);
    }
    return args;
  };

  /**
   * Escape hatch: copy the equivalent shell command for an entry so the
   * user can run it in a real terminal. This matters because our probe
   * spawns mcp-remote as a child process and kills it when the probe
   * settles — fine for a quick health check, but if OAuth is fighting
   * us (Figma's hosted MCP not opening a browser, jira's mcp losing the
   * session) it helps to have a way to run mcp-remote directly under
   * the user's control where they can see every line of stderr.
   */
  const copyShellCommand = async (entry: McpServerEntry) => {
    let cmd: string;
    if (entry.config.type === 'stdio') {
      const parts = [entry.config.command, ...(entry.config.args ?? [])];
      cmd = parts.map((p) => (/\s/.test(p) ? `'${p}'` : p)).join(' ');
    } else {
      const args = buildMcpRemoteArgs(entry.config);
      cmd = ['npx', ...args]
        .map((p) => (/\s/.test(p) ? `'${p}'` : p))
        .join(' ');
    }
    try {
      await navigator.clipboard.writeText(cmd);
      // Reuse the modal-error slot to flash a confirmation; clears
      // itself next time the user refreshes or saves.
      setError(`Copied: ${cmd}`);
      setTimeout(() => {
        setError((prev) => (prev?.startsWith('Copied:') ? undefined : prev));
      }, 3000);
    } catch (err) {
      setError(
        `Could not copy to clipboard: ${err instanceof Error ? err.message : String(err)}\nCommand: ${cmd}`,
      );
    }
  };

  /**
   * Run the native MCP OAuth flow for a remote server. Same shape as
   * Claude Code's `/login` flow: discovery → DCR → PKCE → localhost
   * callback → token exchange. Tokens are stored encrypted in main
   * and reused automatically by every subsequent probe / agent
   * session that hits the same canonical resource URL.
   *
   * Unlike the previous mcp-remote-wrap approach, this never modifies
   * the entry — it works for read-only "Other Claude Code projects"
   * cards just as well as for editable ones.
   */
  const connectViaOauth = async (entry: McpServerEntry) => {
    if (entry.config.type === 'stdio') {
      // Already a stdio entry — almost certainly mcp-remote wrapped
      // from an earlier session. Just re-probe; mcp-remote will pick
      // up its own cache.
      await probeOne(entry);
      return;
    }
    const url = entry.config.url;
    const key = entryKey(entry);
    setProbeState(key, { status: 'probing' });
    setError(undefined);
    try {
      const res = await window.cowork.mcp.authStart({ url });
      if (!res.ok) {
        setProbeState(key, {
          status: 'error',
          result: { ok: false, error: res.error },
        });
        setError(res.error);
        return;
      }
      // Refresh "Authenticated" indicator and re-probe with the new tokens.
      await refreshAuthList();
      // Drop any cached failure so the new probe state sticks.
      probeCache.delete(key);
      await probeOne(entry);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setProbeState(key, { status: 'error', result: { ok: false, error: msg } });
      setError(msg);
    }
  };

  /**
   * Forget stored tokens for an entry. Used by the "Disconnect" button
   * that appears next to entries we have credentials for.
   */
  const disconnectAuth = async (entry: McpServerEntry) => {
    if (entry.config.type === 'stdio') return;
    const url = entry.config.url;
    const ok = confirm(
      `Forget OAuth tokens for "${entry.name}"?\n\nYou'll need to click Connect again to use it.`,
    );
    if (!ok) return;
    try {
      await window.cowork.mcp.authDisconnect({ url });
      await refreshAuthList();
      // Re-probe — without tokens it'll go back to "needs auth".
      probeCache.delete(entryKey(entry));
      await probeOne(entry);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="settings-pane">
      <div className="settings-pane-header">
        <h2>MCP servers</h2>
        <p className="settings-pane-sub">
          Connect external MCP servers (Figma, JIRA, Context7, Supabase, …).
          Configs live in <code>~/.claude.json</code> and{' '}
          <code>./.mcp.json</code> — the same files the Claude Code CLI uses.
        </p>
      </div>

      <div className="settings-pane-body">
        {!editing && (
          <>
            <div className="mcp-info-banner">
              <div className="mcp-info-banner-icon">ⓘ</div>
              <div className="mcp-info-banner-body">
                <div className="mcp-info-banner-title">
                  Already using MCPs in Claude Code? They show up here too —
                  but OAuth tokens don&rsquo;t cross between apps.
                </div>
                INZONE reads the same files Claude Code uses —{' '}
                <code>~/.claude.json</code> (User and per-project under{' '}
                <code>projects[cwd]</code>) and <code>./.mcp.json</code>. The
                <strong> server list</strong> is shared, but each app keeps
                its <strong>own OAuth token cache</strong>. So if a server
                requires login (Atlassian, Figma, etc.), authenticate it
                <strong> once in INZONE</strong> via the <strong>Connect</strong>{' '}
                button below — INZONE will then sign every agent&rsquo;s MCP
                request with the cached token automatically.{' '}
                <strong>claude.ai integrations</strong> (synced from your
                claude.ai account) live outside the JSON files entirely and
                aren&rsquo;t shown here.
              </div>
            </div>

            <div className="settings-toolbar">
              <input
                className="settings-search"
                placeholder="Search servers…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button
                className="ghost small"
                onClick={() => void probeAll()}
                disabled={anyProbing || entries.length === 0}
                title="Re-test connection for every configured server"
              >
                {anyProbing ? 'Testing…' : 'Test all'}
              </button>
              <button
                className="primary small"
                onClick={startNew}
                title="Add a new MCP server"
              >
                + Add server
              </button>
            </div>

            {error && <div className="modal-error">{error}</div>}

            {loading && <div className="settings-empty">Loading servers…</div>}
            {!loading && filtered.length === 0 && !error && (
              <div className="settings-empty">
                {query
                  ? 'No servers match that search.'
                  : 'No MCP servers configured yet. Click "+ Add server" to wire one up.'}
              </div>
            )}

            {!loading && grouped.userScope.length > 0 && (
              <McpScopeGroup
                title="User scope"
                subtitle="Available in every workspace · ~/.claude.json"
                count={grouped.userScope.length}
                entries={grouped.userScope}
                probes={probes}
                onEdit={startEdit}
                onDelete={(e) => void remove(e)}
                onTest={(e) => void probeOne(e)}
                onAuth={(e) => void connectViaOauth(e)}
                onDisconnect={(e) => void disconnectAuth(e)}
                onCopyCommand={(e) => void copyShellCommand(e)}
                authedResources={authedResources}
              />
            )}

            {!loading && grouped.projectScope.length > 0 && (
              <McpScopeGroup
                title="Project scope"
                subtitle="This workspace only · ./.mcp.json + Claude Code local"
                count={grouped.projectScope.length}
                entries={grouped.projectScope}
                probes={probes}
                onEdit={startEdit}
                onDelete={(e) => void remove(e)}
                onTest={(e) => void probeOne(e)}
                onAuth={(e) => void connectViaOauth(e)}
                onDisconnect={(e) => void disconnectAuth(e)}
                onCopyCommand={(e) => void copyShellCommand(e)}
                authedResources={authedResources}
              />
            )}

            {!loading && grouped.otherProjects.length > 0 && (
              <McpScopeGroup
                title="Other Claude Code projects"
                subtitle="Configured in ~/.claude.json for folders other than this workspace · read-only"
                count={grouped.otherProjects.length}
                entries={grouped.otherProjects}
                probes={probes}
                onEdit={startEdit}
                onDelete={(e) => void remove(e)}
                onTest={(e) => void probeOne(e)}
                onAuth={(e) => void connectViaOauth(e)}
                onDisconnect={(e) => void disconnectAuth(e)}
                onCopyCommand={(e) => void copyShellCommand(e)}
                authedResources={authedResources}
                readOnly
              />
            )}
          </>
        )}

        {editing && (
          <McpEditor
            initial={editing}
            cwd={cwd}
            onCancel={cancel}
            onSave={save}
          />
        )}
      </div>
    </div>
  );
}

/**
 * One scope's collapsible-style group of MCP cards. Header line shows
 * the title, a count chip, and a brief subtitle of where these come
 * from on disk.
 */
function McpScopeGroup({
  title,
  subtitle,
  count,
  entries,
  probes,
  authedResources,
  onEdit,
  onDelete,
  onTest,
  onAuth,
  onDisconnect,
  onCopyCommand,
  readOnly = false,
}: {
  title: string;
  subtitle: string;
  count: number;
  entries: McpServerEntry[];
  probes: Record<string, ProbeState>;
  authedResources: Set<string>;
  onEdit: (e: McpServerEntry) => void;
  onDelete: (e: McpServerEntry) => void;
  onTest: (e: McpServerEntry) => void;
  onAuth: (e: McpServerEntry) => void;
  onDisconnect: (e: McpServerEntry) => void;
  onCopyCommand: (e: McpServerEntry) => void;
  readOnly?: boolean;
}) {
  return (
    <div className="mcp-scope-group">
      <div className="mcp-scope-group-header">
        <div className="mcp-scope-group-title-row">
          <h3 className="mcp-scope-group-title">{title}</h3>
          <span className="mcp-scope-group-count">{count}</span>
        </div>
        <div className="mcp-scope-group-subtitle">{subtitle}</div>
      </div>
      <div className="mcp-list">
        {entries.map((entry) => (
          <McpEntryCard
            key={`${entry.projectPath ?? ''}|${entryKey(entry)}`}
            entry={entry}
            probe={probes[entryKey(entry)] ?? { status: 'idle' }}
            authed={
              entry.config.type !== 'stdio' &&
              authedResources.has(canonicalize(entry.config.url))
            }
            onEdit={() => onEdit(entry)}
            onDelete={() => onDelete(entry)}
            onTest={() => onTest(entry)}
            onAuth={() => onAuth(entry)}
            onDisconnect={() => onDisconnect(entry)}
            onCopyCommand={() => onCopyCommand(entry)}
            readOnly={readOnly}
          />
        ))}
      </div>
    </div>
  );
}

function McpEntryCard({
  entry,
  probe,
  authed,
  onEdit,
  onDelete,
  onTest,
  onAuth,
  onDisconnect,
  onCopyCommand,
  readOnly = false,
}: {
  entry: McpServerEntry;
  probe: ProbeState;
  authed: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTest: () => void;
  onAuth: () => void;
  onDisconnect: () => void;
  onCopyCommand: () => void;
  readOnly?: boolean;
}) {
  // Where this entry was configured: prefer the project folder when set
  // (other-projects view), fall back to the actual file on disk.
  const provenance = entry.projectPath ?? entry.filePath;
  const isRemote = entry.config.type !== 'stdio';
  const isWrapped =
    entry.config.type === 'stdio' && looksLikeMcpRemoteConfig(entry.config);
  // Show Connect on any failed remote (auth-or-not — OAuth might be
  // the fix even when the error doesn't literally say "401"), and on
  // any failed mcp-remote-wrapped stdio entry. We also show it on
  // remote entries that have probably succeeded so the user can
  // proactively (re-)authenticate when tokens are about to expire.
  const showConnect = isRemote || isWrapped;
  const isFailing = probe.status === 'error';
  const authHint = !isFailing
    ? null
    : isWrapped
      ? 'This entry is already wrapped with mcp-remote. Click Connect to re-run the OAuth flow and refresh cached tokens.'
      : authed
        ? 'Stored OAuth tokens were rejected — they may have expired or been revoked. Click Reconnect to run the OAuth flow again.'
        : 'This server requires authentication. Click Connect to run the OAuth flow — your browser will open to log in, and INZONE will cache the tokens (encrypted) for next time.';
  return (
    <div className={`mcp-card${readOnly ? ' mcp-card-readonly' : ''}`}>
      <div className="mcp-card-tags">
        <McpStatusPill probe={probe} />
        <span className={`library-tag ${entry.config.type}`}>
          {entry.config.type.toUpperCase()}
        </span>
        {readOnly && (
          <span className="library-tag muted" title="Configured for a different workspace — read-only here">
            READ-ONLY
          </span>
        )}
        {authed && (
          <span
            className="library-tag authed"
            title="OAuth tokens stored — INZONE will sign in automatically"
          >
            AUTHENTICATED
          </span>
        )}
      </div>
      <div className="mcp-card-title">{entry.name}</div>
      <div className="mcp-card-summary">{summarize(entry.config)}</div>
      {probe.status === 'error' && probe.result.error && (
        <div className="mcp-card-error" title={probe.result.error}>
          {truncateError(probe.result.error)}
        </div>
      )}
      {authHint && <div className="mcp-card-auth-hint">{authHint}</div>}
      <div className="mcp-card-meta">
        <span title={provenance} className="mcp-card-path">
          {entry.projectPath ? `📁 ${shortenPath(entry.projectPath)}` : shortenPath(entry.filePath)}
        </span>
        <div className="mcp-card-actions">
          {showConnect && (
            <button
              className="primary small"
              onClick={onAuth}
              title={
                authed
                  ? 'Re-run OAuth flow to refresh stored tokens'
                  : isWrapped
                    ? 'Re-run mcp-remote OAuth flow to refresh cached tokens'
                    : 'Open browser, sign in, and cache tokens for this server'
              }
            >
              {authed ? 'Reconnect' : 'Connect'}
            </button>
          )}
          {authed && (
            // Disconnect always available when we have stored tokens —
            // even on read-only "Other Claude Code projects" cards, since
            // this only clears OUR token cache, not the underlying
            // config file. Useful when a stale token won't refresh and
            // Reconnect alone keeps reusing the cached server session.
            <button
              className="ghost small"
              onClick={onDisconnect}
              title="Forget the stored OAuth tokens for this server"
            >
              Disconnect
            </button>
          )}
          {showConnect && isFailing && (
            <button
              className="ghost small"
              onClick={onCopyCommand}
              title="Copy the mcp-remote shell command — useful when you want to debug OAuth manually in your own terminal"
            >
              Copy cmd
            </button>
          )}
          <button
            className="ghost small"
            onClick={onTest}
            disabled={probe.status === 'probing'}
            title="Probe this server's connection"
          >
            {probe.status === 'probing' ? 'Testing…' : 'Test'}
          </button>
          {!readOnly && (
            <>
              <button className="ghost small" onClick={onEdit}>
                Edit
              </button>
              <button className="ghost small danger" onClick={onDelete}>
                Delete
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Connection-status badge — mimics the green/red dot Claude Code shows
 * in `/mcp`. On hover, the title attribute reveals tool count + server
 * name + duration so power users can sanity-check quickly.
 */
function McpStatusPill({ probe }: { probe: ProbeState }) {
  if (probe.status === 'idle') {
    return (
      <span className="mcp-status mcp-status-idle" title="Not yet tested">
        <span className="mcp-status-dot" />
        Untested
      </span>
    );
  }
  if (probe.status === 'probing') {
    return (
      <span className="mcp-status mcp-status-probing" title="Connecting…">
        <span className="mcp-status-dot" />
        Testing
      </span>
    );
  }
  if (probe.status === 'ok') {
    const r = probe.result;
    const tip = [
      r.serverName ? `${r.serverName}${r.serverVersion ? ` v${r.serverVersion}` : ''}` : null,
      typeof r.tools === 'number' ? `${r.tools} tool${r.tools === 1 ? '' : 's'}` : null,
      typeof r.durationMs === 'number' ? `${r.durationMs} ms` : null,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <span className="mcp-status mcp-status-ok" title={tip || 'Connected'}>
        <span className="mcp-status-dot" />
        Connected
        {typeof r.tools === 'number' && (
          <span className="mcp-status-meta"> · {r.tools} tool{r.tools === 1 ? '' : 's'}</span>
        )}
      </span>
    );
  }
  // error
  return (
    <span
      className="mcp-status mcp-status-error"
      title={probe.result.error ?? 'Failed to connect'}
    >
      <span className="mcp-status-dot" />
      Failed
    </span>
  );
}

function truncateError(msg: string): string {
  const oneLine = msg.replace(/\s+/g, ' ').trim();
  return oneLine.length > 180 ? oneLine.slice(0, 178) + '…' : oneLine;
}

/** The Add/Edit panel. Manages preset → guided → save flow. */
function McpEditor({
  initial,
  cwd,
  onCancel,
  onSave,
}: {
  initial: McpServerDraft;
  cwd: string | null;
  onCancel: () => void;
  onSave: (draft: McpServerDraft) => Promise<void>;
}) {
  const isNew = !initial.originalName;
  const { vimMode } = useEditorPreferences();
  // New entries open the preset picker. Edits jump straight to advanced
  // since we can't reliably reverse-engineer a preset from a saved entry.
  const [mode, setMode] = useState<EditorMode>(
    isNew ? { kind: 'pick' } : { kind: 'advanced' },
  );
  const [name, setName] = useState(initial.name);
  const [scope, setScope] = useState<McpScope>(initial.scope);
  const [advancedConfig, setAdvancedConfig] = useState<McpServerConfig>(
    initial.config,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  // Raw-JSON disclosure inside the advanced view.
  const [showJson, setShowJson] = useState(false);
  const [jsonText, setJsonText] = useState(() =>
    JSON.stringify(initial.config, null, 2),
  );
  const [jsonError, setJsonError] = useState<string | undefined>();

  // Keep JSON view in sync with form-driven config so toggling shows
  // the current state, not a stale snapshot.
  useEffect(() => {
    if (!showJson) {
      setJsonText(JSON.stringify(advancedConfig, null, 2));
      setJsonError(undefined);
    }
  }, [advancedConfig, showJson]);

  const pickPreset = (preset: Preset) => {
    setMode({
      kind: 'guided',
      preset,
      values: Object.fromEntries(preset.inputs.map((i) => [i.key, ''])),
    });
    setName(preset.nameSuggestion);
    setError(undefined);
  };
  const pickCustom = () => {
    setMode({ kind: 'advanced' });
    setError(undefined);
  };
  const switchToAdvanced = () => {
    if (mode.kind === 'guided') {
      // Take what the user has filled in so far over to the advanced form.
      setAdvancedConfig(mode.preset.buildConfig(mode.values));
    }
    setMode({ kind: 'advanced' });
  };
  const backToPick = () => setMode({ kind: 'pick' });

  const trySave = async () => {
    setError(undefined);
    let config: McpServerConfig;
    if (mode.kind === 'guided') {
      // Validate required fields
      const missing = mode.preset.inputs.find(
        (i) => i.required && !mode.values[i.key]?.trim(),
      );
      if (missing) {
        setError(`"${missing.label}" is required.`);
        return;
      }
      config = mode.preset.buildConfig(mode.values);
    } else if (showJson) {
      try {
        config = JSON.parse(jsonText) as McpServerConfig;
      } catch (err) {
        setJsonError(err instanceof Error ? err.message : String(err));
        return;
      }
    } else {
      config = advancedConfig;
    }
    if (!name.trim()) {
      setError('Server name is required.');
      return;
    }
    setSaving(true);
    try {
      await onSave({
        name: name.trim(),
        scope,
        config,
        originalName: initial.originalName,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mcp-editor">
      <div className="mcp-editor-head">
        <h3>{isNew ? 'Add MCP server' : `Edit "${initial.originalName}"`}</h3>
        {mode.kind === 'guided' && (
          <button
            type="button"
            className="ghost small"
            onClick={backToPick}
            title="Back to presets"
          >
            ← Pick a different preset
          </button>
        )}
      </div>

      {/* Step 1: pick a preset (only on new entries). */}
      {mode.kind === 'pick' && (
        <div className="mcp-presets">
          <div className="mcp-presets-label">Pick what you want to connect</div>
          <div className="mcp-presets-grid">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                className="mcp-preset"
                onClick={() => pickPreset(p)}
              >
                <div className="mcp-preset-title">{p.label}</div>
                <div className="mcp-preset-desc">{p.description}</div>
                <div className={`library-tag ${p.buildConfig({}).type}`}>
                  {p.buildConfig({}).type.toUpperCase()}
                </div>
              </button>
            ))}
            <button
              type="button"
              className="mcp-preset mcp-preset-custom"
              onClick={pickCustom}
            >
              <div className="mcp-preset-title">Custom server…</div>
              <div className="mcp-preset-desc">
                Configure command, args, env, or URL by hand. For anything not
                in the preset list.
              </div>
              <div className="library-tag muted">ADVANCED</div>
            </button>
          </div>
        </div>
      )}

      {/* Step 2a: guided form (preset chosen). */}
      {mode.kind === 'guided' && (
        <>
          <div className="mcp-guided-summary">
            <div className="mcp-guided-summary-title">
              Connecting <strong>{mode.preset.label}</strong>
            </div>
            <div className="mcp-guided-summary-desc">
              {mode.preset.description}
            </div>
          </div>

          <NameAndScope
            name={name}
            scope={scope}
            cwd={cwd}
            onName={setName}
            onScope={setScope}
          />

          {mode.preset.inputs.length === 0 ? (
            <div className="mcp-noinputs">
              No extra fields needed — just click <strong>Add server</strong>{' '}
              below to connect.
            </div>
          ) : (
            mode.preset.inputs.map((input) => (
              <GuidedInput
                key={input.key}
                input={input}
                value={mode.values[input.key] ?? ''}
                onChange={(v) =>
                  setMode({
                    ...mode,
                    values: { ...mode.values, [input.key]: v },
                  })
                }
              />
            ))
          )}

          {mode.preset.hint && (
            <div className="mcp-guided-hint">{mode.preset.hint}</div>
          )}

          <div className="mcp-fallback-note">
            Connection not working after saving? Open <strong>Show advanced</strong>
            {' '}below and try the other remote transport
            (<code>SSE</code> ↔ <code>HTTP</code>) — many servers expose both,
            and one usually handshakes when the other doesn&rsquo;t.
          </div>

          <button
            type="button"
            className="ghost small mcp-advanced-toggle"
            onClick={switchToAdvanced}
            title="Show the underlying command / args / env"
          >
            Show advanced (command, args, env)
          </button>
        </>
      )}

      {/* Step 2b: advanced (Custom or editing). */}
      {mode.kind === 'advanced' && (
        <>
          <NameAndScope
            name={name}
            scope={scope}
            cwd={cwd}
            onName={setName}
            onScope={setScope}
          />
          <label className="field field-small">
            <span className="field-label">Transport</span>
            <select
              value={advancedConfig.type}
              onChange={(e) => {
                const next = e.target.value as McpServerConfig['type'];
                if (next === advancedConfig.type) return;
                setAdvancedConfig(
                  next === 'stdio'
                    ? { type: 'stdio', command: '' }
                    : { type: next, url: '' },
                );
              }}
            >
              <option value="stdio">stdio (local subprocess)</option>
              <option value="sse">SSE (remote)</option>
              <option value="http">HTTP (remote)</option>
            </select>
          </label>

          {!showJson && advancedConfig.type === 'stdio' && (
            <StdioFields
              config={advancedConfig}
              onChange={(patch) =>
                setAdvancedConfig({ ...advancedConfig, ...patch })
              }
            />
          )}
          {!showJson && advancedConfig.type !== 'stdio' && (
            <RemoteFields
              config={advancedConfig}
              onChange={(patch) =>
                setAdvancedConfig({ ...advancedConfig, ...patch } as McpServerConfig)
              }
            />
          )}

          <details
            className="mcp-json"
            open={showJson}
            onToggle={(e) =>
              setShowJson((e.target as HTMLDetailsElement).open)
            }
          >
            <summary>Show as raw JSON</summary>
            <div className="codemirror-wrap">
              <CodeMirror
                value={jsonText}
                onChange={(v) => {
                  setJsonText(v);
                  setJsonError(undefined);
                }}
                theme={oneDark}
                extensions={[
                  ...(vimMode ? [vim()] : []),
                  json(),
                ]}
                basicSetup={{
                  lineNumbers: true,
                  foldGutter: true,
                  bracketMatching: true,
                }}
                minHeight="180px"
                maxHeight="40vh"
              />
            </div>
            {jsonError && <div className="modal-error">{jsonError}</div>}
            <div className="field-hint">
              Edit the entry's config directly. Saving uses this JSON instead
              of the form values. Must include a <code>type</code> field.
            </div>
          </details>
        </>
      )}

      {error && <div className="modal-error">{error}</div>}

      {/* Action bar. Hidden on the preset-pick step since you choose by
          clicking a tile, not by clicking Save. */}
      {mode.kind !== 'pick' && (
        <div className="mcp-editor-actions">
          <button className="ghost" onClick={onCancel} disabled={saving}>
            Cancel
          </button>
          <div className="spacer" />
          <button
            className="primary"
            onClick={() => void trySave()}
            disabled={saving || !name.trim()}
          >
            {saving ? 'Saving…' : isNew ? 'Add server' : 'Save changes'}
          </button>
        </div>
      )}
    </div>
  );
}

function NameAndScope({
  name,
  scope,
  cwd,
  onName,
  onScope,
}: {
  name: string;
  scope: McpScope;
  cwd: string | null;
  onName: (v: string) => void;
  onScope: (v: McpScope) => void;
}) {
  return (
    <div className="field-row">
      <label className="field">
        <span className="field-label">Name</span>
        <input
          value={name}
          onChange={(e) => onName(e.target.value)}
          placeholder="my-server"
          spellCheck={false}
        />
        <span className="field-hint">
          Used by Claude as <code>mcp__{name || 'name'}__&lt;tool&gt;</code>.
        </span>
      </label>
      <label className="field field-small">
        <span className="field-label">Where to save</span>
        <select
          value={scope}
          onChange={(e) => onScope(e.target.value as McpScope)}
        >
          <option value="user">All projects (~/.claude.json)</option>
          <option value="project" disabled={!cwd}>
            This project only (./.mcp.json)
          </option>
        </select>
        {scope === 'project' && !cwd && (
          <span className="field-hint">
            Open a workspace folder first to use project scope.
          </span>
        )}
      </label>
    </div>
  );
}

function GuidedInput({
  input,
  value,
  onChange,
}: {
  input: PresetInput;
  value: string;
  onChange: (v: string) => void;
}) {
  const isPassword = input.type === 'password';
  const isFolder = input.type === 'folder';

  const browse = async () => {
    const picked = await window.cowork.workspace.pickFolder();
    if (picked) onChange(picked);
  };

  return (
    <label className="field">
      <span className="field-label">
        {input.label}
        {input.required && <span className="field-required"> *</span>}
      </span>
      <div className={isFolder ? 'mcp-folder-row' : undefined}>
        <input
          type={isPassword ? 'password' : 'text'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={input.placeholder}
          spellCheck={false}
          autoComplete={isPassword ? 'new-password' : 'off'}
          style={isFolder ? { flex: 1 } : undefined}
        />
        {isFolder && (
          <button
            type="button"
            className="ghost small"
            onClick={() => void browse()}
          >
            Browse…
          </button>
        )}
      </div>
      {input.help && <span className="field-hint">{input.help}</span>}
    </label>
  );
}

function StdioFields({
  config,
  onChange,
}: {
  config: Extract<McpServerConfig, { type: 'stdio' }>;
  onChange: (patch: Partial<Extract<McpServerConfig, { type: 'stdio' }>>) => void;
}) {
  return (
    <>
      <label className="field">
        <span className="field-label">Command</span>
        <input
          value={config.command}
          onChange={(e) => onChange({ command: e.target.value })}
          placeholder="npx"
          spellCheck={false}
        />
        <span className="field-hint">
          The executable INzone spawns. Common values: <code>npx</code>,{' '}
          <code>uvx</code>, <code>python</code>, or an absolute path.
        </span>
      </label>

      <ListField
        label="Arguments"
        items={config.args ?? []}
        onChange={(args) => onChange({ args })}
        placeholder="-y"
        addLabel="+ Add arg"
        hint="One token per row, in order. Avoid embedding spaces in a single row."
      />

      <KeyValueField
        label="Environment variables"
        items={config.env ?? {}}
        onChange={(env) => onChange({ env })}
        keyPlaceholder="GITHUB_TOKEN"
        valuePlaceholder="ghp_…"
        hint="Passed to the subprocess. Useful for tokens and credentials."
      />
    </>
  );
}

function RemoteFields({
  config,
  onChange,
}: {
  config: Extract<McpServerConfig, { type: 'sse' | 'http' }>;
  onChange: (
    patch: Partial<Extract<McpServerConfig, { type: 'sse' | 'http' }>>,
  ) => void;
}) {
  return (
    <>
      <label className="field">
        <span className="field-label">URL</span>
        <input
          value={config.url}
          onChange={(e) => onChange({ url: e.target.value })}
          placeholder="https://mcp.example.com/sse"
          spellCheck={false}
        />
        <span className="field-hint">
          The remote endpoint to connect to.
        </span>
      </label>

      <KeyValueField
        label="Headers"
        items={config.headers ?? {}}
        onChange={(headers) => onChange({ headers })}
        keyPlaceholder="Authorization"
        valuePlaceholder="Bearer …"
        hint="Sent on every request. Common use: an Authorization or API-key header."
      />
    </>
  );
}

function ListField({
  label,
  items,
  onChange,
  placeholder,
  addLabel,
  hint,
}: {
  label: string;
  items: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  addLabel: string;
  hint?: string;
}) {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="kv-list">
        {items.map((value, i) => (
          <div className="kv-row" key={i}>
            <input
              value={value}
              placeholder={placeholder}
              onChange={(e) => {
                const next = [...items];
                next[i] = e.target.value;
                onChange(next);
              }}
              spellCheck={false}
            />
            <button
              type="button"
              className="ghost small"
              onClick={() => onChange(items.filter((_, j) => j !== i))}
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ghost small kv-add"
          onClick={() => onChange([...items, ''])}
        >
          {addLabel}
        </button>
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

function KeyValueField({
  label,
  items,
  onChange,
  keyPlaceholder,
  valuePlaceholder,
  hint,
}: {
  label: string;
  items: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
  keyPlaceholder: string;
  valuePlaceholder: string;
  hint?: string;
}) {
  const rows = Object.entries(items);
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="kv-list">
        {rows.map(([k, v], i) => (
          <div className="kv-row two" key={i}>
            <input
              value={k}
              placeholder={keyPlaceholder}
              onChange={(e) => {
                const next: Record<string, string> = {};
                rows.forEach(([rk, rv], j) => {
                  next[j === i ? e.target.value : rk] = rv;
                });
                onChange(next);
              }}
              spellCheck={false}
            />
            <input
              value={v}
              placeholder={valuePlaceholder}
              onChange={(e) => onChange({ ...items, [k]: e.target.value })}
              spellCheck={false}
            />
            <button
              type="button"
              className="ghost small"
              onClick={() => {
                const next = { ...items };
                delete next[k];
                onChange(next);
              }}
              aria-label="Remove"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          className="ghost small kv-add"
          onClick={() => onChange({ ...items, '': '' })}
        >
          + Add {label.toLowerCase().replace(/s$/, '')}
        </button>
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

function summarize(cfg: McpServerConfig): string {
  if (cfg.type === 'stdio') {
    const parts = [cfg.command, ...(cfg.args ?? [])].join(' ');
    return parts.length > 120 ? parts.slice(0, 118) + '…' : parts;
  }
  return cfg.url;
}

function shortenPath(p: string): string {
  const segs = p.split('/');
  if (segs.length <= 4) return p;
  return '…/' + segs.slice(-3).join('/');
}

function cloneConfig(cfg: McpServerConfig): McpServerConfig {
  return JSON.parse(JSON.stringify(cfg)) as McpServerConfig;
}
