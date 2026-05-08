/**
 * LLM Wiki — file ops over <project>/.inzone/wiki/.
 *
 * Treat as the storage layer for Karpathy's LLM Wiki pattern:
 *   - Raw sources (the codebase) are immutable from the wiki's POV.
 *   - The wiki is a folder of markdown pages the LLM owns.
 *   - The schema (wiki-schema.md) is the contract the LLM consults
 *     before every wiki op so it stays a disciplined maintainer.
 *
 * This module:
 *   - Initialises the starter folder + writes a comprehensive
 *     wiki-schema.md when called via initWiki().
 *   - Provides safe CRUD over the wiki tree. Every read/write rejects
 *     paths that escape the wiki root (no `..`, no absolute paths).
 *   - Lists pages for the UI tree (excluding the .cache directory).
 *   - Appends entries to log.md atomically.
 *
 * It does NOT call any LLM. The renderer + agents drive ingest /
 * query / lint workflows; this layer is just the storage.
 */

import { promises as fs } from 'fs';
import path from 'path';
import type {
  WikiLogEntry,
  WikiPageMeta,
  WikiStatus,
} from '@shared/types';

/** Cap on how many recent log entries we ship over IPC with each
 *  status fetch. Five is enough for the expanded dashboard panel
 *  without inflating the payload as log.md grows over months. */
const WIKI_RECENT_ENTRIES_MAX = 5;

/** Folder under the project that holds the whole wiki, plus the
 *  schema, log, index, and cache. Hidden-ish (`.inzone`) so it
 *  doesn't clutter top-level project listings. Fully gitignore-able
 *  by the user, but the wiki itself is *meant* to be committed —
 *  team-shared institutional memory is the unlock. */
const WIKI_DIR = path.join('.inzone', 'wiki');
const SCHEMA_FILENAME = 'wiki-schema.md';
const INDEX_FILENAME = 'index.md';
const LOG_FILENAME = 'log.md';
const CACHE_DIRNAME = '.cache';

// ── Path safety ────────────────────────────────────────────────────

/**
 * Resolve a relative wiki path to an absolute one, rejecting any
 * path that escapes the wiki root. Renderer-supplied paths can't be
 * trusted; this is the gate.
 */
function resolveWikiPath(cwd: string, rel: string): string {
  if (!cwd || cwd.trim().length === 0) {
    throw new Error('No active project — wiki ops require a cwd.');
  }
  if (path.isAbsolute(rel)) {
    throw new Error(`Wiki path must be relative, got absolute: ${rel}`);
  }
  // Normalize and reject any traversal.
  const root = path.resolve(cwd, WIKI_DIR);
  const target = path.resolve(root, rel);
  if (!target.startsWith(root + path.sep) && target !== root) {
    throw new Error(`Wiki path escapes the wiki root: ${rel}`);
  }
  return target;
}

/** Absolute path to the wiki root for a given project. */
function wikiRoot(cwd: string): string {
  return path.resolve(cwd, WIKI_DIR);
}

// ── Status / init ──────────────────────────────────────────────────

/**
 * Probe a project for an initialized wiki. Always succeeds — never
 * throws. The UI uses this on first open to decide between "set up
 * the wiki" and live data. Cheap (~1 ms).
 */
export async function getWikiStatus(cwd: string): Promise<WikiStatus> {
  const root = wikiRoot(cwd);
  try {
    const schemaStat = await fs.stat(path.join(root, SCHEMA_FILENAME));
    if (!schemaStat.isFile()) {
      return {
        initialized: false,
        rootPath: root,
        pageCount: 0,
        hasIngested: false,
        recentEntries: [],
      };
    }
  } catch {
    return {
      initialized: false,
      rootPath: root,
      pageCount: 0,
      hasIngested: false,
      recentEntries: [],
    };
  }
  // Initialised — gather some quick stats. Walking pages is cheap
  // for a few hundred files; we cap at 1000 entries to be safe.
  const pages = await listAllPages(cwd, { max: 1000 });
  let lastUpdatedAt: string | undefined;
  for (const p of pages) {
    if (!lastUpdatedAt || p.modifiedAt > lastUpdatedAt) {
      lastUpdatedAt = p.modifiedAt;
    }
  }
  // Parse log.md once. We derive: hasIngested (any non-init ingest
  // entry exists?), lastIngestAt (date of most-recent ingest entry),
  // recentEntries (newest WIKI_RECENT_ENTRIES_MAX entries of any
  // type). Doing it in one read keeps status fetches cheap as the
  // log grows.
  const parsed = await parseLog(cwd);
  return {
    initialized: true,
    rootPath: root,
    pageCount: pages.length,
    lastUpdatedAt,
    hasIngested: parsed.hasIngested,
    lastIngestAt: parsed.lastIngestAt,
    recentEntries: parsed.recentEntries,
  };
}

interface ParsedLog {
  hasIngested: boolean;
  lastIngestAt?: string;
  recentEntries: WikiLogEntry[];
}

/**
 * Walk log.md and pull out:
 *   - hasIngested: at least one `ingest`-typed header beyond init
 *   - lastIngestAt: the date string from the most-recent ingest entry
 *   - recentEntries: parsed entries (newest first), capped
 *
 * The schema asks the LLM to use:
 *   `## [YYYY-MM-DD] <type> | <title>`
 * so we match that exact shape. Headers that don't match the pattern
 * are skipped (defensive against the LLM occasionally drifting).
 *
 * Returns empty/false defaults on read failures so the dashboard
 * gracefully degrades rather than failing the whole status fetch.
 */
async function parseLog(cwd: string): Promise<ParsedLog> {
  const root = wikiRoot(cwd);
  let content: string;
  try {
    content = await fs.readFile(path.join(root, LOG_FILENAME), 'utf8');
  } catch {
    return { hasIngested: false, recentEntries: [] };
  }

  // Split on entry headers — each entry starts with `## [` at column 0.
  // The first chunk (before any `##`) is preamble (the file's intro
  // paragraph) and gets dropped.
  const headerRe = /^##\s*\[([^\]]+)\]\s*([A-Za-z][\w-]*)\s*\|\s*(.*)$/gm;
  const headers: Array<{
    index: number;
    date: string;
    type: string;
    title: string;
    headerLineEnd: number;
  }> = [];
  let m: RegExpExecArray | null;
  while ((m = headerRe.exec(content))) {
    headers.push({
      index: m.index,
      date: m[1].trim(),
      type: m[2].trim().toLowerCase(),
      title: m[3].trim(),
      headerLineEnd: m.index + m[0].length,
    });
  }

  if (headers.length === 0) {
    return { hasIngested: false, recentEntries: [] };
  }

  // Build full entries with bodies. Body runs from the end of this
  // header's line to the start of the next header (or EOF).
  const entries: WikiLogEntry[] = headers.map((h, i) => {
    const bodyStart = h.headerLineEnd;
    const bodyEnd = i + 1 < headers.length ? headers[i + 1].index : content.length;
    return {
      date: h.date,
      type: h.type,
      title: h.title,
      body: content.slice(bodyStart, bodyEnd).trim(),
    };
  });

  // hasIngested: any entry of type 'ingest'. (The init bootstrap is
  // type 'init', so it's already excluded.)
  const ingestEntries = entries.filter((e) => e.type === 'ingest');
  const hasIngested = ingestEntries.length > 0;

  // lastIngestAt: max date across ingest entries. We compare strings
  // assuming YYYY-MM-DD format; the schema requires it. Falls back
  // to the entry order if dates are inconsistent (pick the last
  // ingest entry that appears in the file).
  let lastIngestAt: string | undefined;
  for (const e of ingestEntries) {
    if (!lastIngestAt || e.date > lastIngestAt) lastIngestAt = e.date;
  }
  if (!lastIngestAt && ingestEntries.length > 0) {
    lastIngestAt = ingestEntries[ingestEntries.length - 1].date;
  }

  // recentEntries: newest first. We've parsed them top-down (so file
  // order = oldest-first if the LLM appends as required), so reverse
  // and slice.
  const recentEntries = entries.slice().reverse().slice(0, WIKI_RECENT_ENTRIES_MAX);

  return { hasIngested, lastIngestAt, recentEntries };
}

/**
 * Create the starter wiki structure if absent. Idempotent — calling
 * twice is a no-op the second time. Returns the new status.
 *
 * The starter has just enough opinionated structure for the LLM to
 * file things consistently from day one (decisions/, conventions/,
 * etc.) plus a comprehensive schema document that doubles as the
 * agent's "how to behave" instructions.
 */
export async function initWiki(cwd: string): Promise<WikiStatus> {
  const root = wikiRoot(cwd);
  await fs.mkdir(root, { recursive: true });
  await fs.mkdir(path.join(root, 'decisions'), { recursive: true });
  await fs.mkdir(path.join(root, 'conventions'), { recursive: true });
  await fs.mkdir(path.join(root, CACHE_DIRNAME), { recursive: true });

  // Cache dir is regeneratable — never commit it.
  await writeIfMissing(
    path.join(root, CACHE_DIRNAME, '.gitignore'),
    '# Regeneratable derivatives — search indices, embeddings, etc.\n*\n!.gitignore\n',
  );

  // Skeleton content pages. Each one ships with a "Sources" stub so
  // the convention is visible from the start. The LLM will overwrite
  // these as it ingests real content; first-time content acts as a
  // user-visible welcome.
  await writeIfMissing(path.join(root, INDEX_FILENAME), STARTER_INDEX);
  await writeIfMissing(path.join(root, LOG_FILENAME), STARTER_LOG);
  await writeIfMissing(path.join(root, 'architecture.md'), STARTER_ARCHITECTURE);
  await writeIfMissing(path.join(root, 'gotchas.md'), STARTER_GOTCHAS);
  await writeIfMissing(path.join(root, 'glossary.md'), STARTER_GLOSSARY);
  await writeIfMissing(
    path.join(root, 'decisions', 'README.md'),
    STARTER_DECISIONS_README,
  );
  await writeIfMissing(
    path.join(root, 'conventions', 'README.md'),
    STARTER_CONVENTIONS_README,
  );

  // The schema is the contract — write it last so partial inits
  // don't leave an unitialized wiki looking initialized.
  await writeIfMissing(path.join(root, SCHEMA_FILENAME), STARTER_SCHEMA);

  // Append an init-marker entry to the log so the journal starts
  // with a clean record.
  await appendLogEntry(
    cwd,
    `## [${todayIso()}] init | wiki initialised\n\nStarter pages created. Awaiting first ingest.\n\n`,
  );

  return getWikiStatus(cwd);
}

async function writeIfMissing(filePath: string, content: string): Promise<void> {
  try {
    await fs.access(filePath);
    // Exists — leave whatever the user / LLM has built there.
  } catch {
    await fs.writeFile(filePath, content, 'utf8');
  }
}

// ── List / read / write ────────────────────────────────────────────

/**
 * Recursively list every .md page under the wiki root, skipping the
 * cache directory. Returns paths relative to the root with forward
 * slashes (cross-platform). Sorted by path so the UI is stable.
 */
export async function listAllPages(
  cwd: string,
  opts: { max?: number } = {},
): Promise<WikiPageMeta[]> {
  const root = wikiRoot(cwd);
  try {
    await fs.access(root);
  } catch {
    return [];
  }
  const max = opts.max ?? 5000;
  const out: WikiPageMeta[] = [];

  async function walk(dir: string): Promise<void> {
    if (out.length >= max) return;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name === CACHE_DIRNAME) continue; // skip regenerable cache
      if (entry.name.startsWith('.')) continue; // skip dotfiles (.gitignore, etc.)
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!entry.name.endsWith('.md')) continue;
      const stat = await fs.stat(abs);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      out.push({
        path: rel,
        name: entry.name,
        bytes: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        isSchema: rel === SCHEMA_FILENAME,
      });
      if (out.length >= max) return;
    }
  }

  await walk(root);
  out.sort((a, b) => a.path.localeCompare(b.path));
  return out;
}

/** Read the full contents of one wiki page. Throws if path escapes
 *  the root or the file doesn't exist. */
export async function readPage(cwd: string, rel: string): Promise<string> {
  const abs = resolveWikiPath(cwd, rel);
  return fs.readFile(abs, 'utf8');
}

export interface WikiSearchHit {
  /** Page-relative path, e.g. "architecture.md" or "decisions/auth.md". */
  path: string;
  /** Number of times the query matched in this page (case-insensitive). */
  count: number;
  /** Up to N short context excerpts around the matches — caller-side
   *  rendering can show them as line-anchored snippets. */
  snippets: string[];
}

/**
 * Case-insensitive substring search across every wiki page. Returns
 * the top `limit` pages sorted by match count (descending). For each
 * hit we include up to 3 short snippets around the match positions
 * so callers (the voice agent, in particular) can speak answers
 * grounded in real wiki content rather than hallucinating.
 *
 * Performance is fine for typical wikis (≤ a few dozen pages, a few
 * hundred KB each); we read each .md once and scan in-memory. Long
 * pages stop contributing snippets after the first 3 matches.
 */
export async function searchWiki(
  cwd: string,
  query: string,
  opts: { limit?: number } = {},
): Promise<WikiSearchHit[]> {
  const trimmed = query?.trim() ?? '';
  if (!trimmed) return [];
  const needle = trimmed.toLowerCase();
  const limit = Math.max(1, Math.min(opts.limit ?? 5, 20));

  const pages = await listAllPages(cwd);
  const hits: WikiSearchHit[] = [];

  for (const page of pages) {
    let raw: string;
    try {
      raw = await readPage(cwd, page.path);
    } catch {
      continue;
    }
    const haystack = raw.toLowerCase();
    let cursor = 0;
    let count = 0;
    const snippets: string[] = [];
    while (cursor < haystack.length) {
      const idx = haystack.indexOf(needle, cursor);
      if (idx === -1) break;
      count++;
      // First 3 matches contribute snippets; subsequent matches
      // just bump the count so popularity ranking still works.
      if (snippets.length < 3) {
        const start = Math.max(0, idx - 60);
        const end = Math.min(raw.length, idx + needle.length + 60);
        const slice = raw.slice(start, end).replace(/\s+/g, ' ').trim();
        snippets.push(
          (start > 0 ? '…' : '') + slice + (end < raw.length ? '…' : ''),
        );
      }
      cursor = idx + needle.length;
    }
    if (count > 0) {
      hits.push({ path: page.path, count, snippets });
    }
  }

  // Sort by count desc, then by path asc for stable ordering.
  hits.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
  return hits.slice(0, limit);
}

/** Create or overwrite a wiki page. Creates intermediate
 *  directories as needed. Throws on path escape. */
export async function writePage(
  cwd: string,
  rel: string,
  content: string,
): Promise<void> {
  const abs = resolveWikiPath(cwd, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf8');
}

/** Delete a wiki page. Used by the lint pass to remove orphans the
 *  LLM has flagged. Throws on path escape; refuses to delete the
 *  schema file. */
export async function deletePage(cwd: string, rel: string): Promise<void> {
  if (rel === SCHEMA_FILENAME) {
    throw new Error('Refusing to delete the wiki schema. Edit it instead.');
  }
  const abs = resolveWikiPath(cwd, rel);
  await fs.unlink(abs);
}

// ── Log ────────────────────────────────────────────────────────────

/**
 * Append an entry to log.md. The schema asks the LLM to format
 * entries with a parseable header line:
 *   ## [YYYY-MM-DD] type | title
 * but we don't enforce that here — just append. Atomic-ish via a
 * single writeFile with the existing content + new entry; good
 * enough since wiki ops are one-at-a-time per project.
 */
export async function appendLogEntry(
  cwd: string,
  entry: string,
): Promise<void> {
  const abs = resolveWikiPath(cwd, LOG_FILENAME);
  let existing = '';
  try {
    existing = await fs.readFile(abs, 'utf8');
  } catch {
    // No log yet — start it.
  }
  const sep = existing.endsWith('\n') || existing.length === 0 ? '' : '\n';
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, existing + sep + entry, 'utf8');
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ── Agent context block (Phase 3) ──────────────────────────────────

/**
 * Build the wiki-aware system-prompt fragment that gets appended to
 * every agent's system prompt when the project has an initialized
 * wiki. Returns `undefined` when the wiki isn't set up (so callers
 * can skip the block entirely without a try/catch).
 *
 * The block is composed of:
 *   1. A short instruction set telling the agent how to USE the wiki —
 *      read the schema before any wiki op, update pages inline as it
 *      learns, cross-link with [[wikilinks]], cite sources, don't
 *      invent details.
 *   2. The full text of `wiki-schema.md` (the contract). This is the
 *      same file the user can hand-edit; whatever conventions live
 *      there flow into the agent automatically.
 *   3. The full text of `index.md` (the curated TOC). Tells the agent
 *      which pages exist and what they cover so it can read on demand
 *      without listing the whole tree.
 *
 * We keep page bodies (architecture / glossary / gotchas / etc.) OUT
 * of this block on purpose — they grow with the project and would
 * inflate every agent turn's token cost. The agent has Read tool
 * access; once it knows what pages exist (via the index) it can pull
 * whichever ones are relevant to the current question.
 *
 * Read failures (corrupt wiki, partial init, FS errors) all collapse
 * to `undefined` — better to run the agent without wiki context than
 * to bork session startup over a missing index.
 */
export async function buildWikiContextBlock(
  cwd: string,
): Promise<string | undefined> {
  if (!cwd || cwd.trim().length === 0) return undefined;
  const root = wikiRoot(cwd);
  let schema: string;
  let index: string;
  try {
    schema = await fs.readFile(path.join(root, SCHEMA_FILENAME), 'utf8');
  } catch {
    // No wiki initialized for this project — no block.
    return undefined;
  }
  try {
    index = await fs.readFile(path.join(root, INDEX_FILENAME), 'utf8');
  } catch {
    // Schema present but index missing — fall back to a placeholder
    // so the rest of the block still ships. The agent knows from the
    // schema that index.md should exist and can recreate it.
    index = '_(index.md is missing — recreate it on the next ingest)_';
  }

  // Build the wrapped block. We use an XML-style envelope so the
  // agent's training prior treats it as a structured system context
  // rather than free-form prose. Same convention we use for skills /
  // coordination blocks in this project.
  return [
    '<wiki_context>',
    'This project has an LLM-maintained knowledge wiki at `.inzone/wiki/` (committed to the repo, shared with the team). It is the primary, authoritative knowledge base for the project — prefer it over re-reading raw source code when answering questions.',
    '',
    '## How to USE the wiki',
    '- **Read first.** When a question or task touches project knowledge, consult the index below to find the relevant page, then Read that page. Cite it with `[[wikilink]]` syntax in your answer.',
    '- **Update inline.** When you learn something worth recording during your turn — an architectural insight, a gotcha, a new term, a decision — update the relevant wiki page in place as part of your work. Append a short `## [YYYY-MM-DD] ingest | <change>` entry to `log.md` listing every page you touched.',
    '- **Read the schema before any wiki write.** `wiki-schema.md` (full text below) is the contract — folder layout, page conventions, log format, ADR template. Follow it.',
    '- **Cite sources.** Every content page has a `## Sources` section listing the files / commits / pages it draws from. Keep it accurate when you edit.',
    "- **Don't invent.** If something isn't in the code or in existing pages, leave it for a future ingest rather than fabricating.",
    '- **Cross-link.** Use `[[wikilink]]` between wiki pages, regular markdown links into source code.',
    '',
    '## wiki-schema.md (the contract)',
    '',
    schema.trim(),
    '',
    '## index.md (curated table of contents)',
    '',
    index.trim(),
    '</wiki_context>',
  ].join('\n');
}

// ── Starter content ────────────────────────────────────────────────

const STARTER_SCHEMA = `# Wiki Schema

This file is the **contract** for the LLM that maintains this wiki.
Read it before every wiki operation (ingest, query, lint, edit).
It defines structure, conventions, and workflows — the rules that
turn a generic agent into a disciplined wiki maintainer.

The schema is co-authored: edit this file when conventions evolve,
and the LLM updates its behavior accordingly. Never delete or rename
sections without recording the change in \`log.md\`.

## Wiki location

Root: \`.inzone/wiki/\` (relative to project root).
The wiki lives inside the project repo so it's committed to git
and shared with the team. Treat it as a first-class artifact.

## Folder layout

\`\`\`
.inzone/wiki/
├── wiki-schema.md      # this file — the contract
├── index.md            # curated table of contents (LLM-maintained)
├── log.md              # append-only chronological journal
├── architecture.md     # system overview, top-level shape
├── gotchas.md          # landmines, surprises, things that bit us
├── glossary.md         # project-specific terms
├── decisions/          # one ADR-style file per major decision
└── conventions/        # coding patterns, naming, error handling
\`\`\`

New top-level categories may be added (e.g. \`api/\`, \`models/\`,
\`runbooks/\`) but **must be documented in this schema** before
pages are added there. Add a section under "Custom categories"
below describing the category's purpose.

## Page conventions

Every content page (except \`log.md\` and \`index.md\`) ends with
a **Sources** section that records the page's provenance:

\`\`\`markdown
## Sources

- src/main/sessions.ts (lines 200-450)
- .claude/agents/backend-developer.md
- commit a1b2c3d4
- Wiki: [[architecture]], [[decisions/api-versioning]]
\`\`\`

The lint pass uses this to detect stale pages — when any cited
file changes, the page should be re-verified.

Cross-link other wiki pages with **\`[[wikilink]]\`** syntax
(Obsidian-compatible) using the path-relative-to-wiki-root
without the .md extension:

  - \`[[architecture]]\` → \`architecture.md\`
  - \`[[decisions/api-versioning]]\` → \`decisions/api-versioning.md\`

Use **\`[label](relative/path.ts)\`** for links INTO source code.
Wikilinks for wiki pages, regular links for code.

## index.md curation

The index is a content-organised table of contents — not a
generated file listing. Group pages by topic, not alphabetically.
Update it whenever new pages are added or important topics shift.

## log.md format

Append-only. Each entry starts with a parseable header:

\`\`\`markdown
## [YYYY-MM-DD] <type> | <short title>

<body>
\`\`\`

Types in use:
- **init** — wiki bootstrap / re-bootstrap events
- **ingest** — a source was read and pages updated
- **query** — a synthesis answer worth keeping (file the answer
  itself as a content page; log records the question + which
  pages now hold the answer)
- **lint** — health check ran; what was flagged
- **edit** — manual edits by humans worth recording
- **decide** — a new decision was filed under \`decisions/\`

## Workflows

### Ingest
1. Read the new source.
2. Identify which existing pages are affected (typically 5-15).
3. Update each affected page in place; add cross-links.
4. Create new entity / concept pages where needed.
5. Update \`index.md\` to reflect new content.
6. Append a \`## [date] ingest | <source>\` entry to \`log.md\`
   listing every page touched.

### Query
1. Read the wiki, NOT the raw source code, unless the query is
   about a fact the wiki doesn't cover.
2. Synthesize an answer with [[wikilink]] citations.
3. If the answer reveals genuinely new connections worth
   preserving, file it back as a new content page (under the
   appropriate category) and log a \`query\` entry.

### Lint
1. Walk every page; compare its **Sources** section against the
   actual files / commits cited.
2. Flag stale pages (cited file modified since page was written).
3. Flag orphan pages (no incoming wikilinks from anywhere else).
4. Flag broken wikilinks (target page missing).
5. Flag contradictions (claims in two pages that disagree).
6. Suggest gaps (parts of the codebase with no wiki coverage).
7. Append the report as a \`lint\` entry to \`log.md\`.

### Filing decisions
Decisions go under \`decisions/\` as one file per topic.
Filename = kebab-case of the decision name. Each starts with:

\`\`\`markdown
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
\`\`\`

## Custom categories

(empty — add new top-level categories here when they're created)

## Co-evolution

This schema is a living document. When the LLM and the human
agree a convention should change (or a new one should exist),
edit this file FIRST and append an \`edit\` entry to \`log.md\`.
The wiki content can then evolve to match.
`;

const STARTER_INDEX = `# Index

The wiki's curated table of contents. Update whenever pages are
added or topics shift — the LLM groups by **topic**, not by
filename. New entries get filed under the most relevant heading;
add new headings here when an organising theme emerges.

## Foundations

- [[architecture]] — system overview
- [[glossary]] — project-specific terms
- [[gotchas]] — landmines and surprises

## Decisions

- (none yet — see [[decisions/README]])

## Conventions

- (none yet — see [[conventions/README]])

## Activity

- [[log]] — chronological journal of wiki activity

## Sources

This is a curated index, so it has no specific source files.
The LLM updates it whenever the wiki shape changes.
`;

const STARTER_LOG = `# Log

Append-only chronological journal. Each entry starts with a
parseable header: \`## [YYYY-MM-DD] <type> | <short title>\`.

See [[wiki-schema]] for the full format.
`;

const STARTER_ARCHITECTURE = `# Architecture

System overview. Top-level shape of the project: what the major
modules are, how they fit together, where the boundaries are.

The LLM maintains this page as it ingests sources. Until the
first ingest, this page is a stub — replace this paragraph with
a real architecture summary.

## Sources

(empty — populate on first ingest)
`;

const STARTER_GOTCHAS = `# Gotchas

Landmines, surprises, things that bit us. Each gotcha is a short
section: what happened, why it bit, how to avoid.

The LLM appends to this page as it discovers issues during
ingestion or as humans share scars.

## Sources

(empty — populate as gotchas are documented)
`;

const STARTER_GLOSSARY = `# Glossary

Project-specific terms. Acronyms, internal names, domain concepts.
One term per entry, alphabetical.

## Sources

(empty — populate as terms are introduced)
`;

const STARTER_DECISIONS_README = `# Decisions

Architecture-decision-record (ADR) style. One file per decision.
See [[wiki-schema]] for the template.

Files in this directory:

(none yet)
`;

const STARTER_CONVENTIONS_README = `# Conventions

Coding patterns, naming rules, error-handling style, formatting
rules — anything that should be done **the same way** across the
project. One file per convention area.

Files in this directory:

(none yet)
`;
