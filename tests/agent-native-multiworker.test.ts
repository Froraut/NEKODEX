import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentModeRuntime } from '../src/agent-mode/runtime';
import { AgentModeStore } from '../src/agent-mode/store';
import { createOwnedNativeExecutionPort } from '../src/agent-mode/native-provider';
import { createAgentNativeBridge } from '../launcher/electron/agent-native-bridge.cjs';
import { createAgentNativeDescriptorPublisher } from '../launcher/electron/agent-native-descriptor.cjs';
import { createLauncherNativeBridge } from '../src/agent-mode/launcher-native-bridge';
import { AGENT_NATIVE_PROTOCOL, AGENT_NATIVE_OUTPUT_SCHEMA_ID, AGENT_NATIVE_OUTPUT_SCHEMA_HASH } from '../src/agent-mode/native-protocol';
import type { AgentNativeOfferEnvelope, AgentNativeReceipt } from '../src/agent-mode/native-protocol';
import type { CreateAgentTask } from '../src/agent-mode/types';

const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const canonical = (value: any): string => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const model = 'multiworker-fixture', admissionId = 'multiworker-admission';
const definition = (): CreateAgentTask => ({ id: randomUUID(), ownerMode: 'agent', mode: 'goal', originalRequest: 'Compare two supplied operational inputs and synthesize their findings.',
  requirements: [{ id: 'report', text: 'The briefing reconciles both inputs.' }], stages: [
    { id: 'a', instruction: 'Extract the commitments.', requirementIds: ['report'] },
    { id: 'b', instruction: 'Extract the transport constraints.', requirementIds: ['report'] },
    { id: 'join', instruction: 'Reconcile both findings.', requirementIds: ['report'], dependsOn: ['a', 'b'] },
  ], bounds: { maxConcurrent: 2, maxTurns: 6, maxSpend: null }, execution: { provider: 'owned-native', model, admissionId } });
const envelope = (): AgentNativeOfferEnvelope => { const actionId = randomUUID(); return { version: 1, protocol: AGENT_NATIVE_PROTOCOL, actionId,
  scope: { taskId: 'fixture-task', familyId: 'fixture-family', generation: 1, revision: 1, dispatchId: actionId, ownerId: 'fixture-owner', agentWorkerId: randomUUID() },
  model, admissionId, outputSchemaId: AGENT_NATIVE_OUTPUT_SCHEMA_ID, outputSchemaHash: AGENT_NATIVE_OUTPUT_SCHEMA_HASH,
  authorship: 'automatic-host', text: 'Inert fixture input.', continuation: null }; };
function fixture() {
  const loaded = new Set<string>(), offers: any[] = [], closes: string[] = [], retirements: string[] = [];
  const started = gate(), unloading = gate(), modelReplies = gate(), closeAllowed = gate();
  let held = false, failUnload = false, replyKind: 'final' | 'tool_request' | 'awaiting_input' = 'final';
  const bridge = createAgentNativeBridge({ canStart: () => true, validateOffer: () => true, waitMs: 20,
    resolveAdmission: () => ({ createWorker(binding, notify) {
      let handle: string | null = null, thread: string | null = null; const rows: any[] = [];
      const snapshot = () => ({ availability: { available: true }, storageOwner: handle ? 'current' : 'unclaimed', workerHandle: handle, receipts: structuredClone(rows) });
      const update = (row: any, changes: any) => { Object.assign(row, changes); row.observations.push({ state: row.state, ownerHeld: row.ownerHeld, turnId: row.turnId, timestampMs: Date.now() }); notify(structuredClone(row)); };
      return {
        inspectOwnedWorker: snapshot,
        async createOwnedWorker({ actionId }: any) {
          if (loaded.size >= 2) throw new Error('shared physical capacity');
          handle = randomUUID(); thread = randomUUID(); loaded.add(thread);
          const receipt = { actionId, kind: 'create', workerHandle: handle, threadId: thread, admissionId, state: 'completed', ownerHeld: false }; rows.push(receipt);
          return { workerHandle: handle, threadId: thread, admissionId, receipt };
        },
        async offerOwnedTurn({ actionId, text, outputSchema }: any) {
          const row: any = { actionId, kind: 'offer', workerHandle: handle, threadId: thread, admissionId, inputHash: digest(text), schemaHash: digest(canonical(outputSchema)),
            inputAuthorship: 'automatic-host', state: 'acknowledged', ownerHeld: true, turnId: randomUUID(), observations: [] };
          rows.push(row); offers.push({ binding, thread, row }); update(row, {}); if (offers.length === 2) started.resolve();
          if (held && offers.length <= 2) await modelReplies.promise;
          const answer = JSON.stringify({ protocol: AGENT_NATIVE_PROTOCOL, kind: replyKind, requestId: replyKind === 'tool_request' ? 'call-1' : null,
            toolId: replyKind === 'tool_request' ? 'fixture/read' : null, argumentsJson: replyKind === 'tool_request' ? '{}' : null, summary: replyKind === 'tool_request' ? null : 'Synthetic operational finding.' });
          update(row, { state: 'completed', ownerHeld: false, canonicalItems: [
            { messageId: randomUUID(), turnId: row.turnId, role: 'user', authorship: 'automatic-host', text, timestampMs: Date.now() },
            { messageId: randomUUID(), turnId: row.turnId, role: 'assistant', authorship: 'native-assistant', phase: 'final_answer', text: answer, timestampMs: Date.now() },
          ] }); return structuredClone(row);
        },
        async retireOwnedWorker() { retirements.push(thread!); if (retirements.length === 2 || !held) unloading.resolve(); if (held) await closeAllowed.promise; if (failUnload) throw new Error('unsubscribe unknown'); return snapshot(); },
        currentOperation: () => null,
        async destroy() { if (failUnload) throw new Error('physical subscription still owned'); loaded.delete(thread!); closes.push(thread!); },
      } as any;
    } }) });
  return { bridge, loaded, offers, closes, retirements, started, unloading, modelReplies, closeAllowed,
    hold() { held = true; }, fail(value: boolean) { failUnload = value; }, kind(value: typeof replyKind) { replyKind = value; } };
}
async function terminal(bridge: ReturnType<typeof createAgentNativeBridge>, input: AgentNativeOfferEnvelope, initial: AgentNativeReceipt) {
  const lookup = { actionId: input.actionId, scope: input.scope, payloadDigest: digest(JSON.stringify(input)) };
  let row = initial;
  while (!['completed', 'failed', 'unknown', 'not_sent'].includes(row.state)) row = await bridge.waitReceipt({ ...lookup, afterRevision: row.revision }) ?? row;
  return row;
}

test('Native multiworker joins two physical slot closures before a fresh dependent third binding', async () => {
  const home = mkdtempSync(join(tmpdir(), 'neko-native-join-')), store = new AgentModeStore(join(home, 'tasks.sqlite')), f = fixture(); f.hold();
  const models = () => [{ id: model, provider: 'owned-native' as const, admissionId, available: true, maxConcurrent: 2 }];
  let runtime!: AgentModeRuntime;
  const port = createOwnedNativeExecutionPort({ models, bridge: f.bridge, claimTransport: (request, hash) => runtime.claimNativeTransport(request, hash) });
  runtime = new AgentModeRuntime({ store, models, executionPort: port });
  const task = definition();
  try {
    runtime.create('create', task); runtime.step(task.id!, 'run', { explicitUserAction: true, automatic: true }); await f.started.promise;
    expect(f.loaded.size).toBe(2); expect(new Set(f.offers.map(row => row.thread)).size).toBe(2);
    expect(new Set(f.offers.map(row => row.binding.taskId))).toEqual(new Set([task.id]));
    f.modelReplies.resolve(); await f.unloading.promise;
    expect(f.offers).toHaveLength(2); expect(f.loaded.size).toBe(2);
    expect(store.getTask(task.id!).stages.map(row => row.status)).toEqual(['running', 'running', 'pending']);
    expect(f.bridge.status().receipts.filter(row => row.state === 'completed')).toHaveLength(0);
    f.closeAllowed.resolve(); await runtime.waitForIdle();
    expect(f.offers).toHaveLength(3); expect(f.closes).toHaveLength(3); expect(f.loaded.size).toBe(0);
    expect(new Set(f.offers.map(row => row.binding.workerBindingId)).size).toBe(3);
    expect(store.getTask(task.id!).status).toBe('review_required');
    expect(store.getTask(task.id!).stages.every(row => row.status === 'completed')).toBe(true);
  } finally { f.modelReplies.resolve(); f.closeAllowed.resolve(); runtime.beginShutdown(); await runtime.waitForIdle(); runtime.finishShutdown(); await f.bridge.destroy(); store.close(); rmSync(home, { recursive: true, force: true }); }
}, 5000);

test('Native tool and awaiting-input branches keep their original binding; exact tool continuation retires only its final', async () => {
  const f = fixture();
  try {
    for (const kind of ['awaiting_input', 'tool_request'] as const) {
      f.kind(kind); const input = envelope(), receipt = await f.bridge.offer(input);
      expect(receipt.state).toBe('completed'); expect(f.retirements).toHaveLength(0);
      if (kind === 'tool_request') {
        f.kind('final'); const next = { ...input, actionId: randomUUID(), scope: { ...input.scope, dispatchId: '' }, continuation: { workerBindingId: receipt.workerBindingId!, workerGeneration: receipt.workerGeneration!, previousNativeTurnReceiptId: receipt.nativeTurnReceiptId! } };
        next.scope.dispatchId = next.actionId;
        const final = await terminal(f.bridge, next, await f.bridge.offer(next));
        expect(final.state).toBe('completed'); expect(f.retirements).toHaveLength(1); expect(f.loaded.size).toBe(1);
        expect(f.offers[1]!.binding).toEqual(f.offers[2]!.binding);
      }
    }
  } finally { await f.bridge.destroy(); }
}, 5000);

test('Native failed terminal unload retains unknown ownership and canonical leaf result without another offer', async () => {
  const f = fixture(); f.fail(true);
  try {
    const input = envelope(), result = await terminal(f.bridge, input, await f.bridge.offer(input));
    expect(result).toMatchObject({ state: 'unknown', ownerHeld: true, writeDisposition: 'written' });
    expect(result.assistantText).toBeUndefined(); expect(f.loaded.size).toBe(1);
    expect(f.offers[0].row.canonicalItems.at(-1).text).toContain('Synthetic operational finding');
    expect(await f.bridge.offer(input)).toEqual(result); expect(f.offers).toHaveLength(1);
    expect((await f.bridge.offer(envelope())).state).toBe('not_sent'); expect(f.offers).toHaveLength(1);
    expect(f.bridge.status().activeCount).toBeGreaterThan(0);
  } finally { f.fail(false); await f.bridge.destroy(); }
}, 5000);

test('Native exact model capacity survives descriptor parsing; absent legacy capability and oversized bounds fail closed', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'neko-native-cap-'))), store = new AgentModeStore(join(home, 'tasks.sqlite'));
  const publisher = createAgentNativeDescriptorPublisher({ coreHome: home, profile: 'development', control: { endpoint: 'http://127.0.0.1:12345', token: 'a'.repeat(48) } });
  const client = createLauncherNativeBridge({ descriptorPath: publisher.path, expectedProfile: 'development' });
  const runtime = new AgentModeRuntime({ store, models: client.models, executionPort: { async execute() { throw new Error('must not send'); } } });
  try {
    publisher.publish({ models: [{ id: model, provider: 'owned-native', admissionId, available: true, maxConcurrent: 2 }], accepting: true });
    expect(client.models()[0]!.maxConcurrent).toBe(2);
    const accepted = definition(); runtime.create('accepted', accepted); expect(store.getTask(accepted.id!).bounds.maxConcurrent).toBe(2);
    const large = definition(); large.bounds.maxConcurrent = 3; expect(() => runtime.create('large', large)).toThrow('capacity');
    publisher.publish({ models: [{ id: model, provider: 'owned-native', admissionId, available: true }], accepting: true });
    expect(() => runtime.create('legacy-parallel', definition())).toThrow('capacity');
    const serial = definition(); serial.bounds.maxConcurrent = 1; runtime.create('legacy-serial', serial);
    expect(store.getTask(serial.id!).bounds.maxConcurrent).toBe(1);
    expect(() => runtime.step(accepted.id!, 'run-after-downgrade', { explicitUserAction: true, automatic: true })).toThrow('capacity');
    expect(() => store.createTask(definition())).toThrow('capacity');
  } finally { runtime.beginShutdown(); await runtime.waitForIdle(); runtime.finishShutdown(); store.close(); rmSync(home, { recursive: true, force: true }); }
}, 5000);
