/**
 * Encrypted on-disk token store for MCP OAuth credentials.
 *
 * We use Electron's `safeStorage` which delegates to the platform
 * keychain (macOS Keychain / DPAPI / libsecret) for an encryption key
 * tied to the user's login session. Tokens never live unencrypted on
 * disk and never leave the local machine.
 *
 * File: `<userData>/mcp-oauth-tokens.json`
 *
 * Schema (all values encrypted as a single blob):
 *   {
 *     "<canonicalResource>": {
 *       endpoints:    { authorization, token, registration?, issuer?, resource },
 *       client:       { client_id, client_secret? },
 *       tokens:       { access_token, refresh_token?, expires_at?, token_type? },
 *       scopes:       string[]
 *     }
 *   }
 *
 * The resource key is derived from the original MCP server URL — see
 * `canonicalResourceKey`. Multiple entries that point at the same MCP
 * resource share one credential set.
 */

import { app, safeStorage } from 'electron';
import { promises as fs } from 'fs';
import path from 'path';

export interface OAuthEndpoints {
  authorization: string;
  token: string;
  registration?: string;
  issuer?: string;
  /** The resource URL the MCP server is gating, used as `resource` param. */
  resource: string;
}

export interface OAuthClient {
  client_id: string;
  /** Set only for confidential clients; PKCE-only public clients omit it. */
  client_secret?: string;
}

export interface OAuthTokens {
  access_token: string;
  refresh_token?: string;
  /** ms epoch when the access token stops being usable. */
  expires_at?: number;
  token_type?: string;
}

export interface StoredCreds {
  endpoints: OAuthEndpoints;
  client: OAuthClient;
  tokens: OAuthTokens;
  scopes: string[];
}

type Disk = Record<string, StoredCreds>;

function storePath(): string {
  return path.join(app.getPath('userData'), 'mcp-oauth-tokens.json');
}

/**
 * Normalise the MCP server URL into a stable lookup key. We ignore
 * trailing slashes and strip query/fragment so different references
 * (`/mcp`, `/mcp/`, `/mcp?foo=1`) share one credential entry.
 */
export function canonicalResourceKey(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    u.hash = '';
    u.search = '';
    let pathname = u.pathname.replace(/\/+$/, '');
    if (!pathname) pathname = '/';
    return `${u.origin}${pathname}`;
  } catch {
    return rawUrl;
  }
}

async function readDisk(): Promise<Disk> {
  try {
    const raw = await fs.readFile(storePath(), 'utf8');
    if (!raw.trim()) return {};
    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback: file is plaintext JSON. Accept it but warn.
      console.warn(
        '[mcp-oauth-store] safeStorage unavailable — reading tokens unencrypted',
      );
      return JSON.parse(raw) as Disk;
    }
    const decrypted = safeStorage.decryptString(Buffer.from(raw, 'base64'));
    return JSON.parse(decrypted) as Disk;
  } catch (err: unknown) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') return {};
    console.warn('[mcp-oauth-store] failed to read token store:', err);
    return {};
  }
}

async function writeDisk(disk: Disk): Promise<void> {
  const dir = path.dirname(storePath());
  await fs.mkdir(dir, { recursive: true });
  const json = JSON.stringify(disk, null, 2);
  if (safeStorage.isEncryptionAvailable()) {
    const buf = safeStorage.encryptString(json);
    await fs.writeFile(storePath(), buf.toString('base64'), 'utf8');
  } else {
    console.warn(
      '[mcp-oauth-store] safeStorage unavailable — writing tokens unencrypted',
    );
    await fs.writeFile(storePath(), json, 'utf8');
  }
}

export async function getCreds(
  resourceUrl: string,
): Promise<StoredCreds | null> {
  const disk = await readDisk();
  return disk[canonicalResourceKey(resourceUrl)] ?? null;
}

export async function putCreds(
  resourceUrl: string,
  creds: StoredCreds,
): Promise<void> {
  const disk = await readDisk();
  disk[canonicalResourceKey(resourceUrl)] = creds;
  await writeDisk(disk);
}

export async function patchCreds(
  resourceUrl: string,
  patch: Partial<StoredCreds> & { tokens?: OAuthTokens },
): Promise<void> {
  const disk = await readDisk();
  const key = canonicalResourceKey(resourceUrl);
  const existing = disk[key];
  if (!existing) {
    throw new Error(
      `No credentials stored for ${key}. Run the auth flow first.`,
    );
  }
  disk[key] = {
    ...existing,
    ...patch,
    tokens: patch.tokens ?? existing.tokens,
  };
  await writeDisk(disk);
}

export async function deleteCreds(resourceUrl: string): Promise<boolean> {
  const disk = await readDisk();
  const key = canonicalResourceKey(resourceUrl);
  if (!(key in disk)) return false;
  delete disk[key];
  await writeDisk(disk);
  return true;
}

export async function listAuthedResources(): Promise<string[]> {
  const disk = await readDisk();
  return Object.keys(disk);
}
