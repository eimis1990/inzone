/**
 * Drop-in replacement for `window.confirm()` that fixes a
 * Windows-specific focus bug in Electron.
 *
 * # The bug
 *
 * After a native `confirm()` dialog dismisses on Windows, the
 * renderer can end up in a "phantom focus" state — `document.
 * activeElement` points at some element, but the OS-level keyboard
 * focus isn't actually routed to it, so keystrokes go nowhere.
 *
 * Reproducer:
 *   1. Type into Pane A's composer textarea.
 *   2. Click into Pane B.
 *   3. ⋮ → "Clear conversation" → confirm.
 *   4. Click back into Pane A.
 *   5. Pane A's textarea won't take any keystrokes.
 *
 * Workaround the user found: open the file-picker (attachment
 * button) and dismiss it — that native dialog "unsticks" the
 * focus state, and keystrokes start working again.
 *
 * # The fix
 *
 * Right after `confirm()` returns, blur whatever document.
 * activeElement is (releasing its phantom claim) and nudge
 * `window.focus()` to make sure the renderer is the OS-focused
 * window. The next click / focus event then routes correctly.
 *
 * macOS / Linux aren't affected by the bug but the helper is a
 * no-op on those platforms — blurring nothing is harmless.
 */
export function safeConfirm(message: string): boolean {
  const ok = window.confirm(message);
  // Schedule the focus restore on the NEXT animation frame so any
  // React state updates queued by the confirming click have a chance
  // to commit first. Without the RAF, blurring fires while the
  // active element is still mid-flux and the workaround misses.
  requestAnimationFrame(() => {
    try {
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae instanceof HTMLElement) {
        ae.blur();
      }
      window.focus();
    } catch {
      // Best-effort; never throw out of a workaround.
    }
  });
  return ok;
}
