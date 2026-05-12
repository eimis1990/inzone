import { useEffect, useRef, useState } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { oneDark } from '@codemirror/theme-one-dark';
import { vim } from '@replit/codemirror-vim';
import { useEditorPreferences } from '../hooks/useEditorPreferences';
import { useStore } from '../store';
import { AGENT_COLORS, AGENT_TOOL_CHOICES, MODEL_CHOICES } from '@shared/palette';
import type { McpServerEntry } from '@shared/types';

export function EditorModal() {
  // Two sources of truth:
  //  - `storeEditor`  : the Zustand source-of-truth. Going `null`
  //                     means "the editor should be closed".
  //  - `localEditor`  : a render snapshot that OUTLIVES the store
  //                     clearing by ~260ms so the slide-out
  //                     animation has time to play before we
  //                     actually unmount. Without this, hitting
  //                     Esc would yank the drawer off the DOM
  //                     mid-transition.
  // `isOpen` drives the `.open` CSS class. Initial false →
  // next-frame true on mount triggers the slide-in transition.
  // Closing flips it back to false; an effect waits 260ms then
  // drops `localEditor` so React unmounts.
  const storeEditor = useStore((s) => s.editor);
  const saving = useStore((s) => s.editorSaving);
  const error = useStore((s) => s.editorError);
  const update = useStore((s) => s.updateEditor);
  const close = useStore((s) => s.closeEditor);
  const save = useStore((s) => s.saveEditor);
  const remove = useStore((s) => s.deleteFromEditor);
  const allSkills = useStore((s) => s.skills);
  const cwd = useStore((s) => s.cwd);
  const { vimMode } = useEditorPreferences();

  const [localEditor, setLocalEditor] = useState(storeEditor);
  const [isOpen, setIsOpen] = useState(false);

  // Drive the open/close lifecycle off the store editor changing.
  // Three transitions handled:
  //  1. null → editor : mount + next-frame open. Saves the
  //     snapshot for use during the eventual slide-out.
  //  2. editor → editor (different): just refresh the snapshot.
  //     Mostly a no-op since we usually close before opening a
  //     different one, but defensive.
  //  3. editor → null : keep rendering the snapshot, drop the
  //     `.open` class so CSS transitions back out, then ~260ms
  //     later drop the snapshot so the component unmounts.
  // Drawer mode (skill kind) drives a 260ms slide; agent kind
  // uses the centered modal which doesn't need the local-snapshot
  // dance — clearing the store unmounts it directly. We still
  // hold the snapshot for both for code-path uniformity; for
  // agents the transition is invisible (no `.open` class effect).
  useEffect(() => {
    if (storeEditor) {
      setLocalEditor(storeEditor);
      if (!isOpen) {
        // Double `requestAnimationFrame` is intentional. With a
        // single RAF, React 18's batching can land the initial
        // mount (isOpen=false → off-screen) and the open flip
        // (isOpen=true → in position) in the SAME paint, which
        // means the browser never sees the off-screen state and
        // skips the transition — the drawer appears instantly.
        // Two RAFs guarantee a paint between the two states so
        // CSS sees `translateX(100%)` first and `translateX(0)`
        // second, kicking the transition in. (`setTimeout 0`
        // works too but is less precise about when it fires.)
        let raf2: number | null = null;
        const raf1 = requestAnimationFrame(() => {
          raf2 = requestAnimationFrame(() => setIsOpen(true));
        });
        return () => {
          cancelAnimationFrame(raf1);
          if (raf2 !== null) cancelAnimationFrame(raf2);
        };
      }
      return;
    }
    if (localEditor) {
      setIsOpen(false);
      const t = setTimeout(() => setLocalEditor(null), 260);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storeEditor]);

  const firstFieldRef = useRef<HTMLInputElement>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [mcpOpen, setMcpOpen] = useState(false);
  const [allMcps, setAllMcps] = useState<McpServerEntry[]>([]);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | undefined>();
  const [enhancingDescription, setEnhancingDescription] = useState(false);
  const [enhanceError, setEnhanceError] = useState<string | undefined>();

  // Load configured MCP servers when the editor opens so the agent can
  // opt into them. Refresh whenever cwd changes (different project file).
  useEffect(() => {
    if (!storeEditor) return;
    if (!window.cowork?.mcp) return; // preload not yet refreshed
    void window.cowork.mcp
      .list(cwd ?? undefined)
      .then(setAllMcps)
      .catch(() => setAllMcps([]));
  }, [storeEditor, cwd]);

  // Focus the name field ONLY when a new editor session opens — not on
  // every keystroke. We key off kind + original file path, which only
  // changes when a different entity is opened.
  const editorKey = storeEditor
    ? `${storeEditor.kind}:${storeEditor.draft.originalFilePath ?? 'new'}`
    : null;
  useEffect(() => {
    if (editorKey) firstFieldRef.current?.focus();
  }, [editorKey]);

  useEffect(() => {
    // Keyboard listeners track the STORE editor — they should
    // detach as soon as the user closes (even if we're still
    // rendering the local snapshot during the slide-out
    // animation, we don't want Esc to re-fire close on the way
    // out, and we don't want Cmd+Enter to save a half-closed
    // panel).
    if (!storeEditor) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') void save();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [storeEditor, close, save]);

  if (!localEditor) return null;
  // From here on, the render uses the snapshot so the slide-out
  // animation has stable data to display. The user's click on
  // Close fires `close` (store), which sets storeEditor=null;
  // our effect above then animates the snapshot out before
  // dropping it.
  const editor = localEditor;

  const isAgent = editor.kind === 'agent';
  const isNew = !editor.draft.originalFilePath;
  const draft = editor.draft;
  const agentDraft = isAgent
    ? (draft as {
        model?: string;
        tools?: string[];
        skills?: string[];
        mcpServers?: string[];
        color?: string;
        emoji?: string;
        vibe?: string;
      })
    : null;
  const selectedTools = new Set(agentDraft?.tools ?? []);
  const selectedSkills = new Set(agentDraft?.skills ?? []);
  const selectedMcps = new Set(agentDraft?.mcpServers ?? []);

  const toggleTool = (tool: string) => {
    const next = new Set(selectedTools);
    if (next.has(tool)) next.delete(tool);
    else next.add(tool);
    update({ tools: [...next] });
  };

  const toggleSkill = (skill: string) => {
    const next = new Set(selectedSkills);
    if (next.has(skill)) next.delete(skill);
    else next.add(skill);
    update({ skills: [...next] });
  };

  const toggleMcp = (name: string) => {
    const next = new Set(selectedMcps);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    update({ mcpServers: [...next] });
  };

  // Skills render as a right-side drawer (Settings → Skills design
  // ask, v1.13). Agents stay as a centered modal for now — they have
  // significantly more form surface (tools / skills / MCPs / colour
  // / vibe pickers) and benefit from the wider centered footprint.
  // Branching the wrapper keeps both flows on the SAME form contents
  // below; only the chrome changes.
  //
  // The `.open` class drives the slide-in / slide-out CSS transition
  // on the backdrop + surface. It's set on next-frame after mount
  // (so the browser sees the initial off-screen state), and cleared
  // by our close effect ~260ms before the snapshot is dropped.
  const useDrawer = !isAgent;
  const openMod = isOpen ? ' open' : '';
  const backdropClass = useDrawer
    ? `modal-backdrop modal-backdrop-drawer${openMod}`
    : 'modal-backdrop';
  const surfaceClass = useDrawer
    ? `modal modal-drawer editor-drawer${openMod}`
    : 'modal modal-lg';

  return (
    <div className={backdropClass} onMouseDown={close}>
      <div
        className={surfaceClass}
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        <div className="modal-header">
          <h2>
            {isNew ? 'New' : 'Edit'} {isAgent ? 'agent' : 'skill'}
          </h2>
          <button className="icon-btn" onClick={close} aria-label="Close">
            ✕
          </button>
        </div>

        <div className="modal-body">
          <section className="editor-section">
            <div className="editor-section-title">Identity</div>
            <div className="field-row">
              <label className="field">
                <span className="field-label">Name</span>
                <input
                  ref={firstFieldRef}
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                  placeholder={isAgent ? 'code-reviewer' : 'my-skill'}
                  spellCheck={false}
                />
                <span className="field-hint">
                  <code>
                    ~/.claude/{isAgent ? 'agents' : 'skills'}/
                    {draft.name || 'name'}
                    {isAgent ? '.md' : '/SKILL.md'}
                  </code>
                </span>
              </label>

              {isAgent && (
                <label className="field field-small">
                  <span className="field-label">Model</span>
                  <select
                    value={agentDraft?.model ?? ''}
                    onChange={(e) => update({ model: e.target.value })}
                  >
                    {MODEL_CHOICES.map((m) => (
                      <option key={m.value} value={m.value}>
                        {m.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <label className="field">
              <span className="field-label-row">
                <span className="field-label">Description</span>
                {isAgent && (
                  <button
                    type="button"
                    className="enhance-btn"
                    onClick={async () => {
                      const current = (draft.description ?? '').trim();
                      if (!current) {
                        setEnhanceError(
                          'Type a short description first, then Enhance.',
                        );
                        return;
                      }
                      setEnhanceError(undefined);
                      setEnhancingDescription(true);
                      try {
                        const next =
                          await window.cowork.agents.enhanceDescription({
                            name: draft.name,
                            description: current,
                          });
                        const cleaned = next.trim();
                        if (cleaned && cleaned !== current) {
                          update({ description: cleaned });
                        }
                      } catch (err) {
                        setEnhanceError(
                          err instanceof Error
                            ? err.message
                            : 'Enhancement failed. Try again.',
                        );
                      } finally {
                        setEnhancingDescription(false);
                      }
                    }}
                    disabled={
                      enhancingDescription ||
                      !(draft.description ?? '').trim()
                    }
                    title="Rewrite as 3 short paragraphs (role · knowledge · how it works)"
                  >
                    {enhancingDescription ? (
                      <>
                        <span className="btn-spinner" aria-hidden />
                        Enhancing…
                      </>
                    ) : (
                      <>
                        <SparkleIcon />
                        Enhance
                      </>
                    )}
                  </button>
                )}
              </span>
              <textarea
                value={draft.description ?? ''}
                onChange={(e) => update({ description: e.target.value })}
                placeholder="Short description shown in the sidebar and hovertip — type a 1-line role and click Enhance"
                rows={3}
                className="field-textarea"
                disabled={enhancingDescription}
              />
              {enhanceError && (
                <span className="field-hint field-hint-error">
                  {enhanceError}
                </span>
              )}
            </label>
          </section>

          {isAgent && (
            <>
              <section className="editor-section">
                <div className="editor-section-title">Capabilities</div>
                <div className="field-row field-row-three">
              <div className="field">
                <span className="field-label">Allowed tools</span>
                <div className="multiselect">
                  <button
                    type="button"
                    className="multiselect-toggle"
                    onClick={() => setToolsOpen((v) => !v)}
                  >
                    {selectedTools.size === 0 ? (
                      <span className="muted">All tools</span>
                    ) : (
                      <span>
                        {[...selectedTools].join(', ')}
                      </span>
                    )}
                    <span className="caret">▾</span>
                  </button>
                  {toolsOpen && (
                    <div
                      className="multiselect-menu"
                      onMouseLeave={() => setToolsOpen(false)}
                    >
                      <div className="multiselect-row">
                        <button
                          type="button"
                          className="ghost small"
                          onClick={() => update({ tools: [] })}
                        >
                          All tools
                        </button>
                        <button
                          type="button"
                          className="ghost small"
                          onClick={() =>
                            update({ tools: [...AGENT_TOOL_CHOICES] })
                          }
                        >
                          Select all
                        </button>
                      </div>
                      {AGENT_TOOL_CHOICES.map((tool) => (
                        <label key={tool} className="multiselect-option">
                          <input
                            type="checkbox"
                            checked={selectedTools.has(tool)}
                            onChange={() => toggleTool(tool)}
                          />
                          <span>{tool}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <span className="field-hint">
                  Empty = all tools; otherwise the SDK restricts the agent to only these.
                </span>
              </div>

              <div className="field">
                <span className="field-label">Skills</span>
                <div className="multiselect">
                  <button
                    type="button"
                    className="multiselect-toggle"
                    onClick={() => setSkillsOpen((v) => !v)}
                  >
                    {agentDraft?.skills === undefined ||
                    agentDraft.skills.length === 0 ? (
                      <span className="muted">No skills</span>
                    ) : (
                      <span>
                        {[...selectedSkills].join(', ')}
                      </span>
                    )}
                    <span className="caret">▾</span>
                  </button>
                  {skillsOpen && (
                    <div
                      className="multiselect-menu"
                      onMouseLeave={() => setSkillsOpen(false)}
                    >
                      <div className="multiselect-row">
                        <button
                          type="button"
                          className="ghost small"
                          onClick={() => update({ skills: [] })}
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          className="ghost small"
                          onClick={() =>
                            update({
                              skills: allSkills.map((s) => s.name),
                            })
                          }
                        >
                          Select all
                        </button>
                      </div>
                      {allSkills.length === 0 && (
                        <div className="multiselect-empty">
                          No skills in ~/.claude/skills yet — create one from the
                          Skills tab in the sidebar.
                        </div>
                      )}
                      {allSkills.map((s) => (
                        <label
                          key={s.name}
                          className="multiselect-option multiselect-option-wide"
                        >
                          <input
                            type="checkbox"
                            checked={selectedSkills.has(s.name)}
                            onChange={() => toggleSkill(s.name)}
                          />
                          <span className="skill-row">
                            <span className="skill-name">{s.name}</span>
                            {s.description && (
                              <span className="skill-desc">{s.description}</span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <span className="field-hint">
                  The agent sees each skill&rsquo;s name and description, and reads its SKILL.md on demand — same pattern as Claude Code.
                </span>
              </div>

              <div className="field">
                <span className="field-label">MCP servers</span>
                <div className="multiselect">
                  <button
                    type="button"
                    className="multiselect-toggle"
                    onClick={() => setMcpOpen((v) => !v)}
                  >
                    {selectedMcps.size === 0 ? (
                      <span className="muted">No MCP access</span>
                    ) : (
                      <span>{[...selectedMcps].join(', ')}</span>
                    )}
                    <span className="caret">▾</span>
                  </button>
                  {mcpOpen && (
                    <div
                      className="multiselect-menu"
                      onMouseLeave={() => setMcpOpen(false)}
                    >
                      <div className="multiselect-row">
                        <button
                          type="button"
                          className="ghost small"
                          onClick={() => update({ mcpServers: [] })}
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          className="ghost small"
                          onClick={() =>
                            update({ mcpServers: allMcps.map((m) => m.name) })
                          }
                        >
                          Select all
                        </button>
                      </div>
                      {allMcps.length === 0 && (
                        <div className="multiselect-empty">
                          No MCP servers configured. Add some in Settings →
                          MCP servers, then come back here to opt in.
                        </div>
                      )}
                      {allMcps.map((m) => (
                        <label
                          key={m.name}
                          className="multiselect-option multiselect-option-wide"
                        >
                          <input
                            type="checkbox"
                            checked={selectedMcps.has(m.name)}
                            onChange={() => toggleMcp(m.name)}
                          />
                          <span className="skill-row">
                            <span className="skill-name">{m.name}</span>
                            <span className="skill-desc">
                              {m.config.type.toUpperCase()} ·{' '}
                              {m.scope === 'user'
                                ? 'all projects'
                                : m.scope === 'project'
                                  ? 'this project'
                                  : `from another folder${m.projectPath ? ` (${shortenPath(m.projectPath)})` : ''}`}
                            </span>
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
                <span className="field-hint">
                  Servers the agent can call. <strong>Empty = no MCP access</strong>{' '}
                  for this agent. Tools surface as{' '}
                  <code>mcp__&lt;server&gt;__&lt;tool&gt;</code>.
                </span>
              </div>

                </div>
              </section>

              <section className="editor-section">
                <div className="editor-section-title">Appearance</div>
                {/* Emoji + Vibe — optional personality fields. Surface
                    side-by-side so they don't crowd the rest of the form. */}
                <div className="field-row">
                  <div className="field field-small">
                    <span className="field-label">Emoji</span>
                    <EmojiPicker
                      value={agentDraft?.emoji ?? ''}
                      onChange={(emoji) => update({ emoji })}
                    />
                    <span className="field-hint">
                      Optional. Shows in the pane header next to the name.
                    </span>
                  </div>
                  <div className="field">
                    <span className="field-label">Vibe</span>
                    <input
                      type="text"
                      value={agentDraft?.vibe ?? ''}
                      onChange={(e) => update({ vibe: e.target.value })}
                      placeholder="The co-founder you can't afford yet"
                      spellCheck={false}
                    />
                    <span className="field-hint">
                      Optional one-liner — a punchier sibling of the description.
                    </span>
                  </div>
                </div>

                <div className="field">
                  <span className="field-label">Color</span>
                  <div className="color-picker">
                    <button
                      type="button"
                      className={
                        'color-swatch none' +
                        (!agentDraft?.color ? ' selected' : '')
                      }
                      onClick={() => update({ color: '' })}
                      title="No color"
                    >
                      ⦸
                    </button>
                    {AGENT_COLORS.map((c) => {
                      const isSelected = agentDraft?.color === c.name;
                      // Selected swatch keeps its colored pale background so
                      // it visually "pops"; everything else just shows a
                      // dot — the chip itself sits on the same neutral
                      // background as the "no color" button.
                      return (
                        <button
                          key={c.name}
                          type="button"
                          className={
                            'color-swatch' + (isSelected ? ' selected' : '')
                          }
                          style={
                            isSelected
                              ? {
                                  background: c.pale,
                                  borderColor: c.vivid,
                                  color: c.vivid,
                                }
                              : { color: c.vivid }
                          }
                          onClick={() => update({ color: c.name })}
                          title={c.label}
                        >
                          <span
                            className="color-dot"
                            style={{ background: c.vivid }}
                          />
                          <span>{c.label}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              </section>
            </>
          )}

          <section className="editor-section editor-section-prompt">
            <div className="editor-section-header editor-section-header-tight">
              <div className="editor-section-title">
                <span>System prompt</span>
                <span className="field-hint-inline">
                  markdown — syntax highlighted
                </span>
              </div>
              {isAgent && (
              <div className="generate-cluster">
                <button
                  type="button"
                  className="generate-btn"
                  disabled={
                    generating ||
                    (!draft.name.trim() && !(draft.description ?? '').trim())
                  }
                  onClick={async () => {
                    if (
                      draft.body.trim().length > 0 &&
                      !confirm(
                        'Replace the current system prompt with a Claude-generated one?',
                      )
                    ) {
                      return;
                    }
                    setGenerating(true);
                    setGenerateError(undefined);
                    try {
                      const body = await window.cowork.agents.generate({
                        name: draft.name,
                        description: draft.description ?? '',
                      });
                      update({ body });
                    } catch (err) {
                      setGenerateError(
                        err instanceof Error ? err.message : String(err),
                      );
                    } finally {
                      setGenerating(false);
                    }
                  }}
                >
                  {generating ? (
                    <>
                      <span className="btn-spinner" aria-hidden />
                      Generating…
                    </>
                  ) : (
                    <>
                      <SparkleIcon />
                      Generate prompt
                    </>
                  )}
                </button>
                <span className="generate-hint-mini">
                  Generate uses title + description above
                </span>
              </div>
              )}
            </div>
          <div className="field field-grow field-prompt-body">
            {generateError && (
              <div className="modal-error">{generateError}</div>
            )}
            <div className="codemirror-wrap">
              <CodeMirror
                value={draft.body}
                onChange={(value) => update({ body: value })}
                theme={oneDark}
                extensions={[
                  // Vim extension MUST come first — it installs its
                  // own keymap that should win over CodeMirror's
                  // defaults. Toggled via Settings → Editor.
                  ...(vimMode ? [vim()] : []),
                  markdown({
                    base: markdownLanguage,
                    codeLanguages: languages,
                  }),
                ]}
                basicSetup={{
                  lineNumbers: true,
                  highlightActiveLine: true,
                  foldGutter: true,
                  bracketMatching: true,
                }}
                minHeight="1280px"
                maxHeight="2000px"
              />
            </div>
          </div>
          </section>

          {error && <div className="modal-error">{error}</div>}
        </div>

        <div className="modal-footer">
          {!isNew && (
            <button
              className="danger"
              onClick={() => {
                if (confirm('Delete this file on disk? Cannot be undone.')) {
                  void remove();
                }
              }}
              disabled={saving}
            >
              Delete
            </button>
          )}
          <div className="spacer" />
          <button className="ghost" onClick={close} disabled={saving}>
            Cancel
          </button>
          <button
            className="primary"
            onClick={() => void save()}
            disabled={saving || !draft.name.trim() || !draft.body.trim()}
          >
            {saving ? 'Saving…' : isNew ? 'Create' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Compact a long path for display — keep the last 3 segments. Mirrors
 * the helper in the MCP servers settings tab so users see the same
 * path style across the app.
 */
function shortenPath(p: string): string {
  const segs = p.split('/');
  if (segs.length <= 4) return p;
  return '…/' + segs.slice(-3).join('/');
}

/**
 * A small emoji button + dropdown grid. Curated list rather than a
 * full emoji picker — covers the typical agent personalities (people,
 * tools, vibes) without dragging in a 50KB picker library.
 */
const EMOJI_CHOICES = [
  // people / personalities
  '🦄', '🧙', '🧠', '🤖', '👨‍💻', '👩‍💻', '🧑‍🎨', '🦸', '🧝',
  // tools / craft
  '🛠️', '⚒️', '🔨', '🔧', '⚙️', '🪛', '🧰', '📐', '✏️', '✒️',
  // creative / fun
  '🎨', '🎭', '🎬', '🎪', '🎯', '🎲', '🚀', '⭐', '✨', '💫', '🔥',
  // animals / mascots
  '🐺', '🦊', '🦁', '🐉', '🐢', '🦉', '🐙', '🦋',
  // moods / signals
  '💡', '⚡', '💎', '🌱', '🌿', '🍀', '🌈', '🌸', '🍕', '☕',
];

function EmojiPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (emoji: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  return (
    <div className="emoji-picker" ref={wrapRef}>
      <button
        type="button"
        className="emoji-picker-trigger"
        onClick={() => setOpen((v) => !v)}
        title={value ? `Emoji: ${value}` : 'Pick an emoji'}
      >
        <span className="emoji-picker-display">
          {value || <span className="emoji-picker-placeholder">+</span>}
        </span>
      </button>
      {open && (
        <div className="emoji-picker-menu">
          <div className="emoji-picker-grid">
            <button
              type="button"
              className="emoji-picker-cell emoji-picker-clear"
              onClick={() => {
                onChange('');
                setOpen(false);
              }}
              title="No emoji"
            >
              ⦸
            </button>
            {EMOJI_CHOICES.map((e) => (
              <button
                type="button"
                key={e}
                className={
                  'emoji-picker-cell' + (value === e ? ' selected' : '')
                }
                onClick={() => {
                  onChange(e);
                  setOpen(false);
                }}
                title={e}
              >
                {e}
              </button>
            ))}
          </div>
          {/* Custom-paste fallback for users who want an emoji not in
              our shortlist. Accepts any single grapheme cluster. */}
          <div className="emoji-picker-custom">
            <input
              type="text"
              placeholder="Or paste any emoji"
              value={value}
              onChange={(e) => onChange(e.target.value.slice(0, 8))}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setOpen(false);
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}

/** Four-point sparkle used inside the Enhance + Generate AI buttons.
 *  Rendered as inline SVG so it inherits color via `currentColor` and stays
 *  crisp at any DPI. Sized via CSS rather than width/height props. */
function SparkleIcon() {
  return (
    <svg
      className="ai-sparkle"
      viewBox="0 0 16 16"
      fill="currentColor"
      aria-hidden
    >
      <path d="M8 0.5l1.4 4.4 4.4 1.4-4.4 1.4L8 12.1 6.6 7.7 2.2 6.3l4.4-1.4L8 0.5z" />
      <path
        d="M13 10l0.6 1.9 1.9 0.6-1.9 0.6L13 15l-0.6-1.9-1.9-0.6 1.9-0.6L13 10z"
        opacity="0.7"
      />
    </svg>
  );
}
