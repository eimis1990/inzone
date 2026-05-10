/**
 * Voice agent settings + signed-URL minting.
 *
 * Storage strategy — security-tiered:
 *
 *   - The ElevenLabs **agent ID** is a public identifier (looks like a
 *     UUID, embedded in the public ElevenLabs dashboard URL) and lives
 *     in a plain electron-store JSON file. No reason to encrypt it.
 *
 *   - The ElevenLabs **API key** is a secret. It's encrypted through
 *     Electron's `safeStorage` API and written to its own file under
 *     userData. `safeStorage` delegates to the OS keychain on macOS
 *     (Keychain), Windows (DPAPI), and Linux (kwallet/gnome-libsecret),
 *     so the encrypted blob can't be decrypted on a different machine
 *     or by a different user account on the same machine.
 *
 * Migration: the previous version stored both fields in the plain
 * electron-store JSON. The first call to `getVoiceSettings()` after
 * upgrading detects a plaintext apiKey, re-encrypts it via safeStorage,
 * and clears it from the JSON file in the same atomic write.
 *
 * Auth modes (we support both):
 *   - public agent  → pass `agentId` directly to the SDK; no API key needed.
 *   - private agent → fetch a signed URL via REST using `apiKey + agentId`,
 *                     then hand that URL to the SDK.
 *
 * The renderer asks for whichever mode is appropriate via the
 * `voice:getStartCreds` IPC; we return either an `{ agentId }` object
 * for public agents or `{ signedUrl }` for private ones.
 */

import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import path from 'path';
import Store from 'electron-store';
import type { VoiceSettings } from '@shared/types';

/** What the on-disk JSON holds. We keep `apiKey?: string` in the type
 *  for migration purposes — newly written files never set it. */
interface VoiceStoreShape {
  voice: VoiceSettings;
}

const store = new Store<VoiceStoreShape>({
  name: 'inzone-voice',
  defaults: { voice: {} },
});

const API_KEY_FILENAME = 'elevenlabs-api-key.enc';

function apiKeyPath(): string {
  return path.join(app.getPath('userData'), API_KEY_FILENAME);
}

/** Read the encrypted API key. Returns null if none exists, the file
 *  is corrupt, or decryption fails (encryption key rotated). Never
 *  throws — callers treat any failure as "no stored key". */
function readStoredApiKey(): string | null {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const file = apiKeyPath();
    if (!existsSync(file)) return null;
    const buf = readFileSync(file);
    const decoded = safeStorage.decryptString(buf);
    const trimmed = decoded.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** Encrypt + persist. Empty string deletes the file. */
async function writeStoredApiKey(key: string): Promise<void> {
  const file = apiKeyPath();
  const trimmed = key.trim();
  if (trimmed.length === 0) {
    try {
      await fs.unlink(file);
    } catch {
      // already gone — fine
    }
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS keychain unavailable — cannot store the ElevenLabs API key safely.',
    );
  }
  const enc = safeStorage.encryptString(trimmed);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // chmod 0600 — even though the bytes are encrypted, leaking the
  // file to other users on a multi-user machine is needless surface.
  await fs.writeFile(file, enc, { mode: 0o600 });
}

/** One-shot migration: if the legacy plaintext apiKey is still in the
 *  electron-store JSON, copy it into the encrypted file and clear the
 *  field. Idempotent — safe to call on every boot. */
function migrateLegacyApiKeyIfNeeded(): void {
  const v = store.get('voice', {});
  // legacy field is typed as VoiceSettings.apiKey — non-empty means
  // we're upgrading from a pre-encryption build.
  if (!v.apiKey || v.apiKey.trim().length === 0) return;

  try {
    if (!safeStorage.isEncryptionAvailable()) {
      // Keyring not ready at boot (rare). Leave plaintext as a
      // fallback so voice keeps working; next boot or next save
      // will move it.
      return;
    }
    const enc = safeStorage.encryptString(v.apiKey.trim());
    const file = apiKeyPath();
    // Use static sync imports — `require('fs')` is undefined in this
    // ESM main process, and the old code's require call was throwing
    // silently inside two nested try-catches, leaving every upgrader
    // with their plaintext key still in the JSON store. Fixed in
    // v1.10.2.
    try {
      mkdirSync(path.dirname(file), { recursive: true });
    } catch {
      // dir already exists — fine
    }
    writeFileSync(file, enc, { mode: 0o600 });
    // ONLY strip plaintext after the encrypted file is on disk.
    store.set('voice', { ...v, apiKey: undefined });
  } catch (err) {
    // Migration failed (file system permissions, keychain hiccup,
    // etc.). Keep plaintext in store as fallback — voice keeps
    // working off the plaintext path via getVoiceSettings(). Log
    // for diagnostics.
    // eslint-disable-next-line no-console
    console.warn('[voice] legacy apiKey migration failed:', err);
  }
}

// Run the migration once at module load. Safe + cheap.
migrateLegacyApiKeyIfNeeded();

export function getVoiceSettings(): VoiceSettings {
  const stored = store.get('voice', {});
  // The on-disk JSON may still hold a stale apiKey if migration
  // failed (e.g. keychain temporarily unavailable). We prefer the
  // encrypted version when it exists.
  const apiKey = readStoredApiKey() ?? stored.apiKey ?? undefined;
  return {
    apiKey,
    agentId: stored.agentId,
  };
}

export async function saveVoiceSettings(next: VoiceSettings): Promise<void> {
  const current = store.get('voice', {});

  // 1) Handle the API key FIRST so a half-completed save can't
  //    wipe the plaintext fallback while the encrypted write is
  //    still pending. `undefined` means "leave the current key
  //    alone"; empty string means "explicitly clear it".
  let apiKeyWasWritten = false;
  if (next.apiKey !== undefined) {
    await writeStoredApiKey(next.apiKey);
    apiKeyWasWritten = true;
  }

  // 2) Build the next JSON-stored shape. Agent ID lives here as
  //    plaintext (public identifier). API key is encrypted on disk,
  //    NOT here — UNLESS migration hasn't run yet and we don't
  //    want to clobber the user's only copy of their key.
  const agentId =
    next.agentId !== undefined ? next.agentId || undefined : current.agentId;
  const nextStore: VoiceSettings = { agentId };
  if (!apiKeyWasWritten && current.apiKey) {
    // We didn't update the key in this save, and there's a legacy
    // plaintext value in the store. Preserve it — clobbering it
    // here would leave the user with no key at all if the boot-time
    // migration also failed (e.g. keychain unavailable). The next
    // successful write OR the next migration run will move it.
    nextStore.apiKey = current.apiKey;
  }
  store.set('voice', nextStore);
}

/**
 * Resolve the credential the renderer should hand to @elevenlabs/react.
 * Public-agent path (no apiKey) returns `{ agentId }` directly. Private
 * path mints a signed URL via ElevenLabs REST and returns `{ signedUrl }`.
 */
export async function resolveVoiceStartCreds(): Promise<
  | { ok: true; agentId: string }
  | { ok: true; signedUrl: string }
  | { ok: false; error: string }
> {
  const { apiKey, agentId } = getVoiceSettings();
  if (!agentId) {
    return {
      ok: false,
      error:
        'Voice agent is not configured — open Settings → Voice and paste your ElevenLabs Agent ID first.',
    };
  }
  if (!apiKey) {
    // Public agent: no auth.
    return { ok: true, agentId };
  }
  // Private agent: mint a signed URL with the API key. We do this in the
  // main process so the renderer never sees the raw key over the wire.
  try {
    const url = `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`;
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'xi-api-key': apiKey },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return {
        ok: false,
        error: `ElevenLabs returned ${res.status}: ${body || res.statusText}`,
      };
    }
    const json = (await res.json()) as { signed_url?: string };
    if (!json.signed_url) {
      return { ok: false, error: 'ElevenLabs response missing signed_url.' };
    }
    return { ok: true, signedUrl: json.signed_url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
