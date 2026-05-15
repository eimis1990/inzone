/**
 * Floating picker shown above the composer when the user clicks the
 * "/" button (or types `/` as the first character of an empty
 * composer). Lists the slash commands available for the active
 * pane's project — built-ins + `~/.claude/commands/*.md` +
 * `<project>/.claude/commands/*.md`, deduped and merged via
 * `mergeCommands()` from `shared/builtin-commands.ts`.
 *
 * Behaviour
 *   - Search input is auto-focused on open.
 *   - Filters by command name OR description, case-insensitive.
 *   - Arrow up/down navigate the list; Enter picks the highlighted
 *     command; Esc closes.
 *   - Picking a command calls `onPick(cmd)` and the parent is
 *     responsible for closing + replacing the badge + arguments.
 *
 * Position is driven by the consumer via the `style` prop — the
 * composer renders this popover above the textarea row using
 * absolute positioning relative to the pane-composer form.
 */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import { createPortal } from 'react-dom';
import type { ProjectCommand } from '@shared/types';

/**
 * Tooltip state — `cmd` is what to show, `top`/`left` are viewport-
 * relative pixel coordinates captured from the hovered row's
 * bounding rect at the moment the 2s timer fires. Rendered through
 * a portal so the tooltip escapes the picker's own overflow
 * clipping.
 */
interface TooltipState {
  cmd: ProjectCommand;
  top: number;
  left: number;
}

/** How long a row must be hovered before its description tooltip
 *  appears. The native browser `title` attribute has platform-
 *  specific delays (typically 1.5–3s) that we can't control,
 *  which the user found unreliable — 2s exactly is the target. */
const TOOLTIP_DELAY_MS = 2000;

interface Props {
  commands: ProjectCommand[];
  onPick: (cmd: ProjectCommand) => void;
  onClose: () => void;
  /** Optional initial filter text — used when the user typed `/foo`
   *  in the empty composer; we pass `foo` so the search starts
   *  matching immediately. */
  initialFilter?: string;
  /** Absolute-position overrides (top/bottom/left/right). Composer
   *  sets these so the popover sits above the textarea. */
  style?: CSSProperties;
}

export function SlashCommandPicker({
  commands,
  onPick,
  onClose,
  initialFilter,
  style,
}: Props): JSX.Element {
  const [filter, setFilter] = useState(initialFilter ?? '');
  const [highlight, setHighlight] = useState(0);
  // Custom hover-tooltip: shows the full command description after
  // a deterministic 2s delay, regardless of native browser title
  // timing. Lives in a portal to document.body so it escapes the
  // picker list's `overflow-y: auto` clipping.
  const [tooltip, setTooltip] = useState<TooltipState | null>(null);
  const tooltipTimerRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Clear any pending tooltip timer on unmount so a long-delayed
  // setState doesn't fire on a stale component.
  useEffect(() => {
    return () => {
      if (tooltipTimerRef.current !== null) {
        window.clearTimeout(tooltipTimerRef.current);
        tooltipTimerRef.current = null;
      }
    };
  }, []);

  const handleRowEnter = (
    i: number,
    e: React.MouseEvent<HTMLLIElement>,
  ) => {
    setHighlight(i);
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current);
    }
    setTooltip(null);
    // Capture the target now — by the time the timer fires the
    // synthetic event may have been recycled.
    const rowEl = e.currentTarget;
    tooltipTimerRef.current = window.setTimeout(() => {
      // Closure captures `filtered` at mouseEnter time — if the
      // user re-filters during the 2s delay the tooltip will be
      // for the originally hovered command, which is the
      // expected mental model.
      const cmd = filtered[i];
      if (!cmd) return;
      const rect = rowEl.getBoundingClientRect();
      // Anchor the tooltip to the row's right edge, vertically
      // centred — keeps it out of the way of the row itself and
      // close to the source-chip the user just hovered.
      setTooltip({
        cmd,
        top: rect.top + rect.height / 2,
        left: rect.right + 12,
      });
      tooltipTimerRef.current = null;
    }, TOOLTIP_DELAY_MS);
  };

  const handleRowLeave = () => {
    if (tooltipTimerRef.current !== null) {
      window.clearTimeout(tooltipTimerRef.current);
      tooltipTimerRef.current = null;
    }
    setTooltip(null);
  };

  // Filter is case-insensitive over both the name and the
  // description so a user typing "test" finds /test and also any
  // command whose description mentions tests. We keep the relative
  // order from the merged list so project-scoped commands stay on
  // top.
  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter((c) => {
      return (
        c.name.toLowerCase().includes(needle) ||
        c.description.toLowerCase().includes(needle)
      );
    });
  }, [commands, filter]);

  // Whenever the filter changes (or commands change), clamp the
  // highlight back inside the visible list. Otherwise pressing Enter
  // after typing into a filter that shrinks past the previous
  // highlight would crash on `filtered[highlight]`.
  useEffect(() => {
    setHighlight((h) => {
      if (filtered.length === 0) return 0;
      return Math.min(h, filtered.length - 1);
    });
  }, [filtered]);

  // Auto-focus the search input on open so the user can start
  // typing immediately.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Close on click-outside. We listen on mousedown (not click) so
  // clicking a button inside the picker fires its onClick BEFORE we
  // tear the picker down (React stops propagation on synthetic
  // events but native listeners see both phases).
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (
        rootRef.current &&
        !rootRef.current.contains(e.target as Node)
      ) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const pick = (cmd: ProjectCommand | undefined) => {
    if (!cmd) {
      onClose();
      return;
    }
    onPick(cmd);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) =>
        filtered.length === 0 ? 0 : (h + 1) % filtered.length,
      );
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) =>
        filtered.length === 0
          ? 0
          : (h - 1 + filtered.length) % filtered.length,
      );
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(filtered[highlight]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div
      ref={rootRef}
      className="slash-picker"
      style={style}
      role="dialog"
      aria-label="Slash command picker"
      onKeyDown={handleKeyDown}
    >
      <div className="slash-picker-search">
        <span className="slash-picker-search-prefix">/</span>
        <input
          ref={inputRef}
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search commands…"
          spellCheck={false}
          autoComplete="off"
          aria-label="Filter slash commands"
        />
      </div>
      {filtered.length === 0 ? (
        <div className="slash-picker-empty">
          No commands match.
          <br />
          <span className="slash-picker-empty-hint">
            Create one at{' '}
            <code>.claude/commands/&lt;name&gt;.md</code>
          </span>
        </div>
      ) : (
        <ul className="slash-picker-list">
          {filtered.map((cmd, i) => {
            const isHighlighted = i === highlight;
            return (
              <li
                key={`${cmd.source}:${cmd.name}`}
                className={
                  'slash-picker-row' +
                  (isHighlighted ? ' highlighted' : '')
                }
                onMouseEnter={(e) => handleRowEnter(i, e)}
                onMouseLeave={handleRowLeave}
                onClick={() => pick(cmd)}
                role="button"
                tabIndex={-1}
              >
                <span className="slash-picker-name">/{cmd.name}</span>
                <span className="slash-picker-desc">{cmd.description}</span>
                <span
                  className={'slash-picker-source slash-picker-source-' + cmd.source}
                >
                  {cmd.source === 'project'
                    ? 'project'
                    : cmd.source === 'user'
                      ? 'user'
                      : cmd.source === 'plugin'
                        ? 'plugin'
                        : 'built-in'}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="slash-picker-foot">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> navigate
        </span>
        <span>
          <kbd>↵</kbd> pick
        </span>
        <span>
          <kbd>Esc</kbd> close
        </span>
      </div>
      {tooltip &&
        createPortal(
          <div
            className="slash-picker-tooltip"
            style={{ top: tooltip.top, left: tooltip.left }}
            role="tooltip"
          >
            <div className="slash-picker-tooltip-name">
              /{tooltip.cmd.name}
            </div>
            <div className="slash-picker-tooltip-desc">
              {tooltip.cmd.description}
            </div>
            {(tooltip.cmd.pluginName || tooltip.cmd.filePath) && (
              <div className="slash-picker-tooltip-meta">
                {tooltip.cmd.pluginName
                  ? `From plugin · ${tooltip.cmd.pluginName}`
                  : tooltip.cmd.filePath}
              </div>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}
