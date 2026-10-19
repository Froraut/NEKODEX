'use strict';
// Trusted main process only. Never expose this broker, its vault or withAccessToken over IPC.
// Protocol basis: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
const { randomBytes, createHash, timingSafeEqual } = require('node:crypto');

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const TOKEN = /^[\x21-\x7e]{1,8192}$/;
const fail = code => { throw Object.assign(new Error(`OAuth ${code}`), { code }); };
const equal = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
function httpsUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) fail('invalid_configuration');
  let url; try { url = new URL(raw); } catch { fail('invalid_configuration'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search) fail('invalid_configuration');
  return url;
}
function validateProvider(config) {
  if (!config || !ID.test(config.providerId) || !ID.test(config.accountId)
    || !Number.isSafeInteger(config.epoch) || config.epoch < 1
    || typeof config.label !== 'string' || !config.label || config.label.length > 120
    || /[\x00-\x1f\x7f]/.test(config.label)
    || typeof config.clientId !== 'string' || !config.clientId || config.clientId.length > 2048
    || /[\x00-\x20\x7f]/.test(config.clientId)
    || !Array.isArray(config.scopes) || config.scopes.length > 64
    || config.scopes.some(scope => typeof scope !== 'string' || !/^[\x21\x23-\x5b\x5d-\x7e]{1,200}$/.test(scope))
    || new Set(config.scopes).size !== config.scopes.length
    || !Array.isArray(config.codeChallengeMethodsSupported) || !config.codeChallengeMethodsSupported.includes('S256')) fail('invalid_configuration');
  for (const field of ['issuer', 'resource', 'authorizationEndpoint', 'tokenEndpoint']) httpsUrl(config[field]);
  if (config.revocationEndpoint) httpsUrl(config.revocationEndpoint);
  return Object.freeze({ ...config, scopes: Object.freeze([...config.scopes]) });
}
function callbackBase(raw) {
  let url; try { url = new URL(raw); } catch { fail('invalid_redirect'); }
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port || url.username || url.password || url.search || url.hash
    || !/^\/oauth\/callback\/[a-f0-9]{32}$/.test(url.pathname)) fail('invalid_redirect');
  return url.href;
}
function scopeOf(config) {
  return { kind: 'mcp-oauth', accountId: config.accountId, providerId: config.providerId, epoch: config.epoch,
    issuer: config.issuer, resource: config.resource, clientId: config.clientId };
}
/** vault.read(scope)->{revision,record}|null; compareAndSet(scope,expectedRevision|null,record)->revision;
 * vault.remove(scope,revision). Every method MUST be protected, scoped and atomic; unavailable fails closed.
 * Pending phases are durably written BEFORE refresh/revoke network sends, so restart never replays them.
 * authority(config) checks the current account/config epoch. Trusted config comes from validated discovery
 * and explicit provider registration, never renderer input. transport must enforce approved network egress.
 */
function createAgentOAuthBroker({ providers, vault, authority, transport, now = Date.now }) {
  if (!vault || !['read', 'compareAndSet', 'remove'].every(key => typeof vault[key] === 'function')
    || typeof authority !== 'function' || typeof transport !== 'function') fail('protected_provider_unavailable');
  const configs = new Map(), pending = new Map(), busy = new Set(), terminal = new Map(), invalidated = new Set();
  for (const provider of providers) {
    const config = validateProvider(provider);
    if (configs.has(config.providerId)) fail('duplicate_provider');
    configs.set(config.providerId, config);
  }
  function current(id) {
    const config = configs.get(id);
    if (!config || invalidated.has(id) || authority(config) !== true) fail('stale_authority');
    return config;
  }
  function explicit(input) {
    if (input?.explicitUserAction !== true || !ID.test(input.providerId)) fail('explicit_action_required');
    return current(input.providerId);
  }
  async function read(config) {
    const entry = await vault.read(scopeOf(config)); current(config.providerId);
    if (entry && (!entry.revision || !entry.record || !['ready', 'refresh_pending', 'revocation_pending'].includes(entry.record.phase)
      || typeof entry.record.accessToken !== 'string' || !TOKEN.test(entry.record.accessToken)
      || entry.record.refreshToken !== undefined && (typeof entry.record.refreshToken !== 'string' || !TOKEN.test(entry.record.refreshToken))
      || !Number.isFinite(entry.record.expiresAt))) fail('protected_record_invalid');
    return entry;
  }
  function project(config, entry) {
    const record = entry?.record;
    const state = pending.has(config.providerId) ? 'authorization_pending' : record
      ? record.phase === 'ready' ? record.expiresAt > now() ? 'connected' : 'expired' : record.phase
      : terminal.get(config.providerId) || 'disconnected';
    return { providerId: config.providerId, label: config.label, resource: config.resource, issuer: config.issuer,
      scopes: [...config.scopes], state, ...(record ? { expiresAt: record.expiresAt } : {}),
      canRefresh: Boolean(record?.phase === 'ready' && record.refreshToken),
      canRevoke: Boolean(record && config.revocationEndpoint), toolApprovalRequired: true };
  }
  async function status(id) { const config = current(id); return project(config, await read(config)); }
  async function exclusive(config, action) {
    if (busy.has(config.providerId)) fail('operation_owned');
    busy.add(config.providerId);
    try { return await action(); } finally { busy.delete(config.providerId); }
  }
  async function request(config, endpoint, body) {
    current(config.providerId);
    // transport returns a bounded response without following redirects, logging bodies or exposing errors.
    let result; try { result = await transport(endpoint, body); } catch { fail('network_outcome_unknown'); }
    current(config.providerId);
    if (!result || !Number.isInteger(result.status) || result.status < 200 || result.status >= 300) fail('provider_rejected');
    return result.body;
  }
  function tokens(config, body, prior) {
    if (!body || typeof body !== 'object' || body.token_type?.toLowerCase() !== 'bearer'
      || typeof body.access_token !== 'string' || !TOKEN.test(body.access_token)
      || body.refresh_token !== undefined && (typeof body.refresh_token !== 'string' || !TOKEN.test(body.refresh_token))
      || typeof body.expires_in !== 'number' || !Number.isFinite(body.expires_in) || body.expires_in <= 0 || body.expires_in > 366 * 86400) fail('invalid_token_response');
    if (body.scope !== undefined && (typeof body.scope !== 'string'
      || body.scope.split(' ').some(scope => !config.scopes.includes(scope)))) fail('unexpected_scope');
    if (prior?.refreshToken && (!body.refresh_token || equal(body.refresh_token, prior.refreshToken))) fail('refresh_rotation_required');
    return { phase: 'ready', accessToken: body.access_token, ...(body.refresh_token ? { refreshToken: body.refresh_token } : {}),
      expiresAt: now() + body.expires_in * 1000 };
  }
  return {
    async list() {
      return Promise.all([...configs.values()].map(async config => {
        try { return await status(config.providerId); }
        catch { return { ...project(config, null), state: 'unavailable', canRefresh: false, canRevoke: false, reason: 'Protected credentials or current account authority unavailable' }; }
      }));
    },
    status,
    /** Trusted lifecycle observation only; includes browser consent and code exchange ownership. */
    hasOwner(providerId) { return providerId ? pending.has(providerId) || busy.has(providerId) : pending.size > 0 || busy.size > 0; },
    /** Returns an authorization URL ONLY to the trusted browser opener. It must not cross IPC. */
    async begin(input, redirectUri) {
      const config = explicit(input);
      return exclusive(config, async () => {
        const entry = await read(config);
        if (pending.has(config.providerId) || entry?.record.phase && entry.record.phase !== 'ready') fail('operation_owned');
        const redirect = callbackBase(redirectUri), state = randomBytes(32).toString('base64url');
        const verifier = randomBytes(48).toString('base64url');
        const challenge = createHash('sha256').update(verifier).digest('base64url');
        const url = new URL(config.authorizationEndpoint);
        for (const [key, value] of Object.entries({ response_type: 'code', client_id: config.clientId,
          redirect_uri: redirect, resource: config.resource, state, code_challenge: challenge, code_challenge_method: 'S256',
          ...(config.scopes.length ? { scope: config.scopes.join(' ') } : {}) })) url.searchParams.set(key, value);
        pending.set(config.providerId, { state, verifier, redirect, revision: entry?.revision ?? null });
        terminal.delete(config.providerId);
        return { authorizationUrl: url.href, status: project(config, entry) };
      });
    },
    /** Called by the owned loopback server only. Rejected callbacks never reach the token endpoint. */
    async callback(providerId, callbackUrl) {
      const config = current(providerId);
      return exclusive(config, async () => {
        const session = pending.get(providerId); if (!session) fail('callback_not_owned');
        let url; try { url = new URL(callbackUrl); } catch { fail('invalid_callback'); }
        if (`${url.origin}${url.pathname}` !== session.redirect || url.hash || url.username || url.password
          || [...url.searchParams.keys()].some(key => url.searchParams.getAll(key).length !== 1)
          || !equal(url.searchParams.get('state'), session.state)) fail('invalid_callback');
        const issuer = url.searchParams.get('iss');
        if ((config.authorizationResponseIssParameterSupported && !issuer) || issuer !== null && issuer !== config.issuer) fail('issuer_mismatch');
        if (url.searchParams.has('error')) { pending.delete(providerId); fail('authorization_denied'); }
        const code = url.searchParams.get('code');
        if (!code || code.length > 8192 || /[\x00-\x20\x7f]/.test(code)) fail('invalid_callback');
        // Consume before sending: a code exchange is never retried after an uncertain outcome.
        pending.delete(providerId);
        const body = await request(config, config.tokenEndpoint, new URLSearchParams({ grant_type: 'authorization_code',
          client_id: config.clientId, code, code_verifier: session.verifier, redirect_uri: session.redirect, resource: config.resource }));
        const record = tokens(config, body); current(providerId);
        await vault.compareAndSet(scopeOf(config), session.revision, record); current(providerId);
        return status(providerId);
      });
    },
    async cancel(input) { const config = explicit(input); if (busy.has(config.providerId)) fail('operation_owned'); pending.delete(config.providerId); return status(config.providerId); },
    async refresh(input) {
      const config = explicit(input);
      return exclusive(config, async () => {
        if (pending.has(config.providerId)) fail('operation_owned');
        const entry = await read(config);
        if (!entry || entry.record.phase !== 'ready' || !entry.record.refreshToken) fail('refresh_unavailable');
        current(config.providerId);
        const revision = await vault.compareAndSet(scopeOf(config), entry.revision, { ...entry.record, phase: 'refresh_pending' });
        const body = await request(config, config.tokenEndpoint, new URLSearchParams({ grant_type: 'refresh_token',
          client_id: config.clientId, refresh_token: entry.record.refreshToken, resource: config.resource }));
        const record = tokens(config, body, entry.record); current(config.providerId);
        await vault.compareAndSet(scopeOf(config), revision, record); current(config.providerId);
        return status(config.providerId);
      });
    },
    async revoke(input) {
      const config = explicit(input);
      return exclusive(config, async () => {
        if (!config.revocationEndpoint) fail('remote_revocation_unavailable');
        if (pending.has(config.providerId)) fail('operation_owned');
        const entry = await read(config); if (!entry) fail('credential_not_found');
        if (entry.record.phase === 'revocation_pending' || entry.record.phase === 'refresh_pending') fail('operation_outcome_unknown');
        current(config.providerId);
        const revision = await vault.compareAndSet(scopeOf(config), entry.revision, { ...entry.record, phase: 'revocation_pending' });
        // Revoke both: providers do not universally cascade refresh-token revocation to access tokens.
        if (entry.record.refreshToken) await request(config, config.revocationEndpoint, new URLSearchParams({
          token: entry.record.refreshToken, token_type_hint: 'refresh_token', client_id: config.clientId }));
        await request(config, config.revocationEndpoint, new URLSearchParams({
          token: entry.record.accessToken, token_type_hint: 'access_token', client_id: config.clientId }));
        current(config.providerId); await vault.remove(scopeOf(config), revision); current(config.providerId);
        terminal.set(config.providerId, 'revoked');
        return status(config.providerId);
      });
    },
    /** Tokens stay in trusted memory; caller must be the exact MCP transport AFTER ToolJournal admission. */
    async withAccessToken(providerId, resource, use) {
      const config = current(providerId);
      if (resource !== config.resource || typeof use !== 'function' || busy.has(providerId)) fail('resource_or_owner_mismatch');
      const entry = await read(config);
      if (!entry || entry.record.phase !== 'ready' || entry.record.expiresAt <= now() || pending.has(providerId)) fail('authorization_required');
      current(providerId); return use(entry.record.accessToken);
    },
    /** Account owner calls on sign-out/config epoch changes. Does not mutate other account credentials. */
    invalidate(providerId) {
      if (providerId) { pending.delete(providerId); invalidated.add(providerId); }
      else { pending.clear(); for (const id of configs.keys()) invalidated.add(id); }
    },
  };
}
module.exports = { createAgentOAuthBroker, validateProvider, scopeOf };
