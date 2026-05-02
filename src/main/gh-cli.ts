/**
 * GitHub PR workflow helpers — wraps the `gh` CLI plus the bare git
 * commands we need for committing + pushing.
 *
 * Why `gh` over the GitHub API directly? Two reasons: (1) the user
 * is probably already authenticated via `gh auth login`, so we get
 * auth for free; (2) it transparently handles GitHub Enterprise +
 * SSO + 2FA, which are a pain to reimplement.
 *
 * Phase 3 v1 scope: single squash commit (when the working tree is
 * dirty) → push → PR via `gh pr create`. The "preserve agent commits"
 * toggle is a future iteration.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { GhAccount, GhStatus, PRDraft } from '@shared/types';

const execp = promisify(exec);

// Most macOS users install gh via Homebrew, which lives in /opt/homebrew
// (Apple Silicon) or /usr/local (Intel). When Electron launches outside
// of a login shell (Spotlight / Dock) it doesn't pick those up, so we
// augment PATH defensively before invoking gh. Same recipe Claude Code
// uses internally.
const PATH_AUGMENT = [
  process.env.PATH ?? '',
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
]
  .filter(Boolean)
  .join(':');

const GH_ENV = { ...process.env, PATH: PATH_AUGMENT };

// ── Detection ──────────────────────────────────────────────────────

/**
 * Probe whether `gh` is installed AND authenticated, plus look up the
 * remote info for the worktree (owner/repo + default branch). Cheap
 * enough to call on every modal open — three short shell-outs.
 */
export async function detectGh(args: { cwd: string }): Promise<GhStatus> {
  const { cwd } = args;
  if (!cwd) throw new Error('cwd is required');

  // 1) Is `gh` on PATH at all?
  const installed = await commandExists('gh');
  if (!installed) {
    return { installed: false, authenticated: false };
  }

  // 2) Is the user logged in?
  let authenticated = false;
  try {
    // `gh auth status` exits 0 when authenticated, non-zero otherwise.
    // It always writes to stderr regardless, so we don't care about
    // stdout. We only care about the exit code.
    await execp('gh auth status', { timeout: 6000, env: GH_ENV });
    authenticated = true;
  } catch {
    authenticated = false;
  }

  // 3) Pull remote info — owner/repo + default branch + protocol —
  //    directly from git rather than gh, because `gh repo view`
  //    requires auth and we want to surface the slug even when the
  //    user isn't logged in yet.
  const { repoSlug, defaultBranch, remoteProtocol, remoteUrl } =
    await readRemoteInfo(cwd);

  return {
    installed: true,
    authenticated,
    repoSlug,
    defaultBranch,
    remoteProtocol,
    remoteUrl,
  };
}

/**
 * Set this repo's `origin` remote URL to whatever the caller passes.
 * Used by the PR modal's "paste your own URL" escape hatch when the
 * automatic detection / auto-conversion don't fit the user's setup.
 * Caller is responsible for validating the URL shape; we just hand
 * it to git and surface its error verbatim if anything's off.
 */
export async function setRemoteUrl(args: {
  cwd: string;
  url: string;
}): Promise<{ url: string }> {
  const { cwd, url } = args;
  if (!cwd) throw new Error('cwd is required');
  if (!url || !url.trim()) throw new Error('url is required');
  await execp(
    `git -C "${cwd}" remote set-url origin "${url.trim()}"`,
    { timeout: 6000, env: GH_ENV },
  );
  return { url: url.trim() };
}

/**
 * Convert this repo's `origin` remote from SSH to HTTPS so git push
 * uses gh's stored credentials (which respect `gh auth switch`)
 * instead of ssh-agent's identity selection. No-op when origin is
 * already HTTPS or when origin can't be parsed.
 *
 * Throws when origin doesn't exist or git fails. Otherwise returns
 * the new URL so the renderer can echo it back.
 */
export async function switchRemoteToHttps(args: {
  cwd: string;
}): Promise<{ url: string; changed: boolean }> {
  const { cwd } = args;
  if (!cwd) throw new Error('cwd is required');

  const { stdout } = await execp(
    `git -C "${cwd}" remote get-url origin`,
    { timeout: 4000, env: GH_ENV },
  );
  const current = stdout.trim();
  if (!current) throw new Error('origin remote is empty.');

  if (current.startsWith('https://') || current.startsWith('http://')) {
    return { url: current, changed: false };
  }

  const slug = parseRepoSlug(current);
  if (!slug) {
    throw new Error(`Could not parse owner/repo from "${current}".`);
  }

  const httpsUrl = `https://github.com/${slug}.git`;
  await execp(
    `git -C "${cwd}" remote set-url origin "${httpsUrl}"`,
    { timeout: 6000, env: GH_ENV },
  );

  return { url: httpsUrl, changed: true };
}

/** Resolve the origin remote into "owner/repo" + remote HEAD's branch. */
async function readRemoteInfo(cwd: string): Promise<{
  repoSlug?: string;
  defaultBranch?: string;
  remoteProtocol?: 'ssh' | 'https' | 'other';
  remoteUrl?: string;
}> {
  let repoSlug: string | undefined;
  let defaultBranch: string | undefined;
  let remoteProtocol: 'ssh' | 'https' | 'other' | undefined;
  let remoteUrl: string | undefined;
  try {
    const { stdout } = await execp(
      `git -C "${cwd}" remote get-url origin`,
      { timeout: 4000, env: GH_ENV },
    );
    remoteUrl = stdout.trim();
    repoSlug = parseRepoSlug(remoteUrl);
    if (remoteUrl.startsWith('git@') || remoteUrl.startsWith('ssh://')) {
      remoteProtocol = 'ssh';
    } else if (
      remoteUrl.startsWith('https://') ||
      remoteUrl.startsWith('http://')
    ) {
      remoteProtocol = 'https';
    } else {
      remoteProtocol = 'other';
    }
  } catch {
    // No origin → we can't open a PR. Surface this in the UI.
  }
  try {
    // origin/HEAD points to the remote's default branch (e.g. main).
    // This is set automatically by `git clone`. If it's missing we
    // fall back to a plausible default in the renderer.
    const { stdout } = await execp(
      `git -C "${cwd}" symbolic-ref --short refs/remotes/origin/HEAD`,
      { timeout: 4000, env: GH_ENV },
    );
    // Output looks like "origin/main"; strip the prefix.
    const ref = stdout.trim();
    if (ref.startsWith('origin/')) {
      defaultBranch = ref.slice('origin/'.length);
    }
  } catch {
    // No HEAD ref — fine, defaultBranch stays undefined.
  }
  return { repoSlug, defaultBranch, remoteProtocol, remoteUrl };
}

/** Parse owner/repo out of an SSH or HTTPS git remote URL. */
export function parseRepoSlug(remoteUrl: string): string | undefined {
  // Patterns we handle:
  //   git@github.com:owner/repo.git
  //   https://github.com/owner/repo.git
  //   https://github.com/owner/repo
  //   ssh://git@github.com/owner/repo.git
  const m = remoteUrl.match(
    /[/:]([^/:]+?)\/([^/]+?)(?:\.git)?\/?$/,
  );
  if (!m) return undefined;
  return `${m[1]}/${m[2]}`;
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execp(`command -v ${cmd}`, { timeout: 2000, env: GH_ENV });
    return true;
  } catch {
    return false;
  }
}

// ── Commit ─────────────────────────────────────────────────────────

export interface CommitArgs {
  cwd: string;
  /** Subject line — shows up first in the PR's commit list. */
  message: string;
  /** Optional body — multi-line description. */
  body?: string;
}

export interface CommitResult {
  /** Short SHA of the new commit, when one was created. */
  sha?: string;
  /** True when nothing was committed because the working tree was
   *  already clean. The caller should treat this as a success. */
  skipped: boolean;
}

/**
 * Stage everything in the worktree and commit it as one squashed
 * commit. If the tree is clean, skip silently (returns
 * `{ skipped: true }`).
 */
export async function commitChanges(args: CommitArgs): Promise<CommitResult> {
  const { cwd, message, body } = args;
  if (!cwd) throw new Error('cwd is required');
  if (!message.trim()) throw new Error('Commit message is required');

  // Working tree clean? `git status --porcelain` outputs one line per
  // changed entry; empty stdout means nothing to commit.
  const { stdout: status } = await execp(
    `git -C "${cwd}" status --porcelain`,
    { timeout: 6000, env: GH_ENV },
  );
  if (status.trim().length === 0) {
    return { skipped: true };
  }

  await execp(`git -C "${cwd}" add -A`, {
    timeout: 30_000,
    env: GH_ENV,
  });

  // Commit with -m / -m so subject and body land in different
  // paragraphs the way conventional commit clients expect. Quote
  // arguments via base64 + heredoc to keep shell-special characters
  // (backticks, $, etc) from the message body intact. We use git's
  // -F with stdin instead of -m to avoid that whole quoting headache.
  const fullMessage = body && body.trim().length > 0
    ? `${message.trim()}\n\n${body.trim()}`
    : message.trim();

  await new Promise<void>((resolve, reject) => {
    const child = exec(
      `git -C "${cwd}" commit -F -`,
      { timeout: 15_000, env: GH_ENV },
      (err, _stdout, stderr) => {
        if (err) {
          const msg = stderr.trim() || err.message;
          reject(new Error(`git commit failed: ${msg}`));
        } else {
          resolve();
        }
      },
    );
    if (child.stdin) {
      child.stdin.write(fullMessage);
      child.stdin.end();
    } else {
      reject(new Error('no stdin on git commit child process'));
    }
  });

  // Grab the new commit's short SHA so the renderer can reference it.
  let sha: string | undefined;
  try {
    const { stdout } = await execp(
      `git -C "${cwd}" rev-parse --short HEAD`,
      { timeout: 4000, env: GH_ENV },
    );
    sha = stdout.trim() || undefined;
  } catch {
    // Non-fatal — sha is informational.
  }

  return { sha, skipped: false };
}

// ── Push ───────────────────────────────────────────────────────────

export interface PushArgs {
  cwd: string;
  branch: string;
  /** Push with --set-upstream so subsequent pushes work without -u. */
  setUpstream?: boolean;
}

/**
 * Push the worktree's branch to origin. Sets upstream by default so
 * the user's terminal `git push` works after we hand off.
 */
export async function pushBranch(args: PushArgs): Promise<{ ok: true }> {
  const { cwd, branch, setUpstream = true } = args;
  if (!cwd) throw new Error('cwd is required');
  if (!branch) throw new Error('branch is required');

  const upstreamFlag = setUpstream ? '-u' : '';
  await execp(
    `git -C "${cwd}" push ${upstreamFlag} origin "${branch}"`,
    { timeout: 60_000, env: GH_ENV },
  );
  return { ok: true };
}

/**
 * Pull the latest commits for `branch` from origin into the local
 * checkout at `cwd`. Used in the post-merge wrap-up to bring the
 * merged PR commits back into the parent project before removing
 * the worktree. Switches `cwd` to the target branch first if it's
 * not already there (refuses if the working tree is dirty).
 *
 * Output is captured but not parsed — git's "Already up to date."
 * vs "Fast-forward" doesn't matter to the caller; either way the
 * branch is now caught up.
 */
export async function pullBranch(args: {
  cwd: string;
  branch: string;
}): Promise<{ ok: true }> {
  const { cwd, branch } = args;
  if (!cwd) throw new Error('cwd is required');
  if (!branch) throw new Error('branch is required');

  // Refuse if the working tree is dirty — `git pull` would either
  // refuse or interleave the user's WIP into the merge. Surface a
  // clear message so the user knows what to do.
  const { stdout: status } = await execp(
    `git -C "${cwd}" status --porcelain`,
    { timeout: 6000, env: GH_ENV },
  );
  if (status.trim().length > 0) {
    throw new Error(
      `Parent project (${cwd}) has uncommitted changes. Commit or stash them before pulling.`,
    );
  }

  // Switch to the target branch if we're not already there.
  const { stdout: currentRaw } = await execp(
    `git -C "${cwd}" branch --show-current`,
    { timeout: 4000, env: GH_ENV },
  );
  const current = currentRaw.trim();
  if (current !== branch) {
    await execp(`git -C "${cwd}" checkout "${branch}"`, {
      timeout: 10_000,
      env: GH_ENV,
    });
  }

  await execp(
    `git -C "${cwd}" pull origin "${branch}"`,
    { timeout: 60_000, env: GH_ENV },
  );
  return { ok: true };
}

/**
 * Make sure `branch` exists on origin. Returns whether we had to push
 * it ourselves. Used before `gh pr create` so the base branch is
 * resolvable on GitHub — without this, repos initialized locally
 * (where main was never pushed) trip GitHub's "Base ref must be a
 * branch" / "No commits between" error path.
 *
 * `git push` from a worktree's cwd works for any local ref because
 * refs are stored in the parent's shared .git directory. So even
 * though `main` isn't checked out in the worktree, pushing it from
 * here works and is simpler than locating the parent project's cwd.
 */
export async function ensureRemoteBranch(args: {
  cwd: string;
  branch: string;
}): Promise<{ existed: boolean; pushed: boolean }> {
  const { cwd, branch } = args;
  if (!cwd) throw new Error('cwd is required');
  if (!branch) throw new Error('branch is required');

  // Probe origin for the branch. ls-remote is cheap (no full fetch)
  // and prints `<sha>\trefs/heads/<branch>` when the branch exists.
  let exists = false;
  try {
    const { stdout } = await execp(
      `git -C "${cwd}" ls-remote --heads origin "${branch}"`,
      { timeout: 15_000, env: GH_ENV },
    );
    exists = stdout.trim().length > 0;
  } catch {
    // ls-remote failed — could be auth, network, or no origin. Let
    // the push attempt below surface a real error if so.
  }

  if (exists) return { existed: true, pushed: false };

  // Make sure the local ref exists before we try to push it. A repo
  // freshly init'd with no commits won't have refs/heads/<branch>
  // yet — surface a clear error rather than git's cryptic one.
  try {
    await execp(
      `git -C "${cwd}" rev-parse --verify "refs/heads/${branch}"`,
      { timeout: 4000, env: GH_ENV },
    );
  } catch {
    throw new Error(
      `Branch "${branch}" doesn't exist locally. Make at least one commit on it before opening a PR.`,
    );
  }

  await execp(
    `git -C "${cwd}" push -u origin "${branch}"`,
    { timeout: 60_000, env: GH_ENV },
  );
  return { existed: false, pushed: true };
}

// ── Create PR ──────────────────────────────────────────────────────

export interface CreatePRResult {
  /** Browser URL of the new PR. */
  url: string;
  /** PR number. */
  number?: number;
}

/**
 * `gh pr create` with the user's title + body. The remote needs to
 * be reachable and authed (we surface auth errors verbatim so the
 * user can re-run `gh auth login`).
 */
export async function createPR(args: {
  cwd: string;
  draft: PRDraft;
}): Promise<CreatePRResult> {
  const { cwd, draft } = args;
  if (!cwd) throw new Error('cwd is required');

  // Use stdin for the body — same reason as commit message: avoids
  // shell quoting hell when the body contains backticks, $, ", etc.
  // gh supports `--body-file -` to read body from stdin.
  const flags = [
    `--base "${draft.baseBranch}"`,
    `--head "${draft.headBranch}"`,
    `--title ${shellEscape(draft.title)}`,
    `--body-file -`,
    draft.draft ? '--draft' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const url = await new Promise<string>((resolve, reject) => {
    const child = exec(
      `gh pr create ${flags}`,
      { timeout: 30_000, cwd, env: GH_ENV },
      (err, stdout, stderr) => {
        if (err) {
          const msg = stderr.trim() || err.message;
          reject(new Error(`gh pr create failed: ${msg}`));
        } else {
          // gh prints the PR URL on success.
          const out = stdout.trim();
          // Extract first https://...URL just in case there's trailing chatter.
          const m = out.match(/https?:\/\/\S+/);
          resolve(m ? m[0] : out);
        }
      },
    );
    if (child.stdin) {
      child.stdin.write(draft.body);
      child.stdin.end();
    } else {
      reject(new Error('no stdin on gh pr create child process'));
    }
  });

  // Try to parse the PR number off the URL's tail (e.g. /pull/42).
  let number: number | undefined;
  const m = url.match(/\/pull\/(\d+)/);
  if (m) number = Number(m[1]);

  return { url, number };
}

/** Single-quote escape for shell — wrap in '...' and escape any
 *  embedded single quotes. Safe for everything except null bytes. */
function shellEscape(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

// ── Multi-account gh ───────────────────────────────────────────────

/**
 * Parse `gh auth status` output to surface every gh account the user
 * has logged in. We use the textual output (not --json, which is only
 * available in recent gh versions) and regex out the lines.
 *
 * Sample stderr (gh writes to stderr):
 *   github.com
 *     ✓ Logged in to github.com as username-a (keyring)
 *     - Active account: true
 *     - Git operations protocol: https
 *     ...
 *
 *     ✓ Logged in to github.com as username-b (keyring)
 *     - Active account: false
 *     ...
 */
export async function listGhAccounts(): Promise<GhAccount[]> {
  let raw = '';
  try {
    // gh writes auth status to stderr regardless of exit code. exec()'s
    // callback gives us both streams; we read stderr for the parse.
    const { stderr, stdout } = await execp('gh auth status', {
      timeout: 6000,
      env: GH_ENV,
    });
    raw = (stderr || '') + '\n' + (stdout || '');
  } catch (err) {
    // exec() rejects on non-zero exit; we still want stderr because
    // gh prints account info there even when not authenticated to a
    // particular host. Pull the streams off the error if we can.
    const e = err as { stderr?: string; stdout?: string };
    raw = (e.stderr ?? '') + '\n' + (e.stdout ?? '');
    if (!raw.trim()) return [];
  }

  // Walk the lines, tracking the most recent "Logged in <as|account>
  // <name>" and pairing it with the next "Active account: ..." line.
  // gh changed the wording between versions:
  //   older: "Logged in to github.com as <username> (keyring)"
  //   newer: "Logged in to github.com account <username> (keyring)"
  // Match both with a single regex.
  const lines = raw.split('\n');
  const accounts: GhAccount[] = [];
  let pendingLogin: string | null = null;
  for (const line of lines) {
    const loginMatch = line.match(
      /Logged in to \S+ (?:as|account) (\S+)/,
    );
    if (loginMatch) {
      pendingLogin = loginMatch[1];
      continue;
    }
    const activeMatch = line.match(/Active account:\s*(true|false)/i);
    if (activeMatch && pendingLogin) {
      accounts.push({
        login: pendingLogin,
        active: activeMatch[1].toLowerCase() === 'true',
      });
      pendingLogin = null;
    }
  }
  // Older gh versions don't emit "Active account:" — fall back to
  // marking the first (and typically only) login as active.
  if (accounts.length === 0 && pendingLogin) {
    accounts.push({ login: pendingLogin, active: true });
  }
  // Defensive: if we somehow have multiple accounts but none marked
  // active, mark the first one active so callers always have a
  // non-empty active hint.
  if (accounts.length > 0 && !accounts.some((a) => a.active)) {
    accounts[0].active = true;
  }
  return accounts;
}

/**
 * Switch the active gh account. Used right before a push when the
 * user's selected "Push as" account differs from the currently-active
 * one. Idempotent: switching to the already-active account is a no-op.
 */
export async function switchGhAccount(args: {
  login: string;
}): Promise<{ ok: true }> {
  const { login } = args;
  if (!login) throw new Error('login is required');
  try {
    await execp(`gh auth switch -u "${login}"`, {
      timeout: 8000,
      env: GH_ENV,
    });
    return { ok: true };
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    const msg = (e.stderr ?? '').trim() || e.message || String(err);
    throw new Error(`gh auth switch failed: ${msg}`);
  }
}
