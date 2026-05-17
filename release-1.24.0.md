```sh
cd /Users/eimantaskudarauskas/Documents/Claude/Projects/inzone
npm run typecheck
npm run build
npm version 1.24.0 --no-git-tag-version
git add -A
git status
```

**Added:**
- Wiki pages open in-pane, not as a full-screen modal. Clicking a page from the Wiki tab now mounts a `WikiPagePane` inside the same framed area as the pane-host and preview-host (sibling of the swap stack, `z-index: 2` so it overlays whichever card is forward). Same chrome — `var(--bg)` fill, `var(--frame-border)`, 12px radius — so the wiki view reads as a member of the same 'main content' family as panes and preview. The agent transcripts underneath keep running; closing the wiki returns the user to whatever was forward before, untouched.
- Edit + close (×) buttons in the wiki page header. Top-right of the wiki pane. Edit toggles the CodeMirror Markdown editor (with optional vim mode); ⌘S saves while editing; Esc closes the pane (or cancels the edit when editing). The close button uses the same chip chrome as Edit — `var(--bg-elev)` fill, 6px radius, visible at rest as a clear target — but square so the × reads as an icon button.
- `wikiPagePath` runtime state in the store. Single source of truth for which wiki page is open. WikiSection's sidebar list, WikiPagePane's mount point in App.tsx, and the post-save dashboard refresh all read / write the same value. Project switches and mode resets clear it so an open page doesn't leak across sessions.

**Changed:**
- Save flow nudges the sidebar dashboard via a custom event. WikiPagePane dispatches `inzone:wiki-page-saved` after a successful write; WikiSection listens and refreshes its status / page list / recent-entries strip. Replaces the previous callback-prop pattern that no longer works now that the page view is mounted outside the WikiSection subtree.

**Fixed:**
- Wiki overlay no longer blocks preview / mode swaps. Previously the wiki-host's z-index sat above the swap stack, so pressing Preview / ⌘P with a wiki page open visibly did nothing (the preview slid in underneath). App.tsx now clears `wikiPagePath` the moment `paneViewMode` flips to 'preview' or `windowMode` changes — preview comes forward cleanly, and the Multi ↔ Lead toggle dismisses the wiki as part of the layout change.

```sh
git tag v1.24.0
git push origin main
git push origin v1.24.0
```
