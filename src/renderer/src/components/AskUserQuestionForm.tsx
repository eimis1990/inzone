import { useMemo, useState } from 'react';
import type { PaneId } from '@shared/types';
import { useStore } from '../store';

/**
 * Inline question card rendered by Message.tsx whenever the chat
 * stream contains an `ask_user_question` item. Walks the user
 * through one question at a time (the agent typically sends one,
 * but the schema allows several), supports both single- and
 * multi-select answers, and submits the bundle to the store on the
 * final question.
 *
 * Once submitted, the form re-renders as a compact "answered"
 * summary — the agent's response will appear below it as normal
 * assistant_text. The underlying tool_use / tool_result events are
 * suppressed in `buildViewItems` so the user only sees this card.
 */

interface QuestionDef {
  question: string;
  header?: string;
  options: Array<{ label: string; description?: string }>;
  multiSelect?: boolean;
}

interface Props {
  paneId: PaneId;
  requestId: string;
  questions: QuestionDef[];
  /** Once present, the form locks to the answered-summary view. */
  answers?: Array<{ question: string; chosen: string[] }>;
}

export function AskUserQuestionForm({
  paneId,
  requestId,
  questions,
  answers,
}: Props) {
  const submit = useStore((s) => s.submitAskUserQuestion);

  // Local working state — accumulates answers as the user advances
  // through questions. We keep `chosen` per question id (index here,
  // since we don't have stable ids on the wire) so the multi-select
  // checkboxes remember their state across renders.
  const [step, setStep] = useState(0);
  const [working, setWorking] = useState<string[][]>(
    () => questions.map(() => []),
  );
  const isAnswered = !!answers;
  const total = questions.length;
  const current = questions[step];

  /** Whether the current step has at least one selected option. */
  const stepValid = useMemo(() => {
    if (!current) return false;
    if (current.multiSelect) {
      // Allow zero selections on multi-select — counts as "skipped".
      return true;
    }
    return (working[step]?.length ?? 0) === 1;
  }, [working, step, current]);

  if (!current && !isAnswered) return null;

  if (isAnswered) {
    return (
      <div className="msg auq auq-answered">
        <div className="auq-header">
          <span className="auq-icon" aria-hidden>
            ✓
          </span>
          <span>Answered</span>
        </div>
        {answers!.map((a, i) => (
          <div key={i} className="auq-answer-row">
            <div className="auq-answer-q">{a.question}</div>
            <div className="auq-answer-a">
              {a.chosen.length === 0
                ? <em>(skipped)</em>
                : a.chosen.join(' · ')}
            </div>
          </div>
        ))}
      </div>
    );
  }

  const onPickSingle = (label: string) => {
    setWorking((prev) => {
      const next = prev.map((arr) => arr.slice());
      next[step] = [label];
      return next;
    });
  };

  const onToggleMulti = (label: string) => {
    setWorking((prev) => {
      const next = prev.map((arr) => arr.slice());
      const i = next[step].indexOf(label);
      if (i === -1) next[step].push(label);
      else next[step].splice(i, 1);
      return next;
    });
  };

  const onContinue = () => {
    if (step < total - 1) {
      setStep(step + 1);
      return;
    }
    // Final step — bundle answers and submit. We pair each answer
    // with its question text so the resolved tool result reads
    // self-explanatorily back to the agent.
    const bundle = questions.map((q, i) => ({
      question: q.question,
      chosen: working[i] ?? [],
    }));
    void submit(paneId, requestId, bundle);
  };

  const headerSuffix = total > 1 ? ` (${step + 1} of ${total})` : '';

  return (
    <div className="msg auq">
      <div className="auq-header">
        <span className="auq-icon" aria-hidden>
          ?
        </span>
        <span>Question{headerSuffix}</span>
        {current.header && (
          <span className="auq-pane-header">{current.header}</span>
        )}
      </div>
      <div className="auq-question">{current.question}</div>
      <div className="auq-options">
        {current.options.map((opt) => {
          const checked =
            working[step]?.includes(opt.label) ?? false;
          return (
            <button
              key={opt.label}
              type="button"
              className={'auq-option' + (checked ? ' checked' : '')}
              onClick={() => {
                if (current.multiSelect) onToggleMulti(opt.label);
                else onPickSingle(opt.label);
              }}
            >
              <span
                className={
                  'auq-option-marker ' +
                  (current.multiSelect ? 'auq-checkbox' : 'auq-radio') +
                  (checked ? ' checked' : '')
                }
                aria-hidden
              >
                {checked && (current.multiSelect ? '✓' : '●')}
              </span>
              <span className="auq-option-body">
                <span className="auq-option-label">{opt.label}</span>
                {opt.description && (
                  <span className="auq-option-desc">{opt.description}</span>
                )}
              </span>
            </button>
          );
        })}
      </div>
      <div className="auq-actions">
        <span className="auq-progress">
          {current.multiSelect
            ? `${working[step]?.length ?? 0} selected`
            : stepValid
              ? '1 selected'
              : 'Pick one'}
        </span>
        <button
          type="button"
          className="auq-continue"
          disabled={!stepValid}
          onClick={onContinue}
        >
          {step < total - 1 ? 'Next →' : 'Submit'}
        </button>
      </div>
    </div>
  );
}
