<div align="center">

<img src="docs/inzone-logo-github.png" width="320" alt="INZONE24" />

<p>
  <strong>A macOS cockpit for orchestrating multiple Claude agents in one window.</strong><br/>
  Run a fleet of AI agents. Chain them into pipelines. Review their diffs. Ship — without leaving the app.
</p>

  <p>
    <a href="https://github.com/eimis1990/inzone/releases/latest"><img alt="Download" src="https://img.shields.io/github/v/release/eimis1990/inzone?label=download&style=for-the-badge&color=E4F250&labelColor=141821" /></a>
    <img alt="macOS" src="https://img.shields.io/badge/macOS-12%2B-141821?style=for-the-badge&labelColor=141821&color=8E8E93" />
    <img alt="Apple Silicon" src="https://img.shields.io/badge/Apple%20Silicon-%E2%9C%93-141821?style=for-the-badge&labelColor=141821&color=8E8E93" />
    <img alt="Intel" src="https://img.shields.io/badge/Intel-%E2%9C%93-141821?style=for-the-badge&labelColor=141821&color=8E8E93" />
    <img alt="MIT License" src="https://img.shields.io/badge/license-MIT-141821?style=for-the-badge&labelColor=141821&color=8E8E93" />
    <img alt="No telemetry" src="https://img.shields.io/badge/telemetry-0-141821?style=for-the-badge&labelColor=141821&color=6B7A3F" />
  </p>

  <p>
    <a href="https://github.com/eimis1990/inzone/releases/latest"><strong>⬇ Download for macOS</strong></a>
    &nbsp;·&nbsp;
    <a href="#features">Features</a>
    &nbsp;·&nbsp;
    <a href="#quick-start">Quick start</a>
    &nbsp;·&nbsp;
    <a href="#everything-else">More features</a>
    &nbsp;·&nbsp;
    <a href="#for-developers">Build from source</a>
  </p>
</div>

<br/>

<p align="center">
  <img src="docs/screenshots/hero_image_dark.png" alt="INZONE24 workspace with multiple Claude agents working in parallel" />
</p>

## Why INZONE24

Most AI coding tools give you one chat window with one agent. INZONE24 gives you a workspace.

You bind agents to panes, point each at the same project folder, and they work in parallel — a frontend agent on the UI, a backend agent on the API, a code-reviewer watching both. When you need something more structured, switch to **Lead** mode and let an orchestrator delegate to sub-agents through a built-in messaging protocol. When you need something pipelined, enable **Flow** and chain panes into a sequence that passes output downstream. When you need to review what they produced, the **Review** tab gives you per-hunk approve/reject and a one-click PR. All in one window.

Built for developers who use Claude as a teammate, not a tab.

<br/>

<table align="center">
  <tr>
    <td align="center"><strong>5+</strong><br/><sub>STARTER AGENTS</sub></td>
    <td align="center"><strong>8</strong><br/><sub>STARTER SKILLS</sub></td>
    <td align="center"><strong>4</strong><br/><sub>CLI TOOLS AS WORKERS</sub></td>
    <td align="center"><strong>0</strong><br/><sub>TELEMETRY · ACCOUNTS · LOCK-IN</sub></td>
  </tr>
</table>

<a id="features"></a>

## Features

### 01 · Multi-pane workspace — several agents, one window, zero context-switching

Split your project view into independent panes, each with its own agent and conversation. Agents run in parallel, see the same project folder, and can hand off work to each other through lightweight file conventions.

No more juggling six Claude tabs.

<p align="center">
  <img src="docs/screenshots/feature_1_dark.png" alt="Multi-pane workspace showing multiple agents working in parallel" />
</p>

### 02 · Lead mode — one orchestrator, many sub-agents

Switch a project into Lead mode and the top pane becomes the orchestrator agent. It can spawn sub-agents, message them by name, watch their progress, and hand off tasks.

The same lightweight pattern Anthropic uses internally — without any of the plumbing.

<p align="center">
  <img src="docs/screenshots/feature_2_dark.png" alt="Lead mode with orchestrator agent managing sub-agents" />
</p>

### 03 · Flow — chain your agents into pipelines

Build a sequential workflow on a free-form canvas. Each card is a pane with its own prompt; outputs flow forward via `{previous}`. Hit Run Flow and walk away.

Live logs surface in a side panel. n8n for AI agents — but the agents are real Claude SDK sessions doing real work.

<p align="center">
  <img src="docs/screenshots/feature_3_dark.png" alt="Flow canvas with chained agents and bezier connectors" />
</p>

### 04 · Tasks — pre-wired templates for common workflows

Nine built-in task templates ship with the app — pre-wiring layouts, agent bindings, and prompts for common scenarios like code review, debugging, or feature building.

Capture your current session as a custom task to replay later. One click and you're back in the zone.

<p align="center">
  <img src="docs/screenshots/feature_4_dark.png" alt="Tasks modal with built-in templates and custom user tasks" />
</p>

### 05 · Layouts — named pane presets, shape without assignment

Layouts are pane-tree presets separate from Tasks — the shape of your workspace without agent assignments.

Switch between 1, 2, 4, 6, 8, or 10-pane grids instantly, or save custom arrangements for different work modes.

<p align="center">
  <img src="docs/screenshots/feature_5_dark.png" alt="Layout presets for pane arrangements" />
</p>

### 06 · Pane focus — fullscreen one pane, others keep running

A horizontal tab strip lets you toggle any pane to fullscreen while the others continue working invisibly in the background.

`⌘F` to focus. `⌘F` again to return. Your agents never stop.

<p align="center">
  <img src="docs/screenshots/feature_6_dark.png" alt="Pane focus tabs strip below the workspace bar" />
</p>

### 07 · Worktrees — parallel branches, zero conflicts

Spin up a git worktree off any branch directly from the sidebar. Several agents can work in parallel branches without stepping on each other's changes.

Optional prefixes and a `WT` chip keep your worktrees organized. INZONE24 cleans up when you're done.

<p align="center">
  <img src="docs/screenshots/feature_7_dark.png" alt="Git worktree management from the sidebar" />
</p>

### 08 · Diff review + PR — review, approve, ship without leaving the app

The Review tab shows a side-by-side or inline diff with per-hunk approve/reject controls. Send feedback back to the agent for revision loops.

When the work is ready, one click opens a PR via the `gh` CLI. INZONE24 handles the rest — title and body are auto-drafted from the diff.

<p align="center">
  <img src="docs/screenshots/feature_8_dark.png" alt="Diff review interface with side-by-side comparison and per-hunk approve / reject controls" />
</p>

### 09 · Terminal — a real shell inside every pane

A full PTY terminal (zsh/bash) with ANSI color support, WebGL-accelerated rendering, and persistent state across sessions.

Add customizable shortcut buttons for your most-used commands. Your agents can run shell commands; so can you.

<p align="center">
  <img src="docs/screenshots/feature_9_dark.png" alt="Built-in terminal with ANSI colors and WebGL acceleration" />
</p>

### 10 · Preview — localhost in the app, no tab-switching

An in-app browser auto-detects localhost URLs from your project. The card swaps in next to your panes with a real toolbar: back / forward / reload, address bar, seven-step zoom (`⌘+` / `⌘-` / `⌘0`), a 375px mobile-viewport simulator, reload-on-save (chokidar watches your sources), and inline DevTools.

Multi-URL picker when several dev servers are running. Port-kill action built in.

<p align="center">
  <img src="docs/screenshots/feature_10_dark.png" alt="In-app browser preview for localhost URLs with browser-grade toolbar" />
</p>

### 11 · Project wiki — living documentation your agents read and write

A markdown wiki at `.inzone/wiki/` that agents can edit, query, and cite. A bundled, non-overridable agent protocol auto-injects into every agent's system prompt the moment a project initialises its wiki — making sure the wiki actually gets updated after every code-touching task, not just when the user remembers to ask.

Schema enforcement, structured ingestion, linting, and wiki-grounded voice Q&A. Your project knowledge, always up to date.

<p align="center">
  <img src="docs/screenshots/feature_11_dark.png" alt="Project wiki with agent-editable markdown pages" />
</p>

### 12 · Voice — talk to your fleet

> "Spin up a frontend agent on this folder."<br/>
> "Tell the backend agent to add the auth endpoint."<br/>
> "What did the reviewer say?"

Drive INZONE24 by voice with ElevenLabs Conversational AI. Pane creation, mode switching, project switching, wiki queries with citations, reading agent responses aloud — all hands-free. Bring your own ElevenLabs account.

<p align="center">
  <img src="docs/screenshots/feature_12_dark.png" alt="Voice interface for controlling agents hands-free" />
</p>

### 13 · Workers tab — agents and CLI tools share one shelf

Drop a Claude agent on a pane to chat with it; drop Claude Code, Codex CLI, Aider, Gemini CLI, or a plain shell on a pane to embed that tool right in the layout.

Same drag, same surface — choose the right tool for each task. Install detection flags missing binaries with a one-click guided install path.

<p align="center">
  <img src="docs/screenshots/feature_13_dark.png" alt="Workers tab showing agents and CLI tools together" />
</p>

### 14 · MCP servers — external tools, native integration

OAuth-integrated MCP servers for Figma, JIRA, Linear, Atlassian, Notion, GitHub, Filesystem, and custom endpoints. Tokens stored securely in the macOS keychain.

A curated Recommended MCPs rail offers 13 one-click installs covering both local stdio servers (Filesystem, Playwright, Brave Search, PostgreSQL, etc.) and remote OAuth connectors. Your agents can pull designs, create issues, and read files from anywhere you authorize.

<p align="center">
  <img src="docs/screenshots/feature_14_dark.png" alt="MCP server settings with curated Recommended MCPs" />
</p>

### 15 · Mission Control — every agent, every project, one glance

`⌘⇧M` opens a full-screen overview of every project across your active workspace — agents, status, current tool, cost, last activity.

Click a pane to jump to it. The closest thing to a process monitor for AI agents.

<p align="center">
  <img src="docs/screenshots/feature_15_dark.png" alt="Mission Control showing all projects and agents in a single overview" />
</p>

<a id="everything-else"></a>

## Everything else

The features above are the headliners. Plenty more is wired into the app:

- **Plugins + Marketplaces** — browse, install, and toggle Claude Code plugins (agents, skills, slash commands, MCPs, hooks) from inside the app. Anthropic's official marketplace plus any third-party one.
- **Slash commands** — `/` picker in the composer pulls project + user + plugin + built-in commands (`/plan`, `/think`, `/review`, `/explain`, `/test`). Argument templates included.
- **Recommended Skills** — curated one-click skills (VoltAgent Awesome Design, Printing Press, Slack, Linear, Stripe, Notion, Figma, X/Twitter, Firecrawl, and more). Setup guides for ones that need API keys.
- **In-app agent + skill editor** — wide drawer with CodeMirror Markdown, per-agent tool/skill/MCP allowlists, 12-color identity palette, and an AI-generated system-prompt button.
- **CLAUDE.md memory** — per-project and global memory files injected into every agent's system prompt, with a scope picker.
- **Multi-project workspaces** — group related projects; switch the whole context with one click. Inactive projects keep streaming in the background.
- **Cost & usage telemetry** — live per-pane, per-project, and global cost counters. Settings → Usage breaks totals down by day, agent, and model.
- **AskUserQuestion** — agents can render a structured multi-choice form to you instead of guessing or rambling in prose.
- **Caveman Mode (experimental)** — optional token-compression layer cuts ~65–75% of natural-language tokens in assistant replies. Code, paths, and identifiers preserved verbatim.
- **Light + Dark themes** — warm paper-and-ink light, deep slate + amber dark, live toggle in the workspace bar. Every surface adapts.
- **Vim mode** — Settings → Editor toggle applies modal editing to every CodeMirror surface (agent prompts, wiki, CLAUDE.md, MCP JSON). Synced across windows.
- **Image attachments** — drop, paste, or attach PNG/JPEG/WEBP/GIF in the composer. Vision-capable models see them as part of the user turn.
- **Keyboard polish** — Settings → Shortcuts reference with platform-aware glyphs; auto-scroll pin with "Jump to latest" pill; collapsing tool-call rows; ⌘P swap panes ↔ preview, ⌘S Settings, ⌘M toggle Multi/Lead, ⌘⇧M Mission Control, ⌘T terminal, ⌘F fullscreen pane.

For the full feature list and design notes see [FEATURES.md](FEATURES.md).

<a id="quick-start"></a>

## Get started in three steps

From download to your first agent conversation in under a minute.

**1. Download** — [DMG for Apple Silicon or Intel](https://github.com/eimis1990/inzone/releases/latest). Drag to Applications.

**2. Sign in to Claude** — paste your API key from `console.anthropic.com` into Settings → Profile, **or** run `claude login` from the Claude Code CLI and INZONE24 picks up the credentials automatically. Either works.

**3. Open a project** — pick a folder, split into panes, drop agents in, start working.

## Honest comparison

Different tools excel at different things. Here's where INZONE24 fits.

| Use case | INZONE24 | Claude Code | Cursor |
| --- | :---: | :---: | :---: |
| Single agent, fast feedback loop | ✓ | ✓✓ | ✓✓ |
| Multiple agents in parallel | ✓✓ | — | — |
| Sequential pipelines (Flow) | ✓✓ | — | — |
| Voice control | ✓✓ | — | — |
| Inline diff review + 1-click PR | ✓✓ | — | ✓ |
| Project wiki agents maintain | ✓✓ | — | — |
| Built-in IDE features (lints, etc.) | — | — | ✓✓ |

<sub>— not really · ✓ supported · ✓✓ shines here</sub>

## Privacy & ownership

Your code never leaves your laptop.

All transcripts, agent definitions, MCP configs, OAuth tokens (encrypted via macOS keychain), preview cookies, voice settings, and pipeline state live on your machine. The only data that leaves goes to:

- **Anthropic** — the prompts you send to Claude, billed against your subscription or API key
- **ElevenLabs** — voice prompts, only if you enable the Voice agent
- **MCP server endpoints you explicitly add** — under your control, per-agent opt-in
- **The auto-update feed** — version check; the binary itself is signed and notarized

No analytics. No cloud account. No lock-in.

## Compatibility with Claude Code

INZONE24 reads the same configuration directories Claude Code uses:

- `~/.claude/agents/` — global agent definitions
- `~/.claude/skills/` — global skill definitions
- `<project>/.claude/agents/` — project-scoped agents
- `<project>/CLAUDE.md` and `~/.claude/CLAUDE.md` — memory files
- `<project>/.mcp.json` — project-local MCP servers
- `~/.claude.json` — project-other MCP servers
- `~/.claude/plugins/` + `~/.claude/settings.json` `enabledPlugins` — plugin install state

Whatever you've already set up for Claude Code keeps working.

## Requirements

- macOS 12 or later (Apple Silicon or Intel)
- A Claude API key (`console.anthropic.com`) **or** an active Claude Code subscription
- *(Optional)* An ElevenLabs account for the Voice agent
- *(Optional)* `gh` CLI installed for the one-click PR flow

<a id="for-developers"></a>

## For developers

INZONE24 is open source. To run from source:

```bash
git clone https://github.com/eimis1990/inzone.git
cd inzone
npm install
npm run dev          # HMR dev mode
```

Useful scripts:

```bash
npm run typecheck    # tsc --noEmit for main + renderer
npm run build        # production bundle into out/
npm run package      # build a signed .zip via electron-builder (requires Apple Dev ID env vars)
npm run package:dir  # build an unsigned .app for local testing — fastest iteration
```

### Architecture at a glance

```
┌──────────────────────────────────────────────────────────────┐
│ Renderer (React + Zustand)                                   │
│   ┌─────────────┬────────────────────────────────────────┐   │
│   │ Sidebar     │ Pane tree (resizable splits)           │   │
│   │ Projects /  │  ┌────────┬────────┐                   │   │
│   │ Workers /   │  │ Pane A │ Pane B │  …                │   │
│   │ Voice       │  └────────┴────────┘                   │   │
│   │             │ Workspace bar · Flow canvas · Review   │   │
│   └─────────────┴────────────────────────────────────────┘   │
│                    │ ipc invoke / on                          │
└────────────────────┼─────────────────────────────────────────┘
                     ▼
┌──────────────────────────────────────────────────────────────┐
│ Main process (Node)                                          │
│   IPC handlers   ─►  SessionPool                             │
│                       ├── SessionController (pane A)         │
│                       │    └─ @anthropic-ai/claude-agent-sdk │
│                       └── SessionController (pane B) …       │
│   Agents/skills watcher · MCP loader · Git ops · PTYs        │
│   Plugins loader · AskUserQuestion in-process MCP server     │
│   Preview chokidar watcher · Auto-update                     │
│   Persistence (electron-store + JSONL transcripts)           │
└──────────────────────────────────────────────────────────────┘
```

Core stack: **Electron + TypeScript + React + Zustand**, `@anthropic-ai/claude-agent-sdk` for agent runtime, `react-resizable-panels` for tiled splits, `node-pty` + `xterm.js` for terminals, `chokidar` for the preview reload-on-save, `electron-builder` for packaging, `electron-updater` for in-app updates.

For a deeper feature list see [FEATURES.md](FEATURES.md). For the release flow see [RELEASE.md](RELEASE.md).

## License

MIT — see [LICENSE](LICENSE).

---

<p align="center">
  <sub>Built for people who treat Claude as a team, not a chatbot.</sub>
</p>
