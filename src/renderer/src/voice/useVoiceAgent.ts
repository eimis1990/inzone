/**
 * Tap-to-toggle voice agent hook.
 *
 * Wraps `@elevenlabs/react`'s `useConversation` and exposes:
 *   - status      : 'idle' | 'connecting' | 'listening' | 'speaking' | 'error'
 *   - lastMessage : the most recent transcript line (user or agent)
 *   - error       : if anything blew up (missing creds, mic denied, etc.)
 *   - toggle()    : start a session if idle, end it otherwise
 *
 * The bulk of the file is the client-tools dispatch table — each entry
 * implements one tool from `VOICE_TOOL_SCHEMAS` by reaching into the
 * Zustand store or IPC bridge to actually drive the app.
 */

import { useCallback, useMemo, useRef, useState } from 'react';
import { useConversation } from '@elevenlabs/react';
import type { ClientTools } from '@elevenlabs/react';
import { useStore } from '../store';

/**
 * Snapshot of a tool call for the visible debug log. Helps the user
 * see whether the voice agent actually invoked a tool or just
 * hallucinated success.
 */
export interface VoiceToolCall {
  id: string;
  ts: number;
  name: string;
  params: Record<string, unknown>;
  result?: string;
  error?: string;
  status: 'pending' | 'ok' | 'error';
}

export type VoiceStatus =
  | 'idle'
  | 'connecting'
  | 'listening'
  | 'speaking'
  | 'error';

export interface VoiceAgentValue {
  status: VoiceStatus;
  isConfigured: boolean;
  error: string | undefined;
  lastMessage: string | undefined;
  toolCalls: VoiceToolCall[];
  toggle: () => Promise<void>;
}

export function useVoiceAgent(): VoiceAgentValue {
  const [error, setError] = useState<string | undefined>();
  const [isConfigured, setIsConfigured] = useState(false);
  const [lastMessage, setLastMessage] = useState<string | undefined>();
  const [toolCalls, setToolCalls] = useState<VoiceToolCall[]>([]);

  // The clientTools object reference must stay stable across renders
  // (the SDK re-registers if it changes) but we also need it to call
  // back into setToolCalls. A ref lets the closure read the live
  // setter without retriggering the memo.
  const setToolCallsRef = useRef(setToolCalls);
  setToolCallsRef.current = setToolCalls;

  const clientTools = useMemo<ClientTools>(
    () => buildClientTools(setToolCallsRef),
    [],
  );

  const conversation = useConversation({
    clientTools,
    onConnect: () => {
      setError(undefined);
    },
    onDisconnect: () => {
      // Nothing — status will fall back to disconnected automatically.
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      setError(msg);
    },
    onMessage: (msg: { source?: string; message?: string }) => {
      if (typeof msg.message === 'string' && msg.message.trim().length > 0) {
        setLastMessage(msg.message);
      }
    },
  });

  // Map ElevenLabs's two-axis status (connecting/connected/disconnected
  // × speaking/listening) onto the simpler 5-value enum we surface in
  // the UI. `error` overrides everything when set.
  const status: VoiceStatus = error
    ? 'error'
    : conversation.status === 'connecting'
      ? 'connecting'
      : conversation.status === 'connected'
        ? conversation.isSpeaking
          ? 'speaking'
          : 'listening'
        : 'idle';

  const toggle = useCallback(async () => {
    setError(undefined);
    if (status === 'connecting') return;
    if (status === 'idle' || status === 'error') {
      const creds = await window.cowork.voice.getStartCreds();
      if (!creds.ok) {
        setIsConfigured(false);
        setError(creds.error);
        return;
      }
      setIsConfigured(true);
      try {
        // Mic permission must be granted before startSession — Electron's
        // renderer treats it like a regular browser context.
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        setError(
          'Microphone permission denied. Allow Mic access in System Settings → Privacy & Security → Microphone, then try again.',
        );
        return;
      }
      try {
        if ('signedUrl' in creds) {
          conversation.startSession({ signedUrl: creds.signedUrl });
        } else {
          conversation.startSession({ agentId: creds.agentId });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    } else {
      try {
        conversation.endSession();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [conversation, status]);

  // Prime `isConfigured` once on mount so the UI knows whether to show
  // a helpful "configure first" hint vs. a working mic button.
  useMemo(() => {
    void window.cowork.voice
      .get()
      .then((s) => setIsConfigured(!!s.agentId?.trim()))
      .catch(() => setIsConfigured(false));
  }, []);

  return {
    status,
    isConfigured,
    error,
    lastMessage,
    toolCalls,
    toggle,
  };
}

// ─── Client tool implementations ─────────────────────────────────────────

/**
 * Build the {name → handler} table that gets handed to the SDK. Each
 * handler reads/writes the Zustand store (via getState/setState-style
 * actions) and returns a JSON-serializable result back to ElevenLabs.
 *
 * Returning a string is the simplest contract; we always return an
 * object stringified so the agent has structured data to reason over.
 *
 * Every tool is wrapped in `traced()` so each invocation appears in the
 * VoiceSection log + browser console — this is what surfaces whether
 * the LLM actually called a tool vs. just hallucinated success.
 */
function buildClientTools(
  setToolCallsRef: { current: React.Dispatch<React.SetStateAction<VoiceToolCall[]>> },
): ClientTools {
  const trace = makeTracer(setToolCallsRef);
  const raw: ClientTools = {
    list_sessions: async () => {
      const { sessions, panes } = useStore.getState();
      const out = sessions.map((s) => ({
        id: s.id,
        name: s.name?.trim() || sessionDefaultName(s.cwd),
        cwd: s.cwd,
        mode: s.windowMode ?? 'multi',
        paneCount: countLeaves(s.tree),
        panes: collectPaneSummaries(s, panes),
      }));
      return JSON.stringify({ sessions: out });
    },

    current_session: async () => {
      const s = useStore.getState();
      const session = s.sessions.find((x) => x.id === s.windowId);
      if (!session) {
        return JSON.stringify({ session: null });
      }
      return JSON.stringify({
        session: {
          id: session.id,
          name: session.name?.trim() || sessionDefaultName(session.cwd),
          cwd: session.cwd,
          mode: s.windowMode,
          paneCount: countLeaves(session.tree),
        },
      });
    },

    switch_session: async (params: Record<string, unknown>) => {
      const id = String(params.sessionId ?? '');
      if (!id) return JSON.stringify({ ok: false, error: 'sessionId required' });
      const s = useStore.getState();
      if (!s.sessions.find((x) => x.id === id)) {
        return JSON.stringify({
          ok: false,
          error: `No session with id "${id}".`,
        });
      }
      await s.switchSession(id);
      return JSON.stringify({ ok: true });
    },

    list_panes: async () => {
      // Always operates on the currently-active session — the LLM was
      // making up sessionIds, so we removed that knob entirely.
      const s = useStore.getState();
      const target = s.sessions.find((x) => x.id === s.windowId) ?? null;
      if (!target) {
        return JSON.stringify({
          ok: false,
          error: 'No active session. Use create_session first.',
        });
      }
      const isLead = s.windowMode === 'lead';
      const leadPaneId = isLead ? s.leadPaneId : null;
      const subPanes = collectPaneSummaries(target, s.panes).filter(
        (p) => p.paneId !== leadPaneId,
      );
      const result: Record<string, unknown> = {
        ok: true,
        sessionId: target.id,
        sessionName: target.name?.trim() || sessionDefaultName(target.cwd),
        mode: s.windowMode,
        panes: subPanes.map((p) => ({ ...p, role: 'sub' })),
      };
      // Surface the Lead pane separately so the LLM has a clear handle
      // and knows whether it's empty (= can be filled with set_lead_agent).
      if (isLead) {
        if (leadPaneId) {
          const p = s.panes[leadPaneId];
          result.lead = {
            paneId: leadPaneId,
            agentName: p?.agentName ?? null,
            status: p?.status ?? 'idle',
            role: 'lead',
          };
        } else {
          result.lead = { paneId: null, agentName: null, role: 'lead' };
        }
      }
      return JSON.stringify(result);
    },

    list_agents: async () => {
      const { agents } = useStore.getState();
      return JSON.stringify({
        // Prepend a hint so the LLM knows it must echo names verbatim
        // instead of paraphrasing them when calling other tools.
        note:
          'Use the exact `name` value when referencing an agent. Names often contain hyphens (e.g. default-frontent) — do not convert them to spaces.',
        agents: agents.map((a) => ({
          name: a.name,
          description: a.description ?? '',
          model: a.model ?? null,
          color: a.color ?? null,
          scope: a.scope,
        })),
      });
    },

    send_message_to_pane: async (params: Record<string, unknown>) => {
      const paneId = String(params.paneId ?? '');
      const text = String(params.text ?? '');
      if (!paneId || !text) {
        return JSON.stringify({
          ok: false,
          error: 'paneId and text are required',
        });
      }
      try {
        await useStore.getState().sendMessage(paneId, text);
        return JSON.stringify({ ok: true });
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    create_session: async (params: Record<string, unknown>) => {
      const before = useStore.getState();
      try {
        await before.createSession();
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const after = useStore.getState();
      // createSession opens a folder picker. If the user cancelled, the
      // active session id won't have changed — report that back to the
      // agent so it doesn't pretend the action succeeded.
      if (after.windowId === before.windowId) {
        return JSON.stringify({
          ok: false,
          error:
            'User cancelled the folder picker; no new session was created.',
        });
      }
      // Rename if a name was provided (createSession defaults to folder
      // basename otherwise).
      const requestedName = params.name ? String(params.name) : null;
      if (requestedName) {
        await after.renameSession(after.windowId, requestedName);
      }
      const session = useStore
        .getState()
        .sessions.find((x) => x.id === after.windowId);
      return JSON.stringify({
        ok: true,
        sessionId: after.windowId,
        name: session?.name ?? null,
        cwd: session?.cwd ?? null,
      });
    },

    add_pane_to_session: async (params: Record<string, unknown>) => {
      const agentNameRaw = String(params.agentName ?? '');
      if (!agentNameRaw) {
        return JSON.stringify({
          ok: false,
          error:
            'agentName is required. Pass the agent name (or a short query like "frontend").',
        });
      }

      const s0 = useStore.getState();
      if (!s0.cwd) {
        return JSON.stringify({
          ok: false,
          error:
            'No active session. Call create_session first to pick a folder.',
        });
      }

      // Resolve the LLM-provided agentName against the real library.
      const resolution = resolveAgentName(s0.agents, agentNameRaw);
      if (resolution.kind === 'none') {
        const did = resolution.suggestion;
        return JSON.stringify({
          success: false,
          ok: false,
          error: `No agent matches "${agentNameRaw}".`,
          available: s0.agents.map((a) => a.name),
          suggestion: did ?? null,
          // Tell the LLM exactly what to say + what to do next. ElevenLabs
          // agents respond more reliably to direct instructions than to
          // generic JSON shapes.
          agent_must_say: did
            ? `I don't have an agent called "${agentNameRaw}". Did you mean ${did}?`
            : `I don't have an agent called "${agentNameRaw}". Available are: ${s0.agents
                .map((a) => a.name)
                .join(', ')}. Which one?`,
          next_action: 'ASK_USER_THEN_RETRY',
        });
      }
      if (resolution.kind === 'ambiguous') {
        const names = resolution.candidates.map((a) => a.name);
        return JSON.stringify({
          success: false,
          ok: false,
          error: `Multiple agents match "${agentNameRaw}".`,
          candidates: resolution.candidates.map((a) => ({
            name: a.name,
            description: a.description ?? '',
          })),
          agent_must_say: `Multiple agents match "${agentNameRaw}": ${names.join(' and ')}. Which one?`,
          next_action: 'ASK_USER_THEN_RETRY_WITH_EXACT_NAME',
        });
      }
      const exactName = resolution.agent.name;

      // Empty-pane reuse: if the active session has any leaf with no
      // agent bound, use that directly instead of splitting. This means
      // adding the FIRST agent to a fresh session lands in the existing
      // empty pane; subsequent adds split.
      const treeNow = useStore.getState().tree;
      const leaves = collectLeafIds(treeNow);
      const panesNow = useStore.getState().panes;
      const emptyLeafId = leaves.find((id) => !panesNow[id]?.agentName);

      let targetPaneId: string;
      let split = false;
      if (emptyLeafId) {
        targetPaneId = emptyLeafId;
      } else {
        // Need to split. Pick a direction opposite the parent split so
        // panes don't all pile up the same way.
        const beforeLeaves = leaves;
        const activeId =
          useStore.getState().activePaneId ?? beforeLeaves[0] ?? null;
        if (!activeId) {
          return JSON.stringify({
            ok: false,
            error: 'No pane to split off; create a session first.',
          });
        }
        const direction = pickSplitDirection(treeNow, activeId);
        useStore.getState().splitPane(activeId, direction);
        const afterLeaves = collectLeafIds(useStore.getState().tree);
        const newPaneId = afterLeaves.find(
          (id) => !beforeLeaves.includes(id),
        );
        if (!newPaneId) {
          return JSON.stringify({ ok: false, error: 'Split pane failed.' });
        }
        targetPaneId = newPaneId;
        split = true;
      }

      try {
        await useStore.getState().setPaneAgent(targetPaneId, exactName);
        return JSON.stringify({
          success: true,
          ok: true,
          paneId: targetPaneId,
          resolvedAgentName: exactName,
          originalQuery: agentNameRaw,
          reusedEmptyPane: !split,
          agent_must_say: `Added ${exactName}.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          success: false,
          ok: false,
          error: msg,
          agent_must_say: `I couldn't add that agent: ${msg}. Want me to try again?`,
        });
      }
    },

    set_window_mode: async (params: Record<string, unknown>) => {
      const mode = String(params.mode ?? '');
      if (mode !== 'multi' && mode !== 'lead') {
        return JSON.stringify({
          ok: false,
          error: 'mode must be "multi" or "lead"',
        });
      }
      // Always operates on the active session — see the comment in
      // add_pane_to_session for why sessionId was removed.
      useStore.getState().setWindowMode(mode);
      return JSON.stringify({ ok: true, mode });
    },

    set_lead_agent: async (params: Record<string, unknown>) => {
      const agentNameRaw = String(params.agentName ?? '');
      if (!agentNameRaw) {
        return JSON.stringify({
          success: false,
          ok: false,
          error: 'agentName is required.',
          agent_must_say:
            'Which agent should I set as the lead?',
        });
      }
      const s0 = useStore.getState();
      if (!s0.cwd) {
        return JSON.stringify({
          success: false,
          ok: false,
          error: 'No active session.',
          agent_must_say:
            "There's no active session yet. Call create_session first.",
        });
      }
      const resolution = resolveAgentName(s0.agents, agentNameRaw);
      if (resolution.kind === 'none') {
        const did = resolution.suggestion;
        return JSON.stringify({
          success: false,
          ok: false,
          error: `No agent matches "${agentNameRaw}".`,
          available: s0.agents.map((a) => a.name),
          suggestion: did ?? null,
          agent_must_say: did
            ? `I don't have an agent called "${agentNameRaw}". Did you mean ${did}?`
            : `I don't have an agent called "${agentNameRaw}". Available are: ${s0.agents
                .map((a) => a.name)
                .join(', ')}. Which one?`,
          next_action: 'ASK_USER_THEN_RETRY',
        });
      }
      if (resolution.kind === 'ambiguous') {
        const names = resolution.candidates.map((a) => a.name);
        return JSON.stringify({
          success: false,
          ok: false,
          error: `Multiple agents match "${agentNameRaw}".`,
          candidates: resolution.candidates.map((a) => ({
            name: a.name,
            description: a.description ?? '',
          })),
          agent_must_say: `Multiple agents match "${agentNameRaw}": ${names.join(' and ')}. Which one should be the lead?`,
          next_action: 'ASK_USER_THEN_RETRY_WITH_EXACT_NAME',
        });
      }
      const exactName = resolution.agent.name;
      try {
        // Switch the session into Lead mode if it isn't already; the
        // setLeadAgent action assumes Lead pane state is set up.
        if (useStore.getState().windowMode !== 'lead') {
          useStore.getState().setWindowMode('lead');
        }
        await useStore.getState().setLeadAgent(exactName);
        return JSON.stringify({
          success: true,
          ok: true,
          resolvedAgentName: exactName,
          originalQuery: agentNameRaw,
          agent_must_say: `${exactName} is now the lead agent.`,
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return JSON.stringify({
          success: false,
          ok: false,
          error: msg,
          agent_must_say: `I couldn't set the lead agent: ${msg}.`,
        });
      }
    },

    close_pane: async (params: Record<string, unknown>) => {
      const paneId = String(params.paneId ?? '');
      if (!paneId) {
        return JSON.stringify({ ok: false, error: 'paneId required' });
      }
      try {
        await useStore.getState().closePane(paneId);
        return JSON.stringify({ ok: true });
      } catch (err) {
        return JSON.stringify({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },
  };
  // Wrap every entry so tool calls are traced into the VoiceSection log.
  return Object.fromEntries(
    Object.entries(raw).map(([name, fn]) => [name, trace(name, fn)]),
  );
}

/**
 * Higher-order function: wrap a tool handler so each call records into
 * the visible VoiceSection log + emits a console.log line tagged
 * `[voice-tool]`. The visible log is capped at the 12 most recent calls
 * to keep the UI tidy.
 */
function makeTracer(setToolCallsRef: {
  current: React.Dispatch<React.SetStateAction<VoiceToolCall[]>>;
}) {
  const MAX_LOG = 12;
  // The wrapper is intentionally typed loosely (params/result both
  // `unknown`) so it slots in alongside ClientTool, whose result type
  // is the union string|number|void synchronously OR wrapped in a
  // promise. Tightening this further fights TypeScript more than it
  // helps — every entry in our raw map already returns a JSON string.
  return (
    name: string,
    fn: (params: Record<string, unknown>) => unknown,
  ) => {
    return async (params: Record<string, unknown>) => {
      const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
      const ts = Date.now();
      const entry: VoiceToolCall = {
        id,
        ts,
        name,
        params: params ?? {},
        status: 'pending',
      };
      // eslint-disable-next-line no-console
      console.log(`[voice-tool] ${name}(`, params, ')');
      setToolCallsRef.current((cur) =>
        [entry, ...cur].slice(0, MAX_LOG),
      );
      try {
        const raw = fn(params ?? {});
        const out = raw instanceof Promise ? await raw : raw;
        const result = typeof out === 'string' ? out : JSON.stringify(out);
        const isErr = /"ok":\s*false/.test(result);
        // eslint-disable-next-line no-console
        console.log(`[voice-tool] ${name} →`, result);
        setToolCallsRef.current((cur) =>
          cur.map((e) =>
            e.id === id
              ? { ...e, status: isErr ? 'error' : 'ok', result }
              : e,
          ),
        );
        return out as string;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // eslint-disable-next-line no-console
        console.error(`[voice-tool] ${name} threw:`, err);
        setToolCallsRef.current((cur) =>
          cur.map((e) =>
            e.id === id ? { ...e, status: 'error', error: msg } : e,
          ),
        );
        throw err;
      }
    };
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────

/**
 * Match an LLM-supplied agent label against the real agent library.
 * Voice transcription can mangle agent names (default-frontent →
 * "Default frontend", website-data-extractor → "website data
 * extractor", typos like "frontent" → "frontend"), so we cascade
 * through several increasingly forgiving strategies.
 *
 * Returns one of:
 *   - { kind: 'exact', agent }       → literal-equivalent name match.
 *   - { kind: 'unique', agent }      → one fuzzy/typo match resolved.
 *   - { kind: 'ambiguous', candidates } → caller should ask the user.
 *   - { kind: 'none', suggestion? }  → no match; closest hint included.
 */
type AgentMatch =
  | { kind: 'exact'; agent: { name: string; description?: string } }
  | { kind: 'unique'; agent: { name: string; description?: string } }
  | {
      kind: 'ambiguous';
      candidates: Array<{ name: string; description?: string }>;
    }
  | { kind: 'none'; suggestion?: string };

function resolveAgentName<
  A extends { name: string; description?: string },
>(agents: A[], query: string): AgentMatch {
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  const q = normalize(query);
  if (!q) return { kind: 'none' };

  // 1. Exact (case- and separator-insensitive).
  const exact = agents.find((a) => normalize(a.name) === q);
  if (exact) return { kind: 'exact', agent: exact };

  // 2. Substring match either direction.
  const subs = agents.filter((a) => {
    const n = normalize(a.name);
    return n.includes(q) || q.includes(n);
  });
  if (subs.length === 1) return { kind: 'unique', agent: subs[0] };
  if (subs.length > 1) return { kind: 'ambiguous', candidates: subs };

  // 3. Word-overlap: every long token of the query must appear in the name.
  const qTokens = q.split(' ').filter((t) => t.length > 2);
  if (qTokens.length > 0) {
    const overlapping = agents.filter((a) => {
      const n = normalize(a.name);
      return qTokens.every((t) => n.includes(t));
    });
    if (overlapping.length === 1)
      return { kind: 'unique', agent: overlapping[0] };
    if (overlapping.length > 1)
      return { kind: 'ambiguous', candidates: overlapping };
  }

  // 4. Levenshtein typo tolerance — handles "default-frontent" vs
  //    "default-frontend" (1 char swap). Threshold scales with length:
  //    up to 2 chars off for short names, ratio ≤ 0.20 for longer.
  const scored = agents
    .map((a) => {
      const n = normalize(a.name);
      const d = levenshtein(q, n);
      const longer = Math.max(q.length, n.length);
      return { agent: a, distance: d, ratio: d / Math.max(longer, 1) };
    })
    .sort((a, b) => a.distance - b.distance);

  if (scored.length > 0) {
    const best = scored[0];
    const close = scored.filter(
      (s) => s.distance <= 2 && s.ratio <= 0.25,
    );
    if (close.length === 1) return { kind: 'unique', agent: close[0].agent };
    if (close.length > 1)
      return {
        kind: 'ambiguous',
        candidates: close.map((s) => s.agent),
      };
    // No fuzzy match good enough to auto-pick; surface the closest one
    // as a hint so the LLM can ask "did you mean …?".
    return { kind: 'none', suggestion: best.agent.name };
  }

  return { kind: 'none' };
}

/**
 * Plain Levenshtein edit distance. Small enough that we don't bother
 * importing a library for it.
 */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = new Array(b.length + 1);
  let curr = new Array(b.length + 1);
  for (let j = 0; j <= b.length; j++) prev[j] = j;
  for (let i = 1; i <= a.length; i++) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[b.length];
}

/**
 * Decide which direction a new split should run in: opposite of the
 * active leaf's parent split so panes don't all pile in the same axis.
 * Falls back to 'horizontal' when the active leaf is the root.
 */
function pickSplitDirection(
  tree: { kind: string; direction?: string; children?: unknown[]; id?: string },
  activeId: string,
): 'horizontal' | 'vertical' {
  type Node = {
    kind: string;
    direction?: 'horizontal' | 'vertical';
    children?: Node[];
    id?: string;
  };
  function findParent(
    node: Node,
    targetId: string,
    parent: Node | null,
  ): Node | null {
    if (node.kind === 'leaf' && node.id === targetId) return parent;
    if (node.kind === 'split' && node.children) {
      for (const c of node.children) {
        const found = findParent(c, targetId, node);
        if (found !== null) return found;
        // If the child IS the target leaf, parent is `node`.
        if (c.kind === 'leaf' && c.id === targetId) return node;
      }
    }
    return null;
  }
  const parent = findParent(tree as Node, activeId, null);
  if (!parent || parent.kind !== 'split') return 'horizontal';
  return parent.direction === 'horizontal' ? 'vertical' : 'horizontal';
}

function sessionDefaultName(cwd: string): string {
  const trimmed = cwd.replace(/\/+$/, '');
  return trimmed.split('/').pop() || 'Session';
}

function countLeaves(node: {
  kind: string;
  children?: unknown[];
}): number {
  if (node.kind === 'leaf') return 1;
  const children = (node.children ?? []) as Array<{
    kind: string;
    children?: unknown[];
  }>;
  return children.reduce((acc, c) => acc + countLeaves(c), 0);
}

function collectLeafIds(node: {
  kind: string;
  id?: string;
  children?: unknown[];
}): string[] {
  if (node.kind === 'leaf') return node.id ? [node.id] : [];
  const out: string[] = [];
  const children = (node.children ?? []) as Array<{
    kind: string;
    id?: string;
    children?: unknown[];
  }>;
  for (const c of children) out.push(...collectLeafIds(c));
  return out;
}

function collectPaneSummaries(
  session: { tree: unknown; lead?: { paneId: string; agentName?: string } },
  panes: Record<string, { agentName?: string; status: string }>,
): Array<{ paneId: string; agentName: string | null; status: string }> {
  // Use a Set to dedupe Lead pane id (which may not appear in `tree`).
  const ids = new Set<string>(
    collectLeafIds(session.tree as { kind: string; children?: unknown[] }),
  );
  if (session.lead?.paneId) ids.add(session.lead.paneId);
  return [...ids].map((id) => ({
    paneId: id,
    agentName: panes[id]?.agentName ?? null,
    status: panes[id]?.status ?? 'idle',
  }));
}
