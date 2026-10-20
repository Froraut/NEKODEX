import { expect, test } from 'bun:test';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, mkdirSync, realpathSync, writeFileSync, readFileSync, rmSync, statSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { RemoteWorkspaceService } from '../launcher/electron/remote-workspace.cjs';
const require = createRequire(import.meta.url);
const { createRemoteWorkspaceService, Sftp, validateHost, sshArgs } = require('../launcher/electron/remote-workspace.cjs');
const { registerRemoteWorkspaceIpc } = require('../launcher/electron/ipc/remote-workspace.cjs');
const localSftp = ['/usr/libexec/sftp-server', '/usr/lib/openssh/sftp-server', '/usr/lib/ssh/sftp-server'].find(existsSync);
const protocolTest = localSftp ? test : test.skip;

// Exercise the OS's actual SFTP server and the actual fixed remote command
// helper in a disposable folder. No SSH network connection or real host is used.
function fixture(options: Record<string, unknown> = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-remote-')));
  const root = join(parent, 'repo'); mkdirSync(root); writeFileSync(join(root, 'note.txt'), 'original\n', { mode: 0o640 });
  const storagePath = join(parent, 'private', 'registry.json');
  const calls: { binary: string; args: string[] }[] = []; const children: ReturnType<typeof spawn>[] = [];
  const spawnProcess = (binary: string, args: string[], spawnOptions: object) => {
    calls.push({ binary, args }); expect(binary).toBe('ssh'); expect(spawnOptions).toMatchObject({ shell: false });
    // The selected hostname is never used by this local authority fixture.
    const child = args.includes('-s') ? spawn(localSftp!, [], spawnOptions) : spawn('/bin/sh', ['-c', args.at(-1)!], spawnOptions); children.push(child); return child;
  };
  const open = (extra: Record<string, unknown> = {}) => createRemoteWorkspaceService({ storagePath, spawnProcess, ...options, ...extra }) as RemoteWorkspaceService;
  return { parent, root, storagePath, calls, children, open, close: () => rmSync(parent, { recursive: true, force: true }),
    host: { label: 'Disposable local protocol', hostname: 'never-connect.invalid', username: 'fixture', port: 22, root } };
}

protocolTest('real SFTP protocol reads, lists and atomically saves; stale writes retain drafts across restart', async () => {
  const f = fixture(); const service = f.open(); let reopened: RemoteWorkspaceService | undefined;
  try {
    const host = service.addHost(f.host); expect(f.calls).toHaveLength(0);
    await expect(service.preview(host.id, 'note.txt')).rejects.toThrow('Connect');
    const connection = await service.connect(host.id); expect(connection.canonicalRoot).toBe(f.root);
    expect((await service.list(host.id)).entries).toContainEqual({ name: 'note.txt', path: 'note.txt', kind: 'file', size: 9 });
    const original = await service.preview(host.id, 'note.txt'); expect(original.text).toBe('original\n');
    writeFileSync(join(f.root, 'note.txt'), 'external edit\n');
    const conflict = await service.save(host.id, { path: 'note.txt', expectedRevision: original.revision, text: 'retained\n' });
    expect(conflict.state).toBe('conflict'); expect(readFileSync(join(f.root, 'note.txt'), 'utf8')).toBe('external edit\n');
    service.dispose(); reopened = f.open(); const restoredHost = reopened.listHosts()[0];
    expect(restoredHost.connected).toBe(false); expect(reopened.listDrafts(host.id)[0].text).toBe('retained\n');
    await reopened.connect(restoredHost.id); const latest = await reopened.preview(host.id, 'note.txt');
    const saved = await reopened.save(host.id, { path: 'note.txt', expectedRevision: latest.revision, text: 'retained\n' });
    expect(saved.state).toBe('saved'); expect(readFileSync(join(f.root, 'note.txt'), 'utf8')).toBe('retained\n');
    expect(statSync(join(f.root, 'note.txt')).mode & 0o777).toBe(0o640); expect(reopened.listDrafts(host.id)).toHaveLength(0);
    expect(saved.receipt.signature).toMatch(/^[a-f0-9]{64}$/); expect(statSync(f.storagePath).mode & 0o077).toBe(0);
  } finally { try { service.dispose(); } catch {} reopened?.dispose(); f.close(); }
}, 10000);

protocolTest('SFTP rejects links and traversal and identifies binary files and missing targets', async () => {
  const f = fixture(); const service = f.open();
  try {
    const host = service.addHost(f.host); await service.connect(host.id);
    const outside = join(f.parent, 'outside'); mkdirSync(outside); writeFileSync(join(outside, 'secret'), 'outside'); symlinkSync(outside, join(f.root, 'escape'));
    await expect(service.preview(host.id, '../outside/secret')).rejects.toThrow('path');
    await expect(service.preview(host.id, 'escape/secret')).rejects.toThrow('symbolic');
    expect((await service.list(host.id)).entries.find(e => e.name === 'escape')?.kind).toBe('blocked');
    writeFileSync(join(f.root, 'binary'), Buffer.from([0, 1, 2])); const binary = await service.preview(host.id, 'binary'); expect(binary.state).toBe('binary');
    expect((await service.save(host.id, { path: 'binary', text: 'replacement', expectedRevision: binary.revision })).state).toBe('failed'); expect(readFileSync(join(f.root, 'binary'))).toEqual(Buffer.from([0, 1, 2]));
    const missing = await service.preview(host.id, 'new.txt'); expect(missing.state).toBe('missing');
    expect((await service.save(host.id, { path: 'new.txt', text: 'new', expectedRevision: null })).state).toBe('saved');
    expect(readFileSync(join(f.root, 'new.txt'), 'utf8')).toBe('new');
  } finally { service.dispose(); f.close(); }
}, 10000);

protocolTest('lost rename acknowledgement remains uncertain and blocks replay until observed reconciliation', async () => {
  const f = fixture(); let renamed = false;
  const service = f.open({ transportFactory: (host: unknown) => {
    const sftp = new Sftp(host, (_bin: string, _args: string[], options: object) => spawn(localSftp!, [], options));
    const rename = sftp.rename.bind(sftp); sftp.rename = async (...args: unknown[]) => { await rename(...args); renamed = true; throw new Error('injected lost rename acknowledgement'); }; return sftp;
  } });
  try {
    const host = service.addHost(f.host); await service.connect(host.id); const original = await service.preview(host.id, 'note.txt');
    const result = await service.save(host.id, { path: 'note.txt', text: 'committed', expectedRevision: original.revision });
    expect(renamed).toBe(true); expect(readFileSync(join(f.root, 'note.txt'), 'utf8')).toBe('committed'); expect(result.state).toBe('unknown');
    expect(service.listDrafts(host.id)[0].text).toBe('committed');
    await expect(service.save(host.id, { path: 'note.txt', text: 'replay', expectedRevision: original.revision })).rejects.toThrow('Reconcile');
    expect(service.listDrafts(host.id)[0].text).toBe('committed');
    expect(() => service.approveCommand(host.id, { command: 'true', timeoutSeconds: 5 })).toThrow('unknown');
    service.reconcile(host.id, result.receipt.id, 'Observed committed bytes in the current remote file.');
    expect(service.listReceipts(host.id).at(-1)?.state).toBe('reconciled');
  } finally { service.dispose(); f.close(); }
}, 10000);

protocolTest('explicit command approval is single-use, host/root-bound and runs actual helper with canonical cwd', async () => {
  const f = fixture(); const service = f.open();
  try {
    const host = service.addHost(f.host); const second = service.addHost({ ...f.host, label: 'Second authority' });
    await service.connect(host.id); await service.connect(second.id);
    const command = "printf 'literal $HOME; $(not-a-command)\\n'; pwd; printf error >&2; exit 7";
    const approval = service.approveCommand(host.id, { command, timeoutSeconds: 5 });
    await expect(service.executeCommand(second.id, approval.token)).rejects.toThrow('Review');
    const result = await service.executeCommand(host.id, approval.token); expect(result.exitCode).toBe(7);
    expect(result.stdout).toBe(`literal $HOME; $(not-a-command)\n${f.root}\n`); expect(result.stderr).toBe('error');
    expect(result.receipt.state).toBe('completed'); await expect(service.executeCommand(host.id, approval.token)).rejects.toThrow('Review');
    expect(f.calls.at(-1)?.args).toContain('StrictHostKeyChecking=yes'); expect(f.calls.at(-1)?.args).toContain('BatchMode=yes');
    expect(f.calls.at(-1)?.args).not.toContain(command);
    const superseded = service.approveCommand(host.id, { command: 'true', timeoutSeconds: 5 });
    service.approveCommand(host.id, { command: 'printf latest', timeoutSeconds: 5 });
    await expect(service.executeCommand(host.id, superseded.token)).rejects.toThrow('Review');
    const priorConnection = service.approveCommand(host.id, { command: 'true', timeoutSeconds: 5 });
    await service.connect(host.id); await expect(service.executeCommand(host.id, priorConnection.token)).rejects.toThrow('Review');
    const outputApproval = service.approveCommand(host.id, { command: `python3 -c 'print("x"*70000)'`, timeoutSeconds: 5 });
    const bounded = await service.executeCommand(host.id, outputApproval.token); expect(bounded.exitCode).toBe(0); expect(bounded.truncated).toBe(true); expect(bounded.stdout.length).toBeLessThan(70000);
  } finally { service.dispose(); f.close(); }
}, 10000);

protocolTest('uncertain command survives restart; per-host owner prevents overlapping operations and replay', async () => {
  let release: (() => void) | undefined; let enteredResolve!: () => void;
  const entered = new Promise<void>(resolve => { enteredResolve = resolve; });
  const f = fixture({ commandRunner: () => new Promise((_resolve, reject) => { release = () => reject(new Error('disconnected after submission')); enteredResolve(); }) });
  const service = f.open(); let reopened: RemoteWorkspaceService | undefined;
  try {
    const host = service.addHost(f.host); await service.connect(host.id);
    const approval = service.approveCommand(host.id, { command: 'touch owned', timeoutSeconds: 5 });
    const running = service.executeCommand(host.id, approval.token);
    // Wait on a semantic owner milestone, not a timer or a second command.
    await entered;
    expect(release).toBeDefined(); await expect(service.list(host.id)).rejects.toThrow('progress');
    expect(() => service.disconnect(host.id)).toThrow('active'); expect(service.currentOperation()).toContain('SSH command');
    let destroyed = false; const destroying = service.destroy().then(() => { destroyed = true; });
    expect(destroyed).toBe(false); release!(); const result = await running; await destroying;
    expect(service.currentOperation()).toBeNull(); expect(f.children.every(child => child.exitCode !== null || child.signalCode !== null)).toBe(true);
    expect(result.receipt.state).toBe('unknown'); reopened = f.open();
    await reopened.connect(host.id); expect(() => reopened!.approveCommand(host.id, { command: 'touch owned', timeoutSeconds: 5 })).toThrow('unknown');
    expect(reopened.listReceipts(host.id).find(r => r.id === result.receipt.id)?.state).toBe('unknown');
  } finally { try { service.dispose(); } catch {} reopened?.dispose(); f.close(); }
}, 10000);

test('host validation and guarded IPC reject local option injection and foreign command tokens', async () => {
  expect(() => validateHost({ label: 'bad', hostname: '-oProxyCommand=evil', username: 'u', port: 22, root: '/' })).toThrow('valid');
  expect(() => validateHost({ label: 'bad', hostname: 'host', username: 'u;evil', port: 22, root: '/' })).toThrow('valid');
  const args = sshArgs({ hostname: 'host', username: 'u', port: 22 }, true); expect(args.at(-2)).toBe('host'); expect(args.at(-1)).toBe('sftp');
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  registerRemoteWorkspaceIpc({ registerIpcHandler: (name: string, fn: (...args: unknown[]) => unknown) => handlers.set(name, fn), service: {} });
  expect(() => handlers.get('launcher:remote-workspace-hosts')!({}, '/injected')).toThrow('count');
  expect(() => handlers.get('launcher:remote-workspace-execute-command')!({}, 'foreign', 'token')).toThrow('identifier');
});
