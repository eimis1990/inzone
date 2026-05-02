/**
 * Hunk-level apply/revert helpers for the Diff Review feature.
 *
 * `applyDecisions` takes a set of hunks the user wants gone and
 * reverses them in the worktree's working directory using
 * `git apply --reverse`. Approved hunks stay as-is.
 *
 * The implementation reconstructs a minimal patch containing ONLY
 * the rejected hunks (one file at a time, with the original file
 * headers). We then pipe that patch into `git apply --reverse` from
 * stdin. This is the same approach `git apply -R --hunk` takes
 * internally, just with our own hunk filtering layered on top.
 *
 * Edge cases handled:
 *   - Files where ALL hunks are rejected → `git checkout HEAD -- <file>`
 *     (cheaper + handles add/delete/rename uniformly).
 *   - Pure additions where the whole file is to be rejected → delete
 *     the file (it doesn't exist in HEAD so checkout is a no-op).
 *   - Deletions where the user rejects the deletion → `git checkout
 *     HEAD -- <file>` restores it.
 *   - Binary files: we skip apply entirely; user can only
 *     approve-as-a-whole or reject-as-a-whole via file-level actions
 *     (not exposed in P2; revisit later).
 */

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';
import type { ReviewHunk } from '@shared/types';

const execp = promisify(exec);

export interface ApplyDecisionsArgs {
  /** The worktree's folder. */
  cwd: string;
  /** Hunks the user wants reverted (i.e. NOT shipped). The store
   *  passes us the full ReviewHunk for each because we need their
   *  raw `content` + headers to rebuild the patch. */
  rejectedHunks: ReviewHunk[];
  /** All hunks in the current diff, keyed by file. We use this to
   *  detect the "every hunk for this file was rejected" case where
   *  `git checkout` is simpler than building a patch. */
  hunksByFile: Record<string, ReviewHunk[]>;
}

export interface ApplyDecisionsResult {
  revertedFiles: string[];
  warnings: string[];
}

/**
 * Apply the user's reject decisions to the worktree's working tree.
 * Returns the files we touched and any warnings (non-fatal — we
 * proceed file-by-file so one bad apply doesn't block the rest).
 */
export async function applyDecisions(
  args: ApplyDecisionsArgs,
): Promise<ApplyDecisionsResult> {
  const { cwd, rejectedHunks, hunksByFile } = args;
  if (!cwd) throw new Error('cwd is required');

  const revertedFiles: string[] = [];
  const warnings: string[] = [];

  // Group rejected hunks by file.
  const rejectedByFile = new Map<string, ReviewHunk[]>();
  for (const h of rejectedHunks) {
    const arr = rejectedByFile.get(h.file) ?? [];
    arr.push(h);
    rejectedByFile.set(h.file, arr);
  }

  for (const [file, rejected] of rejectedByFile) {
    const allHunks = hunksByFile[file] ?? [];
    const allRejected =
      allHunks.length > 0 && rejected.length === allHunks.length;

    try {
      if (allRejected) {
        // Whole file is rejected — easier path: ask git to restore
        // it from HEAD. If the file is brand new (only in working
        // tree, not in HEAD), that fails — fall through to deleting.
        const restored = await restoreFromHead(cwd, file);
        if (!restored) {
          // Not in HEAD = brand-new file the agent created. The
          // user wants it gone, so delete it.
          await safeDelete(cwd, file);
        }
      } else {
        // Mix of approved + rejected hunks: build a patch with
        // ONLY the rejected hunks and reverse-apply it. This undoes
        // those specific hunks from the working tree while leaving
        // the approved ones in place.
        const patch = buildPatchForHunks(file, rejected);
        await reverseApplyPatch(cwd, patch);
      }
      revertedFiles.push(file);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      warnings.push(`${file}: ${msg}`);
    }
  }

  return { revertedFiles, warnings };
}

// ── internals ──────────────────────────────────────────────────────

/** Try `git checkout HEAD -- <file>`. Returns true on success,
 *  false if the file doesn't exist in HEAD (e.g. it's brand-new). */
async function restoreFromHead(cwd: string, file: string): Promise<boolean> {
  try {
    await execp(`git -C "${cwd}" checkout HEAD -- "${file}"`, {
      timeout: 10_000,
    });
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // "did not match any file(s) known to git" / "pathspec ... did
    // not match" both mean the file isn't tracked at HEAD.
    if (
      msg.includes('did not match any file') ||
      msg.includes('pathspec')
    ) {
      return false;
    }
    throw err;
  }
}

/** rm a file (tolerant of missing). Used for brand-new files the
 *  user wants to discard. */
async function safeDelete(cwd: string, file: string): Promise<void> {
  const full = path.join(cwd, file);
  try {
    await fs.unlink(full);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== 'ENOENT') throw err;
  }
}

/**
 * Build a unified diff patch containing the file header (so git
 * knows which file we're targeting) plus only the listed hunks.
 * We use the new path for both `---` / `+++` so a non-rename diff
 * stays valid; rename detection isn't supported in P2 (rare in
 * practice for partial-reject scenarios).
 */
function buildPatchForHunks(file: string, hunks: ReviewHunk[]): string {
  // git apply only needs the minimal diff header + hunks. We don't
  // include the `diff --git` / `index` lines — git infers those.
  let out = '';
  out += `--- a/${file}\n`;
  out += `+++ b/${file}\n`;
  for (const h of hunks) {
    out += `${h.header}\n`;
    // Make sure the body ends with a newline (some hunks parsed off
    // the diff don't include a trailing one). Without it git apply
    // refuses the patch with "corrupt patch at line N".
    const body = h.content.endsWith('\n') ? h.content : h.content + '\n';
    out += body;
  }
  return out;
}

/**
 * Pipe the constructed patch into `git apply --reverse`. We use
 * `--whitespace=nowarn` to dampen noise when the file has trailing
 * whitespace differences that shouldn't fail the apply.
 */
async function reverseApplyPatch(cwd: string, patch: string): Promise<void> {
  const cmd = `git -C "${cwd}" apply --reverse --whitespace=nowarn -`;
  await new Promise<void>((resolve, reject) => {
    const child = exec(
      cmd,
      { timeout: 15_000, maxBuffer: 8 * 1024 * 1024 },
      (err, _stdout, stderr) => {
        if (err) {
          const msg = stderr.trim() || err.message;
          reject(new Error(`git apply --reverse failed: ${msg}`));
        } else {
          resolve();
        }
      },
    );
    if (child.stdin) {
      child.stdin.write(patch);
      child.stdin.end();
    } else {
      reject(new Error('no stdin on git apply child process'));
    }
  });
}
