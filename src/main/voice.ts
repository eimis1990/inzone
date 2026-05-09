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
import { existsSync, readFileSync } from 'fs';
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
  if (v.apiKey && v.apiKey.trim().length > 0) {
    try {
      // Sync write path is fine: this runs once on boot. We don't
      // await fs.writeFile because the existing API is sync; small
      // tradeoff for boot simplicity.
      if (safeStorage.isEncryptionAvailable()) {
        const enc = safeStorage.encryptString(v.apiKey.trim());
        const file = apiKeyPath();
        // Make sure the dir exists.
        try {
          require('fs').mkdirSync(path.dirname(file), { recursive: true });
        } catch {
          // ignore
        }
        require('fs').writeFileSync(file, enc, { mode: 0o600 });
        // Strip the plaintext from the JSON.
        store.set('voice', { ...v, apiKey: undefined });
      }
    } catch {
      // If migration fails the user's voice setup keeps working off
      // the legacy plaintext until they re-save in Settings — which
      // will go through the encrypted path.
    }
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

export function saveVoiceSettings(next: VoiceSettings): void {
  const current = store.get('voice', {});
  // Agent ID — plain JSON.
  const agentId =
    next.agentId !== undefined ? next.agentId || undefined : current.agentId;
  store.set('voice', { agentId });
  // API key — encrypted. `undefined` means "don't change". Empty
  // string means "clear".
  if (next.apiKey !== undefined) {
    void writeStoredApiKey(next.apiKey);
  }
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
