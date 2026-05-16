```sh
cd /Users/eimantaskudarauskas/Documents/Claude/Projects/inzone
npm run typecheck
npm run build
npm version 1.22.0 --no-git-tag-version
git add -A
git status
```

**Added:**
- ⌘S toggles the Settings drawer. New app-wide shortcut that opens Settings to the Profile section if it's closed, or closes the drawer if it's already open. Skipped when focus is inside a text input or CodeMirror surface so the wiki editor's existing ⌘S-save still wins there. Implemented as a custom event (`inzone:toggle-settings`) fired from App.tsx and handled inside WorkspaceBar so the drawer's open-state stays local to its owner component.
- ⌘M toggles Multi Agents ↔ Lead Agent mode. Same gesture as clicking the segmented switch in the workspace bar. Gated on having a project open so the toggle doesn't fire on the empty 'pick a folder' screen. Trade-off: this overrides macOS's built-in ⌘M minimize-window shortcut while INZONE is focused — the Shortcuts reference notes that the yellow traffic-light button or ⌘H still hides the window.
- Settings → Shortcuts reference updated. New ⌘S and ⌘M rows. The ⌘P row's copy was rewritten from 'Open the Preview window for the active session' (legacy modal language) to 'Swap between panes and preview' with a context note clarifying that the same shortcut works both ways — first press swaps to preview, second press swaps back.

**Fixed:**
- Review diff bands were invisible on the light paper theme. The dark-theme rules used a 10% rgba green/red tint with pastel text — fine against the dark slate background, almost unreadable on the cream paper. Added a `:root.theme-light` override: added lines get an `rgba(34, 134, 58, 0.16)` band with dark green `rgb(15, 70, 30)` text, removed lines get an `rgba(190, 50, 55, 0.14)` band with dark red `rgb(110, 22, 28)` text. Both get a 3px inset accent rail on the left edge so the side-bar is visible from a glance even on a small monitor. Context lines also picked up a warmer text colour against the paper.
- Flow canvas arrows were white-on-cream in light mode. The bezier paths, anchor dots, and arrowhead were inline-styled `rgba(255, 255, 255, …)` — inline SVG fill/stroke attributes beat any CSS rule, so the existing theme system couldn't reach them. Converted to CSS classes (`.flow-edge`, `.flow-edge-anchor`, `.flow-arrow-head`); dark theme keeps the old white values, light theme overrides with an ink ramp (`rgba(60, 50, 38, …)`) so the connectors read against the paper.

```sh
git tag v1.22.0
git push origin main
git push origin v1.22.0
```
