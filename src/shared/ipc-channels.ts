// Canonical list of IPC channel names, shared between main and preload.

export const IPC = {
  // Agents / skills
  AGENTS_LIST: 'agents:list',
  AGENTS_WATCH: 'agents:watch',
  AGENTS_SAVE: 'agents:save',
  AGENTS_DELETE: 'agents:delete',
  AGENTS_GENERATE: 'agents:generate',
  SKILLS_LIST: 'skills:list',
  SKILLS_SAVE: 'skills:save',
  SKILLS_DELETE: 'skills:delete',

  // Sessions
  SESSION_START: 'session:start',
  SESSION_SEND: 'session:send',
  SESSION_INTERRUPT: 'session:interrupt',
  SESSION_STOP: 'session:stop',
  SESSION_EVENT: 'session:event', // main -> renderer push

  // Lead-orchestrator events (main -> renderer)
  PANE_SPAWN: 'pane:spawn',
  PANE_STOP_REMOTE: 'pane:stopRemote',

  // AskUserQuestion in-process MCP tool — bidirectional.
  // SHOW is main → renderer ("render this question form for paneId X").
  // ANSWER is renderer → main, resolving the agent's pending tool call.
  ASK_USER_QUESTION_SHOW: 'askUserQuestion:show',
  ASK_USER_QUESTION_ANSWER: 'askUserQuestion:answer',

  // Usage / cost telemetry
  USAGE_SUMMARY: 'usage:summary',
  USAGE_EVENT: 'usage:event', // main -> renderer push when a new turn is recorded

  // CLAUDE.md project-memory files
  MEMORY_READ: 'memory:read',
  MEMORY_WRITE: 'memory:write',
  MEMORY_ENSURE: 'memory:ensure',

  // MCP server configs (~/.claude.json + <cwd>/.mcp.json)
  MCP_LIST: 'mcp:list',
  MCP_SAVE: 'mcp:save',
  MCP_DELETE: 'mcp:delete',
  MCP_PROBE: 'mcp:probe',
  MCP_AUTH_START: 'mcp:auth:start',
  MCP_AUTH_DISCONNECT: 'mcp:auth:disconnect',
  MCP_AUTH_LIST: 'mcp:auth:list',

  // Voice agent (ElevenLabs Conversational AI)
  VOICE_GET: 'voice:get',
  VOICE_SAVE: 'voice:save',
  VOICE_GET_START_CREDS: 'voice:getStartCreds',

  // Terminal (PTY) — bottom-bar shell
  TERM_SPAWN: 'term:spawn',
  TERM_INPUT: 'term:input',
  TERM_RESIZE: 'term:resize',
  TERM_KILL: 'term:kill',
  TERM_OUTPUT: 'term:output', // main -> renderer push
  TERM_EXIT: 'term:exit',     // main -> renderer push

  // Terminal shortcut buttons (Settings → Terminal)
  TERM_SHORTCUTS_LIST: 'term:shortcuts:list',
  TERM_SHORTCUTS_SAVE: 'term:shortcuts:save',
  TERM_SHORTCUTS_DELETE: 'term:shortcuts:delete',
  TERM_SHORTCUTS_REORDER: 'term:shortcuts:reorder',
  TERM_SHORTCUTS_CHANGED: 'term:shortcuts:changed', // main -> renderer push

  // Workspace / folders
  WORKSPACE_PICK_FOLDER: 'workspace:pickFolder',

  // OS helpers — listing / killing localhost listeners (Preview picker)
  SYSTEM_PORT_LISTENERS: 'system:portListeners',
  SYSTEM_KILL_PORT: 'system:killPort',
  SYSTEM_OPEN_PATH: 'system:openPath',
  SYSTEM_GIT_BRANCH: 'system:gitBranch',
  SYSTEM_GIT_BRANCHES: 'system:gitBranches',
  SYSTEM_GIT_INIT: 'system:gitInit',
  SYSTEM_WORKTREE_CREATE: 'system:worktreeCreate',
  SYSTEM_WORKTREE_REMOVE: 'system:worktreeRemove',
  SYSTEM_WORKTREE_STATUS: 'system:worktreeStatus',
  // Quick `command -v` probe for CLI install detection (Workers tab).
  SYSTEM_CHECK_COMMANDS: 'system:checkCommands',

  // Diff Review + PR workflow
  REVIEW_LOAD_DIFF: 'review:loadDiff',
  REVIEW_APPLY_DECISIONS: 'review:applyDecisions',
  REVIEW_GH_STATUS: 'review:ghStatus',
  REVIEW_GH_ACCOUNTS: 'review:ghAccounts',
  REVIEW_GH_SWITCH: 'review:ghSwitch',
  REVIEW_REMOTE_TO_HTTPS: 'review:remoteToHttps',
  REVIEW_SET_REMOTE_URL: 'review:setRemoteUrl',
  REVIEW_COMMIT: 'review:commit',
  REVIEW_PUSH: 'review:push',
  REVIEW_ENSURE_REMOTE_BRANCH: 'review:ensureRemoteBranch',
  REVIEW_PULL: 'review:pull',

  // Profile (Settings → Profile)
  PROFILE_CLAUDE_AUTH: 'profile:claudeAuth',
  // In-app stored API key (encrypted via safeStorage).
  PROFILE_API_KEY_STATUS: 'profile:apiKey:status',
  PROFILE_API_KEY_SAVE: 'profile:apiKey:save',
  PROFILE_API_KEY_CLEAR: 'profile:apiKey:clear',
  PROFILE_API_KEY_TEST: 'profile:apiKey:test',
  REVIEW_CREATE_PR: 'review:createPR',
  REVIEW_SUMMARIZE_PR: 'review:summarizePR',
  REVIEW_LOCAL_MERGE: 'review:localMerge',

  // Persistence
  STATE_GET: 'state:get',
  STATE_SAVE_WINDOW: 'state:saveWindow',
  STATE_DELETE_WINDOW: 'state:deleteWindow',
  STATE_SET_ACTIVE_SESSION: 'state:setActiveSession',
  // Workspaces (containers of projects)
  STATE_SAVE_WORKSPACE: 'state:saveWorkspace',
  STATE_DELETE_WORKSPACE: 'state:deleteWorkspace',
  STATE_SET_ACTIVE_WORKSPACE: 'state:setActiveWorkspace',
  TRANSCRIPT_LOAD: 'transcript:load',
  TRANSCRIPT_DELETE: 'transcript:delete',

  // Window mgmt
  WINDOW_NEW: 'window:new',
  WINDOW_CLOSE: 'window:close',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
