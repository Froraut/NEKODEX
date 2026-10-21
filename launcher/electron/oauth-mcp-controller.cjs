'use strict';
// Trusted main owns reviewed bindings. Renderer selects existing registry IDs, never transport pins.
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { createOAuthMcpProvider } = require('./oauth-mcp-transport.cjs');
const { validateOAuthMcpPin, validateScope, validateInvocation, oauthMcpInvocationHash, digest, canonical, exact } = require('./oauth-mcp-contract.cjs');
const SERVER = 'oauth_mcp_tools';
const fail = () => { throw new Error('Reviewed OAuth MCP binding unavailable; inspect retained status and receipts'); };
function createAgentOAuthMcpController({ coreHome, oauthService, validateTask, validateIntent, providerOptions = {} } = {}) {
  if (!path.isAbsolute(coreHome || '') || typeof oauthService?.reviewedMcpProviders !== 'function'
    || typeof validateTask !== 'function' || typeof validateIntent !== 'function') fail();
  const directory = path.join(coreHome, 'agent-oauth-mcp'), file = path.join(directory, 'bindings.json');
  const providers = new Map(), reviews = new Map(), pending = new Set();
  let closed = false, uncertain = false, changing = false, authorityRevision = 0, state;
  const key = scope => canonical({ taskId: scope.taskId, generation: scope.generation });
  function checkDirectory() {
    const stat = fs.lstatSync(directory);
    if (fs.realpathSync(directory) !== directory || stat.isSymbolicLink() || !stat.isDirectory()
      || process.platform === 'win32' || stat.uid !== process.getuid() || stat.mode & 0o077) fail();
  }
  function read() {
    try {
      checkDirectory();
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try { const stat = fs.fstatSync(fd);
        if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || stat.mode & 0o077 || stat.size > 256 * 1024) fail();
        const value = JSON.parse(fs.readFileSync(fd, 'utf8'));
        if (!exact(value, ['version', 'pins', 'bindings']) || value.version !== 1 || !Array.isArray(value.pins) || value.pins.length > 64
          || !Array.isArray(value.bindings) || value.bindings.length > 64) fail();
        for (const pin of value.pins) validateOAuthMcpPin(pin);
        for (const row of value.bindings) if (!exact(row, ['scope', 'binding']) || !value.pins.some(pin => digest(pin) === row.binding)) fail(); else validateScope(row.scope);
        return value;
      } finally { fs.closeSync(fd); }
    } catch (error) { if (error.code === 'ENOENT') return { version: 1, pins: [], bindings: [] }; throw error; }
  }
  state = read();
  function save(next) {
    if (uncertain || closed || next.pins.length > 64 || next.bindings.length > 64 || Buffer.byteLength(JSON.stringify(next)) > 256 * 1024) fail();
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 }); checkDirectory();
    const receipt = writePrivateFileAtomic(file, JSON.stringify(next) + '\n', { durable: true, warningSink() {} });
    state = next;
    if (receipt.durability !== 'confirmed') { uncertain = true; invalidate(); fail(); }
  }
  function currentProviders() {
    if (closed || uncertain) fail();
    return oauthService.reviewedMcpProviders().map(row => ({ ...row, serverId: SERVER }));
  }
  function pinFor(providerId) {
    const row = currentProviders().find(row => row.providerId === providerId); if (!row) fail();
    const { label, ...pin } = row; return validateOAuthMcpPin({ ...pin, endpoint: pin.resource });
  }
  function currentPin(pin) { const current = pinFor(pin.providerId); if (digest(current) !== digest(pin)) fail(); return current; }
  function attached(pin, scope) {
    if (closed || uncertain || !state.bindings.some(row => row.binding === digest(pin) && key(row.scope) === key(scope))) return false;
    try { currentPin(pin); return true; } catch { return false; }
  }
  function provider(pin) {
    const binding = digest(pin); let value = providers.get(binding);
    if (!value) {
      value = createOAuthMcpProvider({ ...providerOptions, pin, oauthService,
        journalDirectory: path.join(directory, 'receipts', binding), toolNamePrefix: binding.slice(0, 16) + '__',
        getReviewedPin: () => currentPin(pin), isScopeActive: scope => attached(pin, scope) });
      providers.set(binding, value);
    }
    return value;
  }
  function lookup(scope, binding) {
    const row = state.bindings.find(row => key(row.scope) === key(scope) && (!binding || row.binding === binding));
    const pin = state.pins.find(pin => digest(pin) === row?.binding); if (!pin) fail(); return pin;
  }
  function exactRequest(input) {
    if (!exact(input, ['scope', 'tool', 'arguments', 'idempotencyKey'])) fail();
    const binding = input.arguments?.binding;
    const pin = state.pins.find(pin => digest(pin) === binding); if (!pin) fail();
    const request = { ...input, invocationHash: oauthMcpInvocationHash(pin, input) };
    return { pin, request: validateInvocation(pin, request) };
  }
  function track(work) { const promise = Promise.resolve().then(work); pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); return promise; }
  function invalidate(taskId) {
    authorityRevision++; reviews.clear(); for (const value of providers.values()) value.invalidate(taskId);
    // Invalidation is deny-first in memory. Durable binding removal precedes acknowledgement.
    if (taskId === undefined) state = { ...state, bindings: [] };
    else state = { ...state, bindings: state.bindings.filter(row => row.scope.taskId !== taskId) };
    if (!closed && !uncertain && fs.existsSync(file)) save(state);
  }
  function status() {
    let configured = []; try { configured = currentProviders(); } catch {}
    return { providers: configured, bindings: state.bindings.filter(row => {
      const pin = state.pins.find(pin => digest(pin) === row.binding); return pin && attached(pin, row.scope);
    }).map(row => ({ ...structuredClone(row), pin: state.pins.find(pin => digest(pin) === row.binding) })),
    receipts: state.pins.map(pin => ({ binding: digest(pin), providerId: pin.providerId, ...provider(pin).status(), receipts: provider(pin).receipts() })),
    closed, unavailable: uncertain, activeCount: pending.size, toolApprovalRequired: true };
  }
  async function request(body) {
    if (exact(body, ['action']) && body.action === 'oauthMcpStatus') return status();
    if (closed || uncertain || changing || body?.explicitUserAction !== true) fail();
    changing = true;
    try {
      if (body.action === 'oauthMcpReview' && exact(body, ['action', 'providerId', 'scope', 'explicitUserAction'])) {
        const scope = validateScope(body.scope), revision = authorityRevision; await validateTask(scope);
        if (revision !== authorityRevision) fail(); const pin = pinFor(body.providerId);
        if (reviews.size >= 64) fail();
        const reviewId = randomUUID(), reviewDigest = digest({ pin, scope });
        const review = { reviewId, reviewDigest, pin, scope, toolApprovalRequired: true, authorizationStarted: false };
        reviews.set(reviewId, review); return structuredClone(review);
      }
      if (body.action === 'oauthMcpAttach' && exact(body, ['action', 'reviewId', 'reviewDigest', 'explicitUserAction'])) {
        const review = reviews.get(body.reviewId); if (!review || review.reviewDigest !== body.reviewDigest) fail();
        const revision = authorityRevision; await validateTask(review.scope); currentPin(review.pin);
        if (closed || uncertain || revision !== authorityRevision || reviews.get(body.reviewId) !== review) fail();
        const binding = digest(review.pin), next = { ...state,
          pins: state.pins.some(pin => digest(pin) === binding) ? state.pins : [...state.pins, review.pin],
          bindings: [...state.bindings.filter(row => key(row.scope) !== key(review.scope)), { scope: review.scope, binding }] };
        const prior = state.bindings.find(row => key(row.scope) === key(review.scope));
        // Any attachment transition revokes older awaited admissions, including A -> B -> A.
        authorityRevision++;
        state = { ...state, bindings: state.bindings.filter(row => key(row.scope) !== key(review.scope)) };
        if (prior) providers.get(prior.binding)?.invalidateScope(review.scope);
        save(next); provider(review.pin).attachScope(review.scope); reviews.delete(body.reviewId);
        return status();
      }
      if (body.action === 'oauthMcpDisconnect' && exact(body, ['action', 'scope', 'explicitUserAction'])) {
        const scope = validateScope(body.scope), prior = state.bindings.find(row => key(row.scope) === key(scope));
        // Deny first through this actual renderer action, before persistence can fail.
        authorityRevision++; reviews.clear();
        state = { ...state, bindings: state.bindings.filter(row => key(row.scope) !== key(scope)) };
        if (prior) providers.get(prior.binding)?.invalidateScope(scope);
        save(state);
        return status();
      }
      fail();
    } finally { changing = false; }
  }
  const unsubscribe = oauthService.subscribeMcpInvalidation?.((providerId, accountId) => {
    if (closed) return;
    if (providerId === undefined) { invalidate(); return; }
    // An account-scoped retirement drops only that account's pins; otherwise every pin of the provider.
    authorityRevision++; reviews.clear(); const bindings = new Set(state.pins.filter(pin => pin.providerId === providerId
      && (accountId === undefined || pin.accountId === accountId)).map(pin => digest(pin)));
    for (const binding of bindings) providers.get(binding)?.invalidate();
    state = { ...state, bindings: state.bindings.filter(row => !bindings.has(row.binding)) };
    if (!uncertain && fs.existsSync(file)) save(state);
  });
  return Object.freeze({ request, status, invalidate,
    dispatch(action, body) { return track(async () => {
      if (action === 'receipt') { const { pin, request } = exactRequest(body); return provider(pin).reconcile(request) ?? null; }
      if (closed || uncertain) fail();
      if (action === 'invalidate') {
        if (!exact(body, ['taskId']) || typeof body.taskId !== 'string') fail();
        // Internal authenticated core channel can only remove authority, never attach it.
        invalidate(body.taskId); return { invalidated: true };
      }
      if (action === 'discover') {
        if (!exact(body, ['scope'])) fail(); const scope = validateScope(body.scope), revision = authorityRevision; await validateTask(scope);
        if (revision !== authorityRevision) fail();
        const row = state.bindings.find(row => key(row.scope) === key(scope)); if (!row) return [];
        const pin = lookup(scope); currentPin(pin); return provider(pin).discover(scope);
      }
      if (action === 'execute') {
        const { pin, request } = exactRequest(body);
        const prior = provider(pin).reconcile(request); if (prior) return prior;
        const revision = authorityRevision; await validateTask(request.scope); await validateIntent(body);
        if (revision !== authorityRevision || !attached(pin, request.scope)) fail();
        return provider(pin).execute(request);
      }
      fail();
    }); },
    currentOperation() { return changing || pending.size ? 'OAuth MCP binding or bounded transport observation' : null; },
    async close() {
      if (closed) return; let failure;
      try { invalidate(); } catch (error) { failure = error; }
      closed = true; unsubscribe?.();
      await Promise.allSettled([...pending]);
      const results = await Promise.allSettled([...providers.values()].map(value => value.close()));
      if (failure) throw failure;
      const rejected = results.find(row => row.status === 'rejected'); if (rejected) throw rejected.reason;
    },
  });
}
module.exports = { createAgentOAuthMcpController };
