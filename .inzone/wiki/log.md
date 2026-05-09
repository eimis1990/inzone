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
