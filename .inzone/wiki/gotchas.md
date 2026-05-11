# Gotchas

Landmines we've actually hit. Each gotcha records what bit us, why,
and how to avoid. Future agents who notice "huh, that's weird" should
check here first.

## Iterating `Object.values(panes)` kills cross-project sessions

The store keeps every project's panes warm in a single global
`panes` map (so transcripts persist across project switches).
`applyLayoutTemplate` and `applyTaskTemplate` originally iterated
`Object.values(panes)` and stopped every running agent — including
sessions in other projects the user couldn't even see. The fix
(landed pre-v1.9): always scope to `collectLeaves(currentTree)` only,
and preserve the other sessions' panes in `nextPanes`. **Never iterate
the panes map; always traverse the active tree.**

See [src/renderer/src/store.ts](../../src/renderer/src/store.ts) `applyLayoutTemplate` /
`applyTaskTemplate`.

## CSS variable scoping bites — `--pane-active-stripe` was on `.pane-header`

CSS custom properties cascade only to descendants of the element
that defines them. `--pane-active-stripe` was set on `.pane-header`
only, so the composer (a sibling of `.pane-header` inside the pane
root) couldn't read it and fell back to the global yellow accent.
Fix: define pane-scoped tokens on the pane root, not on a child.

When in doubt, define theme tokens at `:root` or on `.pane` itself.
Reach for `--pane-accent` (root-scoped) before `--pane-active-stripe`.

## `--bg-elev-1` was undefined → silently transparent across 12 components

Several components referenced `var(--bg-elev-1)` without a definition
or fallback, which CSS resolves to `unset` (transparent). Looked fine
on most surfaces because the parent already had a dark background;
showed up as a bug only when used somewhere parents weren't dark
(sticky thead bleed-through). Fix: always provide fallbacks
(`var(--token, #default)`) or define the token at `:root`.

Defined `--bg-elev-1: #14171c` at `:root`. **If you reach for a CSS
variable, grep first to confirm it's actually defined.**

## Sticky `<thead>`: `<tr>` backgrounds don't paint continuously

Setting `background` on a `<tr>` inside `position: sticky` `<thead>`
leaves transparent gaps between cells where the next row scrolls
through. Fix: put the background on each `<th>` instead. Same
applies to sticky table headers in agents/skills lists.

## React renders `inert={false}` as `"false"` — which still activates inert

React 18 stringifies boolean props on unknown DOM attributes. So
`<div inert={false}>` becomes `<div inert="false">` — the literal
string `"false"` is truthy in HTML attribute land, so the subtree
gets inert anyway. Fix: spread the prop conditionally —
`{...(open ? {} : { inert: '' })}`.

See [SettingsDrawer.tsx](../../src/renderer/src/components/SettingsDrawer.tsx).

## CSS Grid scrollable rows need `minmax(0, 1fr)`

`grid-template-rows: auto 1fr` doesn't actually let the `1fr` row
shrink below its intrinsic height. If its content is taller than
available space, the grid grows past the parent and overflow:auto
is meaningless. Fix: `minmax(0, 1fr)` lets the row shrink to fit,
which is what makes scroll containers work.

## Auto-scroll yanks user back from older context

The chat scroller used to auto-scroll on every new message,
including while the user was reading older context — felt like
the agent was wrestling for the scrollbar. Fix: only auto-scroll
when the user is already pinned (within 64px of bottom). When new
content arrives while scrolled up, show a "↓ Jump to latest" pill
that snaps back and re-pins.

See [Pane.tsx](../../src/renderer/src/components/Pane.tsx) `isPinnedRef` + `showJumpToBottom`.

## Auto-scroll falls behind streaming text (v1.9.0 fix had a hole)

The pin pattern above only re-scrolled when `pane.items.length`
changed — but during streaming, the agent grows an EXISTING
message's text. Same array length, more pixels. So once you'd
clicked "Jump to latest" we'd scroll once to current scrollHeight,
then content kept arriving below and we never re-scrolled. User
appeared stuck mid-message until the agent finished.

Fix (v1.10.0): wrap the messages in `.pane-scroller-content` and
attach a `ResizeObserver` to it. Whenever the wrapper's height
changes AND `isPinnedRef.current === true`, snap to bottom. Catches
streaming text, expanding tool blocks, late image loads, markdown
re-flow.

Also dropped `behavior: 'smooth'` in `jumpToBottom` — smooth-scroll
animations fire intermediate scroll events at non-bottom positions
which the pin detector reads as "user scrolled up", flipping the
pin off mid-animation. Instant scroll fires one event with
distance=0 → pinned stays true. The "Jump to latest" feel of
instant-snap is also better when chasing a live stream.

## Pane tabs got a stray vertical scrollbar

The selected-tab `::after` underline used `bottom: -1px`, which
counted as overflow on the tabs row and triggered a vertical
scrollbar even though tabs only scroll horizontally. Fix: explicit
`overflow-y: hidden` on `.pane-tabs`.

## Esc key closes modal AND drawer simultaneously

Both the editor modal and settings drawer attached window-level
`keydown` listeners for Esc. A single keypress fired both. Fix:
the drawer checks `useStore.getState().editor` first and skips the
close if a modal is on top. Layered Esc → modal first, drawer
second, drop the rest.

## Pane terminal lost when sibling closes

Closing a sibling pane in a 2-way split collapses the `split` node
to a `leaf`, changing the React fiber chain and triggering an
unmount/remount on the surviving pane. If the PTY + xterm lived
inside the React component, that "innocent" tree restructure would
kill the running CLI. Fix: pool PTY + xterm at module level
([terminal-sessions.ts](../../src/renderer/src/components/terminal-sessions.ts)). Component is responsible for
attach/detach (DOM moves only); destroy is explicit.

User reported losing 7 minutes of Codex session this way before the
pool existed.

## Inline-code with `white-space: nowrap` overflowed the chat

Yellow inline-code spans had `white-space: nowrap` which forced
long tokens (commit hashes, npm package names) to push past the
right edge. Fix: `overflow-wrap: anywhere; word-break: break-word`.

## Wiki update sentinel prevented agent-file refresh

The `bundled-resources` boot copied files into `~/.claude/agents`
once, then set a sentinel preventing future updates. New agents
shipped in INZONE updates wouldn't appear. Fix: drop the sentinel,
do a per-file existence check on every boot.

## WebGL addon must load AFTER `term.open()`

`@xterm/addon-webgl` needs the terminal to be in the DOM to acquire
its WebGL context. Loading it before `open()` silently does nothing
or throws depending on the platform. Always: `term.open(host)` first,
`term.loadAddon(webgl)` second. (v1.10 wiring.)

## Resize handles steal pointer events from in-pane popovers

The pane's ⋮ more-menu used `position: absolute` + `z-index: 30`
anchored inside the pane. That z-index only applied within the
pane's stacking context — `react-resizable-panels` renders its
`PanelResizeHandle` as a DOM sibling AFTER the panel, so the handle
always stacked above the menu in the outer (PanelGroup) context.
The handle's tiny hit-zone happens to fall right where menus tend
to land — most visibly in terminal panes which are usually compact
— so hovering the bottom menu item silently triggered the handle's
hover instead.

Fix (v1.10.2): portal the menu to `document.body` and switch to
`position: fixed` with viewport-relative coords from
`triggerRef.getBoundingClientRect()`. The menu escapes the pane's
stacking context entirely. Click-outside has to check both the
trigger ref AND the menu ref now since the menu is no longer a DOM
descendant of the trigger.

Lesson: any popover anchored inside a `react-resizable-panels`
panel needs to portal out. Same applies to tooltips, comboboxes,
date pickers — any floating overlay.

See [Pane.tsx](../../src/renderer/src/components/Pane.tsx) `PaneMoreMenu` and
[TerminalPane.tsx](../../src/renderer/src/components/TerminalPane.tsx) `TerminalPaneMenu`.

## `require()` is undefined in the ESM main process

The app's main entry is `out/main/index.mjs` — ESM. In ESM scope,
`require` doesn't exist as a global. Calling `require('fs')` throws
`ReferenceError: require is not defined`. v1.10.0's voice-key
migration had two `require('fs').mkdirSync/writeFileSync` calls
wrapped in nested try-catches; both threw, both got swallowed,
migration silently failed for every upgrader. They only noticed
when a subsequent save wiped their plaintext key and voice broke.

Lesson: never sneak a `require()` into main-process code without
verifying it's ESM-safe. Either import the function statically, or
use `await import()` if you really need a dynamic import. Static
imports for sync `fs` functions:

```ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { promises as fs } from 'fs';  // async versions
```

Fixed in v1.10.2.

## Wipe-before-write loses user data

The v1.10.0 `saveVoiceSettings` ran:

```ts
store.set('voice', { agentId });          // wipes plaintext apiKey
void writeStoredApiKey(next.apiKey);      // async, fire-and-forget
```

Two failure modes: (1) if the async encrypted write rejected, the
user lost their key because the JSON wipe had already happened;
(2) the IPC handler returned success before the write completed,
so the renderer's "Saved!" toast was a lie. v1.10.2 reorders:
`await` the encrypted write FIRST, only then mutate the store —
and the IPC handler awaits the full chain so the renderer sees
the actual result.

Lesson: any "migrate from old storage to new storage" code must
always succeed at writing the new home before clearing the old.
Order matters: write-new → verify → delete-old. Never the other
way around.

## Not every recommended-skill repo ships a SKILL.md

The original install logic assumed every recommended-skill repo
shipped a `SKILL.md` at its root (or at `subPath`). It bailed out
when the file was missing. Reasonable assumption for repos that
*are* Claude skills — but plenty of useful community repos are
raw-resource collections (DESIGN.md catalogues, template
libraries, prompt collections) where the wrapping into a Claude
skill is INZONE's job, not the source repo's.

Hit this with VoltAgent/awesome-design-md, a collection of
DESIGN.md files extracted from 30+ real websites. No SKILL.md
anywhere. Fix (v1.11.1): added a `generateSkillMd` field on
`RecommendedSkill` — when set, the install flow generates a
SKILL.md wrapper at the install target's root that tells Claude
how to navigate the bundled resources. The frontmatter follows
the Claude Code skill format so the SDK picks it up the same way
as a hand-authored skill.

Lesson: don't assume external repos conform to a structure you
control. Always have a "wrap it up for us" escape hatch.

## `keytar` is a trap

Tempting to reach for `keytar` for secrets, but it's deprecated and
breaks across Electron major versions because of native bindings.
Use Electron's built-in `safeStorage` instead — same OS-keychain
target, no native module to fight. See
[[decisions/safestorage-over-keytar]].

## Sources

- Conversation log v1.5 → v1.10 — every gotcha here was actually hit
- [src/renderer/src/store.ts](../../src/renderer/src/store.ts) — pane scoping fix
- [src/renderer/src/index.css](../../src/renderer/src/index.css) — CSS variable fixes, sticky thead, grid rows
- [src/renderer/src/components/SettingsDrawer.tsx](../../src/renderer/src/components/SettingsDrawer.tsx) — inert + Esc layering
- [src/renderer/src/components/Pane.tsx](../../src/renderer/src/components/Pane.tsx) — auto-scroll pin
- [src/renderer/src/components/terminal-sessions.ts](../../src/renderer/src/components/terminal-sessions.ts) — pool design
- [src/renderer/src/components/TerminalPanel.tsx](../../src/renderer/src/components/TerminalPanel.tsx) — WebGL ordering
- Wiki: [[architecture]], [[decisions/safestorage-over-keytar]]
