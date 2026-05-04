/**
 * Auto-update wiring via electron-updater.
 *
 * INZONE ships as a notarized direct-download DMG/zip from
 * updates.inzone.app — not the Mac App Store. electron-updater
 * polls that feed for `latest-mac.yml`, downloads the matching
 * .zip, and applies the update on next launch (or restart now if
 * the user opts in).
 *
 * Behaviour:
 *  - Idle in dev (`!app.isPackaged`) so we don't hit the feed
 *    while iterating locally.
 *  - On boot: check once, then every 30 minutes.
 *  - On finding an update: download silently, surface a
 *    "Restart to update" prompt via dialog when ready.
 *  - On error: log and try again on the next tick. Update
 *    failures are non-fatal — the app keeps working.
 *
 * The publish feed URL is configured in package.json's
 * `build.publish.url`. To switch hosts, change it there and run
 * `pnpm release` to publish a new build with the matching channel
 * metadata.
 */

import { app, dialog, BrowserWindow } from 'electron';
// electron-updater is a CJS module, but our main bundle emits as
// ESM (so it can import the ESM-only Claude Agent SDK). Node's
// ESM loader only reliably exposes the default export of CJS
// modules — named imports fail at runtime even when TypeScript is
// happy at compile time. Use the destructure-from-default pattern
// so this works in the packaged build.
import electronUpdater from 'electron-updater';
const { autoUpdater } = electronUpdater;

let started = false;

// Guard so the "Update ready · Restart now / Later" dialog only fires
// once per downloaded version. Without this, the 30-minute re-check
// can re-emit `update-downloaded` for a version that was already
// downloaded but the user dismissed with Later — and the dialog
// re-fires, sometimes more than once if the user dismisses again.
// Reset whenever a NEW version becomes available so genuine future
// updates still prompt.
let promptedVersion: string | null = null;

export function initAutoUpdate(): void {
  if (started) return;
  started = true;

  // Skip in dev — `app.isPackaged` is false and the updater would
  // try to read a non-existent app-update.yml from a dev path.
  if (!app.isPackaged) {
    autoUpdater.logger = {
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
      debug: () => undefined,
    } as unknown as typeof console;
    console.log('[auto-update] dev mode — auto-update disabled');
    return;
  }

  // Don't auto-download yet — let the user know an update is
  // waiting, then download in the background. Avoids surprise
  // "downloading 80MB" spinners when they didn't ask.
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[auto-update] checking…');
  });
  autoUpdater.on('update-available', (info) => {
    console.log('[auto-update] update available:', info.version);
    // A newer version became available — clear the prompt guard so
    // the dialog can fire again for this new version. (Without this,
    // a user who said "Later" to v1.0.5 would never see the prompt
    // for v1.0.6.)
    if (promptedVersion !== info.version) promptedVersion = null;
  });
  autoUpdater.on('update-not-available', () => {
    console.log('[auto-update] up to date');
  });
  autoUpdater.on('error', (err) => {
    console.warn('[auto-update] error:', err?.message ?? err);
  });
  autoUpdater.on('download-progress', (p) => {
    console.log(
      `[auto-update] downloading ${Math.round(p.percent)}% (${
        p.transferred
      }/${p.total} bytes)`,
    );
  });
  autoUpdater.on('update-downloaded', async (info) => {
    console.log('[auto-update] downloaded:', info.version);

    // Don't re-prompt for a version we've already shown the dialog
    // for this session. The user dismissed (or accepted) once; if
    // they accepted but the install failed, surface that on the next
    // launch instead of nagging. autoInstallOnAppQuit will retry on
    // its own when the app actually closes cleanly.
    if (promptedVersion === info.version) {
      console.log(
        '[auto-update] dialog already shown for',
        info.version,
        '— skipping repeat prompt',
      );
      return;
    }
    promptedVersion = info.version;

    const win = BrowserWindow.getAllWindows()[0];
    const result = await dialog.showMessageBox(win, {
      type: 'info',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
      cancelId: 1,
      title: 'Update ready',
      message: `INZONE ${info.version} is ready to install.`,
      detail:
        'Restart now to apply, or keep working — the update will be applied automatically on next launch.',
    });
    if (result.response === 0) {
      try {
        // (isSilent=false, isForceRunAfter=true) — relaunch the new
        // version after install completes. Wrapped in try/catch so a
        // failure here doesn't leave the app in a half-quit state;
        // we surface the error so the user can fall back to manual
        // re-download.
        autoUpdater.quitAndInstall(false, true);
      } catch (err) {
        console.error('[auto-update] quitAndInstall failed:', err);
        await dialog.showMessageBox(win, {
          type: 'error',
          buttons: ['OK'],
          title: 'Update install failed',
          message: 'INZONE could not apply the update automatically.',
          detail:
            'Please quit INZONE and re-download the latest version from inzone-theta.vercel.app, or try again from a clean launch.',
        });
      }
    }
  });

  // Initial check after a short delay so we're not racing the
  // first window's render.
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch(() => {
      /* logged via the 'error' handler above */
    });
  }, 5000);

  // Re-check every 30 minutes for long-running sessions.
  setInterval(
    () => {
      void autoUpdater.checkForUpdates().catch(() => {
        /* swallow */
      });
    },
    30 * 60 * 1000,
  );
}
