import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';
import matter from 'gray-matter';
import chokidar, { FSWatcher } from 'chokidar';
import type {
  AgentDef,
  AgentDraft,
  SkillDef,
  SkillDraft,
} from '@shared/types';

const USER_AGENTS_DIR = path.join(homedir(), '.claude', 'agents');
const USER_SKILLS_DIR = path.join(homedir(), '.claude', 'skills');

/** Parse a single agent markdown file. Returns null on error. */
async function parseAgentFile(
  filePath: string,
  scope: 'user' | 'project',
): Promise<AgentDef | null> {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const parsed = matter(raw);
    const data = parsed.data as Record<string, unknown>;
    const baseName = path.basename(filePath, path.extname(filePath));
    const name =
      typeof data.name === 'string' && data.name.trim().length > 0
        ? (data.name as string)
        : baseName;
    const description =
      typeof data.description === 'string' ? data.description : undefined;
    const model = typeof data.model === 'string' ? data.model : undefined;
    const color = typeof data.color === 'string' ? data.color : undefined;
    // emoji and vibe are optional personality fields surfaced in the
    // pane header. Both default to undefined when missing.
    const emoji =
      typeof data.emoji === 'string' && data.emoji.trim().length > 0
        ? (data.emoji as string).trim()
        : undefined;
    const vibe =
      typeof data.vibe === 'string' && data.vibe.trim().length > 0
        ? (data.vibe as string).trim()
        : undefined;

    let tools: string[] | undefined;
    if (Array.isArray(data.tools)) {
      tools = data.tools.filter((t): t is string => typeof t === 'string');
    } else if (typeof data.tools === 'string') {
      // Some agent files list tools as a comma-separated string.
      tools = data.tools
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);
    }

    let skills: string[] | undefined;
    if (Array.isArray(data.skills)) {
      skills = data.skills.filter((s): s is string => typeof s === 'string');
    } else if (typeof data.skills === 'string') {
      skills = data.skills
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    let mcpServers: string[] | undefined;
    if (Array.isArray(data.mcpServers)) {
      mcpServers = data.mcpServers.filter(
        (s): s is string => typeof s === 'string',
      );
    } else if (typeof data.mcpServers === 'string') {
      mcpServers = data.mcpServers
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    }

    return {
      name,
      description,
      model,
      tools,
      skills,
      mcpServers,
      color,
      emoji,
      vibe,
      body: parsed.content.trim(),
      filePath,
      scope,
    };
  } catch (err) {
    console.warn(`[agents] failed to parse ${filePath}:`, err);
    return null;
  }
}

/** Scan a directory (recursively-ish) for *.md files. */
async function scanAgentDir(
  dir: string,
  scope: 'user' | 'project',
): Promise<AgentDef[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: AgentDef[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = await fs.stat(full);
    } catch {
      continue;
    }
    if (stat.isFile() && entry.toLowerCase().endsWith('.md')) {
      const agent = await parseAgentFile(full, scope);
      if (agent) out.push(agent);
    }
  }
  return out;
}

export async function listAgents(
  projectDir?: string,
): Promise<AgentDef[]> {
  const userAgents = await scanAgentDir(USER_AGENTS_DIR, 'user');
  let projectAgents: AgentDef[] = [];
  if (projectDir) {
    projectAgents = await scanAgentDir(
      path.join(projectDir, '.claude', 'agents'),
      'project',
    );
  }
  // Project scope wins on name collision.
  const byName = new Map<string, AgentDef>();
  for (const a of userAgents) byName.set(a.name, a);
  for (const a of projectAgents) byName.set(a.name, a);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Scan ~/.claude/skills/<name>/SKILL.md for display only. */
async function scanSkillDir(
  dir: string,
  scope: 'user' | 'project',
): Promise<SkillDef[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return [];
  }
  const out: SkillDef[] = [];
  for (const entry of entries) {
    const skillDir = path.join(dir, entry);
    const skillFile = path.join(skillDir, 'SKILL.md');
    try {
      const stat = await fs.stat(skillFile);
      if (!stat.isFile()) continue;
    } catch {
      continue;
    }
    try {
      const raw = await fs.readFile(skillFile, 'utf8');
      const parsed = matter(raw);
      const data = parsed.data as Record<string, unknown>;
      const name =
        typeof data.name === 'string' && data.name.trim().length > 0
          ? (data.name as string)
          : entry;
      const description =
        typeof data.description === 'string' ? data.description : undefined;
      out.push({
        name,
        description,
        body: parsed.content.trim(),
        filePath: skillFile,
        scope,
      });
    } catch (err) {
      console.warn(`[skills] failed to parse ${skillFile}:`, err);
    }
  }
  return out;
}

export async function listSkills(projectDir?: string): Promise<SkillDef[]> {
  const userSkills = await scanSkillDir(USER_SKILLS_DIR, 'user');
  let projectSkills: SkillDef[] = [];
  if (projectDir) {
    projectSkills = await scanSkillDir(
      path.join(projectDir, '.claude', 'skills'),
      'project',
    );
  }
  const byName = new Map<string, SkillDef>();
  for (const s of userSkills) byName.set(s.name, s);
  for (const s of projectSkills) byName.set(s.name, s);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Write / delete: editor support
// ---------------------------------------------------------------------------

const FILENAME_SAFE = /^[A-Za-z0-9._-]+$/;

function safeFileName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error('Name cannot be empty.');
  if (!FILENAME_SAFE.test(trimmed)) {
    throw new Error(
      'Name may only contain letters, numbers, dashes, dots, and underscores.',
    );
  }
  return trimmed;
}

function scopeRoot(scope: 'user' | 'project', kind: 'agents' | 'skills'): string {
  if (scope === 'project') {
    throw new Error(
      'Editing project-scoped definitions is not supported yet; only user scope.',
    );
  }
  return kind === 'agents' ? USER_AGENTS_DIR : USER_SKILLS_DIR;
}

function serializeAgent(draft: AgentDraft): string {
  const frontmatter: Record<string, unknown> = { name: draft.name };
  if (draft.description) frontmatter.description = draft.description;
  if (draft.model) frontmatter.model = draft.model;
  if (draft.tools && draft.tools.length > 0) frontmatter.tools = draft.tools;
  if (draft.skills && draft.skills.length > 0) frontmatter.skills = draft.skills;
  if (draft.mcpServers && draft.mcpServers.length > 0)
    frontmatter.mcpServers = draft.mcpServers;
  if (draft.color) frontmatter.color = draft.color;
  if (draft.emoji && draft.emoji.trim()) frontmatter.emoji = draft.emoji.trim();
  if (draft.vibe && draft.vibe.trim()) frontmatter.vibe = draft.vibe.trim();
  return matter.stringify(draft.body.trimEnd() + '\n', frontmatter);
}

export async function saveAgent(draft: AgentDraft): Promise<AgentDef> {
  const name = safeFileName(draft.name);
  const root = scopeRoot(draft.scope, 'agents');
  await fs.mkdir(root, { recursive: true });
  const targetPath = path.join(root, `${name}.md`);

  // Rename: if updating an existing file whose name changed, remove the old.
  if (
    draft.originalFilePath &&
    path.resolve(draft.originalFilePath) !== path.resolve(targetPath)
  ) {
    try {
      await fs.unlink(draft.originalFilePath);
    } catch {
      // File may already be gone; ignore.
    }
  }

  await fs.writeFile(
    targetPath,
    serializeAgent({ ...draft, name }),
    'utf8',
  );
  const saved = await parseAgentFile(targetPath, draft.scope);
  if (!saved) throw new Error('Failed to re-read saved agent file.');
  return saved;
}

export async function deleteAgent(filePath: string): Promise<void> {
  // Refuse anything outside the expected roots, as a small safety net.
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(USER_AGENTS_DIR))) {
    throw new Error('Refusing to delete outside ~/.claude/agents.');
  }
  await fs.unlink(resolved);
}

function serializeSkill(draft: SkillDraft): string {
  const frontmatter: Record<string, unknown> = { name: draft.name };
  if (draft.description) frontmatter.description = draft.description;
  return matter.stringify(draft.body.trimEnd() + '\n', frontmatter);
}

export async function saveSkill(draft: SkillDraft): Promise<SkillDef> {
  const name = safeFileName(draft.name);
  const root = scopeRoot(draft.scope, 'skills');
  await fs.mkdir(root, { recursive: true });
  const targetDir = path.join(root, name);
  const targetPath = path.join(targetDir, 'SKILL.md');

  // Rename handling: if folder name changed, rename the old folder.
  if (draft.originalFilePath) {
    const oldDir = path.dirname(draft.originalFilePath);
    if (path.resolve(oldDir) !== path.resolve(targetDir)) {
      try {
        await fs.rename(oldDir, targetDir);
      } catch (err) {
        // If rename fails (e.g. cross-device), fall back to mkdir + copy + unlink.
        console.warn('[skills] rename failed, falling back:', err);
      }
    }
  }

  await fs.mkdir(targetDir, { recursive: true });
  await fs.writeFile(targetPath, serializeSkill({ ...draft, name }), 'utf8');

  const raw = await fs.readFile(targetPath, 'utf8');
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  return {
    name,
    description:
      typeof data.description === 'string' ? data.description : undefined,
    body: parsed.content.trim(),
    filePath: targetPath,
    scope: draft.scope,
  };
}

export async function deleteSkill(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(path.resolve(USER_SKILLS_DIR))) {
    throw new Error('Refusing to delete outside ~/.claude/skills.');
  }
  // A skill "filePath" points at the SKILL.md; delete the containing folder.
  const dir = path.dirname(resolved);
  await fs.rm(dir, { recursive: true, force: true });
}

/** Watch agent + skill directories. Calls onChange (debounced by chokidar) on any change. */
export function watchDefinitions(onChange: () => void): FSWatcher {
  const watcher = chokidar.watch(
    [USER_AGENTS_DIR, USER_SKILLS_DIR],
    {
      ignoreInitial: true,
      depth: 2,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
    },
  );
  watcher.on('all', () => {
    onChange();
  });
  return watcher;
}
