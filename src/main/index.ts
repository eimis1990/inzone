import { app, BrowserWindow, shell } from 'electron';
import { electronApp, optimizer, is } from '@electron-toolkit/utils';
import path from 'path';
import { fileURLToPath } from 'url';
import { registerIpcHandlers, sessionPool } from './ipc';
import { closeAllTranscripts } from './persistence';
import { closeUsageStream } from './usage';
import { watchDefinitions } from './agents';
import { killAllTerminals } from './terminal';
import { applyStoredApiKey } from './claude-auth';
import { installStarterLibraryIfNeeded } from './bundled-resources';
import { initAutoUpdate } from './auto-update';
import { IPC } from '@shared/ipc-channels';

// ESM replacement for __dirname, needed because we output the main bundle
// as ESM (.mjs) so it can `import()` the ESM-only Agent SDK.
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Keep references to prevent GC.
const windows = new Set<BrowserWindow>();

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'INZONE',
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
      // Enable the <webview> tag for the in-app Preview window. The
      // preview pane is the only thing that uses it; webviews run in
      // their own isolated process so the embedded localhost site
      // can't reach into INZONE state.
      webviewTag: true,
    },
  });

  win.on('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  windows.add(win);
  win.on('closed', () => windows.delete(win));
  return win;
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('app.inzone.desktop');

  // The Claude Agent SDK authenticates either via ANTHROPIC_API_KEY
  // env var or the user's `claude login` subscription credentials.
  // We additionally let the user paste an API key into Settings →
  // Profile, which we encrypt via safeStorage and inject into
  // process.env here BEFORE any sessions start. An existing env var
  // wins (don't surprise power users); the stored key only fills in
  // when the env var is absent.
  await applyStoredApiKey();

  // First-run copy of the bundled starter library into ~/.claude.
  // Idempotent — uses a sentinel file inside ~/.claude/agents so
  // subsequent launches are a near-zero-cost no-op. Never overwrites
  // user-authored agents or skills.
  await installStarterLibraryIfNeeded();
  app.on('browser-window-created', (_e, win) => {
    optimizer.watchWindowShortcuts(win);
  });

  registerIpcHandlers();

  // Watch ~/.claude for agent/skill changes and broadcast a refresh ping
  // to every renderer window.
  watchDefinitions(() => {
    for (const w of windows) {
      if (!w.isDestroyed()) w.webContents.send(IPC.AGENTS_WATCH);
    }
  });

  createMainWindow();

  // Start polling the update feed. No-op in dev; kicks in only for
  // packaged builds. Prompts on download-complete via dialog.
  initAutoUpdate();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async (event) => {
  // Let sessions shut down cleanly and flush transcript streams.
  event.preventDefault();
  try {
    killAllTerminals();
    await sessionPool.stopAll();
    await closeAllTranscripts();
    await closeUsageStream();
  } finally {
    app.exit(0);
  }
});
