import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collectLeavesWithAgents,
  getPaneDisplayName,
  humanizeAgentName,
  useStore,
} from '../store';
import type {
  CheckRun,
  CheckState,
  PaneId,
  PrComment,
  PrDetail,
  PrReviewComment,
  PrSummary,
} from '@shared/types';
import { CloseIcon } from './icons';

/**
 * PR overlay — full-screen drawer matching the Settings drawer's
 * shape so the two surfaces feel like one design system. Three views
 * swap inside the right content pane:
 *
 *   1. List         — every PR as a card (filtered by left nav).
 *   2. Detail       — one PR's checks + comments. Back to list.
 *   3. Check log    — failed-step output. Back to detail.
 *
 * The left nav doubles as filter chrome: All / Open / Draft / Merged
 * / Closed buttons with live counts. Clicking any of them while in
 * the detail or log view returns to the list filtered to that state.
 *
 * Nav footer holds the global Refresh + Close actions, mirroring the
 * Settings drawer's "Close" footer button so muscle memory carries.
 */

type Filter = 'all' | 'open' | 'draft' | 'merged' | 'closed';

const FILTER_ORDER: Filter[] = ['all', 'open', 'draft', 'merged', 'closed'];

const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  open: 'Open',
  draft: 'Draft',
  merged: 'Merged',
  closed: 'Closed',
};

const FILTER_HINT: Record<Filter, string> = {
  all: 'Everything',
  open: 'Active',
  draft: 'Not yet ready',
  merged: 'Shipped',
  closed: 'Without merge',
};

export function PrModal() {
  const open = useStore((s) => s.prModalOpen);
  const setOpen = useStore((s) => s.setPrModalOpen);
  const inbox = useStore((s) => s.prInboxes[s.windowId]);
  const refresh = useStore((s) => s.refreshPrs);
  const detail = useStore((s) => s.prDetail);
  const closeDetail = useStore((s) => s.closePrDetail);
  const checkLog = useStore((s) => s.prCheckLog);
  const closeCheckLog = useStore((s) => s.closeCheckLog);

  const [filter, setFilter] = useState<Filter>('open');

  // Esc walks back through the layers — log → detail → list → close.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (checkLog) closeCheckLog();
      else if (detail) closeDetail();
      else setOpen(false);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, checkLog, detail, setOpen, closeCheckLog, closeDetail]);

  const prs = inbox?.prs ?? [];
  const counts = countByFilter(prs);

  // Picking a filter while in detail/log returns to the list with
  // that filter applied — natural mental model since the user is
  // expressing "show me <state>".
  const onPickFilter = (f: Filter) => {
    setFilter(f);
    if (checkLog) closeCheckLog();
    if (detail) closeDetail();
  };

  return (
    <div
      className={'pr-drawer-root' + (open ? ' open' : '')}
      {...(!open ? { inert: '' } : {})}
    >
      <div
        className="pr-drawer-backdrop"
        onClick={() => setOpen(false)}
        aria-hidden
      />
      <aside
        className="pr-drawer"
        role="dialog"
        aria-modal
        aria-label="Pull requests"
      >
        <nav className="pr-nav">
          <div className="pr-nav-title">Pull requests</div>
          <div className="pr-nav-list">
            {FILTER_ORDER.map((f) => (
              <button
                key={f}
                type="button"
                className={'pr-nav-item' + (filter === f ? ' active' : '')}
                onClick={() => onPickFilter(f)}
              >
                <span className="pr-nav-label">{FILTER_LABEL[f]}</span>
                <span className="pr-nav-hint">{FILTER_HINT[f]}</span>
                <span className="pr-nav-count">{counts[f]}</span>
              </button>
            ))}
          </div>
          <div className="pr-nav-footer">
            <div className="pr-nav-meta">
              {inbox?.syncedAt
                ? `Synced ${formatRelative(inbox.syncedAt)}`
                : 'Not yet synced'}
            </div>
            <button
              type="button"
              className="pr-nav-action"
              onClick={() => void refresh()}
              disabled={inbox?.syncing}
              title="Re-fetch from gh"
            >
              <RefreshGlyph />
              {inbox?.syncing ? 'Refreshing…' : 'Refresh'}
            </button>
            <button
              type="button"
              className="pr-nav-action pr-nav-action-close"
              onClick={() => setOpen(false)}
              title="Close (esc)"
            >
              <CloseIcon size={14} /> Close
            </button>
          </div>
        </nav>
        <main className="pr-content">
          {checkLog ? (
            <CheckLogView />
          ) : detail ? (
            <DetailView />
          ) : (
            <ListView filter={filter} prs={prs} />
          )}
        </main>
      </aside>
    </div>
  );
}

// ── List view ──────────────────────────────────────────────────────

function ListView({ filter, prs }: { filter: Filter; prs: PrSummary[] }) {
  const inbox = useStore((s) => s.prInboxes[s.windowId]);
  const openDetail = useStore((s) => s.openPrDetail);

  const filtered = prs.filter((p) => matchesFilter(p, filter));

  return (
    <>
      <div className="pr-pane-header">
        <h2 className="pr-pane-title">{titleFor(filter)}</h2>
        <p className="pr-pane-desc">
          {filtered.length} {filtered.length === 1 ? 'pull request' : 'pull requests'}
          {inbox?.syncing ? ' · refreshing…' : ''}
        </p>
      </div>

      <div className="pr-pane-body">
        {inbox?.notAvailable ? (
          <NoGhHint />
        ) : inbox?.error ? (
          <ErrorBanner message={inbox.error} />
        ) : null}

        {filtered.length === 0 && !inbox?.syncing && !inbox?.notAvailable ? (
          <div className="pr-empty">
            {emptyCopy(filter)}
          </div>
        ) : (
          <div className="pr-cards">
            {filtered.map((pr) => (
              <PrCard
                key={pr.number}
                pr={pr}
                onOpen={() => void openDetail(pr.number)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}

function PrCard({ pr, onOpen }: { pr: PrSummary; onOpen: () => void }) {
  const stateBadge =
    pr.state === 'merged'
      ? { label: 'Merged', cls: 'pr-state-merged' }
      : pr.state === 'closed'
        ? { label: 'Closed', cls: 'pr-state-closed' }
        : pr.isDraft
          ? { label: 'Draft', cls: 'pr-state-draft' }
          : { label: 'Open', cls: 'pr-state-open' };

  return (
    <button type="button" className="pr-card" onClick={onOpen}>
      <div className="pr-card-row">
        <span className={`pr-state ${stateBadge.cls}`}>{stateBadge.label}</span>
        <span className="pr-num">#{pr.number}</span>
        <span className="pr-card-title" title={pr.title}>
          {pr.title}
        </span>
      </div>
      <div className="pr-card-row pr-card-meta">
        <span className="pr-branch">
          <span className="pr-branch-head">{pr.headRef}</span>
          <span className="pr-branch-arrow">→</span>
          <span className="pr-branch-base">{pr.baseRef}</span>
        </span>
        <span className="pr-author">@{pr.author}</span>
        {pr.reviewDecision && (
          <span className={`pr-review pr-review-${pr.reviewDecision}`}>
            {reviewLabel(pr.reviewDecision)}
          </span>
        )}
        <ChecksSummary
          total={pr.checksTotal}
          passed={pr.checksPassed}
          failed={pr.checksFailed}
          pending={pr.checksPending}
        />
        {pr.commentCount > 0 && (
          <span className="pr-comments-count" title="Comments">
            💬 {pr.commentCount}
          </span>
        )}
        <span className="pr-updated">{formatRelative(Date.parse(pr.updatedAt))}</span>
      </div>
    </button>
  );
}

function ChecksSummary(props: {
  total: number;
  passed: number;
  failed: number;
  pending: number;
}) {
  if (props.total === 0)
    return <span className="pr-checks pr-checks-none">No checks</span>;
  if (props.failed > 0)
    return <span className="pr-checks pr-checks-failed">✗ {props.failed} failed</span>;
  if (props.pending > 0)
    return <span className="pr-checks pr-checks-pending">⋯ {props.pending} pending</span>;
  return <span className="pr-checks pr-checks-passed">✓ {props.passed} passed</span>;
}

// ── Detail view ────────────────────────────────────────────────────

function DetailView() {
  const detail = useStore((s) => s.prDetail);
  const loading = useStore((s) => s.prDetailLoading);
  const error = useStore((s) => s.prDetailError);
  const closeDetail = useStore((s) => s.closePrDetail);
  const openCheckLog = useStore((s) => s.openCheckLog);
  const seedPaneInput = useStore((s) => s.seedPaneInput);
  const setPrModalOpen = useStore((s) => s.setPrModalOpen);
  const cwd = useStore((s) => s.cwd);

  // Tracks which row is currently fetching its log + dispatching to
  // an agent — disables the button + shows "Sending…" while in flight.
  const [busyRowKey, setBusyRowKey] = useState<string | null>(null);

  const sendCheckToAgent = async (
    rowKey: string,
    check: CheckRun,
    paneId: PaneId,
  ) => {
    if (!detail || !cwd || !check.runId) return;
    setBusyRowKey(rowKey);
    try {
      // Use the cached log if we've already fetched it (the user
      // probably clicked Show log first). Logs don't change for a
      // given run id, so cache hits are always safe. Falls through
      // to a fresh fetch when not cached.
      const cached = useStore.getState().prCheckLogs[check.runId];
      const log =
        cached !== undefined
          ? cached
          : await window.cowork.pr.checkLogs(cwd, check.runId);
      const prompt = buildCheckPrompt({ pr: detail, check, log });
      seedPaneInput(paneId, prompt);
      setPrModalOpen(false);
    } catch (err) {
      console.error('[pr] send check to agent failed:', err);
      // Even on log fetch failure, offer to send what we have so the
      // user can paste the failure URL into the agent manually.
      const prompt = buildCheckPrompt({
        pr: detail,
        check,
        log: '(log unavailable — fetch failed)',
      });
      seedPaneInput(paneId, prompt);
      setPrModalOpen(false);
    } finally {
      setBusyRowKey(null);
    }
  };

  const sendReviewCommentToAgent = (
    comment: PrReviewComment,
    paneId: PaneId,
  ) => {
    if (!detail) return;
    seedPaneInput(paneId, buildReviewCommentPrompt({ pr: detail, comment }));
    setPrModalOpen(false);
  };

  const sendIssueCommentToAgent = (comment: PrComment, paneId: PaneId) => {
    if (!detail) return;
    seedPaneInput(paneId, buildIssueCommentPrompt({ pr: detail, comment }));
    setPrModalOpen(false);
  };

  if (!detail) {
    return (
      <>
        <div className="pr-pane-header pr-pane-header-row">
          <button type="button" className="pr-back-btn" onClick={closeDetail}>
            ← Back
          </button>
          <h2 className="pr-pane-title">
            {loading ? 'Loading PR…' : error ? 'Failed to load PR.' : ''}
          </h2>
        </div>
        <div className="pr-pane-body">
          {error && <ErrorBanner message={error} />}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="pr-pane-header pr-pane-header-row">
        <button type="button" className="pr-back-btn" onClick={closeDetail}>
          ← Back
        </button>
        <h2 className="pr-pane-title pr-detail-title" title={detail.title}>
          <span className="pr-num">#{detail.number}</span> {detail.title}
        </h2>
        <a
          className="pr-pane-link"
          href={detail.url}
          target="_blank"
          rel="noopener noreferrer"
        >
          Open on GitHub ↗
        </a>
      </div>

      <div className="pr-pane-body">
        <div className="pr-detail-meta">
          <span className="pr-branch">
            <span className="pr-branch-head">{detail.headRef}</span>
            <span className="pr-branch-arrow">→</span>
            <span className="pr-branch-base">{detail.baseRef}</span>
          </span>
          <span className="pr-author">@{detail.author}</span>
          {detail.reviewDecision && (
            <span className={`pr-review pr-review-${detail.reviewDecision}`}>
              {reviewLabel(detail.reviewDecision)}
            </span>
          )}
        </div>

        <Section title={`Checks (${detail.checks.length})`}>
          {detail.checks.length === 0 ? (
            <div className="pr-empty-row">No checks have run on this PR yet.</div>
          ) : (
            <div className="pr-checks-list">
              {detail.checks.map((c, idx) => {
                const rowKey = `${c.name}-${idx}`;
                return (
                  <CheckRow
                    key={rowKey}
                    check={c}
                    onShowLog={
                      c.runId && c.state === 'failure'
                        ? () => void openCheckLog(c.runId!)
                        : undefined
                    }
                    sendBusy={busyRowKey === rowKey}
                    onSendToAgent={
                      c.runId && c.state === 'failure'
                        ? (paneId) => void sendCheckToAgent(rowKey, c, paneId)
                        : undefined
                    }
                  />
                );
              })}
            </div>
          )}
        </Section>

        <Section title={`Comments (${detail.commentCount})`}>
          {detail.comments.length === 0 && detail.reviewComments.length === 0 ? (
            <div className="pr-empty-row">No comments.</div>
          ) : (
            <div className="pr-comments-list">
              {detail.comments.map((c) => (
                <div key={c.id} className="pr-comment">
                  <div className="pr-comment-head">
                    <span className="pr-comment-author">@{c.author}</span>
                    <span className="pr-comment-date">
                      {formatRelative(Date.parse(c.createdAt))}
                    </span>
                  </div>
                  <div className="pr-comment-body">{c.body}</div>
                  <div className="pr-comment-actions">
                    <SendToAgentMenu
                      onPick={(paneId) => sendIssueCommentToAgent(c, paneId)}
                    />
                  </div>
                </div>
              ))}
              {detail.reviewComments.map((c) => (
                <ReviewCommentCard
                  key={c.id}
                  comment={c}
                  onSend={(paneId) => sendReviewCommentToAgent(c, paneId)}
                />
              ))}
            </div>
          )}
        </Section>
      </div>
    </>
  );
}

function CheckRow({
  check,
  onShowLog,
  onSendToAgent,
  sendBusy,
}: {
  check: CheckRun;
  onShowLog?: () => void;
  onSendToAgent?: (paneId: PaneId) => void;
  sendBusy?: boolean;
}) {
  return (
    <div className={`pr-check pr-check-${check.state}`}>
      <span className="pr-check-icon" aria-hidden>
        {checkGlyph(check.state)}
      </span>
      <span className="pr-check-name" title={check.name}>
        {check.name}
      </span>
      <span className="pr-check-state">{stateLabel(check.state)}</span>
      <div className="pr-check-actions">
        {onSendToAgent && (
          <SendToAgentMenu onPick={onSendToAgent} busy={sendBusy} />
        )}
        {onShowLog && (
          <button type="button" className="pr-btn pr-btn-sm" onClick={onShowLog}>
            Show log
          </button>
        )}
        {check.detailsUrl && (
          <a
            className="pr-btn pr-btn-sm pr-btn-ghost"
            href={check.detailsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open ↗
          </a>
        )}
      </div>
    </div>
  );
}

/**
 * Inline review comment card. Shows author + file:line + body + send
 * action by default; the diff hunk (which can run 6+ lines of code)
 * stays hidden behind a "Show context" toggle so the comment list
 * scans cleanly. Toggle remembers state per-mount; closing and
 * re-opening the PR resets it (which is fine — short-lived view).
 */
function ReviewCommentCard({
  comment,
  onSend,
}: {
  comment: PrReviewComment;
  onSend: (paneId: PaneId) => void;
}) {
  const [showContext, setShowContext] = useState(false);
  return (
    <div className="pr-comment pr-comment-review">
      <div className="pr-comment-head">
        <span className="pr-comment-author">@{comment.author}</span>
        <span className="pr-comment-loc">
          {comment.path}
          {comment.line ? `:${comment.line}` : ''}
        </span>
        <span className="pr-comment-date">
          {formatRelative(Date.parse(comment.createdAt))}
        </span>
      </div>
      <div className="pr-comment-body">{comment.body}</div>
      <div className="pr-comment-actions">
        {comment.diffHunk && (
          <button
            type="button"
            className="pr-btn pr-btn-sm pr-btn-ghost pr-context-toggle"
            onClick={() => setShowContext((v) => !v)}
            title="Show or hide the diff hunk context"
          >
            {showContext ? 'Hide context' : 'Show context'}
          </button>
        )}
        <SendToAgentMenu onPick={onSend} />
      </div>
      {showContext && comment.diffHunk && (
        <pre className="pr-comment-hunk">{comment.diffHunk}</pre>
      )}
    </div>
  );
}

// ── Check log view ─────────────────────────────────────────────────

function CheckLogView() {
  const log = useStore((s) => s.prCheckLog);
  const loading = useStore((s) => s.prCheckLogLoading);
  const error = useStore((s) => s.prCheckLogError);
  const close = useStore((s) => s.closeCheckLog);

  return (
    <>
      <div className="pr-pane-header pr-pane-header-row">
        <button type="button" className="pr-back-btn" onClick={close}>
          ← Back to PR
        </button>
        <h2 className="pr-pane-title">Failed step output</h2>
        <span className="pr-pane-meta">
          {loading ? 'Loading…' : log ? `Run #${log.runId}` : ''}
        </span>
      </div>
      <div className="pr-pane-body pr-pane-body-log">
        {error ? (
          <ErrorBanner message={error} />
        ) : (
          <pre className="pr-log">
            {loading ? 'Fetching log…' : log?.text || '(empty)'}
          </pre>
        )}
      </div>
    </>
  );
}

// ── Shared bits ────────────────────────────────────────────────────

function Section(props: { title: string; children: React.ReactNode }) {
  return (
    <section className="pr-section-block">
      <h3 className="pr-section-block-title">{props.title}</h3>
      {props.children}
    </section>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return <div className="pr-error">{message}</div>;
}

function NoGhHint() {
  return (
    <div className="pr-error pr-error-hint">
      <strong>GitHub CLI not set up.</strong> Install <code>gh</code> from{' '}
      <a href="https://cli.github.com" target="_blank" rel="noopener noreferrer">
        cli.github.com
      </a>{' '}
      and run <code>gh auth login</code> to enable this view.
    </div>
  );
}

function RefreshGlyph() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <polyline points="14 3 14 7 10 7" />
      <path d="M2.5 9a6 6 0 0 0 11.1 1.5" />
      <polyline points="2 13 2 9 6 9" />
      <path d="M13.5 7a6 6 0 0 0-11.1-1.5" />
    </svg>
  );
}

// ── Helpers ────────────────────────────────────────────────────────

function matchesFilter(pr: PrSummary, filter: Filter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'open':
      return pr.state === 'open' && !pr.isDraft;
    case 'draft':
      return pr.state === 'open' && pr.isDraft;
    case 'merged':
      return pr.state === 'merged';
    case 'closed':
      return pr.state === 'closed';
  }
}

function countByFilter(prs: PrSummary[]): Record<Filter, number> {
  const counts: Record<Filter, number> = {
    all: prs.length,
    open: 0,
    draft: 0,
    merged: 0,
    closed: 0,
  };
  for (const pr of prs) {
    if (pr.state === 'merged') counts.merged += 1;
    else if (pr.state === 'closed') counts.closed += 1;
    else if (pr.isDraft) counts.draft += 1;
    else counts.open += 1;
  }
  return counts;
}

function titleFor(filter: Filter): string {
  switch (filter) {
    case 'all':
      return 'All pull requests';
    case 'open':
      return 'Open pull requests';
    case 'draft':
      return 'Draft pull requests';
    case 'merged':
      return 'Merged pull requests';
    case 'closed':
      return 'Closed pull requests';
  }
}

function emptyCopy(filter: Filter): string {
  switch (filter) {
    case 'all':
      return 'No pull requests for this repository yet.';
    case 'open':
      return 'No open pull requests right now.';
    case 'draft':
      return 'No drafts yet.';
    case 'merged':
      return "No merged PRs in the recent batch.";
    case 'closed':
      return 'No closed PRs in the recent batch.';
  }
}

function reviewLabel(decision: string): string {
  switch (decision) {
    case 'APPROVED':
      return '✓ Approved';
    case 'CHANGES_REQUESTED':
      return '✗ Changes requested';
    case 'REVIEW_REQUIRED':
      return 'Review required';
    case 'COMMENTED':
      return 'Commented';
    default:
      return decision;
  }
}

function checkGlyph(state: CheckState): string {
  switch (state) {
    case 'success':
      return '✓';
    case 'failure':
      return '✗';
    case 'cancelled':
      return '⊘';
    case 'pending':
    case 'running':
      return '⋯';
    case 'skipped':
      return '–';
    default:
      return '?';
  }
}

function stateLabel(state: CheckState): string {
  switch (state) {
    case 'pending':
      return 'Pending';
    case 'running':
      return 'Running';
    case 'success':
      return 'Passed';
    case 'failure':
      return 'Failed';
    case 'skipped':
      return 'Skipped';
    case 'cancelled':
      return 'Cancelled';
    default:
      return 'Unknown';
  }
}

// ── Send to agent ──────────────────────────────────────────────────

/**
 * Eligible target panes for "Send to agent" — the active project's
 * tree leaves that have an agent bound (not terminal kind), plus the
 * Lead pane if Lead mode is active. Returns display labels too so the
 * dropdown can render "Frontend Developer" instead of bare slugs.
 */
function useEligibleAgentPanes(): Array<{
  id: PaneId;
  label: string;
  agentName: string;
}> {
  const tree = useStore((s) => s.tree);
  const panes = useStore((s) => s.panes);
  const leadPaneId = useStore((s) => s.leadPaneId);
  const leadPaneName = useStore((s) => s.leadPaneName);
  return useMemo(() => {
    const list: Array<{ id: PaneId; label: string; agentName: string }> = [];
    for (const meta of collectLeavesWithAgents(tree)) {
      if (meta.workerKind === 'terminal') continue;
      if (!meta.agentName) continue;
      const display = getPaneDisplayName(
        tree,
        meta.id,
        leadPaneId
          ? { paneId: leadPaneId, paneName: leadPaneName ?? undefined }
          : null,
      );
      const label = display.isCustom
        ? display.name
        : humanizeAgentName(meta.agentName);
      list.push({ id: meta.id, label, agentName: meta.agentName });
    }
    if (leadPaneId) {
      const leadAgent = panes[leadPaneId]?.agentName;
      if (leadAgent && !list.some((p) => p.id === leadPaneId)) {
        list.push({
          id: leadPaneId,
          label: leadPaneName?.trim() || humanizeAgentName(leadAgent),
          agentName: leadAgent,
        });
      }
    }
    return list;
  }, [tree, panes, leadPaneId, leadPaneName]);
}

/**
 * Dropdown that lists eligible agent panes; clicking one calls
 * `onPick(paneId)`. Renders nothing (button-disabled state) when no
 * panes are eligible — the parent surfaces a "drop an agent on a
 * pane first" tooltip.
 */
function SendToAgentMenu({
  onPick,
  busy,
  variant = 'sm',
}: {
  onPick: (paneId: PaneId) => void;
  busy?: boolean;
  variant?: 'sm' | 'md';
}) {
  const panes = useEligibleAgentPanes();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node))
        setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const disabled = panes.length === 0 || busy;
  const klass = `pr-btn pr-btn-${variant} pr-send-btn` +
    (panes.length === 0 ? ' pr-send-btn-disabled' : '');

  return (
    <div className="pr-send-wrap" ref={ref}>
      <button
        type="button"
        className={klass}
        disabled={disabled}
        title={
          panes.length === 0
            ? 'Open a pane with an agent first to enable this'
            : busy
              ? 'Preparing…'
              : 'Send context to one of your agents'
        }
        onClick={() => setOpen((v) => !v)}
      >
        {busy ? 'Sending…' : `Send to agent ${panes.length === 0 ? '' : '▾'}`}
      </button>
      {open && panes.length > 0 && (
        <div className="pr-send-menu" role="menu">
          <div className="pr-send-menu-head">Pick an agent pane</div>
          {panes.map((p) => (
            <button
              key={p.id}
              type="button"
              className="pr-send-menu-item"
              onClick={() => {
                setOpen(false);
                onPick(p.id);
              }}
            >
              <span className="pr-send-menu-label">{p.label}</span>
              <span className="pr-send-menu-slug">{p.agentName}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Build a prepared prompt for a failing check. Includes the check
 * name, run URL, and the trimmed log so the agent has everything it
 * needs to localise the failure without bouncing back to GitHub.
 */
function buildCheckPrompt(args: {
  pr: PrDetail;
  check: CheckRun;
  log: string;
}): string {
  const { pr, check, log } = args;
  const lines = [
    `A CI check failed on PR #${pr.number} (${pr.title}).`,
    ``,
    `Check: ${check.name}`,
    check.detailsUrl ? `Run: ${check.detailsUrl}` : null,
    `Branch: ${pr.headRef}${pr.baseRef ? ` → ${pr.baseRef}` : ''}`,
    ``,
    `Failed step output (trimmed):`,
    '```',
    log.trim() || '(empty log)',
    '```',
    ``,
    `Please diagnose the failure and fix the underlying issue in the codebase. Make the smallest change that gets the check passing again.`,
  ].filter((x): x is string => x !== null);
  return lines.join('\n');
}

/**
 * Build a prompt for an inline review comment on a specific file +
 * line. Includes the diff hunk so the agent can see surrounding
 * context, and an explicit instruction to address the comment.
 */
function buildReviewCommentPrompt(args: {
  pr: PrDetail;
  comment: PrReviewComment;
}): string {
  const { pr, comment } = args;
  const loc = comment.line
    ? `${comment.path}:${comment.line}`
    : comment.path;
  const lines = [
    `A reviewer left an inline comment on PR #${pr.number}.`,
    ``,
    `From: @${comment.author}`,
    `File: ${loc}`,
    comment.url ? `Link: ${comment.url}` : null,
    ``,
    `Comment:`,
    quoteBlock(comment.body),
    ``,
  ];
  if (comment.diffHunk) {
    lines.push('Code context (diff hunk):');
    lines.push('```diff');
    lines.push(comment.diffHunk.trim());
    lines.push('```');
    lines.push('');
  }
  lines.push(
    `Please open ${comment.path}, locate the relevant code (line ${comment.line ?? '?'}), and address the comment. Make the smallest possible change that resolves the feedback.`,
  );
  return lines.filter((x): x is string => x !== null).join('\n');
}

/**
 * Build a prompt for a top-level (issue) comment with no file
 * context. The agent should treat it as a discussion item and
 * either respond or propose a code change.
 */
function buildIssueCommentPrompt(args: {
  pr: PrDetail;
  comment: PrComment;
}): string {
  const { pr, comment } = args;
  return [
    `A comment was posted on PR #${pr.number} (${pr.title}).`,
    ``,
    `From: @${comment.author}`,
    comment.url ? `Link: ${comment.url}` : null,
    ``,
    `Comment:`,
    quoteBlock(comment.body),
    ``,
    `Please review this and either propose code changes or share your assessment.`,
  ]
    .filter((x): x is string => x !== null)
    .join('\n');
}

function quoteBlock(text: string): string {
  return text
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}

function formatRelative(ts: number): string {
  if (!ts || isNaN(ts)) return '';
  const secs = Math.floor((Date.now() - ts) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  return `${Math.floor(secs / 86400)}d ago`;
}
