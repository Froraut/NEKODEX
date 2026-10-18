'use strict';
const { createHash } = require('node:crypto');
const { AGENT_NATIVE_PROTOCOL, AGENT_NATIVE_OUTPUT_SCHEMA_ID, AGENT_NATIVE_OUTPUT_SCHEMA,
  AGENT_NATIVE_OUTPUT_SCHEMA_HASH, AGENT_NATIVE_TEXT_BYTES, AGENT_NATIVE_ENVELOPE_BYTES, isAgentNativeHistorySource } = require('./agent-native-protocol.cjs');

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const HASH = /^[a-f0-9]{64}$/;
const STATES = new Set(['prepared', 'offered', 'acknowledged', 'completed', 'failed', 'unknown']);
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const digest = value => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const exactDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : plain(value)
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);
const closedKeys = (value, required) => plain(value) && Object.keys(value).length === required.length && required.every(key => Object.hasOwn(value, key));
const identity = value => typeof value === 'string' && !!value.trim() && value.length <= 200 && !/[\u0000-\u001f]/u.test(value);
const scopeKeys = ['taskId', 'familyId', 'generation', 'revision', 'dispatchId', 'ownerId', 'agentWorkerId'];
function scopeValid(scope) {
  return closedKeys(scope, scopeKeys) && ['taskId', 'familyId', 'ownerId', 'agentWorkerId'].every(key => identity(scope[key]))
    && UUID.test(scope.dispatchId) && [scope.generation, scope.revision].every(value => Number.isSafeInteger(value) && value > 0);
}
const sameScope = (a, b) => scopeKeys.every(key => a[key] === b[key]);
function validateEnvelope(value) {
  if (!closedKeys(value, ['version', 'protocol', 'actionId', 'scope', 'model', 'admissionId', 'outputSchemaId', 'outputSchemaHash', 'authorship', 'text', 'continuation'])
    || value.version !== 1 || value.protocol !== AGENT_NATIVE_PROTOCOL || !scopeValid(value.scope) || value.actionId !== value.scope.dispatchId
    || !UUID.test(value.actionId) || !identity(value.model) || !identity(value.admissionId)
    || value.outputSchemaId !== AGENT_NATIVE_OUTPUT_SCHEMA_ID || value.outputSchemaHash !== AGENT_NATIVE_OUTPUT_SCHEMA_HASH
    || value.authorship !== 'automatic-host' || typeof value.text !== 'string' || !value.text.trim()
    || Buffer.byteLength(value.text) > AGENT_NATIVE_TEXT_BYTES || Buffer.byteLength(JSON.stringify(value)) > AGENT_NATIVE_ENVELOPE_BYTES) throw new Error('Invalid closed Agent Native offer');
  if (value.continuation !== null && (!closedKeys(value.continuation, ['workerBindingId', 'workerGeneration', 'previousNativeTurnReceiptId'])
    || !identity(value.continuation.workerBindingId) || !identity(value.continuation.previousNativeTurnReceiptId)
    || !Number.isSafeInteger(value.continuation.workerGeneration) || value.continuation.workerGeneration < 1)) throw new Error('Invalid exact Native continuation');
  return structuredClone(value);
}
/** Fixed structural compiler for the one shared schema. No generic schema selection or AJV dependency. */
function compileAgentNativeOutputSchema(schema) {
  if (!plain(schema) || exactDigest(schema) !== AGENT_NATIVE_OUTPUT_SCHEMA_HASH) throw new Error('Native bridge accepts only its fixed output schema');
  return value => closedKeys(value, ['protocol', 'kind', 'requestId', 'toolId', 'argumentsJson', 'summary'])
    && value.protocol === AGENT_NATIVE_PROTOCOL && ['tool_request', 'final'].includes(value.kind)
    && ['requestId', 'toolId', 'argumentsJson', 'summary'].every(key => value[key] === null || typeof value[key] === 'string');
}
const leafSchemaHash = digest(canonical(AGENT_NATIVE_OUTPUT_SCHEMA));
function uuidFor(value) {
  const bytes = createHash('sha256').update(canonical(value)).digest().subarray(0, 16);
  bytes[6] = bytes[6] & 15 | 80; bytes[8] = bytes[8] & 63 | 128;
  const hex = bytes.toString('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** Main-only projection of one existing durable Native leaf per deterministic task binding.
 * Claim validation precedes creation. Reads/waits cannot create, submit, adopt or cancel work. */
function createAgentNativeBridge(options = {}) {
  if (typeof options.resolveAdmission !== 'function' || typeof options.validateOffer !== 'function' || typeof options.canStart !== 'function') throw new Error('Trusted Native bridge owners are required');
  const waitMs = options.waitMs ?? 20_000;
  if (!Number.isInteger(waitMs) || waitMs < 1 || waitMs > 60_000) throw new Error('Invalid Native receipt wait bound');
  const actions = new Map(), bindings = new Map(), epochs = new Map(), generationFences = new Map();
  let destroyed = false, closing;
  function base(entry) {
    const e = entry.envelope;
    return { version: 1, actionId: e.actionId, scope: structuredClone(e.scope), model: e.model, admissionId: e.admissionId,
      outputSchemaId: AGENT_NATIVE_OUTPUT_SCHEMA_ID, payloadDigest: entry.payloadDigest, revision: 0,
      state: 'prepared', ownerHeld: false, writeDisposition: 'not-written', workerBindingId: null, workerGeneration: null,
      nativeTurnReceiptId: null, acceptanceReceipt: null, inputAuthorship: 'automatic-host' };
  }
  function publish(entry, changes) {
    const next = { ...(entry.receipt ?? base(entry)), ...changes };
    const comparable = value => { const copy = { ...value }; delete copy.revision; return JSON.stringify(copy); };
    if (entry.receipt && comparable(entry.receipt) === comparable(next)) return entry.receipt;
    if (entry.receipt?.revision >= 64) return entry.receipt; // Preserve retained facts instead of erasing old revisions.
    next.revision = (entry.receipt?.revision ?? 0) + 1; entry.receipt = structuredClone(next);
    for (const observer of entry.observers) { try { observer(structuredClone(next)); } catch { /* Observation cannot replay delivery. */ } }
    for (const waiter of [...entry.waiters]) waiter();
    return entry.receipt;
  }
  function knownUnsent(entry) { return publish(entry, { state: 'not_sent', ownerHeld: false, writeDisposition: 'not-written', assistantText: undefined }); }
  function unknown(entry, held = false) { return publish(entry, { state: 'unknown', ownerHeld: held, writeDisposition: entry.receipt?.writeDisposition === 'written' ? 'written' : 'unknown', assistantText: undefined }); }
  function bindingIdentity(e) {
    return digest(['agent-native-binding-v1', e.scope.taskId, e.scope.familyId, e.scope.generation, e.scope.agentWorkerId, e.admissionId, e.model]);
  }
  function fenced(scope) { return scope.generation < (generationFences.get(JSON.stringify([scope.taskId, scope.familyId])) ?? 0); }
  function project(entry, binding, row) {
    const held = () => Boolean(entry.receipt?.ownerHeld || row?.ownerHeld || binding.service?.currentOperation?.());
    if (!plain(row) || row.kind !== 'offer' || row.actionId !== entry.envelope.actionId || row.admissionId !== entry.envelope.admissionId
      || row.workerHandle !== binding.workerHandle || row.threadId !== binding.threadId || row.inputHash !== digest(entry.envelope.text)
      || row.schemaHash !== leafSchemaHash || row.inputAuthorship !== 'automatic-host' || !STATES.has(row.state) || typeof row.ownerHeld !== 'boolean'
      || !Array.isArray(row.observations) || !row.observations.length || row.observations.length > 32) return unknown(entry, held());
    const leafRevision = row.observations.length, fingerprint = exactDigest(row);
    if (entry.leafRevision > leafRevision) return entry.receipt;
    if (entry.leafRevision === leafRevision && entry.leafFingerprint !== fingerprint) return unknown(entry, held());
    entry.leafRevision = leafRevision; entry.leafFingerprint = fingerprint;
    const hasTurn = typeof row.turnId === 'string' && UUID.test(row.turnId);
    const turnReceipt = hasTurn ? `native-turn:${digest([row.actionId, row.workerHandle, row.threadId, row.turnId, row.inputHash, row.schemaHash])}` : null;
    const acknowledged = hasTurn && ['acknowledged', 'completed', 'failed', 'unknown'].includes(row.state);
    const possibleWrite = row.state !== 'prepared' || row.observations?.some(fact => ['offered', 'acknowledged'].includes(fact.state));
    const changes = { state: row.state, ownerHeld: row.ownerHeld, writeDisposition: acknowledged ? 'written' : possibleWrite ? 'unknown' : 'not-written',
      workerBindingId: binding.id, workerGeneration: binding.generation, nativeTurnReceiptId: turnReceipt,
      acceptanceReceipt: acknowledged ? `native-accept:${digest([entry.envelope.actionId, binding.id, binding.generation, turnReceipt])}` : null,
      assistantText: undefined, canonicalFinal: undefined };
    // A retirement journal fact can precede process shutdown. Keep an uncertain offer
    // held until this exact physical close confirms release; canonical terminals remain facts.
    if (binding.retired && !binding.closed && row.state === 'unknown' && !row.ownerHeld && entry.receipt?.ownerHeld) changes.ownerHeld = true;
    if (row.state === 'completed') {
      const items = row.canonicalItems;
      const user = Array.isArray(items) && items.some(item => item.role === 'user' && item.authorship === 'automatic-host' && item.turnId === row.turnId && item.text === entry.envelope.text);
      const finals = Array.isArray(items) ? items.filter(item => item.role === 'assistant' && item.authorship === 'native-assistant' && item.turnId === row.turnId && [null, undefined, 'final_answer'].includes(item.phase)) : [];
      const final = finals.at(-1);
      if (!acknowledged || row.ownerHeld || !user || !final || typeof final.text !== 'string' || Buffer.byteLength(final.text) > AGENT_NATIVE_TEXT_BYTES) return unknown(entry, held());
      changes.assistantText = final.text;
      if (binding.historySource && identity(final.messageId) && Number.isSafeInteger(final.timestampMs) && final.timestampMs >= 0) {
        changes.canonicalFinal = { source: structuredClone(binding.historySource), messageId: final.messageId, turnId: row.turnId,
          threadId: row.threadId, timestampMs: final.timestampMs, rawTextSha256: digest(final.text) };
      }
    }
    const receipt = publish(entry, changes);
    if (receipt.state === 'unknown' && !receipt.ownerHeld) binding.unsettled = true;
    if (['completed', 'failed'].includes(receipt.state)) binding.lastAction = entry.envelope.actionId;
    return receipt;
  }
  async function retire(binding) {
    if (binding.retiring) return binding.retiring;
    binding.retired = true;
    binding.retirementActionId ??= hostAction('retire', binding);
    binding.retiring = (async () => {
      let retirementError;
      try {
        if (binding.creating) { try { await binding.creating; } catch { /* Creation journal remains inspectable. */ } }
        const handle = binding.workerHandle ?? binding.service.inspectOwnedWorker().workerHandle;
        if (!binding.retirementSettled && handle && UUID.test(handle)) {
          const snapshot = await binding.service.retireOwnedWorker({ workerHandle: handle, actionId: binding.retirementActionId });
          for (const row of snapshot.receipts ?? []) {
            const entry = actions.get(row.actionId);
            if (entry?.binding === binding && row.kind === 'offer') project(entry, binding, row);
          }
          binding.retirementSettled = true;
        }
      } catch (error) { retirementError = error; }
      // Even a failed retirement must close this exact owner. It never opens another service.
      try {
        if (!binding.closed) { await binding.service.destroy(); binding.closed = true; }
        binding.unsettled = false;
        // A malformed/unprojectable leaf row cannot keep a successfully closed physical
        // owner held forever. Release only this exact binding, without claiming success,
        // not-sent delivery or changing the previously observed write disposition.
        for (const entry of actions.values()) if (entry.binding === binding && entry.receipt?.ownerHeld) {
          publish(entry, { state: 'unknown', ownerHeld: false, writeDisposition: entry.receipt.writeDisposition, assistantText: undefined });
        }
      } catch (error) { binding.unsettled = true; throw error; }
      if (retirementError) { binding.unsettled = true; throw retirementError; }
    })().catch(error => {
      // Keep the retired fence, exact journal action and any confirmed physical close.
      // Only the failed cleanup may retry; concurrent callers share the current attempt.
      binding.retiring = undefined; throw error;
    });
    return binding.retiring;
  }
  function hostAction(kind, binding) {
    for (let salt = 0; salt < 512; salt++) {
      const actionId = uuidFor([kind, binding.id, binding.generation, salt]);
      if (!actions.has(actionId) && actionId !== binding.createActionId) return actionId;
    }
    throw new Error('Native host action identity capacity reached');
  }
  async function execute(entry) {
    const e = entry.envelope; const epoch = epochs.get(e.scope.taskId) ?? 0;
    let binding, possibleOffer = false;
    try {
      if (destroyed || fenced(e.scope) || !options.canStart()) return knownUnsent(entry);
      const claim = await options.validateOffer(structuredClone(e), entry.payloadDigest);
      if (claim !== true && (!plain(claim) || claim.payloadDigest !== entry.payloadDigest || !scopeValid(claim.scope) || !sameScope(claim.scope, e.scope))) return knownUnsent(entry);
      if (destroyed || fenced(e.scope) || !options.canStart() || (epochs.get(e.scope.taskId) ?? 0) !== epoch) return knownUnsent(entry);
      // Publish the durably claimed host intent before potentially long startup. HTTP may
      // finish this observation while the same operation continues; it must never re-offer.
      publish(entry, { state: 'prepared', ownerHeld: false, writeDisposition: 'not-written' });
      const admission = await options.resolveAdmission(e.admissionId, e.model);
      if (!admission || typeof admission.createWorker !== 'function') return knownUnsent(entry);
      if (admission.historySource !== undefined && !isAgentNativeHistorySource(admission.historySource)) return knownUnsent(entry);
      if (destroyed || fenced(e.scope) || !options.canStart() || (epochs.get(e.scope.taskId) ?? 0) !== epoch) return knownUnsent(entry);
      const key = bindingIdentity(e); binding = bindings.get(key);
      if (e.continuation) {
        const prior = binding && actions.get(binding.lastAction);
        if (!binding || binding.retired || binding.busy || !prior || prior.receipt?.state !== 'completed' || prior.receipt.ownerHeld
          || e.continuation.workerBindingId !== binding.id || e.continuation.workerGeneration !== binding.generation
          || e.continuation.previousNativeTurnReceiptId !== prior.receipt.nativeTurnReceiptId) return knownUnsent(entry);
      } else if (binding) return knownUnsent(entry); // Reuse requires the exact previous turn receipt.
      if (!binding) {
        if (bindings.size >= 32) return knownUnsent(entry);
        binding = { id: `native-binding:${key}`, generation: 1, taskId: e.scope.taskId, familyId: e.scope.familyId, taskGeneration: e.scope.generation,
          key, busy: true, retired: false, closed: false, historySource: admission.historySource ? structuredClone(admission.historySource) : undefined };
        bindings.set(key, binding);
        const context = Object.freeze({ workerBindingId: binding.id, workerGeneration: binding.generation, taskId: e.scope.taskId, familyId: e.scope.familyId,
          generation: e.scope.generation, agentWorkerId: e.scope.agentWorkerId, admissionId: e.admissionId, model: e.model });
        binding.service = admission.createWorker(context, row => {
          if (row?.kind !== 'offer') return;
          const matched = actions.get(row.actionId);
          if (matched?.binding === binding) project(matched, binding, row);
        });
        if (!binding.service || !['inspectOwnedWorker', 'createOwnedWorker', 'offerOwnedTurn', 'retireOwnedWorker', 'destroy'].every(name => typeof binding.service[name] === 'function')) throw new Error('Native admission did not supply its owned leaf');
        entry.binding = binding;
        const snapshot = binding.service.inspectOwnedWorker();
        // Stable binding directories must retain the leaf journal. A recreated main never
        // adopts/restarts an old worker, even when its old terminal fields look plausible.
        if (snapshot.receipts.length || !snapshot.availability.available || snapshot.storageOwner !== 'unclaimed') {
          binding.retired = true;
          if (snapshot.receipts.length || snapshot.storageOwner !== 'unclaimed') return unknown(entry, false);
          return knownUnsent(entry);
        }
        binding.createActionId = hostAction('create', binding);
        binding.creating = binding.service.createOwnedWorker({ actionId: binding.createActionId }).then(created => {
          if (!UUID.test(created.workerHandle) || !UUID.test(created.threadId) || created.admissionId !== e.admissionId || created.receipt?.state !== 'completed' || created.receipt.kind !== 'create'
            || created.receipt.workerHandle !== created.workerHandle || created.receipt.threadId !== created.threadId || created.receipt.actionId !== binding.createActionId) throw new Error('Native creation receipt changed owner');
          binding.workerHandle = created.workerHandle; binding.threadId = created.threadId; return created;
        });
        await binding.creating;
      } else { binding.busy = true; entry.binding = binding; }
      if (destroyed || binding.retired || fenced(e.scope) || !options.canStart() || (epochs.get(e.scope.taskId) ?? 0) !== epoch) { await retire(binding); return knownUnsent(entry); }
      // A different Bun owner or a stopped claim can supersede us while startup awaits.
      // Re-read its exact durable authority, then recheck local fences after that await.
      const finalClaim = await options.validateOffer(structuredClone(e), entry.payloadDigest);
      if (finalClaim !== true && (!plain(finalClaim) || finalClaim.payloadDigest !== entry.payloadDigest || !scopeValid(finalClaim.scope) || !sameScope(finalClaim.scope, e.scope))
        || destroyed || binding.retired || fenced(e.scope) || !options.canStart() || (epochs.get(e.scope.taskId) ?? 0) !== epoch) {
        await retire(binding); return knownUnsent(entry);
      }
      possibleOffer = true;
      const row = await binding.service.offerOwnedTurn({ workerHandle: binding.workerHandle, actionId: e.actionId, text: e.text, outputSchema: AGENT_NATIVE_OUTPUT_SCHEMA });
      return project(entry, binding, row);
    } catch {
      if (binding && !possibleOffer && binding.service) { try { await retire(binding); } catch { return unknown(entry, true); } }
      if (binding && possibleOffer) binding.unsettled = true;
      return possibleOffer ? unknown(entry, Boolean(entry.receipt?.ownerHeld)) : knownUnsent(entry);
    } finally { if (binding) binding.busy = false; }
  }
  function lookup(value) {
    if (!closedKeys(value, ['actionId', 'scope', 'payloadDigest']) || !UUID.test(value.actionId) || !scopeValid(value.scope) || value.actionId !== value.scope.dispatchId || !HASH.test(value.payloadDigest)) throw new Error('Invalid exact Native receipt lookup');
    const entry = actions.get(value.actionId);
    if (!entry) return;
    if (entry.payloadDigest !== value.payloadDigest || !sameScope(entry.envelope.scope, value.scope)) throw new Error('Native receipt lookup owner conflict');
    return entry;
  }
  function observed(promise, signal) {
    if (!signal) return promise;
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => { signal.removeEventListener('abort', abort); reject(signal.reason ?? new Error('Native observation cancelled')); };
      signal.addEventListener('abort', abort, { once: true });
      promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    });
  }
  return Object.freeze({
    async offer(value, control = {}) {
      const envelope = validateEnvelope(value), payloadDigest = exactDigest(envelope);
      if (control.payloadDigest !== undefined && control.payloadDigest !== payloadDigest) throw new Error('Native offer payload digest mismatch');
      if (control.onReceipt !== undefined && typeof control.onReceipt !== 'function') throw new Error('Invalid Native receipt observer');
      let entry = actions.get(envelope.actionId);
      if (entry && (entry.payloadDigest !== payloadDigest || !sameScope(entry.envelope.scope, envelope.scope))) throw new Error('Native action identity conflict');
      if (!entry) {
        if (actions.size >= 256) throw new Error('Native bridge retained receipt capacity reached');
        entry = { envelope, payloadDigest, observers: new Set(), waiters: new Set() }; actions.set(envelope.actionId, entry);
        entry.operation = Promise.resolve().then(() => execute(entry)).finally(() => { entry.settled = true; });
      }
      if (control.onReceipt) { if (entry.observers.size >= 32) throw new Error('Native observation bound exceeded'); entry.observers.add(control.onReceipt); }
      try {
        const receipt = entry.operation ? await observed(entry.operation, control.signal) : entry.receipt;
        return structuredClone(entry.receipt ?? receipt);
      } finally { if (control.onReceipt) entry.observers.delete(control.onReceipt); }
    },
    async readReceipt(value, control = {}) { control.signal?.throwIfAborted(); const entry = lookup(value); return entry?.receipt ? structuredClone(entry.receipt) : undefined; },
    async waitReceipt(value, control = {}) {
      if (!plain(value) || !Number.isSafeInteger(value.afterRevision) || value.afterRevision < 0) throw new Error('Invalid Native observation revision');
      const { afterRevision, ...key } = value; const entry = lookup(key); control.signal?.throwIfAborted();
      if (!entry) throw new Error('Native receipt owner is unavailable; replay is forbidden');
      if (entry.receipt?.revision > afterRevision) return structuredClone(entry.receipt);
      if (entry.waiters.size >= 32) throw new Error('Native receipt waiter bound exceeded');
      return new Promise((resolve, reject) => {
        const done = (value, error) => { clearTimeout(timer); entry.waiters.delete(wake); control.signal?.removeEventListener('abort', abort); if (error) reject(error); else resolve(value); };
        const wake = () => { if (entry.receipt?.revision > afterRevision) done(structuredClone(entry.receipt)); };
        const abort = () => done(undefined, control.signal.reason ?? new Error('Native observation cancelled'));
        const timer = setTimeout(() => done(undefined), waitMs);
        entry.waiters.add(wake); control.signal?.addEventListener('abort', abort, { once: true });
        if (control.signal?.aborted) abort(); else wake();
      });
    },
    status() {
      return { destroyed, activeCount: [...bindings.values()].filter(binding => binding.busy || binding.unsettled || binding.retiring && !binding.closed
        || [...actions.values()].some(entry => entry.binding === binding && entry.receipt?.ownerHeld)).length
        + [...actions.values()].filter(entry => !entry.binding && !entry.settled).length,
      bindings: [...bindings.values()].map(binding => ({ workerBindingId: binding.id, workerGeneration: binding.generation, taskId: binding.taskId,
        familyId: binding.familyId, taskGeneration: binding.taskGeneration, retired: binding.retired, closed: binding.closed })),
      receipts: [...actions.values()].filter(entry => entry.receipt).map(entry => { const { assistantText, ...receipt } = entry.receipt; return structuredClone(receipt); }),
      restartRecovery: 'unavailable-without-durable-binding-metadata' };
    },
    async invalidateTask(taskId, filter) {
      if (!identity(taskId)) throw new Error('Invalid Native task identity');
      if (filter !== undefined) {
        if (!closedKeys(filter, ['familyId', 'beforeGeneration']) || !identity(filter.familyId) || !Number.isSafeInteger(filter.beforeGeneration) || filter.beforeGeneration < 1) throw new Error('Invalid Native generation retirement fence');
        const key = JSON.stringify([taskId, filter.familyId]);
        if (!generationFences.has(key) && generationFences.size >= 512) throw new Error('Native retirement fence capacity reached');
        generationFences.set(key, Math.max(generationFences.get(key) ?? 0, filter.beforeGeneration));
      } else epochs.set(taskId, (epochs.get(taskId) ?? 0) + 1);
      const results = await Promise.allSettled([...bindings.values()].filter(binding => binding.taskId === taskId && binding.service
        && (!filter || binding.familyId === filter.familyId && binding.taskGeneration < filter.beforeGeneration)).map(retire));
      if (results.some(result => result.status === 'rejected')) throw new Error('Owned Native retirement did not settle');
    },
    destroy() {
      if (closing) return closing; destroyed = true;
      for (const taskId of new Set([...actions.values()].map(entry => entry.envelope.scope.taskId))) epochs.set(taskId, (epochs.get(taskId) ?? 0) + 1);
      closing = (async () => {
        const results = await Promise.allSettled([...bindings.values()].filter(binding => binding.service).map(retire));
        await Promise.allSettled([...actions.values()].map(entry => entry.operation));
        if (results.some(result => result.status === 'rejected')) throw new Error('Owned Native shutdown did not settle');
      })().catch(error => { closing = undefined; throw error; }); return closing;
    },
  });
}
module.exports = { createAgentNativeBridge, compileAgentNativeOutputSchema };
