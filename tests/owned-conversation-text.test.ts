import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { randomUUID, createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtempSync, realpathSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ConversationHistoryStore } from '../src/conversation-history/store';
const require = createRequire(import.meta.url);
const { createOwnedNativeAccountServer } = require('../launcher/electron/owned-native-worker.cjs');
const { createPersistentNativeConversations } = require('../launcher/electron/persistent-native-conversations.cjs');
const { createOwnedNativeTranscriptProducer } = require('../launcher/electron/owned-conversation-transcript.cjs');

async function fixture(recording = true) {
  const home = realpathSync(mkdtempSync(join(tmpdir(), 'neko-owned-text-')));
  const paths = { home: join(home, 'private-home'), codexHome: join(home, 'codex'), cwd: join(home, 'private-home/work') };
  for (const p of Object.values(paths)) mkdirSync(p, { recursive: true, mode: 0o700 });
  const methods: any[] = [], trace: string[] = [], threads = new Map<string, any>(), nativeItems = new Map<string, any[]>();
  const profileId = randomUUID(), epoch = randomUUID(), serverGeneration = randomUUID();
  const historySource = { sourceId: 'c'.repeat(64), profileId, backendAccountId: 'controlled-canonical-account', authEpoch: epoch };
  let service: any, context: any, processClosed = false, holdRecord: (() => Promise<void>) | null = null, beginGate: {entered:()=>void;wait:Promise<void>} | null = null, startGate: {entered:()=>void;wait:Promise<void>} | null = null;
  const admission: any = { paths, historySource, serverGeneration, provider: 'openai',
    prestart: () => ({ executable: '/controlled-inert-worker', args: ['--stdio'], paths, environment: {} }), checkEffective() {}, checkAccount() {},
    forBinding(binding: any) { return { ...admission, modelId: 'controlled-text-model', admissionId: 'a'.repeat(64), imageInput: false,
      paths: { ...paths, journal: join(home, 'journals', binding.workerBindingId) }, availability: () => ({ available: true, reasonCode: null }) }; },
  };
  const account = createOwnedNativeAccountServer({ admission, maxConcurrentThreads: 2, requestTimeoutMs: 300, terminalTimeoutMs: 800, stopGraceMs: 30,
    testHooks: { spawnProcess() {
      const child: any = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
      const answer = (r: any, result: any) => child.stdout.write(JSON.stringify({ id: r.id, result }) + '\n');
      const event = (method: string, params: any) => child.stdout.write(JSON.stringify({ method, params }) + '\n');
      child.stdin = new Writable({ write(bytes, _encoding, done) {
        const r = JSON.parse(bytes.toString()); methods.push(r); trace.push(r.method);
        queueMicrotask(() => {
          if (r.method === 'initialize') answer(r, { codexHome: paths.codexHome, userAgent: 'pinned-canonical-protocol-fixture' });
          else if (r.method === 'config/read') answer(r, { config: {}, layers: [] });
          else if (r.method === 'configRequirements/read') answer(r, { requirements: null });
          else if (r.method === 'account/read') answer(r, { account: {} });
          else if (r.method === 'account/rateLimits/read') answer(r, {});
          else if (['thread/start', 'thread/fork', 'thread/resume'].includes(r.method)) {
            const p = r.params, id = r.method === 'thread/resume' ? p.threadId : randomUUID();
            const textMode = p.developerInstructions.includes('ordinary assistant text');
            threads.set(id, { textMode, forkedFromId: r.method === 'thread/fork' ? p.threadId : null });
            nativeItems.set(id, r.method === 'thread/fork' ? [...nativeItems.get(p.threadId)!] : []);
            const reply = () => answer(r, { thread: { id, ephemeral: p.ephemeral ?? false, forkedFromId: threads.get(id).forkedFromId, parentThreadId: null, status: { type: 'idle' } }, model: 'controlled-text-model', modelProvider: 'openai', cwd: paths.cwd, approvalPolicy: 'never', approvalsReviewer: 'user', sandbox: { type: 'readOnly' }, instructionSources: [] });
            if (startGate && r.method === 'thread/start') {const gate=startGate;startGate=null;gate.entered();void gate.wait.then(reply);} else reply();
          } else if (r.method === 'turn/start') {
            const p = r.params, threadId = p.threadId, turnId = randomUUID(), timestamp = 1770000000000 + nativeItems.get(threadId)!.length;
            answer(r, { turn: { id: turnId, status: 'inProgress' } });
            const items = [{ type: 'userMessage', id: randomUUID(), clientId: p.clientUserMessageId, content: p.input },
              ...(threads.get(threadId).textMode ? [{ type: 'agentMessage', id: randomUUID(), text: 'Exact canonical commentary.', phase: 'commentary' }] : []),
              { type: 'agentMessage', id: randomUUID(), text: threads.get(threadId).textMode ? 'Exact canonical final.\nThe entire natural answer.' : JSON.stringify({ protocol: 'neko-agent-v1', kind: 'final', requestId: null, toolId: null, argumentsJson: null, summary: 'Legacy summary.' }), phase: 'final_answer' }];
            for (const item of items) { nativeItems.get(threadId)!.push({ turnId, item, startedAtMs: timestamp - 1, completedAtMs: timestamp }); event('item/completed', { threadId, turnId, item, completedAtMs: timestamp }); }
            event('turn/completed', { threadId, turn: { id: turnId, status: 'completed' } });
          } else if (r.method === 'thread/read') answer(r, { thread: { id: r.params.threadId, status: { type: 'idle' } } });
          else if (r.method === 'thread/items/list') {
            const all = nativeItems.get(r.params.threadId)!.filter(row => !r.params.turnId || row.turnId === r.params.turnId), offset = r.params.cursor ? Number(r.params.cursor.slice(5)) : 0;
            answer(r, { data: all.slice(offset, offset + r.params.limit), nextCursor: offset + r.params.limit < all.length ? `page:${offset + r.params.limit}` : null, backwardsCursor: null });
          } else if (r.method === 'thread/unsubscribe') { answer(r, { status: 'unsubscribed' }); event('thread/closed', { threadId: r.params.threadId }); }
        }); done();
      } });
      child.stdin.on('finish', () => { processClosed = true; child.emit('close', 0, null); }); return child;
    } },
  });
  await account.prepare(); context = { server: account, profileId, epoch, serverGeneration, models: [{ id: 'controlled-text-model', admissionId: 'a'.repeat(64), historySource }] };
  const store = new ConversationHistoryStore({ coreHome: join(home, 'history'), trustedCurrentConversationScope: id => service?.transcriptScope(id) ?? null });
  store.setRecordingEnabled(recording);
  const producer = createOwnedNativeTranscriptProducer({ resolveScope: (scope: any) => service.transcriptScope(scope.conversationId), history: {
    async begin(input: any) { trace.push('capture-begin'); const { enableConsent, ...offer } = input; if (enableConsent) store.ownedConversation.setConsent({ scope: input.scope, enabled: true, ...enableConsent }); const result = store.ownedConversation.begin(offer); if (beginGate) { const gate = beginGate; beginGate = null; gate.entered(); await gate.wait; } return result; },
    async record(input: any) { if (holdRecord) await holdRecord(); return store.ownedConversation.record(input); }, release: (lease: any) => store.ownedConversation.release(lease),
  } });
  service = createPersistentNativeConversations({ getExecution: () => context, storageRoot: join(home, 'conversations'), transcript: producer });
  const expectedContext = { profileId, epoch, serverGeneration };
  const create = (text = 'Exact direct human request.') => ({ actionId: randomUUID(), model: 'controlled-text-model', text, retainContext: true, expectedContext, conversationMode: 'canonical-text-v1', recordFutureText: { consent: true, acknowledgeUnknownSecrets: true } });
  return { service, producer, store, methods, trace, nativeItems, expectedContext, create,
    switchContext() { context = { ...context, epoch: randomUUID() }; },
    holdThreadStart() {let entered!:()=>void,release!:()=>void;const reached=new Promise<void>(r=>entered=r),wait=new Promise<void>(r=>release=r);startGate={entered,wait};return {entered:reached,release};},
    holdRecord(wait: () => Promise<void>) { holdRecord = wait; },
    holdBegin() { let entered!:()=>void, release!:()=>void; const reached = new Promise<void>(r=>entered=r), wait = new Promise<void>(r=>release=r); beginGate = {entered,wait}; return {entered:reached,release}; },
    async close() { await producer.close(); await Promise.all([service.destroy(), account.destroy()]); store.close(); expect(processClosed).toBe(true); rmSync(home, { recursive: true, force: true }); },
  };
}

test('same admitted owner records first canonical human/all assistant items, reads pages, fences foreign scopes and preserves legacy JSON', async () => {
  const f = await fixture();
  try {
    const intent = f.create(); await f.service.create(intent);
    const row = f.service.list().conversations[0], scope = f.service.resolveHistoryScope({ conversationId: row.id, revision: row.revision, expectedContext: f.expectedContext });
    expect(row).toMatchObject({ conversationMode: 'canonical-text-v1', status: 'idle', lastTextPreview: 'Exact canonical final.\nThe entire natural answer.', lastTextTruncated: false }); expect(row.lastSummary).toBeUndefined();
    expect(f.trace.indexOf('capture-begin')).toBeLessThan(f.trace.indexOf('turn/start'));
    expect(f.store.status().totalMessages).toBe(3);
    const [retained] = f.store.listThreads().items;
    const messages = f.store.getThread(retained!).items;
    expect(messages.map(item => [item.role, item.author, item.text])).toEqual([['user', 'human', intent.text], ['assistant', 'assistant', 'Exact canonical commentary.'], ['assistant', 'assistant', 'Exact canonical final.\nThe entire natural answer.']]);
    const native = f.nativeItems.get(row.threadId)!;
    expect(messages.map(item => [item.messageId, item.turnId, item.timestamp])).toEqual(native.map(item => [item.item.id, item.turnId, item.completedAtMs]));
    const page1 = await f.service.readTranscriptPage({ scope, limit: 2 }); expect(page1.items).toHaveLength(2); expect(page1.nextCursor).toBe('page:2');
    const page2 = await f.service.readTranscriptPage({ scope, cursor: page1.nextCursor, limit: 2 }); expect(page2.items[0].text).toBe(messages[2]!.text); expect(page2.nextCursor).toBeNull();
    await expect(f.service.readTranscriptPage({ scope: { ...scope, threadId: randomUUID() } })).rejects.toThrow();
    await f.service.create(intent); expect(f.methods.filter(r => r.method === 'turn/start')).toHaveLength(1);
    const started = f.methods.find(r => r.method === 'thread/start'); expect(started.params).toMatchObject({ approvalPolicy: 'never', sandbox: 'read-only', ephemeral: false }); expect(started.params.developerInstructions).not.toContain('NEKO_OUTPUT_FORMAT');
    expect(f.methods.find(r => r.method === 'turn/start').params.outputSchema).toBeUndefined();
    await f.service.fork({ actionId: randomUUID(), conversationId: row.id, revision: row.revision, expectedContext: f.expectedContext, lastTurnId: native[0].turnId });
    expect(f.methods.find(r => r.method === 'thread/fork').params.lastTurnId).toBe(native[0].turnId); expect(f.methods.filter(r => r.method === 'turn/start')).toHaveLength(1);
    const child = f.service.list().conversations.find((r: any) => r.parentId === row.id); await f.service.closeIdle({ actionId: randomUUID(), conversationId: child.id, revision: child.revision, expectedContext: f.expectedContext });
    const legacy = { ...f.create('Legacy explicit input.') }; delete (legacy as any).conversationMode; delete (legacy as any).recordFutureText;
    await f.service.create(legacy); const legacyRow = f.service.list().conversations.find((r: any) => r.id !== row.id && !r.parentId);
    expect(legacyRow).toMatchObject({ conversationMode: 'neko-json-v1', lastSummary: 'Legacy summary.' }); expect(f.service.transcriptScope(legacyRow.id)).toBeNull();
    expect(f.methods.filter(r => r.method === 'turn/start').at(-1).params.outputSchema).toBeDefined();
    f.store.ownedConversation.revokeConversation({ conversationId: row.id }); await f.producer.revoke(scope);
    await f.service.send({ actionId: randomUUID(), conversationId: row.id, revision: row.revision, expectedContext: f.expectedContext, text: 'After exact recording revoke.' });
    expect(f.store.status().totalMessages).toBe(3);
    f.switchContext(); expect(f.service.currentHistoryScopes()).toEqual([]);
    await expect(f.service.readTranscriptPage({ scope })).rejects.toThrow(); expect(f.methods.filter(r => r.method === 'turn/start')).toHaveLength(3);
  } finally { await f.close(); }
}, 6000);

test('requested FIRST capture fails before turn offer when global recording is off and retains exact idle thread for explicit Send', async () => {
  const f = await fixture(false);
  try {
    const intent = f.create('Draft must not be sent without requested recording.');
    await expect(f.service.create(intent)).rejects.toMatchObject({ code: 'recording_unavailable', nativeTurnNotStarted: true, actionRecorded: true });
    expect(f.methods.filter(r => r.method === 'turn/start')).toHaveLength(0); expect(f.store.status().recordingEnabled).toBe(false);
    let row = f.service.list().conversations[0]; expect(row).toMatchObject({ status: 'idle', conversationMode: 'canonical-text-v1', recordingRequiredBeforeFirstSend: true }); expect(row.threadId).toBeTruthy();
    await f.service.create(intent); expect(f.methods.filter(r => r.method === 'turn/start')).toHaveLength(0);
    await expect(f.service.send({actionId:randomUUID(),conversationId:row.id,revision:row.revision,expectedContext:f.expectedContext,text:intent.text})).rejects.toMatchObject({code:'recording_unavailable',nativeTurnNotStarted:true});
    expect(f.methods.filter(r=>r.method==='turn/start')).toHaveLength(0); row = f.service.list().conversations[0];
    f.store.setRecordingEnabled(true); const scope = f.service.transcriptScope(row.id); f.store.ownedConversation.setConsent({ scope, enabled: true, consent: true, acknowledgeUnknownSecrets: true });
    await f.service.send({ actionId: randomUUID(), conversationId: row.id, revision: row.revision, expectedContext: f.expectedContext, text: intent.text });
    expect(f.methods.filter(r => r.method === 'turn/start')).toHaveLength(1); expect(f.store.status().totalMessages).toBe(3);
  } finally { await f.close(); }
}, 6000);


test('revoke while actual core lease admission awaits cannot revive requested first-turn capture or send', async () => {
  const f = await fixture();
  try {
    const gate = f.holdBegin(), creating = f.service.create(f.create('Never send after recording revoke.'));
    await gate.entered;
    const scope = f.service.currentHistoryScopes()[0]; expect(scope).toBeTruthy();
    expect(f.store.ownedConversation.status(scope).activeSubscriptions).toBe(1);
    const revoking = f.producer.revoke(scope); gate.release();
    await expect(creating).rejects.toMatchObject({code:'recording_unavailable',nativeTurnNotStarted:true}); await revoking;
    f.store.ownedConversation.revokeConversation({conversationId:scope.conversationId});
    expect(f.producer.status().activeCount).toBe(0); expect(f.store.ownedConversation.status(scope).activeSubscriptions).toBe(0);
    expect(f.methods.filter(r=>r.method==='turn/start')).toHaveLength(0); expect(f.store.status().totalMessages).toBe(0);
    expect(f.service.list().conversations[0].status).toBe('idle');
  } finally {await f.close();}
},6000);


test('local privacy revoke survives a lost core-off reply until confirmed explicit source enable', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create()); let row = f.service.list().conversations[0]; const scope = f.service.transcriptScope(row.id);
    expect(f.store.status().totalMessages).toBe(3);
    // Core still says enabled: simulate its off request/reply never completing.
    await f.producer.revoke(scope); expect(f.store.ownedConversation.status(scope).enabled).toBe(true);
    await f.service.send({actionId:randomUUID(),conversationId:row.id,revision:row.revision,expectedContext:f.expectedContext,text:'Continue while recording is locally revoked.'});
    expect(f.store.status().totalMessages).toBe(3); expect(f.producer.status().sources[0].locallyDenied).toBe(true);
    const authority = f.producer.recordingAuthority(scope); f.store.ownedConversation.setConsent({scope,enabled:true,consent:true,acknowledgeUnknownSecrets:true}); f.producer.allowRecording(scope,authority);
    row = f.service.list().conversations[0];
    await f.service.send({actionId:randomUUID(),conversationId:row.id,revision:row.revision,expectedContext:f.expectedContext,text:'Explicit recording consent was confirmed again.'});
    expect(f.store.status().totalMessages).toBe(6); expect(f.producer.status().sources[0].locallyDenied).toBe(false);
  } finally {await f.close();}
},6000);


test('producer persists a gap for a rejected foreign canonical callback and never hashes excluded secret bodies', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create()); const scope = f.service.currentHistoryScopes()[0], nativeActionId = randomUUID();
    const capture = await f.producer.begin({scope,actionId:randomUUID(),nativeActionId}); expect(capture).not.toBeNull();
    const secret = 'password=CONTROLLED-SECRET-NEVER-HASH';
    f.producer.observe(capture,{actionId:nativeActionId,threadId:scope.threadId,item:{messageId:'excluded-canonical-item',turnId:randomUUID(),role:'assistant',authorship:'native-assistant',text:secret,timestampMs:1770000005000,phase:'final_answer'}});
    f.producer.observe(capture,{actionId:nativeActionId,threadId:randomUUID(),item:{messageId:'foreign-item',turnId:randomUUID(),role:'assistant',authorship:'native-assistant',text:'FORBIDDEN FOREIGN CANONICAL BODY',timestampMs:1770000005001,phase:'final_answer'}});
    await f.producer.release(capture);
    expect(f.store.ownedConversation.status(scope)).toMatchObject({gapCount:1,lastGapReason:'canonical-source-mismatch'});
    const thread = f.store.ownedConversation.status(scope).historyThread;
    const excluded = f.store.getThread(thread).items.find(row=>row.messageId==='excluded-canonical-item')!;
    expect(excluded.text).toBeNull(); expect(excluded.ownedConversation!.sourceRevision).not.toBe(createHash('sha256').update(secret).digest('hex'));
    expect(JSON.stringify(f.store.getThread(thread))).not.toContain('FORBIDDEN FOREIGN'); expect(f.store.status().totalMessages).toBe(4);
  } finally {await f.close();}
},6000);


test('late explicit enable reply cannot clear a newer local recording revoke', async () => {
  const f = await fixture();
  try {
    await f.service.create(f.create()); const row = f.service.list().conversations[0], scope = f.service.transcriptScope(row.id);
    const oldEnableAuthority = f.producer.recordingAuthority(scope);
    // The old enable committed, but its successful reply is delivered after a newer privacy revoke.
    f.store.ownedConversation.setConsent({scope,enabled:true,consent:true,acknowledgeUnknownSecrets:true});
    await f.producer.revoke(scope);
    expect(()=>f.producer.allowRecording(scope,oldEnableAuthority)).toThrow();
    await f.service.send({actionId:randomUUID(),conversationId:row.id,revision:row.revision,expectedContext:f.expectedContext,text:'A late reply grants no recording authority.'});
    expect(f.store.status().totalMessages).toBe(3); expect(f.producer.status().sources[0].locallyDenied).toBe(true);
    const newEnableAuthority = f.producer.recordingAuthority(scope);
    f.store.ownedConversation.setConsent({scope,enabled:true,consent:true,acknowledgeUnknownSecrets:true});
    f.producer.allowRecording(scope,newEnableAuthority); expect(f.producer.status().sources[0].locallyDenied).toBe(false);
  } finally {await f.close();}
},6000);


test('conversation revoke before thread ACK tombstones the saved new row before its FIRST capture begins', async () => {
  const f = await fixture();
  try {
    const gate=f.holdThreadStart(),creating=f.service.create(f.create('No first pair after pre-ACK conversation revoke.'));
    await gate.entered; const row=f.service.list().conversations[0]; expect(row.threadId).toBeNull(); expect(f.service.currentHistoryScopes()).toEqual([]);
    await f.producer.revokeConversation(row.id);
    expect(f.producer.recordingStatus(row.id)).toMatchObject({conversationId:row.id,locallyDenied:true,reason:'conversation-locally-revoked'});
    const knownCount=f.producer.status().conversations.length; f.producer.recordingStatus(randomUUID()); expect(f.producer.status().conversations).toHaveLength(knownCount);
    expect(f.producer.status()).toMatchObject({globallyDenied:false,conversations:[{conversationId:row.id,locallyDenied:true}]});
    gate.release();
    await expect(creating).rejects.toMatchObject({code:'recording_unavailable',nativeTurnNotStarted:true});
    expect(f.trace).not.toContain('capture-begin'); expect(f.methods.filter(r=>r.method==='turn/start')).toHaveLength(0); expect(f.store.status().totalMessages).toBe(0);
    expect(f.service.list().conversations[0]).toMatchObject({status:'idle',recordingRequiredBeforeFirstSend:true});
  } finally {await f.close();}
},6000);
