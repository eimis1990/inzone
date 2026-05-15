/**
 * Built-in starter slash commands for the composer's "/" picker.
 *
 * These are the floor of the picker — even a user with no
 * `.claude/commands/*.md` files anywhere gets a useful list out of
 * the box. Each builtin is a prompt template the agent reads as the
 * user message; we don't intercept them at the SDK level. The
 * `$ARGUMENTS` placeholder is replaced with whatever the user
 * typed in the composer after picking the command.
 *
 * Project / user-level commands found on disk SHADOW builtins of the
 * same name, so a user can override `/plan` by creating
 * `~/.claude/commands/plan.md`.
 *
 * Keep this list intentionally short. The point is to give the
 * picker something to show on a fresh install; deeper command
 * libraries belong on disk.
 */

import type { ProjectCommand } from './types';

export const BUILTIN_COMMANDS: ProjectCommand[] = [
  {
    name: 'plan',
    description: 'Think through the change, then propose a step-by-step plan before touching code',
    body: [
      'Before writing any code, work through the request below and produce a numbered plan:',
      '  1. Restate the goal in your own words.',
      '  2. List the files you expect to touch and why.',
      '  3. Call out edge cases and what could go wrong.',
      '  4. Identify the order of operations.',
      'Wait for confirmation before making changes.',
      '',
      'Request:',
      '$ARGUMENTS',
    ].join('\n'),
    source: 'builtin',
  },
  {
    name: 'think',
    description: 'Reason carefully and show your working before answering',
    body: [
      'Think hard about the question below. Walk through the relevant context,',
      "consider trade-offs, and only then give your answer. Don't skip to the",
      "conclusion — the reasoning is the value.",
      '',
      'Question:',
      '$ARGUMENTS',
    ].join('\n'),
    source: 'builtin',
  },
  {
    name: 'review',
    description: 'Code review of the work you just did — flag bugs, style, edge cases',
    body: [
      'Review the work you just completed (or the work described below) as if a',
      'careful senior engineer is auditing it before merge. Cover:',
      '  - Correctness: bugs, off-by-ones, missing error paths, race conditions.',
      '  - Edge cases not handled.',
      '  - Style + readability gaps.',
      '  - Anything that would make this hard to maintain in six months.',
      'Be specific — point to file:line where you can.',
      '',
      'Context for the review:',
      '$ARGUMENTS',
    ].join('\n'),
    source: 'builtin',
  },
  {
    name: 'explain',
    description: 'Explain how something works in plain language',
    body: [
      'Explain the following in plain language, as if to a teammate who is',
      'new to this codebase. Use concrete examples. Skip jargon unless you',
      'define it. If there are pitfalls or surprising behaviour, call them out.',
      '',
      'Topic:',
      '$ARGUMENTS',
    ].join('\n'),
    source: 'builtin',
  },
  {
    name: 'test',
    description: 'Write tests for the described feature or function',
    body: [
      'Write tests for the target described below. Cover:',
      '  - The happy path.',
      '  - At least two meaningful edge cases.',
      '  - Failure paths where the input is invalid.',
      'Use the testing framework already in this repo (look at existing tests',
      'if you need a hint). Keep test names descriptive.',
      '',
      'Target:',
      '$ARGUMENTS',
    ].join('\n'),
    source: 'builtin',
  },
];

/**
 * Merge command lists in priority order, deduping by name.
 *
 * Order: project files > user files > builtins. A project-local
 * `plan.md` shadows a user-global `plan.md`, which shadows the
 * built-in `/plan`. The renderer calls this AFTER the main process
 * enumerates files on disk; main returns project + user lists
 * separately so we can preserve the priority here even if disk
 * enumeration ordering ever changes.
 */
export function mergeCommands(
  project: ProjectCommand[],
  user: ProjectCommand[],
): ProjectCommand[] {
  const seen = new Set<string>();
  const out: ProjectCommand[] = [];
  for (const list of [project, user, BUILTIN_COMMANDS]) {
    for (const cmd of list) {
      if (seen.has(cmd.name)) continue;
      seen.add(cmd.name);
      out.push(cmd);
    }
  }
  return out;
}

/**
 * Expand a command's body with the user's arguments.
 *
 * If the body has a literal `$ARGUMENTS` placeholder, we substitute
 * it. Otherwise we append the user's text on a new line after the
 * body — that way commands written as "do X" still get the user's
 * extra context tacked on. An empty `args` string leaves the body
 * (or removes the placeholder) untouched.
 */
export function expandCommand(cmd: ProjectCommand, args: string): string {
  const trimmed = args.trim();
  if (cmd.body.includes('$ARGUMENTS')) {
    return cmd.body.replace(/\$ARGUMENTS/g, trimmed);
  }
  if (!trimmed) return cmd.body;
  return cmd.body + '\n\n' + trimmed;
}
