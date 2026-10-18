import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const require = createRequire(import.meta.url);
const { createRemoteWorkspaceService } = require('../launcher/electron/remote-workspace.cjs');
const { REMOTE_GIT_HELPER } = require('../launcher/electron/remote-worktrees.cjs');
const sftpServer = ['/usr/libexec/sftp-server', '/usr/lib/openssh/sftp-server', '/usr/lib/ssh/sftp-server'].find(existsSync);
const providerTest = sftpServer ? test : test.skip;
function fixture(extra: Record<string, unknown> = {}) {
  const parent = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-remote-git-'))); const root = join(parent, 'repo'); mkdirSync(root);
  const git = (...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', env: { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } }).trim();
  git('init', '-q'); git('config', 'user.name', 'Remote fixture'); git('config', 'user.email', 'fixture@example.invalid');
  writeFileSync(join(root, 'note.txt'), 'base\n'); writeFileSync(join(root, '.gitignore'), 'ignored.bin\n'); writeFileSync(join(root, '.gitattributes'), 'note.txt filter=fixture\n');
  git('add', '.'); git('commit', '-qm', 'base');
  const callback = join(parent, 'callback-ran'); const hooks = join(parent, 'hooks'); mkdirSync(hooks); writeFileSync(join(hooks, 'post-checkout'), `#!/bin/sh\ntouch '${callback}'\n`, { mode: 0o700 });
  git('config', 'core.hooksPath', hooks); git('config', 'filter.fixture.clean', `touch '${callback}'; cat`); git('config', 'filter.fixture.smudge', `touch '${callback}'; cat`);
  const storagePath = join(parent, 'private', 'registry.json');
  const spawnProcess = (_binary: string, args: string[], options: object) => args.includes('-s') ? spawn(sftpServer!, [], options) : spawn('/bin/sh', ['-c', args.at(-1)!], options);
  const open = (more = {}) => createRemoteWorkspaceService({ storagePath, spawnProcess, ...extra, ...more });
  const host = { label: 'Local remote-Git protocol fixture', hostname: 'never-connect.invalid', username: 'fixture', port: 22, root };
  return { parent, root, git, callback, open, host, close: () => rmSync(parent, { recursive: true, force: true }) };
}
providerTest('remote managed worktrees use captured HEAD, suppress callbacks, and retain dirty checkout on archive', async () => {
  const f = fixture(); const service = f.open();
  try {
    const host = service.addHost(f.host); await service.connect(host.id);
    const snapshot = await service.worktreeInspect(host.id); const plan = await service.worktreePrepare(host.id, { captureId: snapshot.captureId, name: 'managed-fixture' });
    expect(plan.record.branch).toBe('codex/managed-fixture'); expect(plan.record.headOid).toBe(f.git('rev-parse', 'HEAD'));
    expect(existsSync(plan.record.path)).toBe(false); expect(plan.record.parent).toBe(f.parent);
    const result = await service.worktreeCreate(host.id, plan.token); expect(result.receipt.state).toBe('completed'); expect(result.worktree.state).toBe('ready');
    expect(readFileSync(join(result.worktree.path, 'note.txt'), 'utf8')).toBe('base\n'); expect(existsSync(f.callback)).toBe(false);
    await expect(service.worktreeCreate(host.id, plan.token)).rejects.toThrow('Review');
    writeFileSync(join(result.worktree.path, 'note.txt'), 'dirty tracked\n'); writeFileSync(join(result.worktree.path, 'untracked.txt'), 'untracked\n'); writeFileSync(join(result.worktree.path, 'ignored.bin'), 'ignored\n');
    const review = await service.worktreePrepareArchive(host.id, result.worktree.id); expect(review.expected.dirty).toBe(true);
    writeFileSync(join(result.worktree.path, 'untracked.txt'), 'changed after review\n'); writeFileSync(join(result.worktree.path, 'added-after-review.txt'), 'new path');
    const stale = await service.worktreeArchive(host.id, review.token); expect(stale.receipt.state).toBe('failed'); expect(stale.worktree.state).toBe('ready');
    const current = await service.worktreePrepareArchive(host.id, result.worktree.id); const archived = await service.worktreeArchive(host.id, current.token);
    expect(archived.receipt.state).toBe('completed'); expect(archived.worktree.state).toBe('archived'); expect(archived.worktree.checkoutRetained).toBe(true);
    expect(readFileSync(join(result.worktree.path, 'note.txt'), 'utf8')).toBe('dirty tracked\n'); expect(readFileSync(join(result.worktree.path, 'untracked.txt'), 'utf8')).toBe('changed after review\n'); expect(readFileSync(join(result.worktree.path, 'ignored.bin'), 'utf8')).toBe('ignored\n');
    expect(f.git('rev-parse', archived.worktree.archiveRef)).toBe(current.expected.headOid); expect(existsSync(f.callback)).toBe(false);
  } finally { await service.destroy(); f.close(); }
}, 15000);

providerTest('remote creation rejects stale capture and approvals from a reconnected host', async () => {
  const f = fixture(); const service = f.open();
  try {
    const host = service.addHost(f.host); await service.connect(host.id); const capture = await service.worktreeInspect(host.id);
    const old = await service.worktreePrepare(host.id, { captureId: capture.captureId, name: 'stale' });
    // Commit uses an empty tree change and explicitly disables the fixture hook.
    f.git('-c', 'core.hooksPath=', 'commit', '--allow-empty', '-qm', 'new HEAD');
    const rejected = await service.worktreeCreate(host.id, old.token); expect(rejected.receipt.state).toBe('failed'); expect(existsSync(old.record.path)).toBe(false);
    const current = await service.worktreeInspect(host.id); const pending = await service.worktreePrepare(host.id, { captureId: current.captureId, name: 'connection' });
    await service.connect(host.id); await expect(service.worktreeCreate(host.id, pending.token)).rejects.toThrow('Review');
    expect(existsSync(pending.record.path)).toBe(false);
  } finally { await service.destroy(); f.close(); }
}, 15000);

providerTest('lost remote creation response retains ownership intent, blocks replay, and reconciles by real inspection after restart', async () => {
  let lose = true; const f = fixture();
  const runActual = (request: unknown) => new Promise<any>((resolve, reject) => { const child = spawn('python3', ['-c', REMOTE_GIT_HELPER], { stdio: ['pipe', 'pipe', 'pipe'] }); let out = ''; let err = ''; child.stdout.on('data', b => { out += b; }); child.stderr.on('data', b => { err += b; }); child.on('error', reject); child.on('close', code => code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))); child.stdin.end(JSON.stringify(request) + '\n'); });
  const service = f.open({ remoteGitRunner: async (_host: unknown, request: { action: string }) => { const result = await runActual(request); if (request.action === 'create' && result.ok && lose) { lose = false; throw new Error('injected response loss after actual worktree creation'); } return result; } });
  let restarted: any;
  try {
    const host = service.addHost(f.host); await service.connect(host.id); const capture = await service.worktreeInspect(host.id); const plan = await service.worktreePrepare(host.id, { captureId: capture.captureId, name: 'lost-response' });
    const uncertain = await service.worktreeCreate(host.id, plan.token); expect(existsSync(join(plan.record.path, 'note.txt'))).toBe(true); expect(uncertain.receipt.state).toBe('unknown'); expect(uncertain.worktree.state).toBe('needs-inspection');
    await expect(service.worktreeCreate(host.id, plan.token)).rejects.toThrow('reconcile'); await service.destroy(); restarted = f.open(); await restarted.connect(host.id);
    const retained = (await restarted.worktreeList(host.id))[0]; expect(retained.state).toBe('needs-inspection'); const observed = await restarted.worktreeInspectOwned(host.id, retained.id); expect(observed.state).toBe('ready');
    restarted.reconcile(host.id, uncertain.receipt.id, 'Inspected the exact marker, common directory, branch and retained checkout.'); expect(restarted.listReceipts(host.id).find((r: any) => r.id === uncertain.receipt.id).state).toBe('reconciled');
    expect((await restarted.worktreeList(host.id))).toHaveLength(1); expect(f.git('worktree', 'list', '--porcelain').split('worktree ').length - 1).toBe(2);
  } finally { await service.destroy(); if (restarted) await restarted.destroy(); f.close(); }
}, 15000);
