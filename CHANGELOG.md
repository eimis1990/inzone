# Changelog

All notable changes to INZONE are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] — 2026-05-05

### Added

- **LLM Wiki** — a new sidebar tab and project-local knowledge base inspired by
  Andrej Karpathy's "LLM Wiki" pattern. One initialise click scaffolds
  `.inzone/wiki/` with a schema, log, index, and starter pages
  (architecture, glossary, gotchas, decisions, conventions). The wiki is
  committed to git so the team shares one institutional memory.
  - **Scan project** — a single click drops a structured ingest prompt into the
    focused agent so it can populate the starter pages with grounded,
    cited content from your repo.
  - **Auto-update** — when a project has an initialised wiki, every agent
    session automatically gets the schema + curated index injected into
    its system prompt, plus instructions to keep pages current as it
    learns. Edits show up as visible Write/Edit tool calls in the
    transcript, never silently.
  - **Lint** — audits Sources cites, flags stale / orphan / broken-wikilink
    pages, and writes the findings to `log.md`. Read-only by design.
  - **Dashboard strip** — page count, time since last ingest, recent edits,
    expandable to show the latest log entries.
  - **In-app markdown editing** — click any page to view; the new Edit button
    swaps in a CodeMirror editor with markdown highlighting. `⌘S` saves
    and appends an `edit` entry to the log automatically.
  - **`[[wikilink]]` navigation** — Obsidian-compatible cross-page links
    inside the modal viewer.

- **Tooltip component** — reusable hover/focus tooltip rendered via React
  Portal, used in the wiki footer for Lint and Re-scan. Replaces native
  `title` attributes (which had a 500 ms delay and were easy to miss),
  appears instantly with consistent dark-theme styling, and can extend
  past `overflow: hidden` ancestors.

### Changed

- **Mode selector redesign** — the Multi Agents / Lead Agent toggle in the
  workspace bar is now a frosted segmented control with a sliding accent
  thumb. Lead is now on the left, Multi on the right (closer to the Flow
  button which is an extension of Multi mode). Animation is GPU-accelerated
  via `transform`, no JS measurement.
- **Flow button** — slides in from the left of the Multi Agents segment when
  in Multi mode with ≥2 panes; smoothly slides out otherwise. New glassy
  pill treatment harmonises with the segmented control.
- **Sidebar tab indicator** — now centred under each tab's content with a
  consistent minimum length, so Voice and Wiki (no count chip) read the
  same as Projects and Workers (with chips).
- **Initial agent load** — on app boot the renderer now re-fetches agents
  once the saved project's `cwd` is hydrated, so project-scoped agents
  appear at first paint instead of "sometime later when I click around".
- **Agent header refresh** — small ⟳ button next to the AGENTS title in
  the Workers tab to manually rescan `~/.claude/agents` and the project's
  `.claude/agents` folder. Useful when the file watcher misses an
  external edit (common on cloud-synced folders).

### Fixed

- **PR send-to-agent dropdown showed stale agent names.** The dropdown was
  reading `agentName` from the persisted tree leaf, which only updates
  on `saveWindow`. Now it reads from the live runtime panes map, so
  swapping an agent on a pane updates the dropdown immediately.
- **Project-scoped agents couldn't be edited.** Attempts to change colour /
  emoji / vibe on a `<project>/.claude/agents/*.md` file failed with
  "Editing project-scoped definitions is not supported yet." Project
  scope now writes back to the project's folder; user scope still goes
  to `~/.claude/agents`.
- **Project-scoped agents couldn't be assigned to panes** ("Agent not
  found"). The `session:start` IPC and the Lead orchestrator's
  `getAvailableAgents` callback both listed agents without `cwd`, so
  project-scoped agents were invisible to lookup. Both now pass the
  project directory through.
- **Wiki page modal was clipped behind the terminal bar.** The modal now
  renders via React Portal so it covers the terminal bar regardless of
  which sidebar stacking context it mounts into.
- **Windows: install commands didn't work.** Suggested `brew install …` on
  every platform; Windows users couldn't run brew. Claude Code's install
  hint is now `npm install -g @anthropic-ai/claude-code` cross-platform.
- **Windows: install probe was Unix-only.** `checkCommandsAvailable` shelled
  out via `/bin/sh` which doesn't exist on Windows, so every CLI showed
  as "not installed" forever. Now uses `where` via `cmd.exe` on Windows
  with `command -v` on macOS / Linux. PATH augmentation also picks up
  the npm-global folder on Windows so newly-installed tools are detected
  on the next probe pass.

[1.4.0]: https://github.com/eimis1990/inzone/compare/v1.3.0...v1.4.0
