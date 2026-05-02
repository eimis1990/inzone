import {
  forwardRef,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getAgentColor } from '@shared/palette';
import { useStore } from '../store';
import { SessionsList } from './SessionsList';
import { SidebarFooter } from './SidebarFooter';
import { VoiceSection } from './VoiceSection';
import {
  WORKER_PRESETS,
  WorkerPresetIcon,
} from './worker-presets';
import { installCommandFor } from '@shared/worker-presets';

type SidebarTab = 'sessions' | 'workers' | 'voice';

/**
 * Three-tab sidebar: Sessions on top, Workers in the middle slot
 * (LLM agents + non-agent CLI presets like a plain terminal, claude
 * code, codex, etc.), Voice agent in its own tab.
 *
 * The Workers tab subdivides into two collapsible sections — Agents
 * first (the workhorses, alphabetical) and Other below (CLI tools,
 * also alphabetical). Section collapse state persists in localStorage
 * since it's pure UI state with no implications for backend data.
 *
 * Tab choice itself is local state — it doesn't persist across
 * reloads (we want first-launch to land on Sessions).
 */
export function AgentSidebar() {
  const [tab, setTab] = useState<SidebarTab>('sessions');
  // Tab badge counts only the TOP-LEVEL projects in the active
  // workspace (worktrees aren't separate projects, just branches of
  // their parent — counting them inflates the number and confuses
  // the user). Switching workspaces feels like switching contexts
  // entirely so the count is workspace-scoped.
  const sessionsCount = useStore((s) => {
    const ws = s.workspaces.find((w) => w.id === s.activeWorkspaceId);
    if (ws) {
      let n = 0;
      for (const id of ws.projectIds) {
        const session = s.sessions.find((p) => p.id === id);
        if (!session) {
          n += 1; // stale id — count conservatively
        } else if (!session.parentProjectId) {
          n += 1;
        }
      }
      return n;
    }
    return s.sessions.filter((p) => !p.parentProjectId).length;
  });
  // Workers tab count = agents + presets so the badge reflects what
  // the user actually sees inside.
  const workersCount = useStore(
    (s) => s.agents.length + WORKER_PRESETS.length,
  );

  // Refs for each tab button so we can measure their position and
  // size, then slide the shared accent indicator between them.
  const stripRef = useRef<HTMLDivElement>(null);
  const tabRefs = {
    sessions: useRef<HTMLButtonElement>(null),
    workers: useRef<HTMLButtonElement>(null),
    voice: useRef<HTMLButtonElement>(null),
  };

  useLayoutEffect(() => {
    const strip = stripRef.current;
    const target = tabRefs[tab].current;
    if (!strip || !target) return;
    const stripRect = strip.getBoundingClientRect();
    const tabRect = target.getBoundingClientRect();
    strip.style.setProperty(
      '--tab-indicator-left',
      `${tabRect.left - stripRect.left}px`,
    );
    strip.style.setProperty('--tab-indicator-width', `${tabRect.width}px`);
    strip.style.setProperty('--tab-indicator-opacity', '1');
    // The first paint happens before measurements settle, so disable the
    // transition for that initial set; subsequent tab changes pick up
    // the transition via CSS.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, sessionsCount, workersCount]);

  return (
    <div className="sidebar">
      <div className="sidebar-tabstrip" ref={stripRef}>
        <TabButton
          ref={tabRefs.sessions}
          active={tab === 'sessions'}
          onClick={() => setTab('sessions')}
          label="Projects"
          count={sessionsCount}
          icon={<TabIconSessions />}
        />
        <TabButton
          ref={tabRefs.workers}
          active={tab === 'workers'}
          onClick={() => setTab('workers')}
          label="Workers"
          count={workersCount}
          icon={<TabIconWorkers />}
        />
        <TabButton
          ref={tabRefs.voice}
          active={tab === 'voice'}
          onClick={() => setTab('voice')}
          label="Voice"
          icon={<TabIconVoice />}
        />
        <div className="sidebar-tabstrip-indicator" aria-hidden />
      </div>

      <div className="sidebar-tabbody">
        {tab === 'sessions' && <SessionsList />}
        {tab === 'workers' && <WorkersTab />}
        {tab === 'voice' && <VoiceSection />}
      </div>

      <SidebarFooter />
    </div>
  );
}

// Forward-ref so the parent can measure each tab and slide the
// accent indicator beneath them.
interface TabButtonProps {
  active: boolean;
  onClick: () => void;
  label: string;
  count?: number;
  icon: React.ReactNode;
}
const TabButton = forwardRef<HTMLButtonElement, TabButtonProps>(
  function TabButton({ active, onClick, label, count, icon }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        className={'sidebar-tab' + (active ? ' active' : '')}
        onClick={onClick}
      >
        <span className="sidebar-tab-icon" aria-hidden>
          {icon}
        </span>
        <span className="sidebar-tab-label">{label}</span>
        {typeof count === 'number' && (
          <span className="sidebar-tab-count">{count}</span>
        )}
      </button>
    );
  },
);

/**
 * Workers tab body. Mirrors the previous AgentsTab in spirit (Create
 * Agent CTA + clickable cards) but adds a second section underneath
 * for non-agent CLI workers. Both sections are collapsible — we
 * remember the open/closed state in localStorage between launches.
 *
 * Phase 1: agent cards keep their click-to-bind behaviour; preset
 * cards are visually present but disabled. Phase 2 will wire preset
 * clicks to spawn a per-pane PTY.
 */
function WorkersTab() {
  const agents = useStore((s) => s.agents);
  const activePaneId = useStore((s) => s.activePaneId);
  const setPaneAgent = useStore((s) => s.setPaneAgent);
  const setPaneToTerminal = useStore((s) => s.setPaneToTerminal);
  const panes = useStore((s) => s.panes);
  const leadPaneId = useStore((s) => s.leadPaneId);
  const openAgentEditor = useStore((s) => s.openAgentEditor);
  const activeAgent = activePaneId ? panes[activePaneId]?.agentName : undefined;
  const activePresetId =
    activePaneId && panes[activePaneId]?.workerKind === 'terminal'
      ? panes[activePaneId]?.presetId
      : undefined;
  // Terminal presets aren't valid for the Lead pane (it's reserved
  // for the orchestrator agent). Disable preset clicks while the
  // user has the Lead pane focused.
  const presetsLocked = !activePaneId || activePaneId === leadPaneId;

  // Probe `command -v <preset>` so cards can show "installed" vs.
  // "not on PATH" badges. Probed on mount, on demand (when the user
  // clicks a not-installed cell — they may have just installed it
  // in another terminal), and polled every few seconds while any
  // preset is still missing — that way running the install command
  // through our terminal panel surfaces the success without the user
  // having to switch tabs or restart.
  const [installed, setInstalled] = useState<Record<string, boolean>>({});

  /**
   * Re-probe the listed commands and merge into `installed`. Returns
   * the fresh map so synchronous callers (the click handler) can act
   * on the latest state without waiting for React to flush.
   */
  const probe = useCallback(
    async (cmds: string[]): Promise<Record<string, boolean>> => {
      if (cmds.length === 0) return installed;
      // Defensive: in dev the preload script ships separately from
      // the renderer. If you hot-reloaded just the renderer after
      // adding a new IPC method, `checkCommands` may not exist on
      // the bridge until the next full app restart. We treat that
      // case as "all presets available" so the tab keeps working —
      // way better than a synchronous TypeError.
      const checkApi = window.cowork?.system?.checkCommands;
      if (typeof checkApi !== 'function') {
        const fallback: Record<string, boolean> = { ...installed };
        for (const c of cmds) fallback[c] = true;
        setInstalled(fallback);
        return fallback;
      }
      try {
        const result = await checkApi({ commands: cmds });
        const merged = { ...installed, ...result };
        setInstalled(merged);
        return merged;
      } catch {
        // Probe failures (sh/command -v missing — extremely rare) →
        // assume installed, same rationale as the bridge fallback.
        const fallback: Record<string, boolean> = { ...installed };
        for (const c of cmds) fallback[c] = true;
        setInstalled(fallback);
        return fallback;
      }
    },
    [installed],
  );

  // Stable list of all preset commands (skipping empty — Terminal
  // preset has no command and is always available).
  const allPresetCommands = useMemo(
    () =>
      WORKER_PRESETS.map((p) => p.command).filter(
        (c): c is string => !!c,
      ),
    [],
  );

  // Initial probe on mount.
  useEffect(() => {
    void probe(allPresetCommands);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Poll every 4s while at least one preset is missing OR unprobed.
  // Stops once everything is installed — no point burning cycles
  // when there's nothing to discover. The poll uses the *known*
  // state so we don't re-check things already confirmed installed.
  useEffect(() => {
    const missing = allPresetCommands.filter(
      (c) => installed[c] === false,
    );
    const unprobed = allPresetCommands.filter(
      (c) => installed[c] === undefined,
    );
    const todo = [...missing, ...unprobed];
    if (todo.length === 0) return;
    const tick = () => {
      void probe(todo);
    };
    const handle = window.setInterval(tick, 4000);
    return () => window.clearInterval(handle);
  }, [installed, allPresetCommands, probe]);

  // Section collapse state. Persist in localStorage so the user's
  // chosen layout survives reloads. Default: both expanded — we want
  // to make Other discoverable on first sight.
  const [agentsCollapsed, setAgentsCollapsed] = useState(() =>
    readBool('inzone.workers.agentsCollapsed', false),
  );
  const [otherCollapsed, setOtherCollapsed] = useState(() =>
    readBool('inzone.workers.otherCollapsed', false),
  );
  useEffect(() => {
    writeBool('inzone.workers.agentsCollapsed', agentsCollapsed);
  }, [agentsCollapsed]);
  useEffect(() => {
    writeBool('inzone.workers.otherCollapsed', otherCollapsed);
  }, [otherCollapsed]);

  // Sort agents alphabetically so the section is predictable as the
  // library grows. Case-insensitive locale compare keeps "Frontend"
  // and "frontend" near each other if both somehow exist.
  const sortedAgents = useMemo(
    () =>
      [...agents].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    [agents],
  );
  // WORKER_PRESETS already declared in alphabetical order in its
  // source file, but we sort again to keep the contract explicit
  // (and to absorb any future re-ordering of that file).
  const sortedPresets = useMemo(
    () =>
      [...WORKER_PRESETS].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
      ),
    [],
  );

  const handleCreate = () => {
    // Open Settings → Agents (so the agent shows up in its full library
    // context once saved), then drop into the editor on top.
    window.dispatchEvent(
      new CustomEvent('inzone:open-settings', { detail: 'agents' }),
    );
    openAgentEditor();
  };

  return (
    <>
      {/* "+ Create Agent" mirrors the Projects tab's "+ New Project" card —
          full-width, dashed accent border, accent-coloured button inside.
          Stays at the top because creating an agent is the most common
          action; the section headers below organise the *library*. */}
      <div className="sidebar-create-card-wrap">
        <div className="sessions-new-card">
          <button
            type="button"
            className="sessions-new-btn"
            onClick={handleCreate}
            title="Open the agent editor for a fresh draft"
          >
            + Create Agent
          </button>
        </div>
      </div>

      <div className="sidebar-list">
        {/* ── Agents section ───────────────────────────────────────── */}
        <WorkerSectionHeader
          title="Agents"
          count={sortedAgents.length}
          collapsed={agentsCollapsed}
          onToggle={() => setAgentsCollapsed((v) => !v)}
        />
        {!agentsCollapsed && (
          <>
            {sortedAgents.map((a) => {
              const color = getAgentColor(a.color);
              const isActive = a.name === activeAgent;
              return (
                <button
                  key={a.name}
                  className={
                    'list-item agent-card' +
                    (isActive ? ' active' : '') +
                    (!activePaneId ? ' disabled' : '')
                  }
                  disabled={!activePaneId}
                  onClick={() => {
                    if (!activePaneId) return;
                    const activePane = panes[activePaneId];
                    if (activePane?.agentName === a.name) return;
                    if (
                      activePane?.agentName &&
                      activePane.agentName !== a.name
                    ) {
                      const ok = confirm(
                        `Replace ${activePane.agentName} with ${a.name} in this pane? The current conversation will end and any unsaved context will be lost.`,
                      );
                      if (!ok) return;
                    }
                    void setPaneAgent(activePaneId, a.name);
                  }}
                  title={a.description ?? a.filePath}
                  style={
                    color
                      ? ({
                          ['--card-accent' as string]: color.vivid,
                        } as React.CSSProperties)
                      : undefined
                  }
                >
                  <span
                    className={
                      'agent-card-pillar' +
                      (color ? '' : ' agent-card-pillar-empty')
                    }
                    aria-hidden
                  />
                  <span className="agent-card-icon" aria-hidden>
                    {/* Default to a robot when the agent definition
                        doesn't carry an emoji — keeps every card
                        with a visual anchor in the icon column. */}
                    <span className="agent-card-emoji">
                      {a.emoji ?? '🤖'}
                    </span>
                  </span>
                  <div className="agent-card-body">
                    <div className="agent-card-name">{a.name}</div>
                    {a.description && (
                      <div className="agent-card-desc">{a.description}</div>
                    )}
                    <div className="agent-card-meta">
                      {/* Same badge treatment as preset cards' command
                          chip — keeps the two card families in lockstep
                          visually. Scope first, model second. */}
                      <code>{a.scope === 'project' ? 'project' : 'user'}</code>
                      {a.model && <code>{a.model}</code>}
                    </div>
                  </div>
                </button>
              );
            })}
            {sortedAgents.length === 0 && (
              <div className="empty-hint">
                No agents yet. Open <b>Settings → Agents</b> to create one.
              </div>
            )}
          </>
        )}

        {/* ── Other section ────────────────────────────────────────── */}
        <WorkerSectionHeader
          title="Other"
          count={sortedPresets.length}
          collapsed={otherCollapsed}
          onToggle={() => setOtherCollapsed((v) => !v)}
        />
        {!otherCollapsed && (
          <>
            {sortedPresets.map((preset) => {
              const isActive = activePresetId === preset.id;
              // Plain Terminal has no `command` (it just runs the
              // user's login shell, which is always present), so we
              // treat it as always-installed.
              const isInstalled = preset.command
                ? (installed[preset.command] ?? null)
                : true;
              const installKnown = isInstalled !== null;
              return (
                <button
                  key={preset.id}
                  type="button"
                  className={
                    'list-item preset-card' +
                    (isActive ? ' active' : '') +
                    (presetsLocked ? ' disabled' : '') +
                    (installKnown && !isInstalled
                      ? ' preset-card-missing'
                      : '')
                  }
                  disabled={presetsLocked}
                  title={
                    presetsLocked
                      ? activePaneId === leadPaneId
                        ? "Lead pane is reserved for the orchestrator agent — terminal workers can't bind to it."
                        : 'Pick a pane first, then drop a worker on it.'
                      : installKnown && !isInstalled
                        ? `${preset.name} isn't on your PATH. Drop it on a pane anyway and the shell will say "command not found" — install \`${preset.command}\` first.`
                        : `${preset.name} — runs \`${
                            preset.command || 'login shell'
                          }\` in the project folder.`
                  }
                  onClick={async () => {
                    if (!activePaneId || presetsLocked) return;
                    // Re-probe just this command first — the user
                    // may have just finished an install and clicked
                    // expecting it to "now work". The fresh probe
                    // result wins over our cached `installed` map
                    // in the very next decision below; a successful
                    // detection here lets the click fall straight
                    // through to setPaneToTerminal.
                    let freshInstalled = isInstalled;
                    if (
                      installKnown &&
                      !isInstalled &&
                      preset.command
                    ) {
                      const fresh = await probe([preset.command]);
                      freshInstalled = fresh[preset.command] ?? false;
                    }
                    // Block missing CLIs — if the underlying command
                    // isn't on PATH, the spawned shell will print
                    // "command not found" and look broken. Better
                    // to surface the install step explicitly.
                    if (
                      installKnown &&
                      !freshInstalled &&
                      preset.command
                    ) {
                      const installHint = installCommandFor(preset.id);
                      if (!installHint) {
                        // No suggested install we know about; still
                        // tell the user what's missing so they can
                        // install it manually.
                        alert(
                          `${preset.name} isn't on your PATH. Install \`${preset.command}\` with your package manager, then click again.`,
                        );
                        return;
                      }
                      const lines = [
                        `${preset.name} isn't installed.`,
                        '',
                        `Run this in the terminal panel?`,
                        `  ${installHint}`,
                        '',
                        'Press OK to install, or Cancel to dismiss.',
                      ];
                      const ok = confirm(lines.join('\n'));
                      if (ok) {
                        // Hand off to the bottom-bar TerminalPanel:
                        // it opens itself, lazy-spawns its PTY if
                        // needed, then types the install command +
                        // Enter. The user watches the install play
                        // out and can re-click the preset once it's
                        // done — a fresh PATH probe runs on next
                        // mount of the Workers tab.
                        window.dispatchEvent(
                          new CustomEvent<string>('inzone:terminal-run', {
                            detail: installHint,
                          }),
                        );
                      }
                      return;
                    }
                    const current = panes[activePaneId];
                    // Confirm before swapping out an existing agent
                    // — same affordance the agent cards offer when
                    // clicking on a different agent than the bound one.
                    if (
                      current?.agentName &&
                      current.workerKind !== 'terminal'
                    ) {
                      const ok = confirm(
                        `Replace ${current.agentName} with ${preset.name} in this pane? The current conversation will end and any unsaved context will be lost.`,
                      );
                      if (!ok) return;
                    }
                    void setPaneToTerminal(activePaneId, preset.id);
                  }}
                >
                  <span className="preset-card-pillar" aria-hidden />
                  <span className="preset-card-icon" aria-hidden>
                    <WorkerPresetIcon icon={preset.id} />
                  </span>
                  <div className="preset-card-body">
                    <div className="preset-card-name">
                      <span>{preset.name}</span>
                      {installKnown && !isInstalled && (
                        <span
                          className="preset-card-missing-pill"
                          aria-label="Not installed"
                        >
                          not installed
                        </span>
                      )}
                    </div>
                    <div className="preset-card-desc">
                      {preset.description}
                    </div>
                    <div className="preset-card-meta">
                      {preset.command ? (
                        <code>{preset.command}</code>
                      ) : (
                        <code>$SHELL</code>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}

/**
 * Collapsible section header — chevron rotates when open, count
 * badge sits to the right. Click anywhere on the header to toggle.
 * Keyboard-accessible by virtue of being a real button.
 */
interface WorkerSectionHeaderProps {
  title: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}
function WorkerSectionHeader({
  title,
  count,
  collapsed,
  onToggle,
}: WorkerSectionHeaderProps) {
  return (
    <button
      type="button"
      className={
        'workers-section-header' + (collapsed ? ' collapsed' : '')
      }
      onClick={onToggle}
      aria-expanded={!collapsed}
    >
      <span className="workers-section-chevron" aria-hidden>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </span>
      <span className="workers-section-title">{title}</span>
      <span className="workers-section-count">{count}</span>
    </button>
  );
}

// localStorage helpers — small, untyped, and only used here.
function readBool(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === '1';
  } catch {
    return fallback;
  }
}
function writeBool(key: string, value: boolean) {
  try {
    localStorage.setItem(key, value ? '1' : '0');
  } catch {
    // ignore — storage may be unavailable in some test contexts
  }
}

// ─── Tab icons ─────────────────────────────────────────────────────────

function TabIconSessions() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="4" width="18" height="6" rx="2" />
      <rect x="3" y="14" width="18" height="6" rx="2" />
    </svg>
  );
}

/**
 * Workers icon — a person silhouette overlaid with a small wrench/dot
 * suggesting "doer of work". Replaces the previous head-and-shoulders
 * Agents icon since this tab now contains both LLM agents and CLI
 * tools. We keep the figure recognisable at 16px and add a small
 * accent dot top-right to differentiate from the plain person glyph.
 */
function TabIconWorkers() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="11" cy="8" r="3.5" />
      <path d="M4 21c0-3.5 3.4-6.2 7-6.2s7 2.7 7 6.2" />
      <circle cx="19" cy="6" r="2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function TabIconVoice() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <line x1="12" y1="18" x2="12" y2="22" />
    </svg>
  );
}
