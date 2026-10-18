"use strict";

// OpenSSH owns host-key/authentication checks. This owner speaks SFTP v3 over its
// subsystem pipe; renderer values never become local shell syntax or SSH options.
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHash, createHmac, randomBytes, randomUUID } = require('node:crypto');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { REMOTE_GIT_HELPER, createRemoteWorktreeController } = require('./remote-worktrees.cjs');
const LIMITS = Object.freeze({ bytes: 256 * 1024, entries: 300, hosts: 24, receipts: 100, drafts: 40 });
const hash = value => createHash('sha256').update(value).digest('hex');
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
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
  if (!value || typeof value !== 'object' || Object.keys(value).some(key => !['label', 'hostname', 'username', 'port', 'root'].includes(key))) fail('HOST', 'Invalid SSH host settings.');
  const { hostname, username, root } = value;
  if (typeof hostname !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9.:-]{0,252}$/.test(hostname)
      || typeof username !== 'string' || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(username)
      || typeof root !== 'string' || !root.startsWith('/') || root.length > 4096 || /[\0\r\n]/.test(root)
      || root.split('/').includes('..') || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535
      || typeof value.label !== 'string' || !value.label.trim() || value.label.length > 100) fail('HOST', 'Use a valid host, SSH user, port and absolute POSIX root.');
  return { label: value.label.trim(), hostname, username, port: value.port, root: path.posix.normalize(root) };
}
function relative(value, empty = false) {
  if (typeof value !== 'string' || value.length > 4096 || /[\0\\\r\n]/.test(value)
      || value.startsWith('/') || (!value && !empty) || (value && value.split('/').some(p => !p || p === '.' || p === '..' || p.toLowerCase() === '.git'))) fail('PATH', 'Use a path within the selected remote root.');
  return value;
}
function sshArgs(host, subsystem) {
  return ['-F', process.platform === 'win32' ? 'NUL' : '/dev/null', '-T', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
    '-o', 'ClearAllForwardings=yes', '-o', 'PermitLocalCommand=no', '-o', 'ConnectTimeout=15', '-o', 'ConnectionAttempts=1',
    '-o', 'ServerAliveInterval=15', '-o', 'ServerAliveCountMax=3', '-p', String(host.port), '-l', host.username,
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
      this.pending.set(id, { resolve, reject, timer }); this.send(Buffer.concat([Buffer.from([type]), uint(id), ...parts])); }); }
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
  async putExclusive(file, bytes, mode = 0o600) { const handle = await this.handle(3, str(file), uint(2 | 8 | 32), uint(4), uint(mode & 0o777));
    try { for (let at = 0; at < bytes.length; at += 32768) this.expect(await this.request(6, str(handle), offset(at), str(bytes.subarray(at, at + 32768))), 101); }
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
async function runRemoteProgram(host, request, spawnProcess = spawn, program = COMMAND_HELPER) {
  return new Promise((resolve, reject) => {
    const child = spawnProcess('ssh', [...sshArgs(host, false), `python3 -c ${shellQuote(program)}`], { shell: false, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = Buffer.alloc(0); let err = ''; let overflow = false; let processError = null;
    child.stdout.on('data', b => { if (out.length + b.length > 1024 * 1024) { overflow = true; child.kill(); } else out = Buffer.concat([out, b]); });
    child.stderr.on('data', b => { err = (err + b.toString()).slice(-4096); });
    child.stdin.on('error', error => { processError = error; child.kill(); }); child.on('error', error => { processError = error; });
    child.on('close', code => { if (processError) return reject(processError); if (overflow) return reject(new Error('Remote command response exceeded bounds; outcome unknown.'));
      if (code !== 0) return reject(new Error(err.trim() || 'SSH command disconnected; outcome unknown.'));
      try { resolve(JSON.parse(out.toString())); } catch (error) { reject(error); } });
    child.stdin.end(JSON.stringify(request) + '\n');
  });
}

async function runCommand(host, request, spawnProcess = spawn) { const result = await runRemoteProgram(host, request, spawnProcess); if (!Number.isInteger(result.exitCode) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string') throw new Error('Invalid command receipt.'); return result; }

function createRemoteWorkspaceService({ storagePath, spawnProcess = spawn, transportFactory, commandRunner, remoteGitRunner } = {}) {
  if (typeof storagePath !== 'string' || !path.isAbsolute(storagePath)) throw new Error('A private absolute remote-workspace storage path is required.');
  const hosts = new Map(); const sessions = new Map(); const approvals = new Map(); const busy = new Set();
  const active = new Map(); const owners = new Map(); const transports = new Set(); let closing = false;
  let receipts = []; let drafts = []; let worktrees = []; let key;
  const keyPath = storagePath + '.key';
  function safeRead(file, max) { const s = fs.lstatSync(file); if (!s.isFile() || s.isSymbolicLink() || s.size > max || (process.platform !== 'win32' && ((s.mode & 0o077) !== 0 || (process.getuid && s.uid !== process.getuid())))) fail('STORE', 'Remote workspace storage must be private and regular.'); return fs.readFileSync(file); }
  if (fs.existsSync(keyPath)) key = safeRead(keyPath, 64); else { key = randomBytes(32); writePrivateFileAtomic(keyPath, key, { durable: true }); }
  if (key.length !== 32) fail('STORE', 'Invalid remote receipt signing key.');
  const sign = value => createHmac('sha256', key).update(JSON.stringify(value)).digest('hex');
  function persist() { if (fs.existsSync(storagePath)) safeRead(storagePath, 24 * 1024 * 1024);
    writePrivateFileAtomic(storagePath, JSON.stringify({ version: 1, hosts: [...hosts.values()], drafts, receipts, worktrees }), { durable: true }); }
  if (fs.existsSync(storagePath)) {
    const saved = JSON.parse(safeRead(storagePath, 24 * 1024 * 1024).toString());
    if (saved.version !== 1 || !Array.isArray(saved.hosts) || saved.hosts.length > LIMITS.hosts || !Array.isArray(saved.receipts) || !Array.isArray(saved.drafts)) fail('STORE', 'Invalid remote workspace registry.');
    for (const item of saved.hosts) { const checked = validateHost(item.config); if (!/^[a-f0-9-]{36}$/.test(item.id) || item.fingerprint !== hash(JSON.stringify(checked))) fail('STORE', 'Invalid remote host record.'); hosts.set(item.id, { id: item.id, config: checked, fingerprint: item.fingerprint }); }
    receipts = saved.receipts.slice(-LIMITS.receipts); drafts = saved.drafts.slice(-LIMITS.drafts);
    if (saved.worktrees !== undefined && (!Array.isArray(saved.worktrees) || saved.worktrees.length > 24)) fail('STORE', 'Invalid managed remote worktree registry.');
    worktrees = (saved.worktrees ?? []).map(record => { if (!record || !/^[a-f0-9-]{36}$/.test(record.id) || !hosts.has(record.hostId) || typeof record.path !== 'string' || typeof record.sourceRoot !== 'string' || typeof record.branch !== 'string') fail('STORE', 'Invalid managed remote worktree record.'); return ['creating', 'archiving'].includes(record.state) ? { ...record, state: 'needs-inspection' } : record; });
    for (const receipt of receipts) { const { signature, ...payload } = receipt; if (sign(payload) !== signature) fail('STORE', 'Remote transaction receipt signature mismatch.'); }
    // A process that disappeared has no terminal remote proof. Do not replay it.
    receipts = receipts.map(r => r.state === 'started' ? signed({ ...withoutSignature(r), state: 'unknown', message: 'Application restarted before terminal proof; inspect remote state before another action.' }) : r);
    persist();
  }
  function withoutSignature(value) { const { signature, ...payload } = value; return payload; }
  function signed(value) { return { ...value, signature: sign(value) }; }
  function receipt(host, kind, detail) { const r = signed({ id: randomUUID(), hostId: host.id, hostFingerprint: host.fingerprint, root: sessions.get(host.id)?.root ?? host.config.root, kind, time: new Date().toISOString(), ...detail }); if (receipts.length >= LIMITS.receipts) { const removable = receipts.findIndex(entry => !['started', 'unknown'].includes(entry.state)); if (removable < 0) fail('RECEIPTS', 'Reconcile outstanding transactions before starting more work.'); receipts.splice(removable, 1); } receipts.push(r); persist(); return r; }
  function settle(id, update) { const index = receipts.findIndex(r => r.id === id); const r = signed({ ...withoutSignature(receipts[index]), ...update }); receipts[index] = r; persist(); return r; }
  function hostOf(id) { const host = hosts.get(id); if (!host) fail('HOST', 'Select a saved SSH host.'); return host; }
  function connected(id) { const host = hostOf(id); const session = sessions.get(id); if (!session || session.fingerprint !== host.fingerprint) fail('OFFLINE', 'Connect this SSH host first.'); return { host, ...session }; }
  async function exclusive(id, action, kind = 'read') { hostOf(id); if (closing) fail('CLOSING', 'Remote workspace is closing.'); if (busy.has(id)) fail('BUSY', 'This host has an operation in progress.'); busy.add(id); owners.set(id, kind); const pending = Promise.resolve().then(action); active.set(id, pending); try { return await pending; } finally { active.delete(id); owners.delete(id); busy.delete(id); } }
  async function bounded(session, file, empty = false, missing = false) {
    relative(file, empty); const joined = path.posix.join(session.root, file); const parent = empty && !file ? joined : path.posix.dirname(joined);
    if (await session.sftp.realpath(parent) !== parent) fail('BOUNDARY', 'Remote parent is a symbolic link or changed location.');
    const stat = await session.sftp.stat(joined); if (!stat) { if (missing) return joined; fail('MISSING', 'Remote path does not exist.'); }
    if (await session.sftp.realpath(joined) !== joined || (stat.mode & 0xf000) === 0xa000) fail('BOUNDARY', 'Symbolic links are outside the remote editor boundary.'); return joined;
  }
  function publicHost(host) { const session = sessions.get(host.id); return { id: host.id, ...host.config, fingerprint: host.fingerprint, connected: Boolean(session && !session.sftp.closed), canonicalRoot: session?.root ?? null, busy: busy.has(host.id) }; }
  function validateDraft(input) { if (!input || typeof input.text !== 'string' || Buffer.byteLength(input.text) > LIMITS.bytes || (input.expectedRevision !== null && !/^[a-f0-9]{64}$/.test(input.expectedRevision))) fail('DRAFT', 'Invalid remote text draft.'); return { path: relative(input.path), text: input.text, expectedRevision: input.expectedRevision }; }
  function retain(id, input) { const host = hostOf(id); const candidate = validateDraft(input); const old = drafts.find(d => d.hostId === id && d.path === candidate.path);
    if (!old && drafts.length >= LIMITS.drafts) fail('DRAFT', 'Recovery draft limit reached.'); const draft = { id: old?.id ?? randomUUID(), hostId: id, fingerprint: host.fingerprint, ...candidate, time: new Date().toISOString() }; drafts = drafts.filter(d => d.id !== draft.id); drafts.push(draft); persist(); return draft; }
  const remoteWorktrees = createRemoteWorktreeController({
    withHost: (id, action, kind, mutation = false) => exclusive(id, async () => {
      const session = connected(id); await bounded(session, '', true);
      if (mutation && receipts.some(r => r.hostId === id && r.state === 'unknown')) fail('UNKNOWN', 'Inspect and reconcile uncertain remote transactions before another mutation.');
      const host = session.host; const scope = { hostId: id, fingerprint: host.fingerprint, connectionId: session.connectionId, root: session.root, hostname: host.config.hostname, username: host.config.username, port: host.config.port };
      const run = (action, payload) => remoteGitRunner ? remoteGitRunner(host.config, { root: session.root, scope, action, payload }) : runRemoteProgram(host.config, { root: session.root, scope, action, payload }, spawnProcess, REMOTE_GIT_HELPER);
      return action(scope, run);
    }, kind),
    getRecords: () => worktrees, storeRecords: rows => { worktrees = rows; persist(); },
    begin: (id, kind, detail) => receipt(hostOf(id), kind, detail), finish: settle,
  });
  return {
    worktreeInspect: remoteWorktrees.inspect, worktreePrepare: remoteWorktrees.prepare, worktreeCreate: remoteWorktrees.create, worktreeList: remoteWorktrees.list,
    worktreeInspectOwned: remoteWorktrees.inspectOwned, worktreePrepareArchive: remoteWorktrees.prepareArchive, worktreeArchive: remoteWorktrees.archive,
    listHosts: () => [...hosts.values()].map(publicHost),
    addHost(input) { if (hosts.size >= LIMITS.hosts) fail('HOST', 'Remote host limit reached.'); const config = validateHost(input); const host = { id: randomUUID(), config, fingerprint: hash(JSON.stringify(config)) }; hosts.set(host.id, host); persist(); return publicHost(host); },
    forgetHost(id) { hostOf(id); if (busy.has(id)) fail('BUSY', 'Wait for the remote operation to settle.'); if (worktrees.some(w => w.hostId === id)) fail('WORKTREE', 'This host retains managed worktree ownership records.'); if (drafts.some(d => d.hostId === id)) fail('DRAFT', 'Recover or discard this host’s drafts before removing it.'); sessions.get(id)?.sftp.close(); sessions.delete(id); hosts.delete(id); for (const [token, a] of approvals) if (a.hostId === id) approvals.delete(token); persist(); return { removed: true }; },
    connect: id => exclusive(id, async () => { const host = hostOf(id); for (const [token, approval] of approvals) if (approval.hostId === id) approvals.delete(token); sessions.get(id)?.sftp.close(); sessions.delete(id); const sftp = transportFactory ? transportFactory(host.config) : new Sftp(host.config, spawnProcess); transports.add(sftp); if (sftp.exited) void sftp.exited.then(() => transports.delete(sftp));
      try { await sftp.ready; const root = await sftp.realpath(host.config.root); if (!root.startsWith('/') || /[\0\r\n]/.test(root)) fail('ROOT', 'Invalid canonical remote root.'); const stat = await sftp.stat(root); if (!stat || (stat.mode & 0xf000) !== 0x4000) fail('ROOT', 'Remote root is not a directory.'); sessions.set(id, { sftp, root, fingerprint: host.fingerprint, connectionId: randomUUID() }); receipt(host, 'connect', { state: 'completed' }); return publicHost(host); }
      catch (error) { sftp.close(); throw error; } }, 'connect'),
    disconnect(id) { hostOf(id); if (busy.has(id)) fail('BUSY', 'This host still owns an active operation.'); sessions.get(id)?.sftp.close(); sessions.delete(id); for (const [token, a] of approvals) if (a.hostId === id) approvals.delete(token); return { disconnected: true }; },
    list: (id, directory = '') => exclusive(id, async () => { const s = connected(id); const target = await bounded(s, directory, true); const listing = await s.sftp.list(target); return { path: directory, truncated: listing.truncated, entries: listing.entries.map(e => ({ name: e.name, path: directory ? directory + '/' + e.name : e.name, kind: (e.mode & 0xf000) === 0x4000 ? 'directory' : (e.mode & 0xf000) === 0x8000 ? 'file' : 'blocked', size: e.size ?? null })) }; }),
    preview: (id, file) => exclusive(id, async () => { const s = connected(id); const target = await bounded(s, file, false, true); const bytes = await s.sftp.read(target); if (bytes === null) return { path: file, state: 'missing', revision: null, text: '', size: 0 };
      let text = null; try { if (!bytes.includes(0)) text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch {} return { path: file, state: text === null ? 'binary' : 'text', revision: hash(bytes), text, size: bytes.length }; }),
    retainDraft: (id, input) => retain(id, input),
    listDrafts(id) { hostOf(id); return drafts.filter(d => d.hostId === id); },
    discardDraft(id, draftId) { hostOf(id); const draft = drafts.find(d => d.id === draftId && d.hostId === id); if (!draft) fail('DRAFT', 'Draft not found.'); drafts = drafts.filter(d => d !== draft); persist(); return { discarded: true }; },
    save: (id, input) => exclusive(id, async () => { const candidate = validateDraft(input); if (receipts.some(r => r.hostId === id && r.state === 'unknown')) fail('UNKNOWN', 'Reconcile this host’s uncertain transaction before another write.'); const draft = retain(id, candidate); const s = connected(id); const operation = receipt(s.host, 'write', { state: 'started', path: candidate.path, expectedRevision: candidate.expectedRevision, candidateRevision: hash(candidate.text), draftId: draft.id }); let temp = null; let renameSent = false;
      try { const target = await bounded(s, candidate.path, false, true); const before = await s.sftp.read(target); const revision = before === null ? null : hash(before);
        if (revision !== candidate.expectedRevision) return { state: 'conflict', draftId: draft.id, receipt: settle(operation.id, { state: 'conflict', message: 'Remote file changed; draft retained.' }) };
        if (before !== null) { if (before.includes(0)) fail('FILE', 'Binary files cannot be edited here.'); try { new TextDecoder('utf-8', { fatal: true }).decode(before); } catch { fail('FILE', 'Binary files cannot be edited here.'); } }
        const stat = await s.sftp.stat(target); if (revision !== null && s.sftp.extensions && s.sftp.extensions.get('posix-rename@openssh.com') !== '1') fail('RENAME', 'This server lacks atomic replacement support.'); temp = path.posix.join(path.posix.dirname(target), `.nekodex-${randomUUID()}.tmp`); await s.sftp.putExclusive(temp, Buffer.from(candidate.text), stat?.mode ?? 0o600);
        await bounded(s, candidate.path, false, true); const latest = await s.sftp.read(target); if ((latest === null ? null : hash(latest)) !== revision) { await s.sftp.remove(temp); temp = null; return { state: 'conflict', draftId: draft.id, receipt: settle(operation.id, { state: 'conflict', message: 'Remote file changed before rename; draft retained.' }) }; }
        renameSent = true; await s.sftp.rename(temp, target, revision !== null); temp = null; const after = await s.sftp.read(target); const candidateRevision = hash(candidate.text);
        if (after === null || hash(after) !== candidateRevision) return { state: 'unknown', draftId: draft.id, receipt: settle(operation.id, { state: 'unknown', message: 'Replacement acknowledged but file differs; inspect remote state. Draft retained.' }) };
        const terminal = settle(operation.id, { state: 'completed', revision: candidateRevision }); drafts = drafts.filter(d => d.id !== draft.id || d.text !== candidate.text || d.expectedRevision !== candidate.expectedRevision); persist(); return { state: 'saved', revision: candidateRevision, draftRetained: drafts.some(d => d.id === draft.id), receipt: terminal };
      } catch (error) { if (temp && !renameSent && !s.sftp.closed) await s.sftp.remove(temp).catch(() => {}); return { state: renameSent ? 'unknown' : 'failed', draftId: draft.id, receipt: settle(operation.id, { state: renameSent ? 'unknown' : 'failed', message: error.message, ...(temp ? { temporaryPath: temp } : {}) }) }; }
    }, 'write'),
    approveCommand(id, input) { const s = connected(id); if (busy.has(id)) fail('BUSY', 'Wait for this host’s current operation.'); if (!input || typeof input.command !== 'string' || !input.command.trim() || Buffer.byteLength(input.command) > 16384 || input.command.includes('\0') || !Number.isInteger(input.timeoutSeconds) || input.timeoutSeconds < 1 || input.timeoutSeconds > 3600) fail('COMMAND', 'Provide a command and a 1–3600 second execution limit.');
      if (receipts.some(r => r.hostId === id && r.state === 'unknown')) fail('UNKNOWN', 'A previous command has an unknown outcome. Reconcile it in transaction history first.');
      for (const [token, previous] of approvals) if (previous.hostId === id) approvals.delete(token);
      const approval = { token: randomUUID(), hostId: id, connectionId: s.connectionId, fingerprint: s.host.fingerprint, hostname: s.host.config.hostname, username: s.host.config.username, port: s.host.config.port, root: s.root, command: input.command, timeoutSeconds: input.timeoutSeconds };
      approvals.set(approval.token, approval); return approval; },
    executeCommand: (id, token) => exclusive(id, async () => { const s = connected(id); const approval = approvals.get(token); if (!approval || approval.hostId !== id || approval.fingerprint !== s.host.fingerprint || approval.root !== s.root || approval.connectionId !== s.connectionId) fail('APPROVAL', 'Review this exact host, root and command before executing.'); if (receipts.some(r => r.hostId === id && r.state === 'unknown')) fail('UNKNOWN', 'Reconcile this host’s uncertain transaction before another command.'); approvals.delete(token);
      await bounded(s, '', true); const operation = receipt(s.host, 'command', { state: 'started', approvalId: approval.token, command: approval.command, timeoutSeconds: approval.timeoutSeconds });
      try { const result = await (commandRunner ?? ((h, r) => runCommand(h, r, spawnProcess)))(s.host.config, { root: s.root, command: approval.command, timeoutSeconds: approval.timeoutSeconds }); return { ...result, receipt: settle(operation.id, { state: 'completed', exitCode: result.exitCode, stopped: result.stopped }) }; }
      catch (error) { return { exitCode: null, stdout: '', stderr: '', receipt: settle(operation.id, { state: 'unknown', message: error.message }) }; }
    }, 'command'),
    listReceipts(id) { hostOf(id); return receipts.filter(r => r.hostId === id); },
    reconcile(id, receiptId, note) { hostOf(id); if (busy.has(id)) fail('BUSY', 'The host operation is still active.'); const r = receipts.find(r => r.id === receiptId && r.hostId === id); if (!r || r.state !== 'unknown' || typeof note !== 'string' || note.trim().length < 8 || note.length > 2000) fail('RECONCILE', 'Provide the observed remote outcome before acknowledging an uncertain transaction.'); return settle(r.id, { state: 'reconciled', reconciliation: note, reconciledAt: new Date().toISOString() }); },
    currentOperation() { const entry = [...owners].find(([, kind]) => (['connect', 'write', 'command'].includes(kind) || kind.startsWith('worktree-'))); return entry ? `SSH ${entry[1]} · ${hostOf(entry[0]).config.label} (${hostOf(entry[0]).config.hostname})` : null; },
    async destroy() { closing = true; await Promise.allSettled([...active.values()]); const owned = [...transports]; for (const sftp of owned) sftp.close(); await Promise.all(owned.map(sftp => sftp.exited ?? Promise.resolve())); sessions.clear(); approvals.clear(); transports.clear(); },
    dispose() { if (busy.size) fail('BUSY', 'Remote operations still own their terminal outcomes.'); for (const session of sessions.values()) session.sftp.close(); sessions.clear(); approvals.clear(); },
  };
}
module.exports = { createRemoteWorkspaceService, Sftp, sshArgs, validateHost, relative, LIMITS };
