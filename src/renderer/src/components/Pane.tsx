import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PaneId, SessionStatus } from '@shared/types';
import { getAgentColor } from '@shared/palette';
import {
  getPaneDisplayName,
  humanizeAgentName,
  useStore,
  type ChatItem,
} from '../store';
import { MessageView, type ChatItemView } from './Message';
import { TerminalPane } from './TerminalPane';
import {
  attachmentToMessageImage,
  fileToAttachment,
  isSupportedImage,
  type PendingAttachment,
} from '../attachments';
import {
  CloseIcon,
  ExpandIcon,
  MicIcon,
  PaperclipIcon,
  SendFilledIcon,
  StopIcon,
} from './icons';
import placemarkUrl from '../assets/in-zone-placeholder.png';

/**
 * Friendly, humane status labels. "waiting_for_input" means two things
 * in the SDK: "never had a turn yet, waiting for the first message" and
 * "finished a turn, waiting for the next one". We disambiguate by
 * looking at whether any result event has landed in the transcript.
 */
function statusLabel(status: SessionStatus, items: ChatItem[]): string {
  switch (status) {
    case 'idle':
      return 'Idle';
    case 'starting':
      return 'Starting…';
    case 'streaming':
      return 'Agent is working';
    case 'waiting_for_input':
      return items.some((it) => it.kind === 'result')
        ? 'Task completed'
        : 'Waiting for input';
    case 'error':
      return 'Error';
    case 'stopped':
      return 'Stopped';
    default:
      return status;
  }
}

/** Coarser variant for status-badge tinting (working / completed / waiting / error / neutral). */
function statusVariant(
  status: SessionStatus,
  items: ChatItem[],
): 'working' | 'completed' | 'waiting' | 'error' | 'neutral' {
  if (status === 'streaming' || status === 'starting') return 'working';
  if (status === 'error') return 'error';
  if (status === 'waiting_for_input')
    return items.some((it) => it.kind === 'result') ? 'completed' : 'waiting';
  return 'neutral';
}

function formatPaneCost(usd: number): string {
  if (usd > 0 && usd < 0.01) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}


/**
 * Three-vertical-dots glyph for the pane "more" affordance. Same
 * footprint as StopIcon / CloseIcon (14px) so it sits cleanly in the
 * pane-actions row.
 */
function MoreIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <circle cx="12" cy="5" r="1.6" />
      <circle cx="12" cy="12" r="1.6" />
      <circle cx="12" cy="19" r="1.6" />
    </svg>
  );
}

/** Refresh-arrow icon for the Clear menu item — reads as "start over". */
function RefreshIcon() {
  return (
    <svg
      width={13}
      height={13}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
      <path d="M21 3v5h-5" />
      <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
      <path d="M3 21v-5h5" />
    </svg>
  );
}

/**
 * Compact dropdown for the per-pane "more" actions. Replaces the row
 * of inline icon buttons that crowded the header at narrow widths.
 * Each menu item shows an icon + text label, click-outside dismisses.
 *
 * Rendered via React portal to `document.body` so the menu always
 * stacks above the surrounding `react-resizable-panels` resize
 * handles — see TerminalPaneMenu in TerminalPane.tsx for the full
 * z-index gotcha. Click-outside checks both the trigger and the
 * portaled menu, since the menu is no longer a DOM descendant of
 * the trigger.
 */
function PaneMoreMenu({
  canClear,
  canClose,
  onClear,
  onClose,
}: {
  canClear: boolean;
  canClose: boolean;
  onClear: () => void;
  onClose: () => void;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [pos, setPos] = useState<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });

  useEffect(() => {
    if (!open || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPos({
      top: rect.bottom + 4,
      right: window.innerWidth - rect.right,
    });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      const inTrigger = triggerRef.current?.contains(target);
      const inMenu = menuRef.current?.contains(target);
      if (!inTrigger && !inMenu) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div className="pane-more">
      <button
        ref={triggerRef}
        type="button"
        className="pane-icon-btn"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="More actions"
        aria-label="More actions"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <MoreIcon />
      </button>
      {open &&
        createPortal(
          <div
            ref={menuRef}
            className="pane-more-menu pane-more-menu-portal"
            role="menu"
            style={{ top: pos.top, right: pos.right }}
          >
            {canClear && (
              <button
                type="button"
                role="menuitem"
                className="pane-more-item"
                onClick={() => {
                  setOpen(false);
                  onClear();
                }}
              >
                <span className="pane-more-icon" aria-hidden>
                  <RefreshIcon />
                </span>
                Clear conversation
              </button>
            )}
            {canClose && (
              <button
                type="button"
                role="menuitem"
                className="pane-more-item danger"
                onClick={() => {
                  setOpen(false);
                  onClose();
                }}
              >
                <span className="pane-more-icon" aria-hidden>
                  <CloseIcon size={13} />
                </span>
                Close pane
              </button>
            )}
          </div>,
          document.body,
        )}
    </div>
  );
}

/** Inline pencil icon for the pane-rename affordance. */
function PencilIcon() {
  return (
    <svg
      width={12}
      height={12}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  );
}

interface PaneProps {
  id: PaneId;
}

export function Pane({ id }: PaneProps) {
  const pane = useStore((s) => s.panes[id]);
  const isActive = useStore((s) => s.activePaneId === id);
  const isLead = useStore((s) => s.leadPaneId === id);
  const setActivePane = useStore((s) => s.setActivePane);
  const closePane = useStore((s) => s.closePane);
  const clearPane = useStore((s) => s.clearPane);
  const sendMessage = useStore((s) => s.sendMessage);
  const interrupt = useStore((s) => s.interrupt);
  const setPaneName = useStore((s) => s.setPaneName);
  const tree = useStore((s) => s.tree);
  const leadPaneId = useStore((s) => s.leadPaneId);
  const leadPaneName = useStore((s) => s.leadPaneName);
  const agent = useStore((s) =>
    pane?.agentName
      ? s.agents.find((a) => a.name === pane.agentName)
      : undefined,
  );
  // When Flow mode is ON, every pane that's part of the chain blocks
  // manual sends — kickoff comes from the Run button on the Flow
  // board, and subsequent steps auto-fire. Toggling Flow off
  // re-enables direct messaging. Returning a primitive bool keeps
  // the Zustand selector stable across renders.
  const flowBlocked = useStore((s) => {
    const p = s.pipeline;
    if (!p?.enabled) return false;
    return p.steps.some((st) => st.paneId === id);
  });
  const color = getAgentColor(agent?.color);
  const paneDisplay = useMemo(
    () =>
      getPaneDisplayName(
        tree,
        id,
        leadPaneId
          ? { paneId: leadPaneId, paneName: leadPaneName ?? undefined }
          : null,
      ),
    [tree, id, leadPaneId, leadPaneName],
  );
  // When the pane hasn't been explicitly renamed by the user, prefer
  // a humanized version of the bound agent's name over the generic
  // "Pane N" — so a pane bound to `frontend-developer` reads as
  // "Frontend Developer" by default. Falls back to "Pane N" when no
  // agent is bound. The rename pencil still overrides this with a
  // user-set custom name.
  const titleName = useMemo(() => {
    if (paneDisplay.isCustom) return paneDisplay.name;
    if (agent?.name) return humanizeAgentName(agent.name);
    return paneDisplay.name;
  }, [paneDisplay.isCustom, paneDisplay.name, agent?.name]);
  const [renaming, setRenaming] = useState(false);
  const [renameDraft, setRenameDraft] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renaming) {
      // Pre-fill with whatever's visible (humanized agent name or
      // "Pane N") and select-all so a first keystroke replaces it
      // cleanly.
      setRenameDraft(titleName);
      requestAnimationFrame(() => {
        renameInputRef.current?.focus();
        renameInputRef.current?.select();
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renaming]);
  const commitRename = () => {
    setPaneName(id, renameDraft);
    setRenaming(false);
  };
  const [input, setInput] = useState('');
  // Pull "seed text" — typically a prepared prompt sent to this pane
  // by the PR Send-to-agent flow — into our local input state, then
  // tell the store we've consumed it so a re-render (or sibling pane
  // mount) doesn't re-apply the same seed. Append rather than
  // overwrite when there's already user input — protects half-typed
  // messages.
  const pendingSeed = useStore((s) => s.pendingPaneSeed);
  const consumePaneSeed = useStore((s) => s.consumePaneSeed);
  useEffect(() => {
    if (!pendingSeed || pendingSeed.paneId !== id) return;
    setInput((prev) =>
      prev.trim().length > 0 ? `${prev}\n\n${pendingSeed.text}` : pendingSeed.text,
    );
    // Focus the textarea after the seed lands so the user can edit
    // immediately — `requestAnimationFrame` waits for the DOM update.
    requestAnimationFrame(() => {
      composerTextareaRef.current?.focus();
      const el = composerTextareaRef.current;
      if (el) el.setSelectionRange(el.value.length, el.value.length);
    });
    consumePaneSeed();
  }, [pendingSeed, id, consumePaneSeed]);
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const [attachError, setAttachError] = useState<string | undefined>();
  // When true, the composer pops out into a fullscreen-ish modal so
  // the user has real room to write a long message. The modal is
  // portaled to document.body and shares all state (input,
  // attachments, submit, attach handlers) with the inline composer
  // so opening / closing doesn't clobber the draft.
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [recording, setRecording] = useState(false);
  const [transcribing, setTranscribing] = useState(false);
  const [voiceError, setVoiceError] = useState<string | undefined>();
  const scrollerRef = useRef<HTMLDivElement>(null);
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the composer up to ~2× its single-line height. We measure
  // `scrollHeight` after every input change and clamp to a max so a
  // wall of pasted text doesn't push the message scroll area into the
  // top of the screen. Resetting `height` to 0 first is required —
  // otherwise scrollHeight would only ever grow, never shrink.
  useEffect(() => {
    const ta = composerTextareaRef.current;
    if (!ta) return;
    ta.style.height = '0px';
    // 2× the typical single-line composer height (about 22px line +
    // 18px vertical padding ≈ 40px → cap at ~80px = 2 lines of room).
    const max = 84;
    const next = Math.min(ta.scrollHeight, max);
    ta.style.height = next + 'px';
  }, [input]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recorderStreamRef = useRef<MediaStream | null>(null);
  const recorderChunksRef = useRef<Blob[]>([]);

  /* ── Scroll-pin pattern ──────────────────────────────────────────
   * Only auto-scroll to the bottom when the user is ALREADY near the
   * bottom (within 64px). If they've scrolled up to read older
   * content, leave them where they are and surface a "jump to
   * latest" button instead — far less infuriating than yanking the
   * viewport back down on every new tool call.
   *
   * `isPinnedRef` is a ref (not state) because we read it from the
   * effect and don't want a re-render every time it flips.
   * `showJumpToBottom` IS state because it drives the visible
   * affordance; it tracks "user is scrolled up AND new content has
   * arrived since they scrolled".
   */
  const isPinnedRef = useRef(true);
  const [showJumpToBottom, setShowJumpToBottom] = useState(false);
  /** Reference to the inner content wrapper. We track its height
   *  (not the scroller's, whose clientHeight is the viewport and
   *  doesn't change as content grows) via a ResizeObserver, so we
   *  can re-pin the scroll while a single message streams in. */
  const scrollContentRef = useRef<HTMLDivElement | null>(null);

  /** Snap to bottom WITHOUT smooth animation. Smooth scroll fires
   *  intermediate scroll events at non-bottom positions which our
   *  pin detector reads as "user scrolled up", so the pin gets
   *  flipped off mid-animation and any content streaming during
   *  those frames triggers `showJumpToBottom` again. Instant scroll
   *  fires one event with distance=0 → pinned stays true. */
  const snapToBottom = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, []);

  // Re-pin when items.length changes (new message / tool block).
  // Streaming text growth WITHIN an existing message is handled by
  // the ResizeObserver effect below, since items.length doesn't
  // change while text streams into the last item.
  useEffect(() => {
    if (isPinnedRef.current) {
      snapToBottom();
    } else {
      setShowJumpToBottom(true);
    }
  }, [pane?.items.length, snapToBottom]);

  // Catch content-size growth even when items.length is unchanged —
  // streaming text into an open message, expanding tool blocks,
  // image loads, markdown re-flow. If we're pinned, follow the
  // bottom; if we're not, leave the user where they are (the
  // items-length effect surfaces the pill when a NEW message
  // arrives, which is the right moment to show it).
  useEffect(() => {
    const content = scrollContentRef.current;
    if (!content) return;
    const ro = new ResizeObserver(() => {
      if (isPinnedRef.current) snapToBottom();
    });
    ro.observe(content);
    return () => ro.disconnect();
  }, [snapToBottom]);

  const onScrollerScroll = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const distanceFromBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight;
    const PIN_THRESHOLD_PX = 64;
    const pinned = distanceFromBottom <= PIN_THRESHOLD_PX;
    isPinnedRef.current = pinned;
    // Reaching the bottom dismisses the affordance; scrolling away
    // doesn't show it on its own — only NEW CONTENT while detached
    // does (handled in the items-length effect above).
    if (pinned && showJumpToBottom) setShowJumpToBottom(false);
  }, [showJumpToBottom]);

  const jumpToBottom = useCallback(() => {
    // Order matters: set the pin BEFORE the scroll. The scroll
    // triggers a scroll event that runs onScrollerScroll, which
    // would normally set the pin based on distanceFromBottom — but
    // setting it here first means the ResizeObserver loop will keep
    // following streaming content even before the scroll event has
    // fired and even if there's content growth between the scroll
    // call and the next animation frame.
    isPinnedRef.current = true;
    setShowJumpToBottom(false);
    snapToBottom();
  }, [snapToBottom]);

  // Pair tool_use with its matching tool_result so we can render the two
  // as a single collapsed block in the transcript. Items without a pair
  // (tool_use still running, or orphan tool_result) fall through as-is.
  const viewItems = useMemo(
    () => buildViewItems(pane?.items ?? []),
    [pane?.items],
  );

  if (!pane) {
    return <div className="pane empty">No pane.</div>;
  }

  // Terminal-kind panes get an entirely different render — xterm
  // embedded in the pane area, no chat composer, no agent bindings.
  // We branch here (after all hooks have run) to keep React's hook
  // ordering invariant; TerminalPane is a self-contained component
  // with its own pane chrome so this can be a clean replacement.
  if (pane.workerKind === 'terminal') {
    return <TerminalPane id={id} />;
  }

  const addFiles = async (files: FileList | File[]) => {
    const images: File[] = [];
    for (const f of Array.from(files)) {
      if (isSupportedImage(f.type)) images.push(f);
    }
    if (images.length === 0) {
      setAttachError('Only PNG, JPEG, WEBP, or GIF images can be attached.');
      return;
    }
    try {
      const next = await Promise.all(images.map((f) => fileToAttachment(f)));
      setAttachments((prev) => [...prev, ...next]);
      setAttachError(undefined);
    } catch (err) {
      setAttachError(err instanceof Error ? err.message : String(err));
    }
  };

  const removeAttachment = (attachmentId: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
  };

  const submit = async () => {
    const text = input;
    const toSend = attachments;
    if (!text.trim() && toSend.length === 0) return;
    setInput('');
    setAttachments([]);
    setAttachError(undefined);
    await sendMessage(
      id,
      text,
      toSend.length > 0 ? toSend.map(attachmentToMessageImage) : undefined,
    );
  };

  const onPaste = async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const files: File[] = [];
    for (const it of Array.from(items)) {
      if (it.kind === 'file') {
        const f = it.getAsFile();
        if (f) files.push(f);
      }
    }
    if (files.length > 0) {
      e.preventDefault();
      await addFiles(files);
    }
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer?.files?.length) {
      await addFiles(e.dataTransfer.files);
    }
  };

  const busy = pane.status === 'streaming' || pane.status === 'starting';
  const canSend =
    pane.agentName &&
    (input.trim() || attachments.length > 0) &&
    !flowBlocked;

  // Propagate the agent's colour via CSS custom properties so the active
  // border, inset shadow, and LEAD badge all pick it up automatically.
  const paneStyle = color
    ? ({
        '--pane-accent': color.vivid,
        '--pane-accent-soft': color.pale,
      } as React.CSSProperties)
    : undefined;

  return (
    <div
      className={'pane' + (isActive ? ' active' : '') + (dragging ? ' dragging' : '')}
      style={paneStyle}
      data-pane-id={id}
      onMouseDown={() => setActivePane(id)}
      onDragOver={(e) => {
        if (!pane.agentName) return;
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
    >
      <div
        className={'pane-header' + (isActive ? ' pane-header-active' : '')}
        // Active pane gets a 4px bottom accent stripe in the agent's
        // vivid color — same color as the title text, so the whole
        // header reads as one tinted band without altering the body
        // background. CSS controls the stripe height; we pass the
        // color via a CSS variable so unset agents fall back gracefully.
        style={
          isActive && color
            ? ({
                ['--pane-active-stripe' as string]: color.vivid,
              } as React.CSSProperties)
            : undefined
        }
      >
        {isLead && <span className="lead-badge">Lead</span>}
        {pane.agentName && (
          // Always render the avatar slot once an agent is assigned —
          // falls back to 🤖 when the agent definition omits an emoji
          // so panes don't visually drop the avatar mid-row.
          <div className="pane-emoji" aria-hidden>
            {agent?.emoji ?? '🤖'}
          </div>
        )}
        <div className="pane-titles">
          {renaming ? (
            <input
              ref={renameInputRef}
              className="pane-rename-input"
              value={renameDraft}
              onChange={(e) => setRenameDraft(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenaming(false);
              }}
              onClick={(e) => e.stopPropagation()}
              spellCheck={false}
              maxLength={48}
            />
          ) : (
            <div
              className="pane-title-row"
              style={color ? { color: color.vivid } : undefined}
            >
              <span
                className={
                  'pane-title' +
                  (paneDisplay.isCustom ? '' : ' pane-title-default')
                }
                title={titleName}
              >
                {titleName}
              </span>
              {isActive && (
                <button
                  type="button"
                  className="pane-rename-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    setRenaming(true);
                  }}
                  title="Rename pane"
                  aria-label="Rename pane"
                >
                  <PencilIcon />
                </button>
              )}
            </div>
          )}
          <div className="pane-subtitle">
            {pane.agentName ? (
              <>
                <code className="pane-meta-chip">{pane.agentName}</code>
                {agent?.model && (
                  <code className="pane-meta-chip">{agent.model}</code>
                )}
              </>
            ) : (
              <em className="pane-title-empty">No agent</em>
            )}
          </div>
        </div>
        <div className="pane-actions">
          {(() => {
            const total = pane.items.reduce(
              (acc, it) =>
                it.kind === 'result' && typeof it.totalCostUsd === 'number'
                  ? acc + it.totalCostUsd
                  : acc,
              0,
            );
            const variant = statusVariant(pane.status, pane.items);
            // Two-line stack mirroring the title block on the left:
            // status dot + label up top (no pill — just inline text in
            // the variant's tint colour), cost chip underneath using
            // the same .pane-meta-chip pill as the agent slug + model
            // chips so the right side matches the left visually.
            return (
              <div
                className={`pane-status-stack variant-${variant}`}
                title={pane.error ? `Error: ${pane.error}` : undefined}
              >
                <div className="pane-status-line">
                  <StatusDot status={pane.status} />
                  <span className="pane-status-label">
                    {statusLabel(pane.status, pane.items)}
                  </span>
                </div>
                <code className="pane-meta-chip pane-cost-chip">
                  {formatPaneCost(total)}
                </code>
              </div>
            );
          })()}
          {busy && (
            <button
              className="pane-icon-btn"
              onClick={() => void interrupt(id)}
              title="Interrupt"
              aria-label="Interrupt"
            >
              <StopIcon size={14} />
            </button>
          )}
          {(pane.agentName || !isLead) && (
            <PaneMoreMenu
              canClear={!!pane.agentName}
              canClose={!isLead}
              onClear={() => {
                const ok = confirm(
                  `Clear the conversation in ${pane.agentName}'s pane? The transcript will be erased and a new session will start. This cannot be undone.`,
                );
                if (!ok) return;
                void clearPane(id);
              }}
              onClose={() => {
                if (pane.agentName) {
                  const ok = confirm(
                    `Close the ${pane.agentName} pane? This will stop its session.`,
                  );
                  if (!ok) return;
                }
                void closePane(id);
              }}
            />
          )}
        </div>
      </div>

      <div
        className="pane-scroller"
        ref={scrollerRef}
        onScroll={onScrollerScroll}
      >
        {/* Inner content wrapper exists ONLY so we can attach a
            ResizeObserver to it. Observing the scroller itself
            doesn't help — its clientHeight is fixed at the viewport,
            so it doesn't fire when scrollHeight changes underneath.
            This wrapper grows with the messages, which is what we
            need to track for streaming auto-scroll. */}
        <div className="pane-scroller-content" ref={scrollContentRef}>
          {pane.items.length === 0 && (
            <div className="pane-empty">
              <div className="pane-empty-icon" aria-hidden>
                <img
                  className="pane-empty-mark"
                  src={placemarkUrl}
                  alt=""
                />
              </div>
              <div className="pane-empty-sub">
                {pane.agentName
                  ? 'Type a message below to start the conversation.'
                  : 'Choose one from the sidebar to start a session.'}
              </div>
            </div>
          )}
          {viewItems.map((item) => (
            <MessageView key={item.id} item={item} paneId={id} />
          ))}
        </div>
      </div>

      {/* Floating "jump to latest" pill — only renders when the user
          has scrolled up AND new content has arrived since they did.
          Click snaps them back to the bottom and re-pins auto-scroll. */}
      {showJumpToBottom && (
        <button
          type="button"
          className="pane-jump-to-bottom"
          onClick={jumpToBottom}
          title="Jump to latest message"
        >
          ↓ Jump to latest
        </button>
      )}

      {dragging && (
        <div className="pane-drop-overlay">
          <div>Drop to attach image</div>
        </div>
      )}

      {/* Flow-blocked banner — Flow is ON so manual sends are routed
          through the Run button on the Flow board. Kept short on
          purpose; the explanation lives in the Flow board itself. */}
      {flowBlocked && (
        <div className="pane-flow-banner">
          <div className="pane-flow-banner-msg">
            <strong>🔗 Flow is ON</strong> — manage prompts in the Flow board.
          </div>
        </div>
      )}

      {/* Recovery banner — shown when the SDK loop has died (status:
          'error'). Without this, the user types into a closed input
          queue and the UI just sits on "Agent is working…" forever.
          Clicking Restart calls clearPane(id), which stops the dead
          session, wipes its saved id, and bootstraps a fresh one. */}
      {pane.status === 'error' && pane.agentName && (
        <div className="pane-recovery-banner">
          <div className="pane-recovery-msg">
            <strong>Session ended in an error.</strong>{' '}
            {pane.error
              ? pane.error
              : 'The agent stopped responding. Start a fresh session to continue.'}
          </div>
          <button
            type="button"
            className="pane-recovery-restart"
            onClick={() => {
              if (
                confirm(
                  `Restart ${pane.agentName}'s session? The conversation history will be cleared.`,
                )
              ) {
                void clearPane(id);
              }
            }}
          >
            Restart session
          </button>
        </div>
      )}

      <form
        className="pane-composer"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map((a) => (
              <div className="attachment-chip" key={a.id} title={a.filename}>
                <img src={a.dataUrl} alt={a.filename} />
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() => removeAttachment(a.id)}
                  title="Remove"
                  aria-label="Remove attachment"
                >
                  <CloseIcon size={10} stroke={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        {attachError && <div className="attach-error">{attachError}</div>}
        <div className="composer-row">
          <button
            type="button"
            className="composer-attach"
            onClick={() => fileInputRef.current?.click()}
            disabled={!pane.agentName || flowBlocked}
            title="Attach image"
            aria-label="Attach image"
          >
            <PaperclipIcon size={16} />
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files) void addFiles(e.target.files);
              e.target.value = '';
            }}
          />
          <textarea
            ref={composerTextareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                void submit();
              }
            }}
            onPaste={onPaste}
            placeholder={
              flowBlocked
                ? 'Flow is ON — use the Flow board'
                : pane.agentName
                  ? 'Message the agent… (⌘⏎)'
                  : 'Pick an agent first'
            }
            disabled={!pane.agentName || flowBlocked}
            rows={1}
          />
          <button
            type="submit"
            className="composer-send"
            disabled={!canSend}
            title="Send (⌘⏎)"
            aria-label="Send"
          >
            <span className="composer-send-label">Send</span>
            <SendFilledIcon size={14} />
          </button>
          <button
            type="button"
            className="composer-expand"
            onClick={() => setComposerExpanded(true)}
            disabled={!pane.agentName || flowBlocked}
            title="Open a larger composer for long messages"
            aria-label="Expand composer"
          >
            <ExpandIcon size={14} stroke={1.75} />
          </button>
        </div>
      </form>
      {composerExpanded &&
        createPortal(
          <ComposerExpandModal
            input={input}
            setInput={setInput}
            attachments={attachments}
            removeAttachment={removeAttachment}
            onPickFile={() => fileInputRef.current?.click()}
            onPaste={onPaste}
            placeholder={
              flowBlocked
                ? 'Flow is ON — use the Flow board'
                : pane.agentName
                  ? 'Message the agent… (⌘⏎ to send)'
                  : 'Pick an agent first'
            }
            disabled={!pane.agentName || flowBlocked}
            canSend={!!canSend}
            // Identity props — surface the agent the message is going
            // to so the user can confirm at a glance which pane this
            // expanded composer belongs to. The accentColor drives the
            // textarea border + the meta-chip tint inside the modal.
            agentDisplayName={titleName}
            agentSlug={pane.agentName ?? null}
            agentModel={agent?.model ?? null}
            agentEmoji={pane.agentName ? (agent?.emoji ?? '🤖') : null}
            accentColor={color?.vivid ?? null}
            onSubmit={async () => {
              await submit();
              // Auto-close after a successful submit so the user
              // doesn't have to dismiss the modal manually.
              if (input.trim() === '' && attachments.length === 0) {
                setComposerExpanded(false);
              }
            }}
            onClose={() => setComposerExpanded(false)}
          />,
          document.body,
        )}
    </div>
  );
}

/**
 * Fullscreen-ish composer popup. Lives in document.body via portal so
 * it overlays everything (workspace bar, terminal dock, sidebar).
 *
 * State sync — input, attachments, and every action handler are
 * passed in from the parent Pane. Opening the modal doesn't
 * duplicate state; closing it doesn't lose anything; submitting hits
 * the same `submit()` that the inline composer uses. The user can
 * freely toggle between inline + expanded mid-draft.
 *
 * Keyboard:
 *   - Esc closes (without submitting)
 *   - ⌘/Ctrl + Enter submits (matches the inline composer)
 */
function ComposerExpandModal(props: {
  input: string;
  setInput: (v: string) => void;
  attachments: PendingAttachment[];
  removeAttachment: (id: string) => void;
  onPickFile: () => void;
  onPaste: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  disabled: boolean;
  canSend: boolean;
  /** Display name of the agent — shown top-left of the modal head so
   *  the user can identify which pane this expanded composer is
   *  bound to without dismissing it. */
  agentDisplayName: string;
  /** Raw agent slug (e.g. "frontend-developer"). Renders as a meta
   *  chip on the right of the head. Null when no agent is assigned. */
  agentSlug: string | null;
  /** Optional model hint. Renders next to the slug as a second chip. */
  agentModel: string | null;
  /** Avatar emoji — defaults to 🤖 when the agent has none set. */
  agentEmoji: string | null;
  /** Hex/CSS colour of the bound agent. Drives the textarea border
   *  and the meta-chip accent so the modal carries the same visual
   *  identity as the inline pane header. */
  accentColor: string | null;
  onSubmit: () => void | Promise<void>;
  onClose: () => void;
}) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Esc closes; ⌘⏎ submits. We attach to window so a click-outside
  // event hasn't moved focus off the textarea before the user hits
  // the shortcut. preventDefault on Esc to keep it from interfering
  // with anything else listening (the modal is the topmost layer
  // when open).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        props.onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [props]);

  // Focus the textarea on open, with the caret at the end so the user
  // can immediately keep typing where they left off.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, []);

  return (
    <div
      className="composer-expand-overlay"
      role="dialog"
      aria-modal
      aria-label="Compose message"
    >
      <div
        className="composer-expand-backdrop"
        onClick={props.onClose}
        aria-hidden
      />
      <div
        className="composer-expand-card"
        // Drive the textarea border + chip accents off the agent's
        // colour. Falls through to the default theme accent when no
        // agent is assigned (rare — the modal is gated on having one).
        style={
          props.accentColor
            ? ({
                ['--composer-accent' as string]: props.accentColor,
              } as React.CSSProperties)
            : undefined
        }
      >
        <div className="composer-expand-head">
          <div className="composer-expand-identity">
            {props.agentEmoji && (
              <span className="composer-expand-avatar" aria-hidden>
                {props.agentEmoji}
              </span>
            )}
            <div className="composer-expand-titles">
              <span className="composer-expand-title">
                {props.agentDisplayName}
              </span>
              <span className="composer-expand-hint">
                ⌘⏎ to send · Esc to close
              </span>
            </div>
          </div>
          {(props.agentSlug || props.agentModel) && (
            <div className="composer-expand-meta">
              {props.agentSlug && (
                <code className="pane-meta-chip">{props.agentSlug}</code>
              )}
              {props.agentModel && (
                <code className="pane-meta-chip">{props.agentModel}</code>
              )}
            </div>
          )}
          <button
            type="button"
            className="composer-expand-close"
            onClick={props.onClose}
            title="Close (Esc)"
            aria-label="Close"
          >
            <CloseIcon size={14} stroke={2} />
          </button>
        </div>
        <textarea
          ref={textareaRef}
          className="composer-expand-textarea"
          value={props.input}
          onChange={(e) => props.setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              void props.onSubmit();
            }
          }}
          onPaste={props.onPaste}
          placeholder={props.placeholder}
          disabled={props.disabled}
          spellCheck
        />
        {props.attachments.length > 0 && (
          <div className="composer-expand-attachments">
            {props.attachments.map((a) => (
              <div
                key={a.id}
                className="attachment-chip"
                title={a.filename}
              >
                <img src={a.dataUrl} alt={a.filename} />
                <button
                  type="button"
                  className="attachment-remove"
                  onClick={() => props.removeAttachment(a.id)}
                  title="Remove"
                  aria-label="Remove attachment"
                >
                  <CloseIcon size={10} stroke={2.5} />
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer-expand-actions">
          <button
            type="button"
            className="composer-expand-attach"
            onClick={props.onPickFile}
            disabled={props.disabled}
            title="Attach image"
          >
            <PaperclipIcon size={14} />
            <span>Attach</span>
          </button>
          <span className="composer-expand-spacer" />
          <button
            type="button"
            className="composer-expand-cancel"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="composer-expand-send"
            onClick={() => void props.onSubmit()}
            disabled={!props.canSend}
            title="Send (⌘⏎)"
          >
            <span>Send</span>
            <SendFilledIcon size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Walk the raw transcript and merge each tool_use with its matching
 * tool_result (paired by toolUseId) into a single `tool_block` view
 * item. The result list is what the renderer iterates over.
 */
function buildViewItems(items: ChatItem[]): ChatItemView[] {
  const resultsById = new Map<
    string,
    Extract<ChatItem, { kind: 'tool_result' }>
  >();
  for (const it of items) {
    if (it.kind === 'tool_result') resultsById.set(it.toolUseId, it);
  }
  const out: ChatItemView[] = [];
  for (const it of items) {
    if (it.kind === 'tool_result') {
      // Already attached to its tool_use; skip.
      continue;
    }
    if (it.kind === 'tool_use') {
      // Suppress the AskUserQuestion tool block — its inline form
      // chat item carries the question UI, and the parallel
      // tool_use/tool_result that the SDK emits would be visual
      // noise (raw JSON of the questions payload + duplicated answer
      // text). We still keep them in the underlying transcript for
      // resume / debug, just hidden from the view stream.
      if (it.name === 'mcp__AskUserQuestion__ask') {
        continue;
      }
      const r = resultsById.get(it.toolUseId);
      out.push({
        id: it.id,
        kind: 'tool_block',
        toolUseId: it.toolUseId,
        name: it.name,
        input: it.input,
        result: r ? { content: r.content, isError: r.isError } : undefined,
        ts: it.ts,
      });
      continue;
    }
    out.push(it);
  }
  return out;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'streaming'
      ? 'var(--accent)'
      : status === 'error'
        ? 'var(--danger)'
        : status === 'waiting_for_input'
          ? 'var(--ok)'
          : 'var(--muted)';
  return (
    <span
      className={'status-dot' + (status === 'streaming' ? ' pulse' : '')}
      style={{ background: color }}
      aria-hidden
    />
  );
}
