'use strict';
// Main process only: registry contains reviewed PUBLIC client metadata, never credentials.
const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const dns = require('node:dns');
const net = require('node:net');
const { randomUUID, createHash } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { createAgentOAuthBroker, validateProvider } = require('./agent-oauth.cjs');
const { createAgentOAuthLauncher, createOAuthTransport } = require('./agent-oauth-launcher.cjs');
const { createOAuthProtectedVault, oauthProtectedVaultAvailable } = require('./agent-oauth-vault.cjs');
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,159}$/;
const HASH = /^[a-f0-9]{64}$/;
const ACTIONS = new Set(['oauthList', 'oauthBegin', 'oauthCancel', 'oauthRefresh', 'oauthRevoke', 'oauthRegisterProvider', 'oauthRemoveProvider']);
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const exact = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = () => { throw new Error('Protected OAuth service unavailable or request no longer current'); };
function publicUrl(raw) {
  if (typeof raw !== 'string' || raw.length > 2048) fail();
  let url; try { url = new URL(raw); } catch { fail(); }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search
    || !host.includes('.') || /(?:^|\.)(?:localhost|local|internal|home|invalid)$/.test(host)
    || net.isIP(host)) fail();
  return url;
}
function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a > 0 && a < 224 && a !== 10 && a !== 127
      && !(a === 169 && b === 254) && !(a === 172 && b >= 16 && b <= 31)
      && !(a === 192 && (b === 168 || b === 0)) && !(a === 100 && b >= 64 && b <= 127)
      && !(a === 198 && (b === 18 || b === 19));
  }
  // Global-unicast IPv6 only; mapped IPv4, local/link-local/multicast and special ranges fail closed.
  return net.isIPv6(address) && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(?:0*0:|0*2:|db8:)/i.test(address);
}
/** No redirects, ambient credentials, proxy/environment fallback, or private-address DNS results.
 * DNS is resolved inside the HTTPS connection lookup, binding TLS to the checked address.
 * This fetch is OAuth-only; it never accepts Authorization headers or arbitrary request methods.
 */
function createPublicOAuthFetch() {
  return async (raw, input = {}) => {
    const url = publicUrl(String(raw));
    const method = input.method ?? 'GET';
    if (!['GET', 'POST'].includes(method) || input.redirect !== 'error' || input.credentials !== 'omit'
      || input.body !== undefined && (typeof input.body !== 'string' || Buffer.byteLength(input.body) > 24 * 1024)) fail();
    return new Promise((resolve, reject) => {
      const rejectSafe = () => reject(new Error('OAuth approved HTTPS request unavailable'));
      const request = https.request(url, { method, agent: false, signal: input.signal,
        headers: { accept: 'application/json', ...(method === 'POST' ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
        lookup(hostname, options, callback) {
          dns.lookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
            if (error || !addresses.length || !addresses.every(row => publicAddress(row.address))) { callback(new Error('OAuth public endpoint required')); return; }
            const selected = addresses.find(row => !options.family || row.family === options.family);
            if (!selected) { callback(new Error('OAuth public endpoint unavailable')); return; }
            if (options.all) callback(null, addresses); else callback(null, selected.address, selected.family);
          });
        },
      }, response => {
        let bytes = 0; const chunks = [];
        response.on('data', chunk => { bytes += chunk.length; if (bytes > 32 * 1024) { response.destroy(); rejectSafe(); } else chunks.push(chunk); });
        response.on('error', rejectSafe);
        response.on('end', () => {
          const status = response.statusCode ?? 502;
          if (status < 200 || status >= 300) { resolve(new Response(null, { status: status >= 200 && status <= 599 ? status : 502 })); return; }
          resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status }));
        });
      });
      request.on('error', rejectSafe);
      request.setTimeout(15_000, () => request.destroy(new Error('OAuth HTTPS timeout')));
      if (input.body) request.write(input.body);
      request.end();
    });
  };
}
function readJson(file, limit, privateFile = false) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit || fs.lstatSync(file).isSymbolicLink()
      || privateFile && process.platform !== 'win32' && (stat.uid !== process.getuid?.() || stat.mode & 0o077)) fail();
    return JSON.parse(fs.readFileSync(fd, 'utf8'));
  } finally { fs.closeSync(fd); }
}
function validateRegistrationFile(input) {
  const keys = ['version', 'providerId', 'label', 'resource', 'issuer', 'clientId', 'scopes', 'registrationEvidenceUrl',
    'redirectUriMode', 'resourceMetadataUrl', 'authorizationServerMetadataUrl'];
  if (input?.redirectUriMode === 'loopback-exact') keys.push('redirectUri');
  if (!exact(input, keys) || input.version !== 1 || !['loopback-port-variable', 'loopback-exact'].includes(input.redirectUriMode)) fail();
  const resource = publicUrl(input.resource), issuer = publicUrl(input.issuer);
  publicUrl(input.registrationEvidenceUrl);
  const protectedMetadata = publicUrl(input.resourceMetadataUrl), authorizationMetadata = publicUrl(input.authorizationServerMetadataUrl);
  if (protectedMetadata.origin !== resource.origin || authorizationMetadata.origin !== issuer.origin
    || !protectedMetadata.pathname.startsWith('/.well-known/oauth-protected-resource')
    || !(authorizationMetadata.pathname.startsWith('/.well-known/oauth-authorization-server')
      || authorizationMetadata.pathname.endsWith('/.well-known/openid-configuration'))) fail();
  // Validate all public client fields before any metadata request. Endpoints below are temporary validators only.
  validateProvider({ providerId: input.providerId, label: input.label, accountId: 'validation', epoch: 1,
    resource: input.resource, issuer: input.issuer, clientId: input.clientId, scopes: input.scopes,
    authorizationEndpoint: input.issuer, tokenEndpoint: input.issuer, codeChallengeMethodsSupported: ['S256'],
    ...(input.redirectUriMode === 'loopback-exact' ? { redirectUriMode: input.redirectUriMode, redirectUri: input.redirectUri } : {}) });
  return structuredClone(input);
}
/** getAuthority is the real main-owned current-account/epoch projection, or null.
 * It MUST NOT initialize a login, infer an account from a renderer request or select a fallback account.
 * All configuration is reviewed through a native selected file + live metadata fetch, then exact commit.
 */
function createAgentOAuthService({ coreHome, getAuthority, openExternal, approvedFetch = createPublicOAuthFetch(),
  vault = createOAuthProtectedVault({ coreHome }), protectedAvailable = oauthProtectedVaultAvailable,
  launcherFactory = createAgentOAuthLauncher } = {}) {
  if (!path.isAbsolute(coreHome ?? '') || typeof getAuthority !== 'function' || typeof openExternal !== 'function'
    || typeof approvedFetch !== 'function' || typeof protectedAvailable !== 'function') fail();
  const directory = path.join(coreHome, 'agent-oauth'), registryPath = path.join(directory, 'providers.json');
  let owner = null, closed = false, uncertain = false, registrationBusy = false, activeActions = 0;
  const reviews = new Map(), mcpInvalidationListeners = new Set();
  function notifyMcpInvalidation(providerId, strict = false) {
    // Consumers deny in memory before persistence. A failed consumer write must not block credential revocation,
    // but provider removal (strict) requires every consumer to acknowledge its durable binding removal.
    let failed = false;
    for (const listener of mcpInvalidationListeners) { try { listener(providerId); } catch { failed = true; } }
    if (strict && failed) fail();
  }
  /** Same lock, stamp check, revision increment and durable atomic write as registration. */
  function commitRegistry(stamp, providers) {
    const lockPath = `${registryPath}.lock`; let lock;
    try {
      fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
      const stat = fs.lstatSync(directory); if (!stat.isDirectory() || stat.isSymbolicLink()) fail();
      lock = fs.openSync(lockPath, 'wx', 0o600);
      const current = context();
      if (current.stamp !== stamp) fail();
      const next = { version: 1, revision: current.registry.revision + 1, providers: providers(current.registry.providers) };
      if (next.providers.length > 64 || Buffer.byteLength(JSON.stringify(next)) > 128 * 1024) fail();
      const receipt = writePrivateFileAtomic(registryPath, `${JSON.stringify(next, null, 2)}\n`, { durable: true });
      if (receipt.durability === 'uncertain') { uncertain = true; closeOwner(); fail(); }
      closeOwner();
    } finally { if (lock !== undefined) { fs.closeSync(lock); fs.unlinkSync(lockPath); } }
  }
  function authority() {
    if (closed || uncertain) fail();
    const value = getAuthority();
    if (!value || !ID.test(value.accountId) || !['string', 'number'].includes(typeof value.epoch)
      || !String(value.epoch) || String(value.epoch).length > 200) fail();
    return { accountId: value.accountId, epoch: value.epoch };
  }
  function readRegistry() {
    let registry;
    try {
      const stat = fs.lstatSync(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || process.platform !== 'win32'
        && (stat.uid !== process.getuid?.() || stat.mode & 0o077)) fail();
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, revision: 0, providers: [] }; throw error; }
    try { registry = readJson(registryPath, 128 * 1024, true); }
    catch (error) { if (error.code === 'ENOENT') return { version: 1, revision: 0, providers: [] }; throw error; }
    if (!exact(registry, ['version', 'revision', 'providers']) || registry.version !== 1
      || !Number.isSafeInteger(registry.revision) || registry.revision < 0 || !Array.isArray(registry.providers) || registry.providers.length > 64) fail();
    const keys = new Set();
    for (const row of registry.providers) {
      if (!exact(row, ['config', 'metadataDigest', 'registrationEvidenceUrl', 'resourceMetadataUrl', 'authorizationServerMetadataUrl']) || !HASH.test(row.metadataDigest)) fail();
      const configKeys = ['providerId', 'label', 'accountId', 'epoch', 'issuer', 'resource', 'clientId', 'scopes',
        'authorizationEndpoint', 'tokenEndpoint', 'codeChallengeMethodsSupported', 'authorizationResponseIssParameterSupported'];
      if (row.config?.revocationEndpoint !== undefined) configKeys.push('revocationEndpoint');
      if (row.config?.redirectUriMode !== undefined) configKeys.push('redirectUriMode');
      if (row.config?.redirectUri !== undefined) configKeys.push('redirectUri');
      if (!exact(row.config, configKeys)) fail();
      validateProvider(row.config); publicUrl(row.registrationEvidenceUrl); publicUrl(row.resourceMetadataUrl); publicUrl(row.authorizationServerMetadataUrl);
      const key = `${row.config.accountId}:${row.config.providerId}`; if (keys.has(key)) fail(); keys.add(key);
    }
    return registry;
  }
  function closeOwner() { owner?.launcher.close(); owner = null; }
  function context() {
    const current = authority(), registry = readRegistry();
    const stamp = hash({ current, registry });
    if (owner?.stamp !== stamp) {
      closeOwner();
      const configs = registry.providers.filter(row => row.config.accountId === current.accountId).map(row => row.config);
      const broker = createAgentOAuthBroker({ providers: configs, vault, transport: createOAuthTransport(approvedFetch),
        authority: config => {
          try { return hash({ current: authority(), registry: readRegistry() }) === stamp && config.accountId === current.accountId; }
          catch { return false; }
        } });
      owner = { stamp, current, registry, broker, launcher: launcherFactory({ broker, openExternal }), configs };
    }
    return owner;
  }
  function status() {
    try {
      const current = context(), ready = protectedAvailable() === true;
      return { oauthScope: { accountId: current.current.accountId, epoch: current.stamp },
        capabilities: { oauth: ready, secrets: ready },
        oauthRegistry: { state: ready ? current.configs.length ? 'configured' : 'empty' : 'unavailable',
          providerCount: current.configs.length, reason: ready ? undefined : 'Protected credential helper is unavailable' } };
    } catch {
      closeOwner();
      return { capabilities: { oauth: false, secrets: false }, oauthRegistry: { state: 'unavailable', providerCount: 0,
        reason: 'Current account authority or reviewed OAuth registry is unavailable' } };
    }
  }
  async function metadata(url) {
    const response = await approvedFetch(url, { method: 'GET', redirect: 'error', credentials: 'omit', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
    if (!response.ok || response.redirected) fail();
    const reader = response.body?.getReader(); if (!reader) fail();
    let size = 0; const chunks = [];
    try { for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.byteLength; if (size > 32 * 1024) fail(); chunks.push(Buffer.from(value)); } }
    catch { await reader.cancel().catch(() => {}); fail(); }
    finally { reader.releaseLock(); }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  function projectReview(review) {
    const { config } = review.row;
    return { reviewId: review.id, reviewDigest: review.digest, scope: { accountId: review.accountId, epoch: review.stamp },
      providerId: config.providerId, label: config.label, resource: config.resource, issuer: config.issuer,
      authorizationEndpoint: config.authorizationEndpoint, tokenEndpoint: config.tokenEndpoint,
      ...(config.revocationEndpoint ? { revocationEndpoint: config.revocationEndpoint } : {}),
      clientId: config.clientId, scopes: [...config.scopes], metadataDigest: review.row.metadataDigest,
      redirectUriMode: config.redirectUriMode ?? 'loopback-port-variable', ...(config.redirectUri ? { redirectUri: config.redirectUri } : {}),
      registrationEvidenceUrl: review.row.registrationEvidenceUrl, resourceMetadataUrl: review.row.resourceMetadataUrl,
      authorizationServerMetadataUrl: review.row.authorizationServerMetadataUrl,
      state: 'reviewed', authorizationStarted: false, toolApprovalRequired: true };
  }
  return {
    handles: action => ACTIONS.has(action), status,
    // Main-only projection from the validated registry and actual account/config epoch.
    subscribeMcpInvalidation(listener) { if (typeof listener !== 'function') fail(); mcpInvalidationListeners.add(listener); return () => mcpInvalidationListeners.delete(listener); },
    reviewedMcpProviders() {
      const current = context();
      return current.registry.providers.filter(row => row.config.accountId === current.current.accountId).map(row => ({
        providerId: row.config.providerId, label: row.config.label, resource: row.config.resource,
        issuer: row.config.issuer, clientId: row.config.clientId, metadataDigest: row.metadataDigest,
        accountId: current.current.accountId, epoch: current.stamp,
      }));
    },
    async reviewProviderFile(file) {
      if (registrationBusy) fail(); registrationBusy = true;
      try {
        const current = context(); if (protectedAvailable() !== true || reviews.size >= 64) fail();
        const selected = validateRegistrationFile(readJson(file, 16 * 1024));
        const resourceMetadata = await metadata(selected.resourceMetadataUrl);
        if (resourceMetadata.resource !== selected.resource || !Array.isArray(resourceMetadata.authorization_servers)
          || !resourceMetadata.authorization_servers.includes(selected.issuer)) fail();
        const authorizationMetadata = await metadata(selected.authorizationServerMetadataUrl);
        if (authorizationMetadata.issuer !== selected.issuer || !Array.isArray(authorizationMetadata.code_challenge_methods_supported)
          || !authorizationMetadata.code_challenge_methods_supported.includes('S256')
          || !Array.isArray(authorizationMetadata.response_types_supported) || !authorizationMetadata.response_types_supported.includes('code')
          || !Array.isArray(authorizationMetadata.token_endpoint_auth_methods_supported)
          || !authorizationMetadata.token_endpoint_auth_methods_supported.includes('none')) fail();
        const issuerOrigin = publicUrl(selected.issuer).origin;
        for (const endpoint of [authorizationMetadata.authorization_endpoint, authorizationMetadata.token_endpoint,
          ...(authorizationMetadata.revocation_endpoint ? [authorizationMetadata.revocation_endpoint] : [])]) {
          if (publicUrl(endpoint).origin !== issuerOrigin) fail();
        }
        if (context().stamp !== current.stamp) fail();
        const previous = current.registry.providers.find(row => row.config.accountId === current.current.accountId && row.config.providerId === selected.providerId);
        // Preserve every existing credential/revocation owner. Registration cannot orphan its vault scope.
        if (previous) {
          if (current.broker.hasOwner(selected.providerId)) fail();
          const priorStatus = await current.broker.status(selected.providerId);
          if (!['disconnected', 'revoked'].includes(priorStatus.state) || current.broker.hasOwner(selected.providerId)
            || context().stamp !== current.stamp) fail();
        }
        const config = validateProvider({ providerId: selected.providerId, label: selected.label, accountId: current.current.accountId,
          epoch: (previous?.config.epoch ?? 0) + 1, issuer: selected.issuer, resource: selected.resource, clientId: selected.clientId,
          scopes: selected.scopes, authorizationEndpoint: authorizationMetadata.authorization_endpoint,
          ...(selected.redirectUriMode === 'loopback-exact' ? { redirectUriMode: selected.redirectUriMode, redirectUri: selected.redirectUri } : {}),
          tokenEndpoint: authorizationMetadata.token_endpoint,
          ...(authorizationMetadata.revocation_endpoint ? { revocationEndpoint: authorizationMetadata.revocation_endpoint } : {}),
          codeChallengeMethodsSupported: [...authorizationMetadata.code_challenge_methods_supported],
          authorizationResponseIssParameterSupported: authorizationMetadata.authorization_response_iss_parameter_supported === true });
        const row = { config, metadataDigest: hash({ resourceMetadata, authorizationMetadata }),
          registrationEvidenceUrl: selected.registrationEvidenceUrl, resourceMetadataUrl: selected.resourceMetadataUrl,
          authorizationServerMetadataUrl: selected.authorizationServerMetadataUrl };
        const id = randomUUID(), digest = hash({ row, stamp: current.stamp });
        const review = { id, digest, stamp: current.stamp, accountId: current.current.accountId, row };
        reviews.set(id, review); return projectReview(review);
      } catch { throw new Error('OAuth provider review failed; select a valid public registration file and validated metadata'); }
      finally { registrationBusy = false; }
    },
    async request(body) {
      if (!body || typeof body !== 'object' || Array.isArray(body) || !ACTIONS.has(body.action) || Buffer.byteLength(JSON.stringify(body)) > 2048) fail();
      const current = context();
      if (body.action === 'oauthList') { if (!exact(body, ['action'])) fail(); return current.launcher.list(); }
      if (protectedAvailable() !== true || body.explicitUserAction !== true) fail();
      if (body.action === 'oauthRegisterProvider') {
        if (!exact(body, ['action', 'reviewId', 'reviewDigest', 'explicitUserAction']) || registrationBusy) fail();
        const review = reviews.get(body.reviewId);
        if (!review || review.digest !== body.reviewDigest || current.stamp !== review.stamp) fail();
        registrationBusy = true;
        try {
          if (current.configs.some(config => config.providerId === review.row.config.providerId)) {
            if (current.broker.hasOwner(review.row.config.providerId)) fail();
            const priorStatus = await current.broker.status(review.row.config.providerId);
            if (!['disconnected', 'revoked'].includes(priorStatus.state) || current.broker.hasOwner(review.row.config.providerId)
              || context().stamp !== review.stamp) fail();
          }
          commitRegistry(review.stamp, providers => [...providers.filter(row => !(row.config.accountId === review.accountId && row.config.providerId === review.row.config.providerId)), review.row]);
          reviews.delete(review.id);
          return { ...projectReview(review), state: 'registered', authorizationStarted: false, status: status() };
        } catch { throw new Error('OAuth registration not acknowledged; inspect retained registry before retrying'); }
        finally { registrationBusy = false; }
      }
      if (body.action === 'oauthRemoveProvider') {
        if (!exact(body, ['action', 'providerId', 'explicitUserAction']) || !ID.test(body.providerId) || registrationBusy || activeActions) fail();
        const { providerId } = body;
        if (!current.configs.some(config => config.providerId === providerId) || current.broker.hasOwner(providerId)) fail();
        registrationBusy = true;
        try {
          // Deny first, then revoke any held credential. Removal never orphans a protected credential.
          notifyMcpInvalidation(providerId);
          let state = (await current.broker.status(providerId)).state;
          if (!['disconnected', 'revoked'].includes(state)) state = (await current.launcher.revoke({ providerId, explicitUserAction: true })).state;
          if (!['disconnected', 'revoked'].includes(state) || current.broker.hasOwner(providerId)) fail();
          notifyMcpInvalidation(providerId, true);
          commitRegistry(current.stamp, providers => providers.filter(row => !(row.config.accountId === current.current.accountId && row.config.providerId === providerId)));
          for (const [id, review] of reviews) if (review.row.config.providerId === providerId) reviews.delete(id);
          return { providerId, state: 'removed', status: status() };
        } catch { throw new Error('OAuth provider removal not acknowledged; inspect the retained provider status before retrying'); }
        finally { registrationBusy = false; }
      }
      if (!exact(body, ['action', 'providerId', 'explicitUserAction']) || !ID.test(body.providerId)) fail();
      if (registrationBusy) fail();
      const input = { providerId: body.providerId, explicitUserAction: true };
      activeActions++;
      try {
        if (body.action === 'oauthBegin') return await current.launcher.begin(input);
        if (body.action === 'oauthCancel') return await current.launcher.cancel(input);
        if (body.action === 'oauthRefresh') return await current.launcher.refresh(input);
        notifyMcpInvalidation(body.providerId);
        return await current.launcher.revoke(input);
      } catch { throw new Error('OAuth action incomplete; inspect the retained provider status'); }
      finally { activeActions--; }
    },
    /** Trusted reviewed transport only; effect calls additionally require ToolJournal approval. Never sent to core/renderer. */
    async withAccessToken(scope, use) {
      const current = context();
      if (!exact(scope, ['providerId', 'resource', 'accountId', 'epoch']) || current.current.accountId !== scope.accountId
        || current.stamp !== scope.epoch || protectedAvailable() !== true) fail();
      return current.broker.withAccessToken(scope.providerId, scope.resource, use);
    },
    invalidate() { notifyMcpInvalidation(); reviews.clear(); closeOwner(); },
    currentOperation() { return registrationBusy ? 'OAuth provider metadata review or registration'
      : activeActions || owner?.broker.hasOwner() ? 'OAuth provider authorization action' : null; },
    close() { notifyMcpInvalidation(); closed = true; reviews.clear(); closeOwner(); mcpInvalidationListeners.clear(); },
  };
}
module.exports = { createAgentOAuthService, createPublicOAuthFetch, validateRegistrationFile };
