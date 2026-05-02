/**
 * Claude-powered PR title + body generator.
 *
 * Caller passes a small structured summary of what the agent did (the
 * branch, the file list, the user's prompt, the agent's last reply)
 * and we ask Claude to draft a PR title + markdown body. Mirrors the
 * `generateAgentBody` pattern in agent-generator.ts — same one-shot
 * `query()` invocation with no tools / no skills.
 *
 * The output JSON is parsed by the caller into title + body. We also
 * always return a fallback if Claude misbehaves so the modal never
 * hangs on a bad parse.
 */

import { query } from '@anthropic-ai/claude-agent-sdk';

export interface PRSummarizeInput {
  /** Branch name (e.g. `feature/yacht-detail-fix`). */
  branch: string;
  /** Base branch the PR will target. */
  baseBranch: string;
  /** Repo-relative file paths that changed in this branch. */
  files: string[];
  /** Total +/- line counts across all hunks (informational, helps
   *  Claude calibrate the description length). */
  additions: number;
  deletions: number;
  /** The user's original prompt that kicked off this work, when we
   *  can find one. The most recent user-turn from the worktree's
   *  primary pane. */
  userPrompt?: string;
  /** The agent's most recent assistant reply — usually contains the
   *  best summary of what was done. */
  agentReply?: string;
}

export interface PRSummarizeOutput {
  title: string;
  body: string;
}

/**
 * Generate a PR title + body from the inputs. Always returns
 * something — falls back to a generic auto-generated description if
 * Claude fails to respond or returns malformed output.
 */
export async function summarizePR(
  input: PRSummarizeInput,
): Promise<PRSummarizeOutput> {
  const fallback = buildFallback(input);

  const meta = buildMetaPrompt(input);

  let collected = '';
  try {
    const stream = query({
      prompt: meta,
      options: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        model: 'sonnet' as any,
        permissionMode: 'bypassPermissions',
        settingSources: [],
        includePartialMessages: false,
        systemPrompt:
          'You are a careful release engineer. Output only what the user requests, in the exact JSON format requested.',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any,
    });

    for await (const raw of stream as AsyncIterable<unknown>) {
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
  } catch {
    return fallback;
  }

  const parsed = tryParseJson(collected);
  if (parsed) return parsed;
  return fallback;
}

// ── internals ──────────────────────────────────────────────────────

function buildMetaPrompt(input: PRSummarizeInput): string {
  // Truncate file list and reply text aggressively. The agent's reply
  // can be quite long; we cap it at ~3k chars so the prompt stays
  // small and Sonnet stays fast.
  const filesPreview = input.files.slice(0, 20).join('\n');
  const moreFiles =
    input.files.length > 20
      ? `\n…and ${input.files.length - 20} more.`
      : '';
  const userPrompt = (input.userPrompt ?? '').slice(0, 800);
  const agentReply = (input.agentReply ?? '').slice(0, 3000);

  return `Summarize the changes below as a GitHub PR title and body.

CONTEXT
- Branch: ${input.branch}
- Targeting: ${input.baseBranch}
- Lines changed: +${input.additions} −${input.deletions} across ${input.files.length} file(s)

FILES CHANGED
${filesPreview}${moreFiles}

USER'S ORIGINAL PROMPT
${userPrompt || '(none provided)'}

AGENT'S LAST REPLY (the agent's own summary of what was done)
${agentReply || '(none provided)'}

OUTPUT
Reply with ONLY this JSON object — no prose, no code fences, no preamble:

{
  "title": "<one-line PR title, imperative mood, max 70 chars, no period>",
  "body": "<markdown PR body with Summary section + Changes section>"
}

TITLE GUIDELINES
- Imperative mood: "Add", "Fix", "Refactor", "Update" — not "Added", "Fixes"
- 70 chars or fewer
- Don't include the branch name or "PR:" prefix
- Be specific about what changed

BODY GUIDELINES
- Open with a one-paragraph "## Summary" of the change and why it was made
- Follow with "## Changes" — bulleted list of the meaningful changes (group small related edits)
- Skip noise like formatting-only edits unless it's the whole point
- 200 to 500 words. Concise. No marketing fluff.`;
}

/** Pull the JSON object out of Claude's response, tolerating
 *  occasional code-fence wrapping. */
function tryParseJson(raw: string): PRSummarizeOutput | null {
  const trimmed = raw.trim();
  // Strip ```json fences if present.
  const fenced = trimmed.match(/^```(?:json)?\n([\s\S]*?)\n```$/);
  const candidate = fenced ? fenced[1] : trimmed;
  try {
    const obj = JSON.parse(candidate) as Record<string, unknown>;
    const title = typeof obj.title === 'string' ? obj.title.trim() : '';
    const body = typeof obj.body === 'string' ? obj.body.trim() : '';
    if (!title || !body) return null;
    return { title, body };
  } catch {
    return null;
  }
}

/** Auto-generated stand-in when Claude isn't reachable / returns junk. */
function buildFallback(input: PRSummarizeInput): PRSummarizeOutput {
  const branchSummary = humanizeBranchName(input.branch);
  const title = branchSummary || `Changes on ${input.branch}`;
  const fileList = input.files
    .slice(0, 30)
    .map((f) => `- \`${f}\``)
    .join('\n');
  const moreFiles =
    input.files.length > 30
      ? `\n- …and ${input.files.length - 30} more.`
      : '';
  const body = `## Summary

Changes from branch \`${input.branch}\` targeting \`${input.baseBranch}\`.

+${input.additions} / −${input.deletions} lines across ${input.files.length} file(s).

## Changes

${fileList}${moreFiles}
`;
  return { title, body };
}

/** Turn `feature/yacht-detail-fix` into "Yacht detail fix". Used for
 *  the fallback PR title. */
function humanizeBranchName(branch: string): string {
  // Drop the prefix (everything up to and including the last `/`).
  const tail = branch.slice(branch.lastIndexOf('/') + 1);
  if (!tail) return '';
  // Replace separators with spaces, then capitalize the first letter.
  const spaced = tail.replace(/[-_]+/g, ' ').trim();
  if (!spaced) return '';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
