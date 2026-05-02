import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';
import type { MemoryScope } from '@shared/types';

/** Resolve the CLAUDE.md file path for a given scope. */
export function projectMemoryPath(cwd: string): string {
  return path.join(cwd, 'CLAUDE.md');
}

export function globalMemoryPath(): string {
  return path.join(homedir(), '.claude', 'CLAUDE.md');
}

/** Read a memory file. Returns '' if missing. */
export async function readMemoryFile(filePath: string): Promise<string> {
  try {
    return await fs.readFile(filePath, 'utf8');
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return '';
    throw err;
  }
}

/** Write a memory file, creating directories as needed. */
export async function writeMemoryFile(
  filePath: string,
  content: string,
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

/** Ensure a CLAUDE.md exists at `<cwd>/CLAUDE.md`; create empty if missing. */
export async function ensureProjectMemory(cwd: string): Promise<void> {
  const target = projectMemoryPath(cwd);
  try {
    await fs.access(target);
  } catch {
    try {
      await fs.writeFile(target, '', 'utf8');
    } catch (err) {
      // Best-effort — if the folder is read-only, just skip silently.
      console.warn('[memory] could not create CLAUDE.md:', err);
    }
  }
}

/**
 * Compose the memory text to inject into an agent's system prompt based
 * on the workspace's memoryScope. Returns '' when scope is 'none' or
 * both candidate files are empty.
 */
export async function composeMemoryForScope(
  cwd: string,
  scope: MemoryScope,
): Promise<string> {
  if (scope === 'none') return '';
  const proj =
    scope === 'project' || scope === 'both'
      ? (await readMemoryFile(projectMemoryPath(cwd))).trim()
      : '';
  const glob =
    scope === 'global' || scope === 'both'
      ? (await readMemoryFile(globalMemoryPath())).trim()
      : '';

  const parts: string[] = [];
  if (proj) parts.push(`### Project memory (./CLAUDE.md)\n\n${proj}`);
  if (glob) parts.push(`### Global memory (~/.claude/CLAUDE.md)\n\n${glob}`);
  if (parts.length === 0) return '';
  return ['## Project memory (CLAUDE.md)', '', ...parts].join('\n\n');
}
