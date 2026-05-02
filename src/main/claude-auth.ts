/**
 * Claude auth detector for the Profile section in Settings.
 *
 * The Claude Agent SDK we depend on reads credentials in this order:
 *   1. ANTHROPIC_API_KEY env var (per-workspace API billing)
 *   2. `claude login` subscription credentials (per-account, billed
 *      against the user's Pro/Team/Enterprise plan)
 *
 * We mirror that logic here so the Profile pane can tell the user
 * exactly which path is active. For subscription auth we shell out
 * to `claude auth status` (when the Claude Code CLI is installed)
 * to surface the email + plan; without the CLI we still know auth
 * is working but we can't enumerate details.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';

const execp = promisify(exec);

// Same PATH augmentation we use elsewhere — Electron launched outside
// a login shell doesn't pick up Homebrew/N paths.
const PATH_AUGMENT = [
  process.env.PATH ?? '',
  '/opt/homebrew/bin',
  '/usr/local/bin',
  '/usr/bin',
  '/bin',
]
  .filter(Boolean)
  .join(':');

const CLAUDE_ENV = { ...process.env, PATH: PATH_AUGMENT };

export interface ClaudeAuthInfo {
  /**
   * `'api-key'` when ANTHROPIC_API_KEY is set; `'subscription'` when
   * `claude login` credentials are present; `'none'` when neither
   * looks usable. `'unknown'` is the conservative fallback when the
   * detection itself errored.
   */
  method: 'api-key' | 'subscription' | 'none' | 'unknown';
  /** Email of the logged-in account, when discoverable. */
  email?: string;
  /** Plan tier reported by the CLI ("Free", "Pro", "Max", "Team",
   *  "Enterprise"), when discoverable. */
  plan?: string;
  /** True if the Claude Code CLI itself is on PATH. Drives a hint
   *  that the user can install it for richer Profile details. */
  cliInstalled: boolean;
  /** Raw stdout from `claude auth status` — useful for debugging
   *  when our parser misses a new format. Truncated to ~600 chars. */
  raw?: string;
}

/**
 * Detect the active Claude auth path.
 *
 * Order:
 *   1. If ANTHROPIC_API_KEY is set → 'api-key'.
 *   2. Else, try `claude auth status`. Parse out email + plan.
 *   3. If that fails / CLI missing → assume 'subscription' (the
 *      Agent SDK is presumably working, otherwise INZONE wouldn't
 *      be running turns) but with no details.
 */
export async function getClaudeAuthInfo(): Promise<ClaudeAuthInfo> {
  // 1) API key wins if present — same precedence as the SDK.
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? '').trim();
  if (apiKey) {
    return {
      method: 'api-key',
      cliInstalled: await commandExists('claude'),
    };
  }

  // 2) Subscription path — shell out to claude auth status.
  const cliInstalled = await commandExists('claude');
  if (!cliInstalled) {
    // No CLI to query. We can't confirm subscription auth from here,
    // but the SDK has its own credential cache; report "subscription"
    // optimistically since the most common reason INZONE is running
    // is that auth IS working.
    return { method: 'subscription', cliInstalled: false };
  }

  let raw = '';
  try {
    const { stdout, stderr } = await execp('claude auth status', {
      timeout: 8000,
      env: CLAUDE_ENV,
    });
    raw = ((stdout ?? '') + '\n' + (stderr ?? '')).trim();
  } catch (err) {
    // exec rejects on non-zero exit. claude prints its status to
    // stderr regardless, so still try to read it off the error.
    const e = err as { stdout?: string; stderr?: string };
    raw = ((e.stdout ?? '') + '\n' + (e.stderr ?? '')).trim();
  }

  // Parse email — the CLI uses several wordings across versions:
  //   "Signed in as user@example.com (Pro plan)"
  //   "Logged in to Claude as user@example.com"
  //   "Authenticated as user@example.com"
  const emailMatch =
    raw.match(/(?:signed in|logged in|authenticated)[^\n]*?\s([\w.+-]+@[\w.-]+)/i) ??
    raw.match(/([\w.+-]+@[\w.-]+)/);
  const email = emailMatch?.[1];

  // Parse plan — wording varies but it's often "(Pro plan)",
  // "Plan: Max", or just "Pro"/"Max"/"Team" on its own line.
  const planMatch =
    raw.match(/Plan:\s*([\w/+ -]+)/i) ??
    raw.match(/\(([\w/+ -]+)\s*plan\)/i);
  let plan = planMatch?.[1]?.trim();
  // Clean up "Free plan" → "Free", trim trailing whitespace.
  if (plan) plan = plan.replace(/\s+plan$/i, '').trim();

  // Detect "not authenticated" so we can show a real "Sign in" prompt.
  const notAuthed =
    /not (signed|logged) in/i.test(raw) ||
    /no credentials/i.test(raw) ||
    /please run.*login/i.test(raw);
  if (notAuthed && !email) {
    return {
      method: 'none',
      cliInstalled: true,
      raw: raw.slice(0, 600) || undefined,
    };
  }

  return {
    method: 'subscription',
    email,
    plan,
    cliInstalled: true,
    raw: raw.slice(0, 600) || undefined,
  };
}

async function commandExists(cmd: string): Promise<boolean> {
  try {
    await execp(`command -v ${cmd}`, {
      timeout: 2000,
      env: CLAUDE_ENV,
    });
    return true;
  } catch {
    return false;
  }
}

// ── In-app stored API key ──────────────────────────────────────────
//
// As an alternative to the env-var path, the user can paste their
// Anthropic API key into Settings → Profile. We encrypt it via
// `safeStorage` (uses the OS keychain on macOS) and write it to a
// dedicated file under userData. On app boot we decrypt it and set
// `process.env.ANTHROPIC_API_KEY` so the SDK picks it up — same
// precedence as a manually-set env var.
//
// We DON'T overwrite an existing env var: if the user already has
// ANTHROPIC_API_KEY in their shell env, that wins and our stored
// key is ignored. Lets power users keep their workflow without
// surprise overrides.

/** File name (under app.getPath('userData')) for the encrypted key. */
const KEY_FILENAME = 'anthropic-api-key.enc';

function keyFilePath(): string {
  return path.join(app.getPath('userData'), KEY_FILENAME);
}

/**
 * Read the stored API key, returning null if none exists or
 * decryption fails (corrupted file, encryption key changed, etc.).
 * Doesn't throw — callers treat any failure as "no stored key".
 */
export async function readStoredApiKey(): Promise<string | null> {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const buf = await fs.readFile(keyFilePath());
    const decoded = safeStorage.decryptString(buf);
    const trimmed = decoded.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** Persist the key. Empty string clears it. */
export async function writeStoredApiKey(key: string): Promise<void> {
  const trimmed = key.trim();
  const file = keyFilePath();
  if (trimmed.length === 0) {
    await clearStoredApiKey();
    return;
  }
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(
      'OS keychain unavailable — cannot store API key safely. Set ANTHROPIC_API_KEY in your shell instead.',
    );
  }
  const enc = safeStorage.encryptString(trimmed);
  await fs.mkdir(path.dirname(file), { recursive: true });
  // chmod 0600 so other users on the machine can't read the
  // encrypted blob, even though it's already encrypted.
  await fs.writeFile(file, enc, { mode: 0o600 });
}

/** Delete the stored key file. No-op if it doesn't exist. */
export async function clearStoredApiKey(): Promise<void> {
  try {
    await fs.unlink(keyFilePath());
  } catch {
    // ignore: file may already be gone
  }
}

/**
 * Boot-time hook: if no env var is set but a stored key exists,
 * inject it into process.env so the SDK reads it. Called once from
 * main/index.ts before any agent sessions start.
 *
 * Returns the source we ended up with so logs / debug can tell
 * where the auth came from.
 */
export async function applyStoredApiKey(): Promise<
  'env' | 'stored' | 'none'
> {
  if ((process.env.ANTHROPIC_API_KEY ?? '').trim().length > 0) {
    return 'env';
  }
  const stored = await readStoredApiKey();
  if (stored) {
    process.env.ANTHROPIC_API_KEY = stored;
    return 'stored';
  }
  return 'none';
}

/**
 * Hit Anthropic's `/v1/models` endpoint with the supplied key (or
 * the stored one) to verify it's accepted. Returns a structured
 * result the renderer can render as a green check / red error.
 *
 * We use /v1/models because it's the cheapest valid call (no token
 * spend, no model invocation) and exists on every API plan.
 */
export interface TestApiKeyResult {
  ok: boolean;
  status?: number;
  error?: string;
}
export async function testApiKey(
  rawKey: string,
): Promise<TestApiKeyResult> {
  const key = rawKey.trim();
  if (!key) {
    return { ok: false, error: 'Empty key.' };
  }
  try {
    const res = await fetch('https://api.anthropic.com/v1/models', {
      method: 'GET',
      headers: {
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
    });
    if (res.ok) return { ok: true, status: res.status };
    // 401 = bad key. 403 = workspace permissions. 5xx = transient.
    let detail = `HTTP ${res.status}`;
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      if (body?.error?.message) detail = body.error.message;
    } catch {
      // body wasn't JSON — keep the HTTP detail
    }
    return { ok: false, status: res.status, error: detail };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** True if a stored key currently exists on disk (without leaking it). */
export async function hasStoredApiKey(): Promise<boolean> {
  return (await readStoredApiKey()) !== null;
}
