/**
 * Reload-on-save watcher for the inline browser preview.
 *
 * When the user enables the "auto-reload" toggle in the preview
 * toolbar, the renderer fires `preview:watch:start` with the
 * project cwd. We open a chokidar watcher under that folder,
 * limited to source-file extensions (html / js / ts / css / etc.),
 * and ping `preview:fileChanged` back to every window on each
 * settled change.
 *
 * One watcher at a time — `preview:watch:stop` disposes the
 * current one before any new start. The PreviewPane only ever
 * mounts a single instance app-wide (the right card of the
 * pane/preview swap) so this single-watcher model matches the
 * UX one-to-one.
 *
 * Debounce: chokidar's own coalescing handles most editor "save
 * twice in 50ms" scenarios. We don't add a JS-side debounce on
 * top so the user-perceived latency stays low.
 */

import chokidar, { type FSWatcher } from 'chokidar';
import { BrowserWindow } from 'electron';
import path from 'path';
import { IPC } from '../shared/ipc-channels';

const SOURCE_GLOBS = [
  '**/*.html',
  '**/*.htm',
  '**/*.css',
  '**/*.scss',
  '**/*.sass',
  '**/*.less',
  '**/*.js',
  '**/*.jsx',
  '**/*.ts',
  '**/*.tsx',
  '**/*.mjs',
  '**/*.cjs',
  '**/*.vue',
  '**/*.svelte',
  '**/*.astro',
];

/** Folders to ignore — heavy + irrelevant for preview reload. */
const IGNORED = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/.nuxt/**',
  '**/.svelte-kit/**',
  '**/.turbo/**',
  '**/.cache/**',
  '**/coverage/**',
  '**/.parcel-cache/**',
  // Inzone's own state folder under the project root.
  '**/.inzone/**',
];

let watcher: FSWatcher | null = null;
let watchedCwd: string | null = null;

function broadcastFileChanged(filePath: string): void {
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send(IPC.PREVIEW_FILE_CHANGED, { filePath });
    } catch {
      /* window tearing down — fine */
    }
  }
}

export async function startPreviewWatch(args: {
  cwd: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const { cwd } = args;
  if (!cwd) {
    return { ok: false, error: 'cwd is required' };
  }
  // Reuse the watcher if we're already on the same folder — no
  // sense tearing down and recreating chokidar's inode tracking.
  if (watcher && watchedCwd === cwd) return { ok: true };
  await stopPreviewWatch();
  try {
    const w = chokidar.watch(SOURCE_GLOBS, {
      cwd,
      ignored: IGNORED,
      ignoreInitial: true,
      // chokidar's polling is heavy on big repos — stick with
      // native events. macOS uses FSEvents, Linux uses inotify.
      usePolling: false,
      // Wait for the file to stop being written before firing.
      // Avoids triple-firing on "save in editor" sequences.
      awaitWriteFinish: {
        stabilityThreshold: 80,
        pollInterval: 40,
      },
    });
    w.on('change', (p) => broadcastFileChanged(path.join(cwd, p)));
    w.on('add', (p) => broadcastFileChanged(path.join(cwd, p)));
    w.on('error', (err) => {
      console.warn('[preview-watcher] error:', err);
    });
    watcher = w;
    watchedCwd = cwd;
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function stopPreviewWatch(): Promise<{ ok: true }> {
  if (!watcher) return { ok: true };
  try {
    await watcher.close();
  } catch {
    /* swallow — closing a dead watcher shouldn't surface as an error */
  }
  watcher = null;
  watchedCwd = null;
  return { ok: true };
}
