import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createLocalWorkspaceService } = require('../launcher/electron/local-workspace.cjs');
const { createRemoteWorkspaceService, Sftp } = require('../launcher/electron/remote-workspace.cjs');

test('local UI pages reach all 605 files; Previous, path/grant isolation, mutation and legacy bounds', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-pages-')));
  try {
    for (let i = 0; i < 605; i++) writeFileSync(join(root, `inert-${i}.txt`), '');
    mkdirSync(join(root, '.git')); mkdirSync(join(root, 'nested')); symlinkSync('/tmp', join(root, 'link'));
    const service = createLocalWorkspaceService({ pickDirectory: async () => root });
    const grant = await service.pickRoot();
    const first = service.list(grant.id, '', null);
    expect(first.entries).toHaveLength(300); expect(first.previousCursor).toBeNull(); expect(first.nextCursor).toBeString();
    const second = service.list(grant.id, '', first.nextCursor);
    const third = service.list(grant.id, '', second.nextCursor);
    const all = [...first.entries, ...second.entries, ...third.entries];
    expect(all).toHaveLength(607); expect(new Set(all.map(e => e.name)).size).toBe(607);
    expect(all.find(e => e.name === 'link').kind).toBe('blocked-link'); expect(third.nextCursor).toBeNull();
    expect(service.list(grant.id, '', second.previousCursor).entries).toEqual(first.entries);
    expect(() => service.list(grant.id, 'nested', first.nextCursor)).toThrow('Refresh');
    expect(() => service.list(grant.id, '', first.nextCursor + 'bad')).toThrow('Refresh');
    const other = createLocalWorkspaceService({ pickDirectory: async () => root }); const otherGrant = await other.pickRoot();
    expect(() => other.list(otherGrant.id, '', first.nextCursor)).toThrow('Refresh');
    expect(service.list(grant.id).entries).toHaveLength(300); expect(service.list(grant.id).nextCursor).toBeUndefined();
    expect(service.tree(grant.id).entries.length).toBeLessThanOrEqual(600);
    writeFileSync(join(root, 'added'), '');
    expect(() => service.list(grant.id, '', first.nextCursor)).toThrow('Refresh');
    expect(() => service.list(grant.id, 'link', null)).toThrow('Symbolic');
    service.forgetRoot(grant.id); expect(() => service.list(grant.id, '', first.nextCursor)).toThrow('Select');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('remote pages bind connection/host/path, retain legacy API and reject changed directory', async () => {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-remote-pages-')));
  let mtime = 1;
  const rows = Array.from({ length: 605 }, (_, i) => ({ name: `inert-${i}`, mode: 0o100600, size: 0 }));
  const calls: number[] = [];
  const service = createRemoteWorkspaceService({ storagePath: join(parent, 'private', 'registry.json'),
    transportFactory: () => ({ ready: Promise.resolve(), closed: false,
      async realpath(p: string) { return p; }, async stat() { return { mode: 0o40700, size: 20, mtime }; },
      async list(_p: string, offset = 0) { calls.push(offset); return { entries: rows.slice(offset, offset + 300), truncated: offset + 300 < rows.length }; },
      close() { this.closed = true; },
    }),
  });
  try {
    const host = service.addHost({ label: 'Inert', hostname: 'fixture.invalid', username: 'fixture', port: 22, root: '/fixture' });
    await service.connect(host.id);
    const first = await service.list(host.id, '', null); const second = await service.list(host.id, '', first.nextCursor);
    const third = await service.list(host.id, '', second.nextCursor);
    expect([...first.entries, ...second.entries, ...third.entries]).toHaveLength(605);
    expect(calls).toEqual([0, 300, 600]); expect(third.nextCursor).toBeNull();
    expect((await service.list(host.id, '', second.previousCursor)).entries).toEqual(first.entries);
    await expect(service.list(host.id, 'other', first.nextCursor)).rejects.toThrow('Refresh');
    const other = service.addHost({ label: 'Other inert host', hostname: 'other.invalid', username: 'fixture', port: 22, root: '/fixture' });
    await service.connect(other.id);
    await expect(service.list(other.id, '', first.nextCursor)).rejects.toThrow('Refresh');
    expect((await service.list(host.id)).nextCursor).toBeUndefined();
    mtime++; await expect(service.list(host.id, '', first.nextCursor)).rejects.toThrow('Refresh');
    const fresh = await service.list(host.id, '', null);
    service.disconnect(host.id); await service.connect(host.id);
    await expect(service.list(host.id, '', fresh.nextCursor)).rejects.toThrow('Refresh');
  } finally { service.dispose(); rmSync(parent, { recursive: true, force: true }); }
});

test('SFTP streaming skips prefix, filters reserved entries, caps page and releases handle', async () => {
  let packet = 0, released = 0;
  const items = ['.', '..', '.git', ...Array.from({ length: 605 }, (_, i) => `inert-${i}`)];
  const fake = { handle: async () => Buffer.from('owned'), release: async () => { released++; },
    request: async () => { if (packet++) throw Object.assign(new Error('EOF'), { sftpCode: 1 }); return {}; },
    expect: () => { let at = 0; return { u32: () => items.length, text: () => items[at++], string: () => Buffer.alloc(0), attrs: () => ({ mode: 0o100600 }) }; },
  };
  const page = await Sftp.prototype.list.call(fake, '/fixture', 300);
  expect(page.entries).toHaveLength(300); expect(page.entries[0].name).toBe('inert-300'); expect(page.truncated).toBe(true); expect(released).toBe(1);
  packet = 0; const tail = await Sftp.prototype.list.call(fake, '/fixture', 600);
  expect(tail.entries).toHaveLength(5); expect(tail.truncated).toBe(false); expect(released).toBe(2);
});

 test('SFTP scan ceiling stays bounded, closes handle and exposes limit instead of an endless Next', async () => {
  let requests = 0, released = 0;
  const fake = { handle: async () => Buffer.from('owned'), release: async () => { released++; },
    request: async () => { requests++; return {}; }, expect: () => ({ u32: () => 0 }) };
  const result = await Sftp.prototype.list.call(fake, '/fixture', 300);
  expect(result.entries).toHaveLength(0); expect(result.scanLimited).toBe(true);
  expect(requests).toBe(100); expect(released).toBe(1);
});
