import { app } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';

/**
 * What a restored session needs on startup. Anthropic-only since the
 * Claude Agent SDK gives us a `resume:` handle keyed by session id.
 *
 * `mcpServers` records the agent's opt-ins at the time the session was
 * created. If the user changes the opt-in list later, we treat that as
 * a different session topology and start fresh — resuming an old session
 * keeps its original tool surface even when new mcpServers are passed.
 */
export interface PersistedSession {
  paneId: string;
  agentName: string;
  model?: string;
  /** SDK-visible session id (used for `resume:`). */
  sdkSessionId?: string;
  /** Names of MCP servers the agent was opted into when this session began. */
  mcpServers?: string[];
  updatedAt: number;
}

function dir(): string {
  return path.join(app.getPath('userData'), 'sessions');
}

function filePath(paneId: string): string {
  return path.join(dir(), `${paneId}.json`);
}

export async function saveSessionState(
  state: PersistedSession,
): Promise<void> {
  try {
    await fs.mkdir(dir(), { recursive: true });
    await fs.writeFile(
      filePath(state.paneId),
      JSON.stringify(state, null, 2),
      'utf8',
    );
  } catch (err) {
    console.warn('[session-store] save failed:', err);
  }
}

export async function loadSessionState(
  paneId: string,
): Promise<PersistedSession | null> {
  try {
    const raw = await fs.readFile(filePath(paneId), 'utf8');
    return JSON.parse(raw) as PersistedSession;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return null;
    console.warn('[session-store] load failed:', err);
    return null;
  }
}

export async function deleteSessionState(paneId: string): Promise<void> {
  try {
    await fs.unlink(filePath(paneId));
  } catch {
    // already gone — fine
  }
}
