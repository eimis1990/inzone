# INZONE — Architecture & Internals

This is a working reference for whoever (you, me on a clean session,
another agent) needs to understand how INZONE is wired together so they
can extend it without breaking things. If you're reading this for the
first time, skim the **Stack & process model** section, then the
**State management** section. The rest is sub-system deep-dives you
can dip into when touching that area.

---

## Stack & process model

INZONE is an **Electron** app built with **electron-vite**. It uses three
processes (the standard Electron split) plus the third-party Claude
Code subprocess that the SDK spawns.

```
                                ┌────────────────────────────────────┐
                                │   Electron BrowserWindow (1 only)  │
                                ├────────────────┬───────────────────┤
   main process                 │  preload       │   renderer        │
   (Node, ESM, .mjs)            │  (CommonJS)    │   (React + Vite)  │
   ┌──────────────────┐         │  ┌──────────┐  │   ┌────────────┐  │
   │ ipc handlers     │◀────────┼──│ contextBridge ────│ window.cowork.* │
   │ pty pool         │         │  │   .invoke()│  │   │            │  │
   │ session pool     │         │  └──────────┘  │   │  Zustand store ◀── components
   │ agents/skills FS │         │                │   │            │  │
   │ persistence      │         │                │   └────────────┘  │
   └────────┬─────────┘         │                │                   │
            │                   └────────────────┴───────────────────┘
            │
            ▼  spawn (per pane)
   ┌──────────────────────────────────────────┐
   │  Claude Code CLI subprocess              │
   │  (from @anthropic-ai/claude-agent-sdk)   │
   │  ─ runs the actual Claude turn           │
   │  ─ talks to Anthropic API                │
   │  ─ streams tool_use/result/text events   │
   └──────────────────────────────────────────┘
```

- **Main bundle is ESM** (`out/main/index.mjs`). This was needed because
  the Claude Agent SDK is ESM-only. There's a `__dirname` shim from
  `import.meta.url` near the top of `src/main/index.ts`.
- **Preload** is the only place that wires `contextBridge`. The renderer
  only ever talks to main through `window.cowork.*` calls defined in
  `src/preload/index.ts`. There is no direct main↔renderer access.
- **Renderer** never imports Node modules directly. Everything that needs
  the OS goes through IPC.

### Source layout

```
src/
├── shared/                 — types/IPC channels seen by all 3 processes
│   ├── types.ts            — AgentDef, WindowState (= Session), AppState, ...
│   ├── ipc-channels.ts     — string constants for ipcMain/ipcRenderer
│   ├── cowork-api.ts       — TS interface for the preload bridge
│   └── palette.ts          — agent colors + Anthropic model lists
├── main/                   — electron main process
│   ├── index.ts            — BrowserWindow, app lifecycle
│   ├── ipc.ts              — registerIpcHandlers() — every IPC handler
│   ├── sessions.ts         — SessionPool: spawns/manages Claude SDK queries
│   ├── agents.ts           — discover/parse/save/delete agent + skill .md files
│   ├── persistence.ts      — electron-store wrapper + transcripts on disk
│   ├── session-store.ts    — per-pane SDK session id (for resume)
│   ├── memory.ts           — CLAUDE.md read/write/compose
│   ├── lead-tools.ts       — in-process MCP server for Lead orchestrator
│   ├── mcp-config.ts       — read/write ~/.claude.json + <cwd>/.mcp.json
│   ├── voice.ts            — ElevenLabs settings + signed-URL minting
│   ├── terminal.ts         — node-pty pool
│   ├── terminal-shortcuts.ts — electron-store wrapper for terminal shortcuts
│   ├── usage.ts            — append-only ledger for cost telemetry
│   ├── async-queue.ts      — async iterator queue (used by SessionController)
│   └── agent-generator.ts  — one-shot Claude call to draft an agent prompt
├── preload/index.ts        — bridge: ipcRenderer.invoke wrappers exposed
│                             on `window.cowork`
└── renderer/src/
    ├── App.tsx             — top layout, ConversationProvider for ElevenLabs
    ├── store.ts            — single Zustand store, all UI state
    ├── components/         — React UI
    │   ├── AgentSidebar    — three-tab sidebar (Sessions, Agents, Voice)
    │   ├── SessionsList    — sessions tab content
    │   ├── VoiceSection    — voice tab content (orb + mic)
    │   ├── Pane            — one chat pane (header + transcript + composer)
    │   ├── PaneTree        — recursive split layout via react-resizable-panels
    │   ├── Message         — render one chat item (user/assistant/tool_block/result)
    │   ├── Markdown        — react-markdown wrapper with rehype-highlight
    │   ├── EditorModal     — agent + skill editor (CodeMirror)
    │   ├── SettingsDrawer  — sliding right-side drawer with sub-sections
    │   ├── settings/*      — one section per Settings tab
    │   ├── PreviewButton   — floating Preview FAB on pane host
    │   ├── PreviewModal    — 16:10 webview overlay
    │   ├── TerminalPanel   — bottom dock: bar + xterm overlay
    │   └── WorkspaceBar    — top bar (folder pill, mode, cost chip, Settings, ...)
    ├── voice/
    │   ├── useVoiceAgent.ts — hook wrapping @elevenlabs/react useConversation
    │   └── toolSchemas.ts   — system prompt + tool definitions for the voice agent
    └── index.css           — single stylesheet (intentional — easy to grep)
```

---

## State management

### One Zustand store

The renderer uses a single Zustand store at `src/renderer/src/store.ts`.
There are no separate slices, no Redux-style reducers. The store has:

- **Top-level fields representing the currently active session.** `cwd`,
  `tree`, `windowMode`, `leadPaneId`, `memoryScope`, `previewUrl`,
  `windowId`. These are what most components read.
- **`sessions: WindowState[]`** — the full list of saved sessions. The
  `windowId` always equals the active session's id.
- **`panes: Record<paneId, PaneRuntime>`** — every pane's runtime state
  (status, items, error, ...) keyed by paneId. Includes panes from
  every session, not just the active one. Inactive sessions' panes
  exist here but aren't rendered.
- Various UI flags (`previewOpen`, `sidebarCollapsed`, `editor`, …).

### Why this structure

Top-level fields mirror the active session because *most components
were written before sessions existed*. Keeping the active session's
state at the top-level meant we could add multi-session without
rewriting every reading component. The `sessions` array is the
persisted truth; top-level fields are a "view" into the active entry.

When the user calls `switchSession(id)`:
1. `snapshotActive()` writes the current top-level state back into the
   matching `sessions[]` entry (including `previewUrl`).
2. The target session's fields are loaded into the top-level slots.
3. Any pane in the target session that hasn't been hydrated yet
   (status === 'idle' with an agent name) is lazy-bound by calling
   `setPaneAgent` for it. This is what triggers "starting…" briefly
   on first switch.

### Concurrency in setPaneAgent

Voice tools may dispatch parallel `add_pane_to_session` calls. Both end
up calling `setPaneAgent` concurrently, each with its own `panes`
closure captured before its `await loadTranscript`. The second call's
`set({ panes: { ...closure_panes, ... } })` would clobber the first
call's pane binding.

**Fix is in place**: `setPaneAgent` uses the *function form* of `set()`
— `set((s) => ({ panes: { ...s.panes, ... } }))` — so each update
merges against the latest store state instead of a stale closure.
**Don't regress this** — leave the function form in place for any
async setter that touches a Record-typed field.

---

## Agent + Skill discovery

`src/main/agents.ts` watches `~/.claude/agents/` and `~/.claude/skills/`
via `chokidar` and parses each markdown file with `gray-matter`. Project
scope (`<cwd>/.claude/agents/`) is also scanned when a workspace is
open; project entries override user entries on name collision.

Frontmatter shape (see `parseAgentFile`):

```yaml
---
name: my-agent              # required
description: ...
model: claude-sonnet-4-6    # alias or dated id
tools: [Bash, Read, Write]  # optional allowlist
skills: [docx, pdf]         # optional skill subset
mcpServers: [context7]      # optional MCP opt-in (per-agent)
color: sky                  # 12-color palette name
---
```

The `body` of the markdown becomes the agent's system prompt addendum.

When the user edits an agent in INZONE, `serializeAgent()` writes only
the non-default frontmatter fields (e.g. omits `provider` since
INZONE is Anthropic-only). Renaming an agent moves the file.

The chokidar watcher triggers `IPC.AGENTS_WATCH` events; the renderer
calls `refreshAgents()` to repopulate.

---

## Sessions & SDK plumbing

### SessionPool

`src/main/sessions.ts` exports `SessionPool` (one global instance,
created in `ipc.ts`). It maps `paneId → IAgentSession` (currently only
the Anthropic SessionController). When a renderer asks to `start` a
pane:

1. Reads the agent definition by name.
2. Builds the system prompt (agent body + skills block + memory block
   + multi-agent coordination block).
3. Resolves opted-in MCP servers via `buildSdkMcpMap()` filtered by
   `agent.mcpServers`.
4. Resumes the saved Claude SDK session id from `session-store.ts` if
   one exists AND the agent name matches AND the MCP opt-in set
   matches (otherwise starts fresh — see "Resume invalidation" below).
5. Calls `query()` from `@anthropic-ai/claude-agent-sdk` with the
   options assembled. The SDK spawns a Claude Code CLI subprocess
   under the hood and streams events back.
6. Pumps the async iterator: each event becomes a `SessionEvent`
   broadcast to the renderer over IPC.

### Resume invalidation

`session-store.ts` persists `{ paneId, agentName, sdkSessionId,
mcpServers, model, updatedAt }` per pane. On session start we resume
the saved id only if both `agentName` AND the MCP opt-in set match.
If they differ, we drop the saved session and start fresh.

This avoids the SDK silently using the original session's tool
topology when the agent's MCP opt-ins changed (the SDK doesn't refresh
tool sets on resume — see the upstream issue tracked in the comment
near `effectiveResume = ...` in sessions.ts).

### Lead mode & in-process MCP

`src/main/lead-tools.ts` builds an in-process MCP server (`createSdkMcpServer`)
that exposes `list_live_agents`, `list_available_agents`, `message_agent`,
and `spawn_agent`. When a session starts in Lead mode, the pool merges
this server into `options.mcpServers` under the reserved key
`lead-orchestrator`. The Lead's system prompt explains how to call
these tools to coordinate sub-agents.

`spawn_agent` calls back into the renderer via the `pane:spawn` IPC
event so the UI splits a new pane and binds the requested agent.

### stderr capture

`options.stderr` is set to a callback that prepends the pane id and
agent name and `console.error()`s every line. Without this, MCP
connection failures from the underlying CLI subprocess are silent.

---

## Persistence

`electron-store` files (in `app.getPath('userData')`):

| File | Purpose |
|---|---|
| `claude-panels-state.json` | windows[] (= sessions[]), presets[], activeSessionId |
| `inzone-voice.json` | ElevenLabs API key + Agent ID |
| `inzone-terminal-shortcuts.json` | terminal shortcut buttons |

Per-pane:
- `~/.../sessions/<paneId>.json` — the SDK session id + agent name +
  mcpServers snapshot for resume.
- `~/.../transcripts/<paneId>.jsonl` — append-only chat history. Loaded
  on `setPaneAgent` so reopening shows the prior conversation.

Cost ledger is in `~/.../usage.jsonl` — append-only, one line per
turn. `getUsageSummary()` reads + aggregates it on demand.

---

## IPC bridge

Channel names live in `src/shared/ipc-channels.ts`. The handler
registry is `registerIpcHandlers()` in `src/main/ipc.ts`. The preload
wrappers are in `src/preload/index.ts`. The TypeScript surface for
`window.cowork.*` is the `CoworkApi` interface in `src/shared/cowork-api.ts`.

**To add a new IPC**: append to all four files in the same order:
1. Add a channel constant in `ipc-channels.ts`.
2. Add an `ipcMain.handle` in `main/ipc.ts`.
3. Add the matching wrapper in `preload/index.ts`.
4. Add the method to `CoworkApi` in `cowork-api.ts`.

Type errors will guide you if you miss one.

---

## MCP servers

User-scope: `~/.claude.json` (top-level `mcpServers` field — same file
the Claude Code CLI uses).
Project-scope: `<cwd>/.mcp.json`.

`src/main/mcp-config.ts` reads both, merges with project overriding
user, and normalizes types (`stdio` / `sse` / `http`). When session
starts, `buildSdkMcpMap({ cwd, allowed })` returns a `Record<name, McpServerConfig>`
filtered by the agent's opt-in list, which goes straight into
`options.mcpServers` for the SDK.

The Settings → MCP servers tab has a curated wizard. Each preset
(Figma, Context7, Atlassian, Supabase, GitHub, Filesystem) has an
`inputs` array describing the user-facing fields and a `buildConfig()`
that converts those into the underlying SDK config. Only Filesystem
and the token-bearing ones (Supabase, GitHub) actually require user
input; the rest just need the user to accept the preset.

---

## Voice agent

`@elevenlabs/react` `useConversation` hook is wrapped in
`src/renderer/src/voice/useVoiceAgent.ts`. The wrapper:

1. Builds a `clientTools` table — 11 tools that read/write Zustand or
   call IPC. Each tool is wrapped in `traced()` which logs to the dev
   console for debugging (the visible "tool calls" log was removed but
   the console logs remain).
2. Resolves agent names with `resolveAgentName()` — a four-step
   cascade: exact, substring, word-overlap, Levenshtein. ASR mangles
   hyphens to spaces, so this is essential.
3. State machine: `'idle' | 'connecting' | 'listening' | 'speaking' |
   'error'` derived from the SDK's two-axis status.

Auth: API key + Agent ID stored in main; signed URL minted via
ElevenLabs's REST endpoint at session start so the renderer never
sees the raw key.

System prompt and tool schemas are in `src/renderer/src/voice/toolSchemas.ts`
— users paste these into the ElevenLabs dashboard. The `agent_must_say`
fields in failure responses are critical because the dashboard's
"Wait for response" checkbox defaults to OFF; the verbose
instructional response shape forces the LLM to read tool returns
when the user does enable it.

---

## Terminal (PTY)

Native: **node-pty-prebuilt-multiarch**. Installed once via `npx
electron-builder install-app-deps` so the prebuilt links to Electron's
Node ABI (NOT plain Node's). If a prebuild isn't available for the
target platform, the fallback is `npx @electron/rebuild -f -w
node-pty-prebuilt-multiarch`.

`src/main/terminal.ts` exposes `spawnTerminal`, `writeTerminal`,
`resizeTerminal`, `killTerminal`, and `killAllTerminals`. Each pty
pipes its `onData` straight to the renderer via `IPC.TERM_OUTPUT`
events; the renderer pipes user keystrokes back via `IPC.TERM_INPUT`.

In the renderer, `TerminalPanel.tsx` mounts an `xterm.Terminal` with
`FitAddon`. The terminal stays alive across panel open/close (the
overlay element is always mounted; CSS just slides it in/out via
`transform`). PTY is killed on app quit (in the `before-quit`
handler) and on window close (component unmount).

Terminal shortcuts come from `inzone-terminal-shortcuts.json` (one
file regardless of session). When a button is clicked, the renderer
calls `window.cowork.terminal.input({ id, data: command + '\r' })`.

---

## Preview window

`webviewTag: true` is set on the BrowserWindow's `webPreferences`. The
modal's `<webview>` element renders the embedded site in its own
process with `partition="persist:inzone-preview"` so cookies persist
across sessions but never leak to INZONE state.

CSP is configured to allow blob: + jsdelivr (for ElevenLabs's
libsamplerate worklet) + ElevenLabs WSS. See the `<meta
http-equiv="Content-Security-Policy">` in `src/renderer/index.html`.

URL detection regex: `/\bhttps?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?(?:\/[^\s'"<>)\]}]*)?/gi`.
The `detectLocalhostUrls()` exported from `store.ts` walks every pane's
items in the active session, extracts matches, dedupes, and sorts
newest-first. Drives both the FAB visibility and the URL dropdown
inside the modal.

`⌘⇧P` opens the modal globally. `⌘R` inside the modal triggers a
webview reload.

---

## CSS conventions

One stylesheet (`src/renderer/src/index.css`). Class names are
namespaced by component family — `pane-`, `pane-host-`, `voice-`,
`terminal-`, `mcp-`, `settings-`, `preview-`, `sidebar-`, `library-`,
etc. CSS custom properties drive theme tokens: `--bg`, `--bg-elev`,
`--bg-elev-2`, `--accent` (#E4D947), `--text`, `--text-dim`, `--ok`,
`--danger`, etc. — all defined on `:root`.

Per-pane theming: each pane sets `--pane-accent` and `--pane-accent-soft`
inline from its agent's color. Children read those vars instead of
inlining colors directly, so a pane can be re-themed without re-rendering.

`color-mix(in srgb, var(--accent) X%, transparent)` is the standard
way to express tinted backgrounds (used for active pane headers,
session row highlight, voice orb aura, etc).

---

## Workflow tips for future agents

- **Don't bypass the IPC boundary.** Renderer-side native code temptations
  (e.g. importing `os`, `child_process`) break the sandbox model and won't
  type-check. If you need OS access, add an IPC channel.
- **Don't recreate the Zustand store from scratch.** Add fields to
  `StoreState` and `StoreActions` and write a setter that persists via
  `saveWindow()` if it's session-scoped or via electron-store IPC if
  it's app-scoped.
- **Anchor everything that's "active session" at the top-level fields.**
  Don't refactor that boundary unless absolutely necessary; the sessions
  array is the source of truth for persistence, top-level fields are
  the rendering view.
- **When a feature touches the SDK's session/options, audit `resume`
  invalidation.** New options that affect tool topology need to be
  hashed or compared in `session-store.ts` and the resume check in
  `sessions.ts`.
- **Don't introduce build steps that require network.** Native modules
  use prebuilt binaries; if you add a native dep, prefer pre-built
  variants and document the install step in the README.
- **CSP changes need to land in `src/renderer/index.html`.** That's a
  meta tag, parsed at page load; renderer-only HMR won't pick it up.
  ⌘Q + relaunch after editing.
- **Native module changes (`node-pty`, etc.) need ⌘Q + relaunch too** —
  preload-bundled modules are loaded at process start.

---

## Build & dev

```bash
npm install
npx electron-builder install-app-deps   # rebuild native modules for Electron ABI
npm run dev                              # electron-vite dev mode (HMR for renderer)
npm run typecheck                        # tsc --noEmit on both projects
npm run build                            # production bundle
npm run package                          # full DMG via electron-builder
```

`tsconfig.node.json` covers main + preload + shared.
`tsconfig.web.json` covers renderer + shared.

---

## Things to be careful with

- **Multiple IPC listeners under StrictMode.** The renderer guards
  init() with `_initialized` because StrictMode mounts twice. Don't
  remove that guard.
- **Concurrent setPaneAgent.** See "State management → Concurrency".
- **MCP "Wait for response" checkbox.** ElevenLabs default is OFF.
  This is documented in Settings → Voice but easy to miss; if voice
  tools "succeed" without taking effect, that's the first thing to check.
- **Preview webview iframe issues.** Some dev servers set strict
  X-Frame-Options. There's a fallback "Open in default browser" button
  in the modal toolbar; not all sites can render in the embedded view.
- **Terminal cwd.** Captured at PTY spawn. If you switch sessions after
  opening the terminal, the existing shell stays in its original folder
  — the user has to `cd` themselves.

If a future change breaks one of these, please add a note here.
