import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync, lstatSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { createRemoteGitReviewController, validateRemoteGitReviewRecords } = require('../launcher/electron/remote-git-review.cjs');
const { REMOTE_GIT_REVIEW_HELPER } = require('../launcher/electron/remote-git-review-helper.cjs');
const hash = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex');
const author = { name: 'Explicit Fixture Author', email: 'fixture@example.invalid' };
function fixture(initial = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'remote-git-review-'))), repo = join(root, 'repo'), home = join(root, 'home');
  mkdirSync(repo, { mode: 0o700 }); mkdirSync(home, { mode: 0o700 });
  const env = { PATH: '/usr/bin:/bin', HOME: home, LANG: 'C', LC_ALL: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  function git(args: string[], options: { directory?: string; allowed?: number[] } = {}) {
    const run = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'filter.tripwire.clean=', '-c', 'filter.tripwire.smudge=', '-c', 'filter.tripwire.process=', '-c', 'filter.tripwire.required=false', '-C', options.directory ?? repo, ...args], { env, encoding: 'utf8' });
    if (run.error || !(options.allowed ?? [0]).includes(run.status!)) throw new Error('Fixture Git failed: ' + run.stderr);
    return run.stdout.trim();
  }
  git(['init', '-q', '-b', 'main']); git(['config', 'user.name', author.name]); git(['config', 'user.email', author.email]);
  if (initial) { writeFileSync(join(repo, 'a.txt'), 'base\n'); writeFileSync(join(repo, 'b.txt'), 'keep\n'); git(['add', '--', 'a.txt', 'b.txt']); git(['commit', '-qm', 'Fixture base']); }
  const hosts = new Map<string, any>(), calls: string[] = [], receipts: any[] = []; let rows: any[] = [], admission = 0, terminals = 0;
  let pause: (() => Promise<void>) | null = null, dropCommitReply = false, localTerminalFailures = 0;
  const addHost = (directory = repo, hostname = 'fixture.invalid') => { const id = randomUUID(); hosts.set(id, { hostId: id, fingerprint: hash(id + directory), connectionId: randomUUID(), root: directory, hostname, username: 'fixture', port: 22 }); return id; };
  const hostId = addHost();
  async function helper(scope: any, action: string, payload: any) {
    return await new Promise<any>((resolve, reject) => {
      const child = spawn('/usr/bin/python3', ['-c', REMOTE_GIT_REVIEW_HELPER], { env, stdio: ['pipe', 'pipe', 'pipe'] });
      const out: Buffer[] = [], err: Buffer[] = []; child.stdout.on('data', data => out.push(data)); child.stderr.on('data', data => err.push(data));
      child.once('error', reject); child.once('close', code => {
        const text = Buffer.concat(out).toString('utf8');
        if (code !== 0 || !text.trim()) { reject(new Error('Fixed helper failed: ' + Buffer.concat(err).toString('utf8').slice(0, 2000))); return; }
        try { resolve(JSON.parse(text)); } catch { reject(new Error('Malformed helper fixture output: ' + text.slice(0, 1000))); }
      });
      child.stdin.end(JSON.stringify({ root: scope.root, scope, action, payload }) + '\n');
    });
  }
  const options = {
    withHost: async (id: string, action: any) => {
      const scope = hosts.get(id); if (!scope) throw new Error('Unknown host fixture');
      return await action(structuredClone(scope), async (kind: string, payload: any) => {
        calls.push(kind); if (kind === 'apply') await pause?.();
        const response = await helper(structuredClone(scope), kind, payload);
        if (kind === 'apply' && payload.plan.operation === 'commit' && dropCommitReply) { dropCommitReply = false; throw new Error('Simulated loss after actual Git commit'); }
        return response;
      });
    },
    getRecords: () => structuredClone(rows),
    storeRecords: (value: any[]) => { validateRemoteGitReviewRecords(value); rows = structuredClone(value); },
    begin: () => { throw new Error('Production atomic admission must not call separate begin'); },
    finish: () => { throw new Error('Production atomic terminal must not call separate finish'); },
    storePrepared: (row: any) => { admission++; row.receiptId = randomUUID(); rows = rows.map(old => old.actionId === row.actionId ? structuredClone(row) : old); receipts.push({ id: row.receiptId, actionId: row.actionId, state: 'started' }); return row; },
    storeTerminal: (row: any, detail: any) => { if (localTerminalFailures) { localTerminalFailures--; throw new Error('Simulated atomic local storage refusal'); } terminals++; rows = rows.map(old => old.actionId === row.actionId ? structuredClone(row) : old); Object.assign(receipts.find(value => value.id === row.receiptId), detail); },
  };
  const controller = createRemoteGitReviewController(options);
  async function run(operation: 'stage' | 'unstage' | 'commit', paths?: string[], message?: string, service = controller, id = hostId) {
    const capture = await service.capture(id), plan = await service.prepare(id, { actionId: randomUUID(), captureId: capture.captureId, operation, ...(paths ? { paths } : {}), ...(message ? { message, author } : {}) });
    return { capture, plan, result: await service.apply(id, { actionId: plan.actionId, reviewDigest: plan.reviewDigest }) };
  }
  return { root, repo, git, controller, options, hostId, hosts, addHost, calls, receipts, helper, run,
    records: () => structuredClone(rows), admission: () => admission, terminals: () => terminals,
    pause: (value: typeof pause) => { pause = value; }, dropCommit: () => { dropCommitReply = true; },
    failLocalTerminalOnce: () => { localTerminalFailures = 1; },
    async close() { await controller.destroy(); rmSync(root, { recursive: true, force: true }); } };
}

test('full review stages reviewed bytes, preserves other staging, unstages index only and commits the exact reviewed tree without callbacks', async () => {
  const f = fixture(), marker = join(f.root, 'CALLBACK_RAN');
  try {
    const script = join(f.root, 'tripwire'); writeFileSync(script, '#!/bin/sh\nprintf callback > ' + JSON.stringify(marker) + '\n', { mode: 0o700 });
    for (const name of ['pre-commit', 'prepare-commit-msg', 'commit-msg', 'post-commit', 'reference-transaction']) writeFileSync(join(f.repo, '.git', 'hooks', name), readFileSync(script), { mode: 0o700 });
    f.git(['config', 'core.fsmonitor', script]); f.git(['config', 'diff.external', script]); f.git(['config', 'commit.gpgSign', 'true']); f.git(['config', 'gpg.program', script]);
    writeFileSync(join(f.repo, 'a.txt'), 'reviewed exact bytes\n'); writeFileSync(join(f.repo, 'binary.bin'), Buffer.from([0, 1, 2, 255])); f.git(['mv', 'b.txt', 'renamed.txt']);
    const bases = await f.controller.bases(f.hostId); expect(bases.choices[0].kind).toBe('head');
    const first = await f.controller.capture(f.hostId, { baseId: bases.choices[0].baseId }); expect(first.entries.some((row: any) => row.originalPath === 'b.txt' && row.path === 'renamed.txt')).toBe(true);
    expect(await f.controller.diff(f.hostId, { captureId: first.captureId, kind: 'worktree', path: 'binary.bin' })).toMatchObject({ state: 'current', binary: true, text: '' });
    const diff = await f.controller.diff(f.hostId, { captureId: first.captureId, kind: 'worktree', path: 'a.txt' }); expect(diff).toMatchObject({ state: 'current', binary: false }); expect(diff.text).toContain('reviewed exact bytes');
    const indexMode = lstatSync(join(f.repo, '.git', 'index')).mode & 0o777;
    const staged = await f.run('stage', ['a.txt', 'binary.bin']); expect(staged.result).toMatchObject({ state: 'completed', ownerHeld: false, terminal: true }); expect(lstatSync(join(f.repo, '.git', 'index')).mode & 0o777).toBe(indexMode);
    expect(f.git(['show', ':a.txt'])).toBe('reviewed exact bytes'); expect(f.git(['ls-files', '--stage', '--', 'renamed.txt'])).toContain('renamed.txt');
    const unstage = await f.run('unstage', ['a.txt']); expect(unstage.result.state).toBe('completed'); expect(f.git(['show', ':a.txt'])).toBe('base'); expect(readFileSync(join(f.repo, 'a.txt'), 'utf8')).toBe('reviewed exact bytes\n');
    await f.run('stage', ['a.txt']); const committed = await f.run('commit', undefined, 'Explicit reviewed commit');
    expect(committed.plan.review.paths).toContain('a.txt'); expect(committed.plan.review.stagedEntries.length).toBeGreaterThan(0);
    expect(committed.result).toMatchObject({ state: 'completed', terminal: true }); expect(f.git(['rev-parse', 'HEAD'])).toBe(committed.result.result.commitOid);
    expect(f.git(['show', 'HEAD:a.txt'])).toBe('reviewed exact bytes'); expect(f.git(['status', '--porcelain'])).toBe(''); expect(existsSync(marker)).toBe(false);
    f.git(['update-ref', 'refs/heads/comparison', first.repository.headOid]); const comparisons = await f.controller.bases(f.hostId), choice = comparisons.choices.find((row: any) => row.ref === 'refs/heads/comparison');
    const compared = await f.controller.capture(f.hostId, { baseId: choice.baseId }), oldDiff = await f.controller.diff(f.hostId, { captureId: compared.captureId, kind: 'base' });
    f.git(['update-ref', 'refs/heads/comparison', committed.result.result.commitOid]);
    expect(await f.controller.diff(f.hostId, { captureId: compared.captureId, kind: 'base' })).toMatchObject({ state: 'stale', text: oldDiff.text }); expect(f.git(['rev-parse', 'HEAD'])).toBe(committed.result.result.commitOid);
    const calls = f.calls.length; expect(await f.controller.apply(f.hostId, { actionId: committed.plan.actionId, reviewDigest: committed.plan.reviewDigest })).toEqual(committed.result); expect(f.calls.length).toBe(calls);
    expect(JSON.stringify(f.controller.listActions(f.hostId))).not.toContain('cmV2aWV3ZWQgZXhhY3QgYnl0ZXM'); expect(f.admission()).toBe(4); expect(f.terminals()).toBe(4);
    expect(f.controller.pruneActions(f.hostId, [staged.plan.actionId])).toEqual({ removed: 1 });
    expect(() => f.controller.apply(f.hostId, { actionId: staged.plan.actionId, reviewDigest: staged.plan.reviewDigest })).toThrow(); expect(f.calls.length).toBe(calls);
  } finally { await f.close(); }
}, 30000);

test('unborn commit, stale file/index/ref refusal, conversion refusal and captured diff freshness preserve current work', async () => {
  const f = fixture(false);
  try {
    writeFileSync(join(f.repo, 'initial.txt'), 'initial\n'); const start = await f.controller.capture(f.hostId); expect(start.repository.headOid).toBeNull();
    await f.run('stage', ['initial.txt']); const first = await f.run('commit', undefined, 'Initial exact commit'); expect(first.plan.review.parents).toEqual([]); expect(f.git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ')).toHaveLength(1);
    writeFileSync(join(f.repo, 'initial.txt'), 'approved candidate\n'); const captured = await f.controller.capture(f.hostId); const viewed = await f.controller.diff(f.hostId, { captureId: captured.captureId, kind: 'worktree', path: 'initial.txt' });
    const plan = await f.controller.prepare(f.hostId, { actionId: randomUUID(), captureId: captured.captureId, operation: 'stage', paths: ['initial.txt'] });
    writeFileSync(join(f.repo, 'initial.txt'), 'external newer bytes\n');
    const stale = await f.controller.diff(f.hostId, { captureId: captured.captureId, kind: 'worktree', path: 'initial.txt' }); expect(stale.state).toBe('stale'); expect(stale.text).toBe(viewed.text);
    const refused = await f.controller.apply(f.hostId, { actionId: plan.actionId, reviewDigest: plan.reviewDigest }); expect(refused.state).toBe('failed'); expect(f.git(['show', ':initial.txt'])).toBe('initial'); expect(readFileSync(join(f.repo, 'initial.txt'), 'utf8')).toBe('external newer bytes\n');
    f.git(['config', 'core.autocrlf', 'true']); const changed = await f.controller.capture(f.hostId);
    await expect(f.controller.prepare(f.hostId, { actionId: randomUUID(), captureId: changed.captureId, operation: 'stage', paths: ['initial.txt'] })).rejects.toMatchObject({ actionRecorded: false });
    f.git(['config', 'core.autocrlf', 'false']); const attributes = join(f.root, 'custom-attributes'); writeFileSync(attributes, '*.txt text eol=crlf\n'); f.git(['config', 'core.attributesFile', attributes]);
    const custom = await f.controller.capture(f.hostId); expect(custom.limitations).toContain('configured_attributes_file_not_supported');
    await expect(f.controller.prepare(f.hostId, { actionId: randomUUID(), captureId: custom.captureId, operation: 'stage', paths: ['initial.txt'] })).rejects.toMatchObject({ actionRecorded: false });
    f.git(['config', '--unset', 'core.attributesFile']); const callback = join(f.root, 'filter-ran'), script = join(f.root, 'clean-filter'); writeFileSync(script, '#!/bin/sh\nprintf unsafe > ' + JSON.stringify(callback) + '\n', { mode: 0o700 });
    writeFileSync(join(f.repo, '.gitattributes'), 'initial.txt filter=tripwire\n'); f.git(['config', 'filter.tripwire.clean', script]); const filtered = await f.controller.capture(f.hostId);
    await expect(f.controller.prepare(f.hostId, { actionId: randomUUID(), captureId: filtered.captureId, operation: 'stage', paths: ['initial.txt'] })).rejects.toMatchObject({ actionRecorded: false }); expect(existsSync(callback)).toBe(false);
    rmSync(join(f.repo, '.gitattributes')); f.git(['config', '--unset', 'filter.tripwire.clean']); const fresh = await f.controller.capture(f.hostId), indexed = await f.controller.prepare(f.hostId, { actionId: randomUUID(), captureId: fresh.captureId, operation: 'stage', paths: ['initial.txt'] });
    writeFileSync(join(f.repo, 'unrelated.txt'), 'other writer\n'); f.git(['add', '--', 'unrelated.txt']);
    expect((await f.controller.apply(f.hostId, { actionId: indexed.actionId, reviewDigest: indexed.reviewDigest })).state).toBe('failed'); expect(f.git(['show', ':unrelated.txt'])).toBe('other writer');
  } finally { await f.close(); }
}, 30000);

test('conflict stages and explicit resolved merge commit bind both parents and settle exact merge metadata', async () => {
  const f = fixture();
  try {
    f.git(['checkout', '-qb', 'side']); writeFileSync(join(f.repo, 'a.txt'), 'side\n'); f.git(['commit', '-qam', 'Side change']); const side = f.git(['rev-parse', 'HEAD']);
    f.git(['checkout', '-q', 'main']); writeFileSync(join(f.repo, 'a.txt'), 'main\n'); f.git(['commit', '-qam', 'Main change']); const main = f.git(['rev-parse', 'HEAD']); f.git(['merge', '--no-edit', 'side'], { allowed: [1] });
    const capture = await f.controller.capture(f.hostId); expect(capture.entries.find((row: any) => row.path === 'a.txt')).toMatchObject({ kind: 'conflict' });
    expect((await f.controller.diff(f.hostId, { captureId: capture.captureId, kind: 'conflict', path: 'a.txt', stage: 2 })).text).toBe('main\n');
    expect((await f.controller.diff(f.hostId, { captureId: capture.captureId, kind: 'conflict', path: 'a.txt', stage: 3 })).text).toBe('side\n');
    await expect(f.controller.prepare(f.hostId, { actionId: randomUUID(), captureId: capture.captureId, operation: 'commit', message: 'Must refuse unmerged', author })).rejects.toThrow();
    writeFileSync(join(f.repo, 'a.txt'), 'explicit resolution\n'); await f.run('stage', ['a.txt']);
    const commit = await f.run('commit', undefined, 'Reviewed resolved merge'); expect(commit.plan.review.parents).toEqual([main, side]); expect(commit.result.state).toBe('completed');
    expect(f.git(['rev-list', '--parents', '-n', '1', 'HEAD']).split(' ').slice(1)).toEqual([main, side]); expect(existsSync(join(f.repo, '.git', 'MERGE_HEAD'))).toBe(false); expect(f.git(['ls-files', '-u'])).toBe('');
  } finally { await f.close(); }
}, 30000);

test('lost commit reply and restart retain unknown; exact reconnect inspection proves one existing commit without replay', async () => {
  const f = fixture();
  try {
    writeFileSync(join(f.repo, 'a.txt'), 'once\n'); f.failLocalTerminalOnce(); const local = await f.run('stage', ['a.txt']);
    expect(local.result).toMatchObject({ state: 'unknown', ownerHeld: true }); expect(local.result.result.indexDigest).toMatch(/^[a-f0-9]{64}$/);
    const localCalls = f.calls.length; expect((await f.controller.inspectAction(f.hostId, local.plan.actionId)).state).toBe('completed'); expect(f.calls.length).toBe(localCalls);
    f.dropCommit();
    const before = f.git(['rev-list', '--count', 'HEAD']), commit = await f.run('commit', undefined, 'Once after lost acknowledgement'); expect(commit.result).toMatchObject({ state: 'unknown', ownerHeld: true, terminal: false });
    const after = f.git(['rev-list', '--count', 'HEAD']); expect(Number(after)).toBe(Number(before) + 1);
    const called = f.calls.filter(value => value === 'apply').length; expect((await f.controller.apply(f.hostId, { actionId: commit.plan.actionId, reviewDigest: commit.plan.reviewDigest })).state).toBe('unknown'); expect(f.calls.filter(value => value === 'apply').length).toBe(called);
    const fresh = createRemoteGitReviewController(f.options); f.hosts.get(f.hostId).connectionId = randomUUID();
    expect(fresh.listActions(f.hostId).find((row: any) => row.actionId === commit.plan.actionId).state).toBe('unknown');
    const settled = await fresh.inspectAction(f.hostId, commit.plan.actionId); expect(settled).toMatchObject({ state: 'completed', terminal: true, ownerHeld: false }); expect(settled.result.commitOid).toBe(f.git(['rev-parse', 'HEAD']));
    expect(f.git(['rev-list', '--count', 'HEAD'])).toBe(after); expect(f.calls.filter(value => value === 'apply').length).toBe(called); await fresh.destroy();
  } finally { await f.close(); }
}, 30000);

test('common repository ownership covers alias profiles and a foreign durable remote gate is preserved', async () => {
  const f = fixture(); let release!: () => void, entered!: () => void;
  try {
    writeFileSync(join(f.repo, 'a.txt'), 'shared\n'); const other = f.addHost(f.repo); const one = await f.controller.capture(f.hostId), two = await f.controller.capture(other);
    const plan = await f.controller.prepare(f.hostId, { actionId: randomUUID(), captureId: one.captureId, operation: 'stage', paths: ['a.txt'] });
    const observed = new Promise<void>(resolve => { entered = resolve; }); f.pause(() => { entered(); return new Promise<void>(resolve => { release = resolve; }); });
    const pending = f.controller.apply(f.hostId, { actionId: plan.actionId, reviewDigest: plan.reviewDigest }); await observed;
    await expect(f.controller.prepare(other, { actionId: randomUUID(), captureId: two.captureId, operation: 'stage', paths: ['a.txt'] })).rejects.toMatchObject({ code: 'remote_git_owner_held' });
    release(); expect((await pending).state).toBe('completed'); f.pause(null);
    writeFileSync(join(f.repo, 'a.txt'), 'foreign gate unchanged\n');
    const indexLock = join(f.repo, '.git', 'index.lock'); writeFileSync(indexLock, 'foreign index owner');
    expect((await f.run('stage', ['a.txt'])).result.state).toBe('failed'); expect(readFileSync(indexLock, 'utf8')).toBe('foreign index owner'); rmSync(indexLock);
    const gateDir = join(f.repo, '.git', '.nekodex-git-review'), gate = join(gateDir, 'owner.json'); mkdirSync(gateDir, { recursive: true, mode: 0o700 }); const bytes = JSON.stringify({ version: 1, actionId: randomUUID(), requestDigest: hash('foreign'), owner: { pid: 99999999, start: 'unverified' } }); writeFileSync(gate, bytes, { mode: 0o600 });
    const capture = await f.controller.capture(other), review = await f.controller.prepare(other, { actionId: randomUUID(), captureId: capture.captureId, operation: 'stage', paths: ['a.txt'] });
    const result = await f.controller.apply(other, { actionId: review.actionId, reviewDigest: review.reviewDigest }); expect(result.state).toBe('unknown'); expect(readFileSync(gate, 'utf8')).toBe(bytes); expect(f.git(['show', ':a.txt'])).toBe('shared');
    expect(() => f.controller.pruneActions(other, [review.actionId])).toThrow();
  } finally { release?.(); await f.close(); }
}, 30000);
