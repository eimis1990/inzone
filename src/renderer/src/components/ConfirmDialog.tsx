/**
 * Modal that backs `safeConfirm()` — the in-renderer replacement
 * for `window.confirm()`. Mounted once at the App root; renders
 * itself ONLY when a confirm request is in-flight.
 *
 * Why this exists instead of native confirm: native dialogs on
 * Windows corrupt the renderer's keyboard-routing state when they
 * dismiss, leaving every textarea unable to receive keystrokes
 * until some other native dialog (file picker, etc.) unsticks
 * things. By doing the confirmation entirely inside the renderer
 * we sidestep the bug — React owns focus the whole time, no OS
 * dialog ever takes over.
 *
 * Keyboard contract:
 *   Esc            → Cancel
 *   Enter          → OK (matches native confirm's default action)
 *   click backdrop → Cancel
 *
 * The OK button is auto-focused on mount so Enter / Space accept
 * the prompt the same way the native flow did.
 */

import { useEffect, useRef } from 'react';
import { resolveConfirm, useConfirmRequest } from '../lib/safeConfirm';

export function ConfirmDialog(): JSX.Element | null {
  const req = useConfirmRequest();
  const okBtnRef = useRef<HTMLButtonElement>(null);

  // Auto-focus OK whenever a new request appears so keyboard-only
  // users can confirm with Enter immediately — same as `confirm()`.
  // Keyed on `req` so re-focus also happens if a new request lands
  // while the dialog is already open (rare, but supported).
  useEffect(() => {
    if (req) okBtnRef.current?.focus();
  }, [req]);

  // Window-level Esc / Enter handler so the keys work regardless of
  // which element has focus. We attach only when a request is
  // in-flight to keep listeners scoped.
  useEffect(() => {
    if (!req) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        resolveConfirm(false);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        resolveConfirm(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [req]);

  if (!req) return null;

  return (
    <div
      className="modal-backdrop confirm-dialog-backdrop"
      onMouseDown={() => resolveConfirm(false)}
      role="presentation"
    >
      <div
        className="modal confirm-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal
        aria-label="Confirm"
      >
        <div className="modal-body confirm-dialog-body">
          {/* Render the message preserving line breaks — long-form
              prompts (the agent / terminal swap warnings, the
              clear-conversation prompt, etc.) often use sentences
              that wrap naturally and an embedded newline or two
              for emphasis. */}
          <p className="confirm-dialog-message">{req.message}</p>
        </div>
        <div className="modal-footer confirm-dialog-footer">
          <button
            type="button"
            className="ghost"
            onClick={() => resolveConfirm(false)}
          >
            Cancel
          </button>
          <button
            ref={okBtnRef}
            type="button"
            className="primary"
            onClick={() => resolveConfirm(true)}
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
