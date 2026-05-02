# Claude Panels

A macOS app that runs multiple Claude Agent SDK sessions side‑by‑side inside one window. Each pane is an independent session bound to an agent from `~/.claude/agents`. Skills and MCP servers from `~/.claude` flow in automatically.

## What's inside

- **Electron + TypeScript + React** renderer, with `react-resizable-panels` for tiled splits.
- **Main process** spawns and pumps `@anthropic-ai/claude-agent-sdk` `query()` sessions, one per pane, and forwards events over IPC.
- **Persistence** via `electron-store` for layouts and workspace presets; per‑pane JSONL transcripts under `app.getPath('userData')/transcripts/`.
- **Auto‑accept tools** (`permissionMode: 'bypassPermissions'`) — agents run without prompting. A "Stop" action per pane is wired for when you need to yank the cord.

## Requirements

- macOS 12+
- Node.js 18+
- An `ANTHROPIC_API_KEY` in your environment (or a logged‑in `~/.claude` from Claude Code, which the SDK also picks up).
- Agents under `~/.claude/agents/*.md` with YAML frontmatter:

  ```md
  ---
  name: code-reviewer
  description: Reviews diffs and flags risks.
  model: sonnet
  ---
  You are a meticulous code reviewer. ...
  ```

## Scripts

```bash
npm install          # install deps
npm run dev          # run the app in dev mode with HMR
npm run typecheck    # tsc --noEmit for main + renderer
npm run build        # production bundle into out/
npm run package      # build a signed .dmg via electron-builder (mac)
npm run package:dir  # build an unsigned .app for local testing
```

First launch will prompt for a project folder — every pane in that window runs with that folder as its `cwd`.

## How it fits together

```
┌──────────────────────────────────────────────────────────┐
│ Renderer (React)                                         │
│                                                          │
│   ┌─────────────┬──────────────────────────────────┐     │
│   │ Sidebar     │ Pane tree (resizable splits)     │     │
│   │ (agents +   │  ┌────────┬────────┐             │     │
│   │  skills)    │  │ Pane A │ Pane B │  …          │     │
│   │             │  └────────┴────────┘             │     │
│   └─────────────┴──────────────────────────────────┘     │
│                    │ ipc invoke/on                       │
└────────────────────┼─────────────────────────────────────┘
                     ▼
┌──────────────────────────────────────────────────────────┐
│ Main process (Node)                                      │
│   IPC handlers  ─►  SessionPool                          │
│                      ├── SessionController (pane A)      │
│                      │    └─ @anthropic-ai/claude-agent-sdk
│                      └── SessionController (pane B) …    │
│   Agent + skill scanner (~/.claude watch)                │
│   Persistence (electron-store + JSONL transcripts)       │
└──────────────────────────────────────────────────────────┘
```

Events flow main → renderer over the `session:event` channel. User messages flow renderer → main via `session:send` and get fed into each session's async input queue.

## Notes & limitations

- The SDK's message shapes can evolve; `src/main/sessions.ts` treats incoming messages as unknown and inspects only the fields it needs.
- Auto‑accept + a shared project folder means any pane has full filesystem access under that folder. If you want guardrails, swap `permissionMode` in `sessions.ts` to `'default'` (per‑tool prompts) or `'acceptEdits'` (edits without prompts, but bash still asks).
- MDI window tracking is single‑window for now. Multiple BrowserWindows are supported at the infra level but no menu item opens a second one yet — easy follow‑up.
- To package for distribution outside your machine you need an Apple Developer ID and notarization. `electron-builder` handles both when the right env vars are set (`APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`, `CSC_LINK`, `CSC_KEY_PASSWORD`).
