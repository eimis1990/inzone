import { useMemo, useState } from 'react';
import { getAgentColor } from '@shared/palette';
import type { AgentDef } from '@shared/types';
import { humanizeAgentName, useStore } from '../../store';

type SortKey = 'name' | 'model';
type SortDir = 'asc' | 'desc';

interface SortState {
  key: SortKey;
  dir: SortDir;
}

/**
 * Settings → Agents.
 *
 * Tabular layout of every agent INZONE sees. Card grid was hard to
 * scan once you had more than ~6 agents — this table puts the most
 * useful columns (name, description, model, modified) side by side
 * so the eye can sweep down a single column to find what it wants.
 *
 * Columns are sortable: click a header to set it as the active sort
 * key (asc), click again to flip to desc. Default is by modified-time
 * descending so the agent the user just touched lands at the top.
 */
export function AgentsSection() {
  const agents = useStore((s) => s.agents);
  const openAgentEditor = useStore((s) => s.openAgentEditor);
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortState>({
    key: 'name',
    dir: 'asc',
  });

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return agents;
    return agents.filter(
      (a) =>
        a.name.toLowerCase().includes(q) ||
        (a.description ?? '').toLowerCase().includes(q) ||
        (a.model ?? '').toLowerCase().includes(q),
    );
  }, [agents, query]);

  const sorted = useMemo(() => {
    const copy = [...filtered];
    const dir = sort.dir === 'asc' ? 1 : -1;
    copy.sort((a, b) => {
      switch (sort.key) {
        case 'name':
          return a.name.localeCompare(b.name) * dir;
        case 'model': {
          const am = (a.model ?? '').toLowerCase();
          const bm = (b.model ?? '').toLowerCase();
          if (am === bm) return a.name.localeCompare(b.name);
          // Empty values sort to the end regardless of direction.
          if (!am) return 1;
          if (!bm) return -1;
          return am.localeCompare(bm) * dir;
        }
      }
    });
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
        {sorted.length === 0 && (
          <div className="settings-empty">
            {query
              ? 'No agents match that search.'
              : 'No agents yet. Click "+ New Agent" to create one.'}
          </div>
        )}

        {sorted.length > 0 && (
          <div className="agents-table-wrap">
            <table className="agents-table">
              <thead>
                <tr>
                  <th className="agents-th agents-th-num">#</th>
                  <SortableTh
                    label="Agent"
                    sortKey="name"
                    state={sort}
                    onToggle={toggleSort}
                  />
                  <th className="agents-th">Description</th>
                  <SortableTh
                    label="Model"
                    sortKey="model"
                    state={sort}
                    onToggle={toggleSort}
                  />
                  <th className="agents-th agents-th-counts">Capabilities</th>
                  <th className="agents-th agents-th-scope">Scope</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((a, i) => (
                  <AgentRow
                    key={a.filePath}
                    agent={a}
                    index={i + 1}
                    onOpen={() => openAgentEditor(a)}
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

function AgentRow({
  agent,
  index,
  onOpen,
}: {
  agent: AgentDef;
  index: number;
  onOpen: () => void;
}) {
  const color = getAgentColor(agent.color);
  const skillCount = agent.skills?.length ?? 0;
  const mcpCount = agent.mcpServers?.length ?? 0;
  const styleVar = color
    ? ({ ['--row-accent' as string]: color.vivid } as React.CSSProperties)
    : undefined;

  return (
    <tr
      className="agents-row"
      onClick={onOpen}
      style={styleVar}
      title="Click to edit"
    >
      <td className="agents-td agents-td-num">{index}</td>
      <td className="agents-td agents-td-agent">
        {/* Inner flex wrapper so the surrounding <td> keeps its
            normal table-cell behavior + `vertical-align: middle`,
            which centers the avatar+name block against tall sibling
            cells (Capabilities can be 2 chips tall). A flex td
            directly would break vertical-align. */}
        <div className="agents-agent-cell">
          <div className="agents-avatar" aria-hidden>
            <span className="agents-avatar-emoji">{agent.emoji ?? '🤖'}</span>
          </div>
          <div className="agents-name-block">
            <div
              className="agents-name"
              title={agent.name /* slug, in case the user is looking for it */}
            >
              {humanizeAgentName(agent.name)}
            </div>
            {agent.vibe && <div className="agents-vibe">{agent.vibe}</div>}
          </div>
        </div>
      </td>
      <td className="agents-td agents-td-desc" title={agent.description}>
        {agent.description ? (
          agent.description
        ) : (
          <span className="agents-placeholder">—</span>
        )}
      </td>
      <td className="agents-td agents-td-model">
        {agent.model ? (
          <span className="agents-model-pill">{agent.model}</span>
        ) : (
          <span className="agents-placeholder">default</span>
        )}
      </td>
      <td className="agents-td agents-td-counts">
        {/* Inner flex wrapper so the parent `<td>` keeps normal
            `vertical-align: middle` behaviour and the chips centre
            vertically when they wrap to two lines (1 skill + 0 MCPs
            otherwise stacks at the top of a tall row). */}
        <div className="agents-counts-cell">
          <span
            className={
              'agents-count-chip' + (skillCount > 0 ? '' : ' is-zero')
            }
            title={`${skillCount} skill${skillCount === 1 ? '' : 's'}`}
          >
            {skillCount} skill{skillCount === 1 ? '' : 's'}
          </span>
          <span
            className={'agents-count-chip' + (mcpCount > 0 ? '' : ' is-zero')}
            title={`${mcpCount} MCP server${mcpCount === 1 ? '' : 's'}`}
          >
            {mcpCount} MCP{mcpCount === 1 ? '' : 's'}
          </span>
        </div>
      </td>
      <td className="agents-td agents-td-scope">
        <span className={'agents-scope-pill agents-scope-' + agent.scope}>
          {agent.scope}
        </span>
      </td>
    </tr>
  );
}

