import { createElement } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { NativePersistentConversationsPanel } from '../../launcher/src/NativePersistentConversationsPanel';
import type { NativePersistentApi, NativePersistentSnapshot } from '../../launcher/src/native-persistent-types';
import '../../launcher/src/tokens.css';
import '../../launcher/src/design/components.css';

const id = '0199a001-0000-7000-8000-000000000001';
const child = '0199a001-0000-7000-8000-000000000002';
const snapshot: NativePersistentSnapshot = { available: true, profileId: id, epoch: child,
  serverGeneration: '0199a001-0000-7000-8000-000000000003',
  models: [{ id: 'fixture-model' }], conversations: [], actions: [], busy: false,
  retention: 'explicit-native-context', resumeSupported: false };
const fixture = { calls: [] as unknown[], loseCreateResponse: true, snapshot };
Object.assign(window, { persistentFixture: fixture });
const api: NativePersistentApi = { async nativePersistentRequest(body) {
  fixture.calls.push(body);
  if (body.action === 'snapshot') return { ok: true, value: structuredClone({ ...snapshot,
    ...(body.actionId ? { observedAction: snapshot.actions.find(row => row.actionId === body.actionId) } : {}) }) };
  if (body.action === 'create') {
    snapshot.conversations.push({ id, revision: 1, threadId: id, model: body.model, status: 'idle',
      createdAt: 1, updatedAt: 2, ownerAvailable: true, lastSummary: 'FIRST_RESULT' });
    snapshot.actions.push({ actionId: body.actionId, kind: 'create', conversationId: id, state: 'completed' });
    if (fixture.loseCreateResponse) { fixture.loseCreateResponse = false; throw new Error('Lost fixture response'); }
  } else if (body.action === 'send') {
    const row = snapshot.conversations.find(row => row.id === body.conversationId)!;
    if (row.revision !== body.revision) throw new Error('Stale fixture revision');
    row.revision++; row.lastSummary = 'FOLLOWUP_RESULT';
    snapshot.actions.push({ actionId: body.actionId, kind: 'send', conversationId: row.id, state: 'completed' });
  } else {
    snapshot.conversations.push({ ...snapshot.conversations[0]!, id: child, threadId: child,
      revision: 1, parentId: id, lastSummary: 'FORK_CONTEXT_RETAINED' });
    snapshot.actions.push({ actionId: body.actionId, kind: 'fork', conversationId: child, state: 'completed' });
  }
  return { ok: true, value: structuredClone(snapshot) };
} };
createRoot(document.getElementById('root')!).render(createElement(NativePersistentConversationsPanel, { api, language: 'en' }));
