import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, realpathSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const require = createRequire(import.meta.url);
const { createWorkspaceGitService } = require('../launcher/electron/workspace-git-mutations.cjs');
const { createLocalGitReviewService, runLocalGitReviewHelper } = require('../launcher/electron/local-git-review.cjs');
const author = { name: 'Local Fixture', email: 'fixture@example.invalid' };
function fixture() {
  const directory = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-local-git-'))), repo = join(directory, 'repo'), storagePath = join(directory, 'private');
  mkdirSync(repo, { mode: 0o700 }); mkdirSync(storagePath, { mode: 0o700 });
  const id = randomUUID(), env = { PATH: '/usr/bin:/bin', HOME: directory, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
  const git = (args: string[], cwd = repo) => {
    const run = spawnSync('/usr/bin/git', ['-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-C', cwd, ...args], { env, encoding: 'utf8' });
    if (run.status !== 0) throw new Error(run.stderr); return run.stdout.trim();
  };
  git(['init', '-q', '-b', 'main']); git(['config', 'user.name', author.name]); git(['config', 'user.email', author.email]);
  writeFileSync(join(repo, 'a.txt'), 'base\n'); writeFileSync(join(repo, 'keep.txt'), 'preserved\n'); git(['add', '.']); git(['commit', '-qm', 'base']);
  let drafts: string[] = [];
  const options = { resolveWorkspace: (value: string) => value === id ? { id, path: repo } : null, storagePath, getDraftPaths: () => drafts };
  const service = createWorkspaceGitService(options);
  async function review(operation: string, paths?: string[], message?: string) {
    const capture = await service.reviewCapture(id);
    return service.reviewPrepare(id, { actionId: randomUUID(), captureId: capture.captureId, operation, ...(paths ? { paths } : {}), ...(message ? { message, author } : {}) });
  }
  return { directory, repo, storagePath, id, git, service, options, review, setDrafts(value: string[]) { drafts = value; },
    async close() { await service.destroy(); rmSync(directory, { recursive: true, force: true }); } };
}

test('local service stages and unstages only reviewed saved bytes, gates drafts/stale reviews and commits the entire exact index', async () => {
  const f = fixture();
  try {
    const snapshot = f.service.createSnapshot(f.id, { paths: ['a.txt'], label: 'Keep baseline' });
    writeFileSync(join(f.repo, 'a.txt'), 'saved disk bytes\n');
    const stage = await f.review('stage', ['a.txt']);
    expect(stage).toMatchObject({ workspaceId: f.id, state: 'reviewed', target: { path: f.repo } });
    expect(stage.hostId).toBeUndefined();
    f.setDrafts(['a.txt']);
    const rejected = await f.service.reviewApply(f.id, { actionId: stage.actionId, reviewDigest: stage.reviewDigest });
    expect(rejected.state).toBe('failed'); expect(f.git(['show', ':a.txt'])).toBe('base');
    const draftCapture = await f.service.reviewCapture(f.id);
    await expect(f.service.reviewPrepare(f.id, { actionId: randomUUID(), captureId: draftCapture.captureId, operation: 'stage', paths: ['a.txt'] })).rejects.toThrow('draft');
    f.setDrafts([]);
    const stale = await f.review('stage', ['a.txt']); writeFileSync(join(f.repo, 'a.txt'), 'new saved bytes\n');
    expect((await f.service.reviewApply(f.id, { actionId: stale.actionId, reviewDigest: stale.reviewDigest })).state).toBe('failed');
    expect(f.git(['show', ':a.txt'])).toBe('base');
    const good = await f.review('stage', ['a.txt']);
    expect((await f.service.reviewApply(f.id, { actionId: good.actionId, reviewDigest: good.reviewDigest })).state).toBe('completed');
    expect(f.git(['show', ':a.txt'])).toBe('new saved bytes');
    const unstage = await f.review('unstage', ['a.txt']);
    expect((await f.service.reviewApply(f.id, { actionId: unstage.actionId, reviewDigest: unstage.reviewDigest })).state).toBe('completed');
    expect(f.git(['show', ':a.txt'])).toBe('base'); expect(readFileSync(join(f.repo, 'a.txt'), 'utf8')).toBe('new saved bytes\n');
    const restage = await f.review('stage', ['a.txt']); await f.service.reviewApply(f.id, { actionId: restage.actionId, reviewDigest: restage.reviewDigest });
    // write-tree can update index cache extensions; establish this fixture oracle before review.
    const expectedTree = f.git(['write-tree']), before = f.git(['rev-list', '--count', 'HEAD']);
    const commit = await f.review('commit', undefined, 'Exact local reviewed commit');
    expect(commit.review.stagedEntries.map((row: any) => row.path)).toEqual(['a.txt', 'keep.txt']);
    const result = await f.service.reviewApply(f.id, { actionId: commit.actionId, reviewDigest: commit.reviewDigest });
    expect(result).toMatchObject({ state: 'completed', ownerHeld: false, terminal: true, result: { treeOid: expectedTree } });
    expect(f.git(['rev-parse', 'HEAD'])).toBe(result.result.commitOid); expect(f.git(['rev-parse', 'HEAD^{tree}'])).toBe(expectedTree);
    await f.service.reviewApply(f.id, { actionId: commit.actionId, reviewDigest: commit.reviewDigest });
    expect(Number(f.git(['rev-list', '--count', 'HEAD']))).toBe(Number(before) + 1);
    expect(f.service.listSnapshots(f.id).map((row: any) => row.id)).toEqual([snapshot.id]);
    expect(f.service.reviewListActions(f.id).some((row: any) => row.actionId === commit.actionId && row.state === 'completed')).toBe(true);
  } finally { await f.close(); }
}, 20000);

test('local lost acknowledgement survives registry reload and read-only inspection without commit replay', async () => {
  const f = fixture(); let controller: any;
  try {
    await f.service.destroy(); writeFileSync(join(f.repo, 'a.txt'), 'once only\n'); f.git(['add', 'a.txt']);
    let dropped = false, applies = 0;
    const stat = require('node:fs').lstatSync(f.repo);
    const root = { id: f.id, path: f.repo, identity: `${stat.dev}:${stat.ino}` };
    const options = { storagePath: f.storagePath, rootFor: () => root, recheck() {},
      own: (_id: string, _kind: string, _label: string, work: any) => work(), exclusive: (_id: string, _label: string, work: any) => work(),
      executeHelper: async (scope: any, operation: string, payload: any) => {
        if (operation === 'apply') applies++;
        const value = await runLocalGitReviewHelper(scope, operation, payload);
        if (operation === 'apply' && !dropped) { dropped = true; throw new Error('Fixture lost acknowledgement after physical completion'); }
        return value;
      } };
    controller = createLocalGitReviewService(options);
    const capture = await controller.capture(f.id), plan = await controller.prepare(f.id, { actionId: randomUUID(), captureId: capture.captureId, operation: 'commit', message: 'One durable commit', author });
    const result = await controller.apply(f.id, { actionId: plan.actionId, reviewDigest: plan.reviewDigest });
    expect(result).toMatchObject({ state: 'unknown', ownerHeld: true }); expect(controller.hasRetainedState(f.id)).toBe(true);
    const committed = f.git(['rev-parse', 'HEAD']), count = f.git(['rev-list', '--count', 'HEAD']);
    await controller.destroy(); controller = createLocalGitReviewService(options);
    expect(controller.listActions(f.id)[0]).toMatchObject({ state: 'unknown', actionId: plan.actionId });
    await controller.apply(f.id, { actionId: plan.actionId, reviewDigest: plan.reviewDigest }); expect(applies).toBe(1);
    const inspected = await controller.inspectAction(f.id, plan.actionId);
    expect(inspected).toMatchObject({ state: 'completed', ownerHeld: false, result: { commitOid: committed } });
    expect(controller.hasRetainedState(f.id)).toBe(false); expect(f.git(['rev-list', '--count', 'HEAD'])).toBe(count); expect(applies).toBe(1);
  } finally { await controller?.destroy(); await f.close(); }
}, 20000);

test('archived local checkout opens in place with ignored and staged-only recovery data preserved', async () => {
  const f = fixture();
  try {
    const tree = await f.service.createWorktree(f.id, { name: 'recover-fixture', expectedHeadOid: f.git(['rev-parse', 'HEAD']) });
    writeFileSync(join(tree.path, 'a.txt'), 'staged recovery\n'); f.git(['add', 'a.txt'], tree.path);
    writeFileSync(join(tree.path, 'a.txt'), 'working recovery\n'); writeFileSync(join(tree.path, '.gitignore'), 'ignored.bin\n');
    writeFileSync(join(tree.path, 'ignored.bin'), Buffer.from([0, 255, 1]));
    const preview = await f.service.previewArchive(f.id, tree.id), archived = await f.service.archiveWorktree(f.id, { previewId: preview.previewId });
    expect(archived.state).toBe('archived'); expect(existsSync(tree.path)).toBe(false);
    const recovered = await f.service.resolveManagedRoot(f.id, tree.id);
    expect(recovered.path).toBe(archived.archivePath); expect(readFileSync(join(recovered.path, 'a.txt'), 'utf8')).toBe('working recovery\n');
    expect(f.git(['show', ':a.txt'], recovered.path)).toBe('staged recovery'); expect(readFileSync(join(recovered.path, 'ignored.bin'))).toEqual(Buffer.from([0, 255, 1]));
    expect(f.service.listSnapshots(f.id).some((row: any) => row.id === archived.recoverySnapshotId)).toBe(true);
  } finally { await f.close(); }
}, 20000);
