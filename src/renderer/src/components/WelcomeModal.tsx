/**
 * First-run welcome modal.
 *
 * Shown automatically on first launch (gated by a localStorage flag
 * so it doesn't reappear). Walks the user through three steps —
 * sign in to Claude, pick a project folder, optionally set up
 * Voice — without forcing them through anything.
 *
 * Each step:
 *  - Detects "already done" via existing state (active Claude auth,
 *    cwd is set, voice config exists) so people who set things up
 *    out-of-band see check marks instead of CTAs
 *  - Has a primary button that takes them to the right pane
 *  - Voice is marked optional; the modal closes regardless of
 *    whether it's been completed
 *
 * Dismiss: any close action sets the localStorage flag. Users can
 * re-open from Settings → Profile (a small link there triggers the
 * `inzone:show-welcome` event).
 */

import { useEffect, useState } from 'react';
import { useStore } from '../store';
import { AppLogo } from './AppLogo';

const SEEN_FLAG = 'inzone.welcome.seen';

interface AuthStatus {
  hasAnyAuth: boolean;
}

export function WelcomeModal() {
  const cwd = useStore((s) => s.cwd);
  const pickFolder = useStore((s) => s.pickFolder);
  const [open, setOpen] = useState(false);
  const [auth, setAuth] = useState<AuthStatus | null>(null);
  const [voiceConfigured, setVoiceConfigured] = useState<boolean | null>(null);

  // First-run gate: open if we've never been dismissed before.
  // Also subscribe to a global event so a "Show welcome" link
  // elsewhere in Settings can reopen us on demand.
  useEffect(() => {
    try {
      if (localStorage.getItem(SEEN_FLAG) !== '1') setOpen(true);
    } catch {
      // localStorage might be denied — safer to skip welcome than
      // pop it on every launch in that environment.
    }
    const onOpen = () => setOpen(true);
    window.addEventListener('inzone:show-welcome', onOpen);
    return () => window.removeEventListener('inzone:show-welcome', onOpen);
  }, []);

  // Probe auth + voice on every open so the check marks reflect
  // whatever the user did between launches.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void (async () => {
      try {
        const [authInfo, keyStatus] = await Promise.all([
          window.cowork.profile.claudeAuth(),
          window.cowork.profile.apiKeyStatus(),
        ]);
        if (cancelled) return;
        const active =
          authInfo.method === 'api-key' ||
          authInfo.method === 'subscription' ||
          keyStatus.envSet;
        setAuth({ hasAnyAuth: active });
      } catch {
        if (!cancelled) setAuth({ hasAnyAuth: false });
      }
      try {
        const v = await window.cowork.voice.get();
        if (!cancelled) {
          setVoiceConfigured(
            !!(v?.apiKey && v.apiKey.trim().length > 0 && v.agentId),
          );
        }
      } catch {
        if (!cancelled) setVoiceConfigured(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  if (!open) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(SEEN_FLAG, '1');
    } catch {
      // ignore — at worst the modal reappears on next launch
    }
    setOpen(false);
  };

  const openSettings = (section: 'profile' | 'voice') => {
    window.dispatchEvent(
      new CustomEvent<'profile' | 'voice'>('inzone:open-settings', {
        detail: section,
      }),
    );
  };

  const claudeDone = auth?.hasAnyAuth === true;
  const folderDone = !!cwd;
  const voiceDone = voiceConfigured === true;
  const allRequiredDone = claudeDone && folderDone;

  return (
    <div
      className="welcome-root"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) dismiss();
      }}
    >
      <div className="welcome-card" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="welcome-close"
          onClick={dismiss}
          aria-label="Close"
        >
          ✕
        </button>
        <div className="welcome-hero">
          <div className="welcome-logo" aria-hidden>
            <AppLogo size={56} />
          </div>
          <div>
            <h2 className="welcome-title">Welcome to INZONE</h2>
            <p className="welcome-sub">
              A cockpit for running multiple Claude agents side-by-side.
              Three quick steps and you're set up.
            </p>
          </div>
        </div>

        <ol className="welcome-steps">
          <Step
            n={1}
            title="Sign in to Claude"
            done={claudeDone}
            pending={auth === null}
            description={
              claudeDone
                ? 'Authentication is active. You can run agents now.'
                : 'Paste your Anthropic API key, or run `claude login` in a terminal — INZONE picks up the credentials automatically.'
            }
            cta={
              claudeDone ? null : (
                <button
                  type="button"
                  className="primary"
                  onClick={() => openSettings('profile')}
                >
                  Open Profile
                </button>
              )
            }
          />
          <Step
            n={2}
            title="Pick a project folder"
            done={folderDone}
            description={
              folderDone
                ? 'Project folder set. You can split panes and assign agents.'
                : 'A project folder is the working directory each agent shares — usually a git repo.'
            }
            cta={
              folderDone ? null : (
                <button
                  type="button"
                  className="primary"
                  onClick={async () => {
                    await pickFolder();
                  }}
                >
                  Choose folder…
                </button>
              )
            }
          />
          <Step
            n={3}
            title="Set up Voice"
            optional
            done={voiceDone}
            description={
              voiceDone
                ? 'Voice agent is configured. Look for the orb in the sidebar.'
                : 'Optional. Drive INZONE by voice via your own ElevenLabs account.'
            }
            cta={
              voiceDone ? null : (
                <button
                  type="button"
                  className="ghost"
                  onClick={() => {
                    // Dispatch the wizard event instead of opening
                    // Settings → Voice — the wizard is a guided
                    // first-run path; the settings page is for
                    // edits. Closing the welcome modal first so the
                    // wizard isn't stacked on top of two overlays.
                    dismiss();
                    setTimeout(() => {
                      window.dispatchEvent(
                        new CustomEvent('inzone:open-voice-wizard'),
                      );
                    }, 50);
                  }}
                >
                  Configure Voice
                </button>
              )
            }
          />
        </ol>

        <div className="welcome-footer">
          <span className="welcome-progress">
            {allRequiredDone
              ? 'All set — happy building.'
              : 'You can re-open this from Settings → Profile.'}
          </span>
          <button type="button" className="primary" onClick={dismiss}>
            {allRequiredDone ? 'Get started' : 'Got it'}
          </button>
        </div>
      </div>
    </div>
  );
}

interface StepProps {
  n: number;
  title: string;
  description: string;
  done: boolean;
  pending?: boolean;
  optional?: boolean;
  cta: React.ReactNode;
}
function Step({
  n,
  title,
  description,
  done,
  pending,
  optional,
  cta,
}: StepProps) {
  const status: 'done' | 'pending' | 'todo' = done
    ? 'done'
    : pending
      ? 'pending'
      : 'todo';
  return (
    <li className={'welcome-step welcome-step-' + status}>
      <div className="welcome-step-marker" aria-hidden>
        {status === 'done' ? '✓' : status === 'pending' ? '·' : n}
      </div>
      <div className="welcome-step-body">
        <div className="welcome-step-title">
          {title}
          {optional && (
            <span className="welcome-step-optional">optional</span>
          )}
        </div>
        <div className="welcome-step-desc">{description}</div>
      </div>
      <div className="welcome-step-action">{cta}</div>
    </li>
  );
}
