/**
 * In-renderer confirm dialog — replacement for `window.confirm()`.
 *
 * # Why not native confirm?
 *
 * On Windows, after a native `confirm()` dismisses, the renderer's
 * OS-level keyboard routing gets stuck. The first iteration of this
 * helper tried to blur + window.focus() on the next animation frame
 * to unstick it; that worked for some flows but not the one the
 * user kept hitting:
 *
 *   1. Type into Pane A's composer.
 *   2. Open ⋮ on Pane B → "Clear conversation" → native confirm →
 *      confirm.
 *   3. Every textarea in every pane (4 panes in the report) stops
 *      accepting keystrokes until the user opens + dismisses any
 *      other native dialog (e.g. the attachment file picker).
 *
 * The root cause: native confirm() is owned by the OS; on Windows
 * the renderer's keyboard-routing state gets corrupted when the OS
 * dialog hands focus back. The reliable fix is to never use a
 * native dialog — keep everything inside the renderer where React
 * controls the focus lifecycle and the OS never sees a separate
 * dialog window.
 *
 * # API
 *
 * `safeConfirm(message)` returns a Promise<boolean>. Caller awaits
 * the user's choice:
 *
 *   const ok = await safeConfirm('Discard the draft?');
 *   if (!ok) return;
 *
 * The dialog is rendered by `<ConfirmDialog />` mounted at the App
 * root. The two communicate via a singleton-pending request that
 * `useConfirmRequest()` subscribes to with `useSyncExternalStore`.
 * Multiple overlapping calls would clobber each other; we only
 * support one in-flight confirm at a time (same as the native
 * confirm()).
 */

import { useSyncExternalStore } from 'react';

export interface ConfirmRequest {
  /** The message shown to the user. */
  message: string;
  /** Callback to resolve the awaiting Promise. */
  resolve: (value: boolean) => void;
}

let current: ConfirmRequest | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

/**
 * Show a confirm dialog. Returns a Promise that resolves to `true`
 * if the user clicks OK / presses Enter, or `false` if they cancel
 * (Cancel button, backdrop click, or Esc).
 *
 * If a confirm is already in flight, the new call replaces it —
 * the previous Promise resolves to `false` so callers awaiting it
 * don't hang.
 */
export function safeConfirm(message: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    // Pre-empt any in-flight confirm — the new request supersedes
    // the old one. Caller of the old one gets a `false` so their
    // promise unblocks (treat as Cancel — they can't be sure the
    // old prompt is still relevant once a new one came up).
    if (current) {
      const prev = current;
      current = null;
      prev.resolve(false);
    }
    current = { message, resolve };
    notify();
  });
}

/**
 * Called by `<ConfirmDialog />` when the user picks OK / Cancel /
 * presses Esc / clicks the backdrop. Resolves the pending Promise
 * and clears the in-flight request so the dialog unmounts.
 */
export function resolveConfirm(value: boolean): void {
  if (!current) return;
  const { resolve } = current;
  current = null;
  notify();
  resolve(value);
}

/**
 * Hook for the modal component — subscribes to the singleton's
 * pending request so the modal re-renders when a new confirm
 * arrives or the current one is resolved.
 */
export function useConfirmRequest(): ConfirmRequest | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => current,
    () => null,
  );
}
