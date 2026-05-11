# INZONE — Feature Overview

A macOS desktop cockpit for orchestrating multiple Claude agents
side-by-side in a single window. INZONE is a workspace for AI-assisted
coding, research, and content work — designed for people who want to
delegate to several agents at once and pilot them interactively rather
than treating Claude as a single chat window.

---

## Core

### Multi-Agent Workspace
Run several Claude agents in independent panes inside one window.
Each pane has its own conversation, transcript, and SDK session, so
agents can work on different parts of the same project in parallel
without stepping on each other.

### Workspaces & Projects
Workspaces are containers of related projects. Each project is a
folder plus its layout, modes, agents, memory scope, and pipeline
configuration. Switch between projects in the sidebar without losing
state — long-running tasks in one project keep streaming while you
focus on another. Workspaces let you group projects that belong to
the same effort (e.g. "Client work", "Personal experiments") and
swap the whole context with a single switch.

### Two Modes — Multi or Lead
**Multi**: every pane is a peer agent working in parallel, organized
in a free-form split layout.
**Lead**: one orchestrator agent runs in a dedicated top pane and
delegates to sub-agents below it through a built-in messaging protocol.
Switch between modes per project with one click via the prominent
mode segmented control in the workspace bar.

### Workers Tab — Agents + CLI Tools In One Place
The middle sidebar tab is "Workers" and houses both LLM agents and
non-agent CLI tools. Two collapsible sections:

- **Agents** — your full agent library, alphabetical, click any card
  to bind it to the active pane.
- **Other** — CLI presets that spawn a per-pane PTY: **Claude Code**,
  **Codex CLI**, **Aider**, **Gemini CLI**, plus a plain **Terminal**.
  Drop one on a pane to flip it from a chat surface into an embedded
  shell running that tool.

CLI presets get install detection (red "not installed" pill if the
binary isn't on PATH), a guided install dialog with a one-click
"Run install command in terminal" path that types the right command
into the bottom-bar terminal, and an automatic re-probe so the cell
updates the moment your install finishes — no tab switching.

### Terminal Panes (Per-Pane PTYs)
A pane bound to a CLI worker runs an embedded xterm.js connected to
its own PTY in the project's working directory. The PTY is killed
cleanly when the pane is closed or swapped. The pane header shows the
preset name + command in purple to visually distinguish it from agent
panes. ⋮ menu offers **Reset shell** (kill + respawn fresh) and
**Close pane**.

### Flow — Sequential Agent Pipelines
Chain agent panes into a synchronous sequence. When Flow is on, each
pane fires the next as soon as it finishes its turn, passing the
previous agent's output downstream. Authored on a free-form canvas
with draggable cards and bezier connection lines (n8n-style).

- **Per-card prompts** with `{previous}` placeholder for prior output
- **Run Flow button** disabled-state tooltip shows what's missing
- **Live logs side panel** with autoscroll + jump-to-latest
- **Per-step delay** (0/1/2/5s)
- **Drag-to-arrange** with bezier lines redrawing live
- **Locked when off** — cards freeze, individual pane composers
  reclaim message authoring
- **Terminal panes excluded from chain** — they appear on the board
  as separate, smaller, info-only cards (preset logo, name, command,
  "Terminal panes don't run in Flow") since their PTYs aren't driven
  by the flow runner

### Worktrees — Parallel Branch Isolation
Spin up a git worktree off any branch directly from the sidebar.
INZONE creates a sibling directory with its own branch (with optional
`feature/`, `fix/`, `chore/`, `experiment/` prefix) and registers it
as a sister project under the parent — indented in the sidebar with
a "WT" chip so you always know which projects share a repo. Run
several agents in worktree projects in parallel, each on its own
branch, without them stepping on each other's working directories.

### Diff Review + PR Workflow
The second half of the worktree story: a Review chip in the workspace
bar opens a per-pane file tree of changes with side-by-side / inline
diff viewer. Per-hunk approve/reject. Send-back panel forwards
rejected changes + a comment to the agent for revision.

Once the diff is clean:
- **Open PR** — auto-detects `gh` CLI, multi-account support
  (push as), SSH-to-HTTPS escape hatch, base-branch auto-fill, and
  AI-generated PR title/body draft from the diff
- **Local merge** — merges into the parent branch in-place if you'd
  rather skip GitHub
- **Wrap-up** — pulls the merge into the parent project, removes the
  worktree, deletes the branch, and switches you back

This closes the loop between "agents produce work" and "you ship work."

### Layout Templates
Pre-set 1, 2, 4, 6, 8, or 10-pane grids. One click drops a sensible
layout that's resizable from the divider handles afterwards.

### Mission Control — Live Project Overview
Full-screen overlay (⌘⇧M) showing every project across the active
workspace as a card with its panes, modes, worktree branch, and live
runtime status for the active project — current tool, last assistant
text snippet, cost, time-since-last-activity, status pill. Click a
project to switch; click a pane row to switch and focus that pane.
Worktrees get a purple rail and ↳ glyph so they read as branches of
their parent at a glance.

---

## Agent Management

### Compatible With Claude Code
INZONE reads the same `~/.claude/agents/` and project-scope
`.claude/agents/` directories that the Claude Code CLI uses, so any
agent you've already authored works here unchanged. Frontmatter
fields (`name`, `description`, `model`, `tools`, `skills`, `color`,
`emoji`, `vibe`, etc.) are honored.

### Bundled Starter Library
On first launch, INZONE copies a curated set of starter agents and
skills into `~/.claude/agents/` and `~/.claude/skills/` — never
overwriting anything you've authored. You start the app with:

- **5 starter agents**: backend-developer, fullstack-developer,
  frontend-developer, solo-founder, lead-users-agent
- **8 starter skills**: code-reviewer, frontend-design, mobile-design,
  motion-system, senior-frontend, senior-fullstack, senior-prompt-engineer,
  seo-optimizer

A sentinel file records the install so subsequent launches skip the
copy.

### Agent Identity — Emoji, Vibe, Color, Name
Every agent gets a visual identity stack: a chosen emoji that shows
in the pane header, a "vibe" one-liner shown beneath the title, a
color from the 12-color palette that tints the active pane's accent
stripe, and an editable per-pane name (rename via the pencil icon).
Lead agents get a "Lead" badge.

### In-App Agent + Skill Editor
Create or edit agents and skills directly inside INZONE. The editor
opens in a wide modal with the form sectioned into Identity,
Capabilities, Appearance, and System Prompt blocks. CodeMirror with
Markdown syntax highlighting and a generous 1280–2000px-wide editor
for the system prompt. Per-agent tool allowlists, skill subsets, MCP
opt-ins, and a 12-color visual palette. The editor can also generate
a polished system prompt from the agent's name + description by
asking Claude.

### Per-Agent Curation
Each agent can be locked to a specific tool subset, skill set, MCP
server set, and model. Curated agents stay focused on their job and
don't accidentally use the wrong tool.

### Agents & Skills Library
The Settings → Agents and Settings → Skills sections present every
agent and skill as a card with its color stripe, emoji, name, model,
description, and footer chips for tools/skills. Search and create
buttons sit in a sticky toolbar so they're always reachable.

### Workspace Presets
Save your current pane layout + agent assignments + folder + mode +
pipeline configuration as a named preset. Loading a preset restores
everything in one move.

---

## Voice Agent

### Hands-Free Coordinator
Talk to a dedicated voice agent (ElevenLabs Conversational AI) that
can drive the rest of INZONE. Tap the mic in the sidebar, ask in
plain English — "spin up a frontend agent on this folder" — and the
voice agent calls real INZONE actions through a 10-tool client surface.

### Voice Setup Wizard
A three-slide guided wizard walks first-time users through setting
Voice up: (1) what Voice is + the "Wait for response" gotcha,
(2) copy the bundled system prompt + see the tool list + open
ElevenLabs in the browser, (3) paste API key + Agent ID + run a
connection test before saving. Reachable from the welcome modal's
"Configure Voice" CTA and a launcher button at the top of Settings →
Voice. Skip-able at any stage.

### Tool Surface
Voice can list/switch projects, list/run agents, send messages to
specific panes, create new projects with folder picks, add agents
to projects (with fuzzy-name matching), set window mode, set the
Lead agent, and close panes.

### Siri-Style Animated Orb
A multi-color CSS orb pulses with state — slow breathe when idle,
gentle pulse when listening, lively oscillation while the agent is
speaking. Provides immediate visual feedback for the conversation
state without staring at status text.

---

## Developer Tools

### Built-In Terminal
Real PTY shell (zsh/bash via node-pty) docked at the bottom of the
pane host. Opens with `⌘T` or by clicking the bar. Slides up to hover
over the panes with a blurred backdrop. Supports full ANSI colors,
Ctrl+C, interactive programs, and persists the running shell across
panel open/close. Terminal cwd follows the active project's folder.

### Terminal Shortcuts
Configure quick-action buttons (title + command) from Settings →
Terminal. They appear above the xterm host and one-click run things
like `npm run dev`, `npx serve`, `git status`.

### Preview Window
In-app browser for localhost. INZONE auto-detects URLs printed by
agents *and* by the terminal (e.g. `Local: http://localhost:5173/`)
and surfaces a Preview pill in the workspace bar. The pill becomes a
multi-URL picker when several services are running, with a "kill"
action to free a port. `⌘⇧P` opens the centered 16:10 preview at 90%
viewport. Liveness sweeps prune URLs that no longer respond.

### MCP Server Support
Connect external MCP servers (Figma, JIRA, Atlassian, Context7,
Supabase, GitHub, Filesystem, custom). Settings → MCP Servers has a
curated wizard with one-click presets, plus a Custom flow for stdio
or HTTP/SSE remote servers. MCP servers from Claude Code's
project-local and project-other config files are read in too.

- **Native OAuth (PKCE)**: connectors that need OAuth (Atlassian,
  Linear, etc.) authenticate via a built-in localhost callback flow,
  the same pattern Claude Code uses. Tokens persist in OS-level
  `safeStorage`.
- **Per-agent opt-in**: each agent picks which MCP servers it can
  reach, keeping its toolbox focused.
- **Status badges**: connection state, scope (user/project/other),
  and last-probed health are visible at a glance.

### CLAUDE.md Memory
Per-project (`<workspace>/CLAUDE.md`) and global (`~/.claude/CLAUDE.md`)
memory files that get injected into agent system prompts. Editable
from Settings → CLAUDE.md. Set the scope per project: project only,
global only, both, or none.

### Caveman Mode (Experimental)
Opt-in token-compression layer in Settings → Experiments. When
enabled, every new agent session starts with a system-prompt
addendum derived from
[JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman)
that asks the model to drop articles, filler, pleasantries, and
hedging from its natural-language output — typically cutting
~65–75% of tokens in assistant text. Six intensity levels (lite,
full, ultra, plus three classical-Chinese `wenyan-*` modes) and a
single global on/off switch. Code blocks, file paths, identifiers,
error messages, commit text, and PR descriptions are preserved at
every level. Assistant messages display a small "Caveman" badge in
the top-right of the role row whenever the mode is active, so
there's never ambiguity about why output looks terse. The full
caveman skill is also bundled at `~/.claude/skills/caveman/` for
per-agent opt-in via frontmatter.

### AskUserQuestion Tool
Built-in MCP tool that lets agents present a structured multi-choice
question to the user instead of guessing or asking ambiguously in
prose. The renderer turns the tool call into a step-by-step inline
form card — single or multi-select, options with descriptions, big
clickable cards. The user's answer flows back to the agent as a tool
result and the conversation continues naturally. Available to every
agent automatically.

---

## Persistence & Polish

### Project Resume
Pane layouts, agent assignments, transcripts, Claude SDK session ids,
mode (Multi or Lead), Lead-pane name and history, terminal-pane
preset bindings, and pipeline configuration all persist across app
restarts. Reopen the app and the same agents are right where you
left them, with full context intact. Cost telemetry is persisted to
disk.

### Cost & Usage Telemetry
Live cost counter per pane, per project, and globally. A workspace-
level cost chip stays visible at all times. Settings → Usage & cost
shows totals broken down by day, agent, and model.

### Pane Header Polish
Each pane's header shows the agent emoji, the pane's display name
(editable inline), the agent's slug, a status chip with a pulsing
indicator, and the running cost. The active pane is signalled by a
subtle 2px accent stripe at the bottom of the header in the agent's
color — no jarring background flip. A `⋮ more` menu collapses Clear
and Close so the header stays uncluttered.

### Sidebar
Three-tab sidebar — Projects, Workers, Voice — with the brand
pattern showing through behind each. The active tab uses a sliding
indicator. Worktree projects are indented under their parent. The
current git branch is shown at the bottom of the sidebar so you
always know what you're on.

### Image Attachments
Drop, paste, or click-to-attach PNG/JPEG/WEBP/GIF in the composer.
Agents that support vision (Claude Sonnet/Opus) see them as part of
the user turn.

### Markdown + Code Rendering
Agent replies render with full Markdown — tables, lists, blockquotes,
headers — and code blocks get syntax highlighting via highlight.js
across 100+ languages.

### Tool Calls Collapse
Bash/Read/Edit/Grep/Write/MCP calls collapse into a single
clickable summary line per call (`▸ Bash · ls -la · done`). Click
to expand and inspect input/output.

### Cross-Agent Coordination
Every agent is told about the shared workspace folder, the names of
other agents in the window, and lightweight handoff conventions
(`./.handoff-to-frontend`, etc). Agents can produce files in the
workspace that other agents pick up.

### Sound + Visual Cues
A custom completion sound plays when an agent finishes a turn
(toggleable from the workspace bar). Status chips animate during
streaming. Tool calls flash briefly as they execute.

---

## Onboarding & Auth

### First-Run Welcome Modal
On first launch, a welcome modal walks the user through three steps:
sign in to Claude, pick a project folder, and (optional) set up
Voice. Each step auto-detects "already done" status — users who
configured things out-of-band see check marks instead of CTAs.
Dismissible from any state and re-openable from Settings → Profile.

### Two Anthropic Auth Paths
- **API key** — paste from console.anthropic.com directly into
  Settings → Profile. Encrypted at rest via `safeStorage` (macOS
  keychain), validated against `api.anthropic.com/v1/models` before
  saving, auto-injected into the SDK process env on every launch.
- **Subscription** — keep using `claude login` from the Claude Code
  CLI. INZONE picks up the credentials automatically.

A user-set `ANTHROPIC_API_KEY` env var always wins over both paths
so power users keep their existing workflow.

### Local-First, No Telemetry
Everything is on your machine: agent definitions, transcripts, MCP
configs, OAuth tokens (encrypted via `safeStorage`), preview cookies,
voice settings, terminal shortcuts, pipeline configurations,
encrypted API key. The only data that leaves your laptop goes to:
Anthropic (Claude turns), ElevenLabs (voice — only if enabled), the
MCP server endpoints you explicitly add, and the auto-update feed
(version check). No analytics, no cloud account.

### Compatible With Claude Code Configs
Reuses `~/.claude/agents/`, `~/.claude/skills/`, `~/.claude.json`,
project `.mcp.json`, project `CLAUDE.md`, etc. Whatever you've
already set up for Claude Code keeps working.

---

## Distribution

### Direct-Download macOS App
Ships as a notarized DMG (Apple Silicon and Intel) hosted off the
Mac App Store. No sandbox restrictions; full access to the project
folder and child-process spawning works as designed.

### Auto-Updates
`electron-updater` checks the configured release feed every 30
minutes and silently downloads new versions in the background. When
a download completes, the user sees a small "Update ready" prompt
with Restart now / Later — never a forced restart. Updates pending
on app quit get applied automatically next launch.

---

## Roadmap

The features below aren't shipped yet — they're the highest-leverage
additions on the roadmap, captured here so the direction is clear.

### Persistent Agent Memory (Per-Project Knowledge)
Today every agent essentially starts fresh; CLAUDE.md helps but is
static and handcrafted. The plan is an automatic, retrievable memory
layer per project that distills "decisions made, conventions
discovered, gotchas hit, preferences expressed" from each turn into
structured notes. Agents get a `recall` tool, and relevant notes get
auto-injected into context based on the user's prompt.

A Memory tab in the project lets you browse, edit, pin, or forget
entries. Optionally cross-project at the user level too ("how I
prefer to write tests," "my React conventions") so a brand-new
project still gets the benefit of everything you've taught past
agents.

This is the unlock that turns INZONE from "a better chat with Claude"
into "Claude that's actually getting better at *your* codebase week
over week" — value compounds over time instead of being capped.

### Mission Control v2 — Cost Caps + Notifications
Mission Control today is a static read of pane state. The next layer:
a budget system (daily / weekly / per-project caps) that auto-pauses
agents when they cross a threshold, with a "raise the cap and
continue" prompt. Optional notification when a long-running task
finishes or errors so you don't have to babysit. Plus live updates
for inactive projects (right now only the active project streams
live data into the dashboard).

This makes long-running autonomous work safe to start and walk away
from.

### Honorable Mentions
- **Agent Recipes** — one-click templates like "build a feature
  end-to-end" that drop a pre-wired Flow with named agents already
  assigned. Lowers the barrier from blank canvas to productive.
- **Conversation Forking** — try a different prompt at any turn,
  compare both branches side-by-side. Makes experimentation cheap.
- **Specialized Pane Types** — beyond chat + terminal: a live diff
  pane, a tail-logs pane, a tests-watcher pane, an inline browser
  pane.
- **Cross-Project Agent Context** — agents in project A can read or
  reference work in project B. Useful for "I built this in another
  repo, do something similar here."
- **Time-Travel / Multi-Step Undo** — single ⌘Z that reverts an
  agent's last set of changes across files.
- **Screen Recording / Replay** — record the whole multi-agent
  session as a watchable timeline you can review or share with team.
- **Marketplace for Agents + Skills** — let third parties publish
  curated agent packs. INZONE handles install + sandboxing; revenue
  share for authors.
