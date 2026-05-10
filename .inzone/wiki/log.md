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
