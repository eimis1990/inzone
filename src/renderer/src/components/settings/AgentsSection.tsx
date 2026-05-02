import { useMemo, useState } from 'react';
import { getAgentColor } from '@shared/palette';
import { useStore } from '../../store';

export function AgentsSection() {
  const agents = useStore((s) => s.agents);
  const openAgentEditor = useStore((s) => s.openAgentEditor);
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q),
    );
  }, [agents, query]);

  return (
    <div className="settings-pane">
      <div className="settings-pane-header settings-pane-header-with-toolbar">
        <div className="settings-pane-header-text">
          <h2>Agents</h2>
          <p className="settings-pane-sub">
            Every agent definition the app sees, from{' '}
            <code>~/.claude/agents</code> and project scope.
          </p>
        </div>
        <div className="settings-toolbar settings-toolbar-inline">
          <button
            className="primary small"
            onClick={() => openAgentEditor()}
            title="Create a new agent"
          >
            + New Agent
          </button>
          <input
            className="settings-search"
            placeholder="Search agents…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>
      <div className="settings-pane-body">
        {filtered.length === 0 && (
          <div className="settings-empty">
            {query
              ? 'No agents match that search.'
              : 'No agents yet. Click "+ New Agent" to create one.'}
          </div>
        )}

        <div className="agents-grid">
          {filtered.map((a) => {
            const color = getAgentColor(a.color);
            const skillCount = a.skills?.length ?? 0;
            const mcpCount = a.mcpServers?.length ?? 0;
            return (
              <button
                key={a.filePath}
                className="agent-card-lg"
                onClick={() => openAgentEditor(a)}
                style={
                  color
                    ? ({ ['--card-accent' as string]: color.vivid } as React.CSSProperties)
                    : undefined
                }
              >
                {/* Vertical accent stripe down the left edge — agent's color. */}
                <span className="agent-card-lg-stripe" aria-hidden />

                <div className="agent-card-lg-top">
                  <div className="agent-card-lg-emoji" aria-hidden>
                    {a.emoji ?? '🤖'}
                  </div>
                  <div className="agent-card-lg-head">
                    <div className="agent-card-lg-title">{a.name}</div>
                    {a.model && (
                      <span className="agent-card-lg-model">{a.model}</span>
                    )}
                  </div>
                </div>

                {a.description && (
                  <div className="agent-card-lg-desc">{a.description}</div>
                )}

                <div className="agent-card-lg-foot">
                  <span className="agent-card-lg-meta">
                    <span className="agent-card-lg-meta-num">
                      {skillCount}
                    </span>{' '}
                    skill{skillCount === 1 ? '' : 's'}
                  </span>
                  <span className="agent-card-lg-meta">
                    <span className="agent-card-lg-meta-num">{mcpCount}</span>{' '}
                    MCP{mcpCount === 1 ? '' : 's'}
                  </span>
                  <span className="agent-card-lg-meta agent-card-lg-meta-scope">
                    {a.scope}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
