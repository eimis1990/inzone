# Glossary

Project-specific terms as they're used in this codebase. Alphabetical.

## Active pane

The pane that currently has focus. Receives composer keystrokes,
status-bar actions, and gets the visible "active" border treatment.
Stored as `activePaneId` in the Zustand store.

## Agent (lowercase)

A markdown file under `~/.claude/agents/` (or project-scoped
`<cwd>/.claude/agents/`) defining a Claude personality with name,
model, allowed tools, skills opt-in, MCP server opt-in, color,
emoji, and a system prompt body. Loaded by [agents.ts](../../src/main/agents.ts), edited
via [EditorModal.tsx](../../src/renderer/src/components/EditorModal.tsx). Distinct from "Agent SDK process".

## Agent SDK

`@anthropic-ai/claude-agent-sdk` — Anthropic's Node.js library for
running Claude as an agent. INZONE spawns one process per chat
pane via [SessionPool](../../src/main/sessions.ts).

## Bundled resources

Files in [bundled-resources/](../../bundled-resources/) shipped with the app and copied
into `~/.claude/` on first run via [bundled-resources.ts](../../src/main/bundled-resources.ts).
Includes default agents and skills users can opt into.

## Composer

The text input at the bottom of a chat pane. Cmd+Enter sends.
Has an "expand" button that opens a larger modal version of the
same input.

## CoworkApi

The preload bridge surface declared in [cowork-api.ts](../../src/shared/cowork-api.ts).
Renderer code calls `window.cowork.<namespace>.<method>(...)` —
each method maps to one IPC channel.

## Custom task template

User-saved pane layout + agent assignment combo, persisted to
electron-store. Distinct from built-in task templates that ship
in code. See [TasksModal.tsx](../../src/renderer/src/components/TasksModal.tsx).

## Focused pane

The pane currently fullscreened via Cmd+F or pane-tabs click.
`null` = "All" view (every pane visible). Transient — never
persisted, resets on session switch / app restart.

## Lead orchestrator (Lead Agent mode)

When `windowMode === 'lead'`, one pane (the lead) drives the others.
The lead receives CLAUDE.md memory and dispatches sub-agents into
the other panes via `pane:spawn`. Sub-agents stay narrowly focused
on the specific task, no CLAUDE.md.

## Lead pane

The pane that holds the lead orchestrator. Stored as
`leadPaneId` when in Lead Agent mode.

## Leaf

A terminal node in the pane tree — corresponds to one pane.
Opposite of `split`. See `collectLeaves(tree)` for traversal.

## MCP server

Model Context Protocol server. Configs live in `~/.claude.json`
(user scope) and `<cwd>/.mcp.json` (project scope). The same files
the Claude Code CLI uses, so configs round-trip between INZONE and
the CLI. See [McpServersSection.tsx](../../src/renderer/src/components/settings/McpServersSection.tsx).

## Pane

One unit of the workspace UI: chat with an agent (most common),
a terminal session, or empty. Tracked by `PaneId`. Each pane has
its own runtime state in `panes[paneId]`.

## Pane tabs

The horizontal strip below the workspace bar (added in v1.9.0)
that shows one tab per pane plus an "All" tab. Click a pane tab
to fullscreen that pane. Hidden when only one pane exists.

## PTY

Pseudo-terminal. Each terminal pane gets its own PTY spawned in
the main process via `node-pty`. The renderer's xterm.js attaches
to the PTY's stream via IPC.

## Recommended skill

A curated community skill (Awesome Design, etc.) listed in
[recommended-skills.ts](../../src/shared/recommended-skills.ts). One-click install does a shallow
git clone into `~/.claude/skills/`. Idempotent.

## safeStorage

Electron's built-in secrets API. Uses macOS Keychain / Windows
DPAPI / Linux libsecret. INZONE uses it for the in-app stored
Anthropic API key ([claude-auth.ts](../../src/main/claude-auth.ts)) and the ElevenLabs
API key ([voice.ts](../../src/main/voice.ts), since v1.10).

## Session

The collection of panes / tree / lead state for one project
folder (cwd). Stored under `windows[]` in persisted state. Each
session keeps its panes warm globally — switching sessions
swaps the visible tree but doesn't kill the off-screen panes'
agents.

## Session pool

The main-process [SessionPool](../../src/main/sessions.ts) that owns every running Agent
SDK process keyed by paneId.

## Skill

A folder under `~/.claude/skills/<name>/` with a `SKILL.md` file
plus optional helper files. Agents opt into skills by name; the
SDK loads the SKILL.md at runtime.

## Split

Internal node of the pane tree — has two children (`a`, `b`),
an orientation (`row`/`column`), and a size ratio. Rendered as
`react-resizable-panels` PanelGroup.

## Terminal pane

A pane whose `workerKind === 'terminal'`. Holds a PTY + xterm
instance via the [terminal-sessions.ts](../../src/renderer/src/components/terminal-sessions.ts) pool. Distinct from
the bottom-dock terminal.

## Terminal preset

Predefined "this terminal launches `claude` / `codex` / `aider` /
`gemini`" configs in [worker-presets.ts](../../src/shared/worker-presets.ts). Drop on a pane
to start that CLI inside a real shell.

## Tree (pane tree)

The recursive `split | leaf` data structure for one session's
pane layout. See [src/shared/types.ts](../../src/shared/types.ts) for the type and
[Pane.tsx](../../src/renderer/src/components/Pane.tsx) for rendering.

## Window mode

`'standard' | 'flow' | 'lead'`. Standard = user drives each pane
manually. Flow = panes share output. Lead = one pane orchestrates
the others. Controlled by `setWindowMode`.

## Workspace

A container of projects. One workspace can hold many sessions
(one per project folder). User can switch between workspaces;
each maintains its own active-session pointer.

## Sources

- Conversation with Eimantas across v1.5–v1.10
- [src/shared/types.ts](../../src/shared/types.ts) — type aliases for all of the above
- [src/renderer/src/store.ts](../../src/renderer/src/store.ts) — runtime state shape
- Wiki: [[architecture]]
