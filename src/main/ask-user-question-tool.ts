/**
 * AskUserQuestion — in-process MCP tool that lets agents present a
 * structured multiple-choice question to the user and wait for the
 * answer.
 *
 * Why this exists: agents often try to call a tool literally named
 * `AskUserQuestion` (Cowork mode's parent system has one, and the
 * pattern leaks into model behaviour even when the tool isn't
 * available). Without this server registered, the SDK errors out on
 * every such call and the raw JSON leaks into the pane.
 *
 * Flow:
 *   1. Agent calls `mcp__AskUserQuestion__ask` with a `questions`
 *      payload (one or more questions, each with options).
 *   2. The tool handler generates a `requestId`, pushes a SHOW event
 *      to the renderer carrying `{ paneId, requestId, payload }`,
 *      then awaits a Promise registered under `requestId`.
 *   3. The renderer renders a step-by-step form card. On submit it
 *      fires an ANSWER IPC with `{ requestId, answers }`.
 *   4. `resolveAnswer` finds the pending Promise, resolves it, and
 *      the tool returns the answer text — the SDK delivers it to the
 *      agent as a normal tool_result and the conversation continues.
 *
 * The pending map is global because a single window may have many
 * panes, each with its own session, all potentially asking
 * questions concurrently. Keying by requestId is sufficient — every
 * id is a fresh nanoid.
 */

import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk';
import { BrowserWindow } from 'electron';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { IPC } from '@shared/ipc-channels';
import type { PaneId } from '@shared/types';

/**
 * Each pending Promise has a resolver; we close over it when the
 * answer arrives. The cancel hook lets pane shutdown / session reset
 * settle the Promise so we don't deadlock the SDK.
 */
interface Pending {
  resolve: (text: string) => void;
}

const pending = new Map<string, Pending>();

export interface AskUserQuestionPayload {
  questions: Array<{
    question: string;
    header?: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect?: boolean;
  }>;
}

export interface AskUserQuestionAnswer {
  /**
   * Per-question chosen labels. Single-select questions report a
   * length-1 array; multi-select can be any length (incl. zero if
   * the user explicitly skipped).
   */
  answers: Array<{ question: string; chosen: string[] }>;
}

/**
 * Build the MCP server. We pass `paneId` + `windowId` in so the SHOW
 * event reaches the right window; sessions.ts wires one server per
 * pane just like it does for the Lead orchestrator.
 */
export function createAskUserQuestionServer(args: {
  paneId: PaneId;
  windowId: number;
}) {
  const { paneId, windowId } = args;

  function mainWindow(): BrowserWindow | null {
    const w = BrowserWindow.fromId(windowId);
    return w && !w.isDestroyed() ? w : null;
  }

  return createSdkMcpServer({
    name: 'AskUserQuestion',
    version: '1.0.0',
    tools: [
      tool(
        'ask',
        // Match the schema agents expect from the Cowork-mode tool of
        // the same name. The renderer's form is the single source of
        // truth for rendering — main just relays.
        'Ask the user a structured multiple-choice question and wait for their answer. Use for clarifying decisions where free-form text would be ambiguous.',
        {
          questions: z
            .array(
              z.object({
                question: z.string(),
                header: z.string().optional(),
                options: z
                  .array(
                    z.object({
                      label: z.string(),
                      description: z.string().optional(),
                    }),
                  )
                  .min(1),
                multiSelect: z.boolean().optional(),
              }),
            )
            .min(1),
        },
        async (input): Promise<{ content: Array<{ type: 'text'; text: string }> }> => {
          const requestId = nanoid(12);
          const win = mainWindow();
          if (!win) {
            return {
              content: [
                {
                  type: 'text',
                  text: 'Could not show the question — the pane window is gone.',
                },
              ],
            };
          }
          // Set up the pending Promise BEFORE sending SHOW so a
          // (theoretically very fast) renderer answer can't race
          // ahead of the registry insert.
          const answer = await new Promise<string>((resolve) => {
            pending.set(requestId, { resolve });
            win.webContents.send(IPC.ASK_USER_QUESTION_SHOW, {
              paneId,
              requestId,
              payload: input as AskUserQuestionPayload,
            });
          });
          return {
            content: [{ type: 'text', text: answer }],
          };
        },
      ),
    ],
  });
}

/**
 * Called by the IPC ANSWER handler when the user submits the form.
 * Resolves the matching pending Promise with a human-readable string
 * the agent can react to. We format multi-select answers comma-
 * separated and prefix each question so the agent sees clearly what
 * was answered.
 */
export function resolveAnswer(
  requestId: string,
  answer: AskUserQuestionAnswer,
): boolean {
  const entry = pending.get(requestId);
  if (!entry) return false;
  pending.delete(requestId);
  entry.resolve(formatAnswerText(answer));
  return true;
}

/**
 * Drop any pending Promise for `requestId` with a sentinel "cancelled"
 * answer. Used when a pane closes or its session resets while a
 * question is mid-flight — leaving the Promise unresolved would hang
 * the SDK turn forever.
 */
export function cancelPending(requestId: string): void {
  const entry = pending.get(requestId);
  if (!entry) return;
  pending.delete(requestId);
  entry.resolve('(user dismissed the question)');
}

/** Drop every pending Promise — called on app shutdown for safety. */
export function cancelAllPending(): void {
  for (const id of [...pending.keys()]) cancelPending(id);
}

function formatAnswerText(answer: AskUserQuestionAnswer): string {
  if (answer.answers.length === 0) return '(no answers given)';
  return answer.answers
    .map((a) => {
      const chosen =
        a.chosen.length === 0
          ? '(skipped)'
          : a.chosen.map((c) => `"${c}"`).join(', ');
      return `Q: ${a.question}\nA: ${chosen}`;
    })
    .join('\n\n');
}
