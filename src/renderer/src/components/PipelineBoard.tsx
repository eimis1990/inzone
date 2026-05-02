import { useEffect, useMemo, useRef, useState } from 'react';
import { getAgentColor } from '@shared/palette';
import type {
  PaneId,
  PaneNode,
  PipelineStep,
} from '@shared/types';
import { findWorkerPreset } from '@shared/worker-presets';
import { getPaneDisplayName, useStore, type ChatItem } from '../store';
import { WorkerPresetIcon } from './worker-presets';

/** Walk the pane tree and return every leaf id. */
function collectLeavesIds(node: PaneNode, out: PaneId[] = []): PaneId[] {
  if (node.kind === 'leaf') {
    out.push(node.id);
  } else {
    for (const c of node.children) collectLeavesIds(c, out);
  }
  return out;
}

const CARD_WIDTH = 300;
// Card now houses head + prompt textarea + controls — bumped from 130
// to 220 so the textarea has breathing room and the bezier endpoints
// (which anchor at CARD_HEIGHT/2) still land on the card's vertical
// midline visually.
const CARD_HEIGHT = 220;
// Terminal info-cards on the Flow board are tighter — no prompt
// textarea, no order/wait selectors, just preset logo + name +
// command + a one-line note. Width matches so they look like a
// shorter sibling of regular cards rather than a different shape.
const TERMINAL_CARD_WIDTH = 260;
const TERMINAL_CARD_HEIGHT = 110;

/** Walk the tree and surface every terminal-kind leaf with its preset id. */
function collectTerminalLeaves(
  node: PaneNode,
  out: Array<{ id: PaneId; presetId?: string }> = [],
): Array<{ id: PaneId; presetId?: string }> {
  if (node.kind === 'leaf') {
    if (node.workerKind === 'terminal') {
      out.push({ id: node.id, presetId: node.presetId });
    }
  } else {
    for (const c of node.children) collectTerminalLeaves(c, out);
  }
  return out;
}
const DELAY_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 0, label: 'Right away' },
  { value: 1000, label: 'Delay 1s' },
  { value: 2000, label: 'Delay 2s' },
  { value: 5000, label: 'Delay 5s' },
];

/**
 * Flow board v2 — n8n-style canvas. Cards are absolutely positioned
 * and freely draggable. Connection lines are SVG bezier curves drawn
 * between consecutive steps in execution order, recomputed live as
 * cards drag. A right-side logs panel slides in over the canvas to
 * show the selected step's live event feed (status + tools + reply).
 */
export function PipelineBoard() {
  const tree = useStore((s) => s.tree);
  const panes = useStore((s) => s.panes);
  const agents = useStore((s) => s.agents);
  const pipeline = useStore((s) => s.pipeline);
  // See PipelineBoard's earlier history: returning `{ paneId, paneName }`
  // directly from a Zustand selector creates a new object on every
  // render and ends in "Maximum update depth exceeded". Subscribe to
  // primitives, derive the object with useMemo.
  const leadPaneId = useStore((s) => s.leadPaneId);
  const leadPaneName = useStore((s) => s.leadPaneName);
  const leadPane = useMemo(
    () =>
      leadPaneId
        ? { paneId: leadPaneId, paneName: leadPaneName ?? undefined }
        : null,
    [leadPaneId, leadPaneName],
  );
  const setStepOrder = useStore((s) => s.setStepOrder);
  const setStepPosition = useStore((s) => s.setStepPosition);
  const setStepDelay = useStore((s) => s.setStepDelay);
  const setStepPrompt = useStore((s) => s.setStepPrompt);
  const runFlow = useStore((s) => s.runFlow);
  const toggleEnabled = useStore((s) => s.togglePipelineEnabled);

  void collectLeavesIds; // shared helper retained for future use

  const stepsMissingAgent = useMemo(() => {
    if (!pipeline) return [] as number[];
    return pipeline.steps
      .map((s, i) => (panes[s.paneId]?.agentName ? -1 : i))
      .filter((i) => i >= 0);
  }, [pipeline, panes]);
  const enabled = !!pipeline?.enabled;

  // "Running" = at least one step's pane is mid-turn. This is what
  // changes the toolbar button from "Run Flow" → "Running…" and
  // disables it so the user can't fire a duplicate kickoff.
  const flowRunning = useMemo(() => {
    if (!pipeline?.enabled) return false;
    return pipeline.steps.some((s) => {
      const st = panes[s.paneId]?.status;
      return st === 'streaming' || st === 'starting';
    });
  }, [pipeline, panes]);

  // Canvas measurement — used to size the SVG overlay so it can match
  // the scrollable area's natural extent.
  const [canvasSize, setCanvasSize] = useState({ w: 1200, h: 600 });

  // Logs side panel state.
  const [logsForStepId, setLogsForStepId] = useState<string | null>(null);

  // Background-drag panning. Click empty canvas, drag, scroll the
  // viewport. Implemented as direct scrollLeft/scrollTop writes on
  // the wrap element — no transform layer needed. The same ref is
  // used for measuring the viewport (for SVG sizing).
  const wrapRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const resize = () => {
      const rect = el.getBoundingClientRect();
      setCanvasSize({ w: rect.width, h: rect.height });
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const panRef = useRef<{
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
  } | null>(null);
  const [panning, setPanning] = useState(false);
  const onCanvasMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // Don't start a pan if the click landed on a card or interactive
    // child — those handle their own pointer events.
    if (
      (e.target as HTMLElement).closest(
        '.flow-card, .flow-logs-panel, button, select, input, textarea',
      )
    ) {
      return;
    }
    // When Flow is off, the board is read-only — no panning either,
    // so the locked state feels uniformly inert.
    if (!enabled) return;
    const wrap = wrapRef.current;
    if (!wrap) return;
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: wrap.scrollLeft,
      scrollTop: wrap.scrollTop,
    };
    setPanning(true);
    e.preventDefault();
  };
  useEffect(() => {
    if (!panning) return;
    const onMove = (e: MouseEvent) => {
      const pan = panRef.current;
      const wrap = wrapRef.current;
      if (!pan || !wrap) return;
      wrap.scrollLeft = pan.scrollLeft - (e.clientX - pan.startX);
      wrap.scrollTop = pan.scrollTop - (e.clientY - pan.startY);
    };
    const onUp = () => {
      panRef.current = null;
      setPanning(false);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [panning]);

  // Drag state. Tracked locally so we don't write to the store on
  // every mousemove (would saturate the persistence layer); we only
  // persist the final position on mouseup.
  const dragRef = useRef<{
    stepId: string;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  const [livePositions, setLivePositions] = useState<
    Record<string, { x: number; y: number }>
  >({});

  // Position resolver — uses live drag offset if dragging, else the
  // step's persisted position, else falls back to a centered
  // horizontal-row layout based on index. Centering uses the live
  // canvas viewport size so the row sits in the middle of whatever
  // window the user has, instead of pinned to the top-left.
  const positions = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    const steps = pipeline?.steps ?? [];
    const GAP = 60;
    // Number of cards that don't have their own saved position —
    // those participate in the centered fallback row.
    const unposed = steps.filter((s) => !s.position);
    const totalRowW =
      unposed.length * CARD_WIDTH + Math.max(0, unposed.length - 1) * GAP;
    const startX = Math.max(40, (canvasSize.w - totalRowW) / 2);
    const startY = Math.max(40, (canvasSize.h - CARD_HEIGHT) / 2);
    let unposedIdx = 0;
    steps.forEach((s) => {
      if (livePositions[s.id]) {
        out[s.id] = livePositions[s.id];
      } else if (s.position) {
        out[s.id] = s.position;
      } else {
        out[s.id] = {
          x: startX + unposedIdx * (CARD_WIDTH + GAP),
          y: startY,
        };
        unposedIdx += 1;
      }
    });
    return out;
  }, [pipeline, livePositions, canvasSize]);

  const onCardDragStart = (
    stepId: string,
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    // Cards are immovable while Flow is off — the entire board is
    // read-only in that mode.
    if (!enabled) return;
    if ((e.target as HTMLElement).closest('button, select, input, textarea')) {
      return;
    }
    const pos = positions[stepId] ?? { x: 0, y: 0 };
    dragRef.current = {
      stepId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    };
    e.preventDefault();
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { stepId, startX, startY, originX, originY } = dragRef.current;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      setLivePositions((prev) => ({
        ...prev,
        [stepId]: { x: originX + dx, y: originY + dy },
      }));
    };
    const onUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      const last = livePositions[drag.stepId];
      dragRef.current = null;
      if (last) {
        setStepPosition(drag.stepId, Math.round(last.x), Math.round(last.y));
      }
      setLivePositions({});
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [livePositions, setStepPosition]);

  // Compute bezier paths between step N → step N+1 in execution order.
  // Anchor points are right edge of source card and left edge of target.
  // Endpoints are also returned so we can render small dots at the
  // connection points for the n8n-style polish.
  const paths = useMemo(() => {
    const steps = pipeline?.steps ?? [];
    const out: Array<{
      d: string;
      ax: number; ay: number;
      bx: number; by: number;
    }> = [];
    for (let i = 0; i < steps.length - 1; i++) {
      const a = positions[steps[i].id];
      const b = positions[steps[i + 1].id];
      if (!a || !b) continue;
      const ax = a.x + CARD_WIDTH;
      const ay = a.y + CARD_HEIGHT / 2;
      const bx = b.x;
      const by = b.y + CARD_HEIGHT / 2;
      // Control-point offset that scales with BOTH dx and dy. Pure
      // horizontal-distance scaling produces tight S-curves when
      // cards are stacked vertically; weighing in dy gives the curve
      // room to ease in at both ends. Min 70px so even adjacent
      // cards still get a gentle swing rather than a near-straight
      // line. Capped at 240px so distant cards don't wrap absurdly.
      const dx = Math.abs(bx - ax);
      const dy = Math.abs(by - ay);
      const offset = Math.max(70, Math.min(240, dx * 0.5 + dy * 0.35));
      const d = `M ${ax} ${ay} C ${ax + offset} ${ay} ${bx - offset} ${by} ${bx} ${by}`;
      out.push({ d, ax, ay, bx, by });
    }
    return out;
  }, [pipeline, positions]);

  // Terminal-pane info cards. These DON'T participate in the chain —
  // their PTYs aren't run by the flow engine — but we still surface
  // them on the board so the user has a complete picture of what's in
  // their project. Position is purely local (resets on reload). Drag
  // handling mirrors the agent cards but writes to local state only.
  const terminalLeaves = useMemo(
    () => collectTerminalLeaves(tree),
    [tree],
  );
  const [terminalPositions, setTerminalPositions] = useState<
    Record<string, { x: number; y: number }>
  >({});
  const terminalDragRef = useRef<{
    paneId: PaneId;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
  } | null>(null);
  // Default layout for terminal cards: a row tucked under the chain
  // row, indented so they read as "extras" rather than chain cards.
  const terminalLayout = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    const steps = pipeline?.steps ?? [];
    // Y position = below the agent-card row + a comfortable gap. If
    // no steps exist, just sit a bit below the canvas vertical
    // centre so they aren't pinned to the top.
    const stepYs = steps
      .map((s) => positions[s.id]?.y)
      .filter((y): y is number => typeof y === 'number');
    const baseY =
      stepYs.length > 0
        ? Math.max(...stepYs) + CARD_HEIGHT + 60
        : Math.max(80, canvasSize.h / 2 + CARD_HEIGHT / 2 + 60);
    const GAP = 24;
    const totalRowW =
      terminalLeaves.length * TERMINAL_CARD_WIDTH +
      Math.max(0, terminalLeaves.length - 1) * GAP;
    const startX = Math.max(60, (canvasSize.w - totalRowW) / 2);
    terminalLeaves.forEach((leaf, i) => {
      out[leaf.id] = {
        x: startX + i * (TERMINAL_CARD_WIDTH + GAP),
        y: baseY,
      };
    });
    return out;
  }, [terminalLeaves, pipeline, positions, canvasSize]);
  const terminalResolvedPositions = useMemo(() => {
    const out: Record<string, { x: number; y: number }> = {};
    for (const leaf of terminalLeaves) {
      out[leaf.id] =
        terminalPositions[leaf.id] ?? terminalLayout[leaf.id];
    }
    return out;
  }, [terminalLeaves, terminalPositions, terminalLayout]);

  const onTerminalDragStart = (
    paneId: PaneId,
    e: React.MouseEvent<HTMLDivElement>,
  ) => {
    if ((e.target as HTMLElement).closest('button, a')) return;
    const pos = terminalResolvedPositions[paneId] ?? { x: 0, y: 0 };
    terminalDragRef.current = {
      paneId,
      startX: e.clientX,
      startY: e.clientY,
      originX: pos.x,
      originY: pos.y,
    };
    e.preventDefault();
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const drag = terminalDragRef.current;
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      setTerminalPositions((prev) => ({
        ...prev,
        [drag.paneId]: {
          x: drag.originX + dx,
          y: drag.originY + dy,
        },
      }));
    };
    const onUp = () => {
      terminalDragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // Compute the SVG canvas viewport — must extend to cover the
  // farthest card plus padding. Includes the terminal info cards
  // even though they have no chain edges, so the user can drag
  // them anywhere without the canvas clipping.
  const svgSize = useMemo(() => {
    const steps = pipeline?.steps ?? [];
    let maxX = 800;
    let maxY = 400;
    for (const s of steps) {
      const p = positions[s.id];
      if (!p) continue;
      maxX = Math.max(maxX, p.x + CARD_WIDTH + 200);
      maxY = Math.max(maxY, p.y + CARD_HEIGHT + 200);
    }
    for (const leaf of terminalLeaves) {
      const p = terminalResolvedPositions[leaf.id];
      if (!p) continue;
      maxX = Math.max(maxX, p.x + TERMINAL_CARD_WIDTH + 200);
      maxY = Math.max(maxY, p.y + TERMINAL_CARD_HEIGHT + 200);
    }
    return { w: Math.max(maxX, canvasSize.w), h: Math.max(maxY, canvasSize.h) };
  }, [pipeline, positions, canvasSize, terminalLeaves, terminalResolvedPositions]);

  return (
    <div className="flow-board">
      <div className="flow-toolbar">
        <span className="flow-toolbar-label">Flow</span>
        <span className="flow-toolbar-sub">
          {enabled
            ? 'Sync execution: each pane fires the next when it finishes.'
            : 'Off: panes run independently. Enable to chain them.'}
        </span>
        <div className="flow-toolbar-spacer" />
        {/* Toggle first, then Run Flow on the right. Run Flow stays
            visible at all times so the disabled state is discoverable;
            its tooltip explains what's blocking it. */}
        <button
          type="button"
          role="switch"
          aria-checked={enabled}
          className={'flow-switch' + (enabled ? ' on' : '')}
          onClick={() => toggleEnabled()}
          title={enabled ? 'Disable flow' : 'Enable flow'}
        >
          {/* Knob is nested INSIDE the track so its absolute
              positioning anchors to the track's bounds, not to the
              parent button. Without this nesting the knob lived in
              the .flow-switch coordinate space and the inset/translate
              math would never land it flush at the rounded ends. */}
          <span className="flow-switch-track">
            <span className="flow-switch-knob" />
          </span>
          <span className="flow-switch-label">{enabled ? 'On' : 'Off'}</span>
        </button>
        {(() => {
          const firstStep = pipeline?.steps[0];
          const firstHasPrompt = !!(firstStep?.prompt ?? '').trim();
          const allHaveAgents =
            !!pipeline && pipeline.steps.length > 0 && stepsMissingAgent.length === 0;
          const hasSteps = !!pipeline && pipeline.steps.length > 0;
          const canRun =
            enabled &&
            hasSteps &&
            firstHasPrompt &&
            allHaveAgents &&
            !flowRunning;
          const tooltip = flowRunning
            ? 'Flow is already running — wait for it to finish.'
            : !enabled
              ? 'Turn Flow on first.'
              : !hasSteps
                ? 'Add at least one step to the flow.'
                : !allHaveAgents
                  ? 'Assign agents to every step first.'
                  : !firstHasPrompt
                    ? 'Type a prompt in step 1 to kick off the chain.'
                    : 'Send step 1 — the chain auto-fires the rest.';
          return (
            <button
              type="button"
              className={
                'primary flow-run-btn' + (flowRunning ? ' flow-run-btn-running' : '')
              }
              onClick={() => void runFlow()}
              disabled={!canRun}
              title={tooltip}
              style={{ marginLeft: 10 }}
            >
              {flowRunning ? (
                <>
                  <span className="flow-run-spinner" aria-hidden /> Running…
                </>
              ) : (
                <>▶ Run Flow</>
              )}
            </button>
          );
        })()}
      </div>

      {enabled && stepsMissingAgent.length > 0 && (
        <div className="flow-warning">
          {stepsMissingAgent.length === 1
            ? `Step ${stepsMissingAgent[0] + 1} has no agent — that pane won't pass output to the next step.`
            : `${stepsMissingAgent.length} steps don't have an agent — those panes will break the chain.`}
        </div>
      )}

      <div
        className={
          'flow-canvas-wrap' +
          (enabled ? '' : ' flow-canvas-dim') +
          (panning ? ' panning' : '')
        }
        ref={wrapRef}
        onMouseDown={onCanvasMouseDown}
      >
        <div
          className="flow-canvas-scroll"
          style={{
            width: svgSize.w,
            height: svgSize.h,
          }}
        >
          {/* SVG layer with bezier connection lines. Sits behind the
              cards so cards always read clean on top. */}
          <svg
            className="flow-canvas-svg"
            width={svgSize.w}
            height={svgSize.h}
            viewBox={`0 0 ${svgSize.w} ${svgSize.h}`}
          >
            <defs>
              {/* Solid arrow head, tucked tight against the line end so
                  the marker tip touches the receiving card's left edge.
                  refX=9 + markerWidth=10 means the tip lands exactly
                  at the path endpoint. */}
              <marker
                id="flow-arrow"
                viewBox="0 0 10 10"
                refX="9"
                refY="5"
                markerWidth="10"
                markerHeight="10"
                orient="auto-start-reverse"
              >
                <path
                  d="M 0 0 L 10 5 L 0 10 z"
                  fill="rgba(255, 255, 255, 0.92)"
                />
              </marker>
            </defs>
            {paths.map((p, i) => (
              <g key={i}>
                <path
                  d={p.d}
                  fill="none"
                  stroke="rgba(255, 255, 255, 0.55)"
                  strokeWidth="1.75"
                  strokeLinecap="round"
                  markerEnd="url(#flow-arrow)"
                />
                {/* Small dots at each connection point — same trick
                    n8n / Make use to make the line feel "anchored"
                    rather than floating off the card edge. */}
                <circle
                  cx={p.ax}
                  cy={p.ay}
                  r="3"
                  fill="rgba(255, 255, 255, 0.72)"
                />
                <circle
                  cx={p.bx}
                  cy={p.by}
                  r="3"
                  fill="rgba(255, 255, 255, 0.72)"
                />
              </g>
            ))}
          </svg>

          {(!pipeline || pipeline.steps.length === 0) && (
            <div className="flow-empty">
              Add at least two panes with agents in the panes view, then
              come back — Flow auto-populates from your panes.
            </div>
          )}

          {pipeline?.steps.map((step, idx) => {
            const runtime = panes[step.paneId];
            const agent = runtime?.agentName
              ? agents.find((a) => a.name === runtime.agentName)
              : undefined;
            const color = agent ? getAgentColor(agent.color) : null;
            const display = runtime
              ? getPaneDisplayName(tree, step.paneId, leadPane)
              : { name: 'Pane', isCustom: false };
            const pos = positions[step.id];
            return (
              <FlowCard
                key={step.id}
                index={idx}
                total={pipeline.steps.length}
                step={step}
                paneLabel={display.name}
                agentName={runtime?.agentName}
                agentEmoji={agent?.emoji}
                accent={color?.vivid}
                paneStatus={runtime?.status}
                position={pos}
                disabled={!enabled}
                selected={logsForStepId === step.id}
                onDragStart={(e) => onCardDragStart(step.id, e)}
                onOrderChange={(idx) => setStepOrder(step.id, idx)}
                onDelayChange={(ms) => setStepDelay(step.id, ms)}
                onPromptChange={(prompt) => setStepPrompt(step.id, prompt)}
                onOpenLogs={() =>
                  setLogsForStepId((curr) =>
                    curr === step.id ? null : step.id,
                  )
                }
              />
            );
          })}

          {/* Standalone terminal info-cards. Independent of the
              chain, draggable, no edges. Renders below the chain
              row by default but the user can park them wherever. */}
          {terminalLeaves.map((leaf) => {
            const pos = terminalResolvedPositions[leaf.id];
            if (!pos) return null;
            const preset = findWorkerPreset(leaf.presetId);
            return (
              <TerminalFlowCard
                key={leaf.id}
                paneId={leaf.id}
                presetId={leaf.presetId}
                presetName={preset?.name ?? 'Terminal'}
                command={preset?.command ?? ''}
                position={pos}
                onDragStart={(e) => onTerminalDragStart(leaf.id, e)}
              />
            );
          })}
        </div>
      </div>

      {logsForStepId && (
        <FlowLogsPanel
          stepId={logsForStepId}
          onClose={() => setLogsForStepId(null)}
        />
      )}
    </div>
  );
}

interface FlowCardProps {
  index: number;
  total: number;
  step: PipelineStep;
  paneLabel: string;
  agentName?: string;
  agentEmoji?: string;
  accent?: string;
  paneStatus?: string;
  position: { x: number; y: number };
  disabled?: boolean;
  selected?: boolean;
  onDragStart: (e: React.MouseEvent<HTMLDivElement>) => void;
  onOrderChange: (newIndex: number) => void;
  onDelayChange: (delayMs: number) => void;
  onPromptChange: (prompt: string) => void;
  onOpenLogs: () => void;
}

/**
 * Terminal-pane info card on the Flow board. Smaller than a
 * regular FlowCard, no prompt input, no order/wait selectors, no
 * chain edges — just a label so the user knows the pane exists in
 * their project. Draggable so it doesn't get in the way.
 */
interface TerminalFlowCardProps {
  paneId: PaneId;
  presetId?: string;
  presetName: string;
  command: string;
  position: { x: number; y: number };
  onDragStart: (e: React.MouseEvent<HTMLDivElement>) => void;
}
function TerminalFlowCard({
  paneId,
  presetId,
  presetName,
  command,
  position,
  onDragStart,
}: TerminalFlowCardProps) {
  return (
    <div
      className="flow-card flow-card-terminal"
      style={{
        left: position.x,
        top: position.y,
        width: TERMINAL_CARD_WIDTH,
        height: TERMINAL_CARD_HEIGHT,
      }}
      onMouseDown={onDragStart}
      data-pane-id={paneId}
    >
      <div className="flow-card-terminal-head">
        <div className="flow-card-terminal-icon" aria-hidden>
          {presetId && (
            <WorkerPresetIcon
              icon={presetId as Parameters<typeof WorkerPresetIcon>[0]['icon']}
              size={20}
            />
          )}
        </div>
        <div className="flow-card-terminal-titles">
          <div className="flow-card-terminal-name">{presetName}</div>
          <div className="flow-card-terminal-cmd">
            {command ? `$ ${command}` : '$ shell'}
          </div>
        </div>
      </div>
      <div className="flow-card-terminal-note">
        Terminal panes don't run in Flow.
      </div>
    </div>
  );
}

function FlowCard({
  index,
  total,
  step,
  paneLabel,
  agentName,
  agentEmoji,
  accent,
  paneStatus,
  position,
  disabled,
  selected,
  onDragStart,
  onOrderChange,
  onDelayChange,
  onPromptChange,
  onOpenLogs,
}: FlowCardProps) {
  const needsAgent = !agentName;
  // Map raw pane status into a friendlier label for the chip.
  const statusInfo = labelForStatus(paneStatus);

  return (
    <div
      className={
        'flow-card flow-card-v2' +
        (needsAgent ? ' flow-card-needs-agent' : '') +
        (disabled ? ' flow-card-disabled' : '') +
        (selected ? ' flow-card-selected' : '')
      }
      style={{
        ['--card-accent' as string]: accent ?? 'var(--text-dim)',
        left: position.x,
        top: position.y,
        width: CARD_WIDTH,
      }}
      onMouseDown={onDragStart}
    >
      <span className="flow-card-stripe" aria-hidden />

      <div className="flow-card-head">
        <div className="flow-card-emoji" aria-hidden>
          {agentEmoji ?? '🧩'}
        </div>
        <div className="flow-card-text">
          <div className="flow-card-title">{paneLabel}</div>
          <div className="flow-card-subtitle">
            {agentName ?? <em>no agent</em>}
          </div>
        </div>
        <span className={'flow-card-status flow-card-status-' + statusInfo.kind}>
          {statusInfo.label}
        </span>
      </div>

      {/* Prompt for this step. When Flow is on, panes have their
          composer disabled — the user types the message here instead.
          Step 1 kicks off the chain when Run Flow is pressed; later
          steps support a {previous} placeholder that is replaced with
          the prior step's reply. If no placeholder is present we still
          append the previous output below the user's prompt so the
          context isn't lost. */}
      <textarea
        className="flow-card-prompt"
        value={step.prompt ?? ''}
        onChange={(e) => onPromptChange(e.target.value)}
        placeholder={
          disabled
            ? 'Turn Flow on to edit this prompt.'
            : index === 0
              ? 'What should this flow do?'
              : 'Use {previous} for the prior step output…'
        }
        rows={3}
        spellCheck={false}
        readOnly={disabled}
        // Prevent the card-drag handler from kicking in when the user
        // is just trying to drag-select inside the textarea.
        onMouseDown={(e) => e.stopPropagation()}
      />

      <div className="flow-card-controls">
        <label className="flow-card-control">
          <span>Order</span>
          <select
            value={index}
            onChange={(e) => onOrderChange(Number(e.target.value))}
            disabled={disabled}
          >
            {Array.from({ length: total }).map((_, i) => (
              <option key={i} value={i}>
                {i + 1}
              </option>
            ))}
          </select>
        </label>
        <label className="flow-card-control">
          <span>Wait</span>
          <select
            value={step.delayMs ?? 0}
            onChange={(e) => onDelayChange(Number(e.target.value))}
            disabled={disabled}
          >
            {DELAY_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className={
            'flow-card-logs-btn' + (selected ? ' flow-card-logs-btn-active' : '')
          }
          onClick={onOpenLogs}
          title={
            disabled
              ? 'Turn Flow on to inspect logs.'
              : selected
                ? "Hide this step's logs"
                : "View this step's live activity"
          }
          disabled={disabled}
        >
          {selected ? 'Logs ✓' : 'Logs'}
        </button>
      </div>
    </div>
  );
}

/** Map raw `PaneRuntime.status` to a human-friendly chip label. */
function labelForStatus(
  status?: string,
): { kind: 'idle' | 'working' | 'done' | 'error'; label: string } {
  if (!status) return { kind: 'idle', label: 'idle' };
  if (status === 'streaming' || status === 'starting') {
    return { kind: 'working', label: 'working' };
  }
  if (status === 'error') return { kind: 'error', label: 'error' };
  if (status === 'waiting_for_input') return { kind: 'done', label: 'idle' };
  if (status === 'stopped') return { kind: 'idle', label: 'stopped' };
  return { kind: 'idle', label: status };
}

interface LogsPanelProps {
  stepId: string;
  onClose: () => void;
}

/**
 * Side-panel that slides in over the right edge of the flow board.
 * Renders a compact event feed for the currently-selected step:
 * status pill, tool calls, then the agent's last assistant text.
 * Live — auto-updates via the same store subscriptions Pane uses.
 */
function FlowLogsPanel({ stepId, onClose }: LogsPanelProps) {
  const pipeline = useStore((s) => s.pipeline);
  const step = pipeline?.steps.find((s) => s.id === stepId);
  const pane = useStore((s) =>
    step ? s.panes[step.paneId] : undefined,
  );
  const agents = useStore((s) => s.agents);
  const tree = useStore((s) => s.tree);
  const leadPaneId = useStore((s) => s.leadPaneId);
  const leadPaneName = useStore((s) => s.leadPaneName);
  const leadPane = useMemo(
    () =>
      leadPaneId
        ? { paneId: leadPaneId, paneName: leadPaneName ?? undefined }
        : null,
    [leadPaneId, leadPaneName],
  );

  // Autoscroll — same "stick to bottom unless user has scrolled up"
  // pattern Pane uses for its chat. We track whether the feed is
  // pinned to the bottom; on every render that the user is pinned,
  // we re-pin (cheap — direct scrollTop write). If the user scrolls
  // up to read older messages, we drop out of stick mode and leave
  // them alone until they scroll back down to the bottom themselves.
  const feedRef = useRef<HTMLDivElement>(null);
  const [stickToBottom, setStickToBottom] = useState(true);

  // Switching steps resets us back to "follow the new feed" — the
  // prior step's scroll position would be irrelevant anyway.
  useEffect(() => {
    setStickToBottom(true);
  }, [stepId]);

  // Number of items in the latest turn — cheap dep that fires when
  // new tool calls or assistant text bubbles arrive. Plus pane.status
  // so we still re-pin when only the status changes (e.g. final
  // result event arriving with no new items in the feed array).
  const lastUserIdxAll = (() => {
    if (!pane) return -1;
    for (let i = pane.items.length - 1; i >= 0; i--) {
      if (pane.items[i].kind === 'user') return i;
    }
    return -1;
  })();
  const recentCount = pane ? pane.items.length - 1 - lastUserIdxAll : 0;
  const lastItemId = pane?.items[pane.items.length - 1]?.id ?? '';

  useEffect(() => {
    if (!stickToBottom) return;
    const el = feedRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [stickToBottom, recentCount, lastItemId, pane?.status]);

  const onFeedScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    // Threshold of 60px tolerates browser rounding and tiny adjustments
    // while a long assistant message streams in below the viewport.
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    setStickToBottom(distanceFromBottom < 60);
  };

  if (!step || !pane) return null;
  const agent = agents.find((a) => a.name === pane.agentName);
  const display = getPaneDisplayName(tree, step.paneId, leadPane);
  // Reduce items to the latest turn: from last `user` to end.
  const lastUserIdx = lastUserIdxAll;
  const recent: ChatItem[] = pane.items.slice(lastUserIdx + 1);
  const status = labelForStatus(pane.status);

  return (
    <div className="flow-logs-panel">
      <div className="flow-logs-head">
        <div className="flow-logs-title">
          <span className="flow-logs-emoji">{agent?.emoji ?? '🧩'}</span>
          <div>
            <div className="flow-logs-name">{display.name}</div>
            <div className="flow-logs-agent">{pane.agentName ?? 'no agent'}</div>
          </div>
        </div>
        <button
          type="button"
          className="flow-logs-close"
          onClick={onClose}
          aria-label="Close logs panel"
        >
          ✕
        </button>
      </div>

      <div className="flow-logs-status-row">
        <span
          className={'flow-card-status flow-card-status-' + status.kind}
        >
          {status.label}
        </span>
        {pane.error && (
          <span className="flow-logs-error">{pane.error}</span>
        )}
      </div>

      <div
        className="flow-logs-feed"
        ref={feedRef}
        onScroll={onFeedScroll}
      >
        {recent.length === 0 && (
          <div className="flow-logs-empty">
            No activity yet on this step's current turn.
          </div>
        )}
        {recent.map((item) => (
          <LogItem key={item.id} item={item} />
        ))}
      </div>

      {/* "Jump to latest" pill — appears only when the user has
          scrolled up. One click pulls them back to the live edge. */}
      {!stickToBottom && (
        <button
          type="button"
          className="flow-logs-jump-btn"
          onClick={() => {
            const el = feedRef.current;
            if (el) el.scrollTop = el.scrollHeight;
            setStickToBottom(true);
          }}
        >
          ↓ Jump to latest
        </button>
      )}
    </div>
  );
}

function LogItem({ item }: { item: ChatItem }) {
  if (item.kind === 'tool_use') {
    return (
      <div className="flow-logs-event flow-logs-event-tool">
        <span className="flow-logs-event-icon">🔧</span>
        <div className="flow-logs-event-body">
          <div className="flow-logs-event-name">{item.name}</div>
          <div className="flow-logs-event-detail">
            {summarizeInput(item.input)}
          </div>
        </div>
      </div>
    );
  }
  if (item.kind === 'assistant_text') {
    return (
      <div className="flow-logs-event flow-logs-event-text">
        <span className="flow-logs-event-icon">💬</span>
        <div className="flow-logs-event-body">{item.text}</div>
      </div>
    );
  }
  if (item.kind === 'result') {
    const cost =
      typeof item.totalCostUsd === 'number'
        ? `$${item.totalCostUsd.toFixed(4)}`
        : '—';
    const dur =
      typeof item.durationMs === 'number'
        ? `${(item.durationMs / 1000).toFixed(1)}s`
        : '—';
    return (
      <div className="flow-logs-event flow-logs-event-result">
        <span className="flow-logs-event-icon">
          {item.subtype === 'success' ? '✓' : '!'}
        </span>
        <div className="flow-logs-event-body">
          <div className="flow-logs-event-name">{item.subtype}</div>
          <div className="flow-logs-event-detail">
            {dur} · {cost} · {item.numTurns ?? '?'} turns
          </div>
        </div>
      </div>
    );
  }
  return null;
}

function summarizeInput(input: unknown): string {
  if (input == null) return '';
  if (typeof input === 'string') return input.slice(0, 120);
  try {
    const json = JSON.stringify(input);
    return json.length > 120 ? json.slice(0, 120) + '…' : json;
  } catch {
    return '';
  }
}
