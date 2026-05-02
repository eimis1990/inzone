/**
 * One-shot connection probe for an MCP server. Mimics what Claude Code's
 * `/mcp` panel shows — connect, do an `initialize` handshake, list tools,
 * report success or a short error. Used by the Settings → MCP Servers
 * tab to render a green/red status badge per row.
 *
 * We deliberately speak raw JSON-RPC instead of pulling in the full MCP
 * SDK; a probe is short-lived and we don't want to ship the SDK just for
 * this one button. If a server's transport quirks require the SDK, the
 * agent will still pick it up at session-start time — the probe just
 * gives the user a quick health signal.
 *
 * Transports:
 *   - stdio: spawn the command, write JSON-RPC to stdin, read newline-
 *     delimited responses from stdout.
 *   - http (Streamable HTTP): POST a single batch with `Accept:
 *     application/json, text/event-stream`. Body comes back as either
 *     JSON or an SSE event — we handle both.
 *   - sse: POST initialize+tools/list to the URL the same way as http.
 *     (Most "sse" MCP servers actually accept this and return JSON;
 *     full SSE-with-companion-endpoint flow is heavier than we need.)
 */

import { spawn } from 'child_process';
import type { McpProbeResult, McpServerConfig } from '@shared/types';
import { getBearerForUrl } from './mcp-oauth';

const PROTOCOL_VERSION = '2024-11-05';
const PROBE_TIMEOUT_MS = 8000;
/**
 * mcp-remote (the OAuth-handling proxy) opens a browser on first
 * connect and waits for the user to click through the auth flow.
 * People are slow — five minutes covers "go grab my 2FA device" cases.
 */
const PROBE_TIMEOUT_MS_OAUTH = 5 * 60 * 1000;
/**
 * After we get a successful handshake, give the subprocess a moment to
 * finish anything async (writing OAuth tokens to its on-disk cache)
 * before we send SIGTERM. Without this, killing immediately can leave
 * mcp-remote's `~/.mcp-auth/` cache half-written, forcing the user to
 * redo OAuth on the next probe.
 */
const POST_SUCCESS_GRACE_MS = 1500;

/** Heuristic — is this stdio command going through mcp-remote? */
function looksLikeMcpRemote(
  config: Extract<McpServerConfig, { type: 'stdio' }>,
): boolean {
  if (config.command.includes('mcp-remote')) return true;
  return (config.args ?? []).some((a) => a.includes('mcp-remote'));
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Public entry point. */
export async function probeMcpServer(
  config: McpServerConfig,
): Promise<McpProbeResult> {
  const start = Date.now();
  try {
    const result =
      config.type === 'stdio'
        ? await probeStdio(config)
        : await probeRemote(config);
    return { ...result, durationMs: Date.now() - start };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

// ─── stdio ────────────────────────────────────────────────────────────

async function probeStdio(
  config: Extract<McpServerConfig, { type: 'stdio' }>,
): Promise<McpProbeResult> {
  // Bigger window when we expect an OAuth round-trip — user may take
  // their time clicking through the browser auth flow.
  const timeoutMs = looksLikeMcpRemote(config)
    ? PROBE_TIMEOUT_MS_OAUTH
    : PROBE_TIMEOUT_MS;
  const isOAuthFlow = looksLikeMcpRemote(config);
  return new Promise<McpProbeResult>((resolve) => {
    let settled = false;
    /**
     * Settle the probe. On success of an OAuth flow we delay the SIGTERM
     * by POST_SUCCESS_GRACE_MS so mcp-remote has a chance to flush its
     * token cache to disk — without that, "Connect" sometimes succeeds
     * once and then fails on the next probe because the cache file
     * never finished writing.
     */
    const finish = (r: McpProbeResult) => {
      if (settled) return;
      settled = true;
      const reapDelay = r.ok && isOAuthFlow ? POST_SUCCESS_GRACE_MS : 0;
      const reap = () => {
        try {
          proc.kill('SIGTERM');
        } catch {
          /* already dead */
        }
      };
      if (reapDelay > 0) setTimeout(reap, reapDelay);
      else reap();
      resolve(r);
    };

    let proc: ReturnType<typeof spawn>;
    try {
      proc = spawn(config.command, config.args ?? [], {
        env: { ...process.env, ...(config.env ?? {}) },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
    } catch (err) {
      return resolve({
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    const stderrChunks: string[] = [];
    proc.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString('utf8'));
    });

    proc.on('error', (err) => {
      // ENOENT on the binary itself, etc.
      finish({
        ok: false,
        error: `Command failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    });

    proc.on('exit', (code) => {
      // Exited before we got a handshake — almost always a config error
      // or an OAuth failure. Surface the last 10 lines of stderr so the
      // user can see what mcp-remote / the server is complaining about
      // (errors like "errorUri: undefined" tell us nothing on their own).
      const stderrAll = stderrChunks.join('').trim();
      const tail = stderrAll.split('\n').slice(-10).join('\n');
      finish({
        ok: false,
        error: tail || `Process exited with code ${code ?? 'unknown'}.`,
      });
    });

    const responses = new Map<number, JsonRpcResponse>();
    let stdoutBuf = '';
    proc.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuf += chunk.toString('utf8');
      let idx: number;
      while ((idx = stdoutBuf.indexOf('\n')) !== -1) {
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        try {
          const msg = JSON.parse(line) as JsonRpcResponse;
          if (typeof msg.id === 'number') responses.set(msg.id, msg);
        } catch {
          // Not JSON — server is logging to stdout. Ignore.
        }
      }
    });

    const send = (id: number, method: string, params?: unknown) => {
      const payload =
        JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
      proc.stdin?.write(payload);
    };

    // Drive the handshake.
    (async () => {
      try {
        send(1, 'initialize', {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { roots: { listChanged: false } },
          clientInfo: { name: 'INZONE-probe', version: '0.1.0' },
        });
        const init = await waitForResponse(responses, 1, timeoutMs);
        if (init.error) {
          return finish({ ok: false, error: init.error.message });
        }
        const initResult = (init.result ?? {}) as {
          serverInfo?: { name?: string; version?: string };
        };

        // Per spec: send the initialized notification before further calls.
        proc.stdin?.write(
          JSON.stringify({
            jsonrpc: '2.0',
            method: 'notifications/initialized',
          }) + '\n',
        );

        send(2, 'tools/list', {});
        // tools/list is fast once initialize landed — back to the short timeout.
        const tools = await waitForResponse(responses, 2, PROBE_TIMEOUT_MS);
        const toolCount =
          tools.result &&
          typeof tools.result === 'object' &&
          Array.isArray((tools.result as { tools?: unknown }).tools)
            ? ((tools.result as { tools: unknown[] }).tools.length)
            : undefined;

        finish({
          ok: true,
          tools: toolCount,
          serverName: initResult.serverInfo?.name,
          serverVersion: initResult.serverInfo?.version,
        });
      } catch (err) {
        finish({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    })();
  });
}

/** Poll the response map every 25 ms up to the supplied timeout. */
async function waitForResponse(
  responses: Map<number, JsonRpcResponse>,
  id: number,
  timeoutMs: number,
): Promise<JsonRpcResponse> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = responses.get(id);
    if (r) return r;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error(
    `Server did not respond within ${Math.round(timeoutMs / 1000)} seconds.`,
  );
}

// ─── http / sse ───────────────────────────────────────────────────────

async function probeRemote(
  config: Extract<McpServerConfig, { type: 'http' | 'sse' }>,
): Promise<McpProbeResult> {
  // Most modern MCP servers (Streamable HTTP) accept an `initialize` POST
  // and answer with either JSON or an SSE-formatted body. We send both
  // initialize and tools/list, parse whichever comes back.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), PROBE_TIMEOUT_MS);
  try {
    const initBody = {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { roots: { listChanged: false } },
        clientInfo: { name: 'INZONE-probe', version: '0.1.0' },
      },
    };
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(config.headers ?? {}),
    };
    // If we have OAuth tokens stashed for this URL (because the user
    // authenticated through Settings → Connect), use them. Auto-refreshes
    // an expired access_token via the stored refresh_token if needed.
    const bearer = await getBearerForUrl(config.url);
    if (bearer) {
      headers['Authorization'] = `Bearer ${bearer.access_token}`;
    }
    const initRes = await fetch(config.url, {
      method: 'POST',
      headers,
      body: JSON.stringify(initBody),
      signal: ctrl.signal,
    });
    if (!initRes.ok) {
      const text = await safeText(initRes);
      // Bubble up authentication failures with a stable shape so the
      // renderer can recognise them and offer the Connect button.
      if (initRes.status === 401 || initRes.status === 403) {
        return {
          ok: false,
          error: `HTTP ${initRes.status} ${initRes.statusText} — server requires authentication. Click "Connect" to run the OAuth flow.${text ? `\n\n${text.slice(0, 240)}` : ''}`,
        };
      }
      return {
        ok: false,
        error: `HTTP ${initRes.status} ${initRes.statusText}${text ? ` — ${text.slice(0, 140)}` : ''}`,
      };
    }
    const initJson = await parseJsonOrSse<JsonRpcResponse>(initRes);
    if (!initJson) {
      return { ok: false, error: 'Empty response to initialize.' };
    }
    if (initJson.error) {
      return { ok: false, error: initJson.error.message };
    }
    const initResult = (initJson.result ?? {}) as {
      serverInfo?: { name?: string; version?: string };
    };
    // Carry session id if the server gave us one (Streamable HTTP).
    const sessionId = initRes.headers.get('mcp-session-id');
    const followHeaders: Record<string, string> = { ...headers };
    if (sessionId) followHeaders['mcp-session-id'] = sessionId;

    // Server expects us to acknowledge initialize with a notification.
    await fetch(config.url, {
      method: 'POST',
      headers: followHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
      signal: ctrl.signal,
    }).catch(() => {
      /* notification — fire-and-forget */
    });

    const toolsRes = await fetch(config.url, {
      method: 'POST',
      headers: followHeaders,
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/list',
        params: {},
      }),
      signal: ctrl.signal,
    });
    let toolCount: number | undefined;
    if (toolsRes.ok) {
      const toolsJson = await parseJsonOrSse<JsonRpcResponse>(toolsRes);
      if (
        toolsJson?.result &&
        typeof toolsJson.result === 'object' &&
        Array.isArray((toolsJson.result as { tools?: unknown }).tools)
      ) {
        toolCount = (toolsJson.result as { tools: unknown[] }).tools.length;
      }
    }
    return {
      ok: true,
      tools: toolCount,
      serverName: initResult.serverInfo?.name,
      serverVersion: initResult.serverInfo?.version,
    };
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      return { ok: false, error: 'Timed out after 8 seconds.' };
    }
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function safeText(r: Response): Promise<string> {
  try {
    return (await r.text()).trim();
  } catch {
    return '';
  }
}

/**
 * Some MCP HTTP endpoints answer with `Content-Type: text/event-stream`
 * even when only one message is coming back. Parse either form into a
 * single JSON-RPC response.
 */
async function parseJsonOrSse<T>(r: Response): Promise<T | null> {
  const ct = r.headers.get('content-type') ?? '';
  const text = await r.text();
  if (!text.trim()) return null;
  if (ct.includes('application/json') || text.trim().startsWith('{')) {
    try {
      return JSON.parse(text) as T;
    } catch {
      return null;
    }
  }
  // SSE: lines like `data: {...}` separated by blank lines. Look for
  // the first `data:` payload that parses as JSON.
  for (const block of text.split(/\n\n+/)) {
    const dataLines = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('');
    if (!dataLines) continue;
    try {
      return JSON.parse(dataLines) as T;
    } catch {
      // try the next block
    }
  }
  return null;
}
