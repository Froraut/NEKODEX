"use strict";

// OpenSSH owns host-key/authentication checks. This owner speaks SFTP v3 over its
// subsystem pipe; renderer values never become local shell syntax or SSH options.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, createHmac, randomBytes, randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { REMOTE_GIT_HELPER, createRemoteWorktreeController } = require('./remote-worktrees.cjs');
const { createRemoteGitReviewController, validateRemoteGitReviewRecords, REMOTE_GIT_REVIEW_LIMITS } = require('./remote-git-review.cjs');
const { REMOTE_GIT_REVIEW_HELPER } = require('./remote-git-review-helper.cjs');
const { resolveSshConfigAlias, assertSshConfigSnapshot } = require('./remote-ssh-config.cjs');
const LIMITS = Object.freeze({ bytes: 256 * 1024, entries: 300, hosts: 24, receipts: 100, drafts: 40 });
const AGENT_LIMITS = Object.freeze({ intents: 48, resultBytes: 180 * 1024, bindings: 64 });
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const record = value => value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (record(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  fail('AGENT', 'Remote Agent values must be plain JSON.');
}
function agentScope(value, task = false) {
  if (!record(value) || typeof value.taskId !== 'string' || !value.taskId || value.taskId.length > 200 || !Number.isSafeInteger(value.generation) || value.generation < 1
    || (task && (typeof value.familyId !== 'string' || !value.familyId || value.familyId.length > 200 || !Number.isSafeInteger(value.revision) || value.revision < 1))) fail('AGENT', 'Invalid current remote Agent task scope.');
  return value;
}
function agentInvocation(input) {
  if (!record(input) || Object.keys(input).some(k => !['scope', 'tool', 'arguments', 'idempotencyKey'].includes(k)) || !['remote/list', 'remote/read', 'remote/command'].includes(input.tool)
    || typeof input.idempotencyKey !== 'string' || !input.idempotencyKey || input.idempotencyKey.length > 240 || !record(input.arguments) || !record(input.arguments.binding)) fail('AGENT', 'Invalid exact remote Agent invocation.');
  agentScope(input.scope);
  if (Object.keys(input.scope).sort().join(',') !== 'generation,taskId,toolCallId' || typeof input.scope.toolCallId !== 'string' || !input.scope.toolCallId || input.scope.toolCallId.length > 200) fail('AGENT', 'Invalid remote Agent tool scope.');
  const args = input.arguments;
  if (input.tool === 'remote/command') {
    if (Object.keys(args).sort().join(',') !== 'binding,command,timeoutSeconds' || typeof args.command !== 'string' || !args.command.trim() || Buffer.byteLength(args.command) > 16384 || args.command.includes('\0')
      || !Number.isInteger(args.timeoutSeconds) || args.timeoutSeconds < 1 || args.timeoutSeconds > 3600) fail('COMMAND', 'Provide an exact command and a 1–3600 second execution limit.');
  } else {
    if (Object.keys(args).some(k => !['binding', 'path'].includes(k))) fail('AGENT', 'Invalid remote Agent read arguments.');
    relative(args.path ?? '', input.tool === 'remote/list');
  }
  const encoded = canonical(input);
  if (Buffer.byteLength(encoded) > 64 * 1024) fail('AGENT', 'Remote Agent invocation exceeds its bound.');
  return { request: JSON.parse(encoded), fingerprint: hash(encoded) };
}
const uint = value => { const b = Buffer.alloc(4); b.writeUInt32BE(value); return b; };
const str = value => { const b = Buffer.isBuffer(value) ? value : Buffer.from(value); return Buffer.concat([uint(b.length), b]); };
const offset = value => { const b = Buffer.alloc(8); b.writeBigUInt64BE(BigInt(value)); return b; };
class Reader {
  constructor(bytes) { this.bytes = bytes; this.at = 0; }
  take(n) { if (!Number.isSafeInteger(n) || n < 0 || this.at + n > this.bytes.length) fail('PROTOCOL', 'Invalid SFTP response.'); const b = this.bytes.subarray(this.at, this.at += n); return b; }
  u32() { return this.take(4).readUInt32BE(); }
  string() { return this.take(this.u32()); }
  text() { return new TextDecoder('utf-8', { fatal: true }).decode(this.string()); }
  attrs() { const flags = this.u32(); const result = {}; if (flags & 1) result.size = Number(this.take(8).readBigUInt64BE()); if (flags & 2) this.take(8); if (flags & 4) result.mode = this.u32(); if (flags & 8) this.take(8); if (flags & 0x80000000) { const count = this.u32(); if (count > 100) fail('PROTOCOL', 'Too many SFTP attributes.'); for (let i = 0; i < count; i++) { this.string(); this.string(); } } return result; }
}
function validateHost(value) {
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['label', 'hostname', 'username', 'port', 'root', 'connectionMode'].includes(key))) fail('HOST', 'Invalid SSH host settings.');
  const { hostname, username, root } = value;
  const alias = value.connectionMode === 'ssh-config-alias';
  if (value.connectionMode !== undefined && !alias && value.connectionMode !== 'direct') fail('HOST', 'Unsupported SSH connection mode.');
  if (typeof hostname !== 'string' || !(alias ? /^[A-Za-z0-9][A-Za-z0-9_.-]{0,252}$/ : /^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/).test(hostname)
      || typeof username !== 'string' || !(alias && !username) && !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(username)
      || typeof root !== 'string' || !root.startsWith('/') || root.length > 4096 || /[\0\r\n]/.test(root)
      || root.split('/').includes('..') || !(alias && value.port === null) && (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535)
      || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 100) fail('HOST', 'Use a valid host, SSH user, port and absolute POSIX root.');
  return { label: value.label.trim(), hostname, username, port: value.port, root: path.posix.normalize(root), ...(alias ? { connectionMode: 'ssh-config-alias' } : {}) };
}
function relative(value, empty = false) {
  if (typeof value !== 'string' || value.length > 4096 || /[\0\\\r\n]/.test(value)
      || value.startsWith('/') || (!value && !empty) || (value && value.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git'))) fail('PATH', 'Use a path within the selected remote root.');
  return value;
}
function sshArgs(host, subsystem) {
  if (host.sshConfigSnapshot) assertSshConfigSnapshot(host.sshConfigSnapshot);
  const connection = host.sshConfigSnapshot?.connectionOptions;
  return ['-F', process.platform === 'win32' ? 'NUL' : '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', '-o', `ConnectTimeout=${connection?.ConnectTimeout ?? 15}`, '-o', 'ConnectionAttempts=1',
    '-o', `ServerAliveInterval=${connection?.ServerAliveInterval ?? 15}`, '-o', `ServerAliveCountMax=${connection?.ServerAliveCountMax ?? 3}`, ...(host.sshConfigSnapshot?.options ?? []), '-p', String(host.port), '-l', host.username,
    ...(subsystem ? ['-s'] : []), '--', host.hostname, ...(subsystem ? ['sftp'] : [])];
}
class Sftp {
  constructor(host, spawnProcess = spawn) {
    this.child = spawnProcess('ssh', sshArgs(host, true), { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    this.exited = new Promise(resolve => { this.exitResolve = resolve; });
    this.pending = new Map(); this.sequence = 0; this.buffer = Buffer.alloc(0); this.extensions = new Map(); this.stderr = '';
    this.ready = new Promise((resolve, reject) => { this.readyResolve = resolve; this.readyReject = reject; });
    this.timer = setTimeout(() => this.abort(new Error('SSH/SFTP connection timed out.')), 20000);
    this.child.stderr.on('data', b => { this.stderr = (this.stderr + b.toString()).slice(-4096); });
    this.child.stdout.on('data', b => { try { this.receive(b); } catch (error) { this.abort(error); } });
    this.child.on('error', error => this.abort(error));
    this.child.on('close', () => { this.abort(new Error(this.stderr.trim() || 'SSH/SFTP disconnected.')); this.exitResolve(); });
    this.child.stdin.on('error', error => this.abort(error));
    this.send(Buffer.concat([Buffer.from([1]), uint(3)]));
  }
  send(bytes) { this.child.stdin.write(Buffer.concat([uint(bytes.length), bytes])); }
  receive(bytes) {
    this.buffer = Buffer.concat([this.buffer, bytes]);
    while (this.buffer.length >= 4) {
      const size = this.buffer.readUInt32BE(); if (size < 1 || size > 1024 * 1024) fail('PROTOCOL', 'SFTP packet exceeds bounds.');
      if (this.buffer.length < size + 4) break;
      const packet = this.buffer.subarray(4, size + 4); this.buffer = this.buffer.subarray(size + 4);
      const type = packet[0]; const reader = new Reader(packet.subarray(1));
      if (type === 2) { if (this.version || reader.u32() !== 3) fail('PROTOCOL', 'SFTP version 3 is required.'); this.version = 3;
        while (reader.at < reader.bytes.length) this.extensions.set(reader.text(), reader.text()); clearTimeout(this.timer); this.readyResolve(); continue; }
      const id = reader.u32(); const waiting = this.pending.get(id); if (!waiting) fail('PROTOCOL', 'Unexpected SFTP response.');
      this.pending.delete(id); clearTimeout(waiting.timer);
      if (type === 101) { const code = reader.u32(); const message = reader.text(); if (code !== 0) waiting.reject(Object.assign(new Error(`SFTP ${code}: ${message}`), { sftpCode: code })); else waiting.resolve({ type, reader }); }
      else waiting.resolve({ type, reader });
    }
  }
  abort(error) { if (this.closed) return; this.closed = true; clearTimeout(this.timer); this.readyReject(error); for (const entry of this.pending.values()) { clearTimeout(entry.timer); entry.reject(error); } this.pending.clear(); this.child.kill(); }
  close() { this.abort(new Error('SFTP session closed.')); }
  async request(type, ...parts) { await this.ready; if (this.closed) throw new Error('SFTP is disconnected.'); const id = ++this.sequence;
    return new Promise((resolve, reject) => { const timer = setTimeout(() => this.abort(new Error('SFTP response timed out; operation may be incomplete.')), 30000);
      this.pending.set(id, { resolve, reject, timer }); try { this.send(Buffer.concat([Buffer.from([type]), uint(id), ...parts])); } catch (error) { this.abort(error); } }); }
  expect(response, type) { if (response.type !== type) fail('PROTOCOL', 'Unexpected SFTP response type.'); return response.reader; }
  async realpath(file) { const r = this.expect(await this.request(16, str(file)), 104); if (r.u32() !== 1) fail('PROTOCOL', 'Ambiguous SFTP realpath.'); return r.text(); }
  async stat(file) { try { return this.expect(await this.request(7, str(file)), 105).attrs(); } catch (e) { if (e.sftpCode === 2) return null; throw e; } }
  async handle(type, ...parts) { return this.expect(await this.request(type, ...parts), 102).string(); }
  async release(handle) { this.expect(await this.request(4, str(handle)), 101); }
  async list(file) { const handle = await this.handle(11, str(file)); const entries = []; let truncated = false;
    try { let pages = 0; while (true) { if (++pages > 100) { truncated = true; break; } let response; try { response = await this.request(12, str(handle)); } catch (e) { if (e.sftpCode === 1) break; throw e; }
      const r = this.expect(response, 104); const n = r.u32(); if (n > 10000) fail('PROTOCOL', 'SFTP listing exceeds bounds.');
      for (let i = 0; i < n; i++) { const name = r.text(); r.string(); const attrs = r.attrs(); if (name === '.' || name === '..' || name.toLowerCase() === '.git') continue;
        if (name.length > 4096 || name.includes('/') || name.includes('\\') || /[\0\r\n]/.test(name)) continue;
        if (entries.length < LIMITS.entries) entries.push({ name, ...attrs }); else truncated = true; }
      if (truncated) break;
    } } finally { await this.release(handle); } return { entries, truncated }; }
  async read(file) { const stat = await this.stat(file); if (!stat) return null;
    if ((stat.mode & 0xf000) !== 0x8000 || !Number.isSafeInteger(stat.size) || stat.size > LIMITS.bytes) fail('FILE', 'Only regular files up to 256 KiB can be edited.');
    const handle = await this.handle(3, str(file), uint(1), uint(0)); const chunks = []; let size = 0;
    try { while (true) { let response; try { response = await this.request(5, str(handle), offset(size), uint(32768)); } catch (e) { if (e.sftpCode === 1) break; throw e; }
      const data = this.expect(response, 103).string(); if (!data.length) break; size += data.length; if (size > LIMITS.bytes) fail('FILE', 'File grew beyond the edit limit.'); chunks.push(data);
    } } finally { await this.release(handle); } return Buffer.concat(chunks); }
  async putExclusive(file, bytes, mode = 0o600, created) { const handle = await this.handle(3, str(file), uint(2 | 8 | 32), uint(4), uint(mode & 0o777));
    try { created?.(); for (let at = 0; at < bytes.length; at += 32768) this.expect(await this.request(6, str(handle), offset(at), str(bytes.subarray(at, at + 32768))), 101); }
    finally { await this.release(handle); } }
  async rename(from, to, replace) { if (replace) { if (this.extensions.get('posix-rename@openssh.com') !== '1') fail('RENAME', 'This server lacks atomic replacement support.');
      this.expect(await this.request(200, str('posix-rename@openssh.com'), str(from), str(to)), 101); }
    else this.expect(await this.request(18, str(from), str(to)), 101); }
  async remove(file) { this.expect(await this.request(13, str(file)), 101); }
}

// This fixed program reads the approved command as data. It never interpolates
// host/root/command into SSH's remote shell. POSIX + python3 are required for exec.
const COMMAND_HELPER = String.raw`import os,sys,json,subprocess,tempfile,time,signal
r=json.loads(sys.stdin.buffer.readline(65537))
root=os.path.realpath(r['root'])
if root!=r['root'] or not os.path.isdir(root): raise RuntimeError('Remote root changed')
with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
 p=subprocess.Popen(r['command'],shell=True,cwd=root,stdin=subprocess.DEVNULL,stdout=out,stderr=err,start_new_session=True)
 start=time.monotonic(); reason=None
 while p.poll() is None:
  if time.monotonic()-start>r['timeoutSeconds']: reason='timeout'
  if os.fstat(out.fileno()).st_size+os.fstat(err.fileno()).st_size>262144: reason='output-limit'
  if reason:
   os.killpg(p.pid,signal.SIGTERM)
   try: p.wait(timeout=2)
   except subprocess.TimeoutExpired: os.killpg(p.pid,signal.SIGKILL); p.wait()
   break
  time.sleep(.05)
 out.seek(0); err.seek(0)
 print(json.dumps({'exitCode':p.returncode,'stdout':out.read(65536).decode('utf-8','replace'),'stderr':err.read(65536).decode('utf-8','replace'),'truncated':os.fstat(out.fileno()).st_size>65536 or os.fstat(err.fileno()).st_size>65536,'stopped':reason}))
`;
const shellQuote = value => "'" + value.replace(/'/g, "'\\''") + "'";
async function runRemoteProgram(host, request, spawnProcess = spawn, program = COMMAND_HELPER, signal) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawnProcess('ssh', [...sshArgs(host, false), `python3 -c ${shellQuote(program)}`], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = Buffer.alloc(0); let err = ''; let overflow = false; let processError = null;
    const cancel = () => { processError = new Error('Local SSH transport cancellation requested; remote outcome is unknown.'); child.kill(); };
    signal?.addEventListener('abort', cancel, { once: true });
    if (signal?.aborted) cancel();
    child.stdout.on('data', b => { if (out.length + b.length > 1024 * 1024) { overflow = true; child.kill(); } else out = Buffer.concat([out, b]); });
    child.stderr.on('data', b => { err = (err + b.toString()).slice(-4096); });
    child.stdin.on('error', error => { processError = error; child.kill(); }); child.on('error', error => { processError = error; });
    child.on('close', code => { signal?.removeEventListener('abort', cancel); if (processError) return reject(processError); if (overflow) return reject(new Error('Remote command response exceeded bounds; outcome unknown.'));
      if (code !== 0) return reject(new Error(err.trim() || 'SSH command disconnected; outcome unknown.'));
      try { resolve(JSON.parse(out.toString())); } catch (error) { reject(error); } });
    child.stdin.end(JSON.stringify(request) + '\n');
  });
}

async function runCommand(host, request, spawnProcess = spawn, signal) { const result = await runRemoteProgram(host, request, spawnProcess, COMMAND_HELPER, signal); if (!Number.isInteger(result.exitCode) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw new Error('Invalid command receipt.'); return result; }

function createRemoteWorkspaceService({ storagePath, spawnProcess = spawn, transportFactory, commandRunner, remoteGitRunner, remoteGitReviewRunner, validateAgentTask, validateAgentIntent, agentInstanceId = randomUUID(), sshConfigContext } = {}) {
  if (typeof storagePath !== 'string' || !path.isAbsolute(storagePath)) throw new Error('A private absolute remote-workspace storage path is required.');
  const hosts = new Map(); const sessions = new Map(); const approvals = new Map(); const busy = new Set();
  const active = new Map(); const owners = new Map(); const transports = new Set(); const hostTransports = new Map();
  const controls = new Map(); const connectionStates = new Map(); let closing = false;
  if (typeof agentInstanceId !== 'string' || !/^[a-f0-9-]{36}$/.test(agentInstanceId)) throw new Error('Invalid remote Agent main instance.');
  const mainInstanceId = agentInstanceId, agentBindings = new Map(), agentActive = new Map(), agentRevocations = new Map(), agentInvalidations = new Map();
  let receipts = []; let drafts = []; let worktrees = []; let toolIntents = []; let gitReviewActions = []; let key;
  const keyPath = storagePath + '.key';
  function safeRead(file, max) { const s = fs.lstatSync(file); if (!s.isFile() || s.isSymbolicLink() || s.size > max || (process.platform !== 'win32' && ((s.mode & 0o077) !== 0 || (process.getuid && s.uid !== process.getuid())))) fail('STORE', 'Remote workspace storage must be private and regular.'); return fs.readFileSync(file); }
  if (fs.existsSync(keyPath)) key = safeRead(keyPath, 64); else { key = randomBytes(32); writePrivateFileAtomic(keyPath, key, { durable: true }); }
  if (key.length !== 32) fail('STORE', 'Invalid remote receipt signing key.');
  const sign = value => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
  function persist(override = {}) { if (fs.existsSync(storagePath)) safeRead(storagePath, 24 * 1024 * 1024);
    // v2 prevents an older writer from silently dropping retained Git authority.
    const state = { version: 2, hosts: [...hosts.values()], drafts, receipts, worktrees, toolIntents, gitReviewActions, ...override };
    const encoded = JSON.stringify(state);
    // Reserve bounded terminal-result space before accepting a command. Other hosts/drafts
    // cannot consume the capacity required to durably settle an already started operation.
    const reserved = state.toolIntents.filter(item => item.state === 'started').reduce((bytes, item) => bytes + Math.max(0, AGENT_LIMITS.resultBytes - Buffer.byteLength(JSON.stringify(item.outcome))) + 1024, 0)
      + state.gitReviewActions.filter(item => item.state === 'prepared' || item.state === 'unknown').reduce(bytes => bytes + 256 * 1024, 0);
    if (Buffer.byteLength(encoded) + reserved > 24 * 1024 * 1024) fail('STORE', 'Retained remote transaction storage limit reached.');
    return writePrivateFileAtomic(storagePath, encoded, { durable: true }); }
  function checkedGitRecords(rows, signedRows = false, availableReceipts = receipts) {
    if (!Array.isArray(rows) || rows.length > REMOTE_GIT_REVIEW_LIMITS.actions) fail('STORE', 'Invalid retained remote Git action count.');
    const keys = new Set(), uuid = value => typeof value === 'string' && /^[a-f0-9-]{36}$/.test(value), sha = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const clean = rows.map(row => {
      if (!record(row) || row.version !== 1 || !uuid(row.actionId) || keys.has(row.actionId) || !hosts.has(row.hostId)
        || !record(row.target) || row.target.hostId !== row.hostId || !uuid(row.target.connectionId) || !sha(row.target.fingerprint)
        || typeof row.target.root !== 'string' || !row.target.root.startsWith('/') || /[\0\r\n]/.test(row.target.root)
        || typeof row.target.hostname !== 'string' || typeof row.target.username !== 'string' || !Number.isInteger(row.target.port) || row.target.port < 1 || row.target.port > 65535
        || typeof row.repoKey !== 'string' || !row.repoKey || row.repoKey.length > 8192
        || !['stage', 'unstage', 'commit'].includes(row.operation) || !sha(row.requestDigest) || !sha(row.reviewDigest) || !sha(row.prepareDigest)
        || !['reviewed', 'prepared', 'completed', 'failed', 'unknown'].includes(row.state) || typeof row.ownerHeld !== 'boolean'
        || (['completed', 'failed', 'reviewed'].includes(row.state) && row.ownerHeld)
        || typeof row.createdAt !== 'string' || !Number.isFinite(Date.parse(row.createdAt)) || typeof row.updatedAt !== 'string' || !Number.isFinite(Date.parse(row.updatedAt))
        || !record(row.plan) || (row.receiptId !== undefined && (!uuid(row.receiptId) || !availableReceipts.some(r => r.id === row.receiptId && r.hostId === row.hostId)))) fail('STORE', 'Invalid retained remote Git action.');
      if (signedRows && row.signature !== sign(withoutSignature(row))) fail('STORE', 'Remote Git action signature mismatch.');
      if (row.receiptId) {
        const linked = availableReceipts.find(value => value.id === row.receiptId);
        const expectedState = { prepared: 'started', completed: 'completed', failed: 'failed', unknown: 'unknown' }[row.state];
        if (!linked || linked.kind !== 'git-' + row.operation || linked.actionId !== row.actionId || linked.reviewDigest !== row.reviewDigest
          || !expectedState || linked.state !== expectedState) fail('STORE', 'Remote Git action and transaction receipt disagree.');
      }
      keys.add(row.actionId); return withoutSignature(row);
    });
    if (Buffer.byteLength(JSON.stringify(clean)) > REMOTE_GIT_REVIEW_LIMITS.retainedBytes) fail('STORE', 'Retained remote Git action data exceeds its bound.');
    validateRemoteGitReviewRecords(clean);
    return structuredClone(clean);
  }
  if (fs.existsSync(storagePath)) {
    const saved = JSON.parse(safeRead(storagePath, 24 * 1024 * 1024).toString());
    if (![1, 2].includes(saved.version) || !Array.isArray(saved.hosts) || saved.hosts.length > LIMITS.hosts || !Array.isArray(saved.receipts) || !Array.isArray(saved.drafts)) fail('STORE', 'Invalid remote workspace registry.');
    for (const item of saved.hosts) { const checked = validateHost(item.config); if (!/^[a-f0-9-]{36}$/.test(item.id) || item.fingerprint !== hash(JSON.stringify(checked))) fail('STORE', 'Invalid remote host record.'); if (item.displayLabel !== undefined && (typeof item.displayLabel !== 'string' || !item.displayLabel.trim() || item.displayLabel.length > 100)) fail('STORE', 'Invalid remote host label.'); hosts.set(item.id, { id: item.id, config: checked, fingerprint: item.fingerprint, ...(item.displayLabel === undefined ? {} : { displayLabel: item.displayLabel }) }); }
    receipts = saved.receipts.slice(-LIMITS.receipts); drafts = saved.drafts.slice(-LIMITS.drafts);
    if (saved.worktrees !== undefined && (!Array.isArray(saved.worktrees) || saved.worktrees.length > 24)) fail('STORE', 'Invalid managed remote worktree registry.');
    worktrees = (saved.worktrees ?? []).map(record => { if (!record || !/^[a-f0-9-]{36}$/.test(record.id) || !hosts.has(record.hostId) || typeof record.path !== 'string' || typeof record.sourceRoot !== 'string' || typeof record.branch !== 'string') fail('STORE', 'Invalid managed remote worktree record.'); return ['creating', 'archiving'].includes(record.state) ? { ...record, state: 'needs-inspection' } : record; });
    for (const receipt of receipts) { const { signature, ...payload } = receipt; if (sign(payload) !== signature) fail('STORE', 'Remote transaction receipt signature mismatch.'); }
    if (saved.toolIntents !== undefined && (!Array.isArray(saved.toolIntents) || saved.toolIntents.length > AGENT_LIMITS.intents)) fail('STORE', 'Invalid remote Agent intent registry.');
    const intentKeys = new Set();
    toolIntents = (saved.toolIntents ?? []).map(item => {
      if (!record(item) || typeof item.idempotencyKey !== 'string' || !item.idempotencyKey || item.idempotencyKey.length > 240 || intentKeys.has(item.idempotencyKey)
        || !/^[a-f0-9]{64}$/.test(item.fingerprint) || !['started', 'completed', 'failed', 'unknown'].includes(item.state)
        || !receipts.some(r => r.id === item.receiptId) || sign(withoutSignature(item)) !== item.signature || Buffer.byteLength(JSON.stringify(item.outcome)) > AGENT_LIMITS.resultBytes) fail('STORE', 'Remote Agent intent receipt is invalid.');
      intentKeys.add(item.idempotencyKey);
      return item.state === 'started' ? signed({ ...withoutSignature(item), state: 'unknown', outcome: { ...item.outcome, state: 'outcome_unknown', reason: 'Application restarted without terminal remote proof; no operation was replayed.' } }) : item;
    });
    gitReviewActions = checkedGitRecords(saved.gitReviewActions ?? [], true).map(row => signed(row.state === 'prepared'
      ? { ...row, state: 'unknown', ownerHeld: true, updatedAt: new Date().toISOString(), reason: 'Application restarted without terminal Git proof; inspect this exact action without replay.' }
      : row));
    // A process that disappeared has no terminal remote proof. Do not replay it.
    receipts = receipts.map(r => r.state === 'started' ? signed({ ...withoutSignature(r), state: 'unknown', message: 'Application restarted before terminal proof; inspect remote state before another action.' }) : r);
    persist();
  }
  function withoutSignature(value) { const { signature, ...payload } = value; return payload; }
  function signed(value) { return { ...value, signature: sign(value) }; }
  function appendReceipt(rows, value, gitRows = gitReviewActions) {
    const next = rows.slice();
    if (next.length >= LIMITS.receipts) { const pinned = new Set([...toolIntents, ...gitRows].map(item => item.receiptId)); const removable = next.findIndex(entry => !['started', 'unknown'].includes(entry.state) && !pinned.has(entry.id)); if (removable < 0) fail('RECEIPTS', 'Retained transaction proof limit reached; no new operation was started.'); next.splice(removable, 1); }
    next.push(value); return next;
  }
  function receipt(host, kind, detail, durable = true) { const r = signed({ id: randomUUID(), hostId: host.id, hostFingerprint: host.fingerprint, root: sessions.get(host.id)?.root ?? host.config.root, kind, time: new Date().toISOString(), ...detail }); receipts = appendReceipt(receipts, r); if (durable) persist(); return r; }
  function settle(id, update) { const index = receipts.findIndex(r => r.id === id); const r = signed({ ...withoutSignature(receipts[index]), ...update }); receipts[index] = r; persist(); return r; }
  function hostOf(id) { const host = hosts.get(id); if (!host) fail('HOST', 'Select a saved SSH host.'); return host; }
  function heldGit(id) { return gitReviewActions.some(row => row.hostId === id && (row.ownerHeld || row.state === 'prepared' || row.state === 'unknown')); }
  function connected(id) { const host = hostOf(id); const session = sessions.get(id); if (!session || session.sftp.closed || session.fingerprint !== host.fingerprint) fail('OFFLINE', 'Connect this SSH host first.'); if (session.effectiveHost?.config.sshConfigSnapshot) assertSshConfigSnapshot(session.effectiveHost.config.sshConfigSnapshot); return { host: session.effectiveHost ?? host, ...session }; }
  async function exclusive(id, action, kind = 'read') { hostOf(id); if (closing) fail('CLOSING', 'Remote workspace is closing.'); if (busy.has(id)) fail('BUSY', 'This host has an operation in progress.');
    const control = new AbortController(); controls.set(id, control); busy.add(id); owners.set(id, kind);
    const pending = Promise.resolve().then(() => { control.signal.throwIfAborted(); return action(); }); active.set(id, pending);
    try { return await pending; } finally { if (kind === 'connect' && connectionStates.get(id) === 'connecting') connectionStates.set(id, 'disconnected'); active.delete(id); owners.delete(id); controls.delete(id); busy.delete(id); } }
  function clearHostAuthority(id) { retireHostBindings(id); for (const [token, approval] of approvals) if (approval.hostId === id) approvals.delete(token); }
  function observeTransport(id, sftp) {
    transports.add(sftp); hostTransports.set(id, sftp);
    if (sftp.exited) void Promise.resolve(sftp.exited).then(() => {
      transports.delete(sftp);
      if (hostTransports.get(id) !== sftp) return;
      if (sessions.get(id)?.sftp === sftp) { clearHostAuthority(id); connectionStates.set(id, 'disconnected'); }
    }, () => { /* An injected transport must still expose its closed state. */ });
  }
  async function bounded(session, file, empty = false, missing = false) {
    relative(file, empty); const joined = path.posix.join(session.root, file); const parent = empty && !file ? joined : path.posix.dirname(joined);
    if (await session.sftp.realpath(parent) !== parent) fail('BOUNDARY', 'Remote parent is a symbolic link or changed location.');
    const stat = await session.sftp.stat(joined); if (!stat) { if (missing) return joined; fail('MISSING', 'Remote path does not exist.'); }
    if (await session.sftp.realpath(joined) !== joined || (stat.mode & 0xf000) === 0xa000) fail('BOUNDARY', 'Symbolic links are outside the remote editor boundary.'); return joined;
  }
  function publicHost(host) { const session = sessions.get(host.id), effective = session?.effectiveHost;
    return { id: host.id, ...host.config, label: host.displayLabel ?? host.config.label, ...(effective ? { hostname: effective.config.hostname, username: effective.config.username, port: effective.config.port } : {}),
      ...(host.config.connectionMode === 'ssh-config-alias' ? { sshAlias: host.config.hostname, aliasResolved: Boolean(effective),
        configuredEndpoint: { hostname: host.config.hostname, username: host.config.username, port: host.config.port, connectionMode: 'ssh-config-alias' } } : {}), fingerprint: effective?.fingerprint ?? host.fingerprint,
      connected: Boolean(session && !session.sftp.closed), canonicalRoot: session?.root ?? null, busy: busy.has(host.id),
      connectionState: session && !session.sftp.closed ? 'connected' : connectionStates.get(host.id) === 'connecting' ? 'connecting' : 'disconnected',
      reconnectRequired: Boolean(session?.sftp.closed || connectionStates.get(host.id) === 'disconnected'),
      activeOperation: owners.get(host.id) ?? null, cancellationRequested: controls.get(host.id)?.signal.aborted ?? false,
      unknownReceiptIds: receipts.filter(row => row.hostId === host.id && row.state === 'unknown').map(row => row.id) }; }
  async function listRemote(s, directory = '') {
    const target = await bounded(s, directory, true); const listing = await s.sftp.list(target);
    return { path: directory, truncated: listing.truncated, entries: listing.entries.map(e => ({ name: e.name, path: directory ? directory + '/' + e.name : e.name,
      kind: (e.mode & 0xf000) === 0x4000 ? 'directory' : (e.mode & 0xf000) === 0x8000 ? 'file' : 'blocked', size: e.size ?? null })) };
  }
  async function readRemote(s, file) {
    const target = await bounded(s, file, false, true); const bytes = await s.sftp.read(target);
    if (bytes === null) return { path: file, state: 'missing', revision: null, text: '', size: 0 };
    let text = null; try { if (!bytes.includes(0)) text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {}
    return { path: file, state: text === null ? 'binary' : 'text', revision: hash(bytes), text, size: bytes.length };
  }
  const bindingKey = scope => JSON.stringify([scope.taskId, scope.generation]);
  function retireHostBindings(hostId) { for (const [key, binding] of agentBindings) if (binding.hostId === hostId) agentBindings.delete(key); }
  function bindingCurrent(binding) {
    const session = sessions.get(binding.hostId), host = hosts.get(binding.hostId);
    let unchanged = true; try { if (session?.effectiveHost?.config.sshConfigSnapshot) assertSshConfigSnapshot(session.effectiveHost.config.sshConfigSnapshot); } catch { unchanged = false; }
    return unchanged && !closing && !!host && !!session && !session.sftp.closed && binding.mainInstanceId === mainInstanceId && binding.fingerprint === (session.effectiveHost ?? host).fingerprint
      && binding.connectionId === session.connectionId && binding.root === session.root;
  }
  function agentStatus(scope) {
    if (scope !== undefined) agentScope(scope);
    return { mainInstanceId, hosts: [...hosts.values()].map(host => { const h = publicHost(host); return { id: h.id, label: h.label, hostname: h.hostname, username: h.username || '(SSH config)', port: h.port ?? 22, root: h.root, fingerprint: h.fingerprint, connected: h.connected, canonicalRoot: h.canonicalRoot, busy: h.busy }; }),
      bindings: [...agentBindings.values()].filter(b => bindingCurrent(b) && (!scope || b.taskId === scope.taskId && b.generation === scope.generation)).map(b => structuredClone(b)),
      activeCount: agentActive.size };
  }
  async function attachAgent(input) {
    if (!record(input) || Object.keys(input).sort().join(',') !== 'explicitUserAction,hostId,scope' || input.explicitUserAction !== true || typeof validateAgentTask !== 'function' || typeof validateAgentIntent !== 'function') fail('AGENT', 'Explicit current remote Agent attachment is required.');
    const captured = structuredClone(input); agentScope(captured.scope, true);
    if (Object.keys(captured.scope).sort().join(',') !== 'familyId,generation,revision,taskId') fail('AGENT', 'Invalid exact remote Agent task scope.');
    const key = bindingKey(captured.scope), revocation = agentRevocations.get(key) ?? 0;
    const initial = connected(captured.hostId);
    const connection = { connectionId: initial.connectionId, root: initial.root, fingerprint: initial.host.fingerprint };
    const sameConnection = () => {
      const current = connected(captured.hostId);
      if (current.connectionId !== connection.connectionId || current.root !== connection.root || current.host.fingerprint !== connection.fingerprint) fail('AGENT', 'Remote connection changed before Agent attachment; select the current connection again.');
      return current;
    };
    if (busy.has(captured.hostId)) fail('BUSY', 'Wait for the current remote owner before attaching this task.');
    sameTask(await validateAgentTask(captured.scope), captured.scope, true);
    return exclusive(captured.hostId, async () => {
      sameConnection();
      sameTask(await validateAgentTask(captured.scope), captured.scope, true);
      const s = sameConnection(), scope = captured.scope;
      if ((agentRevocations.get(key) ?? 0) !== revocation || scope.generation < (agentInvalidations.get(JSON.stringify([scope.taskId, scope.familyId])) ?? 0)) fail('AGENT', 'Remote Agent attachment was revoked or its generation changed.');
      if (!agentBindings.has(key) && agentBindings.size >= AGENT_LIMITS.bindings) fail('AGENT', 'Remote Agent attachment limit reached.');
      for (const [previous, binding] of agentBindings) if (binding.taskId === scope.taskId) agentBindings.delete(previous);
      agentBindings.set(key, { mainInstanceId, attachmentId: randomUUID(), taskId: scope.taskId, familyId: scope.familyId, generation: scope.generation,
        hostId: s.host.id, fingerprint: s.host.fingerprint, root: s.root, connectionId: s.connectionId,
        hostname: s.host.config.hostname, username: s.host.config.username, port: s.host.config.port, label: s.host.config.label });
      return agentStatus(scope);
    }, 'agent-attach');
  }
  function revokeAgent(scope) {
    agentScope(scope); const key = bindingKey(scope);
    agentRevocations.set(key, (agentRevocations.get(key) ?? 0) + 1); agentBindings.delete(key);
    // Revocation retires future authority; accepted commands retain their owner and receipt.
    return agentStatus(scope);
  }
  function invalidateAgentTask(scope) {
    if (!record(scope) || Object.keys(scope).sort().join(',') !== 'beforeGeneration,familyId,taskId' || typeof scope.taskId !== 'string' || !scope.taskId || scope.taskId.length > 200
      || typeof scope.familyId !== 'string' || !scope.familyId || scope.familyId.length > 200 || !Number.isSafeInteger(scope.beforeGeneration) || scope.beforeGeneration < 1) fail('AGENT', 'Invalid committed remote Agent generation invalidation.');
    const key = JSON.stringify([scope.taskId, scope.familyId]);
    agentInvalidations.set(key, Math.max(agentInvalidations.get(key) ?? 0, scope.beforeGeneration));
    for (const [key, binding] of agentBindings) if (binding.taskId === scope.taskId && binding.familyId === scope.familyId && binding.generation < scope.beforeGeneration) agentBindings.delete(key);
    return agentStatus();
  }
  function boundAgent(request) {
    const binding = agentBindings.get(bindingKey(request.scope));
    if (!binding || !bindingCurrent(binding) || canonical(binding) !== canonical(request.arguments.binding)) fail('AGENT', 'Attach this exact connected host and root to the current Agent task generation.');
    return binding;
  }
  function sameTask(actual, expected, revision = false) {
    agentScope(actual, true);
    if (actual.taskId !== expected.taskId || actual.familyId !== expected.familyId || actual.generation !== expected.generation || revision && actual.revision !== expected.revision) fail('AGENT', 'Current remote Agent task scope changed.');
  }
  async function checkAgentIntent(request) {
    if (closing || typeof validateAgentIntent !== 'function') fail('AGENT', 'Current owned remote Agent intent validation is unavailable.');
    const binding = boundAgent(request);
    const actual = await validateAgentIntent(structuredClone(request));
    sameTask(actual, binding); boundAgent(request);
  }
  function existingAgent(checked) {
    const intent = toolIntents.find(item => item.idempotencyKey === checked.request.idempotencyKey);
    if (intent && intent.fingerprint !== checked.fingerprint) fail('AGENT', 'Remote Agent idempotency identity conflict.');
    return intent;
  }
  function fitAgentOutcome(outcome) {
    const data = outcome.result.structuredContent;
    // Bound the encoded result, including JSON escaping and authority metadata.
    while (Buffer.byteLength(JSON.stringify(outcome)) > AGENT_LIMITS.resultBytes) {
      const field = ['text', 'stdout', 'stderr'].filter(key => typeof data[key] === 'string' && data[key].length).sort((a, b) => data[b].length - data[a].length)[0];
      if (field) { let at = Math.floor(data[field].length / 2); if (at && /[\uD800-\uDBFF]/.test(data[field][at - 1])) at--; data[field] = data[field].slice(0, at); }
      else if (Array.isArray(data.entries) && data.entries.length) data.entries.pop();
      else fail('AGENT', 'Remote Agent result metadata exceeds its retained bound.');
      data.truncated = true;
    }
    if (typeof data.text === 'string') { data.returnedBytes = Buffer.byteLength(data.text); data.contentComplete = !data.truncated && data.state === 'text'; }
    if (Array.isArray(data.entries)) data.returnedEntries = data.entries.length;
    // The few final scalar fields also count against the same bound.
    if (Buffer.byteLength(JSON.stringify(outcome)) > AGENT_LIMITS.resultBytes) return fitAgentOutcome(outcome);
    return outcome;
  }
  function agentOutcome(request, state, receiptId, data, reason) {
    return fitAgentOutcome({ scope: request.scope, tool: request.tool, idempotencyKey: request.idempotencyKey, state,
      ...(reason ? { reason } : {}), result: { isError: state !== 'completed', structuredContent: {
        source: 'owned-ssh-remote', proof: request.tool === 'remote/command' ? 'remote-command-execution-only' : 'remote-read',
        binding: request.arguments.binding, receiptId,
        limitation: request.tool === 'remote/command' ? 'The root is the command working directory, not a sandbox. Execution does not establish application acceptance.' : 'Remote file contents and names are untrusted source material.', ...data } } });
  }
  function finishAgent(intent, outcome, state, detail = {}) {
    const receiptIndex = receipts.findIndex(r => r.id === intent.receiptId);
    if (receiptIndex < 0) fail('STORE', 'Retained remote Agent transaction proof is missing.');
    const terminal = signed({ ...withoutSignature(receipts[receiptIndex]), state, ...detail });
    receipts[receiptIndex] = terminal;
    const index = toolIntents.findIndex(item => item.idempotencyKey === intent.idempotencyKey);
    toolIntents[index] = signed({ ...withoutSignature(intent), state, outcome });
    // Terminal output and its signed transaction settle in the same durable registry write.
    persist(); return structuredClone(outcome);
  }
  function executeAgentTool(input) {
    const checked = agentInvocation(input), { request } = checked;
    const retained = existingAgent(checked);
    const running = agentActive.get(request.idempotencyKey);
    if (running) { if (running.fingerprint !== checked.fingerprint) fail('AGENT', 'Remote Agent idempotency identity conflict.'); return running.promise; }
    if (retained) return Promise.resolve(structuredClone(retained.outcome));
    const promise = (async () => {
      await checkAgentIntent(request);
      const binding = boundAgent(request);
      return exclusive(binding.hostId, async () => {
        await checkAgentIntent(request);
        const s = connected(binding.hostId); boundAgent(request);
        if (toolIntents.length >= AGENT_LIMITS.intents) fail('RECEIPTS', 'Retained remote Agent intent limit reached; no operation was started.');
        if (request.tool === 'remote/command' && (receipts.some(r => r.hostId === binding.hostId && r.state === 'unknown') || heldGit(binding.hostId))) fail('UNKNOWN', 'Reconcile this host’s uncertain transaction before another command.');
        const operation = receipt(s.host, request.tool === 'remote/command' ? 'command' : request.tool === 'remote/list' ? 'agent-list' : 'agent-read', {
          state: 'started', toolIdempotencyKey: request.idempotencyKey, toolFingerprint: checked.fingerprint,
          ...(request.tool === 'remote/command' ? { command: request.arguments.command, timeoutSeconds: request.arguments.timeoutSeconds } : { path: request.arguments.path ?? '' }) }, false);
        const initial = agentOutcome(request, 'outcome_unknown', operation.id, {}, 'Remote operation admitted without terminal proof; never replay it.');
        const intent = signed({ idempotencyKey: request.idempotencyKey, fingerprint: checked.fingerprint, receiptId: operation.id, state: 'started', outcome: initial });
        toolIntents.push(intent); persist();
        let dispatched = false;
        try {
          let data;
          if (request.tool === 'remote/list') data = await listRemote(s, request.arguments.path ?? '');
          else if (request.tool === 'remote/read') data = { ...await readRemote(s, request.arguments.path), truncated: false };
          else {
            await bounded(s, '', true); await checkAgentIntent(request); boundAgent(request);
            controls.get(binding.hostId)?.signal.throwIfAborted(); dispatched = true;
            data = await (commandRunner ?? ((h, r) => runCommand(h, r, spawnProcess, controls.get(s.host.id)?.signal)))(s.host.config, { root: s.root, command: request.arguments.command, timeoutSeconds: request.arguments.timeoutSeconds }, { signal: controls.get(s.host.id)?.signal });
            if (!record(data) || !Number.isInteger(data.exitCode) || typeof data.stdout !== 'string' || typeof data.stderr !== 'string') fail('COMMAND', 'Invalid remote command terminal receipt.');
            data = { exitCode: data.exitCode, stdout: data.stdout, stderr: data.stderr, capturedStdoutBytes: Buffer.byteLength(data.stdout), capturedStderrBytes: Buffer.byteLength(data.stderr), truncated: data.truncated === true, stopped: typeof data.stopped === 'string' ? data.stopped.slice(0, 100) : null };
          }
          return finishAgent(intent, agentOutcome(request, 'completed', operation.id, data), 'completed', request.tool === 'remote/command' ? { exitCode: data.exitCode, stopped: data.stopped } : {});
        } catch (error) {
          const state = dispatched ? 'outcome_unknown' : 'failed';
          // Do not copy arbitrary transport/remote diagnostics into retained model output.
          const reason = dispatched ? 'Remote command has no exact terminal proof; inspect retained state without replay.' : 'Remote read or pre-dispatch validation failed; no command was sent.';
          return finishAgent(intent, agentOutcome(request, state, operation.id, {}, reason), dispatched ? 'unknown' : 'failed', { message: reason });
        }
      }, request.tool === 'remote/command' ? 'command' : 'agent-read');
    })();
    agentActive.set(request.idempotencyKey, { fingerprint: checked.fingerprint, promise });
    void promise.then(() => agentActive.delete(request.idempotencyKey), () => agentActive.delete(request.idempotencyKey));
    return promise;
  }
  function validateDraft(input) { if (!input || typeof input.text !== 'string' || Buffer.byteLength(input.text) > LIMITS.bytes || (input.expectedRevision !== null && !/^[a-f0-9]{64}$/.test(input.expectedRevision))) fail('DRAFT', 'Invalid remote text draft.'); return { path: relative(input.path), text: input.text, expectedRevision: input.expectedRevision }; }
  function retain(id, input) { const host = hostOf(id); const candidate = validateDraft(input); const old = drafts.find(d => d.hostId === id && d.path === candidate.path);
    if (!old && drafts.length >= LIMITS.drafts) fail('DRAFT', 'Recovery draft limit reached.'); const draft = { id: old?.id ?? randomUUID(), hostId: id, fingerprint: host.fingerprint, ...candidate, time: new Date().toISOString() }; drafts = drafts.filter(d => d.id !== draft.id); drafts.push(draft); persist(); return draft; }
  const withRemoteGitHost = (program, runner) => (id, action, kind, mutation = false) => exclusive(id, async () => {
      const session = connected(id); await bounded(session, '', true);
      if (mutation && (receipts.some(r => r.hostId === id && r.state === 'unknown') || heldGit(id))) fail('UNKNOWN', 'Inspect and reconcile uncertain remote transactions before another mutation.');
      const host = session.host; const scope = { hostId: id, fingerprint: host.fingerprint, connectionId: session.connectionId, root: session.root, hostname: host.config.hostname, username: host.config.username, port: host.config.port };
      const run = (action, payload) => { const signal = controls.get(id)?.signal; signal?.throwIfAborted(); return runner ? runner(host.config, { root: session.root, scope, action, payload }, { signal }) : runRemoteProgram(host.config, { root: session.root, scope, action, payload }, spawnProcess, program, signal); };
      return action(scope, run);
    }, kind);
  const remoteWorktrees = createRemoteWorktreeController({
    withHost: withRemoteGitHost(REMOTE_GIT_HELPER, remoteGitRunner),
    getHostScope: id => ({ hostId: hostOf(id).id }),
    getRecords: () => worktrees, storeRecords: rows => { persist({ worktrees: rows }); worktrees = rows; },
    begin: (id, kind, detail) => receipt(connected(id).host, kind, detail), finish: settle,
  });
  const cleanGitRows = () => structuredClone(gitReviewActions.map(withoutSignature));
  function signedGitRows(rows, receiptRows = receipts) { return checkedGitRecords(rows, false, receiptRows).map(signed); }
  function replaceGitRow(next) {
    const previous = gitReviewActions.find(row => row.actionId === next.actionId);
    if (!previous || previous.hostId !== next.hostId || previous.requestDigest !== next.requestDigest || previous.reviewDigest !== next.reviewDigest) fail('STORE', 'Remote Git action identity changed during settlement.');
    return cleanGitRows().map(row => row.actionId === next.actionId ? next : row);
  }
  const remoteGitReview = createRemoteGitReviewController({
    withHost: withRemoteGitHost(REMOTE_GIT_REVIEW_HELPER, remoteGitReviewRunner),
    getRecords: cleanGitRows,
    storeRecords(rows) {
      const next = signedGitRows(rows); persist({ gitReviewActions: next }); gitReviewActions = next;
    },
    begin: (id, kind, detail) => receipt(connected(id).host, kind, detail), finish: settle,
    storePrepared(value) {
      const previous = gitReviewActions.find(row => row.actionId === value.actionId);
      if (!previous || previous.state !== 'reviewed' || previous.ownerHeld || value.state !== 'prepared' || !value.ownerHeld || value.receiptId) fail('STORE', 'Review this exact Git action before admission.');
      const host = connected(value.hostId).host;
      const operation = signed({ id: randomUUID(), hostId: value.hostId, hostFingerprint: host.fingerprint, root: value.target.root,
        kind: 'git-' + value.operation, time: new Date().toISOString(), state: 'started', actionId: value.actionId, reviewDigest: value.reviewDigest });
      const nextRecord = { ...value, receiptId: operation.id };
      const receiptRows = appendReceipt(receipts, operation, [...gitReviewActions, nextRecord]);
      const actionRows = signedGitRows(replaceGitRow(nextRecord), receiptRows);
      persist({ gitReviewActions: actionRows, receipts: receiptRows });
      gitReviewActions = actionRows; receipts = receiptRows;
      return structuredClone(nextRecord);
    },
    storeTerminal(value, detail) {
      const nextRows = replaceGitRow(value);
      if (!value.receiptId) {
        const previous = gitReviewActions.find(row => row.actionId === value.actionId);
        if (previous.state !== 'reviewed' || value.state !== 'failed' || value.ownerHeld) fail('STORE', 'Git settlement has no original admitted receipt.');
        const actionRows = signedGitRows(nextRows); persist({ gitReviewActions: actionRows }); gitReviewActions = actionRows; return;
      }
      const previous = receipts.find(row => row.id === value.receiptId && row.hostId === value.hostId);
      if (!previous || previous.actionId !== value.actionId || previous.kind !== 'git-' + value.operation || !record(detail) || Buffer.byteLength(JSON.stringify(detail)) > 65536) fail('STORE', 'Git terminal receipt identity changed.');
      const terminal = signed({ ...withoutSignature(previous), ...detail, id: previous.id, hostId: previous.hostId, hostFingerprint: previous.hostFingerprint,
        root: previous.root, kind: previous.kind, time: previous.time, actionId: value.actionId, reviewDigest: value.reviewDigest });
      const receiptRows = receipts.map(row => row.id === previous.id ? terminal : row), actionRows = signedGitRows(nextRows, receiptRows);
      persist({ gitReviewActions: actionRows, receipts: receiptRows }); gitReviewActions = actionRows; receipts = receiptRows;
    },
  });
  return {
    agentStatus, attachAgent, revokeAgent, invalidateAgentTask, executeAgentTool,
    agentReceipt(input) { const retained = existingAgent(agentInvocation(input)); return retained ? structuredClone(retained.outcome) : null; },
    worktreeInspect: remoteWorktrees.inspect, worktreePrepare: remoteWorktrees.prepare, worktreeCreate: remoteWorktrees.create, worktreeList: remoteWorktrees.list,
    worktreeInspectOwned: remoteWorktrees.inspectOwned, worktreePrepareArchive: remoteWorktrees.prepareArchive, worktreeArchive: remoteWorktrees.archive,
    gitBases: remoteGitReview.bases, gitCapture: remoteGitReview.capture, gitDiff: remoteGitReview.diff, gitPrepare: remoteGitReview.prepare,
    gitApply: remoteGitReview.apply, gitInspectAction: remoteGitReview.inspectAction,
    gitListActions(id) { hostOf(id); return remoteGitReview.listActions(id); },
    gitPruneActions(id, actionIds) { hostOf(id); return remoteGitReview.pruneActions(id, actionIds); },
    listHosts: () => [...hosts.values()].map(publicHost),
    addHost(input) {
      const { id, ...settings } = input ?? {};
      const config = validateHost(settings);
      if (id !== undefined) {
        const host = hostOf(id);
        if (busy.has(id)) fail('BUSY', 'Wait for the remote operation to settle.');
        // A label is display metadata: preserve the authority fingerprint and every recovery record.
        const authority = value => JSON.stringify([value.hostname, value.username, value.port, value.root, value.connectionMode ?? 'direct']);
        if (authority(config) === authority(host.config)) {
          host.displayLabel = config.label; persist(); return publicHost(host);
        }
        if (receipts.some(row => row.hostId === id && ['started', 'unknown'].includes(row.state))) fail('UNKNOWN', 'Reconcile this host’s uncertain transaction before changing its destination.');
        if (drafts.some(row => row.hostId === id)) fail('DRAFT', 'Recover or discard retained drafts before changing this destination.');
        if (worktrees.some(row => row.hostId === id) || gitReviewActions.some(row => row.hostId === id)) fail('RECOVERY', 'This destination retains managed worktree or Git recovery records; add a separate host instead.');
        clearHostAuthority(id); sessions.get(id)?.sftp.close(); sessions.delete(id);
        hostTransports.get(id)?.close(); connectionStates.set(id, 'disconnected');
        host.config = config; delete host.displayLabel; host.fingerprint = hash(JSON.stringify(config));
        persist(); return publicHost(host);
      }
      if (hosts.size >= LIMITS.hosts) fail('HOST', 'Remote host limit reached.');
      const host = { id: randomUUID(), config, fingerprint: hash(JSON.stringify(config)) };
      hosts.set(host.id, host); persist(); return publicHost(host);
    },
    forgetHost(id) { hostOf(id); if (busy.has(id)) fail('BUSY', 'Wait for the remote operation to settle.'); if (receipts.some(row => row.hostId === id && ['started', 'unknown'].includes(row.state))) fail('UNKNOWN', 'Retain this host until its exact uncertain transaction is reconciled.'); if (worktrees.some(w => w.hostId === id)) fail('WORKTREE', 'This host retains managed worktree ownership records.'); if (gitReviewActions.some(r => r.hostId === id)) fail('GIT', 'This host retains Git action and recovery records.'); if (drafts.some(d => d.hostId === id)) fail('DRAFT', 'Recover or discard this host’s drafts before removing it.'); retireHostBindings(id); sessions.get(id)?.sftp.close(); sessions.delete(id); hosts.delete(id); hostTransports.delete(id); connectionStates.delete(id); for (const [token, a] of approvals) if (a.hostId === id) approvals.delete(token); persist(); return { removed: true }; },
    connect: id => exclusive(id, async () => { const host = hostOf(id); clearHostAuthority(id); const previous = hostTransports.get(id); previous?.close(); sessions.delete(id);
      connectionStates.set(id, 'connecting');
      // Reconnection never overlaps the former local transport owner, even after
      // an explicit disconnect removed its visible session.
      if (previous?.exited) await previous.exited;
      controls.get(id)?.signal.throwIfAborted();
      let effectiveHost;
      if (host.config.connectionMode === 'ssh-config-alias') { const snapshot = resolveSshConfigAlias(host.config, sshConfigContext); assertSshConfigSnapshot(snapshot);
        effectiveHost = { id: host.id, config: { ...host.config, hostname: snapshot.hostname, username: snapshot.username, port: snapshot.port, sshConfigSnapshot: snapshot }, fingerprint: hash(JSON.stringify([host.fingerprint, snapshot.fingerprint])) }; }
      const sftp = transportFactory ? transportFactory((effectiveHost ?? host).config) : new Sftp((effectiveHost ?? host).config, spawnProcess); observeTransport(id, sftp);
      try { await sftp.ready; controls.get(id)?.signal.throwIfAborted(); const root = await sftp.realpath(host.config.root); if (!root.startsWith('/') || /[\0\r\n]/.test(root)) fail('ROOT', 'Invalid canonical remote root.'); const stat = await sftp.stat(root); if (!stat || (stat.mode & 0xf000) !== 0x4000) fail('ROOT', 'Remote root is not a directory.'); if (effectiveHost) assertSshConfigSnapshot(effectiveHost.config.sshConfigSnapshot); controls.get(id)?.signal.throwIfAborted(); if (sftp.closed) fail('OFFLINE', 'SSH/SFTP disconnected during connection.'); connectionStates.set(id, 'connected'); sessions.set(id, { sftp, root, fingerprint: host.fingerprint, connectionId: randomUUID(), ...(effectiveHost ? { effectiveHost } : {}) }); receipt(effectiveHost ?? host, 'connect', { state: 'completed' }); return publicHost(host); }
      catch (error) { connectionStates.set(id, 'disconnected'); sftp.close(); throw error; } }, 'connect'),
    disconnect(id) { hostOf(id); if (busy.has(id)) fail('BUSY', 'This host still owns an active operation.'); clearHostAuthority(id); sessions.get(id)?.sftp.close(); sessions.delete(id); connectionStates.set(id, 'disconnected'); return { disconnected: true }; },
    cancelOperation(id) { hostOf(id); const control = controls.get(id), operation = owners.get(id) ?? null;
      if (!control) return { requested: false, operation: null, remoteOutcome: 'not-cancelled' };
      // This is explicit cancellation of our transport, never evidence that the
      // remote process stopped. Its existing owner must still settle its receipt.
      clearHostAuthority(id); control.abort(); hostTransports.get(id)?.close(); connectionStates.set(id, 'disconnected');
      return { requested: true, operation, remoteOutcome: 'requires-terminal-proof' };
    },
    list: (id, directory = '') => exclusive(id, () => listRemote(connected(id), directory)),
    preview: (id, file) => exclusive(id, () => readRemote(connected(id), file)),
    retainDraft: (id, input) => retain(id, input),
    listDrafts(id) { hostOf(id); return drafts.filter(d => d.hostId === id); },
    discardDraft(id, draftId) { hostOf(id); const draft = drafts.find(d => d.id === draftId && d.hostId === id); if (!draft) fail('DRAFT', 'Draft not found.'); drafts = drafts.filter(d => d !== draft); persist(); return { discarded: true }; },
    save: (id, input) => exclusive(id, async () => { const candidate = validateDraft(input); if (receipts.some(r => r.hostId === id && r.state === 'unknown') || heldGit(id)) fail('UNKNOWN', 'Inspect this host’s exact uncertain transaction before another write.'); const draft = retain(id, candidate); const s = connected(id); const operation = receipt(s.host, 'write', { state: 'started', path: candidate.path, expectedRevision: candidate.expectedRevision, candidateRevision: hash(candidate.text), draftId: draft.id }); let temp = null; let renameSent = false; let tempOwned = false; let tempAttempted = false;
      try { const target = await bounded(s, candidate.path, false, true); const before = await s.sftp.read(target); const revision = before === null ? null : hash(before);
        if (revision !== candidate.expectedRevision) return { state: 'conflict', draftId: draft.id, receipt: settle(operation.id, { state: 'conflict', message: 'Remote file changed; draft retained.' }) };
        if (before !== null) { if (before.includes(0)) fail('FILE', 'Binary files cannot be edited here.'); try { new TextDecoder('utf-8', { fatal: true }).decode(before); } catch { fail('FILE', 'Binary files cannot be edited here.'); } }
        const stat = await s.sftp.stat(target); if (revision !== null && s.sftp.extensions && s.sftp.extensions.get('posix-rename@openssh.com') !== '1') fail('RENAME', 'This server lacks atomic replacement support.'); temp = path.posix.join(path.posix.dirname(target), `.nekodex-${randomUUID()}.tmp`); controls.get(id)?.signal.throwIfAborted(); settle(operation.id, { state: 'started', temporaryPath: temp }); tempAttempted = true; await s.sftp.putExclusive(temp, Buffer.from(candidate.text), stat?.mode ?? 0o600, () => { tempOwned = true; }); tempOwned = true;
        await bounded(s, candidate.path, false, true); const latest = await s.sftp.read(target); if ((latest === null ? null : hash(latest)) !== revision) { await s.sftp.remove(temp); temp = null; return { state: 'conflict', draftId: draft.id, receipt: settle(operation.id, { state: 'conflict', message: 'Remote file changed before rename; draft retained.' }) }; }
        controls.get(id)?.signal.throwIfAborted(); renameSent = true; await s.sftp.rename(temp, target, revision !== null); temp = null; const after = await s.sftp.read(target); const candidateRevision = hash(candidate.text);
        if (after === null || hash(after) !== candidateRevision) return { state: 'unknown', draftId: draft.id, receipt: settle(operation.id, { state: 'unknown', message: 'Replacement acknowledged but file differs; inspect remote state. Draft retained.' }) };
        const terminal = settle(operation.id, { state: 'completed', revision: candidateRevision }); drafts = drafts.filter(d => d.id !== draft.id || d.text !== candidate.text || d.expectedRevision !== candidate.expectedRevision); persist(); return { state: 'saved', revision: candidateRevision, draftRetained: drafts.some(d => d.id === draft.id), receipt: terminal };
      } catch (error) {
        // A failed exclusive OPEN is not ownership of the random path. Never
        // remove an existing file unless this exact transport acknowledged create.
        if (temp && tempOwned && !renameSent && !s.sftp.closed) {
          try { await s.sftp.remove(temp); temp = null; } catch (cleanupError) { if (cleanupError.sftpCode === 2) temp = null; }
        }
        const uncertain = renameSent || Boolean(temp && tempAttempted && (tempOwned || error.sftpCode !== 11));
        return { state: uncertain ? 'unknown' : 'failed', draftId: draft.id, receipt: settle(operation.id, { state: uncertain ? 'unknown' : 'failed', message: error.message, ...(temp ? { temporaryPath: temp } : {}) }) };
      }
    }, 'write'),
    approveCommand(id, input) { const s = connected(id); if (busy.has(id)) fail('BUSY', 'Wait for this host’s current operation.'); if (!input || typeof input.command !== 'string' || !input.command.trim() || Buffer.byteLength(input.command) > 16384 || input.command.includes('\0') || !Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 1 || input.timeoutSeconds > 3600) fail('COMMAND', 'Provide a command and a 1–3600 second execution limit.');
      if (receipts.some(r => r.hostId === id && r.state === 'unknown') || heldGit(id)) fail('UNKNOWN', 'Inspect the exact uncertain operation before reviewing another command.');
      for (const [token, previous] of approvals) if (previous.hostId === id) approvals.delete(token);
      const approval = { token: randomUUID(), hostId: id, connectionId: s.connectionId, fingerprint: s.host.fingerprint, hostname: s.host.config.hostname, username: s.host.config.username, port: s.host.config.port, root: s.root, command: input.command, timeoutSeconds: input.timeoutSeconds };
      approvals.set(approval.token, approval); return approval; },
    executeCommand: (id, token) => exclusive(id, async () => { const s = connected(id); const approval = approvals.get(token); if (!approval || approval.hostId !== id || approval.fingerprint !== s.host.fingerprint || approval.root !== s.root || approval.connectionId !== s.connectionId) fail('APPROVAL', 'Review this exact host, root and command before executing.'); if (receipts.some(r => r.hostId === id && r.state === 'unknown') || heldGit(id)) fail('UNKNOWN', 'Inspect the exact uncertain operation before another command.'); approvals.delete(token);
      await bounded(s, '', true); controls.get(id)?.signal.throwIfAborted(); const operation = receipt(s.host, 'command', { state: 'started', approvalId: approval.token, command: approval.command, timeoutSeconds: approval.timeoutSeconds });
      try { const result = await (commandRunner ?? ((h, r) => runCommand(h, r, spawnProcess, controls.get(s.host.id)?.signal)))(s.host.config, { root: s.root, command: approval.command, timeoutSeconds: approval.timeoutSeconds }, { signal: controls.get(id)?.signal }); if (!record(result) || !Number.isInteger(result.exitCode) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') fail('COMMAND', 'Invalid remote command terminal receipt.'); return { ...result, receipt: settle(operation.id, { state: 'completed', exitCode: result.exitCode, stopped: result.stopped }) }; }
      catch (error) { return { exitCode: null, stdout: '', stderr: '', receipt: settle(operation.id, { state: 'unknown', message: error.message }) }; }
    }, 'command'),
    listReceipts(id) { hostOf(id); return receipts.filter(r => r.hostId === id); },
    reconcile(id, receiptId, note) { hostOf(id); if (busy.has(id)) fail('BUSY', 'The host operation is still active.'); const r = receipts.find(r => r.id === receiptId && r.hostId === id); if (r?.kind?.startsWith('git-')) fail('RECONCILE', 'Inspect the exact Git action; a note cannot settle an index or commit outcome.'); if (!r || r.state !== 'unknown' || typeof note !== 'string' || note.trim().length < 8 || note.length > 2000) fail('RECONCILE', 'Provide the observed remote outcome before acknowledging an uncertain transaction.'); return settle(r.id, { state: 'reconciled', reconciliation: note, reconciledAt: new Date().toISOString() }); },
    currentOperation() { const entry = [...owners].find(([, kind]) => (['connect', 'write', 'command'].includes(kind) || kind.startsWith('worktree-') || kind.startsWith('git-'))); return entry ? `SSH ${entry[1]} · ${hostOf(entry[0]).config.label} (${hostOf(entry[0]).config.hostname})` : remoteGitReview.currentOperation(); },
    async destroy() { closing = true; agentBindings.clear(); const settlements = await Promise.allSettled([...active.values(), ...[...agentActive.values()].map(item => item.promise), remoteGitReview.destroy()]); const failed = settlements.find(row => row.status === 'rejected'); if (failed) throw failed.reason; const owned = [...transports]; for (const sftp of owned) sftp.close(); await Promise.all(owned.map(sftp => sftp.exited ?? Promise.resolve())); sessions.clear(); approvals.clear(); transports.clear(); hostTransports.clear(); connectionStates.clear(); },
    dispose() { if (busy.size || agentActive.size) fail('BUSY', 'Remote operations still own their terminal outcomes.'); for (const session of sessions.values()) session.sftp.close(); sessions.clear(); approvals.clear(); agentBindings.clear(); },
  };
}
module.exports = { createRemoteWorkspaceService, Sftp, sshArgs, validateHost, relative, LIMITS };
