```sh
cd /Users/eimantaskudarauskas/Documents/Claude/Projects/inzone
npm run typecheck
npm run build
npm version 1.21.0 --no-git-tag-version
git add -A
git status
```

**Added:**
- Inline Preview pane — swap, don't pop. The Preview button used to open a modal over the workspace; now the pane area is a two-card stack and the button swaps which card is forward. Pane-host slides off-screen left, preview-host slides in from the right (320ms cubic-bezier ease, full swap — no peek lane, no overlay). The two cards share the same frame chrome so they read as a matched pair. Swap state is per-session and lives in the runtime store; no persistence (next launch starts on panes). The preview card only renders when at least one localhost URL is available — without a URL, the stack is just the pane-host filling the width.
- Browser-grade preview toolbar. The PreviewPane card has a proper top bar — back / forward / reload / address field / zoom group / mobile-viewport toggle / auto-reload toggle / devtools / open-in-browser / close. The address field shows the live `<webview>` URL and lets you type a new one to navigate.
- Mobile viewport simulator. Toggle on the toolbar pins the webview to a 375px-wide column centred in the body with a rounded device-frame shadow. White page background inside the frame so mobile-optimised pages render against a phone-like surround rather than the dark app chrome.
- Zoom controls + keyboard shortcuts. Seven-step zoom (-3…+3 mapped to Electron `setZoomLevel`) with a +/−/percent group in the toolbar. ⌘+ / ⌘− step zoom in/out, ⌘0 resets to 100% — the same shortcuts a real browser uses. Hotkeys only fire while the preview is forward and focus is outside a text input, so they don't fight composer editing.
- Reload-on-save. When auto-reload is toggled on, a chokidar watcher in the main process watches the project folder for changes to source files (`html`, `js`, `jsx`, `ts`, `tsx`, `mjs`, `cjs`, `css`, `scss`, `sass`, `less`, `vue`, `svelte`, `astro`) and tells the renderer to reload the webview when one changes. `awaitWriteFinish` with an 80ms stability threshold debounces the burst of writes that bundlers emit during a single save. `node_modules`, `.git`, `dist`, and `build` are ignored. Watch starts and stops with the toggle, so it costs nothing when off.
- Open devtools inline. Devtools button in the preview toolbar opens Chromium devtools for the webview's renderer process — same panel you'd get with ⌘⌥I in a real browser. Toggle button reflects open/closed state.
- Esc swaps back to panes. While the preview is forward and focus is outside a text input, Esc flips `paneViewMode` back to panes (same animation as the button). ⌘R reloads the webview while preview is forward.

**Changed:**
- Preview button is a card-swap, not a modal launcher. The button in the workspace bar now toggles between 'Preview' and 'Panes' labels depending on which card is forward, and clicking swaps the stack instead of opening a modal. Port number chip dropped from the button label — the URL still lives in the preview pane's address field, where you actually need it. Multi-URL dropdown still works (picks which URL the preview pane will show).
- PreviewPane is unmounted when you're not looking at it. The `<webview>` tag spawns a full Chromium renderer process per instance, plus whatever the loaded page brings (timers, websockets, HMR). To keep idle resource usage near zero, the PreviewPane component now mounts only while `paneViewMode === 'preview'`. Unmount is delayed by 340ms (the slide-out animation duration plus a small buffer) so the card animates away with its contents still visible, then React tears down the renderer process. Swap-back-within-340ms cancels the pending unmount so the existing webview stays alive. Trade-off: re-entering preview re-loads the page from scratch each time, which is preferable to background memory drain.
- Replaced PreviewModal with PreviewPane. The old full-page modal is gone — preview now lives inline in the pane area as the swap-card sibling of pane-host.

**Fixed:**
- Webview no longer clips to ~350px on certain sites. The previous `position: absolute; inset: 0; width: 100%; height: 100%` recipe on the `<webview>` element conflicted with the inline pixel styles the in-process ResizeObserver was writing, producing a clamped render that didn't fill its body. Switched to the Electron-recommended flex pattern: `.preview-body` is `display: flex`, `.preview-webview` is `flex: 1` with `min-height: 0` / `min-width: 0` so it shrinks-and-grows naturally. The ResizeObserver was removed entirely.
- Pane-preview stack stays inside its grid cell. The earlier `height: 100%; align-self: stretch` on the stack pushed it past the bottom of the body because the parent grid's implicit row had no explicit `1fr`. Added `grid-template-rows: 1fr` to `.body` so the cell sizes to the available space, then dropped the redundant height/stretch on the stack. Stack now hits the same 20px bottom inset as the sidebar.

```sh
git tag v1.21.0
git push origin main
git push origin v1.21.0
```
