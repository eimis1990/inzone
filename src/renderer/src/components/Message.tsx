import { memo } from 'react';
import type { PaneId } from '@shared/types';
import type { ChatItem } from '../store';
import { useRenderCount } from '../perf/useRenderCount';
import {
  formatCavemanLevel,
  useCavemanSettings,
} from '../hooks/useCavemanSettings';
import { Markdown } from './Markdown';
import { AskUserQuestionForm } from './AskUserQuestionForm';

/**
 * One rendered item in the pane chat. Pane.tsx pre-merges every
 * `tool_use` with its matching `tool_result` (by toolUseId) into a
 * single `tool_block` so we can collapse them as one unit.
 */
export type ToolBlockView = {
  id: string;
  kind: 'tool_block';
  toolUseId: string;
  name: string;
  input: unknown;
  result?: { content: unknown; isError?: boolean };
  ts: number;
};

export type ChatItemView = ChatItem | ToolBlockView;

interface Props {
  item: ChatItemView;
  /**
   * Owning pane id — needed by the AskUserQuestion form so it can
   * dispatch the answer back through the right pane's runtime.
   * Other item kinds ignore this prop.
   */
  paneId: PaneId;
}

function MessageViewImpl({ item, paneId }: Props) {
  useRenderCount('MessageView', item.id);
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg user">
          <div className="msg-role">You</div>
          {item.images && item.images.length > 0 && (
            <div className="msg-images">
              {item.images.map((img, i) => (
                <img
                  key={i}
                  className="msg-image"
                  src={`data:${img.mime};base64,${img.base64}`}
                  alt={img.filename ?? `attachment ${i + 1}`}
                />
              ))}
            </div>
          )}
          {item.text && <div className="msg-body">{item.text}</div>}
        </div>
      );
    case 'assistant_text':
      return <AssistantMessage text={item.text} />;
    case 'tool_block':
      return <ToolBlock item={item} />;
    case 'tool_use':
      // Standalone tool_use (no result yet) — render the same shell as a
      // tool_block but with a "running…" hint.
      return (
        <ToolBlock
          item={{
            id: item.id,
            kind: 'tool_block',
            toolUseId: item.toolUseId,
            name: item.name,
            input: item.input,
            result: undefined,
            ts: item.ts,
          }}
        />
      );
    case 'tool_result':
      // Should only get here if a tool_result arrives without a matching
      // tool_use (shouldn't happen in practice). Render minimally.
      return (
        <div className={'msg tool-result' + (item.isError ? ' error' : '')}>
          <div className="msg-role">
            ◂ result{' '}
            <span className="tool-id" title={item.toolUseId}>
              #{item.toolUseId.slice(0, 6)}
            </span>
          </div>
          <pre className="msg-code">{formatContent(item.content)}</pre>
        </div>
      );
    case 'ask_user_question':
      return (
        <AskUserQuestionForm
          paneId={paneId}
          requestId={item.requestId}
          questions={item.questions}
          answers={item.answers}
        />
      );
    case 'result': {
      const variant =
        item.subtype === 'success'
          ? 'success'
          : item.subtype.startsWith('error')
            ? 'error'
            : 'neutral';
      // Prefer per-turn deltas in the headline. The SDK reports
      // cumulative session totals — showing $9.55 next to a
      // 4-turn task makes users think that one task cost $9.55,
      // when really the session-so-far has spent $9.55 and THIS
      // turn was much less. Falls back to the cumulative if the
      // delta is unavailable (legacy transcripts saved before
      // v1.12 didn't store deltas).
      const headlineDurationMs =
        item.deltaDurationMs ?? item.durationMs;
      const headlineCostUsd = item.deltaCostUsd ?? item.totalCostUsd;
      const headlineNumTurns = item.deltaNumTurns ?? item.numTurns;
      // Tooltip with cumulative session totals — there for
      // budget-awareness without dominating the visual.
      const tooltipParts: string[] = [];
      if (typeof item.totalCostUsd === 'number') {
        tooltipParts.push(`session total: $${item.totalCostUsd.toFixed(4)}`);
      }
      if (typeof item.durationMs === 'number') {
        tooltipParts.push(`session time: ${(item.durationMs / 1000).toFixed(1)}s`);
      }
      if (typeof item.numTurns === 'number') {
        tooltipParts.push(`session turns: ${item.numTurns}`);
      }
      const tooltip = tooltipParts.join(' · ') || undefined;
      return (
        <div className={`msg result ${variant}`} title={tooltip}>
          <span className={`result-badge ${variant}`}>{item.subtype}</span>
          {typeof headlineDurationMs === 'number' && (
            <span> · {(headlineDurationMs / 1000).toFixed(1)}s</span>
          )}
          {typeof headlineCostUsd === 'number' && (
            <span> · ${headlineCostUsd.toFixed(4)}</span>
          )}
          {typeof headlineNumTurns === 'number' && (
            <span> · {headlineNumTurns} turns</span>
          )}
        </div>
      );
    }
  }
}

/**
 * Custom equality check for memoised MessageView.
 *
 * Why the custom comparator: most of our `ChatItemView` values come
 * straight from the Zustand store with stable references, so naive
 * `a === b` would cover them. But `tool_block` items are NOT in the
 * store — `buildViewItems()` in Pane.tsx synthesises them on every
 * render by zipping a `tool_use` with its matching `tool_result`,
 * which means a fresh `ToolBlockView` object every time even when
 * nothing changed. Default shallow compare on that would invalidate
 * every tool block on every Pane re-render, defeating the memo.
 *
 * Strategy:
 *  - paneId must match (string compare)
 *  - if `prev.item === next.item` we're done (stable store refs)
 *  - otherwise inspect the meaningful fields. For tool_block: input
 *    + name + result.content + result.isError — every one of those
 *    references survives the buildViewItems rebuild because they
 *    come from the store-side ChatItem objects, not from the
 *    synthesised wrapper.
 */
function areMessagePropsEqual(prev: Props, next: Props): boolean {
  if (prev.paneId !== next.paneId) return false;
  const a = prev.item;
  const b = next.item;
  if (a === b) return true;
  if (a.kind !== b.kind || a.id !== b.id) return false;
  if (a.kind === 'tool_block' && b.kind === 'tool_block') {
    return (
      a.name === b.name &&
      a.input === b.input &&
      a.result?.content === b.result?.content &&
      a.result?.isError === b.result?.isError
    );
  }
  // For non-tool-block kinds, the items live in the store with
  // stable refs — if we reach this branch they're conceptually
  // different items (different snapshots of the same id) and we
  // want to re-render.
  return false;
}

export const MessageView = memo(MessageViewImpl, areMessagePropsEqual);

/**
 * One assistant message bubble. Split out from MessageViewImpl so we
 * can call `useCavemanSettings()` without making the hook fire on
 * every chat-item kind (the parent switch would force it through
 * tool_block / result / user branches too, which is fine for React
 * but adds a subscription per item — this way only assistant bubbles
 * subscribe).
 *
 * Renders a small "Caveman" badge in the top-right of the role row
 * when the user has the experiment enabled. Hovering the badge shows
 * the active intensity in the tooltip so they can confirm what's
 * applied without opening Settings.
 */
function AssistantMessage({ text }: { text: string }) {
  const caveman = useCavemanSettings();
  return (
    <div className="msg assistant">
      <div className="msg-role msg-role-row">
        <span>Claude</span>
        {caveman.enabled && (
          <span
            className="msg-caveman-badge"
            title={`Caveman mode · ${formatCavemanLevel(caveman.level)} · toggle in Settings → Experiments`}
          >
            <CavemanBadgeIcon />
            <span className="msg-caveman-badge-text">Caveman</span>
          </span>
        )}
      </div>
      <Markdown text={text} />
    </div>
  );
}

/**
 * Tiny club icon for the Caveman badge. ~10px so it sits visually
 * level with the uppercase "CLAUDE" label without dragging the row
 * height.
 */
function CavemanBadgeIcon() {
  return (
    <svg
      width={10}
      height={10}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      {/* Caveman club — wide head on top, narrow handle below */}
      <path d="M14 2c-3.5 0-6 2.5-6 6 0 1.7.6 3.2 1.6 4.3l-7 7a2 2 0 1 0 2.8 2.8l7-7c1.1 1 2.6 1.6 4.3 1.6 3.5 0 6-2.5 6-6 0-3.6-3.2-8.7-8.7-8.7z" />
    </svg>
  );
}

/**
 * Collapsible tool call: shows just the tool name + a short preview of
 * the input on a single line, with a chevron. Click to expand the input
 * JSON and the result body. Default = collapsed.
 *
 * Not separately memoised — it lives inside MessageView (the
 * `tool_block` branch), so the parent's memo gates re-evaluation
 * transitively.
 */
function ToolBlock({ item }: { item: ToolBlockView }) {
  useRenderCount('ToolBlock', item.id);
  const summary = summarizeInput(item.name, item.input);
  const status = item.result
    ? item.result.isError
      ? 'error'
      : 'ok'
    : 'running';
  const resultText = item.result ? formatContent(item.result.content) : '';
  const looksLikeMarkdown =
    item.result &&
    resultText.length < 4000 &&
    /(^|\n)(#|\*|-|\d+\.|>) |```/.test(resultText);

  // Detect a wiki op so we can replace the generic done/error pill
  // with an accent-coloured "Wiki read" / "Wiki updated" badge. Looks
  // at the file_path-style input fields (file_path / path) and matches
  // anything under `.inzone/wiki/`. Read → "Wiki read"; Write / Edit /
  // MultiEdit → "Wiki updated". Only applies on success — a failed
  // wiki op still surfaces the red error pill so the user notices.
  const wikiKind = detectWikiOp(item.name, item.input);
  const showWikiBadge = wikiKind && status === 'ok';

  return (
    <details className={`msg tool-block status-${status}`}>
      <summary className="tool-summary">
        <span className="tool-chevron" aria-hidden>
          ▸
        </span>
        <span className="tool-name">{item.name}</span>
        {summary && <span className="tool-input-preview">{summary}</span>}
        <span className="tool-spacer" />
        {/* tool-id sits on the LEFT side of the status badge so the
            status pill is always the rightmost element in the row.
            Without this re-order, AskUserQuestion (no summary text)
            renders the badge stuck to the tool name on the left. */}
        <span className="tool-id" title={item.toolUseId}>
          #{item.toolUseId.slice(0, 6)}
        </span>
        {showWikiBadge ? (
          <span className="tool-status wiki" title="Wiki operation">
            {wikiKind === 'read' ? 'Wiki read' : 'Wiki updated'}
          </span>
        ) : (
          <>
            {status === 'running' && (
              <span className="tool-status running">running…</span>
            )}
            {status === 'ok' && <span className="tool-status ok">done</span>}
            {status === 'error' && (
              <span className="tool-status error">error</span>
            )}
          </>
        )}
      </summary>
      <div className="tool-body">
        <div className="tool-section-label">Input</div>
        <pre className="msg-code">{formatUnknown(item.input)}</pre>
        {item.result && (
          <>
            <div className="tool-section-label">
              Output{item.result.isError ? ' (error)' : ''}
            </div>
            {looksLikeMarkdown ? (
              <Markdown text={resultText} />
            ) : (
              <pre className="msg-code">{resultText || '(empty)'}</pre>
            )}
          </>
        )}
      </div>
    </details>
  );
}

/**
 * One-line preview of the most useful field in a tool's input, so the
 * collapsed summary line tells you what the agent actually did without
 * having to expand. Falls back to a short JSON for unknown shapes.
 */
function summarizeInput(toolName: string, input: unknown): string {
  if (!input || typeof input !== 'object') return '';
  const o = input as Record<string, unknown>;
  // Pick the most informative field for common tools.
  const candidates: string[] = [];
  if (typeof o.command === 'string') candidates.push(o.command);
  if (typeof o.file_path === 'string') candidates.push(shortPath(o.file_path));
  if (typeof o.path === 'string') candidates.push(shortPath(o.path));
  if (typeof o.pattern === 'string') candidates.push(o.pattern);
  if (typeof o.url === 'string') candidates.push(o.url);
  if (typeof o.query === 'string') candidates.push(o.query);
  if (candidates.length === 0) {
    // Generic fallback — first string-valued field, capped.
    for (const v of Object.values(o)) {
      if (typeof v === 'string' && v.length > 0) {
        candidates.push(v);
        break;
      }
    }
  }
  const text = candidates.join(' ').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  // Cap to keep the summary line tidy.
  return text.length > 90 ? text.slice(0, 88) + '…' : text;
  // (toolName is unused for now, but kept in the signature so we can
  //  branch on it later if individual tools want bespoke summaries.)
  void toolName;
}

/**
 * Detect whether a tool call is a wiki Read / Write / Edit. Returns:
 *  - 'read'    : Read against a `.inzone/wiki/` path
 *  - 'updated' : Write / Edit / MultiEdit / NotebookEdit against same
 *  - null      : not a wiki op
 *
 * Used by ToolBlock to swap the generic "done" pill for an accented
 * "Wiki read" / "Wiki updated" badge so wiki activity is visible at
 * a glance in long agent transcripts — the user explicitly wanted a
 * signal here because they're tracking whether agents are actually
 * maintaining the wiki as instructed.
 */
function detectWikiOp(
  toolName: string,
  input: unknown,
): 'read' | 'updated' | null {
  if (!input || typeof input !== 'object') return null;
  const o = input as Record<string, unknown>;
  const candidatePath =
    (typeof o.file_path === 'string' && o.file_path) ||
    (typeof o.path === 'string' && o.path) ||
    (typeof o.notebook_path === 'string' && o.notebook_path) ||
    '';
  if (!candidatePath) return null;
  // Match either a leading-absolute or repo-relative path that
  // contains the wiki folder segment. We don't require a specific
  // project root because the cwd is opaque to the renderer; the
  // `/.inzone/wiki/` segment is distinctive enough on its own.
  if (!/(^|\/)\.inzone\/wiki\//.test(candidatePath)) return null;
  // Strip the `mcp__server__` prefix so MCP-wrapped file ops (rare
  // but possible) match by their suffix too.
  const bareName = toolName.replace(/^mcp__[^_]+__/, '');
  if (bareName === 'Read' || bareName === 'NotebookRead') return 'read';
  if (
    bareName === 'Write' ||
    bareName === 'Edit' ||
    bareName === 'MultiEdit' ||
    bareName === 'NotebookEdit'
  ) {
    return 'updated';
  }
  return null;
}

function shortPath(p: string): string {
  // Show just the trailing two segments so very deep paths stay readable.
  const parts = p.split('/').filter(Boolean);
  if (parts.length <= 2) return p;
  return '…/' + parts.slice(-2).join('/');
}

function formatUnknown(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function formatContent(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    // Anthropic tool_result content can be an array of blocks.
    return value
      .map((b: unknown) => {
        if (
          b &&
          typeof b === 'object' &&
          (b as { type?: string }).type === 'text'
        ) {
          return String((b as { text?: string }).text ?? '');
        }
        return formatUnknown(b);
      })
      .join('\n');
  }
  return formatUnknown(value);
}
