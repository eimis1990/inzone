/**
 * Worker preset icons (renderer-side).
 *
 * The preset *data* (id, name, description, command) lives in
 * `@shared/worker-presets` so main and renderer agree on what each
 * preset means. This file owns just the visual side: a tiny stroke
 * icon set the cards render next to each preset name. We re-export
 * the data so existing imports from `./worker-presets` keep working.
 */

import {
  WORKER_PRESETS,
  type WorkerPreset,
  type WorkerPresetId,
} from '@shared/worker-presets';

export { WORKER_PRESETS };
export type { WorkerPreset, WorkerPresetId };

export type WorkerPresetIconName = WorkerPresetId;

/**
 * Asset-override map. Vite scans `assets/worker-icons/*.{png,svg,jpg}`
 * at build time; any file whose basename matches a preset id (e.g.
 * `claude-code.png`) wins over the inline SVG fallback below. This
 * lets users drop the actual brand logos in without code changes —
 * the SVG approximations stay around for presets that don't have
 * a custom file yet.
 */
const iconAssets = import.meta.glob<{ default: string }>(
  '../assets/worker-icons/*.{png,svg,jpg,jpeg,webp}',
  { eager: true },
);

function findIconAsset(id: string): string | undefined {
  for (const [path, mod] of Object.entries(iconAssets)) {
    const fileName = path.split('/').pop() ?? '';
    const stem = fileName.replace(/\.(png|svg|jpe?g|webp)$/i, '');
    if (stem === id) return mod.default;
  }
  return undefined;
}

/**
 * Tiny stroke-style icon set for the preset cards. Distinct from
 * the agent emoji glyph treatment so users can tell at a glance
 * that these are *not* agents — they're tools.
 */
export function WorkerPresetIcon({
  icon,
  size = 18,
}: {
  icon: WorkerPresetIconName;
  size?: number;
}) {
  // Custom asset wins if one was dropped under assets/worker-icons.
  // We render an <img> at the requested size; object-fit:contain
  // keeps non-square logos from stretching.
  const assetUrl = findIconAsset(icon);
  if (assetUrl) {
    return (
      <img
        src={assetUrl}
        width={size}
        height={size}
        alt=""
        aria-hidden
        style={{
          width: size,
          height: size,
          objectFit: 'contain',
          display: 'block',
        }}
      />
    );
  }
  switch (icon) {
    case 'terminal':
      return <TerminalGlyph size={size} />;
    case 'claude-code':
      return <ClaudeGlyph size={size} />;
    case 'codex':
      return <CodexGlyph size={size} />;
    case 'aider':
      return <AiderGlyph size={size} />;
    case 'gemini':
      return <GeminiGlyph size={size} />;
  }
}

function GlyphFrame({
  size,
  children,
}: {
  size: number;
  children: React.ReactNode;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      {children}
    </svg>
  );
}

function TerminalGlyph({ size }: { size: number }) {
  return (
    <GlyphFrame size={size}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <polyline points="7 9 10 12 7 15" />
      <line x1="13" y1="15" x2="17" y2="15" />
    </GlyphFrame>
  );
}

/**
 * Anthropic A — the brand's lettermark, drawn as a solid two-piece
 * shape with the negative-space cutout that gives the wordmark its
 * distinctive look. Filled (not stroked) so it reads as a logo at
 * the small icon size, not as a styled letter.
 */
function ClaudeGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M7.7 4.3 h2.6 l5.7 14.4 h-2.7 l-1.05-2.7 H7 l-1.05 2.7 H3.3 z M9 7.5 l-1.45 4 h2.9 z" />
      <path d="M14.3 4.3 h2.7 l5.7 14.4 h-2.7 z" />
    </svg>
  );
}

/**
 * OpenAI mark — the floral hex motif (six tear-drop petals around a
 * center), reduced to a line drawing that scales cleanly at 18px.
 * Circle + radial spokes capture the silhouette without trying to
 * reproduce every petal's curve.
 */
function CodexGlyph({ size }: { size: number }) {
  return (
    <GlyphFrame size={size}>
      <circle cx="12" cy="12" r="9" />
      <line x1="12" y1="3" x2="12" y2="21" />
      <line x1="4.2" y1="7.5" x2="19.8" y2="16.5" />
      <line x1="4.2" y1="16.5" x2="19.8" y2="7.5" />
    </GlyphFrame>
  );
}

/**
 * Aider — a stylised palette/edit mark. Rounded square representing
 * a code surface with a pencil tip overlaid; close enough to read
 * as "AI editor" while staying distinct from the others.
 */
function AiderGlyph({ size }: { size: number }) {
  return (
    <GlyphFrame size={size}>
      <rect x="3" y="3" width="14" height="14" rx="2" />
      <path d="M14 14 l5 5" />
      <path d="M19 19 l2 -2 -2 -2 -2 2 z" fill="currentColor" stroke="none" />
    </GlyphFrame>
  );
}

/**
 * Gemini's four-pointed star — the canonical mark used across
 * Google's Gemini surfaces. Two narrow lobes intersecting; we draw
 * it as a single filled path so it reads as a logo at small sizes.
 */
function GeminiGlyph({ size }: { size: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden
    >
      <path d="M12 2 C 12 7.5 12 7.5 22 12 C 12 16.5 12 16.5 12 22 C 12 16.5 12 16.5 2 12 C 12 7.5 12 7.5 12 2 Z" />
    </svg>
  );
}
