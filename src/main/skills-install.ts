/**
 * Install a curated recommended skill into the user's
 * `~/.claude/skills/` directory.
 *
 * Strategy:
 *   1. Verify git is on PATH (cheap probe via `which`/`where`).
 *   2. If the target folder already exists with a SKILL.md, no-op
 *      and report "already installed" so the UI can flip its state.
 *   3. Clone the repo into a temp directory at depth 1.
 *   4. Validate the optional subPath actually exists in the clone.
 *   5. Copy the subtree (whole clone or subPath only) into
 *      `~/.claude/skills/<installAs>/`, refusing to overwrite any
 *      file the user already has.
 *   6. Clean up the temp clone.
 *
 * Failure modes surface as `{ ok: false, error }` so the renderer
 * can show a friendly message in the recommended-skills card.
 */

import { promises as fs } from 'fs';
import { homedir, tmpdir } from 'os';
import path from 'path';
import { spawn } from 'child_process';
import type { RecommendedSkill } from '@shared/recommended-skills';

const HOME_SKILLS_DIR = path.join(homedir(), '.claude', 'skills');

export type InstallSkillResult =
  | { ok: true; alreadyInstalled: boolean; installedAt: string }
  | { ok: false; error: string };

export async function installRecommendedSkill(
  skill: RecommendedSkill,
): Promise<InstallSkillResult> {
  const installAs = skill.installAs ?? skill.id;
  const targetDir = path.join(HOME_SKILLS_DIR, installAs);

  // Already-installed shortcut — if the SKILL.md is on disk, treat
  // this as a no-op success. Lets the UI flip to "Installed" without
  // doing any work when the user reopens Settings.
  try {
    await fs.access(path.join(targetDir, 'SKILL.md'));
    return { ok: true, alreadyInstalled: true, installedAt: targetDir };
  } catch {
    /* not installed — proceed */
  }

  // Verify git is available. Without it the clone will fail with a
  // confusing ENOENT, so we surface the cause cleanly.
  try {
    await runGit(['--version']);
  } catch {
    return {
      ok: false,
      error:
        'git is not installed (or not on your PATH). Install Xcode Command Line Tools (macOS), Git for Windows, or your package manager\'s git package, then try again.',
    };
  }

  // Clone into a unique temp directory. We do depth=1 on the requested
  // branch to keep the download small.
  const tempRoot = await fs.mkdtemp(
    path.join(tmpdir(), `inzone-skill-${skill.id}-`),
  );
  const clonePath = path.join(tempRoot, 'clone');
  const branch = skill.branch ?? 'main';

  try {
    try {
      await runGit([
        'clone',
        '--depth=1',
        '--branch',
        branch,
        skill.repoUrl,
        clonePath,
      ]);
    } catch (err) {
      return {
        ok: false,
        error:
          'git clone failed. Check your internet connection and that the repo + branch exist. ' +
          (err instanceof Error ? err.message : String(err)),
      };
    }

    // Resolve the subdirectory we'll actually copy. If the skill
    // declares a subPath, ensure it exists; otherwise copy the whole
    // clone.
    const sourceDir = skill.subPath
      ? path.join(clonePath, skill.subPath)
      : clonePath;
    try {
      const stat = await fs.stat(sourceDir);
      if (!stat.isDirectory()) {
        return {
          ok: false,
          error: `subPath "${skill.subPath}" exists but isn't a directory.`,
        };
      }
    } catch {
      return {
        ok: false,
        error: `subPath "${skill.subPath}" not found in ${skill.repoUrl}@${branch}. The repo may have changed structure since this entry was recorded.`,
      };
    }

    // Two install modes:
    //  A) Source ships a SKILL.md → copy as-is (the original "this is
    //     a pre-packaged Claude skill" path).
    //  B) Source doesn't ship SKILL.md but the recommended-skill
    //     entry provides a `generateSkillMd` config → copy the
    //     resources + write a generated SKILL.md wrapper at the
    //     target root. This is how raw-resource repos (DESIGN.md
    //     collections, template libraries) become navigable Claude
    //     skills without forking upstream.
    //  C) Neither → error.
    let sourceHasSkillMd = false;
    try {
      await fs.access(path.join(sourceDir, 'SKILL.md'));
      sourceHasSkillMd = true;
    } catch {
      /* not present — fall back to generation if configured */
    }

    if (!sourceHasSkillMd && !skill.generateSkillMd) {
      return {
        ok: false,
        error:
          'The cloned skill is missing a SKILL.md at its root, and no SKILL.md generator was configured for this entry. INZONE expects every skill folder to start with one.',
      };
    }

    // Copy the source tree into ~/.claude/skills/<installAs>/,
    // preserving any files the user already has. We DO NOT clobber —
    // collisions skip.
    await fs.mkdir(targetDir, { recursive: true });
    await copyRecursivePreserving(sourceDir, targetDir);

    // Generate the SKILL.md wrapper if needed. Done AFTER the copy
    // so that if the user already has a SKILL.md in the target
    // (manual customisation), copyRecursivePreserving has already
    // kept it and we'd skip writing over it here too.
    if (!sourceHasSkillMd && skill.generateSkillMd) {
      const skillMdPath = path.join(targetDir, 'SKILL.md');
      try {
        await fs.access(skillMdPath);
        // user already has one — leave it alone
      } catch {
        const name =
          skill.generateSkillMd.name ?? skill.installAs ?? skill.id;
        const description =
          skill.generateSkillMd.description ?? skill.description;
        const content =
          buildGeneratedSkillMd(name, description, skill.generateSkillMd.body);
        await fs.writeFile(skillMdPath, content, 'utf8');
      }
    }

    return { ok: true, alreadyInstalled: false, installedAt: targetDir };
  } finally {
    // Best-effort cleanup of the temp clone.
    try {
      await fs.rm(tempRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Recursive copy that never overwrites existing files. Mirrors the
 *  approach in `bundled-resources.ts` so user customisations of any
 *  file are always preserved. */
async function copyRecursivePreserving(
  src: string,
  dst: string,
): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === '.DS_Store') continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyRecursivePreserving(srcPath, dstPath);
    } else if (entry.isFile()) {
      try {
        await fs.access(dstPath);
        // exists — skip
      } catch {
        await fs.copyFile(srcPath, dstPath);
      }
    }
  }
}

/**
 * Build the SKILL.md content for raw-resource repos that don't ship
 * one. Frontmatter follows the Claude Code skill format that the
 * SDK reads — `name` and `description` are the two fields surfaced
 * to other agents at skill-list time.
 *
 * The description goes through `escapeYamlScalar` because skill
 * descriptions tend to contain colons and commas that YAML would
 * otherwise interpret as structure rather than text.
 */
function buildGeneratedSkillMd(
  name: string,
  description: string,
  body: string,
): string {
  return [
    '---',
    `name: ${name}`,
    `description: ${escapeYamlScalar(description)}`,
    '---',
    '',
    body.endsWith('\n') ? body : body + '\n',
  ].join('\n');
}

/** Quote-and-escape a scalar so YAML always parses it as a single
 *  string, even when it contains colons, commas, special characters,
 *  or starts with reserved chars. Single quotes are used (YAML
 *  doesn't interpret escapes in single-quoted scalars, except `''`
 *  for a literal single quote). */
function escapeYamlScalar(value: string): string {
  // Replace any embedded single quote with the YAML-escaped form (''),
  // collapse newlines to spaces (descriptions should be one line),
  // and wrap.
  const safe = value.replace(/\r?\n/g, ' ').replace(/'/g, "''");
  return `'${safe}'`;
}

/** Tiny git runner. Spawns + collects stdout/stderr; rejects on
 *  non-zero exit. Used for `--version` probe and `clone`. */
function runGit(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn('git', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    proc.stdout?.on('data', (b: Buffer) => (stdout += b.toString('utf8')));
    proc.stderr?.on('data', (b: Buffer) => (stderr += b.toString('utf8')));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else
        reject(
          new Error(
            stderr.trim() || `git ${args[0]} failed with code ${code}`,
          ),
        );
    });
  });
}
