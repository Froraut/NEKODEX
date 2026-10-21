'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { canonical, digest, fail, SOURCE, VERSION } = require('./owned-native-admission.cjs');
const { uuid } = require('./owned-native-journal.cjs');
const { observeNativeRecoveryProcesses, recoveryExecutableDigest, NATIVE_RECOVERY_OBSERVER_SOURCE } = require('./native-recovery-processes.cjs');
const HASH = /^[a-f0-9]{64}$/;
const isHash = value => typeof value === 'string' && HASH.test(value);
const MARKER_KEYS = { authority: ['pid', 'nonce'], execution: ['pid', 'actionId', 'serverGeneration'], inventory: ['pid', 'actionId', 'nonce'] };
function sync(directory) { const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function directory(file) {
  const s = fs.lstatSync(file, { bigint: true });
  if (!s.isDirectory() || s.isSymbolicLink() || s.uid !== BigInt(process.getuid()) || s.mode & 0o077n || fs.realpathSync(file) !== file) throw fail('unsafe_recovery_storage', 'Recovery requires canonical private owned directories');
  return { dev: String(s.dev), ino: String(s.ino), mode: String(s.mode), uid: String(s.uid) };
}
function privateRead(file, limit, optional = false, expected) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (expected && (String(before.dev) !== expected.dev || String(before.ino) !== expected.ino)) throw fail('recovery_source_changed', 'Recovery file identity changed before read');
    if (!before.isFile() || before.nlink !== 1n || before.uid !== BigInt(process.getuid()) || before.mode & 0o077n || before.size > BigInt(limit) || fs.realpathSync(file) !== file) throw fail('unsafe_recovery_storage', 'Recovery metadata must be private owned regular files');
    const bytes = fs.readFileSync(fd), after = fs.lstatSync(file, { bigint: true });
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || bytes.length > limit) throw fail('recovery_source_changed', 'Recovery metadata changed while observed');
    return { bytes, sha256: digest(bytes), dev: String(before.dev), ino: String(before.ino), size: bytes.length, mode: String(before.mode), uid: String(before.uid), mtimeNs: String(before.mtimeNs), ctimeNs: String(before.ctimeNs) };
  } finally { fs.closeSync(fd); }
}
function json(record) { try { return JSON.parse(record.bytes); } catch { throw fail('recovery_metadata_unverified', 'Recovery metadata is malformed'); } }
const facts = row => { const { bytes, ...value } = row; return value; };
function writeReceipt(file, value) {
  const temporary = path.join(path.dirname(file), randomUUID() + '.tmp'), bytes = JSON.stringify(value) + '\n';
  if (Buffer.byteLength(bytes) > 256 * 1024) throw fail('recovery_quota', 'Recovery receipt is too large');
  const fd = fs.openSync(temporary, 'wx', 0o600); try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  fs.renameSync(temporary, file); sync(path.dirname(file));
}
function createNativeAccountRecovery({ authorityHome, executable, executableSha256, executionRoot, inventoryRoot, getWorkerPin, getMetadataRuntimePin, isBusy, testHooks = {} }) {
  for (const file of [authorityHome, executable, executionRoot, inventoryRoot]) if (typeof file !== 'string' || !path.isAbsolute(file) || /[\x00-\x1f\x7f]/u.test(file)) throw fail('invalid_recovery_owner', 'Recovery requires fixed main-owned paths');
  const storage = path.join(authorityHome, 'owner-recovery'), gate = path.join(storage, 'owner.lock'); let active = false, closing = false;
  const pending = new Set();
  const notifyError = error => { if (!error.code || !/^[a-z_]{1,80}$/.test(error.code)) return 'recovery_metadata_unverified'; return error.code; };
  function gateExists() { try { fs.lstatSync(gate); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
  function heldRecovery() {
    if (gateExists()) return true;
    if (!fs.existsSync(storage)) return false;
    try {
      directory(storage); const entries = fs.readdirSync(storage); if (entries.length > 128) return true;
      for (const name of entries) { uuid(name); directory(path.join(storage, name)); const row = json(privateRead(path.join(storage, name, 'receipt.json'), 256 * 1024)); if (row.actionId !== name || !['completed', 'failed'].includes(row.state) || row.ownerHeld !== false) return true; }
      return false;
    } catch { return true; }
  }
  function assertNotRecovering() { if (active || pending.size || heldRecovery()) throw fail('recovery_owner_held', 'Explicit Native owner recovery requires reconciliation'); }
  function receiptPath(actionId) { uuid(actionId); return path.join(storage, actionId, 'receipt.json'); }
  function project(row) { return { actionId: row.actionId, reviewDigest: row.reviewDigest, state: row.state, ownerHeld: row.ownerHeld, terminal: ['completed', 'failed'].includes(row.state), archivedCount: row.archivedCount || 0,
    unsettledActionCount: row.unsettledActionCount || 0, ...(row.reasonCode ? { reasonCode: row.reasonCode } : {}) }; }
  function inspectRecovery(actionId) {
    const file = receiptPath(actionId); if (!fs.existsSync(file)) return undefined;
    try {
      directory(storage); directory(path.dirname(file)); const row = json(privateRead(file, 256 * 1024));
      if (row.version !== 1 || row.actionId !== actionId || !isHash(row.reviewDigest) || !['prepared', 'archiving', 'completed', 'failed', 'unknown'].includes(row.state) || typeof row.ownerHeld !== 'boolean') throw new Error();
      if ((!['completed', 'failed'].includes(row.state) || gateExists()) && !pending.size) {
        // Reconcile only this already recorded action. Never rename another
        // marker, rerun an original operation, or run a new process inventory.
        if (!row.plan?.markers?.length || row.plan.markers.length > 33 || digest(canonical({ plan: row.plan, executables: row.executables })) !== row.reviewDigest
          || row.executables.physicalProof?.method !== 'libproc-owned-uid-v1') throw new Error();
        const gateRecord = privateRead(gate, 4096), gateValue = json(gateRecord);
        if (gateValue.actionId !== actionId && ['completed', 'failed'].includes(row.state)) return project(row);
        uuid(gateValue.nonce);
        if (canonical(facts(gateRecord)) !== canonical(row.gateFacts)) throw new Error();
        if (gateValue.actionId !== actionId || !Number.isSafeInteger(gateValue.pid) || gateValue.pid < 2) throw new Error();
        if (gateValue.pid !== process.pid) { try { process.kill(gateValue.pid, 0); return project({ ...row, state: 'unknown', ownerHeld: true }); } catch (error) { if (error.code !== 'ESRCH') return project({ ...row, state: 'unknown', ownerHeld: true }); } }
        let archived = 0, original = 0;
        for (let index = 0; index < row.plan.markers.length; index++) {
          const marker = row.plan.markers[index];
          if (!['authority', 'execution', 'inventory'].includes(marker.kind) || !isHash(marker.sha256) || !marker.file.startsWith(authorityHome + path.sep)) throw new Error();
          const current = privateRead(marker.file, 4096, true, marker), saved = privateRead(path.join(path.dirname(file), `marker-${index}.json`), 4096, true, marker);
          if (!current && saved && saved.sha256 === marker.sha256 && saved.dev === marker.dev && saved.ino === marker.ino) archived++;
          else if (!saved && current && canonical(facts(current)) === canonical(Object.fromEntries(Object.entries(marker).filter(([key]) => ['sha256', 'dev', 'ino', 'size', 'mode', 'uid', 'mtimeNs', 'ctimeNs'].includes(key))))) original++;
        }
        if (archived === row.plan.markers.length || original === row.plan.markers.length) {
          row.state = archived ? 'completed' : 'failed'; row.ownerHeld = false; row.archivedCount = archived; row.reconciledAt = Date.now();
          if (!archived) row.reasonCode = 'recovery_no_markers_archived'; writeReceipt(file, row);
          if (privateRead(gate, 4096).bytes.toString() !== gateRecord.bytes.toString()) throw new Error(); fs.unlinkSync(gate); sync(storage);
        } else return project({ ...row, state: 'unknown', ownerHeld: true, archivedCount: archived, reasonCode: 'recovery_partial_archive' });
      }
      if (!row.ownerHeld && gateExists()) {
        const heldGate = json(privateRead(gate, 4096));
        if (heldGate.actionId === actionId) return project({ ...row, state: 'unknown', ownerHeld: true, reasonCode: 'recovery_gate_unsettled' });
      }
      return project(row);
    }
    catch { return { actionId, state: 'unknown', ownerHeld: true, terminal: false, reasonCode: 'recovery_receipt_unverified', archivedCount: 0, unsettledActionCount: 0 }; }
  }
  function gather() {
    const directories = new Map(), evidence = [], markers = []; let unsettledActionCount = 0, readBytes = 0;
    const dir = file => { const value = directory(file); directories.set(file, value); return value; };
    dir(authorityHome);
    const read = (file, max, optional = false) => { dir(path.dirname(file)); const record = privateRead(file, max, optional); if (record) { readBytes += record.size; if (readBytes > 32 * 1024 * 1024) throw fail('recovery_quota', 'Recovery evidence exceeds its bound'); evidence.push({ file, ...facts(record) }); } return record; };
    const registryRecord = read(path.join(authorityHome, 'registry.json'), 2 * 1024 * 1024), registry = json(registryRecord);
    if (registry.version !== 1 || registry.source !== SOURCE || registry.cliVersion !== VERSION || !Array.isArray(registry.profiles) || registry.profiles.length > 128 || !Array.isArray(registry.receipts) || registry.receipts.length > 512) throw fail('recovery_metadata_unverified', 'Native registry identity is unavailable');
    const states = new Set(['fresh', 'login-pending', 'signed-in-checking', 'login-failed', 'cancelled', 'auth-outcome-unknown']);
    const loginStates = new Set(['prepared', 'running', 'pending', 'cancel-requested', 'signed-in-checking', 'failed', 'cancelled', 'auth-outcome-unknown']);
    const profileScopes = new Set();
    for (const profile of registry.profiles) {
      uuid(profile.id); uuid(profile.epoch); const scope = `${profile.id}:${profile.epoch}`;
      if (profileScopes.has(scope) || !states.has(profile.state) || typeof profile.label !== 'string' || profile.label.length > 80 || /\p{C}/u.test(profile.label) || profile.configSha256 !== undefined && !isHash(profile.configSha256)) throw fail('recovery_metadata_unverified', 'Native profile metadata is malformed');
      profileScopes.add(scope);
      if (profile.login) { uuid(profile.login.id); uuid(profile.login.actionId); if (!loginStates.has(profile.login.state)) throw fail('recovery_metadata_unverified', 'Native login metadata is malformed'); }
    }
    for (const row of registry.receipts) { uuid(row.actionId); uuid(row.profileId); uuid(row.epoch); if (row.kind !== 'remove-profile' && !profileScopes.has(`${row.profileId}:${row.epoch}`) || !['prepare-profile', 'device-login', 'cancel-login', 'profile-config', 'remove-profile'].includes(row.kind) || typeof row.state !== 'string' || !/^[a-z][a-z_-]{0,79}$/.test(row.state)) throw fail('recovery_metadata_unverified', 'Native registry receipts are malformed'); if (!['completed', 'signed-in-checking', 'failed', 'cancelled'].includes(row.state) && !(row.kind === 'cancel-login' && row.state === 'settled')) unsettledActionCount++; }
    function marker(file, kind, scope = {}) {
      const record = read(file, 4096, true); if (!record) return null;
      const value = json(record), keys = MARKER_KEYS[kind];
      if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key)) || !Number.isSafeInteger(value.pid) || value.pid < 2) throw fail('recovery_marker_unverified', 'Native owner marker has an unsupported schema');
      for (const key of keys) if (key !== 'pid') uuid(value[key]);
      const row = { file, kind, ...scope, ...facts(record), formerPid: value.pid, ...(value.actionId ? { actionId: value.actionId } : {}), ...(value.serverGeneration ? { serverGeneration: value.serverGeneration } : {}) }; markers.push(row); return row;
    }
    const rootMarker = marker(path.join(authorityHome, 'owner.lock'), 'authority');
    if (!rootMarker) throw fail('recovery_not_required', 'No stale Native authority owner marker is present');
    for (const profile of registry.profiles) {
      uuid(profile.id); uuid(profile.epoch);
      const root = path.join(authorityHome, 'profiles', profile.id, 'epochs', profile.epoch);
      for (const folder of [path.join(authorityHome, 'profiles'), path.join(authorityHome, 'profiles', profile.id), path.join(authorityHome, 'profiles', profile.id, 'epochs'), root]) dir(folder);
      const scope = { profileId: profile.id, epoch: profile.epoch };
      const execution = marker(path.join(root, '.execution-owner'), 'execution', scope), inventory = marker(path.join(root, '.inventory-owner'), 'inventory', scope);
      if (execution && inventory) throw fail('recovery_ownership_conflict', 'Native epoch has contradictory operation owners');
      if (execution) {
        dir(executionRoot); const generation = path.join(executionRoot, execution.serverGeneration); dir(generation);
        const generationValue = json(read(path.join(generation, 'generation.json'), 2 * 1024 * 1024));
        if (generationValue.version !== 1 || generationValue.profileId !== profile.id || generationValue.epoch !== profile.epoch || generationValue.serverGeneration !== execution.serverGeneration || !Array.isArray(generationValue.modelAdmissions) || !generationValue.modelAdmissions.length) throw fail('recovery_journal_unverified', 'Native execution generation does not match its marker');
        const admissions = new Set(generationValue.modelAdmissions.map(row => row.admissionId)); if ([...admissions].some(id => !isHash(id))) throw fail('recovery_journal_unverified', 'Native execution admissions are malformed');
        uuid(generationValue.inventoryActionId);
        const bindings = path.join(generation, 'bindings'); dir(bindings); const entries = fs.readdirSync(bindings); if (entries.length > 128) throw fail('recovery_quota', 'Too many retained Native bindings');
        for (const name of entries) {
          if (!isHash(name)) throw fail('recovery_journal_unverified', 'Unexpected Native binding metadata');
          const binding = path.join(bindings, name); dir(binding); const actions = json(read(path.join(binding, 'actions.json'), 16 * 1024 * 1024));
          if (actions.version !== 1 || !admissions.has(actions.admissionId) || !Array.isArray(actions.actions) || actions.actions.length > 128) throw fail('recovery_journal_unverified', 'Native canonical actions do not match admission');
          for (const action of actions.actions) { uuid(action.actionId); uuid(action.workerHandle); if (!['prepared', 'offered', 'acknowledged', 'completed', 'failed', 'unknown'].includes(action.state) || typeof action.ownerHeld !== 'boolean' || typeof action.retired !== 'boolean' || typeof action.inputHash !== 'string' || !Array.isArray(action.observations) || action.observations.length > 32 || action.observations.some(fact => !['prepared', 'offered', 'acknowledged', 'completed', 'failed', 'unknown'].includes(fact.state) || typeof fact.ownerHeld !== 'boolean' || !Number.isSafeInteger(fact.timestampMs) || fact.turnId !== null && !/^[a-f0-9-]{36}$/i.test(fact.turnId))) throw fail('recovery_journal_unverified', 'Native canonical action is malformed'); if (!['completed', 'failed'].includes(action.state) || action.ownerHeld) unsettledActionCount++; }
          const journalOwner = read(path.join(binding, 'owner.lock'), 4096, true);
          if (journalOwner) { const owner = json(journalOwner); uuid(owner.nonce); if (Object.keys(owner).length !== 2 || owner.pid !== execution.formerPid || !Number.isSafeInteger(owner.pid)) throw fail('recovery_ownership_conflict', 'Native journal owner contradicts its generation'); }
        }
      }
      if (inventory) {
        dir(inventoryRoot); const row = json(read(path.join(inventoryRoot, inventory.actionId + '.json'), 256 * 1024));
        if (row.actionId !== inventory.actionId || row.profileId !== profile.id || row.epoch !== profile.epoch || !['prepared', 'running', 'completed', 'failed', 'unknown'].includes(row.state) || typeof row.ownerHeld !== 'boolean') throw fail('recovery_journal_unverified', 'Native inventory receipt does not match its marker');
        if (!['completed', 'failed'].includes(row.state) || row.ownerHeld) unsettledActionCount++;
      }
    }
    if (markers.length > 33 || markers.some(row => row.formerPid !== rootMarker.formerPid)) throw fail('recovery_ownership_conflict', 'Native markers do not identify one former authority');
    // The root ownership barrier is always removed last.
    markers.sort((a, b) => (a.kind === 'authority') - (b.kind === 'authority') || a.file.localeCompare(b.file));
    return { version: 1, markers, evidence: evidence.sort((a, b) => a.file.localeCompare(b.file)), directories: [...directories].sort(([a], [b]) => a.localeCompare(b)), unsettledActionCount };
  }
  async function observe(plan) {
    if (isBusy() || closing) throw fail('recovery_current_owner_live', 'Current Native account ownership is live or closing');
    const worker = await getWorkerPin(), runtime = await getMetadataRuntimePin();
    const pins = [{ executable, sha256: executableSha256 }, { executable: worker?.executable, sha256: worker?.executableSha256 }];
    for (const pin of pins) {
      if (!isHash(pin.sha256 || '') || typeof pin.executable !== 'string' || !path.isAbsolute(pin.executable) || fs.realpathSync(pin.executable) !== pin.executable) throw fail('recovery_executable_unverified', 'Native executable identities are unavailable');
      if (recoveryExecutableDigest(pin.executable) !== pin.sha256) throw fail('recovery_executable_unverified', 'Native executable pin changed');
    }
    if (typeof runtime?.bunPath !== 'string' || !isHash(runtime.bunSha256 || '')) throw fail('recovery_runtime_unavailable', 'Recovery metadata runtime is unavailable');
    const formerPids = [...new Set(plan.markers.map(row => row.formerPid))];
    const proof = await (testHooks.observeProcesses || observeNativeRecoveryProcesses)({ getMetadataRuntimePin: async () => runtime, paths: [...pins.map(row => row.executable), '/usr/bin/sandbox-exec'], formerPids });
    if (proof.complete !== true || proof.matches?.length !== 0 || proof.former?.length !== formerPids.length || proof.former.some((row, index) => row.pid !== formerPids[index] || row.absent !== true)) throw fail('recovery_physical_owner_unverified', 'A Native owner, worker or launch carrier is live or unverified');
    return { pins, observerSourceSha256: digest(NATIVE_RECOVERY_OBSERVER_SOURCE), runtime: { bunPath: runtime.bunPath, bunSha256: runtime.bunSha256 }, physicalProof: { method: 'libproc-owned-uid-v1', uid: process.getuid(), absentFormerPids: formerPids, relevantProcesses: 0 } };
  }
  async function prepare(allowHeld = false) {
    if (isBusy() || closing || active || !allowHeld && heldRecovery()) throw fail('recovery_owner_held', 'Native recovery or execution ownership is held');
    const plan = gather(), executables = await observe(plan);
    if (closing || isBusy()) throw fail('recovery_owner_held', 'Native ownership closed or changed during observation');
    if (canonical(plan) !== canonical(gather())) throw fail('recovery_source_changed', 'Native ownership changed during physical observation');
    return { plan, executables, reviewDigest: digest(canonical({ plan, executables })) };
  }
  async function previewRecovery() {
    try { const value = await prepare(); return { state: 'reviewable', reviewDigest: value.reviewDigest, observedAt: Date.now(), markers: value.plan.markers.map(({ kind, profileId, epoch, sha256, formerPid }) => ({ kind, ...(profileId ? { profileId, epoch } : {}), sha256, formerPid })), unsettledActionCount: value.plan.unsettledActionCount }; }
    catch (error) { return { state: 'blocked', reasonCode: notifyError(error), observedAt: Date.now(), markers: [], unsettledActionCount: 0 }; }
  }
  async function recoverOwner(input = {}) {
    const { actionId, reviewDigest } = input; uuid(actionId);
    if (Object.keys(input).some(key => !['actionId', 'reviewDigest'].includes(key)) || !isHash(reviewDigest || '')) throw fail('invalid_recovery_action', 'Recovery requires the exact reviewed ownership digest');
    const existing = inspectRecovery(actionId); if (existing) return existing;
    let row, lockBytes, directoryPath, prepared, retirementStarted = false;
    try {
      prepared = await prepare();
      if (prepared.reviewDigest !== reviewDigest) throw fail('recovery_review_changed', 'Review the changed Native ownership before recovery');
      try { fs.mkdirSync(storage, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
      directory(storage);
      if (fs.readdirSync(storage).length >= 128) throw fail('recovery_quota', 'Native recovery receipt storage is full');
    } catch (error) { error.actionRecorded = false; throw error; }
    active = true;
    try {
      lockBytes = JSON.stringify({ pid: process.pid, nonce: randomUUID(), actionId }); fs.writeFileSync(gate, lockBytes, { flag: 'wx', mode: 0o600 }); sync(storage);
      directoryPath = path.join(storage, actionId); fs.mkdirSync(directoryPath, { mode: 0o700 });
      row = { version: 1, actionId, reviewDigest, state: 'prepared', ownerHeld: true, archivedCount: 0, unsettledActionCount: prepared.plan.unsettledActionCount, preparedAt: Date.now(), plan: prepared.plan, executables: prepared.executables, gateFacts: facts(privateRead(gate, 4096)), archive: [] };
      writeReceipt(receiptPath(actionId), row);
      // Exclusive gate is held. Recheck all bytes and one fresh kernel proof
      // immediately before the first marker retirement; no original action runs.
      if (isBusy() || canonical(prepared.plan) !== canonical(gather())) throw fail('recovery_source_changed', 'Native ownership changed before retirement');
      const proofPlan = await observe(prepared.plan);
      if (canonical(proofPlan) !== canonical(prepared.executables) || canonical(gather()) !== canonical(prepared.plan)) throw fail('recovery_source_changed', 'Native ownership proof changed');
      for (let index = 0; index < prepared.plan.markers.length; index++) {
        testHooks.beforeRetire?.(index);
        for (const [file, expected] of prepared.plan.directories) if (canonical(directory(file)) !== canonical(expected)) throw fail('recovery_source_changed', 'Native recovery directory identity changed');
        directory(storage); directory(directoryPath);
        const marker = prepared.plan.markers[index], observed = privateRead(marker.file, 4096, false, marker);
        if (canonical(facts(observed)) !== canonical(Object.fromEntries(Object.entries(marker).filter(([key]) => ['sha256', 'dev', 'ino', 'size', 'mode', 'uid', 'mtimeNs', 'ctimeNs'].includes(key))))) throw fail('recovery_source_changed', 'Native owner marker changed before retirement');
        const archived = path.join(directoryPath, `marker-${index}.json`); row.state = 'archiving'; writeReceipt(receiptPath(actionId), row);
        retirementStarted = true;
        fs.renameSync(marker.file, archived); sync(path.dirname(marker.file)); sync(directoryPath);
        testHooks.afterRename?.(index);
        const captured = privateRead(archived, 4096, false, marker);
        if (captured.sha256 !== marker.sha256 || captured.dev !== marker.dev || captured.ino !== marker.ino) throw fail('recovery_archive_unknown', 'Archived owner identity differs');
        row.archive.push({ kind: marker.kind, file: archived, sha256: captured.sha256, dev: captured.dev, ino: captured.ino }); row.archivedCount++; writeReceipt(receiptPath(actionId), row);
      }
      row.state = 'completed'; row.ownerHeld = false; row.completedAt = Date.now(); writeReceipt(receiptPath(actionId), row);
      if (privateRead(gate, 4096).bytes.toString() !== lockBytes) throw fail('recovery_gate_changed', 'Recovery ownership gate changed'); fs.unlinkSync(gate); sync(storage); return project(row);
    } catch (error) {
      if (row) { row.state = retirementStarted ? 'unknown' : 'failed'; row.ownerHeld = retirementStarted; row.reasonCode = notifyError(error); try { writeReceipt(receiptPath(actionId), row); } catch {} }
      if (!row?.ownerHeld && lockBytes) { try { if (privateRead(gate, 4096).bytes.toString() === lockBytes) { fs.unlinkSync(gate); sync(storage); } } catch {} }
      error.actionRecorded = Boolean(row); throw error;
    } finally { active = false; }
  }
  function own(fn) {
    if (closing || pending.size) { const error = fail('recovery_owner_held', 'Native recovery is already owned or closing'); error.actionRecorded = false; return Promise.reject(error); }
    const promise = Promise.resolve().then(fn); pending.add(promise); promise.finally(() => pending.delete(promise)).catch(() => {}); return promise;
  }
  return Object.freeze({ previewRecovery: () => own(previewRecovery), recoverOwner: input => {
    uuid(input?.actionId); const existing = inspectRecovery(input.actionId);
    if (existing) {
      if (existing.reviewDigest && existing.reviewDigest !== input.reviewDigest) { const error = fail('recovery_action_conflict', 'Recovery action identity belongs to another review'); error.actionRecorded = true; return Promise.reject(error); }
      return Promise.resolve(existing);
    }
    return own(() => recoverOwner(input));
  }, inspectRecovery, assertNotRecovering,
    activeCount: () => pending.size || (heldRecovery() ? 1 : 0), currentOperation: () => pending.size || heldRecovery() ? 'Native owner recovery' : null,
    async destroy() { closing = true; await Promise.allSettled([...pending]); if (heldRecovery()) throw fail('recovery_owner_held', 'Native recovery requires exact receipt reconciliation'); } });
}
module.exports = { createNativeAccountRecovery };
