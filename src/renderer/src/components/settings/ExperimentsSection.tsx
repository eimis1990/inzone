/**
 * Settings → Experiments.
 *
 * Home for opt-in features that aren't part of the default Inzone
 * experience. Today: Caveman mode, the token-compression directive
 * derived from juliusbrussee/caveman that prepends a per-intensity
 * instruction block to every agent's system prompt at session start.
 *
 * Persistence + sync:
 *  - Reads / writes through `window.cowork.caveman` which talks to a
 *    dedicated electron-store JSON in the user's app-data dir
 *    (independent of the main app state so it survives a wipe).
 *  - Writes broadcast `caveman:changed` to every BrowserWindow, so
 *    toggling the switch in one INZONE window updates the UI in
 *    another window without a reload.
 *  - The effect on running agents lands on the *next* session start;
 *    the SDK doesn't refresh system prompts on in-flight turns, so
 *    we don't try to fake that here. Active sessions keep their
 *    current compression behaviour until the user clears the pane
 *    or restarts.
 *
 * Future occupants of this tab: anything else that lives in the
 * "you have to opt in" bucket — model experiments, layout previews,
 * unproven workflow tools.
 */

import { useEffect, useState } from 'react';
import type { CavemanLevel, CavemanSettings } from '@shared/types';

const LEVELS: Array<{ value: CavemanLevel; label: string; hint: string }> = [
  {
    value: 'lite',
    label: 'Lite',
    hint: 'Drops pleasantries + worst filler. Keeps full sentences. Easiest to read.',
  },
  {
    value: 'full',
    label: 'Full (canonical caveman)',
    hint: 'Fragments, dropped articles, no hedging. ~65–75% token cut. Default.',
  },
  {
    value: 'ultra',
    label: 'Ultra',
    hint: 'Telegraphic — critical nouns + verbs only. Maximum English compression.',
  },
  {
    value: 'wenyan-lite',
    label: 'Wenyan-lite (文言)',
    hint: 'Classical Chinese literary register, light. For readers fluent in 文言.',
  },
  {
    value: 'wenyan-full',
    label: 'Wenyan-full (文言)',
    hint: 'Canonical classical Chinese register. Higher density than English fragments.',
  },
  {
    value: 'wenyan-ultra',
    label: 'Wenyan-ultra (文言)',
    hint: 'Four- or six-character classical lines. Maximum literary compression.',
  },
];

export function ExperimentsSection() {
  const [prefs, setPrefs] = useState<CavemanSettings>({
    enabled: false,
    level: 'full',
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void window.cowork.caveman
      .get()
      .then((next) => {
        if (cancelled) return;
        setPrefs(next);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
    // Pick up changes from other windows so this UI stays in sync.
    const off = window.cowork.caveman.onChanged((next) => {
      setPrefs(next);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const updateEnabled = async (enabled: boolean) => {
    // Optimistic — flip the UI immediately so the toggle feels snappy.
    // If main rejects (it shouldn't — electron-store writes are sync)
    // we re-fetch and overwrite local state from the source of truth.
    setPrefs((p) => ({ ...p, enabled }));
    try {
      await window.cowork.caveman.save({ enabled });
    } catch {
      const current = await window.cowork.caveman.get();
      setPrefs(current);
    }
  };

  const updateLevel = async (level: CavemanLevel) => {
    setPrefs((p) => ({ ...p, level }));
    try {
      await window.cowork.caveman.save({ level });
    } catch {
      const current = await window.cowork.caveman.get();
      setPrefs(current);
    }
  };

  const enabled = !!prefs.enabled;
  const level = prefs.level ?? 'full';
  const activeLevelEntry = LEVELS.find((l) => l.value === level) ?? LEVELS[1];

  return (
    <div className="settings-pane">
      <div className="settings-pane-header">
        <h2>Experiments</h2>
        <p className="settings-pane-sub">
          Opt-in features that aren't part of the default INZONE
          experience. Each one is off by default — flip the switch
          when you want it. New sessions pick up the change immediately;
          already-running panes keep their current behaviour until they
          restart.
        </p>
      </div>

      <div className="settings-pane-body">
        <section className="settings-section">
          <h3>
            Caveman mode{' '}
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                marginLeft: 8,
                padding: '2px 6px',
                borderRadius: 4,
                background:
                  'color-mix(in srgb, var(--accent) 18%, transparent)',
                color: 'var(--text-dim)',
                letterSpacing: 0.3,
                textTransform: 'uppercase',
                verticalAlign: 'middle',
              }}
            >
              Experiment
            </span>
          </h3>
          <p className="settings-section-sub">
            Token-compression directive based on{' '}
            <a
              href="https://github.com/JuliusBrussee/caveman"
              target="_blank"
              rel="noreferrer"
            >
              JuliusBrussee/caveman
            </a>
            . When enabled, every new agent session starts with a
            system-prompt addendum that asks the model to drop
            articles, filler, pleasantries, and hedging from its
            natural-language output — typically cutting{' '}
            <strong>~65–75%</strong> of tokens in assistant text.
            Code, file paths, identifiers, error messages, commit
            messages, and PR text are unaffected.
          </p>

          <label className="toggle-row">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!loaded}
              onChange={(e) => void updateEnabled(e.target.checked)}
            />
            <span className="toggle-label">
              {enabled ? 'Enabled' : 'Disabled'}
            </span>
          </label>

          <div
            style={{
              marginTop: 16,
              opacity: enabled ? 1 : 0.55,
              pointerEvents: enabled ? 'auto' : 'none',
              transition: 'opacity 120ms ease',
            }}
          >
            <label className="field" style={{ display: 'block' }}>
              <span className="field-label">Intensity level</span>
              <select
                value={level}
                disabled={!loaded || !enabled}
                onChange={(e) =>
                  void updateLevel(e.target.value as CavemanLevel)
                }
                style={{
                  width: '100%',
                  maxWidth: 360,
                  padding: '8px 10px',
                  background: 'var(--bg-elev)',
                  color: 'var(--text)',
                  border:
                    '1px solid color-mix(in srgb, var(--text) 14%, transparent)',
                  borderRadius: 6,
                  fontSize: 14,
                }}
              >
                {LEVELS.map((l) => (
                  <option key={l.value} value={l.value}>
                    {l.label}
                  </option>
                ))}
              </select>
              <span className="field-hint" style={{ marginTop: 6 }}>
                {activeLevelEntry.hint}
              </span>
            </label>
          </div>

          <p className="settings-section-hint" style={{ marginTop: 16 }}>
            The full caveman skill is also bundled at{' '}
            <code>~/.claude/skills/caveman/</code> so individual agents
            can opt in via their frontmatter <code>skills:</code> list
            even without this global switch. The toggle above is the
            quick path for "every agent, all the time."
          </p>

          <p className="settings-section-hint">
            <strong>Affects new sessions only.</strong> Already-running
            panes keep their current system prompt until they restart
            — click "Clear session" in the pane menu to force a fresh
            start with the new setting.
          </p>
        </section>
      </div>
    </div>
  );
}
