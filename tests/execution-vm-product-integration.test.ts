import { expect, test } from 'bun:test';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentToolsComposition } from '../src/agent-tools/composition';
import type { VmNetworkGrant } from '../src/execution-environments/network';

test('explicit network HTTP grant reaches the separately approved ToolJournal builtin and retains outcome without network replay', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'neko-network-product-')));
  const scope = { taskId: 'network-product-task', generation: 1, toolCallId: 'network-call' };
  let sends = 0, active = true, grant: VmNetworkGrant;
  const composition = new AgentToolsComposition({ home, authorize: () => true, isScopeActive: current => active && current.taskId === scope.taskId && current.generation === 1,
    resolveToolCall: () => ({ tool: 'vm-network/request', idempotencyKey: 'exact-network-call', arguments: { grantId: grant.id, actionId: 'explicit-action', url: 'https://example.invalid/data', method: 'GET' } }),
    vmNetworkTransport: { async request(hop) { sends++; expect(hop.address).toBe('8.8.8.8'); return { statusCode: 200, body: Buffer.from('selected network result') }; } },
  });
  const action = async (body: unknown) => { const response = await composition.handle(new Request('http://localhost/admin/agent-tools', { method: 'POST', body: JSON.stringify(body) })); return { status: response!.status, body: await response!.json() as any }; };
  try {
    expect(composition.vmNetworkStatus(scope).grants).toEqual([]);
    const reviewed = await action({ action: 'grantVmNetwork', input: { scope: { taskId: scope.taskId, generation: 1, actionId: 'explicit-action' },
      destinations: [{ origin: 'https://example.invalid', addresses: ['8.8.8.8'], methods: ['GET'] }],
      credentialOwner: 'none', dns: 'pinned-no-lookup', proxy: 'none', maxRequests: 1, maxRequestBytes: 4096, maxResponseBytes: 4096, maxRedirects: 0, timeoutMs: 1000 }, explicitUserAction: true });
    expect(reviewed.status).toBe(200); grant = reviewed.body.value;
    expect(sends).toBe(0); expect(composition.vmNetworkStatus().guestNic).toBe(false);
    const descriptors = await composition.toolsPort.discover(scope); expect(descriptors.some(row => row.id === 'vm-network/request')).toBe(true);
    const approved = await action({ action: 'approveInvoke', scope, explicitUserAction: true });
    expect(approved.status).toBe(200); expect(approved.body.value.state).toBe('completed');
    expect(approved.body.value.result.response.bodyBase64).toBe(Buffer.from('selected network result').toString('base64'));
    expect(composition.receipt('exact-network-call')?.state).toBe('completed'); expect(sends).toBe(1);
    await action({ action: 'approveInvoke', scope, explicitUserAction: true }); expect(sends).toBe(1);
    composition.invalidateTaskTools(scope.taskId); active = false;
    expect(composition.vmNetworkStatus(scope).grants[0]?.revoked).toBe(true);
    await expect(composition.toolsPort.discover(scope)).rejects.toThrow('scope is unavailable'); expect(sends).toBe(1);
  } finally { await composition.close(); rmSync(home, { recursive: true, force: true }); }
});

test('Python HTTP review forwards explicit requirements but refuses renderer build bytes and host authority', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'neko-python-product-')));
  const composition = new AgentToolsComposition({ home, authorize: () => true, isScopeActive: () => true });
  const seen: unknown[] = [];
  composition.reviewPythonEnvironment = (...args) => { seen.push(args); return {} as never; };
  const actionId = crypto.randomUUID(), digest = 'a'.repeat(64), directArtifacts = [{ url: 'https://example.invalid/selected.whl', artifactSha256: digest }];
  const action = (body: unknown) => composition.handle(new Request('http://localhost/admin/agent-tools', { method: 'POST', body: JSON.stringify(body) }));
  try {
    const accepted = await action({ action: 'reviewPythonEnvironment', actionId, wheelPaths: ['/selected/example.whl'], requirements: ['demo[extra]>=1'], directArtifacts, explicitUserAction: true });
    expect(accepted?.status).toBe(200); expect(seen).toEqual([[actionId, ['/selected/example.whl'], true, { requirements: ['demo[extra]>=1'], directArtifacts }]]);
    const refused = await action({ action: 'reviewPythonBuild', actionId, scope: { taskId: 'task', generation: 1, toolCallId: 'build' }, selectionId: crypto.randomUUID(), selection: { source: '/host/source' }, explicitUserAction: true });
    expect(refused?.status).toBe(400); expect(seen.length).toBe(1);
    expect(composition.pythonBuildStatus().selectionAvailable).toBe(false);
  } finally { await composition.close(); rmSync(home, { recursive: true, force: true }); }
});
