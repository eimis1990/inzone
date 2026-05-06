/**
 * Backend for the Settings → About page.
 *
 * Surfaces three things to the renderer:
 *  - the running app's semver (so the user knows what they're on);
 *  - a manual "Check for updates" trigger so they don't have to wait
 *    for the 30-minute periodic poll in `auto-update.ts`;
 *  - the last N changelog entries parsed straight from CHANGELOG.md,
 *    so the About page doubles as in-app release notes.
 *
 * Update-checking is kept lightweight: we drive electron-updater's
 * `checkForUpdates()` and translate its result into a small status
 * record. The existing handlers in `auto-update.ts` still own the
 * download + restart flow (so a manually-triggered check that finds an
 * update will end at the same "Restart now / Later" dialog as the
 * background one).
 *
 * CHANGELOG resolution mirrors `bundled-resources.ts`:
 *   - In production, electron-builder copies CHANGELOG.md into
 *     <app>/Contents/Resources/ via `extraResources`.
 *   - In dev, we walk up from the compiled `out/main/index.mjs` to
 *     the project root.
 */

import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;

export interface ReleaseEntry {
  /** Semver string, e.g. "1.5.1". */
  version: string;
  /** ISO date the release was tagged in CHANGELOG, e.g. "2026-05-06".
   *  Empty string when CHANGELOG omits a date. */
  date: string;
  /** Whichever sections appeared in this entry — Added, Changed, Fixed,
   *  Removed, Deprecated, Security. Each item is the rendered text
   *  body with markdown stripped down to plain prose. */
  sections: ReleaseSection[];
}

export interface ReleaseSection {
  /** "Added" | "Changed" | "Fixed" | etc. — preserved verbatim from
   *  the CHANGELOG so the renderer can colour them. */
  heading: string;
  items: ReleaseItem[];
}

export interface ReleaseItem {
  /** The first sentence of the bullet — used as a clickable summary. */
  title: string;
  /** Remaining body paragraph(s) joined into a single string. Empty
   *  when the bullet was a single sentence. */
  body: string;
}

export interface UpdateCheckResult {
  /** "current" — running version is the latest; "available" — a
   *  newer version exists; "downloading" — currently fetching;
   *  "ready" — download finished, awaiting restart; "error" — the
   *  check itself failed. */
  status: 'current' | 'available' | 'downloading' | 'ready' | 'error';
  /** Version we're on right now. Always set. */
  currentVersion: string;
  /** Version of the available update, when status is anything other
   *  than `current` / `error`. */
  latestVersion?: string;
  /** Human-readable error string when status === 'error'. */
  error?: string;
  /** True when the host is running an unpackaged dev build, in which
   *  case the updater is intentionally inert and the renderer should
   *  show "Updates disabled in dev" instead of an action button. */
  devMode?: boolean;
}

/** Lazily-cached parsed CHANGELOG. We re-read on every call rather
 *  than caching the parsed structure because the file is tiny and the
 *  cache invalidation cost (release tag → bumped version) isn't
 *  worth the complexity. */
async function readChangelogFile(): Promise<string | null> {
  const candidates: string[] = [];
  if (app.isPackaged) {
    candidates.push(path.join(process.resourcesPath, 'CHANGELOG.md'));
  }
  candidates.push(path.resolve(app.getAppPath(), 'CHANGELOG.md'));
  candidates.push(path.resolve(__dirname, '..', '..', 'CHANGELOG.md'));

  for (const c of candidates) {
    try {
      const buf = await fs.readFile(c, 'utf8');
      if (buf.trim().length > 0) return buf;
    } catch {
      /* try next */
    }
  }
  return null;
}

/**
 * Parse the markdown CHANGELOG into release entries. The format we
 * follow is "Keep a Changelog 1.1.0":
 *   ## [1.5.1] — 2026-05-06
 *   ### Added
 *   - **Title.** Body...
 *   - **Title.** Body...
 *   ### Fixed
 *   - ...
 *   ## [1.5.0] — ...
 *
 * We're forgiving on whitespace and bullet spacing; the only hard
 * assumption is that release headers start with `## [` so we can
 * split reliably.
 */
function parseChangelog(md: string, limit: number): ReleaseEntry[] {
  const releaseHeader =
    /^##\s*\[([^\]]+)\](?:\s*[—-]\s*([0-9]{4}-[0-9]{2}-[0-9]{2}))?\s*$/gm;
  const blocks: Array<{ header: RegExpExecArray; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = releaseHeader.exec(md))) {
    blocks.push({ header: match, end: -1 });
  }
  for (let i = 0; i < blocks.length; i++) {
    blocks[i].end =
      i + 1 < blocks.length ? blocks[i + 1].header.index : md.length;
  }

  const out: ReleaseEntry[] = [];
  for (const b of blocks) {
    const version = b.header[1] ?? '';
    const date = b.header[2] ?? '';
    const body = md.slice(b.header.index + b.header[0].length, b.end);
    const sections = parseSections(body);
    if (sections.length === 0) continue;
    out.push({ version, date, sections });
    if (out.length >= limit) break;
  }
  return out;
}

function parseSections(body: string): ReleaseSection[] {
  const sectionHeader = /^###\s+(.+?)\s*$/gm;
  const blocks: Array<{ header: RegExpExecArray; end: number }> = [];
  let match: RegExpExecArray | null;
  while ((match = sectionHeader.exec(body))) {
    blocks.push({ header: match, end: -1 });
  }
  for (let i = 0; i < blocks.length; i++) {
    blocks[i].end =
      i + 1 < blocks.length ? blocks[i + 1].header.index : body.length;
  }

  const sections: ReleaseSection[] = [];
  for (const b of blocks) {
    const heading = b.header[1].trim();
    const slice = body.slice(b.header.index + b.header[0].length, b.end);
    const items = parseBullets(slice);
    if (items.length > 0) sections.push({ heading, items });
  }
  return sections;
}

function parseBullets(slice: string): ReleaseItem[] {
  // Bullets start with "- " at column 0; continuation lines are
  // indented by two or more spaces. We're loose on tabs vs. spaces.
  const lines = slice.split(/\r?\n/);
  const items: ReleaseItem[] = [];
  let buffer: string[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    const merged = buffer
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
    if (!merged) {
      buffer = [];
      return;
    }
    const cleaned = stripInlineMarkdown(merged);
    const sentenceMatch = cleaned.match(/^(.+?[.?!:])(\s+)([\s\S]+)$/);
    if (sentenceMatch && sentenceMatch[1].length < 180) {
      items.push({
        title: sentenceMatch[1].trim(),
        body: sentenceMatch[3].trim(),
      });
    } else {
      items.push({ title: cleaned, body: '' });
    }
    buffer = [];
  };

  for (const raw of lines) {
    if (/^\s*-\s+/.test(raw)) {
      flush();
      buffer.push(raw.replace(/^\s*-\s+/, ''));
    } else if (/^\s+\S/.test(raw) && buffer.length > 0) {
      buffer.push(raw.trim());
    } else if (raw.trim() === '') {
      // Blank line between bullets — ignore, keep accumulating.
    } else if (buffer.length > 0) {
      buffer.push(raw.trim());
    }
  }
  flush();
  return items;
}

function stripInlineMarkdown(s: string): string {
  return s
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1');
}

export function getAppVersion(): string {
  return app.getVersion();
}

/**
 * Read CHANGELOG.md and return up to `limit` most-recent releases.
 * Falls back to an empty array on read or parse error so the About
 * page can render a clean "no release notes available" empty state
 * rather than crashing.
 */
export async function getReleaseNotes(limit = 5): Promise<ReleaseEntry[]> {
  try {
    const md = await readChangelogFile();
    if (!md) return [];
    return parseChangelog(md, Math.max(1, Math.min(limit, 20)));
  } catch (err) {
    console.warn('[about] release notes parse failed:', err);
    return [];
  }
}

/**
 * Manually trigger an update check. The dev-mode early-return mirrors
 * `auto-update.ts` so we never hit the publish feed while iterating
 * locally. In packaged mode we delegate to electron-updater and turn
 * its result into a small status record.
 */
export async function manualCheckForUpdates(): Promise<UpdateCheckResult> {
  const currentVersion = app.getVersion();
  if (!app.isPackaged) {
    return { status: 'current', currentVersion, devMode: true };
  }
  try {
    const result = await autoUpdater.checkForUpdates();
    if (!result?.updateInfo) {
      return { status: 'current', currentVersion };
    }
    const latestVersion = result.updateInfo.version;
    if (!latestVersion || latestVersion === currentVersion) {
      return { status: 'current', currentVersion };
    }
    // Found something newer — `auto-update.ts` will drive the
    // download + restart dialog; we just report that an update
    // exists. The download-progress / update-downloaded events flow
    // through the existing module, so the renderer gets the same
    // dialog whether the check was manual or automatic.
    return {
      status: 'available',
      currentVersion,
      latestVersion,
    };
  } catch (err) {
    return {
      status: 'error',
      currentVersion,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
