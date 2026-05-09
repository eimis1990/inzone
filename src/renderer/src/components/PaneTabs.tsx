/**
 * Horizontal strip of pane tabs sitting between the workspace bar
 * and the pane area. Lets the user toggle between:
 *   - "All"   — the multi-pane tree view (or Lead+sub-panes split)
 *   - <Pane>  — fullscreen view of one pane
 *
 * Selected tab uses the pane's agent-colour gradient (same recipe
 * as the active pane header) so the tab visually identifies which
 * pane you're zoomed into. The tabs row is hidden when:
 *   - Flow mode is on (the Flow board owns the workspace),
 *   - there's only one pane (a fullscreen toggle would be silly),
 *   - we're already in fullscreen mode (PaneTabs renders inside
 *     the fullscreen host so the user can pick a different tab).
 *
 * Tab labels use the pane's custom name when set, falling back to
 * the humanized agent name, then to "Pane N" for empty panes —
 * matches getPaneDisplayName behaviour elsewhere in the app.
 */

import { useMemo } from 'react';
import type { PaneId, PaneNode } from '@shared/types';
import { getAgentColor } from '@shared/palette';
import { useStore, humanizeAgentName, getPaneDisplayName } from '../store';

export function PaneTabs() {
  const tree = useStore((s) => s.tree);
  const panes = useStore((s) => s.panes);
  const agents = useStore((s) => s.agents);
  const focusedPaneId = useStore((s) => s.focusedPaneId);
  const leadPaneId = useStore((s) => s.leadPaneId);
  const leadPaneName = useStore((s) => s.leadPaneName);
  const windowMode = useStore((s) => s.windowMode);
  const pipelineEnabled = useStore((s) => !!s.pipeline?.enabled);
  const setFocusedPane = useStore((s) => s.setFocusedPane);

  // Walk every leaf in the tree, plus the Lead pane (which lives
  // outside the tree). Order: Lead first (when in lead mode), then
  // sub-panes left-to-right.
  const tabs = useMemo(() => {
    const out: Array<{
      paneId: PaneId;
      label: string;
      emoji: string | null;
      agentColor: string | null;
      isLead: boolean;
    }> = [];

    const pushPane = (paneId: PaneId, isLead: boolean) => {
      const pane = panes[paneId];
      const agentName = pane?.agentName;
      const agent = agentName
        ? agents.find((a) => a.name === agentName)
        : undefined;
      const colorKey = getAgentColor(agent?.color);
      const display = getPaneDisplayName(
        tree,
        paneId,
        leadPaneId
          ? { paneId: leadPaneId, paneName: leadPaneName ?? undefined }
          : null,
      );
      // Prefer the user's custom name; fall back to humanized agent
      // name; finally to "Pane N" or "Lead" (already handled by
      // getPaneDisplayName).
      const label = display.isCustom
        ? display.name
        : agentName
          ? humanizeAgentName(agentName)
          : display.name;
      // Agent emoji for the tab — same fallback as the pane header
      // (🤖 when an agent is bound but has no custom emoji). Empty
      // panes get null so we can render a placeholder.
      const emoji = agentName ? agent?.emoji ?? '🤖' : null;
      out.push({
        paneId,
        label,
        emoji,
        agentColor: colorKey?.vivid ?? null,
        isLead,
      });
    };

    if (windowMode === 'lead' && leadPaneId) pushPane(leadPaneId, true);
    for (const id of walkLeaves(tree)) pushPane(id, false);
    return out;
  }, [tree, panes, agents, leadPaneId, leadPaneName, windowMode]);

  // Hide the tabs row entirely when there's nothing meaningful to
  // toggle between (single pane) or when the workspace surface is
  // owned by Flow mode.
  if (pipelineEnabled) return null;
  if (tabs.length < 2) return null;

  return (
    <div className="pane-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        aria-selected={focusedPaneId === null}
        className={
          'pane-tab pane-tab-all' +
          (focusedPaneId === null ? ' selected' : '')
        }
        onClick={() => setFocusedPane(null)}
      >
        <span className="pane-tab-icon" aria-hidden>
          ▦
        </span>
        <span className="pane-tab-label">All</span>
      </button>
      {tabs.map((t) => {
        const selected = focusedPaneId === t.paneId;
        return (
          <button
            type="button"
            role="tab"
            aria-selected={selected}
            key={t.paneId}
            className={'pane-tab' + (selected ? ' selected' : '')}
            onClick={() => setFocusedPane(t.paneId)}
            // Drive the selected-state gradient via the same CSS
            // var the pane root uses, so the tab inherits the
            // agent's vivid colour when one is bound.
            style={
              t.agentColor
                ? ({
                    ['--tab-accent' as string]: t.agentColor,
                  } as React.CSSProperties)
                : undefined
            }
            title={t.label}
          >
            {t.isLead && (
              <span className="pane-tab-lead-badge" aria-hidden>
                Lead
              </span>
            )}
            {t.emoji && (
              <span className="pane-tab-emoji" aria-hidden>
                {t.emoji}
              </span>
            )}
            <span className="pane-tab-label">{t.label}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Walk the pane tree left-to-right depth-first, returning leaf ids
 *  in display order. Local copy of the store-internal helper so
 *  PaneTabs doesn't depend on widening the export surface. */
function walkLeaves(node: PaneNode, out: PaneId[] = []): PaneId[] {
  if (node.kind === 'leaf') out.push(node.id);
  else for (const c of node.children) walkLeaves(c, out);
  return out;
}
