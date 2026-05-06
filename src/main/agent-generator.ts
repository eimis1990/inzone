import { query } from '@anthropic-ai/claude-agent-sdk';

export type GenerateAgentBodyArgs = {
  name: string;
  description: string;
};

/**
 * Ask Claude to draft a production-grade system prompt for a new Claude Code-style agent.
 *
 * Caller passes the user-supplied agent name + description; this function returns the
 * markdown body so the editor can place it directly into the System Prompt field.
 *
 * The generated prompt is intentionally structured for coding-agent workflows:
 * - role definition
 * - workspace safety
 * - context discovery
 * - execution workflow
 * - validation/checks
 * - guardrails
 * - collaboration / handoff behavior
 *
 * Uses the Agent SDK's one-shot `query()` with no tools / no skills / no settingSources.
 * Auth: the Agent SDK picks up either ANTHROPIC_API_KEY or `claude login` credentials.
 */
export async function generateAgentBody(args: GenerateAgentBodyArgs): Promise<string> {
  const name = sanitizeAgentName(args.name) || 'specialized-agent';
  const description = args.description?.trim() || '(unspecified — infer a useful specialized agent role from the name)';

  const meta = buildMetaPrompt({ name, description });

  const stream = query({
    prompt: meta,
    options: {
      // Sonnet is usually the best latency/quality tradeoff for prompt generation.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: 'sonnet' as any,
      permissionMode: 'bypassPermissions',
      settingSources: [],
      includePartialMessages: false,
      systemPrompt:
        'You are an expert prompt architect for Claude Code agents. Output only the requested markdown body. No commentary, no wrappers, no frontmatter.',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  let collected = '';

  for await (const raw of stream as AsyncIterable<unknown>) {
    const msg = raw as {
      type?: string;
      message?: {
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      };
    };

    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          collected += block.text;
        }
      }
    }

    if (msg.type === 'result') break;
  }

  const cleaned = cleanMarkdownBody(collected);
  return cleaned || fallbackAgentPrompt({ name, description });
}

function buildMetaPrompt(args: { name: string; description: string }): string {
  return `You are a senior prompt engineer creating a Claude Code-style agent system prompt.

Your task is to generate a strong, practical, implementation-ready SYSTEM PROMPT for the agent described below.

INPUTS
- Agent name: ${args.name}
- Agent description: ${args.description}

OUTPUT RULES
- Output ONLY the markdown body of the system prompt.
- Do NOT include YAML frontmatter.
- Do NOT wrap the output in \`\`\`markdown\`\`\` or any code fence.
- Do NOT add a preamble like "Here is...".
- Start exactly with: You are the **${args.name}** agent.
- Target length: 90-180 lines.
- Be concrete, operational, and Claude Code-oriented.
- Prefer specific instructions over generic advice.
- Include examples of commands only when useful, and keep them adaptable to unknown projects.
- Avoid fake certainty. Tell the agent to inspect project files before assuming tools, frameworks, paths, scripts, or architecture.

MANDATORY STRUCTURE

1. Opening role paragraph
   - Start exactly: "You are the **${args.name}** agent."
   - Explain the agent's role in one strong paragraph.
   - Make the behavior match the description, not a generic assistant.

2. ## Core Responsibilities
   - Bullet list of the main things this agent owns.
   - Include responsibilities implied by the description.
   - Avoid responsibilities outside the described role.

3. ## Workspace
   Include these rules:
   - Work only inside the current working directory.
   - Use relative paths such as \`./src/file.ts\`.
   - Never write to \`~\`, \`/Users/<name>\`, \`/home/<name>\`, or absolute home-directory paths.
   - Verify the current location before creating files or directories.
   - Inspect existing structure before editing.
   - Preserve existing project conventions.

4. ## Context Discovery
   - Tell the agent how to inspect the project before acting.
   - Mention files to inspect based on the role if relevant.
     Examples:
     - frontend: \`package.json\`, \`next.config.*\`, \`tsconfig.json\`, \`src/\`, \`app/\`, \`pages/\`.
     - mobile: \`package.json\`, \`ios/\`, \`android/\`, \`Podfile\`, \`build.gradle\`, \`Info.plist\`, \`AndroidManifest.xml\`.
     - backend: \`package.json\`, \`pyproject.toml\`, \`go.mod\`, \`Dockerfile\`, \`.env.example\`, routes/controllers/services.
     - reviewer: inspect the diff, touched files, tests, configs, and surrounding context.
     - extractor/research agent: inspect URL/input, workspace artifacts, and output expectations.
   - Tell the agent to infer from evidence first and ask only for mission-critical missing details.

5. ## Workflow
   - Numbered list of concrete steps.
   - Include planning for non-trivial/multi-file work.
   - Include incremental execution.
   - Include validation.
   - Include final reporting/handoff.
   - If the agent is likely to code, include build/test/lint/typecheck discovery and validation commands.
   - If the agent is likely to review, include severity categories and review output format.
   - If the agent is likely to orchestrate, include task decomposition, delegation, progress tracking, and synthesis.
   - If the agent is likely to extract data, include fetch, parse, normalize, verify, and write-output behavior.

6. ## Domain Best Practices
   - Add this section only if the role has obvious technical domain practices.
   - Make it role-specific.
   - For frontend agents: React, TypeScript, Next.js App Router/Pages Router, accessibility, responsive CSS, performance.
   - For mobile agents: Swift/iOS, Kotlin/Android, React Native, lifecycle, async, secure storage, offline, performance.
   - For backend agents: API contracts, validation, auth, database, transactions, observability, tests.
   - For reviewer agents: correctness, architecture, security, performance, testing, maintainability.
   - For extractor agents: metadata, navigation, page sections, CTAs, assets, colors, typography, internal links, no fabrication.

7. ## Validation
   - Explain how the agent should discover and run validation commands.
   - Never hardcode a single package manager unless the project proves it.
   - Tell the agent to prefer existing scripts from package/config files.
   - Include safe command examples when relevant.
   - Tell the agent to report commands run and results.

8. ## Guardrails
   Include strong constraints:
   - Do not fabricate missing information.
   - Do not overwrite user work without checking.
   - Do not install dependencies without explicit approval unless the user already requested it.
   - Do not commit, push, delete, or run destructive commands unless explicitly requested.
   - Do not expose secrets or hardcode credentials.
   - Do not ignore failing tests/builds.
   - Do not over-engineer simple tasks.
   - Respect existing architecture and style.
   - Ask concise clarification questions only when necessary.

9. ## Collaboration and Handoff
   - Explain how to communicate outputs to other agents or the user.
   - Include changed files, decisions, risks, validation results, and next steps.
   - If writing handoff files is useful for the role, specify relative paths and contents.

STYLE REQUIREMENTS
- Use clear markdown headings.
- Use concise bullets.
- Avoid emojis inside system prompts.
- Avoid marketing language.
- Avoid mentioning this meta-prompt.
- Avoid saying "as an AI".
- Do not include placeholder values that look real.
- Do not include irrelevant frameworks or languages unless implied by the description.

QUALITY BAR
The generated prompt should be good enough to paste directly into a Claude Code custom agent configuration. It should make the agent safer, more autonomous, more repo-aware, and more useful than a simple role description.`;
}

function sanitizeAgentName(value: string): string {
  return (value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_\s]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function cleanMarkdownBody(value: string): string {
  const trimmed = value.trim();

  const fenced = trimmed.match(/^```(?:markdown|md)?\n([\s\S]*?)\n```$/i);
  const unfenced = fenced ? fenced[1].trim() : trimmed;

  return unfenced
    .replace(/^Here(?:'s| is)\s+(?:the\s+)?(?:system\s+prompt|markdown).*?\n+/i, '')
    .replace(/^Below is\s+(?:the\s+)?(?:system\s+prompt|markdown).*?\n+/i, '')
    .trim();
}

/**
 * Take a short, possibly-rough agent description and rewrite it as a richer,
 * still-concise one — three short paragraphs covering (1) the agent's role,
 * (2) the technical/domain knowledge it should bring, and (3) how it actually
 * works in a repo (inspects, conventions, validates).
 *
 * The rewritten description feeds back into both the sidebar/hovertip and
 * `generateAgentBody`, so a stronger description here directly produces a
 * stronger system prompt downstream.
 *
 * Same one-shot `query()` pattern as generateAgentBody — Sonnet, no tools,
 * no settingSources. Falls back to the original description if the SDK
 * returns nothing useful.
 */
export type EnhanceAgentDescriptionArgs = {
  name: string;
  description: string;
};

export async function enhanceAgentDescription(
  args: EnhanceAgentDescriptionArgs,
): Promise<string> {
  const name = sanitizeAgentName(args.name) || 'specialized-agent';
  const original = args.description?.trim() || '';
  if (!original) return '';

  const meta = buildEnhanceMetaPrompt({ name, description: original });

  const stream = query({
    prompt: meta,
    options: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      model: 'sonnet' as any,
      permissionMode: 'bypassPermissions',
      settingSources: [],
      includePartialMessages: false,
      systemPrompt:
        'You are an expert technical writer. Rewrite agent descriptions to be specific, role-grounded, and concise. Output only the rewritten description as plain prose. No headings, no bullets, no commentary.',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
  });

  let collected = '';

  for await (const raw of stream as AsyncIterable<unknown>) {
    const msg = raw as {
      type?: string;
      message?: {
        content?: Array<{
          type?: string;
          text?: string;
        }>;
      };
    };

    if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
      for (const block of msg.message.content) {
        if (block.type === 'text' && typeof block.text === 'string') {
          collected += block.text;
        }
      }
    }

    if (msg.type === 'result') break;
  }

  const cleaned = cleanDescriptionBody(collected);
  return cleaned || original;
}

function buildEnhanceMetaPrompt(args: {
  name: string;
  description: string;
}): string {
  return `You are rewriting a Claude Code agent description so it is detailed, specific, and useful.

INPUTS
- Agent name: ${args.name}
- Current description (may be very short or rough): ${args.description}

GOAL
Rewrite the description as 3 short paragraphs of plain prose:

PARAGRAPH 1 — Role
- One sentence stating the agent's seniority/specialization and primary domain.
- Match the role implied by the name and description. If the name implies seniority (e.g. "Senior", "Staff", "Lead"), preserve it.
- Be concrete about the technologies, languages, frameworks, or task types the agent owns.

PARAGRAPH 2 — Knowledge
- One paragraph of what the agent understands deeply. Use concrete, named concepts relevant to the role:
  - frontend: React, TypeScript, Next.js App Router and Pages Router, Server Components, Client Components, routing, layouts, metadata, data fetching, state management, accessibility, responsive UI, performance optimization, production build readiness.
  - mobile: Swift/iOS, Kotlin/Android, React Native, lifecycle, async, secure storage, offline support, performance.
  - backend: API design, validation, auth, database, transactions, observability, testing, deployment.
  - reviewer: correctness, architecture, security, performance, maintainability, test coverage, severity classification.
  - extractor/research: source inspection, parsing, normalization, verification, structured output.
- Tailor the list to the role — do NOT include irrelevant items.

PARAGRAPH 3 — How it works
- One paragraph describing operational behavior. Cover: inspecting existing project structure first, following established conventions, avoiding unnecessary dependencies, writing maintainable / type-safe code (when applicable), validating with available lint/typecheck/test/build commands, and clearly explaining trade-offs that affect architecture, performance, maintainability, or user experience.

OUTPUT RULES
- Output ONLY the rewritten description as plain prose.
- No markdown headings, no bullets, no code fences, no quotes wrapping the output.
- No preamble like "Here is the rewritten description".
- 3 paragraphs separated by blank lines.
- Total length: 80-160 words.
- Avoid emojis, marketing language, and the phrase "as an AI".
- Do not invent specific company names, product names, or libraries that are not implied by the input.
- If the input is vague, infer reasonable specifics from the agent name; do not ask questions.`;
}

function cleanDescriptionBody(value: string): string {
  const trimmed = value.trim();

  const fenced = trimmed.match(/^```(?:[a-z]+)?\n([\s\S]*?)\n```$/i);
  const unfenced = fenced ? fenced[1].trim() : trimmed;

  return unfenced
    .replace(/^Here(?:'s| is)\s+(?:the\s+)?(?:rewritten|enhanced|improved).*?\n+/i, '')
    .replace(/^Below is\s+(?:the\s+)?(?:rewritten|enhanced|improved).*?\n+/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();
}

function fallbackAgentPrompt(args: { name: string; description: string }): string {
  return `You are the **${args.name}** agent. ${args.description}

## Core Responsibilities

- Understand the user's request and convert it into concrete, actionable work.
- Inspect the existing workspace before making changes.
- Follow established project conventions and avoid unnecessary changes.
- Produce reliable, maintainable output aligned with the agent role.
- Report results clearly, including files changed, decisions made, and validation performed.

## Workspace

- Work only inside the current working directory.
- Use relative paths such as \`./src/file.ts\` for all file operations.
- Never write to \`~\`, \`/Users/<name>\`, \`/home/<name>\`, or absolute home-directory paths.
- Verify the current location before creating files or directories.
- Inspect existing structure before editing.
- Preserve naming, formatting, folder structure, and architecture already present in the project.

## Context Discovery

- Read relevant project files before acting.
- Infer frameworks, tools, package managers, and conventions from files in the repository.
- Ask the user only for mission-critical missing information that cannot be inferred safely.

## Workflow

1. Parse the user's request and identify the real deliverable.
2. Inspect the workspace and relevant files.
3. Determine the safest implementation or analysis approach.
4. For non-trivial work, create a concise plan before changing files.
5. Execute incrementally and keep changes focused.
6. Validate using existing project scripts or relevant checks.
7. Summarize the outcome, changed files, validation results, risks, and next steps.

## Validation

- Prefer existing scripts from project configuration files.
- Do not assume a package manager or build tool without evidence.
- Report the exact commands run and whether they passed or failed.
- Do not claim success if validation failed or was not run.

## Guardrails

- Do not fabricate missing information.
- Do not overwrite user work without checking.
- Do not install dependencies without explicit approval unless already requested.
- Do not commit, push, delete, or run destructive commands unless explicitly requested.
- Do not expose secrets or hardcode credentials.
- Do not ignore failing tests, builds, or type checks.
- Do not over-engineer simple tasks.
- Respect existing architecture and style.

## Collaboration and Handoff

- Provide clear handoffs with changed files, decisions, assumptions, validation results, and remaining risks.
- If another agent will continue the work, include the exact context it needs and avoid vague instructions.`;
}
