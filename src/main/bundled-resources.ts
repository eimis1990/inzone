/**
 * First-run starter library copy.
 *
 * On a fresh install, the user has no agents or skills under
 * `~/.claude/agents` or `~/.claude/skills`. The Workers tab would
 * sit silent and there's nothing to drop on a pane. To give the
 * first-launch experience some life, we ship a curated starter
 * library bundled with the app and copy it into the user's home on
 * first launch — but ONLY when the target directory is genuinely
 * empty. We never overwrite an existing agent or skill.
 *
 * Source path:
 *   - Dev:  <projectRoot>/bundled-resources/{agents,skills}
 *   - Prod: <app.app>/Contents/Resources/bundled-resources/{agents,skills}
 *
 * The electron-builder config places `bundled-resources` next to the
 * compiled main bundle via the `extraResources` field; we resolve
 * it via `process.resourcesPath` in production, falling back to the
 * project root when running from `electron-vite dev`.
 *
 * This is opt-out: a user who wipes their library and wants the
 * starters back can `rm -rf ~/.claude/agents/.inzone-starters-installed`
 * and relaunch — we use a sentinel file (rather than "is the dir
 * empty") so once we've installed once we never re-install, even if
 * the user later deletes everything.
 */

import { app } from 'electron';
import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';

const HOME_AGENTS_DIR = path.join(homedir(), '.claude', 'agents');
const HOME_SKILLS_DIR = path.join(homedir(), '.claude', 'skills');

/** Sentinel file: "we've already done the first-run copy". */
const SENTINEL_NAME = '.inzone-starters-installed';

/**
 * Locate the bundled-resources folder. In production Electron sets
 * `process.resourcesPath` to <app>/Contents/Resources; in dev we
 * walk up from __dirname. Returns null if neither exists, in which
 * case we silently skip — better than crashing the boot.
 */
async function resolveBundledRoot(): Promise<string | null> {
  // Production path — set by electron-builder's `extraResources`.
  if (app.isPackaged) {
    const prod = path.join(process.resourcesPath, 'bundled-resources');
    try {
      await fs.access(prod);
      return prod;
    } catch {
      return null;
    }
  }
  // Dev path — relative to the compiled main bundle. We're in
  // out/main/index.mjs at runtime; bundled-resources sits at the
  // project root, two levels up.
  const candidates = [
    path.resolve(app.getAppPath(), 'bundled-resources'),
    path.resolve(__dirname, '..', '..', 'bundled-resources'),
  ];
  for (const c of candidates) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // try next
    }
  }
  return null;
}

/**
 * Recursively copy a directory tree without overwriting existing
 * files. Used per-skill (so user-customised skills aren't blown
 * away if they happen to share a name with a starter).
 */
async function copyRecursive(src: string, dst: string): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const e of entries) {
    const srcPath = path.join(src, e.name);
    const dstPath = path.join(dst, e.name);
    if (e.isDirectory()) {
      await copyRecursive(srcPath, dstPath);
    } else if (e.isFile()) {
      try {
        await fs.access(dstPath);
        // Already exists — don't clobber.
      } catch {
        await fs.copyFile(srcPath, dstPath);
      }
    }
  }
}

/**
 * Run the bundled-library copy on every boot. Idempotent and
 * progressive — for each bundled file, copy it only if the user
 * doesn't already have a file with that name. This means:
 *
 *  - First run: every bundled file lands in `~/.claude/`.
 *  - Subsequent runs: skipped per-file (no-op for unchanged files).
 *  - When INZONE adds new bundled agents in a future release:
 *    those new files are copied automatically without disturbing
 *    anything the user customised.
 *
 * The previous version of this function used a single sentinel
 * file (`.inzone-starters-installed`) to decide whether to run AT
 * ALL — which meant existing users never received any agents we
 * added in later versions. We now ignore the sentinel (and clean
 * it up if it's there from an older install) since per-file
 * existence checks give us the same idempotency without blocking
 * later additions.
 */
export async function installStarterLibraryIfNeeded(): Promise<void> {
  try {
    await fs.mkdir(HOME_AGENTS_DIR, { recursive: true });

    const root = await resolveBundledRoot();
    if (!root) {
      console.warn(
        '[bundled-resources] starter library not found; skipping copy',
      );
      return;
    }

    let copied = 0;

    // Copy agents — flat list of .md files. Skip any that already
    // exist (filename collision = user has their own).
    const srcAgents = path.join(root, 'agents');
    try {
      const entries = await fs.readdir(srcAgents);
      for (const f of entries) {
        if (!f.endsWith('.md')) continue;
        const srcPath = path.join(srcAgents, f);
        const dstPath = path.join(HOME_AGENTS_DIR, f);
        try {
          await fs.access(dstPath);
          // Already there — don't overwrite.
        } catch {
          await fs.copyFile(srcPath, dstPath);
          copied++;
        }
      }
    } catch (err) {
      console.warn('[bundled-resources] agents copy partial failure:', err);
    }

    // Copy skills — each is a folder containing SKILL.md (and
    // possibly support files). We copy the whole tree.
    await fs.mkdir(HOME_SKILLS_DIR, { recursive: true });
    const srcSkills = path.join(root, 'skills');
    try {
      const skillFolders = await fs.readdir(srcSkills, {
        withFileTypes: true,
      });
      for (const e of skillFolders) {
        if (!e.isDirectory()) continue;
        const srcDir = path.join(srcSkills, e.name);
        const dstDir = path.join(HOME_SKILLS_DIR, e.name);
        try {
          await fs.access(dstDir);
          // Folder exists — assume the user has their own version.
          // Skip entirely; we don't want to merge files into a user
          // skill folder.
        } catch {
          await copyRecursive(srcDir, dstDir);
          copied++;
        }
      }
    } catch (err) {
      console.warn('[bundled-resources] skills copy partial failure:', err);
    }

    // Tidy up the legacy sentinel from older installs. It's no
    // longer meaningful (we per-file check), and removing it makes
    // the agents folder cleaner. Failure here is fine — best effort.
    const legacySentinel = path.join(HOME_AGENTS_DIR, SENTINEL_NAME);
    try {
      await fs.unlink(legacySentinel);
    } catch {
      /* didn't exist or wasn't ours; ignore */
    }

    if (copied > 0) {
      console.log(
        `[bundled-resources] starter library: ${copied} new file(s) installed`,
      );
    }
  } catch (err) {
    // Never fail boot over this.
    console.warn('[bundled-resources] install failed:', err);
  }
}
