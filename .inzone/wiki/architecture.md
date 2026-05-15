# Architecture

INZONE is an Electron app — main + preload + renderer — that
orchestrates multiple Claude Agent SDK sessions running side by side
in resizable panes. This page covers the top-level shape so future
agents know where to look before changing things.

## Process layout

- **Main** ([src/main/](../../src/main/)) — the privileged side. Owns the Agent SDK
  sessions, PTY pool, MCP server configs, file watchers (chokidar),
  electron-store persistence, secrets via `safeStorage`, IPC handlers,
  auto-updater. Anything that talks to the network or filesystem
  lives here.
- **Preload** ([src/preload/index.ts](../../src/preload/index.ts)) — the bridge. Exposes a
  typed `window.cowork` surface (the `CoworkApi` interface in
  [src/shared/cowork-api.ts](../../src/shared/cowork-api.ts)) — namespaced bundles
  (`agents`, `skills`, `mcp`, `voice`, `editorPrefs`, `terminal`,
  `wiki`, etc.). Each namespace turns into `ipcRenderer.invoke` /
  `.on` calls against channels declared in
  [src/shared/ipc-channels.ts](../../src/shared/ipc-channels.ts).
- **Renderer** ([src/renderer/src/](../../src/renderer/src/)) — React 18 + Zustand store.
  Single source of truth in [store.ts](../../src/renderer/src/store.ts), components in
  [components/](../../src/renderer/src/components/), all CSS in [index.css](../../src/renderer/src/index.css)
  (no CSS modules; vanilla CSS with custom-property tokens at
  `:root`).

Bundling: `electron-vite` with three Vite configs (main / preload /
renderer) wired in [electron.vite.config.ts](../../electron.vite.config.ts).

## Pane model — leaves and splits

A workspace has one **tree** of panes. The tree is a binary recursion
of `split` and `leaf` nodes, rendered with `react-resizable-panels`.

- A **leaf** = one pane = one session of one agent (chat) OR one
  PTY (terminal). The store keeps a `panes: Record<PaneId, ...>`
  map of runtime state for every leaf across **every project** —
  this is what lets sessions stay warm when you switch projects
  (the agent keeps running in the background; the renderer just
  isn't displaying it). Closing the project doesn't kill the
  pane; only `closePane` does.
- A **split** has two children + an orientation (`row` or `column`)
  + a size ratio. Resizing a divider mutates the ratio in place.
- The **active pane** is the one that receives keyboard focus,
  composer input, and the status-bar's per-pane controls.
- The **lead pane**, when present, is the orchestrator in Lead Agent
  mode — receives CLAUDE.md memory and dispatches sub-agents into
  the other panes.
- The **focused pane** is the pane currently fullscreened by the
  pane-tabs bar (Cmd+F or clicking a pane tab); null = "All" view.

Every operation that mutates the tree must use `collectLeaves(tree)`
to find the *current session's* leaves rather than iterating
`Object.values(panes)` — see [[gotchas]] for why this matters.

## Session lifecycle (chat panes)

1. User drags an agent onto a pane → `setPaneAgent(paneId, agent)`.
2. `SessionPool.start({ paneId, agentDef, cwd, ... })` spawns a
   Claude Agent SDK process in the main process, wires the input /
   output / event streams.
3. Renderer subscribes to `session:event` IPC pushes and writes
   them into the pane's transcript in the store.
4. On project switch, the SDK process keeps running; the renderer
   just stops rendering the pane until the session is reactivated.
5. `closePane` or `stopSession` tears down the SDK process, drops
   the pane from the tree, prunes runtime state.

The SDK process is JavaScript-only — that constrains us to Electron;
see [[decisions/electron-over-tauri]].

## Terminal lifecycle (terminal panes + bottom dock)

Two parallel stacks:

- Bottom-dock terminal — [TerminalPanel.tsx](../../src/renderer/src/components/TerminalPanel.tsx).
  Single PTY per window, lazy-mounted on first open, follows the
  active session's cwd, persists scrollback while panel is closed.
- Per-pane terminals — [TerminalPane.tsx](../../src/renderer/src/components/TerminalPane.tsx)
  + [terminal-sessions.ts](../../src/renderer/src/components/terminal-sessions.ts). One PTY per pane,
  pooled at module level so a sibling-pane close (which causes a
  React unmount/remount) doesn't kill the running CLI. PTY +
  xterm instance survive React tree restructures.

Main-process PTY backend: `@homebridge/node-pty-prebuilt-multiarch`
in [src/main/terminal.ts](../../src/main/terminal.ts).

Both stacks load `@xterm/addon-webgl` for GPU-accelerated rendering
(v1.10) with graceful canvas2d fallback.

## State model (Zustand store)

[store.ts](../../src/renderer/src/store.ts) is monolithic on purpose — slices for sessions,
windows, workspaces, panes, agents, skills, MCP, voice, layouts,
tasks, custom task templates, focused pane, file-tree state. Cross-
slice transactions (e.g. switching session = stop active panes,
restore other session's panes, fix activePane, fix lead, fix focused)
need to mutate together; multiple stores would make that worse.

Persisted parts mirror onto disk via `state:saveWindow` and
friends → main-process [persistence.ts](../../src/main/persistence.ts) → electron-store.
Runtime-only parts (pane runtimes, scroll positions, focused pane)
never persist.

## Lead Agent mode

When `windowMode === 'lead'`, one pane (the lead) receives the
project's CLAUDE.md memory and acts as orchestrator; spawns
sub-agents into the other panes via `pane:spawn` IPC (main →
renderer). Sub-agents are scoped — they don't see CLAUDE.md, only
the specific task the lead delegates. See [MemorySection.tsx](../../src/renderer/src/components/settings/MemorySection.tsx)
for the user-facing toggle.

## Slash commands

Composer-level prompt expansion (since v1.18.0). The `/` button
in the composer toolbar opens a picker
([SlashCommandPicker.tsx](../../src/renderer/src/components/SlashCommandPicker.tsx))
listing every available command for the active pane's project.
Three sources merged in priority order (project > user >
builtin, deduped by name) via `mergeCommands()` in
[shared/builtin-commands.ts](../../src/shared/builtin-commands.ts):

1. `<cwd>/.claude/commands/*.md` (project-scoped)
2. `~/.claude/commands/*.md` (user-global)
3. Five hardcoded starters (`/plan`, `/think`, `/review`,
   `/explain`, `/test`)

Main-process enumeration in [src/main/commands.ts](../../src/main/commands.ts)
parses each markdown file with `gray-matter` — frontmatter
`description` becomes the picker subtitle, body becomes the
prompt template with `$ARGUMENTS` as the user-text substitution
point. New IPC channel `COMMANDS_LIST` + bridge
`window.cowork.commands.list({ cwd })`. The renderer caches
nothing — re-fetches on every picker open so commands you just
dropped into the folder appear without a restart.

Picking a command mounts a removable badge above the textarea
(handled in [Pane.tsx](../../src/renderer/src/components/Pane.tsx)).
On send, `expandCommand(cmd, userText)` substitutes
`$ARGUMENTS` (or appends the user text on a new line if the
template has no placeholder) and submits one coherent prompt to
the agent. Agent panes only — terminal panes (Claude Code /
Codex / Aider / Gemini) handle slash commands natively in the
PTY, so the `/` button doesn't appear there.

## Composer responsive layout

Pane width drives composer geometry via CSS container queries
declared on `.pane-composer` (`container-type: inline-size;
container-name: composer;`). Two breakpoints:

- **≤ 480px** — switches from inline flex to a two-row grid
  (slash + paperclip top-left, send + expand top-right, textarea
  full-width below). Send button collapses to icon-only.
- **≤ 220px** — same grid, smaller buttons (26×26) and tighter
  gaps.

The `.pane` itself also has `container-name: pane;` so a
companion query at ≤ 500px hides the emoji avatar and the
agent-name slug chip from the header (the agent name is already
in the sidebar list). Placeholder text (which CSS can't rewrite)
is swapped in React via a `ResizeObserver` on the pane root —
the `isNarrow` flag flips at < 500px to match the layout shift.

Specificity note: every selector inside the `@container`
queries is prefixed with `.pane-composer` to push from (0,1,0)
to (0,2,0). The base `.composer-row { display: flex }` rule
lives later in the file; without the bump, cascade order makes
the flex rule win regardless of container width. Filed as a
gotcha in [[gotchas]] (`@container rule placement vs cascade
order`).

## Wiki feature

The wiki this page lives in is itself a feature shipped by INZONE.
Implementation: [src/main/wiki.ts](../../src/main/wiki.ts) (CRUD with hard path-traversal
guards, search, init/scaffold). Renderer: WikiSection + WikiPageModal.
Voice agent has `list_wiki_pages`, `read_wiki_page`, `search_wiki`
tools so users can ask spoken questions about their codebase
grounded in the wiki — see [src/renderer/src/voice/](../../src/renderer/src/voice/).

## Sources

- [src/main/index.ts](../../src/main/index.ts) — boot sequence
- [src/main/sessions.ts](../../src/main/sessions.ts) — SessionPool + Agent SDK lifecycle
- [src/main/terminal.ts](../../src/main/terminal.ts) — PTY pool
- [src/main/persistence.ts](../../src/main/persistence.ts) — electron-store mapping
- [src/renderer/src/store.ts](../../src/renderer/src/store.ts) — Zustand slices
- [src/renderer/src/components/Pane.tsx](../../src/renderer/src/components/Pane.tsx),
  [TerminalPane.tsx](../../src/renderer/src/components/TerminalPane.tsx),
  [terminal-sessions.ts](../../src/renderer/src/components/terminal-sessions.ts)
- [src/shared/ipc-channels.ts](../../src/shared/ipc-channels.ts) — every IPC channel
- [src/shared/cowork-api.ts](../../src/shared/cowork-api.ts) — preload bridge type
- [src/main/commands.ts](../../src/main/commands.ts) — slash-command enumerator
- [src/shared/builtin-commands.ts](../../src/shared/builtin-commands.ts) — builtins + mergeCommands + expandCommand
- [src/renderer/src/components/SlashCommandPicker.tsx](../../src/renderer/src/components/SlashCommandPicker.tsx)
- [src/renderer/src/components/SegmentedToggle.tsx](../../src/renderer/src/components/SegmentedToggle.tsx)
- Wiki: [[gotchas]], [[glossary]], [[decisions/electron-over-tauri]]
