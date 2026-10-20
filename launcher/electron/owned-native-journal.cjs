'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fail, plain, privateDirectory, regular, digest } = require('./owned-native-admission.cjs');
const { validateOwnedNativeImageMetadata, MAX_IMAGES, MAX_IMAGE_BYTES } = require('./owned-native-images.cjs');
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const STATES = ['prepared', 'offered', 'acknowledged', 'completed', 'failed', 'unknown'];
const NONTERMINAL = ['prepared', 'offered', 'acknowledged'];
const MAX_OBSERVATIONS = 32;
function observe(row) {
  if (!Array.isArray(row.observations) || row.observations.length >= MAX_OBSERVATIONS) {
    throw fail('journal_quota', 'Native receipt observations have reached their bound');
  }
  row.observations.push({ state: row.state, ownerHeld: row.ownerHeld, turnId: row.turnId,
    timestampMs: row.updatedAt, ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}) });
}
function uuid(value) {
  if (typeof value !== 'string' || !UUID.test(value)) throw fail('invalid_intent', 'An exact native action or worker identifier is required');
  return value;
}
function createOwnedNativeJournal({ directory, admissionId, maxActions = 128 } = {}) {
  const file = path.join(directory, 'actions.json'), lock = path.join(directory, 'owner.lock');
  let owned = false, lastBytes;
  const owner = JSON.stringify({ pid: process.pid, nonce: randomUUID() });
  function read() {
    let bytes;
    try { bytes = regular(file, 16 * 1024 * 1024); } catch (reason) {
      if (reason.code === 'ENOENT') return { version: 1, admissionId, actions: [] };
      throw fail('journal_unavailable', 'Native durable receipts could not be read');
    }
    let value;
    try { value = JSON.parse(bytes); } catch { throw fail('journal_unavailable', 'Native durable receipts are invalid'); }
    if (value.version !== 1 || value.admissionId !== admissionId || !Array.isArray(value.actions)
      || value.actions.length > maxActions || value.actions.some(row => !plain(row) || !UUID.test(row.actionId)
        || !UUID.test(row.workerHandle) || !STATES.includes(row.state) || typeof row.inputHash !== 'string'
        || typeof row.retired !== 'boolean' || typeof row.ownerHeld !== 'boolean'
        || !Array.isArray(row.observations) || row.observations.length > MAX_OBSERVATIONS
        || row.observations.some(fact => !plain(fact) || !STATES.includes(fact.state)
          || typeof fact.ownerHeld !== 'boolean' || !Number.isSafeInteger(fact.timestampMs)
          || fact.turnId !== null && !UUID.test(fact.turnId)))) throw fail('journal_unavailable', 'Native receipt source does not match admission');
    const observed = digest(bytes);
    for (const row of value.actions) if (row.imageAttachments !== undefined) {
      try { validateOwnedNativeImageMetadata(row.imageAttachments); }
      catch { throw fail('journal_unavailable', 'Native image budget receipts are invalid'); }
    }
    if (owned && lastBytes !== undefined && observed !== lastBytes) throw fail('journal_changed', 'Native receipt storage changed outside its owner');
    lastBytes = observed;
    return value;
  }
  function write(value) {
    if (!owned) throw fail('journal_unavailable', 'Native durable receipt ownership is required');
    if (regular(lock, 4096).toString() !== owner) throw fail('owner_changed', 'Native receipt ownership changed');
    let actual;
    try { actual = digest(regular(file, 16 * 1024 * 1024)); } catch (reason) {
      if (reason.code !== 'ENOENT') throw reason;
    }
    if (actual !== lastBytes) throw fail('journal_changed', 'Native receipt storage changed outside its owner');
    const bytes = `${JSON.stringify(value)}\n`;
    if (Buffer.byteLength(bytes) > 16 * 1024 * 1024) throw fail('journal_quota', 'Native receipt storage has reached its bound');
    const temporary = path.join(directory, `${randomUUID()}.tmp`);
    let fd;
    try {
      fd = fs.openSync(temporary, 'wx', 0o600); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = undefined;
      fs.renameSync(temporary, file);
      const dir = fs.openSync(directory, 'r'); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
      lastBytes = digest(bytes);
    } finally { if (fd !== undefined) fs.closeSync(fd); fs.rmSync(temporary, { force: true }); }
  }
  function acquire() {
    if (owned) return;
    privateDirectory(directory);
    try { fs.writeFileSync(lock, owner, { flag: 'wx', mode: 0o600 }); }
    catch (reason) {
      if (reason.code !== 'EEXIST') throw fail('journal_unavailable', 'Native receipt ownership could not be acquired');
      try { const value = JSON.parse(regular(lock, 4096));
        if (!Number.isSafeInteger(value.pid) || value.pid < 1) throw new Error();
        try { process.kill(value.pid, 0); throw fail('owner_exists', 'Another native worker receipt owner is active'); }
        catch (reason) {
          if (reason.code === 'ESRCH') throw fail('stale_owner_recovery_required', 'Stopped native ownership requires controlled recovery in a fresh authority generation');
          throw reason;
        }
      } catch (reason) { throw ['owner_exists', 'stale_owner_recovery_required'].includes(reason.code)
        ? reason : fail('journal_unavailable', 'Native receipt ownership needs reconciliation'); }
    }
    owned = true;
    const value = read();
    let changed = false;
    for (const row of value.actions) if (NONTERMINAL.includes(row.state) || row.state === 'unknown' && row.ownerHeld) {
      row.state = 'unknown'; row.ownerHeld = false; row.reasonCode = 'previous_owner_lost'; row.updatedAt = Date.now(); observe(row); changed = true;
    }
    if (changed) write(value);
  }
  function ownerStatus() {
    try {
      const bytes = regular(lock, 4096);
      if (owned && bytes.toString() === owner) return 'current';
      const value = JSON.parse(bytes);
      if (Number.isSafeInteger(value.pid) && value.pid > 0) {
        try { process.kill(value.pid, 0); }
        catch (reason) { if (reason.code === 'ESRCH') return 'stale'; }
      }
      return 'elsewhere-or-unverified';
    } catch (reason) { return reason.code === 'ENOENT' ? 'unclaimed' : 'elsewhere-or-unverified'; }
  }
  function snapshot() {
    const value = read();
    // A second passive service object is not evidence that the physical owner
    // died. Inspect metadata only; never signal/adopt another worker.
    const observed = ownerStatus();
    const ownerState = ['stale', 'unclaimed'].includes(observed) ? 'lost' : observed;
    return structuredClone(value.actions.map(row => {
      if (!NONTERMINAL.includes(row.state) && !(row.state === 'unknown' && row.ownerHeld)) return row;
      return ownerState === 'lost' ? { ...row, state: 'unknown', ownerHeld: false, reasonCode: 'previous_owner_lost', ownerState }
        : { ...row, ownerState };
    }));
  }
  function begin({ actionId, workerHandle, threadId, inputHash, schemaHash, imageAttachments, kind = 'offer' }) {
    uuid(actionId); uuid(workerHandle); if (threadId !== null) uuid(threadId); acquire();
    const value = read();
    if (value.actions.some(row => row.actionId === actionId)) throw fail('intent_already_recorded', 'Native actions cannot be replayed; inspect the existing receipt');
    if (value.actions.length >= maxActions) throw fail('journal_quota', 'Native receipt storage has reached its bound');
    if (imageAttachments !== undefined) {
      imageAttachments = validateOwnedNativeImageMetadata(imageAttachments);
      // Every prepared offer is consumed, including failed/uncertain/retired
      // offers. The binding journal survives facade/process replacement.
      const prior = value.actions.flatMap(row => row.imageAttachments || []);
      if (prior.length + imageAttachments.length > MAX_IMAGES
        || [...prior, ...imageAttachments].reduce((sum, image) => sum + image.byteLength, 0) > MAX_IMAGE_BYTES) {
        throw fail('image_budget_exceeded', 'Native binding image budget is exhausted');
      }
    }
    const row = { actionId, workerHandle, threadId, kind, turnId: null, clientUserMessageId: randomUUID(),
      admissionId, inputHash, schemaHash: schemaHash || null, state: 'prepared', retired: false, ownerHeld: false,
      createdAt: Date.now(), updatedAt: Date.now(), inputAuthorship: 'automatic-host', usage: null, observations: [],
      ...(imageAttachments?.length ? { imageAttachments } : {}) };
    observe(row);
    value.actions.push(row); write(value); return structuredClone(row);
  }
  function update(actionId, changes) {
    uuid(actionId); const value = read(), row = value.actions.find(item => item.actionId === actionId);
    if (!row) throw fail('journal_unavailable', 'Native action receipt is missing');
    if (changes.state && (!STATES.includes(changes.state) || !NONTERMINAL.includes(row.state)
      && !(row.state === 'unknown' && row.ownerHeld) && changes.state !== row.state)) {
      throw fail('invalid_receipt_transition', 'Native terminal receipts cannot be replayed or rewritten');
    }
    if (changes.state && changes.state !== row.state && !Object.hasOwn(changes, 'reasonCode')) delete row.reasonCode;
    Object.assign(row, changes, { updatedAt: Date.now() }); observe(row); write(value); return structuredClone(row);
  }
  function retire(workerHandle, actionId) {
    uuid(workerHandle); uuid(actionId); acquire(); const value = read();
    if (value.actions.some(row => row.actionId === actionId || row.retirementActionId === actionId && row.workerHandle !== workerHandle)) {
      throw fail('intent_already_recorded', 'Retirement requires its own exact action identity');
    }
    for (const row of value.actions.filter(row => row.workerHandle === workerHandle)) {
      if (row.retirementActionId === actionId) continue;
      if (NONTERMINAL.includes(row.state)) { row.state = 'unknown'; row.reasonCode = 'worker_retired'; }
      row.retired = true; row.ownerHeld = false; row.updatedAt = Date.now(); row.retirementActionId = actionId; observe(row);
    }
    write(value);
  }
  function release() {
    if (!owned) return;
    try { if (regular(lock, 4096).toString() === owner) fs.unlinkSync(lock); }
    finally { owned = false; }
  }
  return Object.freeze({ acquire, snapshot, ownerStatus, begin, update, retire, release });
}
module.exports = { createOwnedNativeJournal, uuid };
