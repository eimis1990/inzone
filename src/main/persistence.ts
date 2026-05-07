import { app } from 'electron';
import Store from 'electron-store';
import { randomUUID } from 'crypto';
import { promises as fs, createWriteStream, WriteStream } from 'fs';
import path from 'path';
import type {
  AppState,
  PaneId,
  TranscriptEntry,
  WindowState,
  Workspace,
} from '@shared/types';

const DEFAULTS: AppState = {
  windows: [],
  workspaces: [],
};

// electron-store persists a JSON file under userData.
const store = new Store<AppState>({
  name: 'claude-panels-state',
  defaults: DEFAULTS,
});

const looseStore = store as unknown as {
  get(key: string): unknown;
  set(key: string, value: unknown): void;
  delete(key: string): void;
};

/**
 * One-shot migration from the pre-v0.2 shape:
 *   - workspaces missing → create one default workspace owning every
 *     existing window, set as active.
 *   - presets present → drop them; the new model doesn't use them.
 *
 * Idempotent — running this twice is a no-op once `workspaces` exists.
 */
function migrateOnce(): void {
  const existingWorkspaces = (looseStore.get('workspaces') as
    | Workspace[]
    | undefined) ?? [];
  const windows = store.get('windows', []);
  if (existingWorkspaces.length === 0 && windows.length > 0) {
    const ws: Workspace = {
      id: randomUUID(),
      name: 'My Workspace',
      projectIds: windows.map((w) => w.id),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    store.set('workspaces', [ws]);
    looseStore.set('activeWorkspaceId', ws.id);
    console.info(
      `[persistence] migrated ${windows.length} project(s) into "My Workspace".`,
    );
  } else if (existingWorkspaces.length === 0) {
    // First-ever launch — start with no workspaces. The renderer will
    // create one as soon as the user picks a folder.
    store.set('workspaces', []);
  }
  if (looseStore.get('presets') !== undefined) {
    looseStore.delete('presets');
    console.info('[persistence] dropped legacy `presets` from state.');
  }
}

migrateOnce();

export function getState(): AppState {
  return {
    windows: store.get('windows', []),
    workspaces:
      (looseStore.get('workspaces') as Workspace[] | undefined) ?? [],
    activeSessionId: looseStore.get('activeSessionId') as string | undefined,
    activeWorkspaceId:
      (looseStore.get('activeWorkspaceId') as string | undefined) ?? undefined,
    customTaskTemplates: looseStore.get('customTaskTemplates') as
      | AppState['customTaskTemplates']
      | undefined,
  };
}

/* ─── Custom task templates ──────────────────────────────────────── */

export function setCustomTaskTemplates(
  list: NonNullable<AppState['customTaskTemplates']>,
): void {
  looseStore.set('customTaskTemplates', list);
}

export function saveWindowState(win: WindowState): void {
  const windows = store.get('windows', []);
  const idx = windows.findIndex((w) => w.id === win.id);
  if (idx >= 0) windows[idx] = win;
  else windows.push(win);
  store.set('windows', windows);
}

export function deleteWindowState(id: string): void {
  const windows = store.get('windows', []).filter((w) => w.id !== id);
  store.set('windows', windows);
  if (looseStore.get('activeSessionId') === id) {
    looseStore.delete('activeSessionId');
  }
  // Also remove from any workspace that owned it.
  const workspaces =
    (looseStore.get('workspaces') as Workspace[] | undefined) ?? [];
  const next = workspaces.map((w) => ({
    ...w,
    projectIds: w.projectIds.filter((pid) => pid !== id),
    updatedAt: w.projectIds.includes(id) ? Date.now() : w.updatedAt,
  }));
  store.set('workspaces', next);
}

export function setActiveSessionId(id: string | undefined): void {
  if (id) looseStore.set('activeSessionId', id);
  else looseStore.delete('activeSessionId');
}

/* ─── Workspaces ──────────────────────────────────────────────────── */

export function saveWorkspace(ws: Workspace): void {
  const workspaces =
    (looseStore.get('workspaces') as Workspace[] | undefined) ?? [];
  const idx = workspaces.findIndex((w) => w.id === ws.id);
  const stamped = { ...ws, updatedAt: Date.now() };
  if (idx >= 0) workspaces[idx] = stamped;
  else workspaces.push({ ...stamped, createdAt: Date.now() });
  store.set('workspaces', workspaces);
}

export function deleteWorkspace(id: string): void {
  const workspaces =
    (looseStore.get('workspaces') as Workspace[] | undefined) ?? [];
  const next = workspaces.filter((w) => w.id !== id);
  store.set('workspaces', next);
  if (looseStore.get('activeWorkspaceId') === id) {
    looseStore.delete('activeWorkspaceId');
  }
}

export function setActiveWorkspaceId(id: string | undefined): void {
  if (id) looseStore.set('activeWorkspaceId', id);
  else looseStore.delete('activeWorkspaceId');
}

// --- Transcripts -----------------------------------------------------------

function transcriptsDir(): string {
  return path.join(app.getPath('userData'), 'transcripts');
}

function transcriptPath(paneId: PaneId): string {
  // paneId is a nanoid, safe for a filename.
  return path.join(transcriptsDir(), `${paneId}.jsonl`);
}

const openStreams = new Map<PaneId, WriteStream>();

async function ensureDir(): Promise<void> {
  await fs.mkdir(transcriptsDir(), { recursive: true });
}

export async function appendTranscript(
  paneId: PaneId,
  entry: TranscriptEntry,
): Promise<void> {
  await ensureDir();
  let stream = openStreams.get(paneId);
  if (!stream) {
    stream = createWriteStream(transcriptPath(paneId), { flags: 'a' });
    openStreams.set(paneId, stream);
  }
  await new Promise<void>((resolve, reject) => {
    stream!.write(JSON.stringify(entry) + '\n', (err) =>
      err ? reject(err) : resolve(),
    );
  });
}

export async function loadTranscript(
  paneId: PaneId,
): Promise<TranscriptEntry[]> {
  try {
    const raw = await fs.readFile(transcriptPath(paneId), 'utf8');
    const lines = raw.split('\n').filter((l) => l.trim().length > 0);
    const out: TranscriptEntry[] = [];
    for (const line of lines) {
      try {
        out.push(JSON.parse(line) as TranscriptEntry);
      } catch {
        // Skip malformed lines.
      }
    }
    return out;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
}

export async function closeTranscript(paneId: PaneId): Promise<void> {
  const stream = openStreams.get(paneId);
  if (!stream) return;
  openStreams.delete(paneId);
  await new Promise<void>((resolve) => stream.end(resolve));
}

export async function deleteTranscript(paneId: PaneId): Promise<void> {
  await closeTranscript(paneId);
  try {
    await fs.unlink(transcriptPath(paneId));
  } catch {
    // Already gone — fine.
  }
}

export async function closeAllTranscripts(): Promise<void> {
  await Promise.all(
    [...openStreams.keys()].map((id) => closeTranscript(id)),
  );
}
