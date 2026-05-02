/**
 * Voice agent settings + signed-URL minting.
 *
 * Storage: a tiny electron-store JSON file holds the user's ElevenLabs
 * API key and Agent ID. Both stay local — the API key only ever travels
 * over the wire to ElevenLabs's REST endpoint when minting a signed URL
 * at session start.
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

import Store from 'electron-store';
import type { VoiceSettings } from '@shared/types';

interface VoiceStoreShape {
  voice: VoiceSettings;
}

const store = new Store<VoiceStoreShape>({
  name: 'inzone-voice',
  defaults: { voice: {} },
});

export function getVoiceSettings(): VoiceSettings {
  return store.get('voice', {});
}

export function saveVoiceSettings(next: VoiceSettings): void {
  const current = store.get('voice', {});
  const merged: VoiceSettings = {
    apiKey:
      next.apiKey !== undefined ? next.apiKey || undefined : current.apiKey,
    agentId:
      next.agentId !== undefined ? next.agentId || undefined : current.agentId,
  };
  store.set('voice', merged);
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
