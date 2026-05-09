import { useMemo, useState } from 'react';
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
          const targetName = skill.installAs ?? skill.id;
          const isInstalled = installedNames.has(targetName);
          const busy = installing[skill.id] ?? false;
          const error = errors[skill.id];
          return (
            <div className="recommended-skill-card" key={skill.id}>
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
                  <button
                    type="button"
                    className="primary small"
                    onClick={() => void onInstall(skill)}
                    disabled={busy}
                  >
                    {busy ? 'Installing…' : 'Install'}
                  </button>
                )}
              </div>
              <div className="recommended-skill-desc">
                {skill.description}
              </div>
              <div className="recommended-skill-footer">
                <a
                  href={skill.repoUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="recommended-skill-link"
                >
                  View source ↗
                </a>
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
                <div className="recommended-skill-error">{error}</div>
              )}
            </div>
          );
        })}
      </div>
    </section>
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
