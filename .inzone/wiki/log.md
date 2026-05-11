# Log

Append-only chronological journal. Each entry starts with a
parseable header: `## [YYYY-MM-DD] <type> | <short title>`.

See [[wiki-schema]] for the full format.

## [2026-05-09] init | wiki initialised

Bootstrapped the wiki for INZONE itself. Until now we'd shipped the
wiki feature without dogfooding it on this codebase — the cobbler's
children. Starter pages created via the same skeleton `WIKI_INIT`
writes for users (`wiki-schema.md`, `index.md`, `log.md`,
`architecture.md`, `gotchas.md`, `glossary.md`, `decisions/`,
`conventions/`).

Seeded the architecture, gotchas, glossary, and four decision pages
with content distilled from working memory of the codebase rather
than copy-pasting the existing top-level docs (ARCHITECTURE.md,
FEATURES.md, RELEASE.md). Those stay at the top level for their
existing audiences (GitHub readers, marketing, semver release
notes); the wiki is the living memory across agent sessions.

## [2026-05-09] decide | record key product / architecture decisions

Filed four decisions under `decisions/`: electron-over-tauri,
safestorage-over-keytar, anthropic-only, elevenlabs-over-whisper.
Each captures the reasoning behind a choice that shouldn't be
re-litigated by future agents who might naively suggest "have you
considered Tauri / keytar / multi-provider / Whisper?"

## [2026-05-09] edit | gotcha: auto-scroll falls behind streaming

Added a gotcha entry covering the v1.10.0 fix to v1.9.0's
auto-scroll pin: items-length-only effect missed streaming text
growth within an existing message, so "Jump to latest" landed once
and then fell behind as content kept arriving. Wrapper +
ResizeObserver + drop smooth-scroll in jumpToBottom. Updated
[[gotchas]].

## [2026-05-09] edit | gotcha: resize handles eat in-pane popovers

Added a gotcha covering the v1.10.2 fix to the per-pane ⋮ menu's
"Close pane doesn't hover" bug. PanelResizeHandle from
react-resizable-panels stacks above the menu in PanelGroup's
context regardless of in-pane z-index. Fix: portal the menu to
`document.body` with `position: fixed`. Applies to both PaneMoreMenu
(agent panes) and TerminalPaneMenu (terminal panes). Updated
[[gotchas]].

## [2026-05-10] edit | bundled agents → Sonnet + per-turn cost delta

Two cost-related changes for v1.12.0:

1. Flipped 5 bundled coding agents from `model: opus` to
   `model: claude-sonnet-4-6` (backend / frontend / fullstack /
   mobile developers + frontend-website-redesign). While in
   there, also locked the rest of the bundle (code-reviewer,
   lead-users-agent, mobile-design, mobile-code-reviewer,
   solo-founder, website-data-extractor) from the `sonnet` alias
   to the explicit `claude-sonnet-4-6` so the version is pinned
   rather than tracking whatever "latest Sonnet" resolves to. At
   Anthropic's pricing Opus is ~5x Sonnet, and Sonnet 4.6 is
   plenty for routine coding work. Users who want Opus can flip
   the dropdown per-agent. Existing installs are untouched —
   `bundled-resources.ts` never clobbers user-customised files.

2. Result block shows per-turn delta cost instead of cumulative
   session total. SDK's `total_cost_usd` is cumulative, which
   our previous renderer surfaced as if it were "this turn's
   cost". Fixed in [src/main/sessions.ts](../../src/main/sessions.ts) via prev-totals
   tracking + delta computation, plus a new gotcha entry
   ([[gotchas]] — `total_cost_usd from the SDK is cumulative`).
   Cumulative stays accessible via tooltip + Settings → Usage.

## [2026-05-10] edit | Printing Press preset + post-success error fix

Two things bundled into v1.12.0.

1. New Worker preset for Printing Press (printingpress.dev). Drop
   on a pane → `npx -y @mvanhorn/printing-press` launches. This
   is "Path A" of three possible integrations evaluated: lowest-
   cost surface that exposes the tool without vouching for any
   specific library entry. Path B (curating individual Press
   skills as Recommended Skills) and Path C (wrapping the Press
   generator inside INZONE directly) deferred until we see
   adoption.

2. Fix for the "ERROR_DURING_EXECUTION after success" UX bug.
   SDK emits a zero-stat error_during_execution result + then
   throws "Claude Code process exited with code 1" during
   cleanup after long successful turns. We now suppress the
   stub at dispatch time and downgrade the iterable throw to a
   soft 'stopped' status (no recovery banner) when the previous
   turn was a success. Filed full gotcha under
   [[gotchas]] (`SDK process exits non-zero after successful
   long turns`).

## [2026-05-10] edit | default agents on fresh session + Lead mode

Added `DEFAULT_FIRST_PANE_AGENT` (`fullstack-developer`) and
`DEFAULT_LEAD_AGENT` (`lead-users-agent`) constants at the top of
[store.ts](../../src/renderer/src/store.ts). Wired into `pickFolder`
(initial pane on new project) and `setWindowMode` (only when the
Lead pane is freshly materialised, never overwriting an existing
binding). Both fall through silently if the user has deleted the
bundled starter, so we never error on a "missing default".

The `pickFolder` path defends against a race: if `refreshAgents`
hasn't completed at the moment of folder selection, the find
returns undefined, so we also kick off `window.cowork.agents.list`
and retry after it resolves — but only if the pane is still
empty, so we don't clobber a manual binding the user made in the
meantime.

## [2026-05-10] edit | fix Awesome Design install + wrap pattern

v1.11.0 shipped, user tried installing the Awesome Design
recommended skill → install errored with "missing SKILL.md".
Looked at the actual repo (VoltAgent/awesome-design-md) — it's a
collection of DESIGN.md files from 30+ websites, no SKILL.md
anywhere. The original assumption that every recommended-skill
repo ships a SKILL.md was wrong.

Added `generateSkillMd` field on `RecommendedSkill` so raw-
resource repos can be wrapped on install with a generated SKILL.md
that tells Claude how to navigate the bundled content. Updated
the Awesome Design entry to use the whole repo (preserves MIT
LICENSE) plus a generated wrapper that points to
`design-md/<brand>/DESIGN.md`.

Filed [[gotchas]] entry "Not every recommended-skill repo ships a
SKILL.md" so future entries follow the wrap-it-up pattern.

## [2026-05-09] edit | v1.11.0 perf pass — memo, coalesce, pause polls

Shipped the four perf wins identified in the audit:

1. `React.memo(Markdown)` with default text equality.
2. `React.memo(MessageView, areMessagePropsEqual)` with a custom
   comparator that handles `ToolBlockView` wrapper churn from
   `buildViewItems()`. The comparator checks the underlying
   store-stable refs (`a.input === b.input`, `a.result?.content
   === b.result?.content`) instead of the wrapper identity.
3. Coalesce consecutive `assistant_text` events into one growing
   item (when no tool_use between them).
4. Bundled Pane's seven action-getter subscriptions into one
   `useShallow` call.
5. `SidebarFooter` / `AgentSidebar` install probe / `PreviewButton`
   port sweep now pause on window blur, matching the pattern
   already in `App.tsx`'s PR poll.

Captured the [[conventions/memoisation]] page documenting the
pattern so future agents adding heavy components reach for memo
correctly. Indexed under Conventions.

## [2026-05-09] edit | add perf measurement page + dev-only overlay

Created [[perf-measurement]] documenting the four metrics we care
about (streaming FPS, MessageView/Markdown render counts, heap), the
tools (PerfOverlay ⌘⇧P, Activity Monitor, Chrome DevTools, React
Profiler), and the five-test baseline protocol. Added the PerfOverlay
component itself ([src/renderer/src/perf/](../../src/renderer/src/perf/)) — dev-only via
`import.meta.env.DEV`, zero cost in production builds. Wired
useRenderCount into Pane, MessageView, ToolBlock, Markdown,
AgentSidebar, WorkspaceBar.

Static analysis suggests biggest wins come from React.memo on
MessageView + Markdown + ToolBlock (5–10x render speed on long
transcripts) and coalescing successive assistant_text chunks into
the prior item (cuts re-render frequency during streaming). Not
shipping the optimisations yet — measure first, then target.

## [2026-05-09] edit | gotcha: require is undefined in ESM main +
wipe-before-write loses user data

Added two related gotchas covering the v1.10.2 voice-key fix.
v1.10.0 shipped a migration from plaintext electron-store to
encrypted safeStorage with two compounding bugs: `require('fs')`
in an ESM main process (silently failed), and the save flow wiped
the legacy plaintext BEFORE the encrypted write completed (fire-
and-forget `void`). Users whose first action post-upgrade was
opening Voice settings + Save lost their key entirely. Manifested
as "could not establish signal connection: Failed to fetch" because
the missing key forced the public-agent path against private
agents.
