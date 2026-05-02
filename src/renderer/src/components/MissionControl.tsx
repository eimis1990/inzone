import { useEffect, useMemo } from 'react';
import { useStore, type PaneRuntime } from '../store';
import type { PaneId, PaneNode, WindowState } from '@shared/types';
import { getAgentColor } from '@shared/palette';
import { fmt } from './UsageModal';

/**
 * Mission Control — full-screen overlay showing every project across
 * the user's workspaces.
 *
 * v1 scope (per task #182): the active project's panes show live
 * runtime status (current tool, last assistant text, status pill);
 * inactive projects show metadata + agent assignments only. Click a
 * project header → switch to it. Click a pane row (active project) →
 * switch to that project + focus the pane.
 *
 * Triggered via ⌘⇧M from anywhere (handler installed in App.tsx) or
 * the launcher icon in the workspace bar. Closes on Esc or backdrop
 * click. Lives outside the per-project content area so it doesn't
 * collide with `pipelineView`.
 */
export function MissionControl() {
  const open = useStore((s) => s.missionControlOpen);
  // CRITICAL: subscribe to the action reference directly. Returning a
  // fresh closure from the selector (`(s) => () => s.setMissionControlOpen(false)`)
  // creates a new function on every store update, which Zustand v5
  // sees as a changed value via Object.is — that triggers a re-render,
  // which runs the selector again, ad infinitum. We hit the exact
  // same bug in ReviewView. Subscribe to the stable action and build
  // the closure inline at call sites instead.
  const setMissionControlOpen = useStore((s) => s.setMissionControlOpen);
  const sessions = useStore((s) => s.sessions);
  const activeWorkspaceId = useStore((s) => s.activeWorkspaceId);
  const workspaces = useStore((s) => s.workspaces);
  const windowId = useStore((s) => s.windowId);
  const panes = useStore((s) => s.panes);
  const agents = useStore((s) => s.agents);
  const usage = useStore((s) => s.usage);
  const switchSession = useStore((s) => s.switchSession);
  const setActivePane = useStore((s) => s.setActivePane);

  // ESC closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMissionControlOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, setMissionControlOpen]);

  // Build the project list from the active workspace, with worktrees
  // grouped under their parents (mirroring SessionsList's logic).
  const projects = useMemo(() => {
    const ws = workspaces.find((w) => w.id === activeWorkspaceId);
    const ordered: WindowState[] = [];
    if (ws) {
      for (const id of ws.projectIds) {
        const found = sessions.find((s) => s.id === id);
        if (found) ordered.push(found);
      }
    } else {
      ordered.push(...sessions);
    }
    return ordered;
  }, [sessions, workspaces, activeWorkspaceId]);

  const totalPanes = useMemo(() => {
    let n = 0;
    for (const p of projects) n += countLeaves(p.tree);
    return n;
  }, [projects]);

  const topLevelProjects = useMemo(
    () => projects.filter((p) => !p.parentProjectId).length,
    [projects],
  );

  if (!open) return null;

  return (
    <div
      className="mission-control-root"
      onMouseDown={(e) => {
        // Click on the backdrop closes; clicks inside content
        // shouldn't bubble (handled below).
        if (e.target === e.currentTarget) setMissionControlOpen(false);
      }}
    >
      <div
        className="mission-control"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <header className="mission-control-header">
          <div className="mission-control-title">
            <h2>Mission Control</h2>
            <p>
              {topLevelProjects} project{topLevelProjects === 1 ? '' : 's'} ·{' '}
              {totalPanes} pane{totalPanes === 1 ? '' : 's'} ·{' '}
              <span className="mission-control-cost">
                {fmt(usage?.todayCostUsd ?? 0)} today
              </span>
            </p>
          </div>
          <button
            type="button"
            className="mission-control-close"
            onClick={() => setMissionControlOpen(false)}
            aria-label="Close (Esc)"
            title="Close (Esc)"
          >
            ✕
          </button>
        </header>

        <div className="mission-control-body">
          {projects.length === 0 && (
            <div className="mission-control-empty">
              No projects in the current workspace yet. Create one from
              the sidebar's <strong>+ New Project</strong> button.
            </div>
          )}
          {projects.map((p) => (
            <ProjectCard
              key={p.id}
              project={p}
              isActive={p.id === windowId}
              panes={panes}
              agents={agents}
              onSwitch={() => {
                if (p.id !== windowId) {
                  void switchSession(p.id);
                }
                setMissionControlOpen(false);
              }}
              onJumpToPane={(paneId) => {
                if (p.id !== windowId) {
                  void switchSession(p.id);
                }
                setActivePane(paneId);
                setMissionControlOpen(false);
              }}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

interface ProjectCardProps {
  project: WindowState;
  isActive: boolean;
  panes: Record<PaneId, PaneRuntime>;
  agents: ReturnType<typeof useStore.getState>['agents'];
  onSwitch: () => void;
  onJumpToPane: (paneId: PaneId) => void;
}

function ProjectCard({
  project,
  isActive,
  panes,
  agents,
  onSwitch,
  onJumpToPane,
}: ProjectCardProps) {
  const leafIds = useMemo(() => collectLeaves(project.tree), [project.tree]);
  const isWorktree = !!project.parentProjectId;
  const mode = project.windowMode ?? 'multi';

  return (
    <div
      className={
        'mission-card' +
        (isActive ? ' mission-card-active' : '') +
        (isWorktree ? ' mission-card-worktree' : '')
      }
    >
      <button
        type="button"
        className="mission-card-head"
        onClick={onSwitch}
        title="Switch to this project"
      >
        <div className="mission-card-head-main">
          {isWorktree && (
            <span className="mission-card-wt-glyph" aria-hidden>
              ↳
            </span>
          )}
          <div className="mission-card-name">
            <strong>
              {project.name ?? deriveDefaultName(project.cwd)}
            </strong>
            <span className="mission-card-meta">
              {isActive && (
                <span className="mission-card-active-pill">Active</span>
              )}
              {isWorktree && (
                <span className="mission-card-wt-pill">WT</span>
              )}
              <span className="mission-card-mode">
                {mode === 'lead' ? 'Lead' : 'Multi'}
              </span>
              <span className="mission-card-pane-count">
                {leafIds.length + (mode === 'lead' && project.lead ? 1 : 0)}{' '}
                pane{leafIds.length === 1 ? '' : 's'}
              </span>
              {project.worktreeBranch && (
                <code className="mission-card-branch">
                  {project.worktreeBranch}
                </code>
              )}
            </span>
          </div>
        </div>
        <span className="mission-card-cwd" title={project.cwd}>
          {shortCwd(project.cwd)}
        </span>
      </button>

      {/* Pane list. For the active project we have live runtime info
          in the panes map. For inactive projects we still list the
          panes from the tree (with their saved agent assignments)
          but show "Inactive" status — no live event subscription
          exists for background projects in v1. */}
      <ul className="mission-card-panes">
        {/* Lead pane row — only when project is in Lead mode. */}
        {mode === 'lead' && project.lead && (
          <PaneRow
            paneId={project.lead.paneId}
            agentName={project.lead.agentName}
            paneName={project.lead.paneName ?? 'Lead'}
            isLead
            isActive={isActive}
            runtime={isActive ? panes[project.lead.paneId] : undefined}
            agents={agents}
            onJump={() => onJumpToPane(project.lead!.paneId)}
          />
        )}
        {/* Tree leaves — every regular pane. */}
        {leafIds.map((id) => {
          const node = findLeaf(project.tree, id);
          return (
            <PaneRow
              key={id}
              paneId={id}
              agentName={node?.agent}
              paneName={node?.paneName}
              isLead={false}
              isActive={isActive}
              runtime={isActive ? panes[id] : undefined}
              agents={agents}
              onJump={() => onJumpToPane(id)}
            />
          );
        })}
        {leafIds.length === 0 && !project.lead && (
          <li className="mission-card-empty">No panes yet.</li>
        )}
      </ul>
    </div>
  );
}

interface PaneRowProps {
  paneId: PaneId;
  agentName?: string;
  paneName?: string;
  isLead: boolean;
  isActive: boolean;
  runtime: PaneRuntime | undefined;
  agents: ReturnType<typeof useStore.getState>['agents'];
  onJump: () => void;
}

function PaneRow({
  paneId,
  agentName,
  paneName,
  isLead,
  isActive,
  runtime,
  agents,
  onJump,
}: PaneRowProps) {
  const agent = agentName ? agents.find((a) => a.name === agentName) : undefined;
  const color = agent ? getAgentColor(agent.color) : null;

  // Live-only data — only present when this pane belongs to the
  // currently-active project (since runtime is undefined otherwise).
  const status = runtime?.status;
  const tool = runtime ? lastToolUse(runtime) : undefined;
  const lastText = runtime ? lastAssistantText(runtime) : undefined;
  const cost = runtime ? totalCost(runtime) : 0;
  const lastActivity = runtime ? lastActivityTimestamp(runtime) : undefined;

  const statusPillClass = statusPillKind(status, isActive);

  return (
    <li
      className="mission-pane-row"
      onClick={onJump}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onJump();
        }
      }}
      title="Switch to this project + focus pane"
    >
      <div className="mission-pane-emoji" aria-hidden>
        {agent?.emoji ?? (isLead ? '👑' : '🧩')}
      </div>
      <div className="mission-pane-text">
        <div className="mission-pane-title">
          <strong style={color ? { color: color.vivid } : undefined}>
            {paneName ?? agentName ?? (isLead ? 'Lead' : 'Pane')}
          </strong>
          {agentName && agentName !== paneName && (
            <span className="mission-pane-agent">{agentName}</span>
          )}
          {!agentName && (
            <span className="mission-pane-agent mission-pane-agent-empty">
              no agent
            </span>
          )}
        </div>
        {isActive && (lastText || tool) && (
          <div className="mission-pane-preview">
            {tool && (
              <span className="mission-pane-tool">
                <span className="mission-pane-tool-icon">🔧</span>
                {tool}
              </span>
            )}
            {lastText && (
              <span className="mission-pane-text-snippet">{lastText}</span>
            )}
          </div>
        )}
      </div>
      <div className="mission-pane-meta">
        <span className={'mission-pane-status ' + statusPillClass}>
          {humanStatus(status, isActive)}
        </span>
        {isActive && cost > 0 && (
          <span className="mission-pane-cost">{fmt(cost)}</span>
        )}
        {isActive && lastActivity && (
          <span className="mission-pane-time">
            {timeAgo(lastActivity)}
          </span>
        )}
      </div>
      {/* Pane id used as key + jump target via onClick on parent. */}
      <span style={{ display: 'none' }} aria-hidden>
        {paneId}
      </span>
    </li>
  );
}

// ── helpers ────────────────────────────────────────────────────────

function collectLeaves(node: PaneNode, out: PaneId[] = []): PaneId[] {
  if (node.kind === 'leaf') {
    out.push(node.id);
  } else {
    for (const c of node.children) collectLeaves(c, out);
  }
  return out;
}

function countLeaves(node: PaneNode): number {
  return collectLeaves(node).length;
}

function findLeaf(
  node: PaneNode,
  id: PaneId,
): { agent?: string; paneName?: string } | null {
  if (node.kind === 'leaf') {
    if (node.id === id) {
      return {
        agent: node.agentName,
        paneName: node.paneName,
      };
    }
    return null;
  }
  for (const c of node.children) {
    const r = findLeaf(c, id);
    if (r) return r;
  }
  return null;
}

function lastToolUse(runtime: PaneRuntime): string | undefined {
  for (let i = runtime.items.length - 1; i >= 0; i--) {
    const item = runtime.items[i];
    if (item.kind === 'tool_use') {
      return item.name;
    }
    // Stop walking back once we cross a result event — we only care
    // about tool calls in the *current* turn.
    if (item.kind === 'result') return undefined;
  }
  return undefined;
}

function lastAssistantText(runtime: PaneRuntime): string | undefined {
  for (let i = runtime.items.length - 1; i >= 0; i--) {
    const item = runtime.items[i];
    if (item.kind === 'assistant_text') {
      return item.text.slice(0, 100);
    }
  }
  return undefined;
}

function totalCost(runtime: PaneRuntime): number {
  let sum = 0;
  for (const item of runtime.items) {
    if (item.kind === 'result' && typeof item.totalCostUsd === 'number') {
      sum += item.totalCostUsd;
    }
  }
  return sum;
}

function lastActivityTimestamp(runtime: PaneRuntime): number | undefined {
  // Every ChatItem carries a `ts` (number, ms since epoch). Walk
  // backwards through the stream and return the most recent one.
  for (let i = runtime.items.length - 1; i >= 0; i--) {
    const item = runtime.items[i];
    if (typeof item.ts === 'number') return item.ts;
  }
  return undefined;
}

function statusPillKind(status: string | undefined, isActive: boolean): string {
  if (!isActive) return 'mission-pane-status-inactive';
  if (status === 'streaming' || status === 'starting') {
    return 'mission-pane-status-working';
  }
  if (status === 'error') return 'mission-pane-status-error';
  if (status === 'waiting_for_input') return 'mission-pane-status-idle';
  return 'mission-pane-status-idle';
}

function humanStatus(status: string | undefined, isActive: boolean): string {
  if (!isActive) return 'Inactive';
  if (!status) return 'Idle';
  if (status === 'streaming' || status === 'starting') return 'Working';
  if (status === 'error') return 'Error';
  if (status === 'waiting_for_input') return 'Idle';
  if (status === 'stopped') return 'Stopped';
  return status;
}

function timeAgo(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const day = Math.floor(hr / 24);
  return `${day}d`;
}

function shortCwd(cwd: string): string {
  const home = (window as unknown as { __home?: string }).__home;
  if (home && cwd.startsWith(home)) {
    return '~' + cwd.slice(home.length);
  }
  return cwd;
}

function deriveDefaultName(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, '');
  const base = trimmed.split('/').pop();
  return base && base.length > 0 ? base : 'Project';
}
