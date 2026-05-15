/**
 * Settings → Plugins.
 *
 * Reads + writes:
 *   - `~/.claude/plugins/<name>/.claude-plugin/plugin.json` — installed
 *     plugins, the same folder Claude Code uses
 *   - `~/.claude/plugins/marketplaces.json` — Inzone-owned list of
 *     marketplace sources (git URLs)
 *
 * The renderer is stateless above the IPC bridge — all file operations
 * happen in the main process, the renderer just renders + dispatches.
 *
 * Layout: two-column grid matching Skills + MCP. Left column owns
 * installed plugins + user-added marketplaces; right column is the
 * Recommended Marketplaces rail (curated, hardcoded). Browse opens
 * a drawer with the marketplace's plugin catalog and per-plugin
 * Install buttons.
 */

import { useEffect, useMemo, useState } from 'react';
import { Markdown } from '../Markdown';
import { safeConfirm } from '../../lib/safeConfirm';
import { RECOMMENDED_MARKETPLACES } from '@shared/recommended-marketplaces';
import type {
  InstalledPlugin,
  Marketplace,
  MarketplaceCatalog,
  MarketplacePluginEntry,
  RecommendedMarketplace,
} from '@shared/types';

// ─── Result helper ───────────────────────────────────────────────
// `MarketplaceCatalog | { ok: false; error: string }` doesn't have a
// useful discriminator on the success side (catalogs don't carry an
// `ok` field). We narrow by checking the presence of `plugins`.
function isCatalog(
  value: MarketplaceCatalog | { ok: false; error: string },
): value is MarketplaceCatalog {
  return (value as MarketplaceCatalog).plugins !== undefined;
}

export function PluginsSection(): JSX.Element {
  const [installed, setInstalled] = useState<InstalledPlugin[]>([]);
  const [marketplaces, setMarketplaces] = useState<Marketplace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  // Browsing a marketplace's catalog in a drawer overlay.
  const [browsing, setBrowsing] = useState<{
    marketplace: Marketplace;
    catalog: MarketplaceCatalog | null;
    loading: boolean;
    error?: string;
  } | null>(null);
  // Detail modal for an installed plugin (shows contents + uninstall).
  const [detail, setDetail] = useState<InstalledPlugin | null>(null);
  // "Add marketplace" inline form open/close + draft.
  const [addingMarketplace, setAddingMarketplace] = useState(false);
  const [addMarketplaceUrl, setAddMarketplaceUrl] = useState('');
  const [addMarketplaceBusy, setAddMarketplaceBusy] = useState(false);
  // Per-plugin install spinner so the catalog row can show "Installing…".
  const [installingKey, setInstallingKey] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    try {
      const [plugins, ms] = await Promise.all([
        window.cowork.plugins.list(),
        window.cowork.plugins.listMarketplaces(),
      ]);
      setInstalled(plugins);
      setMarketplaces(ms);
      setError(undefined);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  /** Names of installed plugins — drives the "Installed" pill in the
   *  marketplace browse drawer. */
  const installedNames = useMemo(
    () => new Set(installed.map((p) => p.manifest.name)),
    [installed],
  );

  /** Sources of added marketplaces — drives the "Added" pill on the
   *  recommended-marketplace rail cards. */
  const addedMarketplaceSources = useMemo(
    () => new Set(marketplaces.map((m) => m.source)),
    [marketplaces],
  );

  const openBrowse = async (marketplace: Marketplace) => {
    setBrowsing({ marketplace, catalog: null, loading: true });
    try {
      const res = await window.cowork.plugins.fetchCatalog({
        source: marketplace.source,
      });
      if (isCatalog(res)) {
        setBrowsing({ marketplace, catalog: res, loading: false });
      } else {
        setBrowsing({
          marketplace,
          catalog: null,
          loading: false,
          error: res.error,
        });
      }
    } catch (err) {
      setBrowsing({
        marketplace,
        catalog: null,
        loading: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  };

  /** Add a marketplace by URL. After it lands, immediately open the
   *  browse drawer for that marketplace so the user can install
   *  plugins from it without an extra click. */
  const addMarketplaceFlow = async (source: string) => {
    if (!source.trim()) return;
    setAddMarketplaceBusy(true);
    try {
      const res = await window.cowork.plugins.addMarketplace({ source });
      if (res.ok) {
        setAddingMarketplace(false);
        setAddMarketplaceUrl('');
        await refresh();
        await openBrowse(res.marketplace);
      } else {
        setError(res.error);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setAddMarketplaceBusy(false);
    }
  };

  const removeMarketplace = async (m: Marketplace) => {
    const ok = await safeConfirm(
      `Remove the "${m.name}" marketplace from your list?\n\nThis does NOT uninstall any plugins you've already installed from it.`,
    );
    if (!ok) return;
    try {
      await window.cowork.plugins.removeMarketplace({ source: m.source });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const installFromCatalog = async (
    marketplace: Marketplace,
    plugin: MarketplacePluginEntry,
  ) => {
    const key = `${marketplace.source}|${plugin.name}`;
    setInstallingKey(key);
    try {
      const res = await window.cowork.plugins.install({
        marketplaceSource: marketplace.source,
        pluginSource: plugin.source,
        pluginName: plugin.name,
      });
      if (!res.ok) {
        setError(`Install failed: ${res.error}`);
        return;
      }
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setInstallingKey(null);
    }
  };

  const uninstall = async (plugin: InstalledPlugin) => {
    const ok = await safeConfirm(
      `Uninstall the "${plugin.manifest.displayName ?? plugin.manifest.name}" plugin?\n\n` +
        `This deletes ${plugin.installPath} and removes every agent, skill, slash command, and MCP server the plugin contributed (${pluginContributesSummary(plugin)}).`,
    );
    if (!ok) return;
    try {
      const res = await window.cowork.plugins.uninstall({
        name: plugin.manifest.name,
      });
      if (!('ok' in res) || res.ok === false) {
        setError(
          `Uninstall failed: ${'error' in res ? res.error : 'unknown error'}`,
        );
        return;
      }
      setDetail(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  /**
   * Toggle a plugin's enabled flag. Refreshes the installed list
   * so the detail modal picks up the new state and the rest of
   * the app's loaders (agents/skills/commands/MCP) see plugin
   * contributions appear / disappear on next call.
   */
  const setPluginEnabled = async (
    plugin: InstalledPlugin,
    enabled: boolean,
  ) => {
    try {
      const res = await window.cowork.plugins.setEnabled({
        name: plugin.manifest.name,
        enabled,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Update the detail modal's snapshot so the toggle reflects
      // the new state without waiting for the next list refresh.
      if (res.plugin) setDetail(res.plugin);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="settings-pane">
      <div className="settings-pane-header">
        <h2>Plugins</h2>
        <p className="settings-pane-sub">
          Claude Code plugin bundles installed under{' '}
          <code>~/.claude/plugins/</code>. Each plugin can contribute
          agents, skills, slash commands, and MCP servers — the
          contents show up across the other Settings tabs after install.
        </p>
      </div>

      <div className="settings-pane-body plugins-two-col">
        <div className="plugins-two-col-main">
          {error && <div className="modal-error">{error}</div>}
          <div className="plugins-two-col-scroll">
            {/* Installed plugins */}
            <div className="plugins-section">
              <div className="plugins-section-head">
                <h3 className="plugins-section-title">Installed</h3>
                <span className="plugins-section-count">
                  {installed.length}
                </span>
              </div>
              {loading && (
                <div className="settings-empty">Loading plugins…</div>
              )}
              {!loading && installed.length === 0 && (
                <div className="settings-empty">
                  No plugins installed yet. Browse a marketplace on the
                  right to add one.
                </div>
              )}
              {!loading && installed.length > 0 && (
                <div className="plugins-list">
                  {installed.map((p) => (
                    <InstalledPluginCard
                      key={p.installPath}
                      plugin={p}
                      onOpen={() => setDetail(p)}
                    />
                  ))}
                </div>
              )}
            </div>

            {/* Added marketplaces */}
            <div className="plugins-section">
              <div className="plugins-section-head">
                <h3 className="plugins-section-title">Marketplaces</h3>
                <span className="plugins-section-count">
                  {marketplaces.length}
                </span>
                <button
                  type="button"
                  className={
                    'small plugins-section-action ' +
                    (addingMarketplace ? 'ghost' : 'primary')
                  }
                  onClick={() => setAddingMarketplace((v) => !v)}
                >
                  {addingMarketplace ? 'Cancel' : '+ Add marketplace'}
                </button>
              </div>
              {addingMarketplace && (
                <div className="plugins-add-marketplace">
                  <input
                    className="settings-search"
                    placeholder="Marketplace URL (git repo or raw marketplace.json)"
                    value={addMarketplaceUrl}
                    onChange={(e) => setAddMarketplaceUrl(e.target.value)}
                    autoFocus
                  />
                  <button
                    type="button"
                    className="primary small"
                    onClick={() =>
                      void addMarketplaceFlow(addMarketplaceUrl)
                    }
                    disabled={
                      !addMarketplaceUrl.trim() || addMarketplaceBusy
                    }
                  >
                    {addMarketplaceBusy ? 'Adding…' : 'Add'}
                  </button>
                </div>
              )}
              {!loading && marketplaces.length === 0 && (
                <div className="settings-empty">
                  No marketplaces yet. Add one above, or click a
                  recommended marketplace on the right.
                </div>
              )}
              {marketplaces.length > 0 && (
                <div className="plugins-list">
                  {marketplaces.map((m) => (
                    <MarketplaceCard
                      key={m.source}
                      marketplace={m}
                      onBrowse={() => void openBrowse(m)}
                      onRemove={() => void removeMarketplace(m)}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right rail — Recommended Marketplaces. */}
        <div className="plugins-two-col-rail">
          <RecommendedMarketplacesRail
            addedSources={addedMarketplaceSources}
            onAdd={(rm) => void addMarketplaceFlow(rm.source)}
          />
        </div>
      </div>

      {/* Detail modal for an installed plugin. */}
      {detail && (
        <PluginDetailModal
          plugin={detail}
          onClose={() => setDetail(null)}
          onUninstall={() => void uninstall(detail)}
          onToggleEnabled={(enabled) =>
            void setPluginEnabled(detail, enabled)
          }
        />
      )}

      {/* Marketplace browse drawer. */}
      {browsing && (
        <MarketplaceBrowseDrawer
          state={browsing}
          installedNames={installedNames}
          installingKey={installingKey}
          onClose={() => setBrowsing(null)}
          onInstall={(plugin) =>
            void installFromCatalog(browsing.marketplace, plugin)
          }
          onUninstall={(name) => {
            const p = installed.find((ip) => ip.manifest.name === name);
            if (p) void uninstall(p);
          }}
        />
      )}
    </div>
  );
}

// ─── Cards ───────────────────────────────────────────────────────

function InstalledPluginCard({
  plugin,
  onOpen,
}: {
  plugin: InstalledPlugin;
  onOpen: () => void;
}): JSX.Element {
  const title = plugin.manifest.displayName ?? plugin.manifest.name;
  return (
    <div
      className={
        'plugins-card plugins-installed-card' +
        (plugin.enabled ? '' : ' plugins-installed-card-disabled')
      }
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="plugins-card-head">
        <div className="plugins-card-title">{title}</div>
        {plugin.manifest.version && (
          <span className="plugins-card-version">
            v{plugin.manifest.version}
          </span>
        )}
        {!plugin.enabled && (
          <span
            className="plugins-card-disabled-pill"
            title="Plugin is installed but disabled. Click to open and re-enable."
          >
            Disabled
          </span>
        )}
      </div>
      {plugin.manifest.description && (
        <p className="plugins-card-desc">{plugin.manifest.description}</p>
      )}
      <div className="plugins-card-meta">
        <span className="plugins-card-author">
          {plugin.manifest.author ?? 'Unknown author'}
        </span>
        <span className="plugins-card-contributes">
          {pluginContributesSummary(plugin)}
        </span>
      </div>
    </div>
  );
}

function MarketplaceCard({
  marketplace,
  onBrowse,
  onRemove,
}: {
  marketplace: Marketplace;
  onBrowse: () => void;
  onRemove: () => void;
}): JSX.Element {
  return (
    <div className="plugins-card plugins-marketplace-card">
      <div className="plugins-card-head">
        <div className="plugins-card-title">{marketplace.name}</div>
      </div>
      {marketplace.description && (
        <p className="plugins-card-desc">{marketplace.description}</p>
      )}
      <div className="plugins-card-source">
        <code>{marketplace.source}</code>
      </div>
      <div className="plugins-card-foot plugins-marketplace-foot">
        <button
          type="button"
          className="primary small"
          onClick={onBrowse}
        >
          Browse
        </button>
        <button
          type="button"
          className="danger small plugins-marketplace-remove"
          onClick={onRemove}
        >
          Remove
        </button>
      </div>
    </div>
  );
}

// ─── Recommended marketplaces rail (right column) ────────────────

function RecommendedMarketplacesRail({
  addedSources,
  onAdd,
}: {
  addedSources: Set<string>;
  onAdd: (rm: RecommendedMarketplace) => void;
}): JSX.Element {
  return (
    <div className="recommended-marketplaces-block">
      <div className="recommended-marketplaces-head">
        <h3 className="recommended-marketplaces-title">
          Recommended marketplaces
        </h3>
        <span className="recommended-marketplaces-sub">
          Hand-picked starting points. Click to add to your list.
        </span>
      </div>
      <div className="recommended-marketplaces-rail">
        {RECOMMENDED_MARKETPLACES.map((rm) => {
          const added = addedSources.has(rm.source);
          return (
            <div className="recommended-marketplace-card" key={rm.id}>
              <div className="recommended-marketplace-head">
                <span className="recommended-marketplace-emoji" aria-hidden>
                  {rm.emoji}
                </span>
                <div className="recommended-marketplace-titles">
                  <div className="recommended-marketplace-name">
                    {rm.name}
                  </div>
                  <div className="recommended-marketplace-author">
                    {rm.author}
                  </div>
                </div>
              </div>
              <p className="recommended-marketplace-desc">{rm.description}</p>
              <div className="recommended-marketplace-foot">
                {added ? (
                  <span
                    className="recommended-marketplace-added"
                    title="Already in your marketplaces list"
                  >
                    ✓ Added
                  </span>
                ) : (
                  <button
                    type="button"
                    className="primary small"
                    onClick={() => onAdd(rm)}
                  >
                    Add
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Marketplace browse drawer ───────────────────────────────────
// Right-side panel that slides in/out with the same recipe used by
// EditorModal's skill drawer — double-RAF on mount to flip the
// `.open` class so CSS transitions kick in, 260ms close delay so
// the slide-out completes before the component unmounts.

function MarketplaceBrowseDrawer({
  state,
  installedNames,
  installingKey,
  onClose,
  onInstall,
  onUninstall,
}: {
  state: {
    marketplace: Marketplace;
    catalog: MarketplaceCatalog | null;
    loading: boolean;
    error?: string;
  };
  installedNames: Set<string>;
  installingKey: string | null;
  onClose: () => void;
  onInstall: (plugin: MarketplacePluginEntry) => void;
  onUninstall: (name: string) => void;
}): JSX.Element {
  const { marketplace, catalog, loading, error } = state;
  // `isOpen` drives the `.open` class. On mount we flip it to true
  // after two requestAnimationFrame ticks so CSS sees a paint at
  // `translateX(100%)` before the `translateX(0)` flip — without
  // the double-RAF React 18 batches both into one paint and the
  // slide-in is invisible.
  const [isOpen, setIsOpen] = useState(false);
  useEffect(() => {
    let raf2: number | null = null;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setIsOpen(true));
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 !== null) cancelAnimationFrame(raf2);
    };
  }, []);
  // Animated close: clear `.open` for the slide-out, then call the
  // parent's `onClose` after the transition duration so React
  // unmounts the component cleanly.
  const requestClose = () => {
    setIsOpen(false);
    setTimeout(onClose, 260);
  };
  // Esc key also closes the drawer (matches the rest of the modal
  // dismissal conventions in this codebase).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') requestClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const openMod = isOpen ? ' open' : '';
  return (
    <div
      className={`modal-backdrop modal-backdrop-drawer${openMod}`}
      onClick={requestClose}
    >
      <div
        className={`modal modal-drawer plugins-browse-drawer${openMod}`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${marketplace.name} catalog`}
      >
        <div className="modal-head">
          <div>
            <h3>{marketplace.name}</h3>
            <div className="plugins-browse-source">
              <code>{marketplace.source}</code>
            </div>
          </div>
          <button
            type="button"
            className="ghost small"
            onClick={requestClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="modal-body plugins-browse-body">
          {loading && (
            <div className="settings-empty">Fetching catalog…</div>
          )}
          {!loading && error && (
            <div className="modal-error">{error}</div>
          )}
          {!loading && catalog && catalog.plugins.length === 0 && (
            <div className="settings-empty">
              This marketplace doesn&rsquo;t list any plugins yet.
            </div>
          )}
          {!loading && catalog && catalog.plugins.length > 0 && (
            <div className="plugins-catalog-list">
              {catalog.plugins.map((plugin) => {
                const installed = installedNames.has(plugin.name);
                const key = `${marketplace.source}|${plugin.name}`;
                const installing = installingKey === key;
                return (
                  <div className="plugins-catalog-row" key={plugin.name}>
                    <div className="plugins-catalog-titles">
                      <div className="plugins-catalog-name">
                        {plugin.name}
                        {plugin.version && (
                          <span className="plugins-catalog-version">
                            v{plugin.version}
                          </span>
                        )}
                      </div>
                      {plugin.description && (
                        <div className="plugins-catalog-desc">
                          {plugin.description}
                        </div>
                      )}
                      <div className="plugins-catalog-meta">
                        {plugin.author && (
                          <span>{plugin.author}</span>
                        )}
                        {plugin.license && (
                          <span>· {plugin.license}</span>
                        )}
                        {plugin.homepage && (
                          <a
                            href={plugin.homepage}
                            target="_blank"
                            rel="noreferrer noopener"
                          >
                            View source →
                          </a>
                        )}
                      </div>
                    </div>
                    <div className="plugins-catalog-actions">
                      {installed ? (
                        <>
                          <span className="plugins-catalog-installed">
                            ✓ Installed
                          </span>
                          <button
                            type="button"
                            className="danger small plugins-catalog-uninstall"
                            onClick={() => onUninstall(plugin.name)}
                          >
                            Uninstall
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="primary small"
                          onClick={() => onInstall(plugin)}
                          disabled={installing}
                        >
                          {installing ? 'Installing…' : 'Install'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Installed plugin detail modal ───────────────────────────────

function PluginDetailModal({
  plugin,
  onClose,
  onUninstall,
  onToggleEnabled,
}: {
  plugin: InstalledPlugin;
  onClose: () => void;
  onUninstall: () => void;
  onToggleEnabled: (enabled: boolean) => void;
}): JSX.Element {
  const m = plugin.manifest;
  const installedFromInzone =
    typeof plugin.installedAt === 'number' && !!plugin.source;
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal plugin-detail-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={`${m.displayName ?? m.name} details`}
      >
        <div className="modal-head">
          <div>
            <h3>{m.displayName ?? m.name}</h3>
            <div className="plugin-detail-meta">
              {m.version && <span>v{m.version}</span>}
              {m.license && <span>· {m.license}</span>}
              {m.author && <span>· {m.author}</span>}
            </div>
          </div>
          <button
            type="button"
            className="ghost small"
            onClick={onClose}
            aria-label="Close"
          >
            ✕
          </button>
        </div>
        <div className="modal-body">
          {m.description && (
            <p className="plugin-detail-desc">{m.description}</p>
          )}
          {/* Enable/Disable toggle. Plugin contributions only flow
              into the rest of the app while enabled — this is the
              user's "park this plugin" lever short of uninstalling.
              Mirrors to Claude Code's settings.json so the CLI
              picks up the same state. */}
          <div className="plugin-detail-toggle">
            <div className="plugin-detail-toggle-text">
              <strong>
                {plugin.enabled ? 'Enabled' : 'Disabled'}
              </strong>
              <div className="plugin-detail-toggle-hint">
                {plugin.enabled
                  ? 'Agents, skills, slash commands, and MCP servers from this plugin are active across Inzone.'
                  : 'Plugin contents are paused — they remain on disk but won’t appear in the other Settings tabs or the composer until re-enabled.'}
              </div>
            </div>
            <label className="plugin-detail-toggle-switch">
              <input
                type="checkbox"
                checked={plugin.enabled}
                onChange={(e) => onToggleEnabled(e.target.checked)}
                aria-label={
                  plugin.enabled ? 'Disable plugin' : 'Enable plugin'
                }
              />
              <span className="plugin-detail-toggle-knob" aria-hidden />
            </label>
          </div>
          <div className="plugin-detail-contributes">
            <h4>Contributes</h4>
            <ul>
              <li>
                {plugin.contributes.agents} agent
                {plugin.contributes.agents === 1 ? '' : 's'}
              </li>
              <li>
                {plugin.contributes.skills} skill
                {plugin.contributes.skills === 1 ? '' : 's'}
              </li>
              <li>
                {plugin.contributes.commands} slash command
                {plugin.contributes.commands === 1 ? '' : 's'}
              </li>
              <li>
                {plugin.contributes.mcpServers} MCP server
                {plugin.contributes.mcpServers === 1 ? '' : 's'}
              </li>
              {plugin.contributes.hooks > 0 && (
                <li>
                  {plugin.contributes.hooks} hook
                  {plugin.contributes.hooks === 1 ? '' : 's'}
                </li>
              )}
            </ul>
          </div>
          <div className="plugin-detail-path">
            <h4>Install location</h4>
            <code>{plugin.installPath}</code>
            {installedFromInzone ? (
              <div className="plugin-detail-source-line">
                Installed from <code>{plugin.source}</code> on{' '}
                {new Date(plugin.installedAt!).toLocaleString()}
              </div>
            ) : (
              <div className="plugin-detail-source-line plugin-detail-source-discovered">
                Discovered on disk (not installed via INZONE).
              </div>
            )}
          </div>
          {m.homepage && (
            <div className="plugin-detail-homepage">
              <a
                href={m.homepage}
                target="_blank"
                rel="noreferrer noopener"
              >
                View source →
              </a>
            </div>
          )}
        </div>
        <div className="modal-foot">
          <button type="button" className="ghost" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="danger"
            onClick={onUninstall}
          >
            Uninstall
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────────

function pluginContributesSummary(plugin: InstalledPlugin): string {
  const parts: string[] = [];
  const c = plugin.contributes;
  if (c.agents) parts.push(`${c.agents} agent${c.agents === 1 ? '' : 's'}`);
  if (c.skills) parts.push(`${c.skills} skill${c.skills === 1 ? '' : 's'}`);
  if (c.commands)
    parts.push(`${c.commands} command${c.commands === 1 ? '' : 's'}`);
  if (c.mcpServers)
    parts.push(`${c.mcpServers} MCP${c.mcpServers === 1 ? '' : 's'}`);
  if (c.hooks) parts.push(`${c.hooks} hook${c.hooks === 1 ? '' : 's'}`);
  return parts.length > 0 ? parts.join(' · ') : 'No content detected';
}

// Markdown is unused in the v1 detail modal but the import is kept
// so future versions can render plugin READMEs without re-plumbing.
void Markdown;
