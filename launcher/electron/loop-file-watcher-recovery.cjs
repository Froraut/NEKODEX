'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = value => typeof value === 'string' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(value);
const record = value => value && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = (code, message) => Object.assign(new Error(message), { code });
const facts = value => { if (!value) return null; const { bytes, ...rest } = value; return rest; };
function sync(directory) { const fd = fs.openSync(directory, 'r'); try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); } }
function directoryFacts(directory) {
  const st = fs.lstatSync(directory, { bigint: true });
  if (!st.isDirectory() || st.isSymbolicLink() || fs.realpathSync(directory) !== directory || typeof process.getuid !== 'function'
      || st.uid !== BigInt(process.getuid()) || st.mode & 0o077n) throw fail('LOOP_SOURCE_RECOVERY_UNSAFE_STORAGE', 'Loop recovery requires canonical private owned storage');
  return { dev: String(st.dev), ino: String(st.ino), mode: String(st.mode), uid: String(st.uid) };
}
function readPrivate(file, limit, optional = false) {
  let fd;
  try { fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK); }
  catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
  try {
    const before = fs.fstatSync(fd, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || typeof process.getuid !== 'function' || before.uid !== BigInt(process.getuid())
        || before.mode & 0o077n || before.size > BigInt(limit) || fs.realpathSync(file) !== file) throw fail('LOOP_SOURCE_RECOVERY_UNSAFE_STORAGE', 'Loop recovery metadata must be private owned regular files');
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd, { bigint: true }), linked = fs.lstatSync(file, { bigint: true });
    if (bytes.length > limit || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size
        || before.mtimeNs !== after.mtimeNs || before.ctimeNs !== after.ctimeNs || before.nlink !== after.nlink
        || before.dev !== linked.dev || before.ino !== linked.ino || before.size !== linked.size
        || before.mtimeNs !== linked.mtimeNs || before.ctimeNs !== linked.ctimeNs || linked.isSymbolicLink()) throw fail('LOOP_SOURCE_RECOVERY_CHANGED', 'Loop recovery metadata changed while observed');
    return { bytes, sha256: hash(bytes), dev: String(before.dev), ino: String(before.ino), size: bytes.length,
      mode: String(before.mode), uid: String(before.uid), mtimeNs: String(before.mtimeNs), ctimeNs: String(before.ctimeNs) };
  } finally { fs.closeSync(fd); }
}
function json(value) {
  try { return JSON.parse(value.bytes.toString('utf8')); }
  catch { throw fail('LOOP_SOURCE_RECOVERY_INVALID_METADATA', 'Retained Loop metadata is malformed; preserve it for explicit inspection'); }
}
function observePid(pid) {
  try { process.kill(pid, 0); return 'live'; }
  catch (error) { return error.code === 'ESRCH' ? 'absent' : 'unknown'; }
}
function registrySummary(value) {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.rows) || value.rows.length > 16) throw fail('LOOP_SOURCE_RECOVERY_INVALID_METADATA', 'Retained Loop registry is unsupported');
  const eventCounts = { pending: 0, unknown: 0, delivered: 0 };
  const id = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f]/u.test(value);
  const sourceIds = new Set(), taskIds = new Set();
  for (const row of value.rows) {
    if (!record(row) || !id(row.id) || !id(row.taskId) || !id(row.projectId) || sourceIds.has(row.id) || taskIds.has(row.taskId)
        || typeof row.projectPath !== 'string' || !path.isAbsolute(row.projectPath) || typeof row.relativePath !== 'string'
        || !row.relativePath || path.isAbsolute(row.relativePath) || row.relativePath.split(path.sep).some(part => !part || part === '..' || part === '.' || part.toLowerCase() === '.git')
        || !Array.isArray(row.events) || row.events.length > 32) throw fail('LOOP_SOURCE_RECOVERY_INVALID_METADATA', 'Retained Loop source metadata is unsupported');
    sourceIds.add(row.id); taskIds.add(row.taskId);
    for (const event of row.events) {
      if (!record(event) || !id(event.eventId) || !id(event.actionId) || !id(event.workId) || !id(event.workKey)
          || !Object.hasOwn(eventCounts, event.state) || typeof event.text !== 'string' || Buffer.byteLength(event.text) > 16384) throw fail('LOOP_SOURCE_RECOVERY_INVALID_METADATA', 'Retained Loop event receipt is unsupported');
      eventCounts[event.state]++;
    }
  }
  return { sourceCount: value.rows.length, eventCounts };
}
function writeNew(file, bytes) {
  const fd = fs.openSync(file, 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function writeReceipt(file, receipt) {
  const temporary = path.join(path.dirname(file), `.${randomUUID()}.tmp`);
  try { writeNew(temporary, JSON.stringify(receipt)); fs.renameSync(temporary, file); sync(path.dirname(file)); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}

/** Explicit metadata-only retirement of one reviewed, physically absent JS
 * watcher owner. No source paths are opened and no core/Run/enqueue port exists.
 * A partial transaction keeps its gate/receipt held; inspection never resumes it. */
function createLoopFileWatcherRecovery({ directory }) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw fail('LOOP_SOURCE_RECOVERY_UNSAFE_STORAGE', 'Loop recovery requires fixed main-owned storage');
  directory = path.resolve(directory);
  const lock = path.join(directory, 'owner.lock'), registry = path.join(directory, 'watchers.json'), gate = path.join(directory, 'recovery.lock'), storage = path.join(directory, 'recovery');
  let closing = false, active = false;
  const hasGate = () => { try { fs.lstatSync(gate); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } };
  function readGate(optional = true) {
    const retained = readPrivate(gate, 4096, optional);
    if (!retained) return null;
    const value = json(retained);
    if (!record(value) || Object.keys(value).sort().join(',') !== 'nonce,pid,recoveryId'
        || !Number.isSafeInteger(value.pid) || value.pid < 2 || !uuid(value.nonce) || !uuid(value.recoveryId)) throw fail('LOOP_SOURCE_RECOVERY_INVALID_METADATA', 'Retained Loop recovery writer metadata is unsupported');
    return { retained, value };
  }
  function gather() {
    const directory = directoryFacts(path.dirname(lock)), ownerRecord = readPrivate(lock, 4096, true), registryRecord = readPrivate(registry, 1024 * 1024, true);
    let owner = null;
    if (ownerRecord) {
      const value = json(ownerRecord);
      if (!record(value) || Object.keys(value).sort().join(',') !== 'nonce,pid' || !Number.isSafeInteger(value.pid) || value.pid < 2 || !uuid(value.nonce)) throw fail('LOOP_SOURCE_RECOVERY_INVALID_METADATA', 'Retained Loop owner metadata is unsupported');
      owner = { pid: value.pid, nonce: value.nonce, state: observePid(value.pid), proof: 'pid-signal-zero' };
    }
    const saved = registryRecord ? json(registryRecord) : { version: 1, rows: [] }, summary = registrySummary(saved);
    const plan = { directory, lock: facts(ownerRecord), registry: facts(registryRecord) };
    return { plan, reviewDigest: hash(JSON.stringify(plan)), ownerRecord, registryRecord, owner, saved, ...summary };
  }
  function project(receipt) {
    return { version: 1, recoveryId: receipt.recoveryId, reviewDigest: receipt.reviewDigest, state: ['completed', 'rejected'].includes(receipt.state) ? receipt.state : 'unknown',
      terminal: ['completed', 'rejected'].includes(receipt.state) && receipt.ownerHeld === false, ownerHeld: receipt.ownerHeld !== false, recovered: receipt.state === 'completed' && receipt.ownerHeld === false,
      sourceCount: receipt.sourceCount, unknownCount: receipt.unknownCount, enabled: false, startsRun: false, ...(receipt.reason ? { reason: receipt.reason } : {}) };
  }
  function inspect(recoveryId) {
    if (!uuid(recoveryId)) throw fail('LOOP_SOURCE_RECOVERY_INVALID_REQUEST', 'Exact Loop recovery identity required');
    directoryFacts(directory);
    if (!fs.existsSync(storage)) return undefined;
    directoryFacts(storage); const actionDirectory = path.join(storage, recoveryId);
    if (!fs.existsSync(actionDirectory)) return undefined;
    directoryFacts(actionDirectory); const retained = readPrivate(path.join(actionDirectory, 'receipt.json'), 64 * 1024, true);
    if (!retained) return { version: 1, recoveryId, state: 'unknown', terminal: false, ownerHeld: true, recovered: false, enabled: false, startsRun: false, reason: 'recovery_receipt_unavailable' };
    const receipt = json(retained);
    if (!record(receipt) || receipt.version !== 1 || receipt.recoveryId !== recoveryId || !/^[a-f0-9]{64}$/.test(receipt.reviewDigest)
        || !['prepared', 'registry_replaced', 'owner_archived', 'completed', 'rejected', 'unknown'].includes(receipt.state)
        || typeof receipt.ownerHeld !== 'boolean' || !Number.isSafeInteger(receipt.sourceCount) || !Number.isSafeInteger(receipt.unknownCount)) throw fail('LOOP_SOURCE_RECOVERY_INVALID_METADATA', 'Retained Loop recovery receipt is unsupported');
    if (hasGate()) {
      const held = readGate(false).value;
      if (held.recoveryId === recoveryId) return project({ ...receipt, state: 'unknown', ownerHeld: true, reason: 'recovery_writer_unsettled' });
    }
    return project(receipt);
  }
  function review() {
    if (closing) throw fail('LOOP_SOURCE_RECOVERY_CLOSED', 'Loop recovery owner is closed');
    const gateRecord = readGate(), checked = gather(), held = Boolean(gateRecord), state = checked.owner?.state;
    const retainedRecovery = gateRecord ? { recoveryId: gateRecord.value.recoveryId, receipt: inspect(gateRecord.value.recoveryId) ?? null } : null;
    // Discovery exposes the existing transaction identity, never the newly
    // minted preview ID. Neither discovery nor inspection resumes that writer.
    if (!same(facts(gateRecord?.retained), facts(readGate()?.retained))) throw fail('LOOP_SOURCE_RECOVERY_CHANGED', 'Retained Loop recovery writer changed during review');
    return { version: 1, reviewId: randomUUID(), reviewDigest: checked.reviewDigest, recoverable: !held && state === 'absent',
      reason: held ? 'recovery_in_progress' : !checked.owner ? 'no_retained_owner' : state === 'absent' ? 'owner_absent' : state === 'live' ? 'owner_live' : 'owner_unverified',
      owner: checked.owner, sourceCount: checked.sourceCount, eventCounts: checked.eventCounts, retainedRecovery, contentIncluded: false, startsRun: false };
  }
  function recover(input) {
    if (!record(input) || Object.keys(input).sort().join(',') !== 'explicitUserAction,reviewDigest,reviewId' || input.explicitUserAction !== true
        || !uuid(input.reviewId) || !/^[a-f0-9]{64}$/.test(input.reviewDigest)) throw fail('LOOP_SOURCE_RECOVERY_INVALID_REQUEST', 'Explicit reviewed Loop recovery required');
    if (closing || active) throw fail('LOOP_SOURCE_RECOVERY_CLOSED', 'Loop recovery admission is closed');
    const prior = inspect(input.reviewId);
    if (prior) {
      if (prior.reviewDigest !== undefined && prior.reviewDigest !== input.reviewDigest) throw fail('LOOP_SOURCE_RECOVERY_CHANGED', 'Loop recovery action identity conflicts with its retained receipt');
      return prior;
    }
    const rootFacts = directoryFacts(directory), gateBytes = Buffer.from(JSON.stringify({ pid: process.pid, nonce: randomUUID(), recoveryId: input.reviewId }));
    try { writeNew(gate, gateBytes); sync(directory); }
    catch (error) { if (error.code === 'EEXIST') throw fail('LOOP_SOURCE_RECOVERY_IN_PROGRESS', 'Another Loop recovery writer is retained; inspect it without replay'); throw error; }
    active = true; let receipt, receiptFile, actionDirectory, actionFacts, storageFacts, installedRegistry = null, mutated = false, completed = false, rejected = false;
    const assertGate = () => {
      if (!same(directoryFacts(directory), rootFacts) || !readPrivate(gate, 4096).bytes.equals(gateBytes)
          || storageFacts && !same(directoryFacts(storage), storageFacts) || actionFacts && !same(directoryFacts(actionDirectory), actionFacts)) throw fail('LOOP_SOURCE_RECOVERY_CHANGED', 'Loop recovery storage or writer changed');
    };
    try {
      assertGate();
      fs.mkdirSync(storage, { recursive: true, mode: 0o700 }); storageFacts = directoryFacts(storage);
      if (fs.readdirSync(storage).length >= 128) throw fail('LOOP_SOURCE_RECOVERY_QUOTA', 'Retained Loop recovery receipt quota reached');
      actionDirectory = path.join(storage, input.reviewId); fs.mkdirSync(actionDirectory, { mode: 0o700 }); actionFacts = directoryFacts(actionDirectory); sync(storage);
      receiptFile = path.join(actionDirectory, 'receipt.json');
      receipt = { version: 1, recoveryId: input.reviewId, reviewDigest: input.reviewDigest, state: 'prepared', ownerHeld: true,
        sourceCount: 0, unknownCount: 0, createdAt: new Date().toISOString() };
      writeReceipt(receiptFile, receipt);
      const checked = gather();
      receipt.sourceCount = checked.sourceCount; receipt.unknownCount = checked.eventCounts.unknown + checked.eventCounts.pending;
      receipt.formerOwner = checked.owner; receipt.plan = checked.plan;
      if (checked.reviewDigest !== input.reviewDigest) throw fail('LOOP_SOURCE_RECOVERY_CHANGED', 'Retained Loop owner or registry changed since review; review again');
      if (!checked.owner || checked.owner.state !== 'absent') throw fail('LOOP_SOURCE_RECOVERY_OWNER_UNVERIFIED', 'The old Loop PID is live, reused or unverified; it will not be stopped or claimed closed');
      writeReceipt(receiptFile, receipt);
      const assertOriginal = (file, expected, limit) => { if (!same(facts(readPrivate(file, limit, true)), expected)) throw fail('LOOP_SOURCE_RECOVERY_CHANGED', 'Reviewed Loop metadata changed before archive'); };
      const assertArchive = (file, expected, limit) => {
        const archived = facts(readPrivate(file, limit));
        if (!['sha256', 'dev', 'ino', 'size', 'mode', 'uid', 'mtimeNs'].every(key => archived[key] === expected[key])) throw fail('LOOP_SOURCE_RECOVERY_CHANGED', 'Archived Loop metadata identity is unverified');
      };
      assertGate(); assertOriginal(lock, checked.plan.lock, 4096); assertOriginal(registry, checked.plan.registry, 1024 * 1024);
      if (observePid(checked.owner.pid) !== 'absent') throw fail('LOOP_SOURCE_RECOVERY_OWNER_UNVERIFIED', 'The reviewed Loop PID is no longer provably absent');
      if (checked.registryRecord) {
        const next = structuredClone(checked.saved);
        for (const row of next.rows) { row.enabled = false; row.reason = 'recovered_requires_explicit_enable'; for (const event of row.events) if (event.state === 'pending') event.state = 'unknown'; }
        const candidate = path.join(actionDirectory, 'next-watchers.json'), nextBytes = Buffer.from(JSON.stringify(next)); writeNew(candidate, nextBytes); sync(actionDirectory);
        // Preserve the original registry inode and bytes. The recovery gate and
        // original owner marker remain held across this two-rename replacement.
        assertGate(); assertOriginal(lock, checked.plan.lock, 4096); assertOriginal(registry, checked.plan.registry, 1024 * 1024);
        fs.renameSync(registry, path.join(actionDirectory, 'watchers.json')); mutated = true; sync(directory); sync(actionDirectory);
        assertArchive(path.join(actionDirectory, 'watchers.json'), checked.plan.registry, 1024 * 1024);
        fs.renameSync(candidate, registry); sync(directory); sync(actionDirectory);
        installedRegistry = facts(readPrivate(registry, 1024 * 1024));
        if (installedRegistry.sha256 !== hash(nextBytes)) throw fail('LOOP_SOURCE_RECOVERY_CHANGED', 'Recovered Loop registry changed before commit');
        receipt.state = 'registry_replaced'; writeReceipt(receiptFile, receipt);
      }
      assertGate(); assertOriginal(lock, checked.plan.lock, 4096);
      assertOriginal(registry, installedRegistry, 1024 * 1024);
      if (observePid(checked.owner.pid) !== 'absent') throw fail('LOOP_SOURCE_RECOVERY_OWNER_UNVERIFIED', 'The reviewed Loop PID is no longer provably absent');
      // Retire only the exact reviewed marker, last. A new service must acquire
      // its own owner lock after this transaction releases its recovery gate.
      fs.renameSync(lock, path.join(actionDirectory, 'owner.lock')); mutated = true; sync(directory); sync(actionDirectory);
      assertArchive(path.join(actionDirectory, 'owner.lock'), checked.plan.lock, 4096);
      receipt.state = 'owner_archived'; writeReceipt(receiptFile, receipt);
      assertGate(); receipt.state = 'completed'; receipt.ownerHeld = false; writeReceipt(receiptFile, receipt);
      fs.unlinkSync(gate); sync(directory); completed = true;
      return project(receipt);
    } catch (error) {
      if (receipt && mutated) {
        receipt.state = 'unknown'; receipt.ownerHeld = true; receipt.reason = error.code || 'recovery_outcome_unknown';
        try { writeReceipt(receiptFile, receipt); } catch { /* Keep the writer gate and original/archive metadata held. */ }
        throw Object.assign(error, { recoveryId: input.reviewId, recoveryReceipt: project(receipt) });
      }
      if (receipt) {
        receipt.state = 'rejected'; receipt.ownerHeld = false; receipt.reason = error.code || 'recovery_rejected_before_mutation';
        try { assertGate(); writeReceipt(receiptFile, receipt); rejected = true; }
        catch { receipt.state = 'unknown'; receipt.ownerHeld = true; }
        throw Object.assign(error, { recoveryId: input.reviewId, recoveryReceipt: project(receipt) });
      }
      throw error;
    } finally {
      active = false;
      if (!mutated && !completed && (!receipt || rejected)) { assertGate(); fs.unlinkSync(gate); sync(directory); }
    }
  }
  return { review, recover, inspect, currentOperation: () => active ? 'Loop source owner recovery' : null, close() { closing = true; } };
}
module.exports = { createLoopFileWatcherRecovery };
