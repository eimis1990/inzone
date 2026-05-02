/**
 * Completion / error sounds for pane status transitions.
 *
 * The success chime now plays a bundled mp3 (assets/completion-effect.mp3)
 * — Vite resolves the import to a hashed URL at build time, so the file
 * ships with the renderer bundle and doesn't need network access. The
 * error tone is still a Web Audio synth — it's short, distinct, and
 * doesn't justify a second asset round-trip.
 *
 * primeAudio() exists because some browser audio contexts won't actually
 * play until they've seen a user gesture. We call it from the
 * sound-toggle button click in the workspace bar, which both flips the
 * `soundEnabled` flag and unlocks playback for the rest of the session.
 */

import successUrl from './assets/completion-effect.mp3';

let ctx: AudioContext | null = null;
// Cache one decoded buffer of the success sound so subsequent plays are
// instantaneous (no fetch, no decode). The first play hydrates the
// promise; later plays await the same one.
let successBufferPromise: Promise<AudioBuffer | null> | null = null;

function ensureCtx(): AudioContext | null {
  if (ctx) return ctx;
  try {
    ctx = new (window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext)();
    return ctx;
  } catch {
    return null;
  }
}

async function loadSuccessBuffer(
  audio: AudioContext,
): Promise<AudioBuffer | null> {
  if (!successBufferPromise) {
    successBufferPromise = (async () => {
      try {
        const res = await fetch(successUrl);
        const bytes = await res.arrayBuffer();
        return await audio.decodeAudioData(bytes);
      } catch {
        return null;
      }
    })();
  }
  return successBufferPromise;
}

function playTone(
  freqs: number[],
  opts: { duration?: number; peak?: number; attack?: number } = {},
): void {
  const audio = ensureCtx();
  if (!audio) return;
  const duration = opts.duration ?? 0.8;
  const peak = opts.peak ?? 0.1;
  const attack = opts.attack ?? 0.015;
  const now = audio.currentTime;

  const master = audio.createGain();
  master.gain.setValueAtTime(0, now);
  master.gain.linearRampToValueAtTime(peak, now + attack);
  master.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  master.connect(audio.destination);

  for (const f of freqs) {
    const osc = audio.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = f;
    osc.connect(master);
    osc.start(now);
    osc.stop(now + duration + 0.05);
  }
}

/** Pleasant chime for successful task completion. */
export function playSuccessChime(): void {
  const audio = ensureCtx();
  if (!audio) return;
  void (async () => {
    const buffer = await loadSuccessBuffer(audio);
    if (!buffer) return;
    // Trim peaks slightly so the chime sits just below "loud" — the old
    // synth tone landed around 0.09–0.10 master gain; this matches.
    const gain = audio.createGain();
    gain.gain.value = 0.7;
    gain.connect(audio.destination);
    const src = audio.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    src.start();
  })();
}

/** Lower, darker tone for errors / aborts. */
export function playErrorTone(): void {
  // A4 + F4 — minor second-ish, deliberately a bit unresolved.
  playTone([349.23, 440], { duration: 0.55, peak: 0.08, attack: 0.02 });
}

/**
 * Audio contexts often need a user gesture before they'll play.
 * Call this once from a click/keydown handler to unlock playback —
 * we also kick off the mp3 fetch+decode here so the first chime
 * after toggling sound on is instant.
 */
export function primeAudio(): void {
  const audio = ensureCtx();
  if (!audio) return;
  if (audio.state === 'suspended') {
    void audio.resume();
  }
  // Warm the buffer cache so the first playSuccessChime() doesn't
  // pay decode latency. Fire-and-forget; loadSuccessBuffer caches.
  void loadSuccessBuffer(audio);
}
