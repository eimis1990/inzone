import { useStore } from '../store';

/**
 * Pull request pill — sits in the workspace bar's left cluster
 * between the Workspaces and Preview pills. Always visible (so the
 * user knows the feature exists even on PR-less projects); shows
 * the open-PR count plus a coloured dot conveying aggregate health
 * across them:
 *
 *   - red   → at least one PR has a failing check
 *   - amber → at least one PR has pending checks
 *   - green → all PRs passing
 *   - dim   → no open PRs (or gh not yet set up)
 *
 * Click → opens the PR modal which handles fetch / list / detail /
 * log views. The 5-min auto-poll lives in App.tsx's effect; this
 * component just reads cached state.
 */
export function PrButton() {
  const windowId = useStore((s) => s.windowId);
  const inbox = useStore((s) => s.prInboxes[s.windowId]);
  const setPrModalOpen = useStore((s) => s.setPrModalOpen);

  // No project selected yet — render nothing rather than a confused
  // empty pill.
  if (!windowId) return null;

  const openPrs = (inbox?.prs ?? []).filter(
    (p) => p.state === 'open' && !p.isDraft,
  );

  // Aggregate health across all currently-open PRs. The pill colour
  // is the worst state we find — failure beats pending beats success.
  let health: 'failure' | 'pending' | 'success' | 'none';
  if (openPrs.length === 0) health = 'none';
  else if (openPrs.some((p) => p.checksFailed > 0)) health = 'failure';
  else if (openPrs.some((p) => p.checksPending > 0)) health = 'pending';
  else if (openPrs.some((p) => p.checksTotal > 0)) health = 'success';
  else health = 'none';

  const count = openPrs.length;
  const label = count === 0 ? 'PRs' : `${count} PR${count === 1 ? '' : 's'}`;
  const title =
    inbox?.notAvailable
      ? 'GitHub CLI (gh) not set up — click to open the PR view for setup hints'
      : count === 0
        ? 'No open pull requests'
        : `${count} open PR${count === 1 ? '' : 's'}`;

  return (
    <button
      type="button"
      className={
        'wb-pill pr-pill' +
        (count > 0 ? ' pr-pill-has' : ' pr-pill-empty') +
        ` pr-pill-${health}`
      }
      onClick={() => setPrModalOpen(true)}
      title={title}
    >
      <PrIcon />
      <span className="wb-pill-label">{label}</span>
      {/* Sync-state spinner removed in v1.15.3 — the bar polled gh
          every 5 minutes and the brief spinner flicker was visually
          noisy. The health dot stays put; users see fresh state
          when the poll completes, with no transient indicator in
          between. */}
      {count > 0 && health !== 'none' && (
        <span
          className={`pr-pill-dot pr-pill-dot-${health}`}
          aria-hidden
        />
      )}
    </button>
  );
}

/** Inline minimal pull-request glyph. Matches the visual weight of
 *  the other workspace-bar icons (~14px stroke). */
function PrIcon() {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="4" cy="3.5" r="1.5" />
      <circle cx="4" cy="12.5" r="1.5" />
      <circle cx="12" cy="12.5" r="1.5" />
      <line x1="4" y1="5" x2="4" y2="11" />
      <path d="M12 11V8a3 3 0 0 0-3-3H7" />
      <polyline points="9 7 7 5 9 3" />
    </svg>
  );
}
