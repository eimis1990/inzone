import { useCallback, useEffect, useMemo, useState } from 'react';
import { getPaneDisplayName, useStore } from '../store';
import type { WikiPageMeta, WikiStatus } from '@shared/types';
import { Tooltip } from './Tooltip';

/**
 * The ingest prompt we drop into the active agent when the user
 * clicks "Scan project". Designed to be a single, self-contained
 * instruction the agent can act on without further context — it
 * references the schema (which is already on disk after init), tells
 * the agent which files to read, and is explicit about which pages
 * to update.
 *
 * We keep this static (no project-specific values baked in) so the
 * prompt itself reads like a clean handoff. The agent does the
 * project-specific work — reading actual files in the cwd — when it
 * runs.
 */
const SCAN_PROMPT = `Run an initial wiki ingest for this project.
Treat \`.inzone/wiki/wiki-schema.md\` as your operating contract — read it first.

Steps:
1. Read \`.inzone/wiki/wiki-schema.md\` end to end. Follow its conventions.
2. Survey the project: \`README.md\`, top-level config (package.json / Cargo.toml / pyproject.toml / go.mod / Gemfile / etc.), and the top two levels of the source tree. Skim 5–10 representative source files.
3. Update the starter pages with grounded, concrete content:
   • \`architecture.md\` — what the major modules are, how they fit together, where the boundaries are. Include a Sources section citing the files you read.
   • \`glossary.md\` — project-specific terms, internal names, domain concepts you encountered.
   • \`gotchas.md\` — surprises, non-obvious patterns, things a new contributor would trip on.
   • \`index.md\` — refresh the curated table of contents to match what now exists.
4. If you noticed a meaningful architectural decision worth recording, drop a file under \`decisions/\` using the ADR template from the schema.
5. Append a single \`## [YYYY-MM-DD] ingest | initial scan\` entry to \`log.md\` listing every page you touched.

Keep prose tight. No filler. Cross-link pages with \`[[wikilink]]\` syntax. Cite real file paths in Sources sections. Don't invent details — if something isn't in the code, leave it for a future ingest.`;

/**
 * Lint prompt — kicked off after the wiki has had a real ingest.
 * Walks every page, checks each Sources section against actual cited
 * files, flags stale / orphan / broken-wikilink pages, and appends a
 * single `## [YYYY-MM-DD] lint | <summary>` entry to log.md. The
 * agent does ALL the work — we don't try to crawl the wiki ourselves
 * because the LLM is far better at judging "still accurate?" than a
 * regex over file mtimes.
 *
 * Mirrors SCAN_PROMPT's structure on purpose so the two operations
 * read as a familiar pair: scan ingests, lint audits.
 */
const LINT_PROMPT = `Lint the project wiki — audit every page and report what needs attention.
Treat \`.inzone/wiki/wiki-schema.md\` as your operating contract — read it first if you haven't already this session.

Steps:
1. List every \`.md\` page under \`.inzone/wiki/\` (skip \`.cache/\` and \`wiki-schema.md\`).
2. For each content page, read it and check:
   • **Stale**: any file cited in the page's \`## Sources\` section that's been modified since the page was last written. (Use \`git log -1 --format=%ci <file>\` or \`stat\`.)
   • **Broken wikilinks**: every \`[[target]]\` in the page must resolve to an existing wiki page.
   • **Orphans**: pages with NO incoming wikilinks from anywhere else in the wiki (except \`index.md\` and \`log.md\`, which are top-level by design).
   • **Missing Sources**: content pages without a \`## Sources\` section, or with an empty one (excluding \`index.md\` and \`log.md\`).
   • **Contradictions**: claims in two different pages that disagree. Flag with both page paths.
3. Update \`index.md\` if the page tree has drifted from what's listed there.
4. Append ONE \`## [YYYY-MM-DD] lint | <short summary>\` entry to \`log.md\` listing each finding under categorised sub-bullets (Stale / Broken / Orphans / Missing Sources / Contradictions). For each finding include the page path and a one-line note.

Don't fix the issues yet — this pass is read-only audit. The user reviews the lint entry and asks for fixes if they want them. Don't invent findings; if a category is clean, write "none" under it.`;

/**
 * Sidebar content for the Wiki tab. Three states:
 *
 *   1. No project open       → onboarding hint
 *   2. Project open, wiki not initialized → "Initialize wiki" CTA
 *   3. Wiki initialized       → search + page tree
 *
 * Click any page to open the WikiPageModal (full-screen markdown
 * viewer with [[wikilink]] navigation). The modal mounts here so it
 * can read its content via the same renderer state — when we reach
 * Phase 3 (auto-ingest after agent turns), the cache will be added
 * to the Zustand store and modal will flow through that.
 *
 * Phase 2 scope: read-only browsing. Editing pages happens via the
 * filesystem or via agents — there's no in-INZONE markdown editor
 * yet. (That's Phase 3 territory if we decide we want it.)
 */
export function WikiSection() {
  const cwd = useStore((s) => s.cwd);
  const activePaneId = useStore((s) => s.activePaneId);
  const leadPaneId = useStore((s) => s.leadPaneId);
  const windowMode = useStore((s) => s.windowMode);
  const seedPaneInput = useStore((s) => s.seedPaneInput);
  const [status, setStatus] = useState<WikiStatus | null>(null);
  const [pages, setPages] = useState<WikiPageMeta[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Wiki page open-state lives in the store now so the WikiPagePane
  // can mount inside the pane area (`.pane-preview-stack`) instead of
  // a portaled full-screen modal. We still read+write it here for the
  // sidebar's click handler and the active-row highlight.
  const viewingPath = useStore((s) => s.wikiPagePath);
  const setViewingPath = useStore((s) => s.setWikiPagePath);
  // Brief one-shot acknowledgement after the user kicks off a scan.
  // We swap it for the regular toolbar after a couple seconds so the
  // sidebar doesn't accumulate stale chrome.
  const [scanNote, setScanNote] = useState<string | null>(null);

  /** Re-fetch wiki status + page list. Called on mount, on cwd
   *  change, and after init / explicit refresh. */
  const refresh = useCallback(async () => {
    if (!cwd) {
      setStatus(null);
      setPages([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const s = await window.cowork.wiki.status(cwd);
      setStatus(s);
      if (s.initialized) {
        const p = await window.cowork.wiki.listPages(cwd);
        setPages(p);
      } else {
        setPages([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [cwd]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // WikiPagePane (rendered by App.tsx inside the pane area) fires
  // `inzone:wiki-page-saved` after a successful save so the sidebar's
  // dashboard (last-updated / page count / recent entries) refreshes
  // without us threading a callback through the mount.
  useEffect(() => {
    const handler = () => void refresh();
    window.addEventListener('inzone:wiki-page-saved', handler);
    return () => window.removeEventListener('inzone:wiki-page-saved', handler);
  }, [refresh]);

  const init = useCallback(async () => {
    if (!cwd || busy) return;
    setBusy(true);
    setError(null);
    try {
      await window.cowork.wiki.init(cwd);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [cwd, busy, refresh]);

  /**
   * Shared seed-into-agent helper used by both Scan and Lint. We don't
   * run an LLM call directly from the wiki layer (no API plumbing
   * here) — instead we leverage the agent panes the user already has
   * set up, which keeps these features cheap to land and lets the
   * user oversee what gets written.
   *
   * Target pane priority:
   *   1. The Lead pane when in Lead mode (it's the orchestrator —
   *      the right venue for project-wide work).
   *   2. The active pane when in Multi mode.
   *   3. Clipboard fallback when there's no agent pane to seed —
   *      the user can paste it into whichever agent / external CLI
   *      they prefer.
   *
   * After seeding we leave the prompt in the composer; the user
   * still hits send themselves, so they get one last review before
   * the agent goes off and edits files.
   */
  const seedAgentPrompt = useCallback(
    async (prompt: string, label: string) => {
      // Always prefer whichever pane is currently focused — that's
      // where the user's mental model says "send my action here". In
      // Lead mode, fall back to the Lead pane only when nothing is
      // focused (e.g. they just opened the project). In Multi mode
      // with no focus, fall back to the clipboard so the prompt
      // isn't lost.
      const target =
        activePaneId ?? (windowMode === 'lead' ? leadPaneId : null);
      if (target) {
        seedPaneInput(target, prompt);
        // Look up the pane's display name so the confirmation note
        // tells the user exactly where the prompt landed. Avoids the
        // "where did that go?" confusion the user flagged when the
        // prompt seems to disappear into the ether.
        const state = useStore.getState();
        const lead = state.leadPaneId
          ? { paneId: state.leadPaneId }
          : null;
        const { name } = getPaneDisplayName(state.tree, target, lead);
        const agent = state.panes[target]?.agentName;
        const display = agent ? `${name} (${agent})` : name;
        setScanNote(`${label} prompt sent to ${display} — review and run.`);
      } else {
        try {
          await navigator.clipboard.writeText(prompt);
          setScanNote(
            `No focused agent — ${label.toLowerCase()} prompt copied. Paste it into any agent pane.`,
          );
        } catch {
          setScanNote(
            `No focused agent. Click into one, then click ${label} again.`,
          );
        }
      }
      // Clear the note after a short window so the toolbar doesn't
      // stay puffed up with stale state.
      window.setTimeout(() => setScanNote(null), 4500);
    },
    [windowMode, leadPaneId, activePaneId, seedPaneInput],
  );

  const handleScan = useCallback(
    () => seedAgentPrompt(SCAN_PROMPT, 'Scan'),
    [seedAgentPrompt],
  );
  const handleLint = useCallback(
    () => seedAgentPrompt(LINT_PROMPT, 'Lint'),
    [seedAgentPrompt],
  );

  // Filter + group: matches by both filename and folder path.
  const groups = useMemo(() => groupPages(pages, query), [pages, query]);

  // ── Render branches ─────────────────────────────────────────────

  if (!cwd) {
    return (
      <div className="wiki-onboard">
        <h3 className="wiki-onboard-title">Project wiki</h3>
        <p className="wiki-onboard-body">
          Open a project folder to use the wiki — it lives at{' '}
          <code>.inzone/wiki/</code> inside the project.
        </p>
      </div>
    );
  }

  if (loading && !status) {
    return <div className="wiki-loading">Checking wiki status…</div>;
  }

  if (status && !status.initialized) {
    return (
      <div className="wiki-onboard">
        <h3 className="wiki-onboard-title">Project wiki</h3>
        <p className="wiki-onboard-body">
          A persistent, LLM-maintained knowledge base for this project.
          Agents read it for grounded context and update it as they
          learn the codebase. Lives in <code>.inzone/wiki/</code>{' '}
          and gets committed to git so the team shares it.
        </p>
        <p className="wiki-onboard-hint">
          Will be created at:
          <br />
          <code className="wiki-onboard-path">{shortenRoot(status.rootPath)}</code>
        </p>
        {error && <div className="wiki-error">{error}</div>}
        <button
          type="button"
          className="wiki-init-btn"
          onClick={() => void init()}
          disabled={busy}
        >
          {busy ? 'Initializing…' : 'Initialize wiki'}
        </button>
      </div>
    );
  }

  // Initialized — show the page tree.
  return (
    <div className="wiki-section">
      <div className="wiki-toolbar">
        <input
          type="text"
          className="wiki-search"
          placeholder="Filter pages…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
        <button
          type="button"
          className="wiki-refresh-btn"
          onClick={() => void refresh()}
          disabled={loading}
          title="Reload the page list from disk. Doesn't run an agent — just re-reads .inzone/wiki/."
          aria-label="Reload page list"
        >
          {loading ? '…' : '⟳'}
        </button>
      </div>

      {status && status.hasIngested && (
        <WikiDashStrip status={status} />
      )}

      {/* Scan project — prominent CTA shown ONLY before the wiki has
          had a real ingest. Once an agent has populated the wiki at
          least once (status.hasIngested), inline auto-update from
          subsequent agent turns keeps things current and the big
          button becomes redundant chrome. After that point Scan
          lives as a small "Re-scan" link in the footer for the rare
          case someone wants to force a fresh full re-survey.

          Markup intentionally mirrors the "+ Create Agent" CTA in
          the Workers tab (sidebar-create-card-wrap → sessions-new-card
          → sessions-new-btn) so the two sidebar tabs share an
          identical primary-action affordance. Update those classes
          and this button updates with them. */}
      {status && !status.hasIngested && (
        <div className="sidebar-create-card-wrap">
          <div className="sessions-new-card">
            <button
              type="button"
              className="sessions-new-btn"
              onClick={() => void handleScan()}
              title="Send a wiki-ingest prompt to the active agent so it can populate the starter pages from the project source"
            >
              ✦ Scan project
            </button>
          </div>
        </div>
      )}
      {scanNote && <div className="wiki-scan-note">{scanNote}</div>}

      {error && <div className="wiki-error">{error}</div>}

      {pages.length === 0 ? (
        <div className="wiki-empty">
          No pages yet. The starter scaffold should have created a few
          on init — try Refresh.
        </div>
      ) : groups.length === 0 ? (
        <div className="wiki-empty">No pages match "{query}".</div>
      ) : (
        <div className="wiki-tree">
          {groups.map((g) => (
            <div key={g.folder || '__root__'} className="wiki-folder">
              {g.folder && (
                <div className="wiki-folder-name">{g.folder}/</div>
              )}
              {g.items.map((p) => (
                <button
                  key={p.path}
                  type="button"
                  className={
                    'wiki-page-row' +
                    (p.isSchema ? ' wiki-page-schema' : '') +
                    (viewingPath === p.path ? ' active' : '')
                  }
                  onClick={() => setViewingPath(p.path)}
                  title={p.path}
                >
                  <span className="wiki-page-name">
                    {prettyName(p)}
                  </span>
                  <span className="wiki-page-meta">{formatBytes(p.bytes)}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="wiki-foot">
        {status && status.lastUpdatedAt && (
          <span className="wiki-foot-meta">
            Last updated {formatRelative(Date.parse(status.lastUpdatedAt))}
          </span>
        )}
        {/* Post-first-ingest affordances. Lint audits page health
            (stale Sources cites, orphans, broken wikilinks) — useful
            periodically; agents won't volunteer a lint pass on their
            own. Re-scan is the escape hatch for "schema changed,
            redo the whole survey" — rare but worth keeping reachable. */}
        {status && status.hasIngested && (
          <span className="wiki-foot-actions">
            <Tooltip text="Audit page health — checks Sources cites against actual files, flags stale / orphan / broken-wikilink pages. Sends an LLM prompt to the focused agent pane; findings land in log.md. Read-only — no fixes applied automatically.">
              <button
                type="button"
                className="wiki-foot-link"
                onClick={() => void handleLint()}
              >
                Lint
              </button>
            </Tooltip>
            <span className="wiki-foot-sep" aria-hidden>
              ·
            </span>
            <Tooltip text="Re-run the full project survey — the agent re-reads README + config + source and rewrites the wiki pages. Sends an LLM prompt to the focused agent pane. Different from the ⟳ button up top, which just re-reads the disk.">
              <button
                type="button"
                className="wiki-foot-link"
                onClick={() => void handleScan()}
              >
                Re-scan
              </button>
            </Tooltip>
          </span>
        )}
      </div>

      {/* WikiPagePane is mounted by App.tsx inside `.pane-preview-stack`
          so the page renders in the pane area (same frame chrome as
          pane-host) instead of as a portaled full-screen modal. The
          `viewingPath` state above is now read from / written to the
          store so App.tsx can react to selection changes. */}
    </div>
  );
}

// ── Dashboard ──────────────────────────────────────────────────────

/**
 * One-line activity strip that sits between the toolbar and the page
 * tree once the wiki has had a real ingest. Shows page count, time
 * since last ingest, and recent-edit count. Click to expand a panel
 * listing the last few log entries — the same data the agent would
 * see in `log.md` when deciding what's already been recorded.
 *
 * Quiet by default. We don't need a chart or a growth metric; the
 * goal is just "is the wiki alive?" at a glance.
 */
function WikiDashStrip({ status }: { status: WikiStatus }) {
  const [expanded, setExpanded] = useState(false);
  const recentEdits = status.recentEntries.filter(
    (e) => e.type === 'edit',
  ).length;

  const lastIngestLabel = status.lastIngestAt
    ? formatDateRelative(status.lastIngestAt)
    : '—';

  return (
    <div className={'wiki-dash' + (expanded ? ' expanded' : '')}>
      <button
        type="button"
        className="wiki-dash-strip"
        onClick={() => setExpanded((v) => !v)}
        title={
          expanded
            ? 'Hide recent activity'
            : 'Show recent activity from log.md'
        }
        aria-expanded={expanded}
      >
        <span className="wiki-dash-stat">
          <strong>{status.pageCount}</strong>{' '}
          {status.pageCount === 1 ? 'page' : 'pages'}
        </span>
        <span className="wiki-dash-sep" aria-hidden>
          ·
        </span>
        <span className="wiki-dash-stat">
          last ingest <strong>{lastIngestLabel}</strong>
        </span>
        {recentEdits > 0 && (
          <>
            <span className="wiki-dash-sep" aria-hidden>
              ·
            </span>
            <span className="wiki-dash-stat">
              <strong>{recentEdits}</strong> recent{' '}
              {recentEdits === 1 ? 'edit' : 'edits'}
            </span>
          </>
        )}
        <span className="wiki-dash-spacer" />
        <span
          className={
            'wiki-dash-chevron' + (expanded ? ' open' : '')
          }
          aria-hidden
        >
          <svg width="9" height="9" viewBox="0 0 24 24" fill="none">
            <polyline
              points="6 9 12 15 18 9"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>
      {expanded && (
        <div className="wiki-dash-panel">
          {status.recentEntries.length === 0 ? (
            <div className="wiki-dash-empty">
              No log entries yet.
            </div>
          ) : (
            <ul className="wiki-dash-entries">
              {status.recentEntries.map((entry, i) => (
                <li
                  key={`${entry.date}-${entry.type}-${i}`}
                  className="wiki-dash-entry"
                >
                  <span
                    className={
                      'wiki-dash-entry-type wiki-dash-entry-type-' +
                      entry.type
                    }
                  >
                    {entry.type}
                  </span>
                  <span className="wiki-dash-entry-title">
                    {entry.title || '(untitled)'}
                  </span>
                  <span className="wiki-dash-entry-date">
                    {formatDateRelative(entry.date)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/** Format a YYYY-MM-DD date string as "today", "yesterday", "3d ago",
 *  or — if it's older than a week — the date itself. We don't have a
 *  time component (log entries are date-granular per the schema), so
 *  intra-day comparisons aren't possible; "today" is good enough. */
function formatDateRelative(date: string): string {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return date || '—';
  const then = Date.parse(date + 'T00:00:00Z');
  if (isNaN(then)) return date;
  // Compare days at UTC midnight to avoid TZ-edge weirdness.
  const todayUtc = Date.parse(
    new Date().toISOString().slice(0, 10) + 'T00:00:00Z',
  );
  const dayMs = 86_400_000;
  const days = Math.round((todayUtc - then) / dayMs);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  return date;
}

// ── Helpers ────────────────────────────────────────────────────────

interface PageGroup {
  /** Empty string for root-level pages. */
  folder: string;
  items: WikiPageMeta[];
}

/**
 * Group pages by their first-level folder. Root-level pages (no
 * slash in path) come first in their own group; then folder groups
 * alphabetically. Within each group, pages are alphabetical.
 *
 * The query filter matches against the full path (so "decis" finds
 * "decisions/api-versioning.md") AND the filename — generous so it
 * feels responsive.
 */
function groupPages(pages: WikiPageMeta[], query: string): PageGroup[] {
  const q = query.trim().toLowerCase();
  const filtered = q
    ? pages.filter((p) => p.path.toLowerCase().includes(q))
    : pages;

  const buckets = new Map<string, WikiPageMeta[]>();
  for (const p of filtered) {
    const slash = p.path.indexOf('/');
    const folder = slash >= 0 ? p.path.slice(0, slash) : '';
    const list = buckets.get(folder) ?? [];
    list.push(p);
    buckets.set(folder, list);
  }
  for (const list of buckets.values()) {
    list.sort((a, b) => a.path.localeCompare(b.path));
  }
  // Root group first; folders alphabetical.
  const folders = Array.from(buckets.keys()).filter(Boolean).sort();
  const out: PageGroup[] = [];
  if (buckets.has('')) out.push({ folder: '', items: buckets.get('')! });
  for (const f of folders) out.push({ folder: f, items: buckets.get(f)! });
  return out;
}

/** Drop the trailing .md and the folder prefix; "decisions/api-versioning.md"
 *  becomes "api-versioning". The folder header above the row provides
 *  the namespace. */
function prettyName(p: WikiPageMeta): string {
  const base = p.name.replace(/\.md$/i, '');
  return base;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function formatRelative(ts: number): string {
  if (!ts || isNaN(ts)) return '';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}

/** Trim home prefix from a wiki root path so the onboard text reads
 *  "~/Projects/foo/.inzone/wiki" instead of the full /Users path. */
function shortenRoot(p: string): string {
  // Best-effort home detection. The renderer doesn't have process.env.HOME
  // so we just look for a /Users/ or /home/ prefix and drop the username.
  const m = p.match(/^(\/Users\/[^/]+|\/home\/[^/]+)(\/.*)$/);
  if (m) return '~' + m[2];
  return p;
}
