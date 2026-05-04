/**
 * Pull request inbox — gh CLI wrappers for INZONE's PR view.
 *
 * Why gh: same answer as gh-cli.ts. Re-uses the auth the user
 * already set up via `gh auth login`, transparently handles GitHub
 * Enterprise + SSO + 2FA, multi-account-aware.
 *
 * Three calls back the UI:
 *   listPullRequests(cwd)              → list view
 *   getPullRequestDetail(cwd, number)  → detail view (lazy)
 *   getCheckRunLogs(cwd, runId)        → "Show log" on a failed check
 *
 * Plus an isGhAvailable() probe so the renderer can render an
 * inline "install gh" hint instead of an opaque error when the
 * user hasn't set it up yet.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type {
  CheckRun,
  CheckState,
  PrComment,
  PrDetail,
  PrReviewComment,
  PrState,
  PrSummary,
} from '@shared/types';

const execp = promisify(exec);

// Same PATH augmentation gh-cli.ts uses — Electron launched from
// Spotlight/Dock doesn't inherit Homebrew paths, so we add them
// defensively before invoking gh.
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

/** Ten-second cap on most calls — list + detail are both fast in
 *  practice. Logs get a longer fuse since they can be hefty. */
const DEFAULT_TIMEOUT_MS = 15_000;
const LOG_TIMEOUT_MS = 60_000;

interface RunGhOptions {
  cwd: string;
  args: string[];
  timeoutMs?: number;
  /** Buffer cap for stdout — bigger for logs which can be megabytes. */
  maxBuffer?: number;
}

class GhError extends Error {
  constructor(
    message: string,
    public exitCode?: number,
    public stderr?: string,
  ) {
    super(message);
    this.name = 'GhError';
  }
}

/**
 * Spawn `gh` with the given args + cwd. Returns stdout on success,
 * throws a GhError with the trimmed stderr on failure.
 */
async function runGh(opts: RunGhOptions): Promise<string> {
  const command = ['gh', ...opts.args.map(quoteArg)].join(' ');
  try {
    const { stdout } = await execp(command, {
      cwd: opts.cwd,
      env: GH_ENV,
      timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS,
      maxBuffer: opts.maxBuffer ?? 4 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { stderr?: string };
    if (e.code === 'ENOENT') {
      throw new GhError(
        'gh CLI not found on PATH. Install it from cli.github.com.',
      );
    }
    const stderrTail = (e.stderr ?? '')
      .trim()
      .split('\n')
      .slice(-3)
      .join('\n')
      .trim();
    throw new GhError(
      friendlyMessage(opts.args[0] ?? '?', stderrTail),
      typeof (err as { code?: number }).code === 'number'
        ? (err as { code?: number }).code
        : undefined,
      stderrTail || undefined,
    );
  }
}

/**
 * Translate gh's raw stderr into a message that's actually useful to a
 * non-technical user. Most failures fall into a small handful of
 * buckets — repo access, auth expiry, rate limit, network — and a
 * concrete next step beats a wall of GraphQL error text.
 */
function friendlyMessage(subcommand: string, stderr: string): string {
  // Most common case for users with multiple GitHub accounts or work
  // repos behind SSO: the authenticated account just can't see the
  // repo. Strip the GraphQL noise and tell them what to do.
  if (
    /could not resolve to a repository/i.test(stderr) ||
    /not found/i.test(stderr)
  ) {
    const repoMatch = stderr.match(/['"]([^'"]+\/[^'"]+)['"]/);
    const repo = repoMatch ? repoMatch[1] : 'this repository';
    return (
      `No access to ${repo}. Your gh account either isn't a member, or ` +
      `the org requires SSO. Try: gh auth status (verify the right account ` +
      `is active) and gh auth refresh -h github.com -s read:org (re-auth ` +
      `with org access).`
    );
  }
  // Auth expired / never set up.
  if (
    /not authenticated/i.test(stderr) ||
    /authentication failed/i.test(stderr) ||
    /token has expired/i.test(stderr)
  ) {
    return (
      'gh is not authenticated. Run `gh auth login` in your terminal, ' +
      'pick GitHub.com + HTTPS, and follow the device prompt.'
    );
  }
  if (/rate limit/i.test(stderr)) {
    return 'GitHub rate limit hit — try again in a few minutes.';
  }
  if (/network|enotfound|econnrefused/i.test(stderr)) {
    return 'Network error reaching GitHub. Check your connection and retry.';
  }
  // Fall back to the raw tail, with the gh subcommand as context.
  return `gh ${subcommand} failed${stderr ? `: ${stderr}` : ''}`;
}

/** Minimal arg-quoting for the exec command line. We only ever pass
 *  alphanumerics + a few punctuation chars — wrap in double quotes if
 *  there's anything that could be unsafe. */
function quoteArg(arg: string): string {
  if (/^[\w\-./:=,]+$/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

// ── State mapping ──────────────────────────────────────────────────

/**
 * gh exposes a check's status and conclusion as separate fields.
 * Status is one of (queued | in_progress | completed); conclusion is
 * filled in once status hits completed (success | failure | skipped |
 * cancelled | timed_out | action_required | neutral). Map the join
 * onto our single CheckState enum so the UI can paint without doing
 * the dance every render.
 */
function mapCheckState(
  status: string | undefined,
  conclusion: string | undefined,
): CheckState {
  const s = (status ?? '').toLowerCase();
  const c = (conclusion ?? '').toLowerCase();

  // In-progress states map straight through.
  if (s === 'queued' || s === 'pending' || s === 'requested') return 'pending';
  if (s === 'in_progress' || s === 'running') return 'running';

  // Two field shapes in the wild:
  //   • GraphQL CheckRun: status (queued/in_progress/completed) +
  //     conclusion (success/failure/skipped/cancelled/timed_out/...)
  //   • `gh pr checks`: bucket (pass/fail/pending/skipping/cancel) —
  //     gh's friendlier roll-up. We accept either via the second arg.
  const verdict = c || s;
  if (verdict === 'success' || verdict === 'pass') return 'success';
  if (verdict === 'cancelled' || verdict === 'cancel') return 'cancelled';
  if (
    verdict === 'failure' ||
    verdict === 'fail' ||
    verdict === 'timed_out' ||
    verdict === 'action_required' ||
    verdict === 'startup_failure'
  )
    return 'failure';
  if (
    verdict === 'skipped' ||
    verdict === 'skipping' ||
    verdict === 'neutral'
  )
    return 'skipped';
  return 'unknown';
}

function mapPrState(raw: string | undefined): PrState {
  const s = (raw ?? '').toLowerCase();
  if (s === 'merged') return 'merged';
  if (s === 'closed') return 'closed';
  return 'open';
}

interface RollupItem {
  name?: string;
  context?: string;
  status?: string;
  state?: string;
  conclusion?: string;
  detailsUrl?: string;
  targetUrl?: string;
}

function summarizeChecks(rollup: RollupItem[] | undefined): {
  total: number;
  passed: number;
  failed: number;
  pending: number;
} {
  let total = 0;
  let passed = 0;
  let failed = 0;
  let pending = 0;
  for (const item of rollup ?? []) {
    total += 1;
    const state = mapCheckState(item.status ?? item.state, item.conclusion);
    if (state === 'success') passed += 1;
    else if (state === 'failure' || state === 'cancelled') failed += 1;
    else if (state === 'pending' || state === 'running') pending += 1;
  }
  return { total, passed, failed, pending };
}

// ── Public API ─────────────────────────────────────────────────────

/**
 * List recent PRs for the repo at `cwd`. Returns at most 30 — enough
 * to cover any sane "active work" inbox without paging. Closed +
 * merged PRs are included so the user can scan recent merges; the UI
 * groups them.
 */
export async function listPullRequests(cwd: string): Promise<PrSummary[]> {
  const fields = [
    'number',
    'title',
    'url',
    'state',
    'isDraft',
    'headRefName',
    'baseRefName',
    'author',
    'reviewDecision',
    'statusCheckRollup',
    'comments',
    'createdAt',
    'updatedAt',
    'mergeable',
  ].join(',');

  const stdout = await runGh({
    cwd,
    args: ['pr', 'list', '--state', 'all', '--limit', '30', '--json', fields],
  });

  const raw = JSON.parse(stdout) as Array<Record<string, unknown>>;
  return raw.map(parsePrSummary);
}

/**
 * Detailed view of one PR: body + full check list (with detail URLs
 * we can deep-link to) + issue comments + inline review comments.
 * Issued lazily when the user opens a PR card.
 */
export async function getPullRequestDetail(
  cwd: string,
  number: number,
): Promise<PrDetail> {
  // Fields valid for `gh pr view --json`. Notably absent: reviewThreads
  // (not a valid gh field — inline review comments fetched separately
  // via the REST API below). Validated against `gh pr view --help`.
  const fields = [
    'number',
    'title',
    'url',
    'state',
    'isDraft',
    'headRefName',
    'baseRefName',
    'author',
    'reviewDecision',
    'body',
    'comments',
    'createdAt',
    'updatedAt',
    'mergeable',
    'statusCheckRollup',
  ].join(',');

  // Three parallel fetches:
  //   1. PR metadata (`gh pr view`)
  //   2. Check runs with detail URLs (`gh pr checks`) — the only place
  //      gh exposes per-run links we can deep-link to.
  //   3. Inline review comments (`gh api .../pulls/N/comments`) — gh's
  //      JSON view for `pr view` doesn't expose these; we hit the REST
  //      endpoint directly. Best-effort: empty array on any failure.
  const [viewOut, checksOut, reviewCommentsOut] = await Promise.all([
    runGh({
      cwd,
      args: ['pr', 'view', String(number), '--json', fields],
    }),
    runGh({
      cwd,
      args: [
        'pr',
        'checks',
        String(number),
        '--json',
        // bucket = gh's roll-up verdict (pass/fail/pending/skipping/cancel).
        // Use this instead of `conclusion`; the latter is GraphQL-only
        // and not exposed by `gh pr checks --json`.
        'name,state,bucket,link,startedAt,completedAt,workflow',
      ],
    }).catch((err) => {
      console.warn(
        '[pr] pr checks failed; falling back to statusCheckRollup:',
        err instanceof Error ? err.message : err,
      );
      return '[]';
    }),
    fetchReviewComments(cwd, number).catch((err) => {
      console.warn(
        '[pr] review comments fetch failed:',
        err instanceof Error ? err.message : err,
      );
      return [] as PrReviewComment[];
    }),
  ]);

  const view = JSON.parse(viewOut) as Record<string, unknown>;
  const checksRaw = JSON.parse(checksOut) as Array<Record<string, unknown>>;

  // Prefer dedicated `gh pr checks` data — it has detail URLs we can
  // deep-link to. Fall back to statusCheckRollup if the call failed.
  // Note: `gh pr checks --json` exposes `bucket` (pass/fail/pending/
  // skipping/cancel) instead of GraphQL's `conclusion`. mapCheckState
  // accepts either.
  const checks: CheckRun[] =
    checksRaw.length > 0
      ? checksRaw.map((c) => ({
          name: String(c.name ?? c.workflow ?? 'unknown'),
          state: mapCheckState(
            c.state as string | undefined,
            c.bucket as string | undefined,
          ),
          conclusion: (c.bucket as string) || undefined,
          detailsUrl: (c.link as string) || undefined,
          runId: extractRunId(c.link as string | undefined),
          startedAt: (c.startedAt as string) || undefined,
          completedAt: (c.completedAt as string) || undefined,
        }))
      : ((view.statusCheckRollup as RollupItem[] | undefined) ?? []).map(
          (c) => ({
            name: c.name ?? c.context ?? 'unknown',
            state: mapCheckState(c.status ?? c.state, c.conclusion),
            conclusion: c.conclusion ?? undefined,
            detailsUrl: c.detailsUrl ?? c.targetUrl ?? undefined,
            runId: extractRunId(c.detailsUrl ?? c.targetUrl),
          }),
        );

  // Issue-level comments from the PR's conversation tab.
  const comments: PrComment[] = (
    (view.comments as Array<Record<string, unknown>>) ?? []
  ).map((c, idx) => ({
    id: String(c.id ?? `c-${idx}`),
    author: getAuthorLogin(c.author),
    body: String(c.body ?? ''),
    createdAt: String(c.createdAt ?? ''),
    updatedAt: (c.updatedAt as string) || undefined,
    url: String(c.url ?? ''),
  }));

  // Inline review comments came from a separate REST call above
  // (gh pr view --json doesn't expose reviewThreads).
  const reviewComments = reviewCommentsOut;

  const checkSummary = {
    total: checks.length,
    passed: checks.filter((c) => c.state === 'success').length,
    failed: checks.filter(
      (c) => c.state === 'failure' || c.state === 'cancelled',
    ).length,
    pending: checks.filter(
      (c) => c.state === 'pending' || c.state === 'running',
    ).length,
  };

  return {
    number: Number(view.number),
    title: String(view.title ?? ''),
    url: String(view.url ?? ''),
    state: mapPrState(view.state as string),
    isDraft: Boolean(view.isDraft),
    headRef: String(view.headRefName ?? ''),
    baseRef: String(view.baseRefName ?? ''),
    author: getAuthorLogin(view.author),
    reviewDecision: (view.reviewDecision as PrSummary['reviewDecision']) || undefined,
    body: String(view.body ?? ''),
    checks,
    checksTotal: checkSummary.total,
    checksPassed: checkSummary.passed,
    checksFailed: checkSummary.failed,
    checksPending: checkSummary.pending,
    commentCount: comments.length + reviewComments.length,
    updatedAt: String(view.updatedAt ?? ''),
    createdAt: String(view.createdAt ?? ''),
    mergeable: (view.mergeable as PrSummary['mergeable']) || undefined,
    comments,
    reviewComments,
  };
}

/**
 * Fetch the failed-step output from a workflow run. Returns the last
 * `lines` lines (default 80) so the renderer doesn't have to scroll
 * through 50 KB of yarn output to find the actual error. The full
 * log is one click away via the GitHub link.
 */
export async function getCheckRunLogs(
  cwd: string,
  runId: string,
  lines = 80,
): Promise<string> {
  const stdout = await runGh({
    cwd,
    args: ['run', 'view', runId, '--log-failed'],
    timeoutMs: LOG_TIMEOUT_MS,
    maxBuffer: 16 * 1024 * 1024,
  });
  // Last N lines — usually that's the actual error message; earlier
  // lines are the GitHub Actions noise we don't need.
  const all = stdout.replace(/\r/g, '').split('\n');
  return all.slice(-lines).join('\n').trim();
}

/**
 * Probe whether gh is installed AND authenticated for the cwd's
 * remote. Cheap — `gh auth status` exits 0 in a few hundred ms.
 * Uses a short 5s timeout so we never block the renderer waiting on
 * network in pathological cases.
 */
export async function isGhAvailable(cwd: string): Promise<boolean> {
  try {
    await runGh({
      cwd,
      args: ['auth', 'status'],
      timeoutMs: 5_000,
    });
    return true;
  } catch {
    return false;
  }
}

// ── Internals ──────────────────────────────────────────────────────

function parsePrSummary(raw: Record<string, unknown>): PrSummary {
  const checks = summarizeChecks(raw.statusCheckRollup as RollupItem[]);
  const comments = Array.isArray(raw.comments) ? raw.comments.length : 0;
  return {
    number: Number(raw.number),
    title: String(raw.title ?? ''),
    url: String(raw.url ?? ''),
    state: mapPrState(raw.state as string),
    isDraft: Boolean(raw.isDraft),
    headRef: String(raw.headRefName ?? ''),
    baseRef: String(raw.baseRefName ?? ''),
    author: getAuthorLogin(raw.author),
    reviewDecision: (raw.reviewDecision as PrSummary['reviewDecision']) || undefined,
    checksTotal: checks.total,
    checksPassed: checks.passed,
    checksFailed: checks.failed,
    checksPending: checks.pending,
    commentCount: comments,
    updatedAt: String(raw.updatedAt ?? ''),
    createdAt: String(raw.createdAt ?? ''),
    mergeable: (raw.mergeable as PrSummary['mergeable']) || undefined,
  };
}

function getAuthorLogin(author: unknown): string {
  if (author && typeof author === 'object' && 'login' in author) {
    const login = (author as { login?: unknown }).login;
    if (typeof login === 'string') return login;
  }
  return 'unknown';
}

/** GitHub run/check detail URLs look like
 *  github.com/owner/repo/actions/runs/12345/job/67890 — pull the
 *  numeric run id out so we can pass it to `gh run view`. */
function extractRunId(url: string | undefined): string | undefined {
  if (!url) return undefined;
  const m = url.match(/\/runs\/(\d+)/);
  return m ? m[1] : undefined;
}

/**
 * Fetch inline review comments via the REST API. `gh pr view --json`
 * doesn't expose them; this hits /repos/{owner}/{repo}/pulls/{N}/comments
 * directly. Returns empty array if the call fails (we don't want to
 * crash the whole detail load just because comments are missing).
 *
 * gh resolves the owner/repo from the cwd's remote, so we just pass
 * the relative path with `{owner}/{repo}` placeholders that `gh api`
 * fills in. The `--repo` shortcut lets gh do that resolution.
 */
async function fetchReviewComments(
  cwd: string,
  number: number,
): Promise<PrReviewComment[]> {
  // Use gh api with --hostname-aware repo derivation so the call
  // works for any GitHub host (including Enterprise) without us
  // re-implementing remote-URL parsing.
  const stdout = await runGh({
    cwd,
    args: [
      'api',
      `repos/{owner}/{repo}/pulls/${number}/comments`,
      '--paginate',
      '-q',
      // Project the REST fields we need into a flat shape so the
      // renderer code doesn't have to know about the API surface.
      '[.[] | { id: (.id|tostring), author: (.user.login // "unknown"), ' +
        'body: (.body // ""), path: (.path // ""), line: (.line // .original_line), ' +
        'diffHunk: (.diff_hunk // null), createdAt: (.created_at // ""), ' +
        'updatedAt: (.updated_at // null), url: (.html_url // ""), ' +
        'inReplyTo: ((.in_reply_to_id // null) | tostring) }]',
    ],
  });
  if (!stdout.trim()) return [];
  // --paginate returns concatenated arrays — one JSON array per page.
  // Parse line-by-line and flatten.
  const parts = stdout
    .split(/\n(?=\[)/) // split before any '[' that starts a line
    .map((s) => s.trim())
    .filter(Boolean);
  const out: PrReviewComment[] = [];
  for (const part of parts) {
    try {
      const arr = JSON.parse(part) as Array<Record<string, unknown>>;
      for (const c of arr) {
        out.push({
          id: String(c.id ?? `rc-${out.length}`),
          author: String(c.author ?? 'unknown'),
          body: String(c.body ?? ''),
          path: String(c.path ?? ''),
          line:
            typeof c.line === 'number' ? c.line : undefined,
          diffHunk: (c.diffHunk as string) || undefined,
          createdAt: String(c.createdAt ?? ''),
          updatedAt: (c.updatedAt as string) || undefined,
          url: String(c.url ?? ''),
          inReplyTo:
            c.inReplyTo && c.inReplyTo !== 'null'
              ? String(c.inReplyTo)
              : undefined,
        });
      }
    } catch {
      // Bad JSON chunk — skip, keep what we've parsed so far.
    }
  }
  return out;
}
