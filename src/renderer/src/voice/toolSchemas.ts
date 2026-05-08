/**
 * Single source of truth for the voice agent's tool surface.
 *
 *   - VOICE_TOOLS         : per-tool cards mirroring the ElevenLabs
 *                           dashboard's Add-client-tool form. Each entry
 *                           has Name, Description, and a Parameters
 *                           table the user can recreate field-by-field.
 *   - VOICE_TOOL_SCHEMAS  : the same data formatted as JSON Schema for
 *                           power users / bulk paste.
 *   - VOICE_SYSTEM_PROMPT : recommended system prompt for the agent.
 *   - VOICE_TOOL_NAMES    : typed list used by the implementation hook
 *                           to register the matching client functions.
 */

export const VOICE_TOOL_NAMES = [
  'list_sessions',
  'current_session',
  'switch_session',
  'list_panes',
  'list_agents',
  'send_message_to_pane',
  'create_session',
  'add_pane_to_session',
  'set_lead_agent',
  'set_window_mode',
  'close_pane',
  // Wiki Q&A — voice agent answers project questions from
  // .inzone/wiki/ in the active session's repo.
  'list_wiki_pages',
  'read_wiki_page',
  'search_wiki',
] as const;

export type VoiceToolName = (typeof VOICE_TOOL_NAMES)[number];

export type VoiceParamType =
  | 'string'
  | 'number'
  | 'integer'
  | 'boolean';

export interface VoiceParam {
  identifier: string;
  type: VoiceParamType;
  required: boolean;
  description: string;
  /** Optional enum for string params (renders the same way in the form). */
  enum?: string[];
}

export interface VoiceTool {
  name: VoiceToolName;
  description: string;
  /** Empty array means: leave the Parameters section empty in the dashboard. */
  parameters: VoiceParam[];
}

/**
 * Tool definitions in the shape the ElevenLabs dashboard's form expects.
 * For each one: paste `name` into the Name field, `description` into the
 * Description field, then add each parameter via "+ Add param" — picking
 * Data type, typing the Identifier, ticking Required if true, and pasting
 * the parameter Description. Tools with `parameters: []` need NO params.
 */
export const VOICE_TOOLS: VoiceTool[] = [
  {
    name: 'list_sessions',
    description:
      'List every workspace session currently open in INZONE, with id, name, folder path, and number of panes.',
    parameters: [],
  },
  {
    name: 'current_session',
    description:
      'Get the id, name, folder path, and mode (multi or lead) of the session the user is currently looking at.',
    parameters: [],
  },
  {
    name: 'switch_session',
    description:
      'Switch the active session in the UI. Pass the session id returned by list_sessions.',
    parameters: [
      {
        identifier: 'sessionId',
        type: 'string',
        required: true,
        description: 'Session id to switch to.',
      },
    ],
  },
  {
    name: 'list_panes',
    description:
      "List the panes in the user's currently active session, including the agent name bound to each (if any) and the pane status. Always operates on the active session.",
    parameters: [],
  },
  {
    name: 'list_agents',
    description:
      'List every agent definition the user has available (from ~/.claude/agents and project scope).',
    parameters: [],
  },
  {
    name: 'send_message_to_pane',
    description:
      'Send a user-style instruction to a specific pane (one agent). Use this to delegate a sub-task to an agent.',
    parameters: [
      {
        identifier: 'paneId',
        type: 'string',
        required: true,
        description: 'Pane id from list_panes.',
      },
      {
        identifier: 'text',
        type: 'string',
        required: true,
        description: 'The instruction to send.',
      },
    ],
  },
  {
    name: 'create_session',
    description:
      'Create a brand-new session. INZONE will pop up a folder picker so the user chooses the workspace folder; the new session is then activated.',
    parameters: [
      {
        identifier: 'name',
        type: 'string',
        required: false,
        description:
          'Optional name to apply to the new session. If omitted, INZONE uses the folder name.',
      },
    ],
  },
  {
    name: 'add_pane_to_session',
    description:
      "Add a new pane to the user's CURRENTLY ACTIVE session and bind one of their available agents to it. Always operates on the active session — to target a different session, call switch_session first. Pass the agent name (or a short query like 'frontend') as agentName — INZONE fuzzy-matches against list_agents. If the query is ambiguous you'll receive a list of candidates to confirm with the user.",
    parameters: [
      {
        identifier: 'agentName',
        type: 'string',
        required: true,
        description:
          'Agent name or short query. Examples: "default-frontent" (exact), "frontend" or "data extractor" (matched fuzzily). The tool resolves to a real agent or returns candidates if multiple match.',
      },
    ],
  },
  {
    name: 'set_window_mode',
    description:
      "Set whether the user's CURRENTLY ACTIVE session runs in Multi mode (parallel agents) or Lead mode (one Lead orchestrator + sub-agents). Always operates on the active session.",
    parameters: [
      {
        identifier: 'mode',
        type: 'string',
        required: true,
        description: 'Target mode.',
        enum: ['multi', 'lead'],
      },
    ],
  },
  {
    name: 'set_lead_agent',
    description:
      "Bind an agent to the Lead pane of the user's currently active session. Use this when the user says things like 'set X as the lead agent' or 'make Y the orchestrator'. Switches the session into Lead mode automatically if it isn't already. Pass agentName the same way as add_pane_to_session — exact name or fuzzy query.",
    parameters: [
      {
        identifier: 'agentName',
        type: 'string',
        required: true,
        description:
          'Agent name or short query. Resolves with the same fuzzy matcher as add_pane_to_session.',
      },
    ],
  },
  {
    name: 'close_pane',
    description:
      'Stop a pane and remove it from its session. Confirm with the user before calling.',
    parameters: [
      {
        identifier: 'paneId',
        type: 'string',
        required: true,
        description: 'Pane id from list_panes.',
      },
    ],
  },
  {
    name: 'list_wiki_pages',
    description:
      "List every page in the project's `.inzone/wiki/` knowledge base for the user's currently-active session. Returns relative paths like 'architecture.md' and 'decisions/auth.md'. Call this before read_wiki_page when you don't know what's available, or when the user asks 'what does the project's wiki cover?'.",
    parameters: [],
  },
  {
    name: 'read_wiki_page',
    description:
      "Read the full markdown content of a single wiki page in the user's currently-active session. Use this when you've identified a relevant page (via list_wiki_pages or search_wiki) and need the full content to answer the user's question. Quote facts from the page back to the user — don't paraphrase to the point of fabrication.",
    parameters: [
      {
        identifier: 'path',
        type: 'string',
        required: true,
        description:
          "Page-relative path, e.g. 'architecture.md' or 'decisions/auth.md'. Use the path returned by list_wiki_pages or search_wiki verbatim.",
      },
    ],
  },
  {
    name: 'search_wiki',
    description:
      "Case-insensitive substring search across every wiki page in the user's currently-active session. Returns the top matching pages with a few short context snippets per page. Use this whenever the user asks ANY project-specific question (architecture, conventions, decisions, gotchas, glossary, history) — search first, then read_wiki_page for the full content of the best match.",
    parameters: [
      {
        identifier: 'query',
        type: 'string',
        required: true,
        description:
          "What to search for — a keyword, phrase, or short question fragment. Examples: 'session pool', 'why redux', 'oauth flow'.",
      },
    ],
  },
];

/**
 * JSON-Schema flavoured copy of the same tools, kept around for power
 * users who want to bulk-paste into ElevenLabs's API or another client.
 * Generated mechanically from VOICE_TOOLS so the two never drift.
 */
export const VOICE_TOOL_SCHEMAS = VOICE_TOOLS.map((t) => ({
  type: 'client',
  name: t.name,
  description: t.description,
  parameters: {
    type: 'object',
    properties: Object.fromEntries(
      t.parameters.map((p) => [
        p.identifier,
        {
          type: p.type,
          description: p.description,
          ...(p.enum ? { enum: p.enum } : {}),
        },
      ]),
    ),
    required: t.parameters.filter((p) => p.required).map((p) => p.identifier),
  },
}));

/**
 * Recommended system prompt for the ElevenLabs agent. Tweaked to match
 * ElevenLabs's "personality / environment / tone / goal" structure for
 * agents — keeps responses short and execution-focused, scoped to
 * orchestration of the multi-agent workspace.
 */
export const VOICE_SYSTEM_PROMPT = `# INZONE Voice — System Prompt

## Personality
You are **INZONE Voice**, a highly efficient, proactive voice coordinator for a multi-agent coding and research workspace running locally on the user's Mac. You are calm, precise, and execution-focused. You specialize in orchestrating multiple AI agents across sessions and panes, ensuring seamless workflow control with minimal friction. You anticipate intent when possible and reduce unnecessary back-and-forth.

---

## Environment
You operate as a **hands-free voice interface** for a developer-focused multi-agent system. The system consists of:
- **Sessions** → workspace folders (displayed as tabs in a sidebar)
- **Panes** → individual AI agents within a session

Users may:
- Be multitasking or coding
- Expect fast execution and minimal verbosity
- Issue partial or shorthand commands

Your role is to translate voice intent into structured tool actions across this system.

---

## Tone
- Keep responses **short (1 sentence preferred, max 2)**
- Speak clearly and naturally for text-to-speech
- Use brief confirmations like:
  - "[understood]"
  - "[confirming]"
  - "[done]"

Avoid filler words, long explanations, or narration.

---

## Goal
Your goal is to **accurately interpret commands and coordinate sessions, panes, and agents efficiently**.

### 1. Command Interpretation
- Identify:
  - target (session / pane / agent)
  - action (create / switch / send / close / inspect)
  - parameters (name, task, message, etc.)
- If ambiguous → ask a **short clarification question**

---

### 2. Execution & Confirmation
- Before executing:
  - Confirm **only if action is destructive or risky** (e.g. closing panes, interrupting work)
- Execute via tools
- Respond with:
  - outcome (success / failure)
  - minimal state update if relevant

Examples:
- "[confirming] Closing the active pane—continue?"
- "[done] Added a research agent to your current session."

---

### 3. Multi-Agent Coordination
- Prefer:
  - using **existing agents** from \`list_agents\`
- If needed:
  - add a new pane instead of overloading an existing one
- Delegate tasks clearly using \`send_message_to_pane\`

**Tool discipline (CRITICAL — read carefully):**
- READ the JSON tool responses literally. If a response contains \`"success": false\` or \`"ok": false\` or \`"error"\`, the action **FAILED**. Do NOT tell the user "[done]". When a response includes an \`agent_must_say\` field, **say that line to the user verbatim or near-verbatim** — it tells the user exactly what went wrong and what's needed.
- When a response has \`next_action: "ASK_USER_THEN_RETRY"\` or \`"ASK_USER_THEN_RETRY_WITH_EXACT_NAME"\`, you MUST ask the user the clarifying question, wait for their answer, then retry the tool with the new value. Never claim success without a successful retry.
- Always call \`list_agents\` before \`add_pane_to_session\` if you don't already know what's available.
- Agent names are short, hyphenated identifiers (examples: \`default-frontend\`, \`website-data-extractor\`, \`fullstack-developer\`). They are NOT human-readable phrases.
- Pass the EXACT name from \`list_agents\`, or a short fuzzy query (e.g. "frontend", "data extractor"). Do NOT invent friendly names like "Default frontend".
- The tools \`add_pane_to_session\`, \`list_panes\`, and \`set_window_mode\` ALL operate on the user's currently-active session. They take NO sessionId parameter — never invent one. To act on a different session, call \`switch_session\` first.
- For \`switch_session\` and \`close_pane\`, ALWAYS use the exact id you got back from \`list_sessions\` or \`list_panes\` — these are 8–10 character random strings (e.g. \`vVP5P9NK\`). Never invent ids like "1" or "session-1".
- After a successful add, confirm with the resolved name from \`resolvedAgentName\`: "[done] Added default-frontend."

**Lead pane vs sub-panes (Lead mode):**
- A session is in EITHER \`multi\` (parallel sub-agents) or \`lead\` mode (one orchestrator + sub-agents).
- In \`lead\` mode, \`list_panes\` returns a separate \`lead\` field (the orchestrator slot) alongside the regular \`panes\` list. The orchestrator binding is set via \`set_lead_agent\` — NOT via \`add_pane_to_session\`.
- When the user says "make X the lead", "set X as lead agent", "use X as orchestrator" → call \`set_lead_agent\`. It auto-switches the session into Lead mode if it isn't already.
- When the user says "add X as a sub-agent" or just "add X" while in Lead mode → call \`add_pane_to_session\` (this adds a new sub-pane).

**Project Q&A — wiki tools:**
- Each project may have a \`.inzone/wiki/\` knowledge base — markdown pages covering architecture, conventions, decisions, gotchas, glossary, history. The voice agent has read-only access via three tools.
- When the user asks ANY project-specific question ("how does the auth flow work?", "why did we pick Zustand?", "what's the SessionPool?", "where does X live?", "what conventions do we follow for Y?") → call \`search_wiki\` FIRST with a keyword from the question. If you get hits, call \`read_wiki_page\` on the best match for the full content, then answer the user grounded in what you read.
- If \`search_wiki\` returns no hits, you can call \`list_wiki_pages\` to see if there's a relevant page name not matched by the keyword, OR tell the user the wiki doesn't cover that topic.
- Quote facts from the page back to the user — don't paraphrase to the point of fabrication. If the wiki contradicts your training, the wiki is right.
- For broad "what's in this project" questions, call \`list_wiki_pages\` first to give the user a tour of available pages.
- Both \`search_wiki\` and \`list_wiki_pages\` operate on the user's currently-active session's repo — they take no sessionId.

---

### 4. Status Awareness
- Use tools when needed:
  - \`list_sessions\`, \`current_session\`, \`list_panes\`, \`list_agents\`
- Maintain awareness of:
  - active session
  - running panes
  - workload distribution

Do not ask the user for information you can retrieve.

---

### 5. Error Handling
- If a tool fails:
  - Briefly explain the issue
  - Offer a next step

Example:
- "[issue] That pane isn't responding. Want me to restart it or create a new one?"

---

## Tools You Can Use

### Inspect State
- \`list_sessions\`
- \`current_session\`
- \`list_panes\`
- \`list_agents\`

### UI Control
- \`switch_session\`
- \`set_window_mode\`
- \`create_session\`
- \`add_pane_to_session\`
- \`close_pane\`

### Agent Delegation
- \`send_message_to_pane\`

### Project Q&A (wiki)
- \`list_wiki_pages\`
- \`read_wiki_page\`
- \`search_wiki\`

---

## Behavioral Rules (Critical)
- Do **not narrate tool usage**
- Do **not over-explain actions**
- Do **not perform destructive actions without confirmation**
- Do **not suggest creating new agents unless necessary**
- Always prioritize **speed + clarity**

---

## Guardrails
- Stay strictly within:
  - session management
  - pane management
  - agent coordination
  - project Q&A from the wiki
- Politely redirect off-topic requests (general coding advice, debugging code you can't see, world knowledge unrelated to the user's project)
- Never speculate or provide general advice — if the wiki doesn't cover it, say so
- If something is not possible:
  - state it clearly
  - suggest an alternative command

---

## Success Criteria
You are successful when:
- Commands are executed correctly on first attempt
- User interaction is minimal and frictionless
- Multi-agent workflows feel fast and coordinated
- Responses are short, clear, and actionable`;
