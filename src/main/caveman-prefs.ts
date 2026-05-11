/**
 * User-level Caveman-mode preferences (Settings → Experiments).
 *
 * Caveman mode is an opt-in compression layer derived from the
 * upstream `juliusbrussee/caveman` Claude Code skill. When `enabled`
 * is true, `buildCavemanPrompt(level)` returns an instruction block
 * that the session controller prepends to every agent's system prompt
 * — telling the model to drop articles, filler, pleasantries, and
 * hedging from its natural-language output while leaving code, paths,
 * and error messages alone.
 *
 * Persistence model mirrors `editor-prefs.ts`: a dedicated
 * electron-store JSON file so personal preferences survive a wipe of
 * the main app state, plus a merge-on-save so callers can ship
 * partial updates (e.g. flipping `enabled` without re-sending
 * `level`).
 *
 * Two reasons we don't bake this into the existing bundled SKILL.md
 * alone:
 *
 *   1. Per-agent opt-in via the skills frontmatter is still
 *      supported (the SKILL.md is bundled), but most users want a
 *      single global switch — Inzone's value-prop is "drive many
 *      agents at once", so toggling per-agent is friction.
 *
 *   2. Skills are read by agents on-demand based on description
 *      matching. A global compression directive needs to be in the
 *      system prompt from turn 1, before the agent has any chance to
 *      decide whether to load a skill.
 */

import Store from 'electron-store';
import type { CavemanLevel, CavemanSettings } from '@shared/types';

interface CavemanPrefsStoreShape {
  prefs: CavemanSettings;
}

const store = new Store<CavemanPrefsStoreShape>({
  name: 'inzone-caveman',
  defaults: { prefs: { enabled: false, level: 'full' } },
});

/** Read the current settings, with sensible defaults filled in. */
export function getCavemanSettings(): CavemanSettings {
  const prefs = store.get('prefs', {});
  return {
    enabled: prefs.enabled === true,
    level: (prefs.level ?? 'full') as CavemanLevel,
  };
}

/**
 * Merge-in update. Undefined fields preserve the prior value; defined
 * fields overwrite. Matches the editor-prefs save contract so callers
 * can do `save({ enabled: true })` without re-sending the level.
 */
export function saveCavemanSettings(next: CavemanSettings): void {
  const current = store.get('prefs', {});
  const merged: CavemanSettings = {
    enabled:
      next.enabled !== undefined ? !!next.enabled : current.enabled,
    level: next.level !== undefined ? next.level : current.level,
  };
  store.set('prefs', merged);
}

/**
 * Build the system-prompt block that activates caveman at the
 * requested intensity. Returns an empty string when `enabled` is
 * false so callers can unconditionally concat the result.
 *
 * Level → behaviour:
 *
 *   - `lite`        : drop pleasantries + worst filler, keep prose
 *                     readable. Useful when the agent's audience
 *                     includes non-technical readers.
 *
 *   - `full`        : canonical caveman — fragments, dropped
 *                     articles, no hedging. The mode upstream
 *                     measured at ~65–75% token cut.
 *
 *   - `ultra`       : telegraphic — single short fragments, only
 *                     critical nouns + verbs. Maximum English
 *                     compression.
 *
 *   - `wenyan-*`    : classical Chinese (文言) literary compression.
 *                     Information density that English can't match;
 *                     suitable only when the user reads Chinese.
 *                     Three intensity tiers same as English modes.
 *
 * In every level the boundary rules are unchanged: code blocks,
 * shell commands, file paths, identifiers, error messages, and
 * commit / PR text stay normal.
 */
export function buildCavemanPrompt(settings: CavemanSettings): string {
  if (!settings.enabled) return '';
  const level: CavemanLevel = settings.level ?? 'full';

  const intensity = LEVEL_INSTRUCTIONS[level];

  return [
    '## Caveman mode — token compression directive',
    '',
    'Inzone has Caveman mode enabled globally. **Compress your natural-language output** following the rules below. This applies to every assistant text block you produce in this session.',
    '',
    `**Active intensity: \`${level}\`**`,
    '',
    intensity,
    '',
    '### Boundary rules (apply at every intensity)',
    '',
    '- **Code blocks stay normal.** Variable names, comments, and language syntax are untouched.',
    '- **File paths, identifiers, URLs, error messages, and shell commands stay verbatim.** Compression is for prose only.',
    '- **Commit messages, PR titles / bodies, and any text destined for git or GitHub stay normal English.**',
    '- **Tool inputs (Bash, Read, Edit, MCP calls) are unaffected** — caveman is a presentation layer, not a behaviour change. Plan and reason however you normally would; only the final text you show the user is compressed.',
    '- **If the user says "stop caveman" or "normal mode", revert immediately** for the rest of the turn and inform them in normal English that the global toggle in Settings → Experiments controls this for future sessions.',
    '',
    'See `~/.claude/skills/caveman/SKILL.md` for the full reference — same skill bundled with Inzone, sourced from [JuliusBrussee/caveman](https://github.com/JuliusBrussee/caveman).',
  ].join('\n');
}

/**
 * Per-level prose instructions injected into the directive block.
 * Each is self-contained so the model doesn't need to consult the
 * bundled SKILL.md to act on the right intensity — the skill is the
 * canonical reference, but the system prompt always carries enough
 * to start compressing on turn 1.
 */
const LEVEL_INSTRUCTIONS: Record<CavemanLevel, string> = {
  lite: [
    '### lite — gentle compression',
    '',
    'Drop pleasantries ("sure", "of course", "happy to") and worst filler ("just", "really", "basically", "actually"). Keep full sentences and articles where they aid readability. Avoid hedging ("it might be worth considering", "you could try"). Be direct.',
  ].join('\n'),
  full: [
    '### full — canonical caveman',
    '',
    'Speak like a smart caveman. Cut articles (a/an/the), filler, pleasantries, and hedging. Fragments are fine. Short synonyms ("fix", not "implement a solution for"). Technical terms stay exact ("polymorphism" stays "polymorphism").',
    '',
    'Pattern: `[thing] [action] [reason]. [next step].`',
    '',
    'Example — NOT: "Sure! I\'d be happy to help. The reason your component is re-rendering is likely because you\'re creating a new object reference each render cycle..."',
    '',
    'YES: "New object ref each render. Wrap in `useMemo`."',
  ].join('\n'),
  ultra: [
    '### ultra — maximum English compression',
    '',
    'Telegraphic. Only critical nouns + verbs. No articles, no filler, no transitions. One short fragment per idea. No more than ~6 words per sentence-equivalent.',
    '',
    'Example: "Token expiry uses `<` not `<=`. Fix line 42."',
    '',
    'When unsure, cut more.',
  ].join('\n'),
  'wenyan-lite': [
    '### wenyan-lite — classical Chinese, light',
    '',
    '使用文言文表达，但保留主要语气助词与连词。Drop English filler; render explanations in 文言 prose. Suitable for readers fluent in classical Chinese who want density without losing rhythm.',
    '',
    'Code, paths, and identifiers stay as-is (typically Latin script).',
  ].join('\n'),
  'wenyan-full': [
    '### wenyan-full — classical Chinese, canonical',
    '',
    '以正统文言文回答，简练凝练，无虚词。Compress to classical Chinese literary register. Drop modern Mandarin connectors. Use 之、其、而、矣、也 sparingly only when grammatically required.',
    '',
    'Code, paths, and identifiers stay as-is.',
  ].join('\n'),
  'wenyan-ultra': [
    '### wenyan-ultra — maximum literary compression',
    '',
    '极简文言：四字、六字成句。Aim for four- or six-character classical lines. Maximum density; closer to 古籍 register than modern technical writing. Use only when the user has explicitly asked for the most compressed Chinese form.',
    '',
    'Code, paths, and identifiers stay as-is.',
  ].join('\n'),
};
