import type { PaneId } from '@shared/types';
import type { ChatItem } from '../store';
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

export function MessageView({ item, paneId }: Props) {
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
      return (
        <div className="msg assistant">
          <div className="msg-role">Claude</div>
          <Markdown text={item.text} />
        </div>
      );
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
      return (
        <div className={`msg result ${variant}`}>
          <span className={`result-badge ${variant}`}>{item.subtype}</span>
          {typeof item.durationMs === 'number' && (
            <span> · {(item.durationMs / 1000).toFixed(1)}s</span>
          )}
          {typeof item.totalCostUsd === 'number' && (
            <span> · ${item.totalCostUsd.toFixed(4)}</span>
          )}
          {typeof item.numTurns === 'number' && (
            <span> · {item.numTurns} turns</span>
          )}
        </div>
      );
    }
  }
}

/**
 * Collapsible tool call: shows just the tool name + a short preview of
 * the input on a single line, with a chevron. Click to expand the input
 * JSON and the result body. Default = collapsed.
 */
function ToolBlock({ item }: { item: ToolBlockView }) {
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

  return (
    <details className={`msg tool-block status-${status}`}>
      <summary className="tool-summary">
        <span className="tool-chevron" aria-hidden>
          ▸
        </span>
        <span className="tool-name">{item.name}</span>
        {summary && <span className="tool-input-preview">{summary}</span>}
        <span className="tool-spacer" />
        {status === 'running' && (
          <span className="tool-status running">running…</span>
        )}
        {status === 'ok' && <span className="tool-status ok">done</span>}
        {status === 'error' && (
          <span className="tool-status error">error</span>
        )}
        <span className="tool-id" title={item.toolUseId}>
          #{item.toolUseId.slice(0, 6)}
        </span>
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
