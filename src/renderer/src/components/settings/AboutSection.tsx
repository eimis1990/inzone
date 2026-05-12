import { useEffect, useState } from 'react';
import type {
  ReleaseEntry,
  UpdateCheckResult,
} from '@shared/types';

/**
 * Settings → About page.
 *
 * Three jobs:
 *  1. Show what version is running, with a polished hero card.
 *  2. Let the user trigger a manual update check that delegates to
 *     electron-updater (so a found update lands at the same Restart
 *     now/Later dialog as the background poll).
 *  3. Render the full CHANGELOG (up to 100 entries) as collapsible
 *     release notes — Added/Changed/Fixed sections with bullets
 *     parsed server-side from the same markdown the project ships.
 *     Only the most recent release is auto-expanded; the rest are
 *     click-to-expand so a long history doesn't dominate the page.
 */
export function AboutSection() {
  const [version, setVersion] = useState<string>('—');
  const [check, setCheck] = useState<UpdateCheckResult | null>(null);
  const [checking, setChecking] = useState(false);
  const [notes, setNotes] = useState<ReleaseEntry[] | null>(null);
  const [openVersion, setOpenVersion] = useState<string | null>(null);

  // Eagerly load version + release notes when the section mounts.
  // The version is constant so it's safe to fetch once; release notes
  // are tiny and re-fetched on mount in case the user updated and
  // CHANGELOG advanced since they last opened this page.
  useEffect(() => {
    void window.cowork.about.version().then(setVersion).catch(() => {
      setVersion('unknown');
    });
    // Pull the full changelog (server-side cap is 100). Was 5 in
    // v1.13 — users wanted to scroll back further than the last
    // handful of releases. The list is collapsed by default
    // (except the most recent) so the page doesn't become a wall
    // of bullets on first open.
    void window.cowork.about
      .releaseNotes({ limit: 100 })
      .then((entries) => {
        setNotes(entries);
        // Default to expanding the most recent entry — gives the
        // page something to read instead of a wall of collapsed
        // headers on first open.
        if (entries.length > 0) setOpenVersion(entries[0].version);
      })
      .catch(() => setNotes([]));
  }, []);

  const onCheck = async () => {
    setChecking(true);
    setCheck(null);
    try {
      const result = await window.cowork.about.checkForUpdates();
      setCheck(result);
    } catch (err) {
      setCheck({
        status: 'error',
        currentVersion: version,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="settings-pane about-pane">
      <div className="settings-pane-header">
        <h2>About INZONE</h2>
        <p className="settings-pane-sub">
          Version, updates, and recent release notes.
        </p>
      </div>

      <div className="settings-pane-body">
        <section className="about-hero">
          <div className="about-hero-meta">
            <div className="about-hero-name">INZONE</div>
            <div className="about-hero-version">v{version}</div>
          </div>
          <div className="about-hero-actions">
            <button
              type="button"
              className="generate-btn"
              onClick={onCheck}
              disabled={checking}
            >
              {checking ? (
                <>
                  <span className="btn-spinner" aria-hidden /> Checking…
                </>
              ) : (
                <>↻ Check for updates</>
              )}
            </button>
            {check && <UpdateStatusLine check={check} />}
          </div>
        </section>

        <section className="about-section">
          <div className="about-section-title">
            Release history
            {notes && notes.length > 0 && (
              <span className="about-section-count">
                {notes.length}
              </span>
            )}
          </div>
          {notes === null && (
            <div className="about-empty">Loading release notes…</div>
          )}
          {notes && notes.length === 0 && (
            <div className="about-empty">
              No release notes available — CHANGELOG.md is missing or
              empty in this build.
            </div>
          )}
          {notes && notes.length > 0 && (
            <ul className="about-release-list">
              {notes.map((entry) => (
                <ReleaseCard
                  key={entry.version}
                  entry={entry}
                  isCurrent={entry.version === version}
                  expanded={openVersion === entry.version}
                  onToggle={() =>
                    setOpenVersion((cur) =>
                      cur === entry.version ? null : entry.version,
                    )
                  }
                />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function UpdateStatusLine({ check }: { check: UpdateCheckResult }) {
  if (check.devMode) {
    return (
      <span className="about-status about-status-info">
        Updates disabled in dev mode
      </span>
    );
  }
  switch (check.status) {
    case 'current':
      return (
        <span className="about-status about-status-ok">
          You're up to date
        </span>
      );
    case 'available':
      return (
        <span className="about-status about-status-available">
          v{check.latestVersion} is available — downloading…
        </span>
      );
    case 'downloading':
      return (
        <span className="about-status about-status-info">
          Downloading update…
        </span>
      );
    case 'ready':
      return (
        <span className="about-status about-status-available">
          v{check.latestVersion} is ready to install — restart to apply
        </span>
      );
    case 'error':
      return (
        <span className="about-status about-status-error">
          Couldn't check: {check.error ?? 'unknown error'}
        </span>
      );
    default:
      return null;
  }
}

interface ReleaseCardProps {
  entry: ReleaseEntry;
  isCurrent: boolean;
  expanded: boolean;
  onToggle: () => void;
}

function ReleaseCard({
  entry,
  isCurrent,
  expanded,
  onToggle,
}: ReleaseCardProps) {
  return (
    <li
      className={
        'about-release' +
        (expanded ? ' expanded' : '') +
        (isCurrent ? ' current' : '')
      }
    >
      <button
        type="button"
        className="about-release-header"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="about-release-version">v{entry.version}</span>
        {entry.date && (
          <span className="about-release-date">{entry.date}</span>
        )}
        {isCurrent && (
          <span className="about-release-badge">Current</span>
        )}
        <span className="about-release-chev" aria-hidden>
          {expanded ? '▾' : '▸'}
        </span>
      </button>
      {expanded && (
        <div className="about-release-body">
          {entry.sections.map((section) => (
            <div
              key={section.heading}
              className={
                'about-release-section about-release-' +
                section.heading.toLowerCase()
              }
            >
              <div className="about-release-section-heading">
                {section.heading}
              </div>
              <ul className="about-release-bullets">
                {section.items.map((item, i) => (
                  <li key={i} className="about-release-bullet">
                    <span className="about-release-bullet-title">
                      {item.title}
                    </span>
                    {item.body && (
                      <span className="about-release-bullet-body">
                        {' '}
                        {item.body}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </li>
  );
}
