import { test, expect } from 'bun:test';
import { mkdtempSync, chmodSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createLauncherVmExportBridge } from '../src/execution-environments/launcher-export';
const { createAgentVmExportDescriptorPublisher } = createRequire(import.meta.url)('../launcher/electron/agent-vm-descriptor.cjs');

test('lost export acknowledgement consumes one offer; exact receipt survives main instance change', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'neko-export-bridge-')));
  try {
    chmodSync(home, 0o700);
    const options = { coreHome: home, profile: 'development', control: { endpoint: 'http://127.0.0.1:12345', token: 'x'.repeat(48) } };
    const first = createAgentVmExportDescriptorPublisher(options); first.publish();
    const scope = { taskId: randomUUID(), generation: 1 }, reviewId = randomUUID(), digest = 'a'.repeat(64);
    const review = { reviewId, reviewDigest: digest, scope: { ...scope, familyId: randomUUID() }, workspaceId: randomUUID(), destinationPath: 'out.csv',
      operationId: randomUUID(), candidatePath: 'result.csv', candidateSha256: 'b'.repeat(64), bytes: 3, expectedRevision: null, currentSha256: null, currentBytes: 0 };
    const requests: Array<{ url: string; body: unknown; instance: string | null }> = [];
    const bridge = createLauncherVmExportBridge({ descriptorPath: first.path, expectedProfile: 'development', fetch: (async (url, init) => {
      const headers = new Headers(init?.headers), instance = headers.get('x-nekodex-vm-export-instance');
      requests.push({ url: String(url), body: JSON.parse(String(init?.body)), instance });
      expect(init?.redirect).toBe('error'); expect((init as { proxy: string }).proxy).toBe('');
      expect(headers.get('authorization')).toBe('Bearer ' + 'x'.repeat(48));
      if (String(url).endsWith('/execute')) throw new Error('private transport detail');
      const value = String(url).endsWith('/list') ? { reviews: [review], receipts: [] }
        : { state: 'completed', result: { reviewId, reviewDigest: digest, receiptId: randomUUID(), ownerHeld: false } };
      return Response.json({ ok: true, instanceId: instance, value });
    }) as typeof fetch });
    const request = { scope: { ...scope, toolCallId: 'call-1' }, tool: 'vm-shell/export', arguments: { reviewId, reviewDigest: digest }, idempotencyKey: 'export-1' };
    expect(await bridge.execute(request)).toEqual({ state: 'failed', reason: 'vm-export-not-sent', result: { ownerHeld: false } });
    expect(requests.length).toBe(0);
    expect((await bridge.list(scope)).reviews).toEqual([review]);
    await expect(bridge.execute(request)).rejects.toThrow('reconcile the exact request');
    await expect(bridge.execute(request)).rejects.toThrow('already consumed');
    expect(requests.filter(r => r.url.endsWith('/execute')).length).toBe(1);
    const replacement = createAgentVmExportDescriptorPublisher(options); replacement.publish();
    expect(replacement.instanceId).not.toBe(first.instanceId);
    expect((await bridge.receipt(request))?.state).toBe('completed');
    expect(requests.at(-1)?.instance).toBe(replacement.instanceId);
    const other = { ...request, scope: { ...request.scope, toolCallId: 'call-2' }, idempotencyKey: 'export-2' };
    expect((await bridge.execute(other)).state).toBe('failed');
    expect(requests.filter(r => r.url.endsWith('/execute')).length).toBe(1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('descriptor profile and response scope mismatch are rejected before export', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'neko-export-bridge-')));
  try {
    chmodSync(home, 0o700);
    const descriptor = createAgentVmExportDescriptorPublisher({ coreHome: home, profile: 'development', control: { endpoint: 'http://127.0.0.1:12345', token: 'x'.repeat(48) } }); descriptor.publish();
    let calls = 0;
    const fixture = (async () => { calls++; return Response.json({ ok: true, instanceId: randomUUID(), value: { reviews: [], receipts: [] } }); }) as typeof fetch;
    const wrong = createLauncherVmExportBridge({ descriptorPath: descriptor.path, expectedProfile: 'production', fetch: fixture });
    await expect(wrong.list({ taskId: randomUUID(), generation: 1 })).rejects.toThrow(); expect(calls).toBe(0);
    const bridge = createLauncherVmExportBridge({ descriptorPath: descriptor.path, expectedProfile: 'development', fetch: fixture });
    await expect(bridge.list({ taskId: randomUUID(), generation: 1 })).rejects.toThrow('response unavailable'); expect(calls).toBe(1);
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('listed export receipts retain exact reconciliation request and reject another task', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'neko-export-bridge-')));
  try {
    chmodSync(home, 0o700);
    const descriptor = createAgentVmExportDescriptorPublisher({ coreHome: home, profile: 'development', control: { endpoint: 'http://127.0.0.1:12345', token: 'x'.repeat(48) } }); descriptor.publish();
    const scope = { taskId: randomUUID(), generation: 2 }, reviewId = randomUUID(), reviewDigest = 'c'.repeat(64);
    const request = { scope: { ...scope, toolCallId: 'export-for-reconcile' }, tool: 'vm-shell/export', arguments: { reviewId, reviewDigest }, idempotencyKey: 'same-exact-export' };
    let value: unknown = { reviews: [], receipts: [{ state: 'outcome_unknown', result: { reviewId, ownerHeld: true }, request }] };
    const bridge = createLauncherVmExportBridge({ descriptorPath: descriptor.path, expectedProfile: 'development', fetch: (async (_url, init) => Response.json({
      ok: true, instanceId: new Headers(init?.headers).get('x-nekodex-vm-export-instance'), value,
    })) as typeof fetch });
    expect((await bridge.list(scope)).receipts[0]?.request).toEqual(request);
    // A later task generation may reconcile the exact older request; it never
    // turns that older request into a current-generation prepared review.
    expect((await bridge.list({ ...scope, generation: 3 })).receipts[0]?.request).toEqual(request);
    await expect(bridge.list({ ...scope, generation: 1 })).rejects.toThrow('listed receipt scope differs');
    value = { reviews: [], receipts: [{ state: 'outcome_unknown', result: { reviewId, ownerHeld: true }, request: { ...request, scope: { ...request.scope, taskId: randomUUID() } } }] };
    await expect(bridge.list(scope)).rejects.toThrow('listed receipt scope differs');
    value = { state: 'outcome_unknown', result: { reviewId, ownerHeld: true }, request };
    await expect(bridge.receipt(request)).rejects.toThrow();
  } finally { rmSync(home, { recursive: true, force: true }); }
});
