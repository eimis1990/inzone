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
  // Two install methods today: git-clone (the original) and
  // printing-press (shells out to the Press CLI which handles
  // binary + SKILL.md install for us). Branch on `skill.via` —
  // older entries that don't set it implicitly mean 'git'.
  if (skill.via === 'printing-press') {
    return installViaPrintingPress(skill);
  }
  return installViaGitClone(skill);
}

async function installViaGitClone(
  skill: RecommendedSkill,
): Promise<InstallSkillResult> {
  if (!skill.repoUrl) {
    return {
      ok: false,
      error:
        'This recommended skill is configured for git install but has no repoUrl set. Report this — it shouldn\'t happen.',
    };
  }
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

/**
 * Install path for `skill.via === 'printing-press'`.
 *
 * The Printing Press CLI handles everything for us: given
 * `printing-press install <name>` it downloads the Go binary,
 * sets up the local SQLite store (if any), and drops the
 * matching SKILL.md into `~/.claude/skills/pp-<name>/`. We just
 * shell out, wait for exit, and validate the SKILL.md landed.
 *
 * We invoke through `npx -y @mvanhorn/printing-press` rather
 * than expecting a global install, because (a) we don't want
 * to require the user to do a separate global install step,
 * and (b) npx with `-y` caches across runs so the second call
 * is fast anyway.
 *
 * Already-installed early-out mirrors the git path: if the
 * target skill folder already has a SKILL.md, return success
 * without re-shelling out to Press.
 */
async function installViaPrintingPress(
  skill: RecommendedSkill,
): Promise<InstallSkillResult> {
  const pressName = skill.printingPressName;
  if (!pressName) {
    return {
      ok: false,
      error:
        'This recommended skill is configured for printing-press install but has no printingPressName set. Report this — it shouldn\'t happen.',
    };
  }
  // Printing Press installs into ~/.claude/skills/pp-<name>/ by
  // convention. We honour any installAs override the entry sets,
  // but the default mirrors what the Press CLI itself writes.
  const installAs = skill.installAs ?? `pp-${pressName}`;
  const targetDir = path.join(HOME_SKILLS_DIR, installAs);

  try {
    await fs.access(path.join(targetDir, 'SKILL.md'));
    return { ok: true, alreadyInstalled: true, installedAt: targetDir };
  } catch {
    /* not installed — proceed */
  }

  // Printing Press needs Node.js (we shell out via npx). Check up
  // front so we can surface a clean error rather than letting npx
  // ENOENT bubble through.
  try {
    await runProcess('node', ['--version']);
  } catch {
    return {
      ok: false,
      error:
        'Node.js is not installed (or not on your PATH). The Printing Press library installs through `npx`, which ships with Node. Install Node 18+ and try again.',
    };
  }

  // Shell out: `npx -y @mvanhorn/printing-press install <name>`.
  // The -y flag silences npx's "install this package?" prompt;
  // without it the command would hang waiting for input we can't
  // provide from a non-interactive child process.
  try {
    await runProcess('npx', [
      '-y',
      '@mvanhorn/printing-press',
      'install',
      pressName,
    ]);
  } catch (err) {
    return {
      ok: false,
      error:
        `Printing Press install failed for "${pressName}". ` +
        (err instanceof Error ? err.message : String(err)),
    };
  }

  // Verify the SKILL.md the Press CLI was supposed to write
  // actually landed where we expect. If not, the install
  // technically succeeded (exit 0) but didn't produce the skill
  // — surface that as a partial-success error so the card
  // doesn't flip to "Installed" misleadingly.
  try {
    await fs.access(path.join(targetDir, 'SKILL.md'));
  } catch {
    return {
      ok: false,
      error:
        `Printing Press finished but didn't produce a SKILL.md at ` +
        `${targetDir}. The CLI may have installed the binary only — ` +
        `try running \`printing-press install ${pressName}\` manually to diagnose.`,
    };
  }

  return { ok: true, alreadyInstalled: false, installedAt: targetDir };
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
  return runProcess('git', args);
}

/**
 * Generic process runner used for both `git` and `npx -y …` calls
 * from this module. Collects stdout/stderr, rejects on non-zero
 * exit with the trimmed stderr (or a fallback "<cmd> exited <code>"
 * message). Uses inherited PATH so we honour the user's shell
 * profile — important because Node.js on macOS often lives at a
 * path like /opt/homebrew/bin that Electron's process.env.PATH
 * doesn't always include by default.
 */
function runProcess(
  cmd: string,
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    // Augment PATH with the usual Node.js / Homebrew / Go locations
    // so we find `npx` / `git` / Press-installed binaries even when
    // Electron's environment is stripped to a minimal /usr/bin:/bin
    // (which happens when launched outside a login shell).
    //
    // `$HOME/go/bin` specifically matters for Printing Press
    // installs: Press downloads the Go binary into ~/go/bin (which
    // is `go env GOPATH/bin` for Homebrew Go's default settings),
    // then verifies it can invoke the binary as a final step. If
    // ~/go/bin isn't on the PATH we hand to the npx child process,
    // that final check fails with "binary was installed but isn't
    // on PATH". The user's own shell needs ~/go/bin too for terminal
    // pane invocations to work, but that's their dotfile to edit;
    // here we just make our own spawn succeed.
    const pathAugment = [
      process.env.PATH ?? '',
      '/opt/homebrew/bin',
      '/usr/local/bin',
      `${process.env.HOME ?? ''}/.npm/bin`,
      `${process.env.HOME ?? ''}/.local/bin`,
      `${process.env.HOME ?? ''}/go/bin`,
    ]
      .filter(Boolean)
      .join(':');
    const proc = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: pathAugment },
    });
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
            stderr.trim() || `${cmd} ${args[0]} exited with code ${code}`,
          ),
        );
    });
  });
}
