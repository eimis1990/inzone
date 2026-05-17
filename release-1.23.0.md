```sh
cd /Users/eimantaskudarauskas/Documents/Claude/Projects/inzone
npm run typecheck
npm run build
npm version 1.23.0 --no-git-tag-version
git add -A
git status
```

**Added:**
- INZONE24 brand wordmark. The wordmark next to the logo (and the empty-state hero) now renders as `INZONE` + an accent-coloured `24` — yellow-amber on dark, terracotta on light. Implementation is a `<span class="wb-wordmark-accent">24</span>` inside the existing wordmark so letter-spacing inherits and the two halves read as one continuous mark. HTML `<title>` also updated to `INZONE24`. `productName` and `appId` in package.json are unchanged — installed builds keep updating through electron-updater normally, and future DMGs still build under the existing bundle name.
- Theme-tuned empty-state placemark + sidebar brick pattern. Two new placemark PNGs ship in the renderer assets folder (`inzone-placeholder-dark.png`, `inzone-placeholder-light.png`), and two new SVG tiles built from them (`sidebar-pattern-dark.svg`, `sidebar-pattern-light.svg`). The pane empty-state renders both `<img>` variants with `pane-empty-mark-dark` / `pane-empty-mark-light` classes — CSS hides whichever doesn't match the active theme (same recipe as AppLogo). `.sidebar-host::before` picks the matching pattern via a `:root.theme-light` override. Sidebar opacity is now tuned per theme — `0.4` on dark, `0.8` on light — because the light placemark's paper-toned glyphs need much more alpha to read against the warm canvas than the dark placemark needs against black.

**Changed:**
- Removed the manual refresh button from the Agents section header in the sidebar. The auto-watcher already picks up new files in `~/.claude/agents/` without a manual prompt, so the little reload glyph next to the count chip was noise. The `WorkerSectionHeader` component still accepts `onRefresh` / `refreshing` props (other sections may want it), but the AgentSidebar no longer wires them. Stripped the now-dead `refreshingAgents` state and `handleRefreshAgents` callback from AgentSidebar.tsx.

**Fixed:**
- Light-theme agent cards in the sidebar Workers list. The shared `--surface-tile` token resolved to `#FDFAF0` (paper-50), which differs from the body's `#F9F4E6` (paper-100) by only ~4 units per channel — the cards read as floating 'whitish' tiles against the cream paper. Light-theme override now puts agent cards at `#F1E9D2` (paper-200) with a `#E6DBB8` (paper-300) hairline border; hover deepens to `#E6DBB8` / `#C9B98A`. Cards now read as contained cells.
- Light-theme wiki page rows. Rows were fully transparent over the sidebar background so the brand-pattern bled through behind the names. Light-theme override gives each row a paper-200 fill, a paper-300 border, and a 4px bottom margin so they read as contained cells. Hover / active states match the agent-card recipe.
- Light-theme sidebar pattern was nearly invisible. Multiple attempts at lower alpha (0.10, then 0.18) all washed out against the cream canvas because the light placemark is paper-toned glyphs on paper — it's low-contrast by design. Final tuning: `0.4` for dark, `0.8` for light. Each value matches the visual weight the previous mark had at 0.18 against its respective canvas.

```sh
git tag v1.23.0
git push origin main
git push origin v1.23.0
```
