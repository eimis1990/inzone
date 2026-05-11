import { useEffect, useMemo, useState } from 'react';
import type { SkillDef } from '@shared/types';
import {
  RECOMMENDED_SKILLS,
  type RecommendedSkill,
} from '@shared/recommended-skills';
import { humanizeAgentName, useStore } from '../../store';

type SortKey = 'name';
type SortDir = 'asc' | 'desc';

interface SortState {
  key: SortKey;
  dir: SortDir;
}

/**
 * Settings → Skills.
 *
 * Same tabular layout as AgentsSection (and reuses its CSS classes
 * under the `.agents-table` family) so the two pages feel like
 * siblings. Skills have fewer dimensions to surface — just name,
 * description, and scope — so the table is correspondingly shorter.
 * Sortable by name; descriptions truncate to one line with the full
 * text in the tooltip, like the Agents table.
 */
export function SkillsSection() {
  const skills = useStore((s) => s.skills);
  const openSkillEditor = useStore((s) => s.openSkillEditor);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>({ key: 'name', dir: 'asc' });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q),
    );
  }, [skills, query]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    const dir = sort.dir === 'asc' ? 1 : -1;
    copy.sort((a, b) => a.name.localeCompare(b.name) * dir);
    return copy;
  }, [filtered, sort]);

  const toggleSort = (key: SortKey) => {
    setSort((cur) =>
      cur.key === key
        ? { key, dir: cur.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: 'asc' },
    );
  };

  return (
    <div className="settings-pane">
      <div className="settings-pane-header settings-pane-header-with-toolbar">
        <div className="settings-pane-header-text">
          <h2>Skills</h2>
          <p className="settings-pane-sub">
            Skills under <code>~/.claude/skills</code>. Each agent in this
            app is given a curated subset to keep its toolbox focused.
          </p>
        </div>
        <div className="settings-toolbar settings-toolbar-inline">
          <button
            className="primary small"
            onClick={() => openSkillEditor()}
            title="Create a new skill"
          >
            + New Skill
          </button>
          <input
            className="settings-search"
            placeholder="Search skills…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="settings-pane-body">
        <RecommendedSkillsSection installedSkills={skills} />

        {sorted.length === 0 && (
          <div className="settings-empty">
            {query
              ? 'No skills match that search.'
              : 'No skills yet. Click "+ New Skill" to create one.'}
          </div>
        )}

        {sorted.length > 0 && (
          <div className="agents-table-wrap">
            <table className="agents-table">
              <thead>
                <tr>
                  <th className="agents-th agents-th-num">#</th>
                  <SortableTh
                    label="Skill"
                    sortKey="name"
                    state={sort}
                    onToggle={toggleSort}
                  />
                  <th className="agents-th">Description</th>
                  <th className="agents-th agents-th-scope">Scope</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((s, i) => (
                  <SkillRow
                    key={s.filePath}
                    skill={s}
                    index={i + 1}
                    onOpen={() => openSkillEditor(s)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function SortableTh({
  label,
  sortKey,
  state,
  onToggle,
}: {
  label: string;
  sortKey: SortKey;
  state: SortState;
  onToggle: (k: SortKey) => void;
}) {
  const active = state.key === sortKey;
  return (
    <th className={'agents-th agents-th-sortable' + (active ? ' active' : '')}>
      <button
        type="button"
        className="agents-sort-btn"
        onClick={() => onToggle(sortKey)}
        aria-sort={
          active ? (state.dir === 'asc' ? 'ascending' : 'descending') : 'none'
        }
      >
        {label}
        <span className="agents-sort-indicator" aria-hidden>
          {active ? (state.dir === 'asc' ? '▲' : '▼') : '⇅'}
        </span>
      </button>
    </th>
  );
}

/**
 * "Recommended" section above the user's own skills table. Renders
 * one card per entry in `RECOMMENDED_SKILLS` with an Install button
 * (or "✓ Installed" badge if the skill folder is already present in
 * the user's library).
 *
 * Install does a shallow git clone in the main process and copies
 * the relevant subtree into ~/.claude/skills/. The skill watcher
 * picks up the new folder automatically — no app reload needed.
 */
function RecommendedSkillsSection({
  installedSkills,
}: {
  installedSkills: SkillDef[];
}) {
  // Map id → status for the cards. We treat a skill as installed if
  // any user skill's name matches the recommended skill's installAs
  // (or its id when installAs is omitted). Watching `installedSkills`
  // means the card flips to "Installed" the moment the chokidar
  // listener picks up the new folder.
  const installedNames = useMemo(
    () => new Set(installedSkills.map((s) => s.name)),
    [installedSkills],
  );
  const [installing, setInstalling] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  /** Open detail modal — null when closed, otherwise the skill the
   *  user clicked. Card body opens it; the Install / View source
   *  controls stopPropagation so they keep doing their own thing
   *  without yanking up a modal underneath. */
  const [detailSkill, setDetailSkill] = useState<RecommendedSkill | null>(
    null,
  );

  const onInstall = async (skill: RecommendedSkill) => {
    setInstalling((cur) => ({ ...cur, [skill.id]: true }));
    setErrors((cur) => {
      const { [skill.id]: _, ...rest } = cur;
      return rest;
    });
    try {
      const result = await window.cowork.skills.installRecommended(skill);
      if (!result.ok) {
        setErrors((cur) => ({ ...cur, [skill.id]: result.error }));
      }
      // Success → the watcher will refresh `installedSkills` and the
      // card flips to "Installed" automatically.
    } catch (err) {
      setErrors((cur) => ({
        ...cur,
        [skill.id]: err instanceof Error ? err.message : String(err),
      }));
    } finally {
      setInstalling((cur) => ({ ...cur, [skill.id]: false }));
    }
  };

  return (
    <section className="recommended-skills">
      <div className="tasks-section-title">Recommended skills</div>
      <div className="recommended-skills-list">
        {RECOMMENDED_SKILLS.map((skill) => {
          // Where the skill lands on disk depends on its install
          // method. Git skills land at `installAs ?? id`. Press
          // skills land at `installAs ?? pp-<pressName>`. We
          // mirror the same resolution the main-process install
          // code uses (see installViaGitClone / installViaPress
          // in skills-install.ts).
          const targetName =
            skill.installAs ??
            (skill.via === 'printing-press' && skill.printingPressName
              ? `pp-${skill.printingPressName}`
              : skill.id);
          const isInstalled = installedNames.has(targetName);
          const busy = installing[skill.id] ?? false;
          const error = errors[skill.id];
          // "View source" link prefers sourceUrl when set —
          // particularly for Press skills which don't have their
          // own repoUrl (they live as entries inside the Press
          // library repo) and supply sourceUrl pointing at the
          // library directory. Falls back to repoUrl for legacy
          // git entries.
          const sourceUrl = skill.sourceUrl ?? skill.repoUrl;
          return (
            <div
              className="recommended-skill-card"
              key={skill.id}
              onClick={() => setDetailSkill(skill)}
              role="button"
              tabIndex={0}
              aria-label={`Open details for ${skill.name}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setDetailSkill(skill);
                }
              }}
            >
              <div className="recommended-skill-head">
                <span className="recommended-skill-emoji" aria-hidden>
                  {skill.emoji}
                </span>
                <div className="recommended-skill-titles">
                  <div className="recommended-skill-name">{skill.name}</div>
                  <div className="recommended-skill-meta">
                    by {skill.author} · {skill.license}
                  </div>
                </div>
                {isInstalled ? (
                  <span className="recommended-skill-installed">
                    ✓ Installed
                  </span>
                ) : (
                  // No primary action button in the top-right —
                  // would compete with the whole-card click target
                  // for the same intent. Use a simple arrow glyph
                  // to signal "click to expand" (mirrors the
                  // "View source ↗" affordance below).
                  <span
                    className="recommended-skill-expand"
                    aria-hidden
                  >
                    ↗
                  </span>
                )}
              </div>
              <div className="recommended-skill-desc">
                {skill.description}
              </div>
              <div className="recommended-skill-footer">
                {sourceUrl ? (
                  <a
                    href={sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="recommended-skill-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    View source ↗
                  </a>
                ) : (
                  <span />
                )}
                {skill.tags && skill.tags.length > 0 && (
                  <div className="recommended-skill-tags">
                    {skill.tags.map((t) => (
                      <span key={t} className="recommended-skill-tag">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {error && (
                // Compact status indicator only — the full error +
                // any "Install Go" action live inside the detail
                // modal. Keeping the card a fixed height in the
                // rail matters more than fitting the full message
                // on each card.
                <div
                  className="recommended-skill-error-pill"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDetailSkill(skill);
                  }}
                  title="Click to see what went wrong"
                >
                  <span className="recommended-skill-error-dot" aria-hidden>
                    ●
                  </span>
                  Install failed — open for details
                </div>
              )}
            </div>
          );
        })}
      </div>
      {detailSkill && (
        <RecommendedSkillDetailModal
          skill={detailSkill}
          isInstalled={installedNames.has(
            detailSkill.installAs ??
              (detailSkill.via === 'printing-press' &&
              detailSkill.printingPressName
                ? `pp-${detailSkill.printingPressName}`
                : detailSkill.id),
          )}
          installing={installing[detailSkill.id] ?? false}
          error={errors[detailSkill.id]}
          onInstall={() => void onInstall(detailSkill)}
          onClose={() => setDetailSkill(null)}
        />
      )}
    </section>
  );
}

/**
 * Detail modal for a recommended skill. Card click opens this with
 * the full description (no 4-line clamp), author/license, tags,
 * source link, and an Install button (or "Installed" badge). Esc
 * + backdrop click + a close button all dismiss; the install
 * button also closes after a successful install completes.
 */
function RecommendedSkillDetailModal({
  skill,
  isInstalled,
  installing,
  error,
  onInstall,
  onClose,
}: {
  skill: RecommendedSkill;
  isInstalled: boolean;
  installing: boolean;
  error: string | undefined;
  onInstall: () => void;
  onClose: () => void;
}) {
  // Esc closes the modal. We attach to window (rather than the
  // backdrop) so it works even if focus isn't inside the modal —
  // makes the dismissal feel less finicky.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sourceUrl = skill.sourceUrl ?? skill.repoUrl;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal recommended-skill-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label={`${skill.name} — recommended skill`}
      >
        <div className="modal-header">
          <div className="recommended-skill-modal-head">
            <span className="recommended-skill-modal-emoji" aria-hidden>
              {skill.emoji}
            </span>
            <div>
              <h2 className="recommended-skill-modal-name">{skill.name}</h2>
              <div className="recommended-skill-modal-meta">
                by {skill.author} · {skill.license}
              </div>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <p className="recommended-skill-modal-desc">
            {skill.description}
          </p>
          {skill.tags && skill.tags.length > 0 && (
            <div className="recommended-skill-tags recommended-skill-modal-tags">
              {skill.tags.map((t) => (
                <span key={t} className="recommended-skill-tag">
                  {t}
                </span>
              ))}
            </div>
          )}
          {error && (
            <div className="recommended-skill-error recommended-skill-modal-error">
              <div>{error}</div>
              <MissingDependencyAction error={error} />
            </div>
          )}
          <div className="recommended-skill-modal-where">
            {skill.via === 'printing-press' ? (
              <>
                Installed via{' '}
                <a
                  href="https://printingpress.dev"
                  target="_blank"
                  rel="noreferrer"
                  className="recommended-skill-link"
                >
                  Printing Press
                </a>
                . Drops a binary on your PATH and a SKILL.md into{' '}
                <code>
                  ~/.claude/skills/pp-{skill.printingPressName}/
                </code>
                . Your agents will pick the skill up automatically.
                <br />
                <br />
                <strong>Requires Go</strong> (~200 MB) — Printing
                Press CLIs are compiled Go binaries. If you don't
                have Go installed, the install will surface a
                one-click "Install Go" button.
              </>
            ) : (
              <>
                Installed via shallow git clone into{' '}
                <code>
                  ~/.claude/skills/{skill.installAs ?? skill.id}/
                </code>
                . Your agents will pick the skill up automatically.
              </>
            )}
          </div>
        </div>

        <div className="modal-footer">
          {sourceUrl && (
            <a
              href={sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="recommended-skill-link"
            >
              View source ↗
            </a>
          )}
          <div className="spacer" />
          <button className="ghost" onClick={onClose}>
            Close
          </button>
          {isInstalled ? (
            <span className="recommended-skill-installed">
              ✓ Installed
            </span>
          ) : (
            <button
              type="button"
              className="primary"
              onClick={onInstall}
              disabled={installing}
            >
              {installing ? 'Installing…' : 'Install'}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function SkillRow({
  skill,
  index,
  onOpen,
}: {
  skill: SkillDef;
  index: number;
  onOpen: () => void;
}) {
  return (
    <tr className="agents-row" onClick={onOpen} title="Click to edit">
      <td className="agents-td agents-td-num">{index}</td>
      <td className="agents-td agents-td-agent">
        <div className="agents-agent-cell">
          <div className="agents-avatar" aria-hidden>
            <span className="agents-avatar-emoji">📚</span>
          </div>
          <div className="agents-name-block">
            <div className="agents-name" title={skill.name}>
              {humanizeAgentName(skill.name)}
            </div>
          </div>
        </div>
      </td>
      <td className="agents-td agents-td-desc" title={skill.description}>
        {skill.description ? (
          skill.description
        ) : (
          <span className="agents-placeholder">—</span>
        )}
      </td>
      <td className="agents-td agents-td-scope">
        <span className={'agents-scope-pill agents-scope-' + skill.scope}>
          {skill.scope}
        </span>
      </td>
    </tr>
  );
}

/**
 * When a recommended-skill install fails because the user is missing
 * a system dependency (Go is the canonical case — Printing Press
 * CLIs are Go binaries, so the Press CLI returns "Go is required to
 * install Printing Press CLIs"), render a one-click action right
 * inside the error block. The user shouldn't have to figure out the
 * install command themselves when we already know what's needed.
 *
 * The matcher is intentionally loose: we look for the error to
 * mention Go and an install hint, then attach a "Install Go"
 * button that either types `brew install go` into the bottom-bar
 * terminal (macOS) or opens go.dev/dl/ in the system browser
 * (Linux / Windows, where the right install path varies by distro).
 *
 * Returns `null` when no known dependency hint is found — the error
 * just renders as text in that case.
 */
function MissingDependencyAction({ error }: { error: string }) {
  // Hooks must run unconditionally — rules of hooks. Declare state
  // / effects first, then branch on the error pattern below.
  /** Track the in-flight Install Go click so the button can show
   *  progress. Re-enables itself after ~90 s in case the install
   *  fails so the user can retry; brew install go typically
   *  completes in 30-90 s on a fresh machine. */
  const [installing, setInstalling] = useState(false);
  useEffect(() => {
    if (!installing) return;
    const t = setTimeout(() => setInstalling(false), 90_000);
    return () => clearTimeout(t);
  }, [installing]);

  const lower = error.toLowerCase();
  const isGoMissing =
    /\bgo is required\b/i.test(error) ||
    /\bgolang\b/i.test(lower) ||
    /\binstall go\b/i.test(lower);
  // PATH-related variant: Go IS installed and the Press CLI even
  // installed the binary into ~/go/bin, but that directory isn't on
  // PATH. We surface a different recovery suggestion for this case
  // (it's not "install Go" — it's "add ~/go/bin to PATH" or "try
  // again now that we've augmented our spawn PATH").
  const isGoBinPathMissing =
    /not on PATH/i.test(error) && /go\/bin|GOPATH/i.test(error);
  if (!isGoMissing && !isGoBinPathMissing) return null;

  const onInstallGo = async () => {
    setInstalling(true);
    let platform: string = 'darwin';
    try {
      platform = window.cowork.system.platform();
    } catch {
      // bridge unavailable — default to darwin since brew is what
      // the Press error message itself suggested
    }
    if (platform === 'darwin') {
      // brew install go: opens the bottom terminal panel (it
      // self-opens on demand), types the command, runs it. Same
      // pattern as the Worker preset install flow.
      window.dispatchEvent(
        new CustomEvent<string>('inzone:terminal-run', {
          detail: 'brew install go',
        }),
      );
      return;
    }
    // Linux / Windows: distro-specific package manager varies
    // (apt vs dnf vs pacman; choco vs winget vs official .msi),
    // and not every user has Homebrew on Linux. Safer to open the
    // canonical download page and let them pick.
    try {
      await window.cowork.system.openPath({ path: 'https://go.dev/dl/' });
    } catch {
      // openPath isn't on the bridge in some dev configs — fall
      // back to a plain anchor click via location.
      window.open('https://go.dev/dl/', '_blank', 'noreferrer');
    }
  };

  // PATH-not-set variant: we've already augmented our own spawn
  // PATH with ~/go/bin (skills-install.ts), so the install should
  // work on retry. Tell the user that.
  if (isGoBinPathMissing) {
    return (
      <div className="recommended-skill-dep-action">
        <span className="recommended-skill-dep-hint">
          Go installed the binary into <code>~/go/bin</code>, but
          your shell doesn't have that directory on PATH. INZONE
          can still run it — click <strong>Install</strong> again
          to retry. For your terminal panes to find the binary
          too, add <code>$HOME/go/bin</code> to your shell's PATH
          (e.g. in <code>~/.zshrc</code>).
        </span>
      </div>
    );
  }

  return (
    <div className="recommended-skill-dep-action">
      <button
        type="button"
        className="primary small"
        onClick={(e) => {
          e.stopPropagation();
          void onInstallGo();
        }}
        disabled={installing}
      >
        {installing ? (
          <>
            <span className="btn-spinner" aria-hidden />
            Installing Go…
          </>
        ) : (
          'Install Go'
        )}
      </button>
      <span className="recommended-skill-dep-hint">
        {installing ? (
          <>
            Watch the bottom terminal panel for progress. Once
            it finishes, click <strong>Install</strong> again on
            this card to retry.
          </>
        ) : (
          <>
            ~200 MB toolchain. Required because Printing Press
            CLIs are compiled Go binaries.
          </>
        )}
      </span>
    </div>
  );
}
