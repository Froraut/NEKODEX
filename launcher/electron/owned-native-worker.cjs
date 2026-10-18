'use strict';
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { StringDecoder } = require('node:string_decoder');
const { DETACH_OWNED_CHILD, terminateOwnedProcessTree } = require('./process-tree.cjs');
const { makeAdmission, digest, canonical, fail, plain, freeze } = require('./owned-native-admission.cjs');
const { createOwnedNativeJournal, uuid } = require('./owned-native-journal.cjs');
const { prepareOwnedNativeInput } = require('./owned-native-images.cjs');
const MAX_LINE = 1024 * 1024, MAX_TEXT = 128 * 1024, MAX_PAGE = 384 * 1024;
const safeId = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value);
const number = value => Number.isSafeInteger(value) && value >= 0;

// Private transport: no exported arbitrary-RPC API, no proxy, no process-global sender.
function createTransport({ admitted, requestTimeoutMs, stopGraceMs, onNotification, onFailure, onClosed,
  spawnProcess = spawn, terminateProcess = terminateOwnedProcessTree }) {
  let child, failure, closing, nextId = 1, buffer = '', bytes = 0, closed = false, retirementRequested = false;
  const decoder = new StringDecoder('utf8'), pending = new Map();
  let resolveClosed; const closedPromise = new Promise(resolve => { resolveClosed = resolve; });
  function poison(reason) {
    if (failure) return;
    failure = reason;
    for (const row of pending.values()) row.reject(reason);
    pending.clear(); onFailure(reason);
  }
  function write(value) {
    if (failure || closed || !child) throw failure || fail('client_closed', 'Native worker is closed');
    const line = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(line) > MAX_LINE) throw fail('request_too_large', 'Native request exceeds its bound');
    child.stdin.write(line, reason => { if (reason) poison(fail('transport_error', 'Native input stream failed')); });
  }
  function request(method, params, beforeWrite, onWaitTimeout) {
    if (failure) return Promise.reject(failure);
    if (pending.size >= 8) return Promise.reject(fail('too_many_requests', 'Native request bound exceeded'));
    return new Promise((resolve, reject) => {
      const id = nextId++;
      let timer;
      const settle = (callback, value) => { pending.delete(id); clearTimeout(timer); callback(value); };
      pending.set(id, { resolve: value => settle(resolve, value), reject: reason => settle(reject, reason) });
      timer = setTimeout(() => {
        if (onWaitTimeout) onWaitTimeout(); // A mutation wait does not cancel its physical owner or correlation.
        else pending.get(id)?.reject(fail('rpc_timeout', 'Native request receipt is unavailable'));
      }, requestTimeoutMs);
      try {
        if (Buffer.byteLength(JSON.stringify({ id, method, params })) + 1 > (method === 'turn/start' ? 512 * 1024 : MAX_LINE)) throw fail('request_too_large', 'Native request exceeds its bound');
        beforeWrite?.(id); write({ id, method, params });
      } catch (reason) { pending.get(id)?.reject(reason); }
    });
  }
  function consume(chunk) {
    const text = decoder.write(chunk);
    let offset = 0;
    while (offset < text.length && !failure) {
      const newline = text.indexOf('\n', offset), end = newline < 0 ? text.length : newline;
      const part = text.slice(offset, end); bytes += Buffer.byteLength(part);
      if (bytes > MAX_LINE) { poison(fail('response_too_large', 'Native response exceeds its bound')); void destroy(); return; }
      buffer += part;
      if (newline < 0) return;
      const line = buffer; buffer = ''; bytes = 0; offset = newline + 1;
      if (!line.trim()) continue;
      let value;
      try { value = JSON.parse(line); } catch { poison(fail('invalid_response', 'Native RPC JSON is invalid')); void destroy(); return; }
      if (!plain(value)) { poison(fail('invalid_response', 'Native RPC envelope is invalid')); void destroy(); return; }
      if (typeof value.method === 'string') {
        if (Object.hasOwn(value, 'id')) {
          // Denial is an RPC error, never a default approval or tool implementation.
          try { write({ id: value.id, error: { code: -32601, message: 'Unsupported by inference-only owner' } }); } catch { /* already poisoned */ }
          poison(fail('unsupported_server_request', 'Native requested unsupported client authority')); void destroy(); return;
        }
        try { onNotification(value.method, value.params); }
        catch { poison(fail('invalid_event', 'Native event failed the owned contract')); void destroy(); return; }
        continue;
      }
      const row = pending.get(value.id); if (!row) continue;
      if (plain(value.error)) row.reject(Object.assign(fail('rpc_rejected', 'Native rejected the request'), { authoritative: true }));
      else if (Object.hasOwn(value, 'result')) row.resolve(value.result);
      else row.reject(fail('invalid_response', 'Native RPC response is invalid'));
    }
  }
  async function connect() {
    child = spawnProcess(admitted.executable, admitted.args, { cwd: admitted.paths.cwd,
      env: admitted.environment, stdio: ['pipe', 'pipe', 'pipe'], detached: DETACH_OWNED_CHILD, windowsHide: true });
    child.stderr.on('data', () => {}); child.stderr.on('error', () => {});
    child.stdin.on('error', () => poison(fail('transport_error', 'Native input stream failed')));
    child.stdout.on('data', consume); child.stdout.on('error', () => poison(fail('transport_error', 'Native output stream failed')));
    child.once('error', () => poison(fail('spawn_failed', 'Native worker could not start')));
    child.once('close', () => { closed = true; buffer = ''; bytes = 0; poison(fail('client_closed', 'Native worker closed')); resolveClosed(); onClosed?.(); });
    const response = await request('initialize', { clientInfo: { name: 'nekodex-owned-native', title: 'NEKODEX', version: '1' },
      capabilities: { experimentalApi: false, requestAttestation: false } });
    if (response?.codexHome !== admitted.paths.codexHome || typeof response.userAgent !== 'string'
      || response.userAgent.length > 4096) {
      throw fail('initialize_mismatch', 'Native worker did not confirm its admitted version and profile');
    }
    write({ method: 'initialized', params: {} });
  }
  async function wait(ms) {
    if (closed) return true;
    let timer; try { return await Promise.race([closedPromise.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), ms); })]); }
    finally { clearTimeout(timer); }
  }
  function destroy() {
    if (closing) return closing;
    retirementRequested = true;
    closing = (async () => {
      if (!child || closed) return;
      poison(fail('client_closed', 'Native worker is retiring'));
      child.stdin.end();
      if (await wait(stopGraceMs)) return;
      terminateProcess(child, 'SIGTERM'); if (await wait(stopGraceMs)) return;
      terminateProcess(child, 'SIGKILL'); if (!await wait(stopGraceMs)) throw fail('process_not_settled', 'Owned native process did not settle');
    })().catch(reason => { closing = undefined; throw reason; });
    // A stream callback can initiate teardown; caller still awaits the same rejecting promise.
    closing.catch(() => {}); return closing;
  }
  return { connect, request, destroy, get closed() { return closed; }, get pid() { return child?.pid ?? null; }, get cleanupPending() { return retirementRequested && !!child && !closed; } };
}

function createWorkerService(options = {}, shared) {
  const { onReceipt, compileOutputSchema, requestTimeoutMs = 15_000, terminalTimeoutMs = 120_000, stopGraceMs = 1000, testHooks = {} } = options;
  for (const [value, max] of [[requestTimeoutMs, 120_000], [terminalTimeoutMs, 600_000], [stopGraceMs, 10_000]]) {
    if (!Number.isSafeInteger(value) || value < 1 || value > max) throw fail('invalid_admission', 'Invalid native lifetime bound');
  }
  const admission = shared?.admission ?? makeAdmission(options);
  const journal = createOwnedNativeJournal({ directory: admission.paths.journal, admissionId: admission.admissionId });
  let worker = null, state = 'disconnected', busy = null, active = null, destroyed = false, closing;
  const notify = receipt => {
    try { const value = onReceipt?.(structuredClone(receipt)); if (value?.catch) value.catch(() => {}); }
    catch { /* Receipt is durable; observer failure is not authority to repeat a turn. */ }
    return receipt;
  };
  function update(actionId, change) { return notify(journal.update(actionId, change)); }
  function inspectOwnedWorker(handle) {
    if (handle !== undefined) uuid(handle);
    const receipts = journal.snapshot().filter(row => !handle || row.workerHandle === handle);
    let availability = admission.availability();
    const storageOwner = journal.ownerStatus();
    if (availability.available && ['stale', 'elsewhere-or-unverified'].includes(storageOwner)) {
      availability = { available: false, reasonCode: storageOwner === 'stale' ? 'stale_owner_recovery_required' : 'owner_exists' };
    }
    return { availability, storageOwner, scope: 'private-owned-ephemeral', delivery: shared ? 'qualified-account' : 'local-fixture-only',
      state, workerHandle: worker?.handle || null, threadId: worker?.threadId || null,
      admissionId: admission.admissionId, receipts,
      capabilities: { textInput: true, imageInput: admission.imageInput === true, nativeTools: false, foreignThreadAdoption: false, replay: false, realProviderVerified: false } };
  }
  function unknown(reasonCode) {
    if (!active) return;
    const offer = active; active = null; clearTimeout(offer.timer); state = 'unknown';
    let receipt;
    try { receipt = update(offer.row.actionId, { state: 'unknown', ownerHeld: false, reasonCode }); }
    catch { receipt = { ...offer.row, state: 'unknown', ownerHeld: false, reasonCode: 'receipt_not_saved' }; }
    offer.resolve(receipt);
  }
  function held(reasonCode) {
    if (!active) return;
    const offer = active; clearTimeout(offer.timer); state = 'unknown';
    try { offer.row = update(offer.row.actionId, { state: 'unknown', ownerHeld: true, reasonCode }); }
    catch { offer.row = { ...offer.row, state: 'unknown', ownerHeld: true, reasonCode: 'receipt_not_saved' }; }
    // Return an observation receipt but retain exact native ownership, queue and
    // late ACK/terminal correlation. No replay, new offer or worker recreation.
    offer.resolve(structuredClone(offer.row));
  }
  function canonicalItem(item, params, offer) {
    if (!safeId(item?.id) || !number(params.completedAtMs)) throw fail('invalid_event', 'Native item identity or timestamp is invalid');
    let text, role, authorship;
    if (item.type === 'userMessage') {
      if (offer.row.imageAttachments?.length) {
        // An uploaded fileId, omitted media, changed bytes/detail/order, or a
        // text-only echo cannot prove the typed image that this owner offered.
        if (item.clientId !== offer.row.clientUserMessageId || canonical(item.content) !== canonical(offer.input)) {
          throw fail('canonical_image_mismatch', 'Native canonical image identity is unavailable');
        }
        text = offer.input[0].text; role = 'user'; authorship = 'automatic-host';
      } else {
        if (item.clientId !== offer.row.clientUserMessageId || !Array.isArray(item.content)
          || item.content.length !== 1 || item.content[0]?.type !== 'text' || typeof item.content[0]?.text !== 'string') {
          throw fail('invalid_event', 'Native input item is not the admitted automatic request');
        }
        text = item.content[0].text; role = 'user'; authorship = 'automatic-host';
        if (digest(text) !== offer.row.inputHash) throw fail('invalid_event', 'Native canonical input changed');
      }
    } else { text = item.text; role = 'assistant'; authorship = 'native-assistant'; }
    if (typeof text !== 'string' || Buffer.byteLength(text) > MAX_TEXT) throw fail('invalid_event', 'Native canonical text exceeds its bound');
    return { messageId: item.id, turnId: params.turnId, role, text, timestampMs: params.completedAtMs,
      authorship, ...(role === 'assistant' ? { phase: item.phase ?? null } : {}),
      ...(role === 'user' && offer.row.imageAttachments?.length ? { imageAttachments: offer.row.imageAttachments } : {}) };
  }
  function processEvent(method, params, offer) {
    if (params.threadId !== worker.threadId || params.turnId !== offer.row.turnId) return;
    if (offer.canonicalImageMismatch) return;
    if (method === 'item/completed') {
      if (!['userMessage', 'agentMessage'].includes(params.item?.type)) {
        if (['reasoning', 'plan'].includes(params.item?.type)) return;
        throw fail('unexpected_native_tool', 'Inference-only worker emitted an unsupported item');
      }
      let item;
      try { item = canonicalItem(params.item, params, offer); }
      catch (reason) {
        if (reason.code !== 'canonical_image_mismatch') throw reason;
        offer.canonicalImageMismatch = true; held('canonical_image_mismatch'); return;
      }
      if (offer.items.some(previous => previous.messageId === item.messageId)) throw fail('invalid_event', 'Duplicate native canonical item');
      offer.bytes += Buffer.byteLength(JSON.stringify(item));
      if (offer.items.length >= 100 || offer.bytes > MAX_PAGE) throw fail('response_too_large', 'Native canonical page exceeds its bound');
      offer.items.push(item);
    } else if (method === 'thread/tokenUsage/updated') {
      const value = params.tokenUsage?.last;
      const keys = ['totalTokens', 'inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'outputTokens', 'reasoningOutputTokens'];
      if (plain(value) && keys.every(key => number(value[key]))) offer.usage = Object.fromEntries(keys.map(key => [key, value[key]]));
    } else if (method === 'turn/completed') {
      const turn = params.turn;
      if (turn?.id !== offer.row.turnId || !['completed', 'failed', 'interrupted'].includes(turn.status)) throw fail('invalid_event', 'Native terminal identity is invalid');
      let resultState = turn.status === 'completed' ? 'completed' : 'failed', reasonCode;
      const finals = offer.items.filter(item => item.role === 'assistant' && [null, 'final_answer'].includes(item.phase));
      if (resultState === 'completed' && (!offer.items.some(item => item.role === 'user') || !finals.length)) {
        resultState = 'failed'; reasonCode = 'canonical_result_unavailable';
      }
      let structuredOutput;
      if (resultState === 'completed' && offer.validate) {
        try { structuredOutput = JSON.parse(finals.at(-1).text); } catch { resultState = 'failed'; reasonCode = 'invalid_structured_output'; }
        if (resultState === 'completed' && offer.validate(structuredOutput) !== true) { resultState = 'failed'; reasonCode = 'invalid_structured_output'; }
      }
      const receipt = update(offer.row.actionId, { state: resultState, ownerHeld: false, nativeStatus: turn.status,
        canonicalItems: offer.items, usage: offer.usage, ...(reasonCode ? { reasonCode } : {}),
        ...(structuredOutput !== undefined ? { structuredOutput } : {}) });
      active = null; clearTimeout(offer.timer); state = resultState === 'completed' ? 'ready' : 'retired'; offer.resolve(receipt);
      if (resultState !== 'completed') void worker.rpc.destroy();
    }
  }
  function onNotification(method, params) {
    if (!active || !plain(params) || !worker?.threadId || params.threadId !== worker.threadId) return;
    if (!['item/completed', 'turn/completed', 'thread/tokenUsage/updated', 'item/started'].includes(method)) return;
    const turnId = params.turnId || params.turn?.id;
    if (!safeId(turnId)) throw fail('invalid_event', 'Native event has no turn identity');
    const normalized = { ...params, turnId };
    if (method === 'item/started') {
      if (!['userMessage', 'agentMessage', 'reasoning', 'plan'].includes(params.item?.type)) throw fail('unexpected_native_tool', 'Native attempted an unsupported item');
      return;
    }
    if (!active.row.turnId) {
      active.eventBytes += Buffer.byteLength(JSON.stringify(normalized));
      if (active.events.length >= 128 || active.eventBytes > MAX_LINE) throw fail('response_too_large', 'Native events exceeded the pre-ACK bound');
      active.events.push([method, normalized]);
    } else processEvent(method, normalized, active);
  }
  async function effective(rpc) {
    const read = await rpc.request('config/read', { includeLayers: true, cwd: admission.paths.cwd });
    const requirements = await rpc.request('configRequirements/read', {});
    admission.checkEffective(read, requirements);
  }
  async function createOwnedWorker({ actionId } = {}) {
    uuid(actionId);
    if (destroyed || busy || worker && (state !== 'retired' || !worker.rpc.closed)) throw fail('worker_busy', 'Native worker owner is not available for creation');
    if (journal.snapshot().some(row => row.actionId === actionId)) throw fail('intent_already_recorded', 'Inspect the recorded native action instead of replaying it');
    if (journal.snapshot().some(row => row.state === 'unknown' && !row.retired)) throw fail('reconciliation_required', 'Retire the previous uncertain worker before creating another');
    busy = 'Creating private native worker'; state = 'creating';
    let row;
    try {
      const admitted = shared ? null : admission.prestart(); journal.acquire();
      const handle = randomUUID();
      worker = { handle, threadId: null, rpc: shared ? shared.rpcFor(() => worker?.threadId, onNotification, reason => {
        if (worker?.rpc.closed) unknown(reason.code || 'owner_closed'); else held(reason.code || 'transport_error');
      }) : createTransport({ admitted, requestTimeoutMs, stopGraceMs,
        onNotification, onFailure: reason => { unknown(reason.code || 'transport_error'); },
        spawnProcess: testHooks.spawnProcess, terminateProcess: testHooks.terminateProcess }) };
      await worker.rpc.connect(); await effective(worker.rpc);
      if (destroyed) throw fail('client_closed', 'Native owner was closed before thread creation');
      row = journal.begin({ actionId, workerHandle: handle, threadId: null, inputHash: admission.admissionId, kind: 'create' });
      const result = await worker.rpc.request('thread/start', { ephemeral: true, model: admission.modelId,
        modelProvider: admission.provider, cwd: admission.paths.cwd, approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: 'read-only' },
      requestId => { row = update(actionId, { state: 'offered', requestId }); });
      if (!safeId(result?.thread?.id) || result.thread.ephemeral !== true || result.thread.forkedFromId !== null
        || result.thread.parentThreadId !== null || result.thread.status?.type !== 'idle'
        || result.model !== admission.modelId || result.modelProvider !== admission.provider
        || result.approvalPolicy !== 'never' || result.approvalsReviewer !== 'user'
        || result.sandbox?.type !== 'readOnly' || result.cwd !== admission.paths.cwd
        || !Array.isArray(result.instructionSources) || result.instructionSources.length) {
        throw fail('thread_receipt_mismatch', 'Native thread did not confirm its admitted identity and permissions');
      }
      uuid(result.thread.id); worker.threadId = result.thread.id; shared?.created(worker.threadId);
      const receipt = update(actionId, { state: 'completed', threadId: worker.threadId }); state = 'ready';
      return { workerHandle: handle, threadId: worker.threadId, admissionId: admission.admissionId, receipt };
    } catch (reason) {
      if (row) {
        try { update(actionId, { state: reason.authoritative ? 'failed' : 'unknown', reasonCode: reason.code || 'create_failed' }); } catch { /* earlier offered receipt remains uncertain */ }
      }
      state = row && !reason.authoritative ? 'unknown' : 'retired';
      await worker?.rpc.destroy(); throw Object.assign(fail(reason.code || 'native_unavailable', 'Private native worker creation is unavailable'),
        typeof reason.field === 'string' ? { field: reason.field } : {});
    } finally { busy = null; }
  }
  async function offerOwnedTurn({ workerHandle, actionId, text, images, outputSchema } = {}) {
    uuid(workerHandle); uuid(actionId);
    if (destroyed || busy || active || !worker || worker.handle !== workerHandle || state !== 'ready') {
      throw fail('worker_not_ready', 'Native offer requires the exact idle owned worker');
    }
    const prepared = prepareOwnedNativeInput(text, images);
    if (prepared.imageAttachments.length && admission.imageInput !== true) throw fail('image_input_unsupported', 'Admitted Native model does not support image input');
    if (journal.snapshot().some(row => row.actionId === actionId)) {
      throw fail('intent_already_recorded', 'Inspect the recorded native action instead of replaying it');
    }
    let validate;
    if (outputSchema !== undefined) {
      let serialized;
      try { serialized = JSON.stringify(outputSchema); } catch { throw fail('invalid_schema', 'Native output schema is invalid'); }
      if (!plain(outputSchema) || Buffer.byteLength(serialized) > 32768 || serialized.includes('"$async"')
        || typeof compileOutputSchema !== 'function') throw fail('invalid_schema', 'Native output schema has no admitted validator');
      outputSchema = freeze(JSON.parse(serialized));
      try { validate = compileOutputSchema(outputSchema); if (typeof validate !== 'function') throw new Error(); }
      catch { throw fail('invalid_schema', 'Native output schema is unsupported'); }
    }
    busy = 'Offering private native inference';
    try {
      await effective(worker.rpc);
      if (destroyed) throw fail('client_closed', 'Native owner was closed before its offer');
      const row = journal.begin({ actionId, workerHandle, threadId: worker.threadId, inputHash: prepared.inputHash,
        schemaHash: outputSchema === undefined ? null : digest(canonical(outputSchema)), imageAttachments: prepared.imageAttachments });
      state = 'offering';
      const result = new Promise(resolve => {
        active = { row, resolve, input: prepared.input, items: [], bytes: 0, events: [], eventBytes: 0, usage: null, validate,
          timer: setTimeout(() => held('terminal_receipt_wait'), terminalTimeoutMs) };
      });
      const offer = active;
      const request = worker.rpc.request('turn/start', { threadId: worker.threadId,
          clientUserMessageId: row.clientUserMessageId, input: prepared.input,
          ...(outputSchema === undefined ? {} : { outputSchema }) },
        requestId => { offer.row = update(actionId, { state: 'offered', ownerHeld: true, requestId }); },
        () => held('ack_receipt_wait'));
      request.then(response => {
        if (active !== offer) return;
        uuid(response?.turn?.id);
        offer.row = update(actionId, { state: 'acknowledged', ownerHeld: true, turnId: response.turn.id });
        for (const [method, params] of offer.events) { if (!active) break; processEvent(method, params, offer); }
        offer.events = []; offer.eventBytes = 0;
      }).catch(async reason => {
        if (reason.authoritative && active === offer) {
          const receipt = update(actionId, { state: 'failed', ownerHeld: false, reasonCode: 'rpc_rejected' });
          active = null; clearTimeout(offer.timer); state = 'retired'; offer.resolve(receipt);
        } else unknown(reason.code || 'offer_outcome_unknown');
        await worker.rpc.destroy();
      }).catch(() => { unknown('receipt_not_saved'); });
      return await result;
    } catch (reason) {
      if (reason.code === 'image_budget_exceeded') { state = 'ready'; throw reason; }
      state = 'retired'; await worker.rpc.destroy(); throw reason;
    } finally { busy = null; }
  }
  async function retireOwnedWorker({ workerHandle, actionId } = {}) {
    uuid(workerHandle); uuid(actionId);
    if (busy && !active) throw fail('worker_busy', 'Native creation or admission is still pending');
    const known = worker?.handle === workerHandle || journal.snapshot().some(row => row.workerHandle === workerHandle);
    if (!known) throw fail('invalid_intent', 'Native worker handle is unknown');
    if (shared) destroyed = true;
    journal.retire(workerHandle, actionId);
    if (worker?.handle === workerHandle) { if (shared && !worker.rpc.closed) held('worker_retiring'); else unknown('worker_retired'); }
    if (worker?.handle === workerHandle) {
      state = 'retiring';
      try { await worker.rpc.destroy(); unknown('worker_retired'); state = 'retired'; }
      catch (reason) { state = 'unknown'; throw reason; }
    }
    return inspectOwnedWorker(workerHandle);
  }
  function destroy() {
    if (closing) return closing;
    destroyed = true;
    if (shared && worker && !worker.rpc.closed) held('owner_retiring'); else unknown('owner_closed');
    state = 'retiring';
    closing = (async () => {
      await worker?.rpc.destroy();
      unknown('owner_closed');
      // The exact process close, not a cleanup attempt or timeout, releases this owner.
      state = 'retired'; journal.release();
    })().catch(reason => { state = 'unknown'; closing = undefined; throw reason; });
    return closing;
  }
  return Object.freeze({ createOwnedWorker, offerOwnedTurn, inspectOwnedWorker, retireOwnedWorker,
    currentOperation: () => busy || (worker?.rpc.cleanupPending ? 'Awaiting exact native process cleanup' : active ? 'Awaiting private native inference outcome' : null), destroy });
}
function createOwnedNativeWorkerService(options = {}) { return createWorkerService(options); }

/** Trusted account owner. One private sender/AuthManager process; binding facades own
 * only freshly-created ephemeral threads and their separate durable journals. */
function createOwnedNativeAccountServer({ admission, requestTimeoutMs = 15000, terminalTimeoutMs = 120000,
  stopGraceMs = 1000, maxConcurrentThreads = 2, onChange, testHooks = {} } = {}) {
  if (!admission?.prestart || !admission?.forBinding || !admission?.checkAccount || !Number.isInteger(maxConcurrentThreads)
    || maxConcurrentThreads < 1 || maxConcurrentThreads > 32) throw fail('invalid_admission', 'Qualified Native account admission is required');
  const listeners = new Set(), threads = new Map(), facades = new Map();
  let rpc, starting, closing, stopped = false, fault;
  const changed = () => { try { onChange?.(); } catch {} };
  const threadState = id => {
    if (!threads.has(id)) threads.set(id, { closed: false, requested: false, resolve: null, promise: null });
    return threads.get(id);
  };
  const physicallyClosed = () => Boolean(rpc?.closed);
  const signalClose = id => {
    const row = threadState(id); row.closed = true; row.resolve?.();
  };
  function notify(method, params) {
    if (method === 'thread/closed' && threads.has(params?.threadId)) signalClose(params.threadId);
    for (const listener of listeners) {
      if (method === 'thread/closed') {
        if (listener.id() === params?.threadId) listener.failure(fail('thread_closed', 'Exact Native thread closed'));
      } else listener.notification(method, params);
    }
    if (method === 'thread/closed') changed();
  }
  async function ready() {
    if (stopped || fault) throw fault || fail('client_closed', 'Native account server is closing');
    if (starting) return starting;
    starting = (async () => {
      const admitted = admission.prestart();
      rpc = createTransport({ admitted, requestTimeoutMs, stopGraceMs, onNotification: notify,
        onFailure: reason => { fault ||= reason; for (const listener of listeners) listener.failure(reason); changed(); },
        onClosed: () => { for (const id of threads.keys()) signalClose(id); for (const listener of listeners) listener.failure(fail('client_closed', 'Native account process closed')); changed(); },
        spawnProcess: testHooks.spawnProcess, terminateProcess: testHooks.terminateProcess });
      await rpc.connect(); changed();
      admission.checkEffective(await rpc.request('config/read', { includeLayers: true, cwd: admission.paths.cwd }), await rpc.request('configRequirements/read', {}));
      admission.checkAccount(await rpc.request('account/read', { refreshToken: false }), await rpc.request('account/rateLimits/read', {}));
      if (stopped || fault) throw fault || fail('client_closed', 'Native account server is closing');
    })().catch(async reason => {
      fault ||= reason; changed();
      // Startup preflight precedes every thread. Close only its one owned process;
      // a failed close remains explicit account activity and keeps the profile lease.
      try { await rpc?.destroy(); } catch {}
      throw reason;
    });
    return starting;
  }
  async function closeThread(id) {
    if (physicallyClosed()) return;
    if (!id) throw fail('thread_close_unavailable', 'Unacknowledged Native thread creation requires account-owner reconciliation');
    const row = threadState(id);
    if (row.closed) return;
    row.promise ??= new Promise(resolve => { row.resolve = resolve; });
    if (!row.requested) {
      row.requested = true; changed();
      // The reply is only an unsubscribe ACK. Retain this exact owner until its
      // thread/closed notification or the shared physical process closes.
      rpc.request('thread/unsubscribe', { threadId: id }, undefined, () => {}).catch(() => {});
    }
    await row.promise;
  }
  function createWorker(binding, onReceipt) {
    if (stopped || fault || facades.has(binding.workerBindingId)) throw fail('worker_busy', 'Native account binding is unavailable');
    const scopedAdmission = admission.forBinding(binding);
    let scopedListener;
    const shared = { admission: scopedAdmission,
      created() { if (scopedListener) scopedListener.creationUnknown = false; changed(); },
      rpcFor(id, notification, failure) {
        const listener = { id, notification, failure, creationUnknown: false, threadStartWritten: false, locallyClosed: false }; scopedListener = listener; listeners.add(listener);
        return {
          connect: async () => {
            if ([...facades.values()].filter(value => value.currentOperation() || value.inspectOwnedWorker().threadId && !value.inspectOwnedWorker().receipts.every(row => row.retired)).length > maxConcurrentThreads) throw fail('worker_busy', 'Native account thread capacity reached');
            await ready();
          },
          request: async (method, params, beforeWrite, onWaitTimeout) => {
            if (!['config/read', 'configRequirements/read', 'thread/start', 'turn/start'].includes(method)) throw fail('unsupported_method', 'Native account facade method is unavailable');
            if (stopped || fault) throw fault || fail('client_closed', 'Native account server is closing');
            if (method === 'thread/start' || method === 'turn/start') {
              admission.checkAccount(await rpc.request('account/read', { refreshToken: false }), await rpc.request('account/rateLimits/read', {}));
              if (stopped || fault) throw fault || fail('client_closed', 'Native account server is closing');
            }
            let result;
            try {
              result = await rpc.request(method, params, requestId => {
                beforeWrite?.(requestId);
                if (method === 'thread/start') listener.threadStartWritten = true;
              }, method === 'thread/start' ? () => {
                // Retain this pending request for its exact late ACK. Additional bindings
                // cannot consume capacity while creation has an unknown physical outcome.
                listener.creationUnknown = true; changed(); onWaitTimeout?.();
              } : onWaitTimeout);
            } catch (reason) {
              if (method === 'thread/start' && !reason.authoritative && !physicallyClosed()) { listener.creationUnknown = true; changed(); }
              throw reason;
            }
            if (method === 'thread/start' && typeof result?.thread?.id === 'string') threadState(result.thread.id);
            return result;
          },
          destroy: () => {
            if (!listener.threadStartWritten) {
              listener.locallyClosed = true; listeners.delete(listener); return Promise.resolve();
            }
            return closeThread(id());
          },
          get closed() { return listener.locallyClosed || physicallyClosed() || Boolean(id() && threads.get(id())?.closed); },
          get cleanupPending() { return !this.closed && (stopped || listener.creationUnknown || Boolean(id() && threads.get(id())?.requested)); },
        };
      },
    };
    const facade = createWorkerService({ requestTimeoutMs, terminalTimeoutMs, stopGraceMs,
      onReceipt: row => { onReceipt?.(row); queueMicrotask(changed); }, compileOutputSchema: admission.compileOutputSchema }, shared);
    facades.set(binding.workerBindingId, facade); return facade;
  }
  return Object.freeze({ createWorker,
    inspect: () => ({ serverGeneration: admission.serverGeneration, pid: rpc?.pid ?? null, closed: physicallyClosed(), accepting: !stopped && !fault && ![...listeners].some(value => value.creationUnknown),
      threadIds: [...threads.keys()], bindings: [...facades.keys()], activeCount: [...facades.values()].filter(value => value.currentOperation()).length }),
    currentOperation: () => closing && !physicallyClosed() ? 'Closing Native account process' : fault && rpc && !physicallyClosed() ? 'Native account preflight reconciliation' : [...facades.values()].some(value => value.currentOperation()) ? 'Native account threads' : null,
    destroy() {
      if (closing) return closing; stopped = true; changed();
      closing = (async () => {
        // A startup already owns the exact child. Do not replace it or release its lease.
        if (starting) { try { await starting; } catch {} }
        await rpc?.destroy();
        await Promise.all([...facades.values()].map(value => value.destroy()));
      })().catch(reason => { closing = undefined; throw reason; }); return closing;
    },
  });
}
module.exports = { createOwnedNativeWorkerService, createOwnedNativeAccountServer };
