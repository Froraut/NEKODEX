import { test, expect } from 'bun:test';
import { randomUUID, createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationHistoryStore } from '../src/conversation-history';
import { conversationHistoryRequest } from '../src/conversation-history/http';
import { createOwnedNativeExecutionPort } from '../src/agent-mode/native-provider';
import { AGENT_NATIVE_PROTOCOL, nativeScopeOf, nativeDigest } from '../src/agent-mode/native-protocol';
const require = createRequire(import.meta.url);

test('owned history HTTP derives source authority and exposes consent without a capture-text action', async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'owned-history-http-'))), store = new ConversationHistoryStore({ coreHome: home });
  const taskId = randomUUID(), taskScope = { familyId: taskId, generation: 1, revision: 1 };
  const source = { taskId, generation: 1, sourceId: 'b'.repeat(64), profileId: randomUUID(), backendAccountId: 'fixture-account', authEpoch: randomUUID() };
  let visible = true;
  const ask = async (body: unknown) => {
    const response = await conversationHistoryRequest(new Request('http://localhost/admin/conversation-history', { method: 'POST', body: JSON.stringify(body) }), () => store,
      { resolveOwnedNativeScope: input => { if (input.taskId !== taskId || JSON.stringify(input.scope) !== JSON.stringify(taskScope)) throw new Error('Stale history task scope'); return visible ? source : null; } });
    return { status: response.status, value: await response.json() as any };
  };
  try {
    const body = { taskId, scope: taskScope };
    expect((await ask({ action: 'owned-native-status', ...body })).value.value).toMatchObject({ available: true, recordingEnabled: false, enabled: false });
    await ask({ action: 'set-recording', enabled: true, consent: true });
    expect((await ask({ action: 'owned-native-consent', ...body, enabled: true })).status).toBe(400);
    const granted = await ask({ action: 'owned-native-consent', ...body, enabled: true, consent: true, acknowledgeUnknownSecrets: true });
    expect(granted.value.value).toMatchObject({ enabled: true, recordingEnabled: true, scope: source });
    expect((await ask({ action: 'owned-native-consent', ...body, enabled: true, consent: true, acknowledgeUnknownSecrets: true, sourceId: 'foreign-source' })).status).toBe(400);
    expect((await ask({ action: 'owned-native-record', ...body, text: 'not an admitted capture' })).status).toBe(400);
    expect((await ask({ action: 'owned-native-status', taskId, scope: { ...taskScope, generation: 2 } })).status).toBe(400);
    const unowned = await conversationHistoryRequest(new Request('http://localhost/admin/conversation-history', { method: 'POST', body: JSON.stringify({ action: 'owned-native-consent', ...body, enabled: false }) }), () => store);
    expect(unowned.status).toBe(400);
    expect(store.ownedNative.status(source).enabled).toBe(true);
    visible = false;
    expect((await ask({ action: 'owned-native-status', ...body })).value.value.enabled).toBeUndefined();
    const revoked = await ask({ action: 'owned-native-consent', ...body, enabled: false });
    expect(revoked.value.value).toMatchObject({ available: false, enabled: false, revokedScopes: 1 });
    visible = true;
    expect((await ask({ action: 'owned-native-status', ...body })).value.value.enabled).toBe(false);
    const alternateSource = { ...source, sourceId: 'a'.repeat(64), authEpoch: randomUUID() };
    store.ownedNative.setConsent({ scope: alternateSource, enabled: true, consent: true, acknowledgeUnknownSecrets: true });
    await ask({ action: 'owned-native-consent', ...body, enabled: true, consent: true, acknowledgeUnknownSecrets: true });
    expect((await ask({ action: 'owned-native-consent', ...body, enabled: false })).value.value).toMatchObject({ available: true, enabled: false, revokedScopes: 2 });
    expect(store.ownedNative.status(alternateSource).enabled).toBe(false);
    expect(store.status().totalMessages).toBe(0);
  } finally { store.close(); rmSync(home, { recursive: true, force: true }); }
});

test('privacy revocation remains available during a launcher transition and cannot grant recording', async () => {
  const { registerConversationHistory } = require('../launcher/electron/ipc/conversation-history.cjs');
  const { createLifecycleAdmission } = require('../launcher/electron/lifecycle-admission.cjs');
  const gate = createLifecycleAdmission(), handlers = new Map<string, Function>(), sent: any[] = [];
  registerConversationHistory({ handle: (name: string, fn: Function) => handlers.set(name, gate.guard(name, fn)),
    runtimeHost: { supervisor: { readConfig: () => ({}), ownedAgentRuntimeReady: async (_config: unknown, options: any) => options.allowDraining,
      control: async (_config: unknown, _action: string, input: any) => { sent.push(input.body); return { ok: true, value: { enabled: false } }; } } }, clipboard: {}, dialog: {} });
  const lease = gate.acquire('fixture transition');
  try {
    expect(() => handlers.get('launcher:conversation-history')!(null, { action: 'owned-native-consent', enabled: true })).toThrow('Wait for');
    expect(() => handlers.get('launcher:conversation-history-revoke')!(null, { action: 'owned-native-consent', enabled: true })).toThrow('only revokes');
    expect(sent).toHaveLength(0);
    expect(await handlers.get('launcher:conversation-history-revoke')!(null, { action: 'owned-native-consent', enabled: false })).toEqual({ enabled: false });
    expect(sent).toEqual([{ action: 'owned-native-consent', enabled: false }]);
  } finally { gate.release(lease); }
});

test('Native history excludes tool requests and forged references while capture failure preserves completed inference', async () => {
  const source = { sourceId: 'c'.repeat(64), profileId: randomUUID(), backendAccountId: 'fixture-account', authEpoch: randomUUID() };
  let leased = 0, released = 0, captures = 0;
  for (const kind of ['tool', 'forged-reference', 'capture-failure'] as const) {
    const taskId = randomUUID(), dispatchId = randomUUID();
    const request: any = { task: { id: taskId, familyId: taskId, generation: 1, revision: 1, originalRequest: 'Synthetic privacy boundary', corrections: [], requirements: [],
      execution: { provider: 'owned-native', model: 'fixture-model', admissionId: 'fixture-admission' }, bounds: { maxSpend: null } },
      worker: { id: randomUUID() }, dispatch: { id: dispatchId, ownerId: 'fixture-owner' }, stage: { id: 's1', instruction: 'Synthetic result' }, messages: [], history: [], signal: new AbortController().signal };
    const port = createOwnedNativeExecutionPort({ models: () => [{ id: 'fixture-model', provider: 'owned-native', admissionId: 'fixture-admission', available: true, historySource: source }],
      claimTransport() {}, tools: { discover: async () => [{ id: 'fixture/echo', supported: true, inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'], additionalProperties: false } }] as any },
      history: { lease(scope, offer) { leased++; return { lease: { leaseId: randomUUID(), scope, dispatchId: offer.dispatchId, consentRevision: 1, recordingEpoch: 1, policyVersion: 'owned-native-final-summary-v1' }, status: {} as any }; },
        recordFinal() { captures++; throw new Error('Injected history-only storage failure'); }, release(lease) { if (lease) released++; } },
      bridge: { async offer(envelope, observer) {
        const assistantText = JSON.stringify(kind === 'tool' ? { protocol: AGENT_NATIVE_PROTOCOL, kind: 'tool_request', requestId: 'r1', toolId: 'fixture/echo', argumentsJson: '{"text":"synthetic"}', summary: null }
          : { protocol: AGENT_NATIVE_PROTOCOL, kind: 'final', requestId: null, toolId: null, argumentsJson: null, summary: 'Synthetic final summary' });
        const receipt: any = { version: 1, actionId: dispatchId, scope: nativeScopeOf(request), model: envelope.model, admissionId: envelope.admissionId, outputSchemaId: envelope.outputSchemaId,
          payloadDigest: nativeDigest(envelope), revision: 1, state: 'completed', ownerHeld: false, writeDisposition: 'written', workerBindingId: 'fixture-binding', workerGeneration: 1,
          nativeTurnReceiptId: 'native-turn:fixture', acceptanceReceipt: 'native-accept:fixture', inputAuthorship: 'automatic-host', assistantText,
          canonicalFinal: { source, messageId: randomUUID(), turnId: randomUUID(), threadId: randomUUID(), timestampMs: 1000,
            rawTextSha256: kind === 'forged-reference' ? '0'.repeat(64) : createHash('sha256').update(assistantText).digest('hex') } };
        observer.onReceipt(receipt); return receipt;
      }, async readReceipt() { throw new Error('No replay/receipt lookup expected'); }, async waitReceipt() { throw new Error('No extra offer expected'); } } });
    const outcome = await port.execute(request, () => {});
    expect(outcome.outcome).toBe(kind === 'tool' ? 'awaiting_input' : 'completed');
    if (kind === 'tool') expect(outcome.continuation?.pending[0]).toMatchObject({ requestId: 'r1', tool: 'fixture/echo', arguments: { text: 'synthetic' } });
  }
  expect([leased, released, captures]).toEqual([3, 3, 1]);
});
