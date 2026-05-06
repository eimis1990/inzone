# Changelog

All notable changes to INZONE are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.5.1] — 2026-05-06

### Added

- **Enhance description button.** New ✨ Enhance pill next to the
  Description label in the agent editor. Type a one-line role,
  click Enhance, and Sonnet rewrites it as 3 short paragraphs
  (role · domain knowledge · how it works in a repo) — 80–160
  words, plain prose, no markdown. Works as the natural setup
  step for the existing Generate prompt button: a richer
  description makes the system prompt that follows much more
  grounded.

### Changed

- **Stronger agent system-prompt generator.** Rewrote the
  meta-prompt with 9 mandatory sections (Core Responsibilities,
  Workspace, Context Discovery, Workflow, Domain Best Practices,
  Validation, Guardrails, Collaboration & Handoff) and role-aware
  hints — the prompt teaches the new agent to inspect different
  files for frontend vs. mobile vs. backend vs. reviewer vs.
  extractor work, rather than emitting generic advice. Length
  target raised from 50–130 to 90–180 lines, output cleanup is
  more aggressive (strips fences + "Here's the system prompt…"
  preambles), and a hardcoded fallback prompt ships in the file
  so the editor never lands on an empty body if the SDK errors.
- **Generate prompt button moved.** Was at the bottom of the
  editor below a 1280px CodeMirror; now sits at the top-right of
  the System prompt section header with a small "Generate uses
  title + description above" hint underneath it. No more scrolling
  to find the action.
- **AI buttons (Enhance + Generate) redesigned.** Custom inline
  SparkleIcon (rotates 15° on hover with a soft accent glow), a
  proper top-to-bottom gradient fill, an inset highlight, and a
  colored shadow that intensifies on hover. The two buttons share
  the same look so they read as a family. Loading state swaps the
  sparkle for a CSS-only spinner that inherits text color.
- **Editor section layout tighter.** Dropped the redundant
  "SYSTEM PROMPT / BODY (markdown — syntax highlighted below)"
  label between the section header and the editor. The header
  now stacks the title + markdown hint on the left and the
  Generate cluster on the right, bottom-aligned, sitting 5px
  above the CodeMirror.

## [1.5.0] — 2026-05-06

### Added

- **Validate a PR comment before sending to an agent.** New "Validate"
  button on every comment card. One click sends the comment text and
  the cited diff hunk to Haiku, which returns a verdict — *Looks
  good* / *Worth checking* / *Likely incorrect* — plus a 1–2 sentence
  reason. Catches the noisy / wrong / pointless suggestions that
  automated reviewers like Copilot sometimes generate, before you
  burn agent tokens implementing them. Verdict is rendered as a
  tinted inline pill below the comment.
- **Reply to a PR comment from inside INZONE.** New "Reply" button
  next to the validate + send-to-agent actions. INZONE remembers
  which pane received which comment and when (persisted to
  localStorage so it survives app restart, e.g. after a usage-limit
  pause), and the composer summarises the *correct* pane's
  transcript-since-dispatch — not a guess at the active pane's
  recent work. Two-tier summary lookup with auto-draft: (1)
  dispatched pane's response since dispatch, (2) file-path
  heuristic across all panes when the dispatch record is missing.
  When neither matches, the composer opens with an empty draft so
  you can type the reply yourself — we don't waste a Haiku call
  generating a meaningless "Done!". Edit the text, click Post, and
  we route through `gh` to post a threaded reply for review
  comments (`/pulls/{n}/comments/{id}/replies`) or a top-level
  comment for PR conversation comments. After posting we
  auto-refresh the PR detail so the new reply shows up in the
  thread immediately, plus a "View on GitHub" link to the new
  comment.
- **Threaded review-comment conversations.** Review comments now
  group into threads in the PR drawer — replies (yours or anyone
  else's) render indented under their parent with an accent rail,
  so you can see the full back-and-forth at a glance instead of
  just the original comment.

### Fixed

- **Terminal pane PTY died when an unrelated pane was closed.**
  Critical: closing a sibling pane in a 2-way split caused React to
  unmount + remount the surviving pane (because the tree collapses
  from `split` to `leaf` and the parent component changes). The
  TerminalPane's unmount cleanup then killed the PTY — taking the
  running CLI (Codex / Claude Code / a long shell job) with it,
  along with all in-flight work. Fix: hoist the PTY + xterm into a
  module-level session pool keyed by pane id; the pool survives
  React remounts and is only torn down by explicit `closePane` or
  `Reset`. The pane's xterm DOM is parked in `document.body` while
  detached and re-attached to the new container on remount.
- **Lead orchestrator routed to wrong workspace's agents.** Critical
  cross-workspace bug: `pool.findByAgentName` and `listActiveAgents`
  walked the global SessionPool with no session filter, so a Lead in
  workspace B asking `message_agent("frontend-developer")` could
  route the message to a long-lived pane from workspace A — wrong
  cwd, wrong project, with no visible indication. INZONE keeps panes
  alive across workspace switches by design (so they're warm when you
  switch back), which made this latent. Both pool methods now accept
  an optional `sessionId` filter; the Lead always passes its own
  session id so lookups stay scoped to the active workspace.
  Spawn-agent also stamps newly-created panes with the Lead's
  session id (not the Electron BrowserWindow id, which it had been
  stamping by mistake), so future lookups continue to scope right
  across the pane's lifetime.
- **Preview dropdown showed dead URLs that couldn't be killed.** A
  localhost URL detected in terminal output (e.g. `:3001/kainos`)
  would linger in the Preview pill's dropdown after the dev server
  exited; clicking the X to "kill" it returned "Nothing was listening
  on that port", which read as a bug — the URL was visible but
  unkillable. Now the X button does a liveness pre-check: if nothing
  is listening, the URL is silently pruned from the list (the user
  clicked it to make it go away — it goes away). When something IS
  listening and the kill succeeds, ALL URLs sharing that port are
  dropped, not just the one clicked, since `:3001` and
  `:3001/kainos` are served by a single PID and should clear
  together. The dropdown also runs an immediate liveness sweep when
  it opens, so users see fresh state instead of waiting up to 12s
  for the periodic sweep.

### Changed

- **Composer follows the active-pane tint.** The pane chat area got
  a darker background on the active pane, but the message field
  below kept the same colour regardless of which pane was selected —
  so when several panes were visible it was ambiguous which one your
  next keystroke would land in. The composer (and the inner pill)
  now darken together with the chat scroller when a pane is active,
  with a 160ms transition.
- **Expand button on the composer.** Next to Send is a new ⤡ icon
  that pops the message field into a 60×60% modal with a tall
  textarea, attach button, and Send. The modal shares state with the
  inline composer (input, attachments, submit) so toggling between
  the two doesn't lose your draft. ⌘⏎ to send, Esc to close.
- **PR comment action row** now wraps to multiple lines as needed.
  Previously each card only had a single Send-to-agent button on
  the right; with three actions per comment (Validate, Send,
  Reply) the row needed flex-wrap and tighter spacing.

[1.5.1]: https://github.com/eimis1990/inzone/compare/v1.5.0...v1.5.1
[1.5.0]: https://github.com/eimis1990/inzone/compare/v1.4.0...v1.5.0

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
