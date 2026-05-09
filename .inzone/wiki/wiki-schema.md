# Wiki Schema

This file is the **contract** for the LLM that maintains this wiki.
Read it before every wiki operation (ingest, query, lint, edit).
It defines structure, conventions, and workflows — the rules that
turn a generic agent into a disciplined wiki maintainer.

The schema is co-authored: edit this file when conventions evolve,
and the LLM updates its behavior accordingly. Never delete or rename
sections without recording the change in `log.md`.

## Wiki location

Root: `.inzone/wiki/` (relative to project root).
The wiki lives inside the project repo so it's committed to git
and shared with the team. Treat it as a first-class artifact.

## Folder layout

```
.inzone/wiki/
├── wiki-schema.md      # this file — the contract
├── index.md            # curated table of contents (LLM-maintained)
├── log.md              # append-only chronological journal
├── architecture.md     # system overview, top-level shape
├── gotchas.md          # landmines, surprises, things that bit us
├── glossary.md         # project-specific terms
├── decisions/          # one ADR-style file per major decision
└── conventions/        # coding patterns, naming, error handling
```

New top-level categories may be added (e.g. `api/`, `models/`,
`runbooks/`) but **must be documented in this schema** before
pages are added there. Add a section under "Custom categories"
below describing the category's purpose.

## Page conventions

Every content page (except `log.md` and `index.md`) ends with
a **Sources** section that records the page's provenance:

```markdown
## Sources

- src/main/sessions.ts (lines 200-450)
- .claude/agents/backend-developer.md
- commit a1b2c3d4
- Wiki: [[architecture]], [[decisions/api-versioning]]
```

The lint pass uses this to detect stale pages — when any cited
file changes, the page should be re-verified.

Cross-link other wiki pages with **`[[wikilink]]`** syntax
(Obsidian-compatible) using the path-relative-to-wiki-root
without the .md extension:

  - `[[architecture]]` → `architecture.md`
  - `[[decisions/api-versioning]]` → `decisions/api-versioning.md`

Use **`[label](relative/path.ts)`** for links INTO source code.
Wikilinks for wiki pages, regular links for code.

## index.md curation

The index is a content-organised table of contents — not a
generated file listing. Group pages by topic, not alphabetically.
Update it whenever new pages are added or important topics shift.

## log.md format

Append-only. Each entry starts with a parseable header:

```markdown
## [YYYY-MM-DD] <type> | <short title>

<body>
```

Types in use:
- **init** — wiki bootstrap / re-bootstrap events
- **ingest** — a source was read and pages updated
- **query** — a synthesis answer worth keeping (file the answer
  itself as a content page; log records the question + which
  pages now hold the answer)
- **lint** — health check ran; what was flagged
- **edit** — manual edits by humans worth recording
- **decide** — a new decision was filed under `decisions/`

## Workflows

### Ingest
1. Read the new source.
2. Identify which existing pages are affected (typically 5-15).
3. Update each affected page in place; add cross-links.
4. Create new entity / concept pages where needed.
5. Update `index.md` to reflect new content.
6. Append a `## [date] ingest | <source>` entry to `log.md`
   listing every page touched.

### Query
1. Read the wiki, NOT the raw source code, unless the query is
   about a fact the wiki doesn't cover.
2. Synthesize an answer with [[wikilink]] citations.
3. If the answer reveals genuinely new connections worth
   preserving, file it back as a new content page (under the
   appropriate category) and log a `query` entry.

### Lint
1. Walk every page; compare its **Sources** section against the
   actual files / commits cited.
2. Flag stale pages (cited file modified since page was written).
3. Flag orphan pages (no incoming wikilinks from anywhere else).
4. Flag broken wikilinks (target page missing).
5. Flag contradictions (claims in two pages that disagree).
6. Suggest gaps (parts of the codebase with no wiki coverage).
7. Append the report as a `lint` entry to `log.md`.

### Filing decisions
Decisions go under `decisions/` as one file per topic.
Filename = kebab-case of the decision name. Each starts with:

```markdown
# <Decision title>

**Status**: accepted | proposed | superseded
**Date**: YYYY-MM-DD
**Supersedes**: [[decisions/older-decision]] (if any)

## Context

<the situation that prompted the decision>

## Decision

<what was decided>

## Consequences

<what follows from this>

## Sources

<citations>
```

## Custom categories

(empty — add new top-level categories here when they're created)

## Co-evolution

This schema is a living document. When the LLM and the human
agree a convention should change (or a new one should exist),
edit this file FIRST and append an `edit` entry to `log.md`.
The wiki content can then evolve to match.
