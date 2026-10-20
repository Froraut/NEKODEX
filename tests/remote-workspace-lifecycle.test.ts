import { expect, test } from 'bun:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const { createRemoteWorkspaceService } = createRequire(import.meta.url)('../launcher/electron/remote-workspace.cjs');

// Inert transport only: no SSH process, remote command or host configuration is touched.
class Transport {
  closed = false;
  ready = Promise.resolve();
  extensions = new Map([['posix-rename@openssh.com', '1']]);
  files = new Map<string, Buffer>([['/project/note.txt', Buffer.from('original')]]);
  exit!: () => void;
  exited = new Promise<void>(resolve => { this.exit = resolve; });
  delayExit = false;
  lostRename = false;
  async realpath(file: string) { if (this.closed) throw new Error('disconnected'); return file; }
  async stat(file: string) { if (this.closed) throw new Error('disconnected'); return file === '/project' ? { mode: 0o40700 } : this.files.has(file) ? { mode: 0o100600 } : null; }
  async read(file: string) { if (this.closed) throw new Error('disconnected'); return this.files.get(file) ?? null; }
  async putExclusive(file: string, bytes: Buffer) { if (this.closed) throw new Error('disconnected'); this.files.set(file, bytes); }
  async remove(file: string) { this.files.delete(file); }
  async rename(from: string, to: string) {
    this.files.set(to, this.files.get(from)!); this.files.delete(from);
    if (this.lostRename) { this.close(); throw new Error('lost acknowledgement after rename'); }
  }
  close() { this.closed = true; if (!this.delayExit) this.exit(); }
}
function fixture(extra: Record<string, unknown> = {}) {
  const folder = mkdtempSync(join(tmpdir(), 'nekodex-transport-'));
  const transports: Transport[] = [];
  const options = { storagePath: join(folder, 'registry.json'), transportFactory: () => { const transport = new Transport(); transports.push(transport); return transport; }, ...extra };
  const service = createRemoteWorkspaceService(options);
  const host = service.addHost({ label: 'Inert', hostname: 'never-connect.invalid', username: 'exact-user', port: 2222, root: '/project' });
  return { service, host, transports, options, folder };
}

test('explicit cancellation retains command owner through local close and durably blocks replay', async () => {
  let submitted!: () => void;
  const entered = new Promise<void>(resolve => { submitted = resolve; });
  let spawned = 0, process!: EventEmitter & { stdout: PassThrough; stderr: PassThrough; stdin: PassThrough; kill(): boolean };
  const f = fixture({ spawnProcess: () => {
    spawned++;
    process = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => { queueMicrotask(() => process.emit('close', null)); return true; } });
    process.stdin.on('finish', submitted); return process;
  } });
  let reopened: typeof f.service | undefined;
  try {
    await f.service.connect(f.host.id);
    const approved = f.service.approveCommand(f.host.id, { command: 'inert command payload', timeoutSeconds: 3600 });
    const running = f.service.executeCommand(f.host.id, approved.token);
    await entered;
    expect(f.service.listHosts()[0].activeOperation).toBe('command');
    expect(f.service.cancelOperation(f.host.id)).toMatchObject({ requested: true, operation: 'command', remoteOutcome: 'requires-terminal-proof' });
    expect(f.service.listHosts()[0]).toMatchObject({ busy: true, connected: false, cancellationRequested: true });
    expect(() => f.service.disconnect(f.host.id)).toThrow('active');
    const result = await running;
    expect(result.receipt.state).toBe('unknown'); expect(spawned).toBe(1);
    expect(f.service.listHosts()[0].unknownReceiptIds).toEqual([result.receipt.id]);
    expect(() => f.service.forgetHost(f.host.id)).toThrow('uncertain');
    await f.service.destroy();
    reopened = createRemoteWorkspaceService(f.options);
    expect(reopened.listReceipts(f.host.id).find((r: { id: string }) => r.id === result.receipt.id)?.state).toBe('unknown');
    await reopened.connect(f.host.id);
    expect(() => reopened.approveCommand(f.host.id, { command: approved.command, timeoutSeconds: 3600 })).toThrow('uncertain');
    await expect(reopened.executeCommand(f.host.id, approved.token)).rejects.toThrow('Review');
    expect(spawned).toBe(1);
    expect(reopened.listHosts()[0]).toMatchObject({ hostname: 'never-connect.invalid', username: 'exact-user', port: 2222, root: '/project' });
  } finally { await f.service.destroy(); await reopened?.destroy(); rmSync(f.folder, { recursive: true, force: true }); }
}, 5000);

test('reconnect waits for old transport exit and never carries old approvals', async () => {
  const f = fixture();
  try {
    await f.service.connect(f.host.id);
    const approved = f.service.approveCommand(f.host.id, { command: 'inert', timeoutSeconds: 1 });
    const previous = f.transports[0]!; previous.delayExit = true;
    f.service.disconnect(f.host.id);
    const reconnecting = f.service.connect(f.host.id);
    await Promise.resolve(); await Promise.resolve();
    expect(f.transports).toHaveLength(1);
    expect(f.service.listHosts()[0]).toMatchObject({ busy: true, connectionState: 'connecting', connected: false });
    previous.exit(); await reconnecting;
    expect(f.transports).toHaveLength(2);
    await expect(f.service.executeCommand(f.host.id, approved.token)).rejects.toThrow('Review');
  } finally { for (const transport of f.transports) transport.exit(); await f.service.destroy(); rmSync(f.folder, { recursive: true, force: true }); }
}, 5000);

test('lost replacement acknowledgement preserves exact draft and receipt through disconnect and restart', async () => {
  const f = fixture(); let reopened: typeof f.service | undefined;
  try {
    await f.service.connect(f.host.id);
    const original = await f.service.preview(f.host.id, 'note.txt');
    f.transports[0]!.lostRename = true;
    const result = await f.service.save(f.host.id, { path: 'note.txt', text: 'durable candidate', expectedRevision: original.revision });
    expect(f.transports[0]!.files.get('/project/note.txt')?.toString()).toBe('durable candidate');
    expect(result.state).toBe('unknown'); expect(f.service.listHosts()[0].connected).toBe(false);
    await f.service.destroy(); reopened = createRemoteWorkspaceService(f.options);
    expect(reopened.listDrafts(f.host.id)[0]).toMatchObject({ text: 'durable candidate', expectedRevision: original.revision });
    expect(reopened.listReceipts(f.host.id).find((r: { id: string }) => r.id === result.receipt.id)?.state).toBe('unknown');
    await reopened.connect(f.host.id);
    await expect(reopened.save(f.host.id, { path: 'note.txt', text: 'replay', expectedRevision: original.revision })).rejects.toThrow('uncertain');
    expect(reopened.listDrafts(f.host.id)[0].text).toBe('durable candidate');
  } finally { await f.service.destroy(); await reopened?.destroy(); rmSync(f.folder, { recursive: true, force: true }); }
}, 5000);

test('temporary-write disconnect stays unknown and rejected exclusive creation never deletes a foreign path', async () => {
  for (const rejectedCreate of [false, true]) {
    const f = fixture();
    try {
      await f.service.connect(f.host.id);
      const transport = f.transports[0]!;
      let removed = false;
      transport.remove = async () => { removed = true; };
      transport.putExclusive = async (file: string, bytes: Buffer) => {
        const admission = JSON.parse(readFileSync(f.options.storagePath, 'utf8')).receipts.find((row: { kind: string }) => row.kind === 'write');
        expect(admission).toMatchObject({ state: 'started', temporaryPath: file });
        transport.files.set(file, rejectedCreate ? Buffer.from('foreign owner') : bytes);
        if (rejectedCreate) throw Object.assign(new Error('already exists'), { sftpCode: 11 });
        transport.close(); throw new Error('disconnect before exclusive-create acknowledgement');
      };
      const original = await f.service.preview(f.host.id, 'note.txt');
      const result = await f.service.save(f.host.id, { path: 'note.txt', text: 'candidate', expectedRevision: original.revision });
      expect(result.state).toBe(rejectedCreate ? 'failed' : 'unknown');
      expect(removed).toBe(false);
      expect(transport.files.get(result.receipt.temporaryPath)?.toString()).toBe(rejectedCreate ? 'foreign owner' : 'candidate');
      expect(transport.files.get('/project/note.txt')?.toString()).toBe('original');
      expect(f.service.listDrafts(f.host.id)[0].text).toBe('candidate');
    } finally { await f.service.destroy(); rmSync(f.folder, { recursive: true, force: true }); }
  }
}, 5000);
