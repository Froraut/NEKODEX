import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
const { registerPersistentNativeConversations } = createRequire(import.meta.url)('../launcher/electron/ipc/native-persistent-conversations.cjs');
const { settleNativeConversationOwners } = createRequire(import.meta.url)('../launcher/electron/native-account-execution.cjs');

test('persistent Native IPC projects owned metadata and refuses renderer authority before dispatch', async () => {
  let handler: Function = () => {};
  const calls: unknown[] = [], id = randomUUID(), actionId = randomUUID();
  const context = { profileId: randomUUID(), epoch: randomUUID(), serverGeneration: randomUUID(), models: [{ id: 'native-one', label: 'Native One', admissionId: 'excluded' }] };
  const expectedContext = { profileId: context.profileId, epoch: context.epoch, serverGeneration: context.serverGeneration };
  const source = { conversations: [{ id, revision: 1, threadId: randomUUID(), model: 'native-one', status: 'idle',
    createdAt: 1, updatedAt: 2, ownerAvailable: true, lastSummary: 'Done', messages: [{ text: 'private full context' }], auth: 'excluded' }],
  actions: [{ actionId, kind: 'create', conversationId: id, state: 'completed', secret: 'excluded' }], busy: false };
  const service = { list: () => source, inspectAction: (id: string) => source.actions.find(row => row.actionId === id),
    create: async (input: unknown) => { calls.push(input); return source; },
    closeIdle: async (input: unknown) => { calls.push({ kind: 'closeIdle', input }); return source; },
    resume: async (input: unknown) => { calls.push({ kind: 'resume', input }); return source; } };
  registerPersistentNativeConversations({ handle: (_: string, value: Function) => { handler = value; },
    getService: () => service, getContext: () => context });
  const request = (body: unknown) => handler(null, body);
  const result = await request({ action: 'snapshot' });
  expect(result.ok).toBe(true); expect(result.value.conversations[0].lastSummary).toBe('Done');
  expect(result.value.models).toEqual([{ id: 'native-one', label: 'Native One' }]);
  expect(JSON.stringify(result)).not.toContain('excluded');
  expect(JSON.stringify(result)).not.toContain('private full context');
  expect(calls).toHaveLength(0);
  const intent = { action: 'create', actionId, model: 'native-one', text: 'First message', retainContext: true, expectedContext };
  for (const body of [{ ...intent, codexHome: '/foreign' }, { ...intent, retainContext: false },
    { ...intent, text: 'x'.repeat(32769) }, { ...intent, text: '\0' }, { action: 'send', actionId, conversationId: id, revision: -1, text: 'x' }]) {
    expect(await request(body)).toMatchObject({ ok: false, error: { code: 'invalid_request', knownNotStarted: true } });
  }
  expect(calls).toHaveLength(0);
  expect(await request({ ...intent, expectedContext: { ...expectedContext, epoch: randomUUID() } }))
    .toMatchObject({ ok: false, error: { code: 'context_changed', knownNotStarted: true } });
  expect((await request(intent)).ok).toBe(true);
  expect(calls).toEqual([{ actionId, model: 'native-one', text: 'First message', retainContext: true, expectedContext }]);
  for (const action of ['closeIdle', 'resume']) {
    const control = { action, actionId: randomUUID(), conversationId: id, revision: 1, expectedContext };
    expect(await request({ ...control, text: 'must not be sent' })).toMatchObject({ ok: false, error: { knownNotStarted: true } });
    expect((await request(control)).ok).toBe(true);
    expect(calls.at(-1)).toEqual({ kind: action, input: { actionId: control.actionId, conversationId: id, revision: 1, expectedContext } });
  }
  const retainedAction = source.actions[0];
  service.inspectAction = id => id === actionId ? retainedAction : undefined;
  source.actions = []; source.conversations = []; context.profileId = randomUUID();
  const observed = await request({ action: 'snapshot', actionId });
  expect(observed.value.actions).toEqual([]);
  expect(observed.value.observedAction).toEqual({ actionId, kind: 'create', conversationId: id, state: 'completed' });
  expect(JSON.stringify(observed)).not.toContain('excluded');
});

test('persistent Native IPC distinguishes a preclaim refusal from an uncertain owned action without reflecting errors', async () => {
  let handler: Function = () => {};
  let known = true, calls = 0;
  const expectedContext = { profileId: randomUUID(), epoch: randomUUID(), serverGeneration: randomUUID() };
  registerPersistentNativeConversations({ handle: (_: string, value: Function) => { handler = value; }, getContext: () => expectedContext,
    getService: () => ({ async send() { calls++; throw Object.assign(new Error('/private/config token-secret'),
      { code: known ? 'worker_busy' : 'outcome_unknown', ...(known ? { actionRecorded: false } : {}) }); } }) });
  const input = { action: 'send', actionId: randomUUID(), conversationId: randomUUID(), revision: 1, text: 'Next message', expectedContext };
  const refused = await handler(null, input);
  expect(refused).toMatchObject({ ok: false, error: { code: 'worker_busy', knownNotStarted: true } });
  known = false;
  const uncertain = await handler(null, input);
  expect(uncertain).toMatchObject({ ok: false, error: { code: 'outcome_unknown', knownNotStarted: false } });
  expect(JSON.stringify([refused, uncertain])).not.toContain('token-secret');
  expect(calls).toBe(2);
});

test('Native account shutdown closes the transport while a conversation awaits its missing creation acknowledgement', async () => {
  const events: string[] = [];
  let closed!: () => void;
  const transportClosed = new Promise<void>(resolve => { closed = resolve; });
  const conversations = { async destroy() { events.push('conversation-drain'); await transportClosed; events.push('conversation-settled'); } };
  const execution = { async destroy() { events.push('transport-close'); closed(); } };
  await settleNativeConversationOwners(execution, conversations);
  expect(events).toEqual(['conversation-drain', 'transport-close', 'conversation-settled']);
  await expect(settleNativeConversationOwners({ async destroy() { throw new Error('retained-owner'); } },
    { async destroy() { events.push('other-settled'); } })).rejects.toThrow('retained-owner');
  expect(events.at(-1)).toBe('other-settled');
});

test('archive IPC preserves known receipt after row leaves active list and pages metadata without renderer capabilities', async () => {
  let handler: Function = () => {}; const context = { profileId: randomUUID(), epoch: randomUUID(), serverGeneration: randomUUID() };
  const id = randomUUID(), actionId = randomUUID(), archiveCursor = randomUUID();
  const calls: any[] = [], action = { actionId, kind: 'archive', conversationId: id, state: 'completed' };
  const source = { conversations: [], actions: [], archivedConversations: [{ id, revision: 2, status: 'archived', createdAt: 1, updatedAt: 2,
    model: 'fixture', threadId: randomUUID(), archivedAt: 2, lastSummary: 'Retained preview', ownerAvailable: false, resumeAvailable: false, archiveAvailable: false,
    historySource: { private: 'not-renderer-authority' } }], archivedCount: 1, archivedConversationIds: [id], archiveNextCursor: null,
    quota: { conversations: 0, conversationLimit: 128, actions: 0, actionLimit: 512 } };
  registerPersistentNativeConversations({ handle: (_: string, value: Function) => { handler = value; }, getContext: () => context,
    getService: () => ({ list: (input: any) => { calls.push(input); return source; }, inspectAction: () => action,
      archive: async (input: any) => { calls.push(input); return source; } }) });
  const result = await handler(null, { action: 'archive', actionId, conversationId: id, revision: 1, expectedContext: context });
  expect(result).toMatchObject({ ok: true, value: { observedAction: action, conversations: [], archivedCount: 1, quota: { actions: 0 } } });
  expect(JSON.stringify(result)).not.toContain('not-renderer-authority');
  await handler(null, { action: 'snapshot', archiveCursor }); expect(calls.at(-1)).toEqual({ archiveCursor });
  const invalid = await handler(null, { action: 'archive', actionId: randomUUID(), conversationId: id, revision: 2, expectedContext: context, threadId: randomUUID() });
  expect(invalid).toMatchObject({ ok: false, error: { knownNotStarted: true, code: 'invalid_request' } });
});

test('Stop IPC accepts only opaque conversation identity and projects stopping without inventing terminal success', async () => {
  let handler: Function = () => {}; const expectedContext = { profileId: randomUUID(), epoch: randomUUID(), serverGeneration: randomUUID() };
  const id = randomUUID(), actionId = randomUUID(), calls: any[] = [];
  const receipt = { actionId, conversationId: id, kind: 'stop', state: 'stopping', ownerHeld: true };
  const source = { conversations: [{ id, revision: 2, model: 'fixture', status: 'running', createdAt: 1, updatedAt: 1, stopAvailable: false, stopReason: 'stop_already_requested' }], actions: [receipt] };
  registerPersistentNativeConversations({ handle: (_: string, value: Function) => { handler = value; }, getContext: () => expectedContext,
    getService: () => ({ stop: async (input: any) => { calls.push(input); return source; }, list: () => source, inspectAction: () => receipt }) });
  const request = { action: 'stop', actionId, conversationId: id, revision: 2, expectedContext };
  const response = await handler(null, request);
  expect(response).toMatchObject({ ok: true, value: { observedAction: receipt, conversations: [{ status: 'running', stopAvailable: false }] } });
  expect(calls[0]).toEqual({ actionId, conversationId: id, revision: 2, expectedContext });
  expect(await handler(null, { ...request, turnId: randomUUID() })).toMatchObject({ ok: false, error: { code: 'invalid_request', knownNotStarted: true } });
  expect(await handler(null, { ...request, expectedContext: { ...expectedContext, epoch: randomUUID() } })).toMatchObject({ ok: false, error: { code: 'context_changed', knownNotStarted: true } });
  expect(calls).toHaveLength(1);
});
