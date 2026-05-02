import { useEffect, useState } from 'react';
import { useStore } from '../../store';
import { fmt } from '../UsageModal';
import type { ClaudeAuthInfo } from '@shared/types';

/**
 * Settings → Profile.
 *
 * Surfaces a per-provider account / auth panel. Today only the
 * Claude card is live: it shows whether the SDK is authenticating
 * via API key or `claude login` subscription, plus email / plan
 * details when the Claude Code CLI is installed and we can probe
 * `claude auth status`.
 *
 * OpenAI and Gemini cards are stubbed as "Coming soon" placeholders
 * — they're visually present so the future shape of multi-provider
 * support is visible, but they have no functionality yet because
 * neither vendor offers an equivalent of Anthropic's official
 * subscription-as-SDK auth path.
 */
export function ProfileSection() {
  const usage = useStore((s) => s.usage);
  const refreshUsage = useStore((s) => s.refreshUsage);
  const [claudeAuth, setClaudeAuth] = useState<ClaudeAuthInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void refreshUsage();
    let cancelled = false;
    setLoading(true);
    void window.cowork.profile
      .claudeAuth()
      .then((info) => {
        if (!cancelled) setClaudeAuth(info);
      })
      .catch(() => {
        if (!cancelled)
          setClaudeAuth({ method: 'unknown', cliInstalled: false });
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [refreshUsage]);

  return (
    <div className="settings-pane">
      <div className="settings-pane-header">
        <h2>Profile</h2>
        <p className="settings-pane-sub">
          The accounts INZONE uses to run agents.
        </p>
      </div>

      <div className="settings-pane-body">
        <div className="profile-cards">
          <ClaudeCard auth={claudeAuth} loading={loading} usage={usage} />
        </div>
        <button
          type="button"
          className="profile-welcome-replay"
          onClick={() => {
            // Clear the seen-flag so the modal pops on next launch too,
            // and dispatch the show-event to open it right now.
            try {
              localStorage.removeItem('inzone.welcome.seen');
            } catch {
              // ignore
            }
            window.dispatchEvent(new CustomEvent('inzone:show-welcome'));
          }}
        >
          Show welcome screen again
        </button>
      </div>
    </div>
  );
}

interface ClaudeCardProps {
  auth: ClaudeAuthInfo | null;
  loading: boolean;
  usage: ReturnType<typeof useStore.getState>['usage'];
}

function ClaudeCard({ auth, loading, usage }: ClaudeCardProps) {
  const method = auth?.method ?? 'unknown';
  const isApiKey = method === 'api-key';
  const isSubscription = method === 'subscription';
  const isUnauthed = method === 'none';

  return (
    <div className="profile-card profile-card-claude">
      <div className="profile-card-head">
        <div className="profile-card-logo" aria-hidden>
          {/* Anthropic A — keep simple, mono-color so it picks up
              the card's accent treatment. */}
          <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
            <path d="M9.5 4 L4 20 h3.2 l1.2-3.6 h6.2 L15.8 20 H19 L13.5 4 Z M9.6 13.4 L11.5 7.6 h.05 l1.85 5.8 Z" />
          </svg>
        </div>
        <div className="profile-card-title">
          <strong>Claude</strong>
          <span className="profile-card-status">
            {loading
              ? 'Checking...'
              : isApiKey
                ? 'API key'
                : isSubscription
                  ? 'Subscription'
                  : isUnauthed
                    ? 'Not signed in'
                    : 'Unknown'}
          </span>
        </div>
        <span
          className={
            'profile-card-pill ' +
            (isApiKey || isSubscription
              ? 'profile-card-pill-ok'
              : isUnauthed
                ? 'profile-card-pill-err'
                : 'profile-card-pill-pending')
          }
        >
          {loading
            ? '·'
            : isApiKey || isSubscription
              ? '✓ Active'
              : isUnauthed
                ? 'Inactive'
                : '?'}
        </span>
      </div>

      <div className="profile-card-body">
        {loading && (
          <div className="profile-card-row profile-card-row-muted">
            Detecting auth...
          </div>
        )}

        {!loading && isApiKey && (
          <>
            <Row
              label="Auth method"
              value="API key (ANTHROPIC_API_KEY env var)"
            />
            <div className="profile-card-row profile-card-row-muted">
              Usage is billed against the Anthropic Console workspace
              that owns the key. Pay-per-token; no subscription quota
              applies.
            </div>
          </>
        )}

        {!loading && isSubscription && (
          <>
            <Row label="Auth method" value="Subscription (claude login)" />
            {auth?.email && <Row label="Account" value={auth.email} mono />}
            {auth?.plan && <Row label="Plan" value={auth.plan} />}
            {!auth?.cliInstalled && (
              <div className="profile-card-row profile-card-row-muted">
                Tip: install the Claude Code CLI (
                <code>brew install claude</code> or via{' '}
                <a
                  href="https://docs.claude.com/claude-code"
                  target="_blank"
                  rel="noreferrer"
                >
                  the official installer
                </a>
                ) to surface your account email + plan tier here.
              </div>
            )}
          </>
        )}

        {!loading && isUnauthed && (
          <>
            <div className="profile-card-row profile-card-row-warn">
              Not signed in to Claude. Run{' '}
              <code>claude login</code> in a terminal — INZONE picks
              up the credentials automatically the next time it spins
              up an agent.
            </div>
          </>
        )}

        {!loading && method === 'unknown' && (
          <div className="profile-card-row profile-card-row-muted">
            Couldn't detect Claude auth state. The agents will still
            try to run — if they fail, run{' '}
            <code>claude auth status</code> in a terminal to see the
            real error.
          </div>
        )}

        <div className="profile-card-divider" />

        <ApiKeyForm />

        <div className="profile-card-divider" />

        {/* Usage — pulled from our cost ledger, same numbers as the
            workspace bar's $X today pill + the Usage tab. Lets the
            user see their plan's burn rate at a glance. */}
        <div className="profile-card-usage">
          <UsageTile label="Today" value={fmt(usage?.todayCostUsd ?? 0)} />
          <UsageTile
            label="Last 7 days"
            value={fmt(usage?.last7DaysCostUsd ?? 0)}
          />
          <UsageTile
            label="Lifetime"
            value={fmt(usage?.totalCostUsd ?? 0)}
          />
        </div>
      </div>
    </div>
  );
}

/**
 * Paste-an-API-key control. Lives inside ClaudeCard so users who
 * don't want to install the `claude` CLI have a one-click path to
 * authenticate. Keys are encrypted with safeStorage in main and
 * never round-trip back to the renderer — we only get a "stored?"
 * flag and the result of test calls.
 */
function ApiKeyForm() {
  const [status, setStatus] = useState<{
    hasStoredKey: boolean;
    envSet: boolean;
    source: 'env-external' | 'stored' | 'env-from-stored' | 'none';
  } | null>(null);
  const [draft, setDraft] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'test' | 'save' | 'clear'>(
    'idle',
  );
  const [feedback, setFeedback] = useState<{
    kind: 'ok' | 'err' | 'info';
    text: string;
  } | null>(null);

  const refreshStatus = async () => {
    try {
      const s = await window.cowork.profile.apiKeyStatus();
      setStatus(s);
    } catch {
      setStatus({
        hasStoredKey: false,
        envSet: false,
        source: 'none',
      });
    }
  };

  useEffect(() => {
    void refreshStatus();
  }, []);

  const handleTest = async () => {
    if (!draft.trim()) return;
    setBusy('test');
    setFeedback(null);
    try {
      const r = await window.cowork.profile.apiKeyTest({ key: draft });
      if (r.ok) {
        setFeedback({ kind: 'ok', text: 'Key works ✓' });
      } else {
        setFeedback({
          kind: 'err',
          text: r.error
            ? `Failed: ${r.error}`
            : `Failed (HTTP ${r.status ?? '?'})`,
        });
      }
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy('idle');
    }
  };

  const handleSave = async () => {
    if (!draft.trim()) return;
    setBusy('save');
    setFeedback(null);
    try {
      // Test first so we don't store a bad key. The user can dismiss
      // and try again if it fails.
      const r = await window.cowork.profile.apiKeyTest({ key: draft });
      if (!r.ok) {
        setFeedback({
          kind: 'err',
          text: r.error
            ? `Won't save: ${r.error}`
            : `Won't save (HTTP ${r.status ?? '?'})`,
        });
        return;
      }
      await window.cowork.profile.apiKeySave({ key: draft });
      setDraft('');
      setReveal(false);
      setFeedback({
        kind: 'ok',
        text: 'Saved. New sessions will use this key.',
      });
      await refreshStatus();
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy('idle');
    }
  };

  const handleClear = async () => {
    if (
      !confirm(
        'Remove the stored Anthropic API key? New sessions will fall back to your subscription credentials (claude login) if available.',
      )
    ) {
      return;
    }
    setBusy('clear');
    setFeedback(null);
    try {
      await window.cowork.profile.apiKeyClear();
      setFeedback({
        kind: 'info',
        text: 'Cleared.',
      });
      await refreshStatus();
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy('idle');
    }
  };

  const externalEnv = status?.source === 'env-external';
  const stored = status?.hasStoredKey === true;

  return (
    <div className="profile-card-row profile-card-row-stack">
      <div className="profile-apikey-head">
        <span className="profile-card-row-label">Anthropic API key</span>
        <a
          className="profile-apikey-link"
          href="https://console.anthropic.com/settings/keys"
          target="_blank"
          rel="noreferrer"
        >
          Get a key →
        </a>
      </div>
      {externalEnv && (
        <div className="profile-apikey-note">
          ANTHROPIC_API_KEY is set in your shell environment — that
          takes precedence and INZONE will use it. Pasting a key
          here does nothing while the env var is set.
        </div>
      )}
      {!externalEnv && stored && (
        <div className="profile-apikey-note profile-apikey-note-ok">
          A key is stored and active. Replace it below or clear it.
        </div>
      )}
      {!externalEnv && !stored && (
        <div className="profile-apikey-note">
          Optional. Paste a key from console.anthropic.com if you'd
          rather not use the <code>claude login</code> CLI flow.
        </div>
      )}
      <div className="profile-apikey-row">
        <input
          type={reveal ? 'text' : 'password'}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="sk-ant-…"
          spellCheck={false}
          autoComplete="off"
          className="profile-apikey-input"
          disabled={busy !== 'idle'}
        />
        <button
          type="button"
          className="profile-apikey-reveal"
          onClick={() => setReveal((v) => !v)}
          title={reveal ? 'Hide' : 'Show'}
          aria-label={reveal ? 'Hide key' : 'Show key'}
          disabled={busy !== 'idle' || draft.length === 0}
        >
          {reveal ? '🙈' : '👁'}
        </button>
      </div>
      <div className="profile-apikey-actions">
        <button
          type="button"
          className="ghost"
          onClick={handleTest}
          disabled={busy !== 'idle' || !draft.trim()}
        >
          {busy === 'test' ? 'Testing…' : 'Test'}
        </button>
        <button
          type="button"
          className="primary"
          onClick={handleSave}
          disabled={busy !== 'idle' || !draft.trim()}
        >
          {busy === 'save' ? 'Saving…' : 'Save key'}
        </button>
        {stored && (
          <button
            type="button"
            className="ghost danger"
            onClick={handleClear}
            disabled={busy !== 'idle'}
          >
            {busy === 'clear' ? 'Clearing…' : 'Clear stored key'}
          </button>
        )}
      </div>
      {feedback && (
        <div
          className={
            'profile-apikey-feedback profile-apikey-feedback-' + feedback.kind
          }
        >
          {feedback.text}
        </div>
      )}
    </div>
  );
}


function Row({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="profile-card-row">
      <span className="profile-card-row-label">{label}</span>
      <span
        className={
          'profile-card-row-value' + (mono ? ' profile-card-row-mono' : '')
        }
      >
        {value}
      </span>
    </div>
  );
}

function UsageTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="profile-usage-tile">
      <div className="profile-usage-tile-label">{label}</div>
      <div className="profile-usage-tile-value">{value}</div>
    </div>
  );
}
