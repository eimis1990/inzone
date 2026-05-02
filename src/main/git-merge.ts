/**
 * Local merge — alternative path to `gh pr create` for projects that
 * don't need a PR (solo work, prototypes, or repos with no remote).
 *
 * The merge runs in the PARENT project's working tree, not the
 * worktree's, because that's where the base branch is checked out.
 * We need both directories:
 *   - `worktreeCwd`: where to commit any uncommitted changes first
 *   - `parentCwd`: where to run `git merge`
 *
 * On success, the parent's HEAD now contains the worktree's commits.
 * The worktree itself is left as-is — the user can choose to remove
 * it via the existing worktree-remove flow.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execp = promisify(exec);

// Same PATH augmentation we use for gh — git-from-Homebrew lives in
// /opt/homebrew/bin on Apple Silicon, /usr/local/bin on Intel, and
// Electron launched from Spotlight doesn't pick those up.
const PATH_AUGMENT = [
  process.env.PATH ?? '',
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
]
  .filter(Boolean)
  .join(':');

const GIT_ENV = { ...process.env, PATH: PATH_AUGMENT };

export interface LocalMergeArgs {
  /** Worktree's folder — used for the pre-commit step only. */
  worktreeCwd: string;
  /** Parent project's folder — where the merge runs. */
  parentCwd: string;
  /** Branch we're merging FROM (the worktree's branch). */
  branch: string;
  /** Branch we're merging INTO. Must already be checked out in
   *  `parentCwd`. */
  baseBranch: string;
}

export interface LocalMergeResult {
  /** Short SHA of the merge commit (or fast-forward target). */
  sha?: string;
  /** True when git fast-forwarded; false for a 3-way merge commit. */
  fastForward: boolean;
}

/**
 * Run `git merge <branch>` in the parent's working tree. Caller is
 * responsible for committing any uncommitted changes in the worktree
 * BEFORE calling this — we don't auto-commit here because the renderer
 * already owns that step (it shares the commit flow with the PR path).
 *
 * Pre-flight: switch the parent to `baseBranch` if it's not already
 * there. Refuse if the parent has uncommitted changes (the merge
 * would corrupt or block on them).
 */
export async function localMerge(
  args: LocalMergeArgs,
): Promise<LocalMergeResult> {
  const { parentCwd, branch, baseBranch } = args;
  if (!parentCwd) throw new Error('parentCwd is required');
  if (!branch) throw new Error('branch is required');
  if (!baseBranch) throw new Error('baseBranch is required');

  // Refuse if the parent has uncommitted changes — git would either
  // refuse the merge or interleave its changes into the merge commit,
  // both bad. Surface this clearly so the user can resolve it manually.
  const { stdout: parentStatus } = await execp(
    `git -C "${parentCwd}" status --porcelain`,
    { timeout: 6000, env: GIT_ENV },
  );
  if (parentStatus.trim().length > 0) {
    throw new Error(
      `Parent project (${parentCwd}) has uncommitted changes. ` +
        'Commit or stash them before merging.',
    );
  }

  // Make sure the parent is on the base branch. If it's not, switch.
  // git checkout will fail if there are uncommitted changes — we
  // already guarded against that above, so this should be safe.
  const { stdout: currentBranchRaw } = await execp(
    `git -C "${parentCwd}" branch --show-current`,
    { timeout: 4000, env: GIT_ENV },
  );
  const currentBranch = currentBranchRaw.trim();
  if (currentBranch !== baseBranch) {
    try {
      await execp(`git -C "${parentCwd}" checkout "${baseBranch}"`, {
        timeout: 10_000,
        env: GIT_ENV,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Could not switch parent to ${baseBranch}: ${msg}`);
    }
  }

  // Run the merge. `--no-edit` keeps the auto-generated merge commit
  // message; we don't open an editor inside the Electron child proc.
  // We use `--ff` (default) so a fast-forward happens when possible,
  // resulting in a clean linear history.
  let fastForward = false;
  try {
    const { stdout } = await execp(
      `git -C "${parentCwd}" merge --no-edit "${branch}"`,
      { timeout: 30_000, env: GIT_ENV },
    );
    fastForward = stdout.includes('Fast-forward');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    // The most common failure is a merge conflict. Re-throw with the
    // git output so the renderer can show the user the affected files.
    throw new Error(`git merge failed: ${msg}`);
  }

  // Capture the new HEAD's short SHA.
  let sha: string | undefined;
  try {
    const { stdout } = await execp(
      `git -C "${parentCwd}" rev-parse --short HEAD`,
      { timeout: 4000, env: GIT_ENV },
    );
    sha = stdout.trim() || undefined;
  } catch {
    // Non-fatal — sha is informational.
  }

  return { sha, fastForward };
}
