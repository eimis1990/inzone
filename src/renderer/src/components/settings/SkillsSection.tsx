import { useMemo, useState } from 'react';
import { useStore } from '../../store';

export function SkillsSection() {
  const skills = useStore((s) => s.skills);
  const openSkillEditor = useStore((s) => s.openSkillEditor);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return skills;
    return skills.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.description ?? '').toLowerCase().includes(q),
    );
  }, [skills, query]);

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
        {filtered.length === 0 && (
          <div className="settings-empty">
            {query
              ? 'No skills match that search.'
              : 'No skills yet. Click "+ New Skill" to create one.'}
          </div>
        )}

        <div className="agents-grid">
          {filtered.map((s) => (
            <button
              key={s.filePath}
              className="agent-card-lg skill-card-lg"
              onClick={() => openSkillEditor(s)}
            >
              <span className="agent-card-lg-stripe" aria-hidden />
              <div className="agent-card-lg-top">
                <div className="agent-card-lg-emoji" aria-hidden>
                  📚
                </div>
                <div className="agent-card-lg-head">
                  <div className="agent-card-lg-title">{s.name}</div>
                </div>
              </div>

              {s.description && (
                <div className="agent-card-lg-desc">{s.description}</div>
              )}

              <div className="agent-card-lg-foot">
                <span className="agent-card-lg-meta agent-card-lg-meta-scope">
                  {s.scope}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
