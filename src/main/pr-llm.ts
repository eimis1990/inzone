/**
 * One-shot LLM helpers for the PR drawer:
 *
 *   - `validateComment(...)` — sends a PR comment + the cited code
 *     to a fast model and asks "is this suggestion sensible?". Returns
 *     a verdict (`good` / `caution` / `bad`) plus a short reasoning.
 *     Used by the Validate button on each comment card so the user
 *     can vet a PR comment (often a noisy Copilot suggestion) before
 *     handing it to an agent.
 *
 *   - `suggestReply(...)` — drafts a friendly summary message replying
 *     to the comment, using the agent's recent transcript snippet as
 *     "what was actually done." Used by the Reply composer to
 *     pre-fill a textarea the user can edit before posting.
 *
 *   - `postReply(...)` — posts a comment reply via `gh`. Two paths:
 *     review comments need a threaded reply at
 *     `repos/{owner}/{repo}/pulls/{n}/comments/{id}/replies`; issue
 *     comments use `gh pr comment {n} --body`.
 *
 * Both LLM helpers wrap the Agent SDK's `query()` the same way
 * agent-generator.ts does, so they pick up either ANTHROPIC_API_KEY
 * or `claude login` subscription credentials automatically. We use
 * Haiku for both — fast and cheap, and the tasks (judge a paragraph,
 * write a paragraph) don't need Sonnet's reasoning depth.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { query } from '@anthropic-ai/claude-agent-sdk';

const execp = promisify(exec);

// ── LLM: validate ────────────────────────────────────────────────────

export interface ValidateCommentArgs {
  /** Verbatim text of the PR comment we're validating. */
  commentBody: string;
  /** Where the comment was made. For review comments this is `path:line`,
   *  for issue comments it's the PR title — both surface useful context
   *  for the model. */
  location: string;
  /** Optional diff hunk (for review comments) — gives the model the
   *  exact code the comment is about. Omit for issue comments. */
  diffHunk?: string;
}

export type CommentVerdict = 'good' | 'caution' | 'bad';

export interface ValidateCommentResult {
  verdict: CommentVerdict;
  /** 1-2 sentence reasoning for the verdict. Always populated. */
  reasoning: string;
}

/**
 * Ask Haiku whether a PR comment's suggestion is sensible. We bias
 * the prompt toward catching the common failure modes of automated
 * reviewers: false positives, suggestions that would introduce
 * regressions, suggestions that misread the surrounding code, and
 * suggestions that are technically valid but pointless.
 *
 * Output is forced to a strict JSON shape so we don't have to parse
 * loose prose. If the model wraps it in fences we strip them. If
 * parsing fails we surface a graceful "caution" verdict — better
 * than throwing during a UI hover.
 */
export async function validateComment(
  args: ValidateCommentArgs,
): Promise<ValidateCommentResult> {
  const meta = `You are reviewing a comment that someone (or an automated reviewer like Copilot) left on a pull request. Decide whether the comment is a sensible, actionable suggestion that should be acted on.

COMMENT LOCATION: ${args.location}

COMMENT BODY:
${quoteBlock(args.commentBody)}
${
  args.diffHunk
    ? `\nCODE CONTEXT (diff hunk being commented on):\n\`\`\`diff\n${args.diffHunk.trim()}\n\`\`\``
    : ''
}

JUDGEMENT CRITERIA
- "good" — the comment makes a correct, clear, actionable suggestion that an agent can implement.
- "caution" — the comment is partially valid but has concerns: vague, partially incorrect, may cause regressions, or asks for something already done.
- "bad" — the comment is wrong, misreads the code, suggests something harmful, or is pointless.

OUTPUT FORMAT (strict)
Output ONLY a JSON object on a single line:
{"verdict": "good" | "caution" | "bad", "reasoning": "1-2 sentence explanation"}

No prose, no markdown fences. The reasoning should be terse and concrete — what specifically is good, concerning, or wrong about the comment. Don't repeat the comment back.`;

  const stream = query({
    prompt: meta,
    options: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: 'haiku' as any,
      permissionMode: 'bypassPermissions',
      settingSources: [],
      includePartialMessages: false,
      systemPrompt:
        'You are a careful code reviewer. Output only the JSON object the user requests, nothing else.',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  const collected = await collectAssistantText(stream);
  return parseValidateResult(collected);
}

function parseValidateResult(text: string): ValidateCommentResult {
  // Strip code fences if the model couldn't help itself.
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\n?([\s\S]*?)\n?```$/);
  const candidate = (fenced ? fenced[1] : trimmed).trim();
  try {
    const parsed = JSON.parse(candidate) as Record<string, unknown>;
    const verdictRaw = String(parsed.verdict ?? '').toLowerCase();
    const verdict: CommentVerdict =
      verdictRaw === 'good' || verdictRaw === 'caution' || verdictRaw === 'bad'
        ? (verdictRaw as CommentVerdict)
        : 'caution';
    const reasoning =
      typeof parsed.reasoning === 'string' && parsed.reasoning.trim().length > 0
        ? parsed.reasoning.trim()
        : 'No reasoning produced.';
    return { verdict, reasoning };
  } catch {
    // Model returned non-JSON. Don't fail the user's click — degrade
    // gracefully by surfacing the raw text under a "caution" verdict.
    return {
      verdict: 'caution',
      reasoning:
        candidate.length > 240 ? candidate.slice(0, 240) + '…' : candidate,
    };
  }
}

// ── LLM: suggest reply ──────────────────────────────────────────────

export interface SuggestReplyArgs {
  /** The PR comment we're replying to. */
  commentBody: string;
  /** Same location label as validate — gives the model framing. */
  location: string;
  /**
   * Snippet of the agent's recent transcript that addressed this
   * comment. Caller (the renderer) extracts whatever's most relevant —
   * typically the last assistant turn after the comment was sent to
   * the agent. Empty string is fine; the model just falls back to a
   * generic acknowledgement reply.
   */
  agentSummary: string;
}

/**
 * Draft a short, friendly reply the user can post on GitHub after
 * the agent made the requested change. The prompt instructs Haiku
 * to keep it conversational and concrete (what was changed, where),
 * not corporate-speak.
 */
export async function suggestReply(args: SuggestReplyArgs): Promise<string> {
  const meta = `You're helping the PR author draft a short reply to a reviewer's comment. The author has already had an AI agent make the requested change — your job is to summarise what was done in a brief, friendly message they can post back on GitHub.

REVIEWER'S COMMENT (at ${args.location}):
${quoteBlock(args.commentBody)}

WHAT THE AGENT DID (excerpted from its transcript):
${
  args.agentSummary && args.agentSummary.trim().length > 0
    ? quoteBlock(args.agentSummary)
    : '(no transcript provided — write a short generic acknowledgement)'
}

REQUIREMENTS
- 1-3 sentences max. Conversational tone, no corporate boilerplate.
- Mention the specific change concretely if the transcript shows one — e.g. "Renamed X to Y in foo.ts" — but don't invent details.
- If the transcript is empty or vague, default to a polite "Done — addressed the feedback." style.
- No salutation, no signature, no markdown headers.
- Output ONLY the reply text. No quoting of the original comment, no "Reply: " prefix.`;

  const stream = query({
    prompt: meta,
    options: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: 'haiku' as any,
      permissionMode: 'bypassPermissions',
      settingSources: [],
      includePartialMessages: false,
      systemPrompt:
        'You are a concise, friendly software engineer drafting a PR reply. Output only the reply text the user requests, nothing else.',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  const text = await collectAssistantText(stream);
  // Strip leading/trailing fences or "Reply:" prefixes the model
  // sometimes adds despite the instruction.
  return text
    .replace(/^```(?:markdown|md|text)?\n?/i, '')
    .replace(/\n?```$/i, '')
    .replace(/^reply:\s*/i, '')
    .trim();
}

// ── gh: post reply ──────────────────────────────────────────────────

export interface PostReplyArgs {
  cwd: string;
  prNumber: number;
  body: string;
  /**
   * The comment we're replying to. For review comments we need the
   * comment id to thread the reply; for issue comments we just post
   * a fresh top-level comment on the PR.
   */
  kind: 'review' | 'issue';
  /** Required when `kind === 'review'`. Numeric GitHub comment id. */
  reviewCommentId?: string;
}

export interface PostReplyResult {
  /** URL of the new comment on GitHub. Surfaced by the UI as a
   *  "View on GitHub" link after a successful post. */
  url: string;
}

/**
 * Post a reply to a PR comment via `gh`. Throws on gh failures
 * (auth, network, missing repo) — caller surfaces the message to
 * the user. The reply body is passed via stdin to avoid arg-length
 * limits and shell-quoting hazards on long messages.
 */
export async function postReply(args: PostReplyArgs): Promise<PostReplyResult> {
  const body = args.body.trim();
  if (!body) {
    throw new Error('Reply body cannot be empty.');
  }

  if (args.kind === 'review') {
    if (!args.reviewCommentId) {
      throw new Error(
        'Review comment id is required to thread the reply.',
      );
    }
    // POST to /pulls/{n}/comments/{id}/replies with the body in a
    // JSON field. We use `gh api -F` to send the body as a form field
    // (gh handles the JSON encoding); -F avoids the "field is too
    // large for an arg" error you'd hit on multi-paragraph replies.
    const stdout = await execGh([
      'api',
      `repos/{owner}/{repo}/pulls/${args.prNumber}/comments/${args.reviewCommentId}/replies`,
      '--method',
      'POST',
      '-f',
      `body=${body}`,
      '-q',
      '.html_url',
    ], args.cwd);
    return { url: stdout.trim() };
  }

  // Issue-comment path: `gh pr comment N --body-file -` reads body
  // from stdin. We use `gh api` instead so we can capture the URL.
  const stdout = await execGh([
    'api',
    `repos/{owner}/{repo}/issues/${args.prNumber}/comments`,
    '--method',
    'POST',
    '-f',
    `body=${body}`,
    '-q',
    '.html_url',
  ], args.cwd);
  return { url: stdout.trim() };
}

// ── helpers ──────────────────────────────────────────────────────────

/** Run gh from `cwd`, return stdout. Re-uses the same env pattern as
 *  pr.ts so login-shell PATH augmentations apply. Inlined here to
 *  avoid a circular import with pr.ts. */
async function execGh(args: string[], cwd: string): Promise<string> {
  const command = ['gh', ...args.map(quoteArg)].join(' ');
  const { stdout } = await execp(command, {
    cwd,
    env: { ...process.env, PATH: augmentPath(process.env.PATH ?? '') },
    timeout: 20_000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return stdout;
}

function quoteArg(s: string): string {
  // Same approach as pr.ts: single-quote everything, escape inner
  // single quotes by closing the quote / inserting an escaped one /
  // re-opening. Safe for body content with shell metacharacters.
  return `'${s.replace(/'/g, "'\\''")}'`;
}

function augmentPath(existing: string): string {
  const extras = ['/opt/homebrew/bin', '/usr/local/bin'];
  const parts = existing.split(':').filter(Boolean);
  for (const ex of extras) {
    if (!parts.includes(ex)) parts.unshift(ex);
  }
  return parts.join(':');
}

function quoteBlock(text: string): string {
  return text
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
}

/**
 * Drain a query() stream and collect the assistant's text. Mirrors
 * the loop in agent-generator.ts. We don't care about tool calls,
 * partial events, or anything other than `assistant` messages with
 * text content blocks.
 */
async function collectAssistantText(
  stream: AsyncIterable<unknown>,
): Promise<string> {
  let collected = '';
  for await (const raw of stream) {
    const msg = raw as {
      type: string;
      message?: { content?: Array<{ type?: string; text?: string }> };
    };
    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message!.content!) {
        if (block.type === 'text' && typeof block.text === 'string') {
          collected += block.text;
        }
      }
    }
    if (msg.type === 'result') break;
  }
  return collected;
}
