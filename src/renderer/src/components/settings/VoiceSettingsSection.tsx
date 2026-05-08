/**
 * Settings tab: Voice agent (ElevenLabs Conversational AI).
 *
 * Two text inputs (API key, Agent ID) plus a Test-connection button so
 * the user can sanity-check before tapping the mic. Below that, a
 * collapsible Setup guide with the JSON for the client-side tool
 * definitions the user must paste into the ElevenLabs dashboard.
 *
 * The API key only ever leaves the machine via the main process to mint
 * a signed URL; the renderer never sees the raw key on the wire.
 */

import { useEffect, useState } from 'react';
import type { VoiceSettings } from '@shared/types';
import {
  VOICE_TOOLS,
  VOICE_TOOL_SCHEMAS,
  VOICE_SYSTEM_PROMPT,
} from '../../voice/toolSchemas';

export function VoiceSettingsSection() {
  const [settings, setSettings] = useState<VoiceSettings>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [status, setStatus] = useState<{
    kind: 'ok' | 'error' | 'info';
    text: string;
  } | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const s = await window.cowork.voice.get();
        setSettings(s);
      } catch (err) {
        setStatus({
          kind: 'error',
          text: err instanceof Error ? err.message : String(err),
        });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const update = (patch: Partial<VoiceSettings>) =>
    setSettings((s) => ({ ...s, ...patch }));

  const save = async () => {
    setSaving(true);
    setStatus(null);
    try {
      await window.cowork.voice.save(settings);
      setStatus({ kind: 'ok', text: 'Saved.' });
      setTimeout(() => setStatus(null), 1500);
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setSaving(false);
    }
  };

  const testConnection = async () => {
    if (!settings.agentId?.trim()) {
      setStatus({ kind: 'error', text: 'Paste an Agent ID first.' });
      return;
    }
    setTesting(true);
    setStatus({ kind: 'info', text: 'Asking ElevenLabs to mint a token…' });
    try {
      // Save first so the main process picks up whatever the user typed.
      await window.cowork.voice.save(settings);
      const creds = await window.cowork.voice.getStartCreds();
      if (!creds.ok) {
        setStatus({ kind: 'error', text: creds.error });
      } else if ('signedUrl' in creds) {
        setStatus({
          kind: 'ok',
          text: 'Connection OK. Signed URL minted (private agent).',
        });
      } else {
        setStatus({
          kind: 'ok',
          text: 'Connection OK (public agent — no API key needed).',
        });
      }
    } catch (err) {
      setStatus({
        kind: 'error',
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="settings-pane">
      <div className="settings-pane-header">
        <h2>Voice</h2>
        <p className="settings-pane-sub">
          Talk to a voice agent that can drive INZONE — switch sessions,
          message agents, spawn new sessions, etc. Powered by{' '}
          <a
            href="https://elevenlabs.io/app/conversational-ai"
            target="_blank"
            rel="noreferrer"
          >
            ElevenLabs Conversational AI
          </a>
          . API key + Agent ID stay on your machine.
        </p>
      </div>

      <div className="settings-pane-body">
        {loading ? (
          <div className="settings-empty">Loading voice settings…</div>
        ) : (
          <>
            {/* Quick path for users who'd rather follow a guided
                three-slide wizard than scroll the full reference
                below. The wizard ultimately writes to the same
                fields shown on this page. */}
            <button
              type="button"
              className="primary voice-wizard-launcher"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('inzone:open-voice-wizard'),
                )
              }
            >
              ✨ Open guided setup wizard
            </button>

            <div className="voice-critical-warning">
              <div className="voice-critical-warning-title">
                ⚠ Critical: enable &ldquo;Wait for response&rdquo; on every tool
              </div>
              <div className="voice-critical-warning-body">
                In the ElevenLabs dashboard&rsquo;s <em>Add client tool</em>{' '}
                form, the <strong>&ldquo;Wait for response&rdquo;</strong>{' '}
                checkbox defaults to <strong>off</strong>. While it&rsquo;s
                off, the agent never sees what INZONE&rsquo;s tools return —
                no error messages, no fuzzy-match candidates, no
                suggestions. The agent will appear to succeed at everything
                and lie to you about what it did.
                <br />
                <strong>
                  Open every one of the {VOICE_TOOLS.length} tools below and
                  tick &ldquo;Wait for response&rdquo;.
                </strong>{' '}
                Then save the agent.
              </div>
            </div>

            {/* Troubleshooting block — addresses the most common
                "voice said it did but nothing happened" failure modes
                in plain language. Lives above the setup guide so
                users hit it before scrolling into the per-tool cards. */}
            <details className="voice-troubleshoot">
              <summary>
                🩺 Voice claims success but nothing happens? Read this.
              </summary>
              <div className="voice-troubleshoot-body">
                <p>
                  The most common cause is the dashboard agent not knowing
                  about INZONE&rsquo;s tools. Symptoms — voice says
                  &ldquo;[done] Added the agent&rdquo; / &ldquo;Created the
                  pane&rdquo; but the UI hasn&rsquo;t changed.
                </p>
                <ol>
                  <li>
                    <strong>
                      Wait for response is off on at least one tool.
                    </strong>{' '}
                    The most frequent cause. Open every tool below in the
                    ElevenLabs dashboard and confirm the checkbox is ticked.
                  </li>
                  <li>
                    <strong>A tool isn&rsquo;t registered.</strong> If the
                    voice agent calls <code>add_pane_to_session</code> but
                    you&rsquo;ve only registered <code>list_agents</code> in
                    the dashboard, the call fails silently. Verify all{' '}
                    {VOICE_TOOLS.length} tools below appear in your
                    agent&rsquo;s Tools list.
                  </li>
                  <li>
                    <strong>
                      The system prompt is missing or out-of-date.
                    </strong>{' '}
                    The prompt below tells the LLM how to read tool
                    responses. Without it (or with a stale version that
                    doesn&rsquo;t mention <code>agent_must_say</code> or
                    fuzzy-match retries), the agent will narrate fictional
                    successes. Re-paste the prompt below into the
                    dashboard&rsquo;s <em>System prompt</em> field whenever
                    you upgrade INZONE.
                  </li>
                  <li>
                    <strong>
                      The tool was called but the action failed silently.
                    </strong>{' '}
                    Open the Voice section in the sidebar — it logs every
                    tool call with its result. If you see a call with{' '}
                    <code>&quot;ok&quot;: false</code> but the voice agent
                    still said &ldquo;done&rdquo;, the LLM ignored the
                    result. Switch the agent&rsquo;s LLM to GPT-4o or Claude
                    Sonnet — weaker models hallucinate success.
                  </li>
                  <li>
                    <strong>The microphone is muted.</strong> If voice can
                    hear you but the LLM is still answering from training
                    data instead of calling tools, the agent setup is
                    incomplete — re-run the wizard from the button above.
                  </li>
                </ol>
              </div>
            </details>

            <div className="settings-row">
              <div className="settings-row-head">
                <label htmlFor="voice-key">ElevenLabs API key</label>
                <code className="settings-env">xi-api-key</code>
              </div>
              <input
                id="voice-key"
                type="password"
                value={settings.apiKey ?? ''}
                onChange={(e) => update({ apiKey: e.target.value })}
                placeholder="xi-api-key…"
                spellCheck={false}
                autoComplete="off"
              />
              <div className="settings-hint">
                Required for private agents (recommended). Generate one at{' '}
                <a
                  href="https://elevenlabs.io/app/settings/api-keys"
                  target="_blank"
                  rel="noreferrer"
                >
                  elevenlabs.io/app/settings/api-keys
                </a>
                . Leave blank if your agent is public.
              </div>
            </div>

            <div className="settings-row">
              <div className="settings-row-head">
                <label htmlFor="voice-agent">Agent ID</label>
                <code className="settings-env">agent_…</code>
              </div>
              <input
                id="voice-agent"
                type="text"
                value={settings.agentId ?? ''}
                onChange={(e) => update({ agentId: e.target.value })}
                placeholder="agent_xxxxxxxxxxxxxx"
                spellCheck={false}
                autoComplete="off"
              />
              <div className="settings-hint">
                Find it under{' '}
                <a
                  href="https://elevenlabs.io/app/conversational-ai"
                  target="_blank"
                  rel="noreferrer"
                >
                  Conversational AI → Agents
                </a>{' '}
                after creating one (see Setup guide below).
              </div>
            </div>

            <details className="mcp-json voice-setup-guide" open>
              <summary>Setup guide — first time</summary>
              <ol className="voice-setup-steps">
                <li>
                  Sign in at{' '}
                  <a
                    href="https://elevenlabs.io/app/conversational-ai"
                    target="_blank"
                    rel="noreferrer"
                  >
                    elevenlabs.io/app/conversational-ai
                  </a>{' '}
                  and click <strong>+ Create Agent</strong>.
                </li>
                <li>
                  Pick a voice you like. For the LLM, Claude Sonnet or GPT-4o
                  both work well.
                </li>
                <li>
                  In the agent&rsquo;s <strong>System prompt</strong> field,
                  paste the prompt below.
                </li>
                <li>
                  Open <strong>Tools → Add tool → Client tool</strong> and
                  recreate each of the {VOICE_TOOLS.length} tools below. For
                  every tool: paste the <em>Name</em> and <em>Description</em>
                  {' '}exactly. For the <em>Parameters</em> section, click{' '}
                  <strong>Add param</strong> once per parameter — leave it
                  empty if a tool has <em>(no parameters)</em>.
                </li>
                <li>
                  Save the agent. Copy its ID from the URL or page header —
                  paste it into <em>Agent ID</em> above.
                </li>
                <li>
                  Click <strong>Test connection</strong> below. Once green,
                  close this drawer and tap the mic in the sidebar.
                </li>
              </ol>

              <div className="voice-setup-block">
                <div className="voice-setup-label">System prompt</div>
                <textarea
                  className="voice-setup-textarea"
                  readOnly
                  rows={10}
                  value={VOICE_SYSTEM_PROMPT}
                  onClick={(e) =>
                    (e.target as HTMLTextAreaElement).select()
                  }
                />
              </div>

              <div className="voice-setup-block">
                <div className="voice-setup-label">
                  Client tools ({VOICE_TOOLS.length})
                </div>
                <div className="voice-tool-cards">
                  {VOICE_TOOLS.map((tool) => (
                    <div className="voice-tool-card" key={tool.name}>
                      <div className="voice-tool-card-row">
                        <span className="voice-tool-card-key">Name</span>
                        <code className="voice-tool-card-value">
                          {tool.name}
                        </code>
                      </div>
                      <div className="voice-tool-card-row">
                        <span className="voice-tool-card-key">
                          ⚠ Wait for response
                        </span>
                        <span className="voice-tool-card-value voice-tool-checkbox-hint">
                          <strong>Tick this checkbox</strong> in the dashboard
                          form for this tool.
                        </span>
                      </div>
                      <div className="voice-tool-card-row">
                        <span className="voice-tool-card-key">Description</span>
                        <span className="voice-tool-card-value">
                          {tool.description}
                        </span>
                      </div>
                      <div className="voice-tool-card-row">
                        <span className="voice-tool-card-key">Parameters</span>
                        {tool.parameters.length === 0 ? (
                          <span className="voice-tool-card-value muted">
                            (no parameters — leave the Parameters section empty)
                          </span>
                        ) : (
                          <div className="voice-tool-params">
                            {tool.parameters.map((p) => (
                              <div className="voice-tool-param" key={p.identifier}>
                                <code className="voice-tool-param-id">
                                  {p.identifier}
                                </code>
                                <span className="voice-tool-param-type">
                                  {p.type}
                                  {p.enum
                                    ? ` (${p.enum.join(' | ')})`
                                    : ''}
                                </span>
                                <span
                                  className={
                                    'voice-tool-param-req' +
                                    (p.required ? ' required' : '')
                                  }
                                >
                                  {p.required ? 'required' : 'optional'}
                                </span>
                                <span className="voice-tool-param-desc">
                                  {p.description}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="settings-hint">
                  In the dashboard&rsquo;s <em>Add client tool</em> form, the
                  parameter block asks for <strong>Data type</strong> (matches
                  the type column above), <strong>Identifier</strong> (the
                  name in the code-style column), <strong>Required</strong>{' '}
                  (the badge), and <strong>Description</strong>. For string
                  enum parameters (like <code>mode</code>), use the{' '}
                  <em>Enum</em> section ElevenLabs offers under string params.
                </div>
              </div>

              <details className="voice-bulk-json">
                <summary>Show as raw JSON (power users / API)</summary>
                <textarea
                  className="voice-setup-textarea"
                  readOnly
                  rows={14}
                  value={JSON.stringify(VOICE_TOOL_SCHEMAS, null, 2)}
                  onClick={(e) =>
                    (e.target as HTMLTextAreaElement).select()
                  }
                />
                <div className="settings-hint">
                  This is the same data formatted as JSON Schema — useful if
                  you&rsquo;re configuring the agent via the ElevenLabs API
                  rather than the dashboard. The dashboard&rsquo;s form does
                  not accept this directly.
                </div>
              </details>
            </details>
          </>
        )}
      </div>

      <div className="settings-pane-footer">
        {status && (
          <div className={`voice-status voice-status-${status.kind}`}>
            {status.text}
          </div>
        )}
        <div className="spacer" />
        <button
          className="ghost"
          onClick={() => void testConnection()}
          disabled={testing || saving}
        >
          {testing ? 'Testing…' : 'Test connection'}
        </button>
        <button
          className="primary"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
