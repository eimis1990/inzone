import { query } from '@anthropic-ai/claude-agent-sdk';

/**
 * Ask Claude to draft a high-quality system prompt for a new agent.
 * Caller passes the user-supplied name + description; we return the
 * markdown body so the editor can drop it into the System Prompt field.
 *
 * Uses the Agent SDK's one-shot `query()` with no tools / no skills /
 * no settingSources — pure text generation from a prompt-engineering
 * meta-prompt.
 *
 * Auth: the Agent SDK picks up either ANTHROPIC_API_KEY or `claude login`
 * subscription credentials automatically. INzone doesn't intervene.
 */
export async function generateAgentBody(args: {
  name: string;
  description: string;
}): Promise<string> {
  const meta = `You are a prompt engineer. Write a high-quality system prompt for a Claude Code-style agent based on the inputs below.

INPUTS
- Name: ${args.name || '(unspecified — invent something sensible)'}
- Description: ${args.description || '(unspecified — invent the role)'}

REQUIREMENTS
- Output only the markdown body. No frontmatter, no \`\`\` fences, no preamble like "Here is...".
- Open with: "You are the **${args.name || 'agent'}** agent." Then a one-paragraph statement of the role.
- Include a "## Workspace" section explaining the agent should write/read files inside the current working directory using relative paths and never to ~ or absolute home-dir paths.
- Include a "## Workflow" section as a numbered list of concrete steps the agent should follow.
- Include a "## Guardrails" section as a bulleted list of constraints (what not to do, edge cases, error handling).
- Be specific, action-oriented, and use code-fenced bash snippets where the agent should run commands.
- 50-130 lines total. Concise — no fluff.`;

  const stream = query({
    prompt: meta,
    options: {
      // Sonnet is the right tradeoff for this — fast, follows instructions tightly.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: 'sonnet' as any,
      permissionMode: 'bypassPermissions',
      settingSources: [],
      includePartialMessages: false,
      systemPrompt: 'You are a careful prompt engineer. Output only what the user requests, nothing else.',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  let collected = '';
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

  // Strip stray code fence wrappers if Claude ignored the no-fences rule.
  const trimmed = collected.trim();
  const fenced = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/);
  return fenced ? fenced[1].trim() : trimmed;
}
