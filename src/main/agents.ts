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
import { listEnabledPlugins } from './plugins';

const USER_AGENTS_DIR = path.join(homedir(), '.claude', 'agents');
const USER_SKILLS_DIR = path.join(homedir(), '.claude', 'skills');

/** Parse a single agent markdown file. Returns null on error.
 *
 *  `pluginName`, when present, tags the resulting agent as
 *  contributed by that plugin (rendered as an attribution chip in
 *  the Agents table and respected by save/delete which refuse to
 *  edit plugin-owned files). */
async function parseAgentFile(
  filePath: string,
  scope: 'user' | 'project',
  pluginName?: string,
): Promise<AgentDef | null> {
  try {
    // Read + stat in parallel — stat gives us mtime for the Agents
    // table's "Modified" column sort.
    const [raw, stat] = await Promise.all([
      fs.readFile(filePath, 'utf8'),
      fs.stat(filePath).catch(() => null),
    ]);
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
      modifiedAt: stat ? stat.mtimeMs : undefined,
      pluginName,
    };
  } catch (err) {
    console.warn(`[agents] failed to parse ${filePath}:`, err);
    return null;
  }
}

/** Scan a directory (recursively-ish) for *.md files.
 *
 *  `pluginName` flows through to each parsed `AgentDef` so plugin-
 *  contributed agents carry attribution. */
async function scanAgentDir(
  dir: string,
  scope: 'user' | 'project',
  pluginName?: string,
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
      const agent = await parseAgentFile(full, scope, pluginName);
      if (agent) out.push(agent);
    }
  }
  return out;
}

export async function listAgents(
  projectDir?: string,
): Promise<AgentDef[]> {
  // Three sources of agents:
  //   1. Built-in user library `~/.claude/agents/`
  //   2. Project-local `<cwd>/.claude/agents/` (overrides on collision)
  //   3. Enabled plugins' `<plugin>/agents/` folders — each plugin
  //      contributes under user scope but carries a `pluginName`
  //      attribution. Disabled plugins do NOT contribute (the
  //      Settings → Plugins toggle is the user's lever to pause a
  //      plugin without uninstalling it).
  const [userAgents, projectAgents, pluginAgentsLists] = await Promise.all([
    scanAgentDir(USER_AGENTS_DIR, 'user'),
    projectDir
      ? scanAgentDir(path.join(projectDir, '.claude', 'agents'), 'project')
      : Promise.resolve([] as AgentDef[]),
    listEnabledPlugins().then(async (plugins) => {
      const lists = await Promise.all(
        plugins.map((p) =>
          scanAgentDir(
            path.join(p.installPath, 'agents'),
            'user',
            p.manifest.name,
          ),
        ),
      );
      return lists.flat();
    }),
  ]);
  // Precedence on name collision: project > plugin > user. Plugin
  // wins over a vanilla user-scope agent of the same name (the user
  // explicitly installed the plugin so its version is the wanted
  // one) but loses to a project-local override.
  const byName = new Map<string, AgentDef>();
  for (const a of userAgents) byName.set(a.name, a);
  for (const a of pluginAgentsLists) byName.set(a.name, a);
  for (const a of projectAgents) byName.set(a.name, a);
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Scan ~/.claude/skills/<name>/SKILL.md for display only. */
async function scanSkillDir(
  dir: string,
  scope: 'user' | 'project',
  pluginName?: string,
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
        pluginName,
      });
    } catch (err) {
      console.warn(`[skills] failed to parse ${skillFile}:`, err);
    }
  }
  return out;
}

export async function listSkills(projectDir?: string): Promise<SkillDef[]> {
  // Same three-source merge as `listAgents`. Enabled plugins'
  // `<plugin>/skills/<name>/SKILL.md` folders are walked into
  // user scope with attribution; disabled plugins contribute
  // nothing.
  const [userSkills, projectSkills, pluginSkillsLists] = await Promise.all([
    scanSkillDir(USER_SKILLS_DIR, 'user'),
    projectDir
      ? scanSkillDir(path.join(projectDir, '.claude', 'skills'), 'project')
      : Promise.resolve([] as SkillDef[]),
    listEnabledPlugins().then(async (plugins) => {
      const lists = await Promise.all(
        plugins.map((p) =>
          scanSkillDir(
            path.join(p.installPath, 'skills'),
            'user',
            p.manifest.name,
          ),
        ),
      );
      return lists.flat();
    }),
  ]);
  // Same precedence as agents: project > plugin > user.
  const byName = new Map<string, SkillDef>();
  for (const s of userSkills) byName.set(s.name, s);
  for (const s of pluginSkillsLists) byName.set(s.name, s);
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

/**
 * Resolve the on-disk folder where a save should land. User scope is
 * easy — always `~/.claude/<kind>/`. Project scope is location-aware:
 *
 *   - When editing an existing project file (`originalFilePath`
 *     set), we write back to the same folder. Tweaks to color /
 *     emoji / body all stay co-located with the rest of the
 *     project's `.claude/<kind>/` files.
 *   - When creating a new project file (no `originalFilePath`), we
 *     need an explicit `projectCwd` so we know which project's
 *     `.claude/<kind>/` to drop the file in. The renderer passes
 *     this from its current `cwd` state.
 *
 * Throws when project scope is requested but neither hint is set —
 * that's a renderer bug we want loud.
 */
function scopeRoot(
  scope: 'user' | 'project',
  kind: 'agents' | 'skills',
  hints?: { originalFilePath?: string; projectCwd?: string },
): string {
  if (scope === 'user') {
    return kind === 'agents' ? USER_AGENTS_DIR : USER_SKILLS_DIR;
  }
  // Project scope.
  if (hints?.originalFilePath) {
    return path.dirname(hints.originalFilePath);
  }
  if (hints?.projectCwd) {
    return path.join(hints.projectCwd, '.claude', kind);
  }
  throw new Error(
    'Project-scoped save requires either an existing file path or the active project cwd.',
  );
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
  const root = scopeRoot(draft.scope, 'agents', {
    originalFilePath: draft.originalFilePath,
    projectCwd: draft.projectCwd,
  });
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

/**
 * Delete an agent file. Allowed locations:
 *   - `~/.claude/agents/` (user scope, any project)
 *   - any `<project>/.claude/agents/` (project scope) — we don't
 *     hard-restrict to a specific project root, just verify the
 *     path's parent is named `.claude/agents` so a typo'd file path
 *     can't reach into the user's home or system folders.
 */
export async function deleteAgent(filePath: string): Promise<void> {
  const resolved = path.resolve(filePath);
  if (resolved.startsWith(path.resolve(USER_AGENTS_DIR))) {
    await fs.unlink(resolved);
    return;
  }
  // Project scope check: parent dir must be `<...>/.claude/agents`.
  const parent = path.dirname(resolved);
  const claudeMarker = path.join('.claude', 'agents');
  if (!parent.endsWith(claudeMarker)) {
    throw new Error(
      "Refusing to delete: path isn't inside ~/.claude/agents or a project's .claude/agents folder.",
    );
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
  const root = scopeRoot(draft.scope, 'skills', {
    originalFilePath: draft.originalFilePath,
    projectCwd: draft.projectCwd,
  });
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
