/**
 * Tiny "ask the OS" helpers for things the renderer can't do directly.
 *
 * Currently:
 *   - `getListenerPidsForPort`   → who's listening on a TCP port
 *   - `killPort`                  → SIGTERM (then SIGKILL fallback)
 *
 * macOS / Linux only. Windows path would use `netstat -ano | findstr`
 * + `taskkill /PID … /F`; we don't support Windows yet.
 */

import { exec } from 'child_process';
import { promises as fs } from 'fs';
import path from 'path';
import { promisify } from 'util';

const execp = promisify(exec);

export interface PortListener {
  pid: number;
  command?: string;
}

/**
 * `lsof -nP -iTCP:<port> -sTCP:LISTEN -F pcn` returns one record per
 * listener, line-prefixed with the field key:
 *   p<pid>
 *   c<command>
 *   n<host:port>
 * We map that to `{ pid, command }` records.
 */
export async function getListenerPidsForPort(
  port: number,
): Promise<PortListener[]> {
  if (!Number.isInteger(port) || port <= 0 || port > 65535) return [];
  try {
    const { stdout } = await execp(
      `lsof -nP -iTCP:${port} -sTCP:LISTEN -F pcn`,
      { timeout: 4000 },
    );
    const lines = stdout.split('\n').filter(Boolean);
    const out: PortListener[] = [];
    let current: Partial<PortListener> | null = null;
    for (const line of lines) {
      const tag = line[0];
      const rest = line.slice(1);
      if (tag === 'p') {
        if (current?.pid != null) out.push(current as PortListener);
        current = { pid: Number(rest) };
      } else if (tag === 'c' && current) {
        current.command = rest;
      }
    }
    if (current?.pid != null) out.push(current as PortListener);
    // Dedupe by PID — `-F pcn` can repeat the same PID across IPv4/IPv6.
    const seen = new Set<number>();
    return out.filter((l) => {
      if (seen.has(l.pid)) return false;
      seen.add(l.pid);
      return true;
    });
  } catch (err: unknown) {
    // lsof exits non-zero when nothing is listening on the port — that
    // shouldn't be treated as an error condition.
    const e = err as { code?: number; killed?: boolean };
    if (e?.code === 1) return [];
    console.warn(`[system] lsof failed for port ${port}:`, err);
    return [];
  }
}

export interface KillPortResult {
  port: number;
  killed: number[];
  errors: { pid: number; message: string }[];
}

/**
 * Kill every process listening on `port`. SIGTERM first, then SIGKILL
 * if anything is still alive a moment later. Returns the PIDs we
 * killed plus any per-PID error so the caller can surface them.
 */
export async function killPort(port: number): Promise<KillPortResult> {
  const result: KillPortResult = { port, killed: [], errors: [] };
  const listeners = await getListenerPidsForPort(port);
  for (const { pid } of listeners) {
    try {
      process.kill(pid, 'SIGTERM');
      result.killed.push(pid);
    } catch (err) {
      result.errors.push({
        pid,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (result.killed.length === 0) return result;

  // Give them a beat to exit cleanly, then SIGKILL anything still
  // breathing. Most dev servers shut down well under 500 ms.
  await new Promise((res) => setTimeout(res, 600));
  const stillThere = await getListenerPidsForPort(port);
  for (const { pid } of stillThere) {
    try {
      process.kill(pid, 'SIGKILL');
    } catch (err) {
      result.errors.push({
        pid,
        message: `SIGKILL failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }
  return result;
}

/**
 * Resolve the active git branch for a folder by reading `.git/HEAD`
 * directly. Faster than shelling out to `git`, no PATH dependency,
 * and works on detached worktrees too.
 *
 * Returns:
 *   - branch name (e.g. "main") when on a branch
 *   - null when the folder isn't a git repo, HEAD is detached
 *     (no branch ref), or anything goes wrong reading the file.
 */
/**
 * Same PATH augmentation we use elsewhere — Electron launched outside
 * a login shell doesn't pick up Homebrew paths, and git is often only
 * available there.
 */
const GIT_PATH_AUGMENT = [
  process.env.PATH ?? '',
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
]
  .filter(Boolean)
  .join(':');

const GIT_ENV = { ...process.env, PATH: GIT_PATH_AUGMENT };

export async function getGitBranch(cwd: string): Promise<string | null> {
  if (!cwd) return null;
  // Primary path: ask git directly. Bulletproof across git versions,
  // worktree types, paths with spaces, all of it. Fast enough that
  // the polling sidebar footer can call this every 5s without
  // noticing.
  try {
    const { stdout } = await execp(
      `git -C "${cwd}" symbolic-ref --short HEAD`,
      { timeout: 3000, env: GIT_ENV },
    );
    const branch = stdout.trim();
    if (branch) return branch;
  } catch {
    // git missing, no repo, detached HEAD, or some other failure.
    // Fall through to the file-based path which can still detect
    // branches in some edge cases (and works without git on PATH).
  }
  // Fallback: parse `.git/HEAD` directly. Useful if git isn't on
  // PATH (rare but possible) or if something about the env is broken.
  try {
    const headPath = path.join(cwd, '.git', 'HEAD');
    const raw = (await fs.readFile(headPath, 'utf8')).trim();
    // `ref: refs/heads/<name>` when on a branch, raw 40-char SHA when
    // detached. The "worktree" case writes `gitdir: <path>` into the
    // worktree's .git file — handle that by following one indirection.
    if (raw.startsWith('ref: refs/heads/')) {
      return raw.slice('ref: refs/heads/'.length) || null;
    }
    if (raw.startsWith('gitdir:')) {
      const gitdir = raw.slice('gitdir:'.length).trim();
      const resolved = path.isAbsolute(gitdir)
        ? gitdir
        : path.resolve(cwd, gitdir);
      const inner = (await fs.readFile(path.join(resolved, 'HEAD'), 'utf8'))
        .trim();
      if (inner.startsWith('ref: refs/heads/')) {
        return inner.slice('ref: refs/heads/'.length) || null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

// ────────────────────────────────────────────────────────────────────
// Git worktree helpers
//
// Worktrees let one repo have N independent working folders, each on
// its own branch — perfect for letting parallel agents avoid stepping
// on each other's filesystem. The functions below are thin wrappers
// over the `git worktree …` family + a tiny env-file copier.
// ────────────────────────────────────────────────────────────────────

const ENV_FILE_PATTERNS = [
  '.env',
  '.env.local',
  '.env.development',
  '.env.development.local',
  '.env.production.local',
  '.env.test.local',
];

/**
 * Slugify a branch name into something filesystem-safe and short.
 * "feature/login bug" → "feature-login-bug".
 */
function slugForFolder(branch: string): string {
  return branch
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

/**
 * Pick a sibling-folder path next to `parentCwd` that doesn't exist
 * yet. Standard convention is `<parent>-<branch>`, with a `-2`, `-3`
 * suffix if that's already taken.
 */
async function pickWorktreeFolder(
  parentCwd: string,
  branch: string,
): Promise<string> {
  const dir = path.dirname(parentCwd);
  const base = path.basename(parentCwd);
  const slug = slugForFolder(branch) || 'worktree';
  let candidate = path.join(dir, `${base}-${slug}`);
  let n = 2;
  // Keep trying until we find an unused name.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await fs.access(candidate);
      candidate = path.join(dir, `${base}-${slug}-${n++}`);
    } catch {
      return candidate;
    }
  }
}

/** Result of `gitInit` — tells the renderer the new branch's name
 *  (so it can refresh git state) plus whether we made an initial
 *  commit (we do, when there's anything to commit, so worktrees can
 *  branch off something). */
export interface GitInitResult {
  /** Default branch the new repo was initialized on (usually `main`). */
  branch: string;
  /** True when an initial commit was created. False if the folder was
   *  empty so we left HEAD orphan. */
  hasInitialCommit: boolean;
  /** Files we staged into the initial commit (informational only). */
  filesCommitted: number;
}

/**
 * Initialize a git repo in `cwd`. Used when the user asks to start
 * tracking a previously-non-git folder, or when we detect a missing
 * repo on the worktree-create path. We:
 *
 *   1. `git init -b main` (or whatever `init.defaultBranch` is)
 *   2. If the folder has any files, `git add -A` + commit them as
 *      "Initial commit (via INZONE)" — without this, there's no HEAD
 *      and `git worktree add` immediately fails.
 *
 * Refuses to re-init an existing repo: if `.git` already exists we
 * throw an error so callers can surface a clear "already a git repo"
 * message instead of silently overwriting state.
 */
export async function gitInit(cwd: string): Promise<GitInitResult> {
  if (!cwd) throw new Error('cwd is required');

  // Refuse if already a repo. This covers both the regular "is a
  // directory" case and the worktree "is a file pointing at gitdir"
  // case in one fs.access call.
  try {
    await fs.access(path.join(cwd, '.git'));
    throw new Error('Folder is already a git repository.');
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    // ENOENT = no .git at all = good, proceed. Anything else (or our
    // own throw above) re-throws.
    if (code !== 'ENOENT') throw err;
  }

  // Init. -b main respects the user's init.defaultBranch when set;
  // we fall back to plain `git init` if -b isn't supported (git <
  // 2.28). Catch the version error and retry without -b.
  try {
    await execp(`git -C "${cwd}" init -b main`, { timeout: 10_000 });
  } catch {
    await execp(`git -C "${cwd}" init`, { timeout: 10_000 });
  }

  // Find out what branch we landed on. Older git versions might
  // pick `master`; newer ones honor init.defaultBranch.
  const branch =
    (await getGitBranch(cwd)) || 'main';

  // Stage and commit anything that's there. If there's nothing, we
  // skip the commit so the user has a clean orphan HEAD they can
  // commit into themselves.
  let filesCommitted = 0;
  let hasInitialCommit = false;
  try {
    const { stdout: lsRaw } = await execp(
      `git -C "${cwd}" ls-files --others --exclude-standard --cached`,
      { timeout: 5_000 },
    );
    const candidates = lsRaw.split('\n').filter(Boolean);
    if (candidates.length > 0) {
      await execp(`git -C "${cwd}" add -A`, { timeout: 30_000 });
      // -m flag: shell-quote-safe; commit message has no special chars.
      await execp(
        `git -C "${cwd}" commit --allow-empty-message -m "Initial commit (via INZONE)"`,
        { timeout: 15_000 },
      );
      filesCommitted = candidates.length;
      hasInitialCommit = true;
    }
  } catch (err) {
    // Commit step is best-effort. The repo IS initialized at this
    // point — losing the initial commit is recoverable; the user can
    // commit themselves. We surface the partial success rather than
    // failing the whole init.
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git init succeeded but initial commit failed: ${msg}`);
  }

  return { branch, hasInitialCommit, filesCommitted };
}

export interface WorktreeCreateArgs {
  parentCwd: string;
  branchName: string;
  /** "current" means base off whatever HEAD is in parentCwd. */
  baseBranch: string | 'current';
  /** Copy common gitignored env files (`.env`, `.env.local`, …) into the new worktree. */
  copyEnv: boolean;
}

export interface WorktreeCreateResult {
  worktreeCwd: string;
  branch: string;
  base: string;
  copiedFiles: string[];
}

/** Create a new git worktree off `parentCwd` and return where it landed. */
export async function worktreeCreate(
  args: WorktreeCreateArgs,
): Promise<WorktreeCreateResult> {
  const { parentCwd, branchName, baseBranch, copyEnv } = args;
  if (!parentCwd) throw new Error('parentCwd is required');
  if (!branchName.trim()) throw new Error('Branch name cannot be empty');

  // Resolve the actual base — "current" means the parent's HEAD.
  let resolvedBase = baseBranch;
  if (resolvedBase === 'current') {
    resolvedBase = (await getGitBranch(parentCwd)) ?? 'HEAD';
  }

  const target = await pickWorktreeFolder(parentCwd, branchName);

  // Does the branch already exist? If it does, we attach to it; if not,
  // we create it via `-b`. `git rev-parse --verify` is the cheapest
  // check that doesn't error-spam.
  let branchExists = false;
  try {
    await execp(`git -C "${parentCwd}" rev-parse --verify "${branchName}"`, {
      timeout: 4000,
    });
    branchExists = true;
  } catch {
    branchExists = false;
  }

  const cmd = branchExists
    ? `git -C "${parentCwd}" worktree add "${target}" "${branchName}"`
    : `git -C "${parentCwd}" worktree add -b "${branchName}" "${target}" "${resolvedBase}"`;

  try {
    await execp(cmd, { timeout: 30_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git worktree add failed: ${msg}`);
  }

  const copied: string[] = [];
  if (copyEnv) {
    for (const name of ENV_FILE_PATTERNS) {
      const src = path.join(parentCwd, name);
      const dst = path.join(target, name);
      try {
        await fs.copyFile(src, dst);
        copied.push(name);
      } catch {
        // Source missing or unreadable — skip silently. Common case.
      }
    }
  }

  return {
    worktreeCwd: target,
    branch: branchName,
    base: resolvedBase,
    copiedFiles: copied,
  };
}

export interface WorktreeRemoveArgs {
  /** The worktree's folder to remove. */
  cwd: string;
  /**
   * Force removal even if the worktree has uncommitted changes.
   * Matches `git worktree remove --force`.
   */
  force?: boolean;
  /** When set, also `git branch -D <branchName>` after the worktree is gone. */
  deleteBranch?: string;
}

export interface WorktreeRemoveResult {
  removed: boolean;
  branchDeleted: boolean;
  warnings: string[];
}

/** Remove a worktree (and optionally its branch). */
export async function worktreeRemove(
  args: WorktreeRemoveArgs,
): Promise<WorktreeRemoveResult> {
  const { cwd, force, deleteBranch } = args;
  const warnings: string[] = [];

  // `git worktree remove` is run from any other repo location — we
  // execute from the parent if we can resolve it; otherwise from
  // wherever git resolves things.
  const status = await worktreeStatus(cwd);
  const repoRoot = status.parentCwd ?? cwd;

  const removeCmd = force
    ? `git -C "${repoRoot}" worktree remove --force "${cwd}"`
    : `git -C "${repoRoot}" worktree remove "${cwd}"`;
  try {
    await execp(removeCmd, { timeout: 15_000 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`git worktree remove failed: ${msg}`);
  }

  let branchDeleted = false;
  if (deleteBranch) {
    try {
      await execp(`git -C "${repoRoot}" branch -D "${deleteBranch}"`, {
        timeout: 4000,
      });
      branchDeleted = true;
    } catch (err) {
      warnings.push(
        `Couldn't delete branch ${deleteBranch}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  return { removed: true, branchDeleted, warnings };
}

export interface WorktreeStatusResult {
  /** True when `cwd` is a worktree of another repo (not the main checkout). */
  isWorktree: boolean;
  /** Path to the *main* worktree (the one that owns `.git/`). */
  parentCwd?: string;
  /** Branch checked out in this worktree, if any. */
  branch?: string;
}

/**
 * Detect whether a folder is a linked worktree. We check `.git`: if it's
 * a *file* containing `gitdir: <path>/.git/worktrees/<name>`, this is a
 * linked worktree and the parent is the path containing that .git/.
 * If `.git` is a directory, this is the main checkout — not a worktree.
 */
export async function worktreeStatus(
  cwd: string,
): Promise<WorktreeStatusResult> {
  if (!cwd) return { isWorktree: false };
  try {
    const dotGit = path.join(cwd, '.git');
    const stat = await fs.stat(dotGit);
    if (stat.isDirectory()) {
      // Main checkout — read its branch and bail.
      const branch = await getGitBranch(cwd);
      return { isWorktree: false, branch: branch ?? undefined };
    }
    // .git is a file pointing at the worktree's metadata folder.
    const raw = (await fs.readFile(dotGit, 'utf8')).trim();
    if (!raw.startsWith('gitdir:')) return { isWorktree: false };
    const gitdir = raw.slice('gitdir:'.length).trim();
    const resolved = path.isAbsolute(gitdir)
      ? gitdir
      : path.resolve(cwd, gitdir);
    // resolved looks like `<parent>/.git/worktrees/<slug>`. Walk up to
    // get the parent checkout root.
    const wtMarker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
    const idx = resolved.indexOf(wtMarker);
    if (idx === -1) return { isWorktree: false };
    const parentCwd = resolved.slice(0, idx);
    const branch = await getGitBranch(cwd);
    return {
      isWorktree: true,
      parentCwd,
      branch: branch ?? undefined,
    };
  } catch {
    return { isWorktree: false };
  }
}

/**
 * List the local branches of a repo, with the current branch first.
 * Used by the worktree-create modal's "Base branch" dropdown.
 */
export async function listGitBranches(cwd: string): Promise<string[]> {
  if (!cwd) return [];
  try {
    const { stdout } = await execp(
      `git -C "${cwd}" for-each-ref --format='%(refname:short)' refs/heads`,
      { timeout: 4000 },
    );
    const all = stdout
      .split('\n')
      .map((l) => l.trim().replace(/^'|'$/g, ''))
      .filter(Boolean);
    const current = await getGitBranch(cwd);
    if (current && all.includes(current)) {
      return [current, ...all.filter((b) => b !== current)];
    }
    return all;
  } catch {
    return [];
  }
}

/** Pull the port out of a localhost URL — used by the `kill` button. */
export function parsePortFromUrl(url: string): number | null {
  try {
    const u = new URL(url);
    if (u.port) return Number(u.port);
    // Default ports for protocols we never preview. Bail.
    return null;
  } catch {
    return null;
  }
}

/**
 * For each command name in `commands`, check whether it's resolvable
 * on the user's PATH. The Workers tab uses this to mark CLI presets
 * as installed / not installed without spawning each binary.
 *
 * Cross-platform implementation:
 *   - macOS / Linux: `command -v <name>` under `/bin/sh -c` — POSIX,
 *     cheap, no dependency on /usr/bin/which.
 *   - Windows: `where <name>` via cmd.exe — built-in since Windows
 *     Server 2003 / Windows 7, returns 0 when found, 1 otherwise.
 *     `which` from Git Bash also works but `where` ships with the
 *     OS so it's the safer choice.
 *
 * The previous implementation hard-coded `/bin/sh` which doesn't
 * exist on Windows, so every probe threw and returned false — every
 * CLI permanently showed as "not installed", even right after the
 * user `npm install -g`'d it. This branch fixes that.
 *
 * Empty / whitespace command name returns true (the "Terminal" preset
 * has no command, so it's always available — the login shell itself
 * is always present).
 *
 * PATH augmentation: Electron launched outside a login shell doesn't
 * inherit Homebrew's bin paths on macOS, and on Windows it doesn't
 * always include the npm global folder. We splice the platform's
 * common install dirs in front so tools the user definitely has
 * installed don't spuriously show as missing.
 */
export async function checkCommandsAvailable(
  commands: string[],
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  const isWindows = process.platform === 'win32';
  const augmentedPath = augmentPath(process.env.PATH ?? '');
  await Promise.all(
    commands.map(async (raw) => {
      const cmd = raw?.trim();
      if (!cmd) {
        out[raw] = true;
        return;
      }
      try {
        if (isWindows) {
          // `where <name>` exits 0 when the command resolves, 1 when
          // not. Quoting protects against names with spaces (none in
          // our preset list, but defensive).
          await execp(`where ${winQuote(cmd)}`, {
            timeout: 2500,
            env: { ...process.env, PATH: augmentedPath },
            // Default shell on Windows is cmd.exe — explicit for clarity.
            shell: process.env.ComSpec || 'cmd.exe',
            windowsHide: true,
          });
        } else {
          await execp(`command -v ${shEscape(cmd)} >/dev/null 2>&1`, {
            timeout: 2000,
            env: { ...process.env, PATH: augmentedPath },
            shell: '/bin/sh',
          });
        }
        out[raw] = true;
      } catch {
        out[raw] = false;
      }
    }),
  );
  return out;
}

/** Shell-quote a token for safe inclusion in `sh -c` arguments. */
function shEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/** Quote for cmd.exe — wraps in double quotes and escapes inner doubles.
 *  Sufficient for our preset command names (no shell metacharacters). */
function winQuote(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

/**
 * Splice the platform's common install directories into PATH so the
 * probe finds tools regardless of how Electron was launched. macOS
 * Electron processes don't inherit a login shell's PATH (so Homebrew
 * paths are missing); Windows Electron usually inherits a sensible
 * PATH but we still nudge in the npm-global folder for safety.
 */
function augmentPath(existing: string): string {
  const isWindows = process.platform === 'win32';
  if (isWindows) {
    const sep = ';';
    const extras: string[] = [];
    // npm's global prefix (where `npm install -g` puts shims) — usually
    // %AppData%\npm. Without it, tools just installed via npm aren't
    // visible to a probe that only inherits the system PATH.
    if (process.env.AppData) {
      extras.push(path.join(process.env.AppData, 'npm'));
    }
    // pip's user-scripts folder for `pip install --user`.
    if (process.env.AppData) {
      extras.push(
        path.join(
          process.env.AppData,
          'Python',
          'Scripts',
        ),
      );
    }
    const parts = existing.split(sep).filter(Boolean);
    for (const ex of extras) {
      if (!parts.includes(ex)) parts.unshift(ex);
    }
    return parts.join(sep);
  }
  // macOS / Linux — Homebrew + /usr/local/bin in front.
  const extras = ['/opt/homebrew/bin', '/usr/local/bin'];
  const parts = existing.split(':').filter(Boolean);
  for (const ex of extras) {
    if (!parts.includes(ex)) parts.unshift(ex);
  }
  return parts.join(':');
}
