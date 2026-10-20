'use strict';
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const { validateExactRedirectUri } = require('./agent-oauth.cjs');

/** Approved main-process fetch only; endpoint allowlisting/DNS/egress policy belongs to its owner. */
function createOAuthTransport(approvedFetch) {
  if (typeof approvedFetch !== 'function') throw new Error('OAuth approved network transport unavailable');
  return async (endpoint, body) => {
    const response = await approvedFetch(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit',
      cache: 'no-store', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
      body: body.toString(), signal: AbortSignal.timeout(15_000) });
    if (response.status < 200 || response.status >= 300) { await response.body?.cancel(); return { status: response.status }; }
    const reader = response.body?.getReader();
    let bytes = 0; const chunks = [];
    if (reader) {
      try {
        for (;;) {
          const { done, value } = await reader.read(); if (done) break;
          bytes += value.byteLength;
          if (bytes > 32 * 1024) throw new Error('OAuth response too large');
          chunks.push(Buffer.from(value));
        }
      } catch { await reader.cancel().catch(() => {}); throw new Error('OAuth bounded response unavailable'); }
      finally { reader.releaseLock(); }
    }
    const encoded = Buffer.concat(chunks).toString('utf8');
    // Revocation commonly returns an empty successful response (RFC7009).
    let result = {}; if (encoded) { try { result = JSON.parse(encoded); } catch { throw new Error('OAuth invalid response'); } }
    return { status: response.status, body: result };
  };
}

/** Owns ephemeral loopback listeners and browser opening. Renderer receives statuses only.
 * Exact registrations bind only their reviewed URI. Legacy registrations require
 * provider support for the existing variable loopback port/path policy; it is not inferred for exact clients.
 * No timer expires a human's pending consent. Explicit cancel/sign-out closes its exact listener.
 */
function createAgentOAuthLauncher({ broker, openExternal }) {
  if (!broker || typeof openExternal !== 'function') throw new Error('OAuth launcher unavailable');
  const listeners = new Map();
  function close(providerId) {
    const owned = listeners.get(providerId);
    if (owned) { listeners.delete(providerId); owned.server.close(() => {}); owned.server.closeIdleConnections?.(); }
  }
  return {
    list: () => broker.list(),
    async begin(input) {
      if (input?.explicitUserAction !== true || listeners.has(input.providerId)) throw new Error('OAuth explicit unowned action required');
      const registered = broker.registeredRedirect?.(input.providerId);
      const fixed = registered === undefined ? undefined : new URL(validateExactRedirectUri(registered));
      const callbackPath = fixed?.pathname ?? `/oauth/callback/${randomBytes(16).toString('hex')}`;
      const server = http.createServer();
      server.maxConnections = 8; server.requestTimeout = 15_000; server.headersTimeout = 10_000;
      // Reserve synchronously so a concurrent begin cannot replace another listener owner.
      listeners.set(input.providerId, { server });
      try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(fixed ? Number(fixed.port) : 0, '127.0.0.1', () => { server.off('error', reject); resolve(); }); }); }
      catch { close(input.providerId); throw new Error('OAuth callback listener unavailable'); }
      if (listeners.get(input.providerId)?.server !== server) { server.close(() => {}); throw new Error('OAuth callback listener no longer owned'); }
      server.unref();
      const address = server.address(), origin = `http://127.0.0.1:${address.port}`;
      if (fixed && `${origin}${callbackPath}` !== registered) { close(input.providerId); throw new Error('OAuth registered callback binding differs'); }
      server.on('error', () => { close(input.providerId); broker.invalidate(input.providerId); });
      server.on('request', async (request, response) => {
        const send = (status, message) => {
          response.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store',
            'content-security-policy': "default-src 'none'", 'referrer-policy': 'no-referrer', connection: 'close' });
          response.end(message);
        };
        if (request.method !== 'GET' || request.headers.host !== `127.0.0.1:${address.port}`
          || !request.url?.startsWith(`${callbackPath}?`) || request.url.length > 16 * 1024) { send(400, 'Invalid authorization callback.'); return; }
        try {
          await broker.callback(input.providerId, `${origin}${request.url}`);
          send(200, 'Authorization saved in protected storage. You may return to NEKODEX. Tool calls still require approval.');
          close(input.providerId);
        } catch (error) {
          send(400, 'Authorization could not be completed. Return to NEKODEX to inspect its status.');
          if (!['invalid_callback', 'issuer_mismatch', 'operation_owned'].includes(error?.code)) close(input.providerId);
        }
      });
      try {
        const result = await broker.begin(input, `${origin}${callbackPath}`);
        if (listeners.get(input.providerId)?.server !== server) throw new Error('OAuth callback listener no longer owned');
        await openExternal(result.authorizationUrl);
        return result.status;
      } catch (error) {
        close(input.providerId);
        try { await broker.cancel(input); } catch { /* Never erase an owned token exchange. */ }
        throw new Error('OAuth authorization could not be started');
      }
    },
    async cancel(input) {
      try { const result = await broker.cancel(input); close(input.providerId); return result; }
      catch { throw new Error('OAuth cancellation unavailable; inspect authorization status'); }
    },
    async refresh(input) {
      try { return await broker.refresh(input); }
      catch { throw new Error('OAuth refresh incomplete; inspect authorization status'); }
    },
    async revoke(input) {
      try { return await broker.revoke(input); }
      catch { throw new Error('OAuth revocation incomplete; inspect authorization status'); }
    },
    invalidate(providerId) {
      broker.invalidate(providerId);
      if (providerId) close(providerId); else for (const id of listeners.keys()) close(id);
    },
    close() { broker.invalidate(); for (const id of listeners.keys()) close(id); },
  };
}
module.exports = { createAgentOAuthLauncher, createOAuthTransport };
