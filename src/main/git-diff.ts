/**
 * Git diff service for the Diff Review feature.
 *
 * Given a worktree's cwd and a base ref, return a structured snapshot
 * of every change relative to that base — files (with status + line
 * counts), and hunks within each file. The renderer's Review view
 * consumes this to render its file tree + diff viewer.
 *
 * We use `git diff <base>...HEAD` (three-dot, "merge base") so the
 * diff describes only what THIS branch added vs. the common ancestor
 * with `<base>` — not changes that happened on `<base>` since the
 * branch was forked. That matches the user's mental model of "what
 * did my agent do here".
 *
 * The diff also includes the working-tree state (uncommitted files)
 * so reviews work even before the agent commits — which it usually
 * doesn't, since INZONE leaves committing as the user's decision.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type {
  ReviewFile,
  ReviewFileStatus,
  ReviewHunk,
  ReviewState,
} from '@shared/types';

const execp = promisify(exec);

export interface LoadDiffArgs {
  /** The worktree's folder path. */
  cwd: string;
  /** Base branch to diff against (e.g. "main", "develop"). */
  baseBranch: string;
  /** This worktree's branch — only used to populate ReviewState; we
   *  diff against working tree (HEAD + index + unstaged) regardless. */
  worktreeBranch: string;
}

/**
 * Load the full diff for a worktree against its base branch.
 * Returns a `ReviewState` ready for the renderer to consume.
 */
export async function loadDiff(args: LoadDiffArgs): Promise<ReviewState> {
  const { cwd, baseBranch, worktreeBranch } = args;
  if (!cwd) throw new Error('cwd is required');
  if (!baseBranch) throw new Error('baseBranch is required');

  // Find the merge base so we diff "what this branch added since
  // forking off base", not "diffs that exist between current base
  // tip and current branch tip".
  let mergeBase = baseBranch;
  try {
    const { stdout } = await execp(
      `git -C "${cwd}" merge-base "${baseBranch}" HEAD`,
      { timeout: 5000 },
    );
    mergeBase = stdout.trim() || baseBranch;
  } catch {
    // Falls back to plain baseBranch — that still works, just means
    // unrelated upstream commits will appear as "deletions" in the
    // diff. Better than failing the whole load.
  }

  // Two diffs combined: HEAD vs merge-base + working tree vs HEAD.
  // We do it as two passes to keep the parser simple, then merge
  // file entries (last write wins on path conflicts — working tree
  // is "newer" so it overrides).
  const committedRaw = await runDiff(cwd, mergeBase, 'HEAD');
  const workingRaw = await runDiff(cwd, 'HEAD', null); // null = working tree

  const committed = parseDiff(committedRaw);
  const working = parseDiff(workingRaw);

  // Merge: any file that appears in `working` overrides the
  // `committed` entry. (If only committed has it, it stays as-is.)
  const filesByPath = new Map<string, ReviewFile>();
  for (const f of committed.files) filesByPath.set(f.path, f);
  for (const f of working.files) filesByPath.set(f.path, f);

  const hunksById: Record<string, ReviewHunk> = {};
  for (const h of committed.hunks) hunksById[h.id] = h;
  for (const h of working.hunks) hunksById[h.id] = h;

  // After merging, rebuild each file's hunkIds from the actual hunk
  // map so we don't reference dropped hunks.
  for (const file of filesByPath.values()) {
    const ownHunks = Object.values(hunksById)
      .filter((h) => h.file === file.path)
      .sort((a, b) => a.newStart - b.newStart);
    file.hunkIds = ownHunks.map((h) => h.id);
  }

  const files = Array.from(filesByPath.values()).sort((a, b) =>
    a.path.localeCompare(b.path),
  );

  let totalAdditions = 0;
  let totalDeletions = 0;
  for (const f of files) {
    totalAdditions += f.additions;
    totalDeletions += f.deletions;
  }

  // "Dirty" — anything in the working diff means the working tree
  // has uncommitted changes beyond HEAD.
  const isDirty = working.files.length > 0;
  const isEmpty = files.length === 0;

  return {
    worktreeBranch,
    baseBranch,
    files,
    hunksById,
    isDirty,
    isEmpty,
    totalAdditions,
    totalDeletions,
  };
}

// ── internals ──────────────────────────────────────────────────────

/** Run `git diff` with a fairly large buffer (file lists can be big)
 *  and return the raw stdout. Returns "" on empty diff. */
async function runDiff(
  cwd: string,
  fromRef: string,
  toRef: string | null,
): Promise<string> {
  const target = toRef ? `"${fromRef}" "${toRef}"` : `"${fromRef}"`;
  const cmd =
    `git -C "${cwd}" diff --no-color --unified=3 ` +
    `--no-ext-diff --diff-filter=ACDMRT ${target}`;
  try {
    const { stdout } = await execp(cmd, {
      timeout: 30_000,
      maxBuffer: 64 * 1024 * 1024, // 64MB ceiling — generous for big PRs
    });
    return stdout;
  } catch (err) {
    // If the ref is missing or the diff fails, return empty — the
    // higher-level caller will treat it as "no diff" rather than a
    // hard error. A malformed cwd is the only thing that really
    // breaks this.
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes('unknown revision') || msg.includes('bad revision')) {
      return '';
    }
    throw err;
  }
}

interface ParsedDiff {
  files: ReviewFile[];
  hunks: ReviewHunk[];
}

/**
 * Hand-rolled unified-diff parser. Tiny and dependency-free. Splits
 * stdout into per-file blocks then per-hunk blocks. Counts adds/
 * deletes per file as we walk hunk bodies.
 */
function parseDiff(raw: string): ParsedDiff {
  if (!raw) return { files: [], hunks: [] };

  const files: ReviewFile[] = [];
  const hunks: ReviewHunk[] = [];

  // Split on file headers. Each block starts at a "diff --git" line.
  // We slice instead of splitting because the lines themselves are
  // part of each block.
  const lines = raw.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      const blockEnd = nextDiffStart(lines, i + 1);
      const block = lines.slice(i, blockEnd);
      const file = parseFileBlock(block, hunks);
      if (file) files.push(file);
      i = blockEnd;
    } else {
      i += 1;
    }
  }

  return { files, hunks };
}

/** Find the next index that starts a new file block, or end-of-array. */
function nextDiffStart(lines: string[], from: number): number {
  for (let i = from; i < lines.length; i++) {
    if (lines[i].startsWith('diff --git ')) return i;
  }
  return lines.length;
}

/** Parse one "diff --git ..." block into a file + push hunks. */
function parseFileBlock(
  block: string[],
  outHunks: ReviewHunk[],
): ReviewFile | null {
  if (block.length === 0) return null;

  // First line: `diff --git a/<path> b/<path>` (or rename pair).
  const first = block[0];
  const headerMatch = first.match(/^diff --git a\/(.+?) b\/(.+)$/);
  if (!headerMatch) return null;
  let oldPath = headerMatch[1];
  let newPath = headerMatch[2];

  let status: ReviewFileStatus = 'modified';
  let binary = false;
  let renamed = false;

  // Walk the metadata lines until we hit the first hunk (`@@`).
  let cursor = 1;
  while (cursor < block.length) {
    const ln = block[cursor];
    if (ln.startsWith('@@ ')) break;
    if (ln.startsWith('new file mode')) status = 'added';
    else if (ln.startsWith('deleted file mode')) status = 'deleted';
    else if (ln.startsWith('rename from ')) {
      oldPath = ln.slice('rename from '.length);
      renamed = true;
    } else if (ln.startsWith('rename to ')) {
      newPath = ln.slice('rename to '.length);
      renamed = true;
    } else if (ln.startsWith('Binary files ')) {
      binary = true;
    }
    cursor += 1;
  }

  if (renamed) status = 'renamed';

  let additions = 0;
  let deletions = 0;
  const hunkIds: string[] = [];

  // Iterate hunks. Each hunk starts at `@@ -oldStart,oldLines +newStart,newLines @@ <ctx>`
  while (cursor < block.length) {
    const ln = block[cursor];
    if (!ln.startsWith('@@ ')) {
      cursor += 1;
      continue;
    }
    const m = ln.match(/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/);
    if (!m) {
      cursor += 1;
      continue;
    }
    const oldStart = Number(m[1]);
    const oldLines = m[2] != null ? Number(m[2]) : 1;
    const newStart = Number(m[3]);
    const newLines = m[4] != null ? Number(m[4]) : 1;

    // Find this hunk's body — up to the next `@@` or end of block.
    const bodyStart = cursor + 1;
    let bodyEnd = bodyStart;
    while (bodyEnd < block.length && !block[bodyEnd].startsWith('@@ ')) {
      const bl = block[bodyEnd];
      if (bl.startsWith('+') && !bl.startsWith('+++')) additions += 1;
      else if (bl.startsWith('-') && !bl.startsWith('---')) deletions += 1;
      bodyEnd += 1;
    }
    const body = block.slice(bodyStart, bodyEnd).join('\n');

    const id = `${newPath}:${oldStart}:${newStart}`;
    const hunk: ReviewHunk = {
      id,
      file: newPath,
      oldStart,
      oldLines,
      newStart,
      newLines,
      header: ln,
      content: body,
    };
    outHunks.push(hunk);
    hunkIds.push(id);
    cursor = bodyEnd;
  }

  return {
    path: newPath,
    oldPath: renamed ? oldPath : undefined,
    status,
    additions,
    deletions,
    hunkIds,
    binary: binary || undefined,
  };
}
