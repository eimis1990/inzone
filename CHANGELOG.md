# Changelog

All notable changes to INZONE are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.0] — 2026-05-07

### Added

- **Composer takes the agent's colour.** When a pane is active, the
  message-field border now tints with the bound agent's colour, and
  the Send button fills with the agent's colour with a high-contrast
  black icon. Inactive panes keep a neutral grey Send button. Reads
  as "this pane is alive, and it belongs to <agent>" at a glance.
  Same treatment carries through to the expanded compose modal.
- **Layout templates modal restyled.** Same visual language as the
  Tasks modal — gradient hover bloom, accent border on hover, themed
  preview cells, a one-line hint per layout ("Quad — small team",
  "Maximum spread"). Picking a layout while at least one pane has
  an agent bound now confirms first with the list of sessions that'll
  be stopped; idle layouts still apply with one click.
- **Broken custom task templates are flagged, not silently skipped.**
  When a custom template references an agent you've since renamed
  or deleted, missing slots render with a red ✗ "missing" treatment
  + strikethrough, the card lists which agents are gone, and the
  apply button is disabled with an explanatory tooltip.

### Changed

- **Tasks modal current-session card.** The top of the Tasks modal
  now shows your live pane setup as a feature card with editable
  title (defaults to "Unnamed Task"), description, and an inline
  Save-as-template action. If your current setup already matches a
  saved or built-in template, the card surfaces that with a green
  ✓ instead of asking you to save again.
- **Send button + composer field redesigned.** Rounded corners
  (12px field, 10px button) instead of pills, matching the
  agent-cards across the rest of the app. The accent-glow on
  focus is gone — just a clean accent border. The Send icon
  swapped from a thin stroked arrow to a chunky filled
  paper-plane glyph that reads as a decisive press target.
- **Pane empty state simplified.** Dropped the big "Talk to
  <agent>" / "Pick an agent" heading; the smaller hint line and
  shrunken logo are enough — the pane header already tells you
  who you're talking to.
- **Modal cards sit flat against the body.** Task cards, the
  current-session feature card, and layout cards switched from
  the raised `--bg-elev-1` tile fill to the modal body's `--bg` —
  the accent border + gradient hover bloom do the work of
  separating cards visually, no elevation contrast needed.

### Fixed

- **Composer didn't pick up agent colour.** The `--pane-active-stripe`
  CSS variable was scoped to the pane *header* div only, so the
  composer (a sibling) couldn't see it and fell back to the global
  yellow. Switched the composer rules to read `--pane-accent`,
  which is set on the pane root and cascades to everything inside.
- **Layout buttons (Split H/V, Layouts, Tasks) now share chrome.**
  The four launchers in the workspace bar all carry the same dark
  rounded background as the Settings gear, so the cluster reads as
  one row of identical chips.

[1.8.0]: https://github.com/eimis1990/inzone/compare/v1.7.0...v1.8.0

## [1.7.0] — 2026-05-07

### Added

- **Tasks feature.** New Tasks button next to Layout templates in
  the workspace bar. Opens a modal of one-click recipes that
  configure the workspace for a specific kind of work — pick a
  template and INZONE switches to the right mode, optionally binds
  the Lead agent, and creates one pane per agent the template
  needs, all pre-assigned. Saves you 5–10 clicks per task setup.
- **Built-in task templates.** Nine recipes that ship with the app:
  - 🎨 **Website Redesign** (Lead) — extract spec → redesign UI →
    implement → review.
  - 📱 **Mobile Feature** (Lead) — design + developer + code
    reviewer in the loop.
  - 🚀 **Greenfield Project** (Lead) — frontend + backend +
    fullstack + reviewer.
  - 🐛 **Bug Fix** (Lead) — fullstack dev + reviewer.
  - 🔍 **Code Review** (Multi) — reviewer paired with a developer.
  - 🌐 **Browser Automation** (Multi) — browser agent + reviewer.
  - 🎯 **Frontend Sprint** / 🛠️ **Backend Sprint** (Multi) —
    focused dev + reviewer pairs.
  - 🦄 **Solo Builder** (Multi) — single-pane talk-it-out flow.
  Templates are filtered at render time — only ones whose required
  agents you have installed appear, so adding new specialised
  agents progressively unlocks more recipes.
- **Save current setup as a task template.** The Tasks modal's top
  "Current session" card shows your live pane configuration with
  editable Title (defaults to "Unnamed Task"), description, emoji,
  and a Save action. Saved templates persist across app restarts
  and live in the "My templates" section. If your current setup
  already matches a saved or built-in template, the card surfaces
  that with a green ✓ instead of offering to save again.
- **Six new bundled starter agents.** `code-reviewer`,
  `website-data-extractor`, `frontend-website-redesign`,
  `mobile-developer`, `mobile-code-reviewer`, and `mobile-design`
  all ship with INZONE so the task templates work out of the box on
  a fresh install. Each follows the Claude-Code-style agent
  structure (Workspace, Context Discovery, Workflow, Domain Best
  Practices, Validation, Guardrails, Collaboration & Handoff) and
  is designed to be safe-by-default — inspect before acting,
  refuse to fabricate, never run destructive commands without
  explicit approval.

### Changed

- **Bundled-resources install is progressive.** Used to be gated
  by a single sentinel file (`.inzone-starters-installed`) — once
  the sentinel was created on first run, subsequent boots returned
  early without copying anything, so any new bundled agents we
  added in later releases never reached existing users. Switched
  to per-file existence checks on every boot: copy missing files,
  never overwrite. Cleans up the legacy sentinel along the way.
  Means future bundled agents will always reach existing users.
- **Layout templates modal restyled.** Same visual language as the
  Tasks modal — 12px corner radius, gradient bloom on hover (lower
  50% of the card), accent border + soft drop shadow on hover.
  Preview cells use `color-mix` of the accent colour with the dark
  base so they read as soft tints rather than bright yellow blocks.
  Each card now has both a label and a one-line hint ("Quad —
  small team", "Maximum spread") so the layout's purpose is more
  than just a count.
- **Layouts apply has an agent-loss confirmation.** Picking a
  layout while at least one pane has an agent bound (or the Lead
  pane is live) now prompts with the list of sessions that'll be
  stopped before applying. When every pane is idle, applies
  directly with no extra click.
- **Workspace-bar launcher buttons share chrome.** Split H, Split
  V, Layout templates, and Tasks now all carry the same dark
  rounded background as the Settings gear via a new `framed` prop
  on `IconButton`. The cluster reads as one row of identical
  chips. (`framed` is separate from `active` so toggle-state
  semantics on the sidebar collapse stay correct.)

### Fixed

- **Tasks card layout consistency.** Cards now stack one per row at
  full modal width and size to their content — short single-agent
  templates stay compact, longer ones stretch as needed. No more
  empty space on cards with fewer chips than their neighbours.
- **Agent badges across the app match.** Task-card agent chips now
  use the exact same `.pane-meta-chip` styling as the chips in the
  pane header (mono font, 4px corner radius, 3×6 padding, agent
  slug rather than humanized label). On card hover, chips pick up
  the same accent-tinted background + white text the pane header
  uses for the active pane — so the visual language is consistent
  whether you're looking at a card or a pane.

[1.7.0]: https://github.com/eimis1990/inzone/compare/v1.6.0...v1.7.0

## [1.6.0] — 2026-05-06

### Added

- **Settings → About page.** New entry at the bottom of the
  Settings drawer. Shows the running app version, a manual "Check
  for updates" button that delegates to electron-updater (so a
  found update lands at the same Restart now / Later prompt as
  the background poll), and the last 5 release notes parsed from
  CHANGELOG.md. Releases render as collapsible cards with tinted
  Added / Changed / Fixed headings (green / accent / orange) and
  bold-title + dimmed-body bullets so you can scan them quickly.
  The current version is highlighted with an accent badge, and
  CHANGELOG.md ships in the packaged app via `extraResources` so
  the notes work offline.
- **Settings → Agents table.** Replaced the two-column card grid
  with a sortable table — # · Agent (humanized name + emoji
  avatar) · Description · Model · Capabilities (skills/MCP
  counts) · Scope. Click any column header to sort; first click
  sets the key (asc), second flips to desc. Whole row is a click
  target that opens the editor. Single-line description with the
  full text in a tooltip — much easier to scan once your library
  passes ~6 agents than the old card grid was.
- **Settings → Skills table.** Same tabular treatment — # · Skill
  (📚 + humanized name) · Description · Scope, sortable by name.
  Skills page now reads as a sibling of the Agents page.
- **Expanded composer carries agent identity.** When you click the
  ⤡ button to pop the composer into a 60×60% modal, the modal
  head shows the agent's avatar + name on the left, the slug +
  model chips on the right, and the textarea border + chip
  borders are tinted with the agent's colour. No more guessing
  which pane the long message will land in.

### Changed

- **Settings opens Profile by default.** The gear-icon Settings
  button used to land on Agents — buried under the top entry.
  Now opens Profile, matching the nav order so the user lands
  where their eye goes first.
- **Pane header redesigned.** Header is ~20% taller (62px vs.
  52px) so the avatar + name + chips have room to breathe.
  Active-pane bottom stripe replaced with a soft vertical
  gradient bloom in the agent's colour that fills the lower 50%
  of the header, with a 1.5px hard line at the bottom edge as a
  focus anchor. Reads as a presence cue rather than a UI rule.
- **Pane chips tint with the agent's colour when active.** The
  agent slug + model + cost chips on an active pane now get a
  soft tint of the agent's colour (~22% blend into the dark
  base, ~55% on the border). At rest they keep the muted look —
  so the active pane reads as the foreground at a glance.
- **Pane status restructured.** The right-hand status badge is no
  longer a single pill. Top row: status dot + label as plain
  inline text in the variant's tint colour (green for completed,
  accent for working, red for error). Bottom row: cost as a
  meta-chip pill matching the agent slug + model chips on the
  left. Right side now mirrors the title block on the left
  visually.
- **Default 🤖 emoji on panes.** When the bound agent has no
  custom emoji, the pane's avatar slot now falls back to 🤖
  instead of disappearing entirely.
- **Worker cards (sidebar) restyled.** Dropped the 4px left
  pillar + tinted icon column. Cards now have a 12px corner
  radius and the same gradient-bloom treatment as the active
  pane header — solid dark base, full 1px agent-coloured border,
  bottom-half gradient in the agent's colour, matching badge
  tints. Terminal preset cards use the same recipe but driven by
  the purple `--accent-2` colour family so the two worker types
  stay visually distinct.
- **Lead/Multi switch + Flow chip resized.** Mode track went
  from 38→30px outer height to match the `.wb-pill` family
  (Preview / Workspaces / Usage); Flow chip went to 26px so it
  visually matches the highlighted segment thumb. Workspace bar
  now reads as one row of equal-height pills.
- **Stronger agent system-prompt generator.** Rewrote the
  meta-prompt with 9 mandatory sections (Core Responsibilities,
  Workspace, Context Discovery, Workflow, Domain Best Practices,
  Validation, Guardrails, Collaboration & Handoff) and role-aware
  hints — the prompt teaches the new agent to inspect different
  files for frontend vs. mobile vs. backend vs. reviewer vs.
  extractor work, rather than emitting generic advice. Length
  target raised from 50–130 to 90–180 lines, output cleanup is
  more aggressive, and a hardcoded fallback prompt ships in the
  file so the editor never lands on an empty body if the SDK
  errors.
- **Enhance description button.** New ✨ Enhance pill next to
  the agent description label. Type a one-line role, click
  Enhance, and Sonnet rewrites it as 3 short paragraphs (role ·
  domain knowledge · how it works in a repo). Works as the
  natural setup step before the existing Generate prompt button.
- **AI buttons (Enhance + Generate) redesigned.** Custom inline
  SparkleIcon (rotates 15° on hover with a soft accent glow), a
  proper top-to-bottom gradient fill, an inset highlight, and a
  colored shadow that intensifies on hover. The two buttons
  share the same look so they read as a family.
- **Generate prompt button moved.** Was at the bottom of the
  editor below a 1280px CodeMirror; now sits at the top-right of
  the System prompt section header with a small explanatory
  hint underneath. No more scrolling to find the action.

### Fixed

- **Minimum pane size enforced.** Splitting a pane is now blocked
  when the resulting children would render below 320px wide
  (horizontal split) or 220px tall (vertical split). On fail
  the user sees a friendly alert suggesting they try the other
  axis or close another pane first. Prevents the layout from
  collapsing into a wall of unreadable 150px columns.
- **Manual drag-resize floor raised.** The react-resizable-panels
  per-panel `minSize` bumped from 15% to 20% so dragging the
  resize handle can't crush a sibling pane below a fifth of its
  parent's space.
- **Active pane chips no longer get the gradient bleed.** Header
  children now sit at z-index 2 above the gradient bloom layer,
  so chip backgrounds + text render cleanly instead of getting
  tinted by the bloom underneath.
- **Active card background opaque.** The sidebar's yellow brand
  pattern was bleeding through the active worker card's
  semi-transparent base. Active state now forces `var(--bg)` so
  the only colour present is the explicit gradient bloom + the
  agent-coloured border.

[1.6.0]: https://github.com/eimis1990/inzone/compare/v1.5.2...v1.6.0

## [1.5.2] — 2026-05-06

### Added

- **About page in Settings.** New "About" entry at the bottom of the
  Settings drawer. Shows the running app version, a manual "Check
  for updates" button that delegates to electron-updater (so a found
  update lands at the same Restart now / Later prompt as the
  background poll), and the last 5 release notes parsed straight
  from CHANGELOG.md. Each release renders as a collapsible card —
  Added / Changed / Fixed sections get tinted headings (green /
  accent / orange) and bullets show as bold-title + dimmed-body for
  scannable reading. The current version is highlighted with an
  accent badge so you can see at a glance whether you're on the
  latest. CHANGELOG.md ships with the packaged app via
  `extraResources` so the release notes are available offline.

### Changed

- **Settings opens Profile by default.** The gear-icon Settings
  button used to land on Agents — buried under the top entry. Now
  it opens Profile, matching the nav order so the user lands where
  their eye naturally goes first (account / API key status). The
  drawer's internal default also updated for callers that don't
  pass an explicit section.
- **Active pane header has a gradient bloom.** The 2px hard accent
  stripe at the bottom of the active pane's header is now a soft
  vertical gradient that fills the lower 40% of the header — fully
  transparent at the top, ramping up to the agent's colour at the
  bottom edge with a 22% peak alpha. A 1.5px hard line still sits
  at the very bottom as a focus anchor. Reads as a presence cue
  rather than a UI rule, and works with every agent colour because
  the gradient stop pulls from `--pane-active-stripe`.
- **Pane header chips are now opaque over the gradient.** The agent
  badge, model chip, and idle status pill used to render at default
  z-index (so the absolutely-positioned gradient bloom underneath
  bled through) and the idle status pill was using a translucent
  white-on-black fill. Header children now lift to z-index 2 above
  the gradient layers, and the idle badge uses `var(--bg-elev-2)`
  for an opaque base, so the chips read crisply regardless of
  which agent colour the active pane stripe is using.

[1.5.2]: https://github.com/eimis1990/inzone/compare/v1.5.1...v1.5.2

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
