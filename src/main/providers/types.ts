import type {
  AgentDef,
  MessageImage,
  PaneId,
  SessionEvent,
  SkillDef,
  StartSessionParams,
} from '@shared/types';

/**
 * Common contract every session controller implements, regardless of
 * which LLM provider backs it. The renderer only ever sees SessionEvent
 * streams, so provider-specific handling is invisible to the UI.
 */
export interface IAgentSession {
  readonly paneId: PaneId;
  agentName: string | undefined;
  model: string | undefined;
  windowId: string | undefined;

  start(
    params: StartSessionParams,
    agent: AgentDef,
    availableSkills?: SkillDef[],
    leadExtras?: {
      mcpServers: Record<string, unknown>;
      leadPrompt: string;
    },
  ): Promise<void>;

  send(text: string, images?: MessageImage[]): void;
  sendAndWait(text: string, timeoutMs?: number): Promise<string>;
  interrupt(): Promise<void>;
  stop(): Promise<void>;
  getSessionId(): string | undefined;
}

export type SessionEmit = (event: SessionEvent) => void;
