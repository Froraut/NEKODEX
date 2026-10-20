import { describe, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const require = createRequire(import.meta.url);
const { createLocalWorkspaceService } = require('../launcher/electron/local-workspace.cjs');
const { createWorkspaceVmExportService } = require('../launcher/electron/workspace-vm-export.cjs');
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-vm-export-list-'))); chmodSync(base, 0o700);
  const root = join(base, 'workspace'); mkdirSync(root, { mode: 0o700 });
  const protectedRoot = join(root, 'Private-Profile'); mkdirSync(protectedRoot, { mode: 0o700 });
  const workspace = createLocalWorkspaceService({ pickDirectory: async () => root });
  const selected = await workspace.pickRoot();
  const bytes = Buffer.from('marker,total\nok,1\n'), taskId = randomUUID(), familyId = randomUUID(), operationId = randomUUID();
  const service = createWorkspaceVmExportService({
    home: join(base, 'exports'), workspaceService: workspace, protectedRoots: [protectedRoot],
    async validateScope(scope: { taskId: string; generation: number }) {
      if (scope.taskId !== taskId || scope.generation !== 1) throw new Error('stale task');
      return { id: taskId, familyId, generation: 1 };
    },
    async validateIntent() {},
    async readCandidate() { return bytes; },
  });
  const scope = { taskId, generation: 1 };
  const prepare = (destinationPath: string) => service.prepare({ scope, workspaceId: selected.id, destinationPath, operationId,
    candidatePath: 'result.csv', candidateSha256: sha(bytes), explicitUserAction: true });
  const request = (review: { reviewId: string; reviewDigest: string }) => ({ scope: { ...scope, toolCallId: 'export-' + randomUUID() }, tool: 'vm-shell/export',
    arguments: { reviewId: review.reviewId, reviewDigest: review.reviewDigest }, idempotencyKey: randomUUID() });
  return { root, scope, service, prepare, request, async close() { await service.destroy(); rmSync(base, { recursive: true, force: true }); } };
}

const mac = process.platform === 'darwin' ? describe : describe.skip;
mac('VM export review listing and protected destinations', () => {
  test('a review consumed by an accepted export is no longer listed for discovery, while its receipt stays listed', async () => {
    const f = await fixture();
    try {
      const used = await f.prepare('first.csv'), fresh = await f.prepare('second.csv');
      expect(f.service.list(f.scope).reviews.map((row: { reviewId: string }) => row.reviewId).sort()).toEqual([used.reviewId, fresh.reviewId].sort());
      expect((await f.service.execute(f.request(used))).state).toBe('completed');
      const listed = f.service.list(f.scope);
      expect(listed.reviews.map((row: { reviewId: string }) => row.reviewId)).toEqual([fresh.reviewId]);
      expect(listed.receipts).toEqual([expect.objectContaining({ state: 'completed', result: expect.objectContaining({ reviewId: used.reviewId }) })]);
    } finally { await f.close(); }
  });

  test('a protected root is refused under any letter case on a case-insensitive volume', async () => {
    const f = await fixture();
    try {
      for (const destination of ['private-profile/x.csv', 'PRIVATE-PROFILE/x.csv', 'Private-Profile/x.csv']) {
        await expect(f.prepare(destination)).rejects.toThrow();
      }
      expect(existsSync(join(f.root, 'Private-Profile', 'x.csv'))).toBe(false);
      expect((await f.prepare('public.csv')).destinationPath).toBe('public.csv');
    } finally { await f.close(); }
  });
});
