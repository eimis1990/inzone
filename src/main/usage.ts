import { app } from 'electron';
import {
  promises as fs,
  createWriteStream,
  WriteStream,
} from 'fs';
import path from 'path';
import type { UsageEvent, UsageSummary } from '@shared/types';

function ledgerPath(): string {
  return path.join(app.getPath('userData'), 'usage.jsonl');
}

let stream: WriteStream | null = null;

async function ensureDir(): Promise<void> {
  await fs.mkdir(app.getPath('userData'), { recursive: true });
}

async function getStream(): Promise<WriteStream> {
  if (stream) return stream;
  await ensureDir();
  stream = createWriteStream(ledgerPath(), { flags: 'a' });
  return stream;
}

export async function recordUsage(event: UsageEvent): Promise<void> {
  try {
    const s = await getStream();
    await new Promise<void>((resolve, reject) => {
      s.write(JSON.stringify(event) + '\n', (err) =>
        err ? reject(err) : resolve(),
      );
    });
  } catch (err) {
    // Logging-only; never crash the session because of telemetry.
    console.warn('[usage] failed to record:', err);
  }
}

export async function closeUsageStream(): Promise<void> {
  if (!stream) return;
  const s = stream;
  stream = null;
  await new Promise<void>((resolve) => s.end(resolve));
}

/**
 * Read the ledger and compute an aggregated summary.
 *
 * We cap to the last ~365 days to keep computation bounded; realistically
 * even heavy users will stay well under that.
 */
export async function getUsageSummary(
  windowId?: string,
): Promise<UsageSummary> {
  const events = await loadEvents();
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const cutoff = now - 365 * dayMs;

  const today = new Date();
  const todayKey = toDayKey(today);
  const sevenDaysAgo = now - 7 * dayMs;

  let totalCostUsd = 0;
  let totalTurns = 0;
  let todayCostUsd = 0;
  let todayTurns = 0;
  let last7DaysCostUsd = 0;
  const byDay = new Map<string, { costUsd: number; turns: number }>();
  const byAgent = new Map<string, { costUsd: number; turns: number }>();
  const byModel = new Map<string, { costUsd: number; turns: number }>();

  for (const e of events) {
    if (e.ts < cutoff) continue;
    if (windowId && e.windowId !== windowId) continue;

    const cost = e.costUsd ?? 0;
    const turns = e.numTurns ?? 1;
    totalCostUsd += cost;
    totalTurns += turns;

    const day = toDayKey(new Date(e.ts));
    const dayEntry = byDay.get(day) ?? { costUsd: 0, turns: 0 };
    dayEntry.costUsd += cost;
    dayEntry.turns += turns;
    byDay.set(day, dayEntry);

    if (day === todayKey) {
      todayCostUsd += cost;
      todayTurns += turns;
    }
    if (e.ts >= sevenDaysAgo) {
      last7DaysCostUsd += cost;
    }

    if (e.agentName) {
      const a = byAgent.get(e.agentName) ?? { costUsd: 0, turns: 0 };
      a.costUsd += cost;
      a.turns += turns;
      byAgent.set(e.agentName, a);
    }
    const modelKey = e.model ?? '(default)';
    const m = byModel.get(modelKey) ?? { costUsd: 0, turns: 0 };
    m.costUsd += cost;
    m.turns += turns;
    byModel.set(modelKey, m);
  }

  return {
    totalCostUsd,
    totalTurns,
    todayCostUsd,
    todayTurns,
    last7DaysCostUsd,
    byDay: [...byDay.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => (a.day < b.day ? -1 : 1)),
    byAgent: [...byAgent.entries()]
      .map(([agent, v]) => ({ agent, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd),
    byModel: [...byModel.entries()]
      .map(([model, v]) => ({ model, ...v }))
      .sort((a, b) => b.costUsd - a.costUsd),
  };
}

async function loadEvents(): Promise<UsageEvent[]> {
  try {
    const raw = await fs.readFile(ledgerPath(), 'utf8');
    const out: UsageEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        out.push(JSON.parse(trimmed) as UsageEvent);
      } catch {
        // skip malformed line
      }
    }
    return out;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return [];
    throw err;
  }
}

function toDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
