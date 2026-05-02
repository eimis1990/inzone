/**
 * Native MCP OAuth client — same flow Claude Code uses.
 *
 * Phases:
 *   1. Discovery
 *      - Probe the MCP URL with no auth; the server replies 401 with a
 *        `WWW-Authenticate` header naming a `resource_metadata` URL
 *        (RFC 9728), or
 *      - Fetch `<base>/.well-known/oauth-protected-resource` directly.
 *      - Either way we get a list of `authorization_servers`. For each,
 *        fetch `<authServer>/.well-known/oauth-authorization-server`
 *        (RFC 8414) to find the auth and token endpoints.
 *
 *   2. Dynamic Client Registration (RFC 7591)
 *      - POST the registration endpoint with our redirect URI; receive
 *        a freshly-minted `client_id` (and optionally `client_secret`).
 *      - If the server doesn't expose registration, surface a helpful
 *        error so the user knows to provide a pre-registered client.
 *
 *   3. PKCE auth code flow
 *      - Generate `code_verifier` + `code_challenge` (S256).
 *      - Spin up an ephemeral `http.createServer` listener on
 *        `127.0.0.1` for the OAuth callback.
 *      - Open the authorisation URL in the user's default browser.
 *      - Receive `?code=&state=` on the callback, validate state.
 *      - POST the token endpoint with `code_verifier` to exchange
 *        the code for `access_token` (+ optional refresh).
 *
 *   4. Persist
 *      - Encrypted via Electron `safeStorage` keyed on the canonical
 *        MCP resource URL. Reused on every probe / agent session.
 *
 *   5. Refresh
 *      - On 401 we try `grant_type=refresh_token` once. If that fails
 *        too, the entry is treated as needing a fresh auth flow.
 */

import { shell } from 'electron';
import { createServer } from 'http';
import type { AddressInfo } from 'net';
import crypto from 'crypto';
import {
  canonicalResourceKey,
  deleteCreds,
  getCreds,
  patchCreds,
  putCreds,
  type OAuthClient,
  type OAuthEndpoints,
  type OAuthTokens,
  type StoredCreds,
} from './mcp-oauth-store';

/** What the SDK / our probe needs at runtime: a fresh access token. */
export interface AuthBearer {
  type: 'bearer';
  access_token: string;
  expires_at?: number;
}

const CALLBACK_HOST = '127.0.0.1';
const DEFAULT_SCOPES = [
  'mcp:connect',
  'mcp:tools.read',
  'mcp:tools.write',
];
const CLIENT_NAME = 'INZONE';
const CLIENT_URI = 'https://github.com/anthropics/claude-code';
const SOFTWARE_VERSION = '0.1.0';

interface OAuthProtectedResourceMetadata {
  resource?: string;
  authorization_servers?: string[];
}

interface OAuthAuthServerMetadata {
  issuer?: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  scopes_supported?: string[];
  code_challenge_methods_supported?: string[];
  grant_types_supported?: string[];
}

/* ─── PKCE helpers ─────────────────────────────────────────────────── */

function base64url(buf: Buffer): string {
  return buf
    .toString('base64')
    .replace(/=+$/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function genVerifier(): string {
  return base64url(crypto.randomBytes(32));
}

function challengeFor(verifier: string): string {
  return base64url(crypto.createHash('sha256').update(verifier).digest());
}

function genState(): string {
  return base64url(crypto.randomBytes(16));
}

/* ─── Discovery ────────────────────────────────────────────────────── */

/**
 * Parse the `WWW-Authenticate` header of a 401 response, looking for
 * the `resource_metadata` parameter that points at the protected-
 * resource metadata document.
 */
function parseResourceMetadataUrl(www: string | null): string | null {
  if (!www) return null;
  // Crude but sufficient: handles `Bearer resource_metadata="https://…"`.
  const match = www.match(/resource_metadata=("([^"]+)"|([^,\s]+))/i);
  if (!match) return null;
  return match[2] ?? match[3] ?? null;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = (await res.text().catch(() => '')).slice(0, 200);
    throw new Error(
      `${res.status} ${res.statusText} from ${url}${body ? ` — ${body}` : ''}`,
    );
  }
  return (await res.json()) as T;
}

async function discoverEndpoints(
  resourceUrl: string,
): Promise<OAuthEndpoints> {
  // Step 1a: probe the resource for a WWW-Authenticate hint.
  let resourceMetadataUrl: string | null = null;
  try {
    const ping = await fetch(resourceUrl, { method: 'GET' });
    if (ping.status === 401) {
      resourceMetadataUrl = parseResourceMetadataUrl(
        ping.headers.get('www-authenticate'),
      );
    }
  } catch {
    /* network blip — fall through */
  }

  // Step 1b: fall back to the well-known on the resource origin.
  if (!resourceMetadataUrl) {
    const u = new URL(resourceUrl);
    resourceMetadataUrl = `${u.origin}/.well-known/oauth-protected-resource`;
  }

  let resourceMeta: OAuthProtectedResourceMetadata;
  try {
    resourceMeta = await fetchJson<OAuthProtectedResourceMetadata>(
      resourceMetadataUrl,
    );
  } catch {
    // Some servers skip the protected-resource metadata and serve
    // auth-server metadata directly on their own origin. Try that.
    resourceMeta = {};
  }

  const candidateAuthServers = resourceMeta.authorization_servers?.length
    ? resourceMeta.authorization_servers
    : [new URL(resourceUrl).origin];

  let lastErr: unknown = null;
  for (const authServer of candidateAuthServers) {
    const authMetadataUrl = `${authServer.replace(/\/+$/, '')}/.well-known/oauth-authorization-server`;
    try {
      const meta = await fetchJson<OAuthAuthServerMetadata>(authMetadataUrl);
      if (!meta.authorization_endpoint || !meta.token_endpoint) {
        throw new Error(
          'Auth server metadata is missing authorization or token endpoint.',
        );
      }
      return {
        authorization: meta.authorization_endpoint,
        token: meta.token_endpoint,
        registration: meta.registration_endpoint,
        issuer: meta.issuer,
        resource: resourceMeta.resource ?? resourceUrl,
      };
    } catch (err) {
      lastErr = err;
    }
  }
  throw new Error(
    `Could not discover OAuth endpoints for ${resourceUrl}: ${lastErr instanceof Error ? lastErr.message : String(lastErr)}`,
  );
}

/* ─── Dynamic Client Registration ──────────────────────────────────── */

async function registerClient(
  endpoints: OAuthEndpoints,
  redirectUri: string,
  scopes: string[],
): Promise<OAuthClient> {
  if (!endpoints.registration) {
    throw new Error(
      'This server does not advertise a Dynamic Client Registration endpoint. You will need a pre-registered OAuth client (set client_id ahead of time).',
    );
  }
  const body = {
    redirect_uris: [redirectUri],
    client_name: CLIENT_NAME,
    client_uri: CLIENT_URI,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    scope: scopes.join(' '),
    software_id: 'inzone',
    software_version: SOFTWARE_VERSION,
  };
  const res = await fetch(endpoints.registration, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(
      `Dynamic Client Registration failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`,
    );
  }
  const json = (await res.json()) as OAuthClient;
  if (!json.client_id) {
    throw new Error('Registration response did not include a client_id.');
  }
  return json;
}

/* ─── Localhost callback listener ──────────────────────────────────── */

interface CallbackResult {
  code: string;
  state: string;
}

interface ListenerHandle {
  port: number;
  redirectUri: string;
  /** Awaits the next /callback hit (or a timeout). */
  waitForCode: () => Promise<CallbackResult>;
  /** Always close, even on error paths, to release the port. */
  close: () => void;
}

function startCallbackListener(timeoutMs: number): Promise<ListenerHandle> {
  return new Promise((resolveOuter, rejectOuter) => {
    let resolveInner: ((r: CallbackResult) => void) | null = null;
    let rejectInner: ((e: Error) => void) | null = null;
    let timer: NodeJS.Timeout | null = null;

    const server = createServer((req, res) => {
      // Only the callback path; ignore favicon / probes.
      const url = new URL(req.url ?? '/', `http://${CALLBACK_HOST}`);
      if (url.pathname !== '/callback') {
        res.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      const state = url.searchParams.get('state');
      const errParam = url.searchParams.get('error');
      const errDesc = url.searchParams.get('error_description');
      if (errParam) {
        const msg = `${errParam}${errDesc ? `: ${errDesc}` : ''}`;
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(
          `<!doctype html><meta charset=utf-8><title>Auth failed</title>
           <body style="font-family:sans-serif;padding:40px;background:#0e1014;color:#fafafa">
           <h2>Authentication failed</h2>
           <p>${escapeHtml(msg)}</p>
           <p>You can close this window and try again from INZONE.</p>`,
        );
        rejectInner?.(new Error(`OAuth authorisation error: ${msg}`));
        return;
      }
      if (!code || !state) {
        res
          .writeHead(400, { 'Content-Type': 'text/plain' })
          .end('Missing code or state.');
        rejectInner?.(new Error('Callback was missing code or state.'));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html' }).end(
        `<!doctype html><meta charset=utf-8><title>Authenticated</title>
         <body style="font-family:sans-serif;padding:40px;background:#0e1014;color:#fafafa">
         <h2>You're connected.</h2>
         <p>Tokens have been cached. You can close this tab and return to INZONE.</p>
         <script>setTimeout(()=>window.close(),250)</script>`,
      );
      resolveInner?.({ code, state });
    });

    server.on('error', (err) => rejectOuter(err));

    server.listen(0, CALLBACK_HOST, () => {
      const addr = server.address() as AddressInfo;
      const port = addr.port;
      const redirectUri = `http://${CALLBACK_HOST}:${port}/callback`;
      const handle: ListenerHandle = {
        port,
        redirectUri,
        waitForCode: () =>
          new Promise<CallbackResult>((res, rej) => {
            resolveInner = res;
            rejectInner = rej;
            timer = setTimeout(() => {
              rej(
                new Error(
                  `Timed out waiting for OAuth callback after ${Math.round(timeoutMs / 1000)} seconds.`,
                ),
              );
            }, timeoutMs);
          }),
        close: () => {
          if (timer) clearTimeout(timer);
          server.close();
        },
      };
      resolveOuter(handle);
    });
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* ─── Token exchange + refresh ─────────────────────────────────────── */

async function exchangeCode(args: {
  endpoints: OAuthEndpoints;
  client: OAuthClient;
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    code_verifier: args.codeVerifier,
    client_id: args.client.client_id,
    redirect_uri: args.redirectUri,
  });
  if (args.client.client_secret) {
    body.set('client_secret', args.client.client_secret);
  }
  return postTokenEndpoint(args.endpoints.token, body);
}

async function refreshTokens(
  endpoints: OAuthEndpoints,
  client: OAuthClient,
  refreshToken: string,
): Promise<OAuthTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: client.client_id,
  });
  if (client.client_secret) body.set('client_secret', client.client_secret);
  return postTokenEndpoint(endpoints.token, body);
}

interface RawTokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
}

async function postTokenEndpoint(
  url: string,
  body: URLSearchParams,
): Promise<OAuthTokens> {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = (await res.text().catch(() => '')).slice(0, 240);
    throw new Error(
      `Token endpoint returned ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`,
    );
  }
  const json = (await res.json()) as RawTokenResponse;
  if (!json.access_token) {
    throw new Error('Token response missing access_token.');
  }
  const expires_at =
    typeof json.expires_in === 'number'
      ? Date.now() + json.expires_in * 1000
      : undefined;
  return {
    access_token: json.access_token,
    token_type: json.token_type,
    expires_at,
    refresh_token: json.refresh_token,
  };
}

/* ─── Public API ───────────────────────────────────────────────────── */

export interface AuthFlowResult {
  ok: true;
  resource: string;
  scopes: string[];
  serverIssuer?: string;
  expiresAt?: number;
}

/**
 * Run the full OAuth flow end-to-end for a remote MCP server URL.
 * Stores the resulting tokens encrypted on disk and returns the
 * canonical resource key on success.
 */
export async function authenticateMcpServer(args: {
  url: string;
  scopes?: string[];
}): Promise<AuthFlowResult> {
  const scopes = args.scopes ?? DEFAULT_SCOPES;

  // 1. Discovery
  const endpoints = await discoverEndpoints(args.url);

  // 2. Spin up the localhost callback listener BEFORE we register, so
  //    the redirect_uri we register matches exactly the one we listen on.
  const listener = await startCallbackListener(5 * 60 * 1000);

  try {
    // 3. DCR (or reuse stored client if we already registered for this resource)
    const existing = await getCreds(args.url);
    let client: OAuthClient;
    if (existing?.client.client_id) {
      // Reuse the previously registered client — most servers don't care
      // about exact redirect_uri match across registrations, but a fresh
      // PKCE pair every flow is required regardless.
      client = existing.client;
    } else {
      client = await registerClient(endpoints, listener.redirectUri, scopes);
    }

    // 4. PKCE + state
    const codeVerifier = genVerifier();
    const codeChallenge = challengeFor(codeVerifier);
    const state = genState();

    // 5. Build authorization URL and open in user's browser
    const authUrl = new URL(endpoints.authorization);
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('client_id', client.client_id);
    authUrl.searchParams.set('redirect_uri', listener.redirectUri);
    authUrl.searchParams.set('code_challenge', codeChallenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('scope', scopes.join(' '));
    // Per RFC 8707 — bind the issued token to the MCP resource we're after.
    authUrl.searchParams.set('resource', endpoints.resource);

    await shell.openExternal(authUrl.toString());

    // 6. Wait for the callback
    const cb = await listener.waitForCode();
    if (cb.state !== state) {
      throw new Error('OAuth state mismatch — possible CSRF, refusing.');
    }

    // 7. Exchange code for tokens
    const tokens = await exchangeCode({
      endpoints,
      client,
      code: cb.code,
      codeVerifier,
      redirectUri: listener.redirectUri,
    });

    // 8. Persist
    const creds: StoredCreds = { endpoints, client, tokens, scopes };
    await putCreds(args.url, creds);

    return {
      ok: true,
      resource: canonicalResourceKey(args.url),
      scopes,
      serverIssuer: endpoints.issuer,
      expiresAt: tokens.expires_at,
    };
  } finally {
    listener.close();
  }
}

/**
 * Fetch a usable bearer token for the given MCP URL. Returns null if
 * we have no stored credentials. Auto-refreshes via refresh_token if
 * the access token is expired or about to expire.
 */
export async function getBearerForUrl(
  url: string,
): Promise<AuthBearer | null> {
  const creds = await getCreds(url);
  if (!creds) return null;

  // Treat a token with < 30 s left as already expired so we don't
  // waste a probe slot on a 401 we could have prevented.
  const stale =
    typeof creds.tokens.expires_at === 'number' &&
    creds.tokens.expires_at < Date.now() + 30_000;

  if (!stale) {
    return {
      type: 'bearer',
      access_token: creds.tokens.access_token,
      expires_at: creds.tokens.expires_at,
    };
  }

  if (!creds.tokens.refresh_token) {
    // No way to refresh — caller should re-run the auth flow.
    return null;
  }
  try {
    const fresh = await refreshTokens(
      creds.endpoints,
      creds.client,
      creds.tokens.refresh_token,
    );
    // Some servers don't return a new refresh_token — keep the old one.
    if (!fresh.refresh_token) {
      fresh.refresh_token = creds.tokens.refresh_token;
    }
    await patchCreds(url, { tokens: fresh });
    return {
      type: 'bearer',
      access_token: fresh.access_token,
      expires_at: fresh.expires_at,
    };
  } catch (err) {
    console.warn(
      `[mcp-oauth] refresh failed for ${canonicalResourceKey(url)} — re-auth needed:`,
      err,
    );
    return null;
  }
}

export async function disconnectMcpServer(url: string): Promise<boolean> {
  return deleteCreds(url);
}

export { listAuthedResources } from './mcp-oauth-store';
