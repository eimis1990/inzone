import { useEffect, useMemo, useState } from 'react';
import {
  BUILTIN_TASK_TEMPLATES,
  fingerprintTaskState,
  fingerprintTaskTemplate,
} from '@shared/task-templates';
import type { PaneNode, TaskTemplate } from '@shared/types';
import { useStore } from '../store';

interface TasksModalProps {
  open: boolean;
  onClose: () => void;
}

/** Walk the pane tree left-to-right depth-first and return leaf
 *  ids in display order. Local copy of the store-internal
 *  `collectLeaves` so we don't have to widen its export surface. */
function walkLeafIds(node: PaneNode, out: string[] = []): string[] {
  if (node.kind === 'leaf') out.push(node.id);
  else for (const c of node.children) walkLeafIds(c, out);
  return out;
}

/**
 * Tasks modal.
 *
 * Three sections, top to bottom:
 *  1. **Current session** — a feature card showing the live pane
 *     setup (mode + agents) with editable title + description and
 *     a Save-as-template action. If the current setup already
 *     matches a saved template, the card surfaces that instead.
 *  2. **My templates** — user-saved custom templates (newest first).
 *  3. **Suggested templates** — built-in templates filtered to the
 *     ones whose required agents the user has installed.
 *
 * Uniform card heights via flex stretch + min-height keep the grid
 * tidy regardless of how many agent chips a card carries.
 */
export function TasksModal({ open, onClose }: TasksModalProps) {
  const agents = useStore((s) => s.agents);
  const tree = useStore((s) => s.tree);
  const panes = useStore((s) => s.panes);
  const leadPaneId = useStore((s) => s.leadPaneId);
  const windowMode = useStore((s) => s.windowMode);
  const customTemplates = useStore((s) => s.customTaskTemplates);
  const applyTaskTemplate = useStore((s) => s.applyTaskTemplate);
  const saveCurrentAsTaskTemplate = useStore(
    (s) => s.saveCurrentAsTaskTemplate,
  );
  const deleteCustomTaskTemplate = useStore(
    (s) => s.deleteCustomTaskTemplate,
  );

  // Editable name + description for the current-session card. We
  // reset these whenever the modal opens so the user starts fresh
  // each time. Saving turns the current session into a custom
  // template carrying the entered name/description.
  const [currentName, setCurrentName] = useState('');
  const [currentDesc, setCurrentDesc] = useState('');
  const [currentEmoji, setCurrentEmoji] = useState('📌');
  const [saving, setSaving] = useState(false);

  // Set of installed agent slugs. Used to filter built-in templates
  // and to mark custom-template agents as missing/unbindable.
  const installedAgents = useMemo(
    () => new Set(agents.map((a) => a.name)),
    [agents],
  );

  // A built-in template is "available" only when EVERY agent it
  // references (including the optional Lead agent) is installed.
  const builtinAvailable = useMemo(
    () =>
      BUILTIN_TASK_TEMPLATES.filter((t) => {
        if (t.leadAgent && !installedAgents.has(t.leadAgent)) return false;
        return t.agents.every((a) => installedAgents.has(a));
      }),
    [installedAgents],
  );

  // Current-session snapshot — what's actually in the panes right
  // now. We compute it once per render so the card + match logic
  // can share it.
  const current = useMemo(() => {
    const orderedAgents = walkLeafIds(tree)
      .map((id) => panes[id]?.agentName)
      .filter((a): a is string => !!a && a.trim().length > 0);
    const cLeadAgent =
      windowMode === 'lead' && leadPaneId
        ? panes[leadPaneId]?.agentName
        : undefined;
    const fingerprint = fingerprintTaskState({
      mode: windowMode,
      leadAgent: cLeadAgent,
      agents: orderedAgents,
    });
    return {
      mode: windowMode,
      leadAgent: cLeadAgent,
      agents: orderedAgents,
      fingerprint,
      hasContent: orderedAgents.length > 0 || !!cLeadAgent,
    };
  }, [tree, panes, windowMode, leadPaneId]);

  const matchingTemplate = useMemo(() => {
    const all: TaskTemplate[] = [
      ...customTemplates,
      ...BUILTIN_TASK_TEMPLATES,
    ];
    return (
      all.find((t) => fingerprintTaskTemplate(t) === current.fingerprint) ??
      null
    );
  }, [customTemplates, current.fingerprint]);

  useEffect(() => {
    if (!open) return;
    setCurrentName('');
    setCurrentDesc('');
    setCurrentEmoji('📌');
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  const onPick = (template: TaskTemplate) => {
    void applyTaskTemplate(template);
    onClose();
  };

  const onSaveCurrent = async () => {
    const name = currentName.trim() || 'Unnamed Task';
    if (saving) return;
    setSaving(true);
    try {
      await saveCurrentAsTaskTemplate({
        name,
        description: currentDesc || undefined,
        emoji: currentEmoji || undefined,
      });
      // Optional UX: collapse the modal after a save so the user can
      // see their new entry land in "My templates" on next open.
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div
        className="modal tasks-modal"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
      >
        <div className="modal-header">
          <h2>Tasks</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body tasks-body">
          {/* ── Current session ────────────────────────────── */}
          <section className="tasks-current">
            <div className="tasks-section-title">Current session</div>
            <CurrentSessionCard
              mode={current.mode}
              agents={current.agents}
              leadAgent={current.leadAgent}
              hasContent={current.hasContent}
              matchingTemplate={matchingTemplate}
              name={currentName}
              setName={setCurrentName}
              description={currentDesc}
              setDescription={setCurrentDesc}
              emoji={currentEmoji}
              setEmoji={setCurrentEmoji}
              saving={saving}
              onSave={onSaveCurrent}
            />
          </section>

          {/* ── My templates ────────────────────────────────── */}
          {customTemplates.length > 0 && (
            <section className="tasks-section">
              <div className="tasks-section-title">My templates</div>
              <div className="tasks-grid">
                {customTemplates.map((t) => (
                  <TaskCard
                    key={t.id}
                    template={t}
                    installedAgents={installedAgents}
                    onPick={() => onPick(t)}
                    onDelete={() => {
                      if (
                        confirm(
                          `Delete "${t.name}"? This can't be undone.`,
                        )
                      ) {
                        void deleteCustomTaskTemplate(t.id);
                      }
                    }}
                  />
                ))}
              </div>
            </section>
          )}

          {/* ── Suggested templates ─────────────────────────── */}
          <section className="tasks-section">
            <div className="tasks-section-title">Suggested templates</div>
            <div className="tasks-footnote">
              Applying a template stops every running sub-agent
              session and rebuilds the pane layout. The Lead pane
              (when used) survives the rebuild — its agent is just
              rebound.
            </div>
            {builtinAvailable.length === 0 && (
              <div className="tasks-empty">
                No suggested templates available — install more agents
                under <b>Settings → Agents</b> to unlock more.
              </div>
            )}
            <div className="tasks-grid">
              {builtinAvailable.map((t) => (
                <TaskCard
                  key={t.id}
                  template={t}
                  installedAgents={installedAgents}
                  onPick={() => onPick(t)}
                />
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

interface CurrentSessionCardProps {
  mode: 'lead' | 'multi';
  agents: string[];
  leadAgent: string | undefined;
  hasContent: boolean;
  matchingTemplate: TaskTemplate | null;
  name: string;
  setName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  emoji: string;
  setEmoji: (v: string) => void;
  saving: boolean;
  onSave: () => void;
}

/** The feature card at the top of the modal showing the live pane
 *  setup. Editable title + description; a Save action that
 *  snapshots the current state into the user's custom templates. */
function CurrentSessionCard({
  mode,
  agents,
  leadAgent,
  hasContent,
  matchingTemplate,
  name,
  setName,
  description,
  setDescription,
  emoji,
  setEmoji,
  saving,
  onSave,
}: CurrentSessionCardProps) {
  if (!hasContent) {
    return (
      <div className="tasks-current-card tasks-current-empty">
        <div className="tasks-current-empty-text">
          No agents are bound to any pane yet — pick a suggested
          template below to set one up in one click.
        </div>
      </div>
    );
  }

  const matchedAlready = !!matchingTemplate;

  return (
    <div className="tasks-current-card">
      <div className="tasks-current-head">
        <input
          className="tasks-current-emoji"
          value={emoji}
          onChange={(e) => setEmoji(e.target.value)}
          maxLength={4}
          aria-label="Emoji"
        />
        <input
          className="tasks-current-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Unnamed Task"
        />
        <span
          className={
            'task-card-mode-pill ' +
            (mode === 'lead' ? 'task-card-mode-lead' : 'task-card-mode-multi')
          }
        >
          {mode === 'lead' ? 'Lead' : 'Multi'}
        </span>
      </div>
      <input
        className="tasks-current-desc"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Describe this setup (optional) — what kind of work is it for?"
      />
      <div className="tasks-current-agents">
        {leadAgent && (
          <span className="task-card-agent-chip task-card-agent-lead">
            <span aria-hidden>👑</span> {leadAgent}
          </span>
        )}
        {agents.map((a, i) => (
          <span key={`${a}-${i}`} className="task-card-agent-chip">
            {a}
          </span>
        ))}
      </div>
      <div className="tasks-current-actions">
        {matchedAlready ? (
          <span className="tasks-current-matched">
            <span aria-hidden>✓</span> Matches{' '}
            <strong>{matchingTemplate.name}</strong>{' '}
            {matchingTemplate.source === 'custom'
              ? '(your saved template)'
              : '(suggested template)'}
          </span>
        ) : (
          <span className="tasks-current-hint">
            Save this configuration so you can re-apply it later.
          </span>
        )}
        <button
          type="button"
          className="primary small"
          onClick={onSave}
          disabled={saving || matchedAlready}
          title={
            matchedAlready
              ? 'This setup already matches a saved template.'
              : 'Save current setup as a task template'
          }
        >
          {saving ? 'Saving…' : 'Save as template'}
        </button>
      </div>
    </div>
  );
}

interface TaskCardProps {
  template: TaskTemplate;
  /** Set of agent slugs currently installed in the user's library.
   *  Used to detect templates whose references have been broken by
   *  rename/delete since they were saved. Missing slugs render with
   *  a red ✗ "missing" treatment and the apply button is disabled
   *  on any card that has at least one missing reference. */
  installedAgents: Set<string>;
  onPick: () => void;
  onDelete?: () => void;
}

function TaskCard({
  template,
  installedAgents,
  onPick,
  onDelete,
}: TaskCardProps) {
  const leadMissing =
    !!template.leadAgent && !installedAgents.has(template.leadAgent);
  const missingAgents = template.agents.filter(
    (a) => !installedAgents.has(a),
  );
  const isBroken = leadMissing || missingAgents.length > 0;

  const disabledTitle = isBroken
    ? 'This template references agents that no longer exist in your library — recreate them or delete this template.'
    : template.description || template.name;

  return (
    <div className={'task-card' + (isBroken ? ' task-card-broken' : '')}>
      <button
        className="task-card-body"
        onClick={isBroken ? undefined : onPick}
        title={disabledTitle}
        disabled={isBroken}
        aria-disabled={isBroken}
      >
        <div className="task-card-head">
          <span className="task-card-emoji" aria-hidden>
            {template.emoji}
          </span>
          <div className="task-card-title">{template.name}</div>
          {template.mode === 'lead' && (
            <span className="task-card-mode-pill task-card-mode-lead">
              Lead
            </span>
          )}
          {template.mode === 'multi' && (
            <span className="task-card-mode-pill task-card-mode-multi">
              Multi
            </span>
          )}
        </div>
        {template.description && (
          <div className="task-card-desc">{template.description}</div>
        )}
        <div className="task-card-agents">
          {template.leadAgent && (
            <span
              className={
                'task-card-agent-chip' +
                (leadMissing
                  ? ' task-card-agent-missing'
                  : ' task-card-agent-lead')
              }
              title={
                leadMissing
                  ? `Missing: "${template.leadAgent}" is not in your agent library`
                  : undefined
              }
            >
              <span aria-hidden>{leadMissing ? '✗' : '👑'}</span>{' '}
              {template.leadAgent}
            </span>
          )}
          {template.agents.map((a) => {
            const missing = !installedAgents.has(a);
            return (
              <span
                key={a}
                className={
                  'task-card-agent-chip' +
                  (missing ? ' task-card-agent-missing' : '')
                }
                title={
                  missing
                    ? `Missing: "${a}" is not in your agent library`
                    : undefined
                }
              >
                {missing && <span aria-hidden>✗ </span>}
                {a}
              </span>
            );
          })}
        </div>
        {isBroken && (
          <div className="task-card-broken-note">
            Missing:{' '}
            {[
              ...(leadMissing && template.leadAgent
                ? [template.leadAgent]
                : []),
              ...missingAgents,
            ].join(', ')}
            {' — '}recreate the agent(s) or delete this template.
          </div>
        )}
      </button>
      {onDelete && (
        <button
          className="task-card-delete"
          onClick={onDelete}
          title="Delete template"
          aria-label="Delete template"
        >
          ✕
        </button>
      )}
    </div>
  );
}
