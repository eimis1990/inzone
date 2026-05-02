/**
 * Voice setup wizard — three-slide modal that walks a fresh user
 * through configuring the ElevenLabs Conversational AI agent that
 * powers INZONE's voice control.
 *
 * Slides:
 *  1. Intro: what Voice is, what it costs (you bring your own
 *     ElevenLabs account), the "Wait for response" warning, and
 *     a Cancel / Continue.
 *  2. Configure agent: copy the system prompt, see the tool list,
 *     open ElevenLabs in the browser, then come back.
 *  3. Paste credentials: API key + Agent ID inputs, Test, Finish.
 *
 * Triggered via the `inzone:open-voice-wizard` custom event (fired
 * from the welcome modal's Voice CTA, the Settings → Voice header,
 * or anywhere else). Once finished, dispatches a "saved" toast and
 * leaves the user on whatever screen they were on.
 *
 * The existing Voice settings page stays as the power-user editor;
 * this wizard is the human-friendly first-run path.
 */

import { useEffect, useState } from 'react';
import {
  VOICE_SYSTEM_PROMPT,
  VOICE_TOOLS,
} from '../voice/toolSchemas';
import { AppLogo } from './AppLogo';

type Slide = 1 | 2 | 3;

export function VoiceSetupWizard() {
  const [open, setOpen] = useState(false);
  const [slide, setSlide] = useState<Slide>(1);
  const [apiKey, setApiKey] = useState('');
  const [agentId, setAgentId] = useState('');
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState<'idle' | 'test' | 'save'>('idle');
  const [feedback, setFeedback] = useState<{
    kind: 'ok' | 'err' | 'info';
    text: string;
  } | null>(null);
  const [promptCopied, setPromptCopied] = useState(false);

  // Open via global event; reset slide + load any existing values.
  useEffect(() => {
    const onOpen = () => {
      setOpen(true);
      setSlide(1);
      setFeedback(null);
      // Pre-fill from saved settings so a returning user can edit
      // instead of starting from scratch.
      void window.cowork.voice
        .get()
        .then((s) => {
          if (s.apiKey) setApiKey(s.apiKey);
          if (s.agentId) setAgentId(s.agentId);
        })
        .catch(() => {
          // Fresh install — leave fields empty.
        });
    };
    window.addEventListener('inzone:open-voice-wizard', onOpen);
    return () =>
      window.removeEventListener('inzone:open-voice-wizard', onOpen);
  }, []);

  // Esc closes from any slide.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const close = () => {
    setOpen(false);
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(VOICE_SYSTEM_PROMPT);
      setPromptCopied(true);
      setTimeout(() => setPromptCopied(false), 1500);
    } catch {
      // clipboard may be denied — show a fallback selection
      // hint in the textarea instead.
    }
  };

  const openElevenLabs = () => {
    window.open(
      'https://elevenlabs.io/app/conversational-ai',
      '_blank',
      'noopener,noreferrer',
    );
  };

  const test = async () => {
    if (!agentId.trim()) {
      setFeedback({ kind: 'err', text: 'Paste an Agent ID first.' });
      return;
    }
    setBusy('test');
    setFeedback({ kind: 'info', text: 'Asking ElevenLabs to mint a token…' });
    try {
      // Save first so main process picks up whatever is typed.
      await window.cowork.voice.save({ apiKey, agentId });
      const creds = await window.cowork.voice.getStartCreds();
      if (!creds.ok) {
        setFeedback({ kind: 'err', text: creds.error });
      } else if ('signedUrl' in creds) {
        setFeedback({
          kind: 'ok',
          text: 'Connection OK. Signed URL minted (private agent).',
        });
      } else {
        setFeedback({
          kind: 'ok',
          text: 'Connection OK (public agent — no API key needed).',
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

  const finish = async () => {
    setBusy('save');
    setFeedback(null);
    try {
      await window.cowork.voice.save({ apiKey, agentId });
      setFeedback({ kind: 'ok', text: 'Saved. Voice is ready to use.' });
      // Brief pause so the user sees the confirmation, then close.
      setTimeout(() => {
        setOpen(false);
      }, 900);
    } catch (err) {
      setFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy('idle');
    }
  };

  return (
    <div
      className="vwiz-root"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) close();
      }}
    >
      <div className="vwiz-card" onMouseDown={(e) => e.stopPropagation()}>
        <button
          type="button"
          className="vwiz-close"
          onClick={close}
          aria-label="Close"
        >
          ✕
        </button>

        <div className="vwiz-progress">
          <span className={'vwiz-dot' + (slide >= 1 ? ' done' : '')} />
          <span className={'vwiz-dot' + (slide >= 2 ? ' done' : '')} />
          <span className={'vwiz-dot' + (slide >= 3 ? ' done' : '')} />
        </div>

        {slide === 1 && (
          <>
            <div className="vwiz-hero">
              <div className="vwiz-logo" aria-hidden>
                <AppLogo size={48} />
              </div>
              <div>
                <h2>Set up Voice</h2>
                <p>
                  Drive INZONE by voice — switch projects, message
                  agents, spawn new ones. Powered by your own
                  ElevenLabs Conversational AI account, so cost and
                  rate-limits sit on your billing, not ours.
                </p>
              </div>
            </div>
            <div className="vwiz-warn">
              <strong>One thing that bites everyone</strong>: when
              you create the tools in ElevenLabs, every tool needs
              its <em>"Wait for response"</em> checkbox ticked. The
              checkbox is off by default and a missed one breaks the
              whole thing silently. The wizard reminds you on
              Slide 2.
            </div>
            <div className="vwiz-bullets">
              <div className="vwiz-bullet">
                <span className="vwiz-bullet-num">1</span>
                <span>Create an ElevenLabs Conversational AI agent.</span>
              </div>
              <div className="vwiz-bullet">
                <span className="vwiz-bullet-num">2</span>
                <span>
                  Paste our system prompt + add the {VOICE_TOOLS.length}{' '}
                  client tools.
                </span>
              </div>
              <div className="vwiz-bullet">
                <span className="vwiz-bullet-num">3</span>
                <span>
                  Drop your API key + Agent ID back here and test.
                </span>
              </div>
            </div>
            <div className="vwiz-actions">
              <button
                type="button"
                className="ghost"
                onClick={close}
              >
                Skip for now
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => setSlide(2)}
              >
                Get started
              </button>
            </div>
          </>
        )}

        {slide === 2 && (
          <>
            <h2 className="vwiz-step-title">Configure your agent</h2>
            <p className="vwiz-step-sub">
              Open ElevenLabs, create an agent, paste this prompt
              into its System Prompt field, and add each tool below.
              Tick <strong>Wait for response</strong> on every tool.
            </p>
            <div className="vwiz-prompt-block">
              <div className="vwiz-prompt-head">
                <span>System prompt</span>
                <button
                  type="button"
                  className="ghost vwiz-copy"
                  onClick={copyPrompt}
                >
                  {promptCopied ? '✓ Copied' : 'Copy'}
                </button>
              </div>
              <textarea
                className="vwiz-prompt-text"
                readOnly
                rows={6}
                value={VOICE_SYSTEM_PROMPT}
                onClick={(e) =>
                  (e.target as HTMLTextAreaElement).select()
                }
              />
            </div>
            <div className="vwiz-tool-list">
              <div className="vwiz-tool-list-head">
                Add these {VOICE_TOOLS.length} client tools (the
                full description for each lives in Settings → Voice
                if you need them later):
              </div>
              <ul className="vwiz-tool-names">
                {VOICE_TOOLS.map((t) => (
                  <li key={t.name}>
                    <code>{t.name}</code>
                  </li>
                ))}
              </ul>
            </div>
            <div className="vwiz-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setSlide(1)}
              >
                ← Back
              </button>
              <button
                type="button"
                className="ghost"
                onClick={openElevenLabs}
              >
                Open ElevenLabs ↗
              </button>
              <button
                type="button"
                className="primary"
                onClick={() => setSlide(3)}
              >
                I've created my agent →
              </button>
            </div>
          </>
        )}

        {slide === 3 && (
          <>
            <h2 className="vwiz-step-title">Paste your credentials</h2>
            <p className="vwiz-step-sub">
              From the ElevenLabs dashboard. Both stay on your
              machine — encrypted via your OS keychain.
            </p>
            <div className="vwiz-field">
              <label htmlFor="vwiz-key">ElevenLabs API key</label>
              <div className="vwiz-input-row">
                <input
                  id="vwiz-key"
                  type={reveal ? 'text' : 'password'}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="xi-api-key…"
                  spellCheck={false}
                  autoComplete="off"
                  className="vwiz-input"
                  disabled={busy !== 'idle'}
                />
                <button
                  type="button"
                  className="vwiz-reveal"
                  onClick={() => setReveal((v) => !v)}
                  title={reveal ? 'Hide' : 'Show'}
                  aria-label={reveal ? 'Hide key' : 'Show key'}
                >
                  {reveal ? '🙈' : '👁'}
                </button>
              </div>
              <div className="vwiz-hint">
                Required for private agents. Get one from{' '}
                <a
                  href="https://elevenlabs.io/app/settings/api-keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  Settings → API keys
                </a>
                .
              </div>
            </div>
            <div className="vwiz-field">
              <label htmlFor="vwiz-agent">Agent ID</label>
              <input
                id="vwiz-agent"
                type="text"
                value={agentId}
                onChange={(e) => setAgentId(e.target.value)}
                placeholder="agent_xxxxxxxxxxxxxx"
                spellCheck={false}
                autoComplete="off"
                className="vwiz-input"
                disabled={busy !== 'idle'}
              />
              <div className="vwiz-hint">
                Found in the agent's URL or page header on
                ElevenLabs.
              </div>
            </div>
            {feedback && (
              <div
                className={'vwiz-feedback vwiz-feedback-' + feedback.kind}
              >
                {feedback.text}
              </div>
            )}
            <div className="vwiz-actions">
              <button
                type="button"
                className="ghost"
                onClick={() => setSlide(2)}
                disabled={busy !== 'idle'}
              >
                ← Back
              </button>
              <button
                type="button"
                className="ghost"
                onClick={test}
                disabled={busy !== 'idle' || !agentId.trim()}
              >
                {busy === 'test' ? 'Testing…' : 'Test'}
              </button>
              <button
                type="button"
                className="primary"
                onClick={finish}
                disabled={busy !== 'idle' || !agentId.trim()}
              >
                {busy === 'save' ? 'Saving…' : 'Save & finish'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
