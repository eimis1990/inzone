/**
 * Slash-command enumerator.
 *
 * Reads markdown files from:
 *   - `<projectCwd>/.claude/commands/*.md` → `source: 'project'`
 *   - `~/.claude/commands/*.md`            → `source: 'user'`
 *
 * Each file's stem is the command name (without leading `/`), the
 * frontmatter `description` is what the picker shows next to it, and
 * the body becomes the prompt template. Files without frontmatter
 * are still accepted — we synthesize a description from the first
 * non-empty body line.
 *
 * The renderer merges these with built-in starter commands (project
 * shadows user shadows builtin by name) via `mergeCommands()` in
 * `shared/builtin-commands.ts`.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import matter from 'gray-matter';
import type { ProjectCommand } from '../shared/types';

interface ListResult {
  project: ProjectCommand[];
  user: ProjectCommand[];
}

/**
 * Enumerate slash commands for a given project cwd.
 *
 * Both lookups are independent — a missing folder on either side is
 * not an error, just an empty list. We sort by name within each
 * source so the picker shows a predictable order.
 */
export async function listCommands(projectCwd: string): Promise<ListResult> {
  const userDir = path.join(os.homedir(), '.claude', 'commands');
  const projectDir = projectCwd
    ? path.join(projectCwd, '.claude', 'commands')
    : null;

  const [user, project] = await Promise.all([
    readDir(userDir, 'user'),
    projectDir ? readDir(projectDir, 'project') : Promise.resolve([]),
  ]);

  return {
    user: user.sort(byName),
    project: project.sort(byName),
  };
}

function byName(a: ProjectCommand, b: ProjectCommand): number {
  return a.name.localeCompare(b.name);
}

async function readDir(
  dir: string,
  source: 'user' | 'project',
): Promise<ProjectCommand[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch (err) {
    // ENOENT is the common case (the user just doesn't have a
    // .claude/commands/ folder yet); treat it as an empty list.
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return [];
    // Any other I/O error: log and return empty so the picker still
    // works (it falls back to builtins).
    console.warn(`[commands] failed to read ${dir}:`, err);
    return [];
  }

  const mdFiles = entries.filter(
    (f) => f.endsWith('.md') && !f.startsWith('.'),
  );
  const results = await Promise.all(
    mdFiles.map(async (filename) => {
      const filePath = path.join(dir, filename);
      try {
        const raw = await fs.readFile(filePath, 'utf8');
        const parsed = matter(raw);
        const name = filename.replace(/\.md$/i, '');
        const description = (typeof parsed.data?.description === 'string'
          ? parsed.data.description.trim()
          : '') || firstLine(parsed.content) || `Run /${name}`;
        const body = parsed.content.trim();
        if (!body) return null;
        const cmd: ProjectCommand = {
          name,
          description,
          body,
          source,
          filePath,
        };
        return cmd;
      } catch (err) {
        console.warn(`[commands] failed to parse ${filePath}:`, err);
        return null;
      }
    }),
  );
  return results.filter((c): c is ProjectCommand => c !== null);
}

/**
 * Pull a one-line description out of the body when frontmatter has
 * none. Strips leading hashes (so a Markdown H1 doesn't show up as
 * "# do the thing") and truncates to a comfortable picker length.
 */
function firstLine(body: string): string {
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const stripped = line.replace(/^#+\s*/, '').trim();
    if (!stripped) continue;
    return stripped.length > 80 ? stripped.slice(0, 77) + '…' : stripped;
  }
  return '';
}
