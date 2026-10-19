import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentToolsComposition } from '../src/agent-tools/composition';

test('scoped Python build status refuses an API-valid named task before selection and retains the UUID picker capability', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-build-scope-status-')));
  let selections = 0;
  const composition = new AgentToolsComposition({ home, authorize: () => true, isScopeActive: () => true,
    resolvePythonBuildSelection: async () => { selections++; throw new Error('Status must not resolve source bytes'); } });
  const read = async (taskId?: string) => {
    const response = await composition.handle(new Request('http://localhost/admin/agent-tools', { method: 'POST',
      body: JSON.stringify({ action: 'pythonBuildStatus', ...(taskId ? { scope: { taskId, generation: 1, toolCallId: 'script-workspace-selection' } } : {}) }) }));
    expect(response?.status).toBe(200);
    return (await response!.json() as { value: { selectionAvailable: boolean; reason?: string } }).value;
  };
  try {
    expect(await read('qa-local-python-picker-r2')).toMatchObject({ selectionAvailable: false,
      reason: 'python-build-task-scope-unsupported' });
    expect((await read(crypto.randomUUID())).selectionAvailable).toBe(true);
    expect((await read()).selectionAvailable).toBe(true);
    expect(selections).toBe(0);
  } finally { await composition.close(); rmSync(home, { recursive: true, force: true }); }
});
