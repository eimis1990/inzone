import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';

interface ShipPRModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * "Ship as PR" modal — opens from the Review toolbar's Open PR button.
 *
 * Sequence on open:
 *   1. Probe `gh` (cached in `ghStatus`).
 *   2. Ask Claude to draft a title + body in parallel.
 *   3. User edits; clicks "Open PR".
 *   4. We commit (when dirty) → push → create PR via gh, surfacing
 *      a per-step status row.
 *   5. On success we show the PR URL (clickable). On error we show
 *      the error message verbatim with retry.
 *
 * The store does the heavy lifting; this component is mostly a form
 * + state transitions over `prWorkflowStatus`.
 */
export function ShipPRModal({ open, onClose }: ShipPRModalProps) {
  const ghStatus = useStore((s) => s.ghStatus);
  const ghAccounts = useStore((s) => s.ghAccounts);
  const reviewState = useStore((s) => s.reviewState);
  const prStatus = useStore((s) => s.prWorkflowStatus);
  const prResult = useStore((s) => s.prResult);
  const prError = useStore((s) => s.prError);
  // Subscribed up here (alongside the other top-level hooks) instead
  // of after the early-return on line 138. React requires hooks to
  // be called in the same order every render — putting useStore
  // below `if (!open) return null` caused "Rendered more hooks than
  // during the previous render" the moment the modal opened.
  const sessionsArr = useStore((s) => s.sessions);
  const windowId = useStore((s) => s.windowId);
  const loadGhStatus = useStore((s) => s.loadGhStatus);
  const loadGhAccounts = useStore((s) => s.loadGhAccounts);
  const generatePRDescription = useStore((s) => s.generatePRDescription);
  const shipPR = useStore((s) => s.shipPR);
  const resetPRWorkflow = useStore((s) => s.resetPRWorkflow);

  // Form state.
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [commitMessage, setCommitMessage] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [isDraft, setIsDraft] = useState(false);
  const [pushAs, setPushAs] = useState('');

  // Generation state — separate from the main workflow because
  // generation runs on open and should NOT block submission if the
  // user types their own title/body.
  const [generating, setGenerating] = useState(false);
  const generatedOnceRef = useRef(false);


  /** Auto-run on every open: probe gh + draft a description. */
  useEffect(() => {
    if (!open) {
      // Reset when closing so the next open is fresh.
      generatedOnceRef.current = false;
      return;
    }
    void loadGhStatus();
    void loadGhAccounts();
    if (!generatedOnceRef.current) {
      generatedOnceRef.current = true;
      setGenerating(true);
      generatePRDescription()
        .then((draft) => {
          // Only fill the inputs if the user hasn't typed anything
          // since the modal opened (avoid clobbering their edits).
          setTitle((prev) => (prev ? prev : draft.title));
          setBody((prev) => (prev ? prev : draft.body));
          setCommitMessage((prev) => (prev ? prev : draft.title));
        })
        .catch(() => {
          // Fallback values come from the store's PR summarizer
          // already, but in case of total failure we still want the
          // form to be usable - leave inputs empty.
        })
        .finally(() => setGenerating(false));
    }
  }, [open, loadGhStatus, loadGhAccounts, generatePRDescription]);

  // Auto-select the gh account that matches the repo's owner. Saves
  // the user from picking manually when their multi-account setup
  // already includes an account with rights to the target repo.
  useEffect(() => {
    if (!open || pushAs) return;
    if (ghAccounts.length === 0) return;
    const repoOwner = ghStatus?.repoSlug?.split('/')[0]?.toLowerCase();
    const ownerMatch = repoOwner
      ? ghAccounts.find((a) => a.login.toLowerCase() === repoOwner)
      : undefined;
    const active = ghAccounts.find((a) => a.active);
    setPushAs((ownerMatch ?? active)?.login ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ghAccounts, ghStatus]);

  // Default base branch — try gh-detected origin/HEAD first, then
  // fall back to the worktree's known base (worktreeBase, which
  // ReviewState already exposes as `baseBranch`). Either is correct
  // for the typical "branch off main" workflow; we just need
  // something so the button isn't silently disabled.
  useEffect(() => {
    if (!open || baseBranch) return;
    const fallback =
      ghStatus?.defaultBranch ?? reviewState?.baseBranch ?? '';
    if (fallback) setBaseBranch(fallback);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ghStatus, reviewState]);

  // Reset PR workflow + form on close.
  const handleClose = () => {
    if (
      prStatus === 'committing' ||
      prStatus === 'pushing' ||
      prStatus === 'creating-pr'
    ) {
      // Don't let the user close mid-flight — gh has no way to
      // cancel a half-finished PR cleanly.
      return;
    }
    resetPRWorkflow();
    setTitle('');
    setBody('');
    setCommitMessage('');
    setBaseBranch('');
    setIsDraft(false);
    setPushAs('');
    onClose();
  };

  if (!open) return null;

  // The setup hint surfaces when gh is missing or unauth'd. It's
  // informational + blocks the submit button.
  const ghNotReady =
    ghStatus !== null &&
    (!ghStatus.installed || !ghStatus.authenticated || !ghStatus.repoSlug);

  // SSH-with-multi-account warning surfaces only when (a) gh works,
  // (b) the user has more than one gh account (so account switching
  // is meaningful), and (c) the repo's remote is SSH (where ssh-agent
  // — not gh — picks the key). Single-account users with SSH push
  // don't see it.
  // Derive the current session from the subscribed primitives.
  // Worktree projects (parentProjectId set) get the post-merge
  // wrap-up panel after a successful PR.
  const session = sessionsArr.find((p) => p.id === windowId);
  const showSshWarning =
    !ghNotReady &&
    ghAccounts.length > 1 &&
    ghStatus?.remoteProtocol === 'ssh';

  const formDisabled =
    prStatus === 'committing' ||
    prStatus === 'pushing' ||
    prStatus === 'creating-pr';

  const canSubmit =
    !formDisabled &&
    !ghNotReady &&
    title.trim().length > 0 &&
    body.trim().length > 0 &&
    commitMessage.trim().length > 0 &&
    baseBranch.trim().length > 0 &&
    reviewState != null;

  const submit = () => {
    if (!canSubmit) return;
    void shipPR({
      commitMessage,
      title,
      body,
      baseBranch,
      draft: isDraft,
      pushAs: pushAs || undefined,
    });
  };

  return (
    <div className="modal-backdrop" onMouseDown={handleClose}>
      <div
        className="modal ship-pr-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <h2>Open pull request</h2>
          <p className="modal-sub">
            Commit any uncommitted changes, push the branch, and open a
            PR via <code>gh</code>.
          </p>
        </div>

        <div className="modal-body">
          {/* Setup banner (gh missing or unauth'd) */}
          {ghStatus === null && (
            <div className="ship-pr-status">Checking <code>gh</code>...</div>
          )}
          {ghNotReady && ghStatus && (
            <GhSetupBanner status={ghStatus} />
          )}

          {/* Repo destination */}
          {ghStatus?.installed && ghStatus?.repoSlug && (
            <div className="ship-pr-destination">
              <span className="ship-pr-destination-label">Will open in</span>
              <code>{ghStatus.repoSlug}</code>
              <span className="ship-pr-destination-arrow">·</span>
              <code>{baseBranch || ghStatus.defaultBranch || '(pick base)'}</code>
            </div>
          )}

          {/* SSH-with-multi-account hint. Push goes through ssh-agent
              (not gh), so the "Push as" dropdown can't influence
              which key gets used — that's an ssh-config concern.
              We surface a copy-paste-ready ~/.ssh/config snippet so
              the user can wire host aliases for each account, then
              point each repo's remote at the matching alias. */}
          {showSshWarning && <SshAliasHint />}

          {/* Live workflow status — replaces the form when shipping. */}
          {(formDisabled || prStatus === 'done' || prStatus === 'error') && (
            <ShipPRProgress
              status={prStatus}
              result={prResult}
              error={prError}
              onRetry={() => {
                resetPRWorkflow();
              }}
              onClose={handleClose}
            />
          )}

          {/* Wrap-up panel — only shown after successful PR creation
              and only on worktree projects. Lets the user merge the
              PR on GitHub then click one button to pull main + remove
              the worktree + delete the branch + switch to parent. */}
          {prStatus === 'done' && session?.parentProjectId && (
            <WrapUpPanel onClose={handleClose} />
          )}

          {/* The form itself — hide while shipping or after done. */}
          {!formDisabled && prStatus !== 'done' && prStatus !== 'error' && (
            <>
              <label className="kv-row stacked">
                <span>
                  PR title
                  {generating && (
                    <span className="ship-pr-generating"> · drafting…</span>
                  )}
                </span>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={generating ? 'Asking Claude…' : 'Imperative one-liner'}
                  disabled={generating && !title}
                  maxLength={120}
                />
              </label>

              <label className="kv-row stacked">
                <span>
                  PR description
                  {generating && (
                    <span className="ship-pr-generating"> · drafting…</span>
                  )}
                </span>
                <textarea
                  className="ship-pr-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder={
                    generating
                      ? 'Claude is drafting a Summary + Changes section...'
                      : 'Markdown body — Summary, Changes, etc.'
                  }
                  rows={12}
                  spellCheck={false}
                  disabled={generating && !body}
                />
              </label>

              <label className="kv-row stacked">
                <span>Commit message</span>
                <input
                  type="text"
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="Subject line for the squash commit"
                  maxLength={120}
                />
                <span className="kv-hint">
                  Used when there are uncommitted changes. Skipped if the
                  working tree is already clean.
                </span>
              </label>

              {/* "Push as" — only surfaces when the user has more than
                  one gh-authed account. The auto-fill picks the
                  account whose login matches the repo owner; the user
                  can override. Single-account users don't see this. */}
              {ghAccounts.length > 1 && (
                <label className="kv-row stacked">
                  <span>Push as</span>
                  <select
                    value={pushAs}
                    onChange={(e) => setPushAs(e.target.value)}
                  >
                    {ghAccounts.map((a) => (
                      <option key={a.login} value={a.login}>
                        {a.login}
                        {a.active ? ' (active)' : ''}
                      </option>
                    ))}
                  </select>
                  <span className="kv-hint">
                    Switches the active gh account before push, so the
                    right credentials are used. Only effective when{' '}
                    <code>gh</code> is your git credential helper —
                    SSH-based pushes need <code>~/.ssh/config</code>{' '}
                    aliases.
                  </span>
                </label>
              )}

              <div className="ship-pr-row">
                <label className="kv-row stacked ship-pr-base">
                  <span>Base branch</span>
                  <input
                    type="text"
                    value={baseBranch}
                    onChange={(e) => setBaseBranch(e.target.value)}
                    placeholder={ghStatus?.defaultBranch ?? 'main'}
                  />
                </label>

                <label className="checkbox-row ship-pr-draft">
                  <input
                    type="checkbox"
                    checked={isDraft}
                    onChange={(e) => setIsDraft(e.target.checked)}
                  />
                  <div>
                    <div>Open as draft</div>
                    <span className="kv-hint">
                      Marks the PR as a draft so reviewers know it's not
                      ready for merge.
                    </span>
                  </div>
                </label>
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button
            type="button"
            className="ghost"
            onClick={handleClose}
            disabled={formDisabled}
          >
            {prStatus === 'done' ? 'Close' : 'Cancel'}
          </button>
          {!formDisabled && prStatus !== 'done' && prStatus !== 'error' && (
            <button
              type="button"
              className="primary"
              onClick={submit}
              disabled={!canSubmit}
              title={
                ghNotReady
                  ? 'Install + authenticate gh first.'
                  : !title.trim()
                    ? 'PR title is required.'
                    : !body.trim()
                      ? 'PR description is required.'
                      : !commitMessage.trim()
                        ? 'Commit message is required.'
                        : !baseBranch.trim()
                          ? 'Pick a base branch (default: main).'
                          : 'Commit, push, and open the PR.'
              }
            >
              Open PR
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

interface GhSetupBannerProps {
  status: import('@shared/types').GhStatus;
}

function GhSetupBanner({ status }: GhSetupBannerProps) {
  if (!status.installed) {
    return (
      <div className="ship-pr-banner ship-pr-banner-error">
        <strong>Install the GitHub CLI to open PRs from INZONE.</strong>
        <div className="ship-pr-banner-body">
          On macOS:{' '}
          <code>brew install gh</code>
          {'  '}then{'  '}
          <code>gh auth login</code>.
        </div>
      </div>
    );
  }
  if (!status.authenticated) {
    return (
      <div className="ship-pr-banner ship-pr-banner-error">
        <strong>You're not signed in to GitHub.</strong>
        <div className="ship-pr-banner-body">
          Run <code>gh auth login</code> in your terminal, then reopen
          this dialog.
        </div>
      </div>
    );
  }
  if (!status.repoSlug) {
    return (
      <div className="ship-pr-banner ship-pr-banner-error">
        <strong>This worktree has no <code>origin</code> remote.</strong>
        <div className="ship-pr-banner-body">
          Add one with{' '}
          <code>git remote add origin git@github.com:owner/repo.git</code>{' '}
          and try again.
        </div>
      </div>
    );
  }
  return null;
}

interface ShipPRProgressProps {
  status:
    | 'idle'
    | 'committing'
    | 'pushing'
    | 'creating-pr'
    | 'done'
    | 'error';
  result: { url: string; number?: number } | null;
  error: string | null;
  onRetry: () => void;
  onClose: () => void;
}

/** Vertical step list with a spinner on the active step. Replaces
 *  the form during the ship sequence + on success/error. */
function ShipPRProgress({
  status,
  result,
  error,
  onRetry,
}: ShipPRProgressProps) {
  if (status === 'done' && result) {
    return (
      <div className="ship-pr-success">
        <div className="ship-pr-success-icon">✓</div>
        <div className="ship-pr-success-body">
          <strong>PR opened</strong>
          <a
            href={result.url}
            target="_blank"
            rel="noreferrer"
            className="ship-pr-success-link"
          >
            {result.url}
          </a>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="ship-pr-error">
        <strong>Something went wrong.</strong>
        <div className="ship-pr-error-msg">{error}</div>
        <button type="button" className="primary" onClick={onRetry}>
          Try again
        </button>
      </div>
    );
  }

  const steps: Array<{ key: typeof status; label: string }> = [
    { key: 'committing', label: 'Committing changes' },
    { key: 'pushing', label: 'Pushing branch to origin' },
    { key: 'creating-pr', label: 'Creating PR via gh' },
  ];
  const currentIdx = steps.findIndex((s) => s.key === status);

  return (
    <ol className="ship-pr-steps">
      {steps.map((s, i) => {
        let cls = 'ship-pr-step';
        if (i < currentIdx) cls += ' ship-pr-step-done';
        else if (i === currentIdx) cls += ' ship-pr-step-active';
        else cls += ' ship-pr-step-pending';
        return (
          <li key={s.key} className={cls}>
            <span className="ship-pr-step-icon">
              {i < currentIdx ? '✓' : i === currentIdx ? '⟳' : '·'}
            </span>
            <span className="ship-pr-step-label">{s.label}</span>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * Informational banner shown when the user's remote is SSH and they
 * have multiple gh accounts. We can't fix the SSH key selection from
 * inside the app — that's an ssh-config concern. So we surface a
 * copy-paste-ready snippet that teaches the user how to wire host
 * aliases per account, then point each repo's remote at the right
 * alias.
 *
 * Approach: explain the mechanism (one paragraph), show the config
 * block with a copy button, mention how to repoint the remote.
 */
function SshAliasHint() {
  const sessionsArr = useStore((s) => s.sessions);
  const windowId = useStore((s) => s.windowId);
  const ghStatus = useStore((s) => s.ghStatus);
  const loadGhStatus = useStore((s) => s.loadGhStatus);

  const session = sessionsArr.find((p) => p.id === windowId);

  // Pre-fill the URL input with the HTTPS form of the current SSH
  // remote — saves the user typing in the common case.
  const suggested = ghStatus?.repoSlug
    ? `https://github.com/${ghStatus.repoSlug}.git`
    : '';
  const [urlDraft, setUrlDraft] = useState(suggested);
  const [setting, setSetting] = useState(false);
  const [setError, setSetError] = useState<string | null>(null);
  const [setOk, setSetOk] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Sync the suggested default once the slug arrives from gh probe.
  useEffect(() => {
    if (suggested && !urlDraft) setUrlDraft(suggested);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested]);

  const applyUrl = async () => {
    if (!session || !urlDraft.trim()) return;
    setSetting(true);
    setSetError(null);
    setSetOk(false);
    try {
      await window.cowork.review.setRemoteUrl({
        cwd: session.cwd,
        url: urlDraft.trim(),
      });
      // Re-probe gh so the modal's protocol/state updates and the
      // banner hides if the new URL is HTTPS.
      await loadGhStatus();
      setSetOk(true);
    } catch (err) {
      setSetError(err instanceof Error ? err.message : String(err));
    } finally {
      setSetting(false);
    }
  };

  const aliasSnippet = `Host github.com-personal
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_personal
    IdentitiesOnly yes

Host github.com-work
    HostName github.com
    User git
    IdentityFile ~/.ssh/id_ed25519_work
    IdentitiesOnly yes`;

  return (
    <div className="ship-pr-banner ship-pr-banner-warn">
      <strong>SSH push — gh can't pick which key to use.</strong>
      <div className="ship-pr-banner-body">
        Git push uses ssh-agent on SSH remotes, so switching gh
        accounts doesn't change which key is handed to GitHub. The
        easiest fix: paste an HTTPS URL for this repo. We'll point{' '}
        <code>origin</code> at it and gh credentials will drive the
        push (and the "Push as" dropdown will work).
      </div>
      <div className="ssh-alias-row">
        <input
          className="ssh-alias-input"
          type="text"
          value={urlDraft}
          onChange={(e) => setUrlDraft(e.target.value)}
          placeholder="https://github.com/owner/repo.git"
        />
        <button
          type="button"
          className="primary"
          onClick={() => void applyUrl()}
          disabled={setting || !urlDraft.trim()}
        >
          {setting ? 'Setting...' : 'Set & retry'}
        </button>
      </div>
      {setError && (
        <div className="ship-pr-banner-body" style={{ color: 'rgb(242, 109, 122)' }}>
          {setError}
        </div>
      )}
      {setOk && (
        <div
          className="ship-pr-banner-body"
          style={{ color: 'rgb(178, 234, 188)' }}
        >
          ✓ Origin updated. Click <strong>Open PR</strong> again to retry.
        </div>
      )}

      {/* Advanced — keep using SSH but wire ~/.ssh/config aliases. */}
      <button
        type="button"
        className="ssh-alias-toggle"
        onClick={() => setShowAdvanced((v) => !v)}
      >
        {showAdvanced ? '▾' : '▸'} Or stay on SSH (set up ~/.ssh/config aliases)
      </button>
      {showAdvanced && (
        <div className="ssh-alias-advanced">
          <div className="ship-pr-banner-body">
            Add this to <code>~/.ssh/config</code> — one Host alias per
            account, each with its own key. Then point this repo's
            origin at the matching alias.
          </div>
          <div className="ssh-alias-snippet">
            <div className="ssh-alias-snippet-head">
              <span>~/.ssh/config</span>
              <button
                type="button"
                className="ssh-alias-copy"
                onClick={() => {
                  void navigator.clipboard.writeText(aliasSnippet);
                }}
              >
                Copy
              </button>
            </div>
            <pre>{aliasSnippet}</pre>
          </div>
          <div className="ship-pr-banner-body">
            Then in your terminal:
          </div>
          <div className="ssh-alias-snippet">
            <div className="ssh-alias-snippet-head">
              <span>terminal</span>
              <button
                type="button"
                className="ssh-alias-copy"
                onClick={() => {
                  void navigator.clipboard.writeText(
                    'git remote set-url origin git@github.com-personal:OWNER/REPO.git',
                  );
                }}
              >
                Copy
              </button>
            </div>
            <pre>
              git remote set-url origin
              git@github.com-personal:OWNER/REPO.git
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Post-merge wrap-up panel. Surfaces in the PR-success card on
 * worktree projects. After the user merges the PR on GitHub, one
 * click here:
 *   1. pulls the base branch on the parent project's checkout (so
 *      the local main has the merged commits),
 *   2. removes the worktree (and deletes its local branch),
 *   3. switches the active session to the parent.
 *
 * State machine lives on the store as wrapUpStatus / wrapUpError.
 */
function WrapUpPanel({ onClose }: { onClose: () => void }) {
  const wrapUpStatus = useStore((s) => s.wrapUpStatus);
  const wrapUpError = useStore((s) => s.wrapUpError);
  const wrapUpAfterMerge = useStore((s) => s.wrapUpAfterMerge);
  const resetWrapUp = useStore((s) => s.resetWrapUp);

  const inFlight =
    wrapUpStatus === 'pulling' || wrapUpStatus === 'removing';

  // After a successful wrap-up the worktree is gone and the modal
  // doesn't really have anything to act on anymore. Auto-close after
  // a short beat so the user lands cleanly on the parent project.
  useEffect(() => {
    if (wrapUpStatus !== 'done') return;
    const id = setTimeout(() => {
      resetWrapUp();
      onClose();
    }, 1200);
    return () => clearTimeout(id);
  }, [wrapUpStatus, resetWrapUp, onClose]);

  return (
    <div className="ship-pr-banner ship-pr-banner-warn ship-pr-wrapup">
      <strong>Done? Wrap up the worktree.</strong>
      <div className="ship-pr-banner-body">
        Once you've merged the PR on GitHub, hit <strong>Wrap up</strong>{' '}
        and we'll pull <code>main</code> into the parent project,
        remove this worktree, delete the local branch, and switch you
        back to the parent. One click for what's normally four steps.
      </div>

      {wrapUpStatus === 'pulling' && (
        <div className="ship-pr-banner-body" style={{ color: 'var(--text)' }}>
          ⟳ Pulling latest <code>main</code> into the parent…
        </div>
      )}
      {wrapUpStatus === 'removing' && (
        <div className="ship-pr-banner-body" style={{ color: 'var(--text)' }}>
          ⟳ Removing worktree + deleting branch…
        </div>
      )}
      {wrapUpStatus === 'done' && (
        <div
          className="ship-pr-banner-body"
          style={{ color: 'rgb(178, 234, 188)' }}
        >
          ✓ All cleaned up. Switching back to the parent…
        </div>
      )}
      {wrapUpStatus === 'error' && (
        <div
          className="ship-pr-banner-body"
          style={{ color: 'rgb(242, 109, 122)' }}
        >
          {wrapUpError}
        </div>
      )}

      {wrapUpStatus !== 'done' && (
        <button
          type="button"
          className="primary"
          onClick={() => void wrapUpAfterMerge()}
          disabled={inFlight}
          style={{ marginTop: 8, alignSelf: 'flex-start' }}
        >
          {inFlight ? 'Wrapping up…' : 'Wrap up'}
        </button>
      )}
    </div>
  );
}
