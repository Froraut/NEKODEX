import { expect, test } from 'bun:test';
import { createHash, randomUUID } from 'node:crypto';
import { createAgentNativeBridge, compileAgentNativeOutputSchema } from '../launcher/electron/agent-native-bridge.cjs';
import { AGENT_NATIVE_PROTOCOL, AGENT_NATIVE_OUTPUT_SCHEMA, AGENT_NATIVE_OUTPUT_SCHEMA_ID, AGENT_NATIVE_OUTPUT_SCHEMA_HASH } from '../launcher/electron/agent-native-protocol.cjs';
import type { AgentNativeOfferEnvelope, AgentNativeReceipt } from '../src/agent-mode/native-protocol';

const digest = (value: unknown) => createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const payload = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const canonical = (value: any): string => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : value && typeof value === 'object'
  ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);

test('main Native bridge binds durable claims, one owned sender, held late receipts and generation-fenced retirement', async () => {
  let allowed = true, admitted = true, running = true, validations = 0, factories = 0, creates = 0, offers = 0, retirements = 0, destroys = 0;
  let holdNextCreation = false, releaseCreation: (() => void) | undefined, creationStarted: (() => void) | undefined;
  const journals = new Map<string, any>(); const services: any[] = [];
  const finalText = JSON.stringify({ protocol: AGENT_NATIVE_PROTOCOL, kind: 'final', requestId: null, toolId: null, argumentsJson: null, summary: 'Matched canonical fixture result' });
  const options = {
    canStart: () => running,
    validateOffer: async (e: AgentNativeOfferEnvelope, hash: string) => { validations++; return allowed ? { scope: e.scope, payloadDigest: hash, claimId: 'durable-fixture-claim' } : false; },
    resolveAdmission: () => admitted ? { createWorker(binding: any, notify: (row: any) => void) {
      factories++; const journal = journals.get(binding.workerBindingId) ?? { rows: [] }; journals.set(binding.workerBindingId, journal);
      let owned = false, handle: string | null = null, thread: string | null = null, active: any;
      const snapshot = () => ({ availability: { available: true }, storageOwner: owned ? 'current' : 'unclaimed', receipts: structuredClone(journal.rows), workerHandle: handle });
      const update = (row: any, changes: any) => { Object.assign(row, changes); row.observations.push({ state: row.state, ownerHeld: row.ownerHeld, turnId: row.turnId, timestampMs: Date.now() }); notify(structuredClone(row)); return structuredClone(row); };
      const service: any = {
        holdNext: true, binding, journal,
        inspectOwnedWorker: snapshot,
        async createOwnedWorker({ actionId }: any) {
          creates++; owned = true; handle = randomUUID(); thread = randomUUID();
          const row = { actionId, kind: 'create', workerHandle: handle, threadId: thread, admissionId: 'admitted-fixture', state: 'completed', ownerHeld: false };
          journal.rows.push(row); notify(row);
          if (holdNextCreation) { holdNextCreation = false; creationStarted?.(); await new Promise<void>(resolve => { releaseCreation = resolve; }); }
          return { workerHandle: handle, threadId: thread, admissionId: 'admitted-fixture', receipt: row };
        },
        async offerOwnedTurn({ workerHandle, actionId, text, outputSchema }: any) {
          offers++; expect(workerHandle).toBe(handle); expect(compileAgentNativeOutputSchema(outputSchema)(JSON.parse(finalText))).toBe(true);
          const row: any = { actionId, kind: 'offer', workerHandle, threadId: thread, admissionId: 'admitted-fixture', inputHash: digest(text), schemaHash: digest(canonical(outputSchema)),
            state: 'prepared', ownerHeld: false, turnId: null, inputAuthorship: 'automatic-host', observations: [] };
          journal.rows.push(row); active = row;
          update(row, {}); const prepared = structuredClone(row);
          update(row, { state: 'offered', ownerHeld: true }); update(row, { state: 'acknowledged', turnId: randomUUID() });
          service.emitOlder = () => notify(prepared);
          service.complete = () => {
            const canonicalItems = [{ messageId: randomUUID(), turnId: row.turnId, role: 'user', authorship: 'automatic-host', text, timestampMs: Date.now() },
              { messageId: randomUUID(), turnId: row.turnId, role: 'assistant', authorship: 'native-assistant', phase: 'final_answer', text: finalText, timestampMs: Date.now() }];
            const result = update(row, { state: 'completed', ownerHeld: false, canonicalItems, structuredOutput: { summary: 'Untrusted alternate metadata must not become assistantText' } }); active = undefined; return result;
          };
          if (service.holdNext) { service.holdNext = false; return update(row, { state: 'unknown', ownerHeld: true }); }
          return service.complete();
        },
        async retireOwnedWorker({ workerHandle, actionId }: any) {
          retirements++; expect(workerHandle).toBe(handle); expect(journal.rows.some((row: any) => row.actionId === actionId)).toBe(false);
          for (const row of journal.rows) if (row.kind === 'offer') update(row, { retired: true, ...(row.ownerHeld ? { state: 'unknown', ownerHeld: false } : {}) });
          active = undefined; return snapshot();
        },
        currentOperation: () => active?.ownerHeld ? 'exact fixture owner retained' : null,
        async destroy() { destroys++; owned = false; },
      };
      services.push(service); return service;
    } } : undefined,
    waitMs: 5,
  };
  const bridge = createAgentNativeBridge(options);
  const envelope = (generation = 1): AgentNativeOfferEnvelope => {
    const actionId = randomUUID(); return { version: 1, protocol: AGENT_NATIVE_PROTOCOL, actionId,
      scope: { taskId: 'task', familyId: 'family', generation, revision: generation, dispatchId: actionId, ownerId: 'bun-owner', agentWorkerId: 'agent-worker' },
      model: 'fixture-model', admissionId: 'admitted-fixture', outputSchemaId: AGENT_NATIVE_OUTPUT_SCHEMA_ID, outputSchemaHash: AGENT_NATIVE_OUTPUT_SCHEMA_HASH,
      authorship: 'automatic-host', text: JSON.stringify({ protocol: AGENT_NATIVE_PROTOCOL, authorship: 'automatic-host', text: 'bounded inert model context' }), continuation: null };
  };
  const lookup = (e: AgentNativeOfferEnvelope) => ({ actionId: e.actionId, scope: e.scope, payloadDigest: payload(e) });
  try {
    expect(() => compileAgentNativeOutputSchema({ ...AGENT_NATIVE_OUTPUT_SCHEMA, additionalProperties: true })).toThrow('fixed');
    const denied = envelope(); allowed = false; expect((await bridge.offer(denied)).state).toBe('not_sent'); expect(factories).toBe(0);
    allowed = true; admitted = false; expect((await bridge.offer(envelope())).state).toBe('not_sent'); expect(factories).toBe(0); admitted = true;
    running = false; const beforeGate = validations; expect((await bridge.offer(envelope())).state).toBe('not_sent'); expect(validations).toBe(beforeGate); running = true;
    const first = envelope(); const callbacks: AgentNativeReceipt[] = [];
    await expect(bridge.offer({ ...first, nativeThreadId: randomUUID() } as any)).rejects.toThrow('closed');
    await expect(bridge.offer({ ...first, outputSchemaHash: '0'.repeat(64) })).rejects.toThrow('closed');
    await expect(bridge.offer(first, { payloadDigest: '0'.repeat(64) })).rejects.toThrow('digest');
    expect(factories).toBe(0);
    const held = await bridge.offer(first, { payloadDigest: payload(first), onReceipt: row => callbacks.push(row) });
    expect(callbacks[0]).toMatchObject({ state: 'prepared', ownerHeld: false, writeDisposition: 'not-written', workerBindingId: null });
    expect(held).toMatchObject({ state: 'unknown', ownerHeld: true, writeDisposition: 'written', inputAuthorship: 'automatic-host' });
    expect(held.acceptanceReceipt).not.toBeNull(); expect(held.nativeTurnReceiptId).not.toBeNull();
    expect(factories).toBe(1); expect(creates).toBe(1); expect(offers).toBe(1); expect(bridge.status().activeCount).toBe(1);
    expect(journals.get(held.workerBindingId!)!.rows[0].actionId).not.toBe(first.actionId);
    expect(Object.keys(services[0].binding).sort()).toEqual(['admissionId', 'agentWorkerId', 'familyId', 'generation', 'model', 'taskId', 'workerBindingId', 'workerGeneration'].sort());
    expect(await bridge.offer(first)).toEqual(held); expect(offers).toBe(1);
    await expect(bridge.offer({ ...first, text: 'changed payload' })).rejects.toThrow('conflict');
    await expect(bridge.readReceipt({ ...lookup(first), payloadDigest: '1'.repeat(64) })).rejects.toThrow('conflict');
    const copied = await bridge.readReceipt(lookup(first)); copied!.ownerHeld = false; expect((await bridge.readReceipt(lookup(first)))!.ownerHeld).toBe(true);
    services[0].emitOlder(); expect((await bridge.readReceipt(lookup(first)))!.revision).toBe(held.revision);
    const cancelled = new AbortController(); const observing = bridge.waitReceipt({ ...lookup(first), afterRevision: held.revision }, { signal: cancelled.signal });
    cancelled.abort(); await expect(observing).rejects.toBeDefined(); expect(destroys).toBe(0); expect(retirements).toBe(0);
    expect(await bridge.waitReceipt({ ...lookup(first), afterRevision: held.revision })).toBeUndefined(); expect(offers).toBe(1);
    const waiting = bridge.waitReceipt({ ...lookup(first), afterRevision: held.revision }); services[0].complete(); const terminal = (await waiting)!;
    expect(terminal).toMatchObject({ state: 'completed', ownerHeld: false, assistantText: finalText }); expect(terminal.revision).toBeGreaterThan(held.revision);
    expect(callbacks.some(row => row.state === 'acknowledged')).toBe(true); expect(bridge.status().activeCount).toBe(0);
    const second = envelope(); second.continuation = { workerBindingId: terminal.workerBindingId!, workerGeneration: terminal.workerGeneration!, previousNativeTurnReceiptId: terminal.nativeTurnReceiptId! };
    const secondResult = await bridge.offer(second); expect(secondResult.state).toBe('completed'); expect(creates).toBe(1); expect(offers).toBe(2);
    const stale = envelope(); stale.continuation = second.continuation; expect((await bridge.offer(stale)).state).toBe('not_sent'); expect(offers).toBe(2);
    const newer = envelope(2); const newHeld = await bridge.offer(newer); expect(creates).toBe(2); expect(newHeld.ownerHeld).toBe(true);
    await bridge.invalidateTask('task', { familyId: 'family', beforeGeneration: 2 });
    expect(retirements).toBe(1); expect(destroys).toBe(1); expect((await bridge.readReceipt(lookup(newer)))!.ownerHeld).toBe(true);
    await bridge.invalidateTask('task', { familyId: 'family', beforeGeneration: 2 }); expect(retirements).toBe(1); expect(destroys).toBe(1);
    await bridge.invalidateTask('task', { familyId: 'family', beforeGeneration: 3 });
    expect((await bridge.readReceipt(lookup(newer)))!).toMatchObject({ state: 'unknown', ownerHeld: false }); expect(retirements).toBe(2); expect(destroys).toBe(2);
    holdNextCreation = true;
    const awaitingCreation = new Promise<void>(resolve => { creationStarted = resolve; });
    const revokedDuringStartup = envelope(3); const startupOffers = offers; let initialPrepared: AgentNativeReceipt | undefined;
    const pendingStartup = bridge.offer(revokedDuringStartup, { onReceipt: receipt => { initialPrepared ??= receipt; } });
    await awaitingCreation;
    expect(initialPrepared).toMatchObject({ state: 'prepared', ownerHeld: false, writeDisposition: 'not-written' });
    expect(offers).toBe(startupOffers);
    allowed = false; releaseCreation!();
    expect(await pendingStartup).toMatchObject({ state: 'not_sent', ownerHeld: false, writeDisposition: 'not-written' });
    expect(offers).toBe(startupOffers); allowed = true;
    await bridge.destroy(); expect(offers).toBe(3); expect(bridge.status().activeCount).toBe(0);
    const recreated = createAgentNativeBridge(options); const beforeRestart = { factories, creates, offers };
    expect(await recreated.readReceipt(lookup(first))).toBeUndefined(); expect(factories).toBe(beforeRestart.factories);
    await expect(recreated.waitReceipt({ ...lookup(first), afterRevision: 0 })).rejects.toThrow('owner is unavailable');
    expect(await recreated.offer(first)).toMatchObject({ state: 'unknown', ownerHeld: false, assistantText: undefined });
    expect(creates).toBe(beforeRestart.creates); expect(offers).toBe(beforeRestart.offers); await recreated.destroy();
    const malformed = createAgentNativeBridge({ ...options, resolveAdmission: () => ({ createWorker(binding: any, notify: (row: any) => void) {
      let broken = false;
      const corrupt = (row: any) => row.kind === 'offer' ? { ...row, observations: [] } : row;
      const base = options.resolveAdmission()!.createWorker(binding, row => notify(broken ? corrupt(row) : row));
      return { ...base, async offerOwnedTurn(input: any) {
        const row = await base.offerOwnedTurn(input);
        broken = true; return corrupt(row); // The ACK was valid; subsequent rows cannot project release.
      }, async retireOwnedWorker(input: any) {
        const snapshot = await base.retireOwnedWorker(input);
        return { ...snapshot, receipts: snapshot.receipts.map(corrupt) };
      }, async destroy() {
        expect((await malformed.readReceipt(lookup(malformedOffer)))?.ownerHeld).toBe(true);
        await base.destroy();
      } };
    } }) });
    const malformedOffer = envelope(4);
    try {
      expect(await malformed.offer(malformedOffer)).toMatchObject({ state: 'unknown', ownerHeld: true });
      await malformed.destroy();
      expect(await malformed.readReceipt(lookup(malformedOffer))).toMatchObject({ state: 'unknown', ownerHeld: false, writeDisposition: 'written' });
      expect(malformed.status().activeCount).toBe(0);
    } finally { await malformed.destroy(); }
  } finally { await bridge.destroy(); }
}, 5000);
