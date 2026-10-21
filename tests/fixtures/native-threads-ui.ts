// Credential-free standalone surface fixture. No Electron IPC or Codex process.
import { createElement } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { NativeThreadsSurface } from '../../launcher/src/NativeThreadsSurface';
import '../../launcher/src/tokens.css';
import '../../launcher/src/design/components.css';
import type { CodexThreadMetadata, CodexForkAction, CodexHandoffAction, NativeThreadsApi } from '../../launcher/src/native-threads-types';

const ROOT = '0199a001-0000-7000-8000-000000000001';
const CHILD = '0199a001-0000-7000-8000-000000000002';
const FORK = '0199a001-0000-7000-8000-000000000003';
const thread = (id: string, name: string, extra = {}): CodexThreadMetadata => ({
  id, sessionId: ROOT, parentThreadId: null, forkedFromId: null, name, agentNickname: null, agentRole: null,
  cwd: '/fixture/workspace', model: 'fixture-model', modelProvider: 'fixture', reasoningEffort: 'medium',
  originator: 'fixture', source: 'appServer', status: { type: 'notLoaded' }, createdAt: 1_760_000_000,
  updatedAt: 1_760_000_001, recencyAt: 1_760_000_001, ...extra,
});
const rows = [thread(ROOT, 'Fixture parent'), thread(CHILD, 'Fixture worker', { parentThreadId: ROOT,
  agentNickname: 'Reader', agentRole: 'reviewer', source: 'subAgent',
  status: { type: 'active', activeFlags: ['waitingOnApproval'] } })];
const fixture = { calls: [] as string[], failList: false, unknownFork: false, uncertain: [] as CodexForkAction[],
  ownerActive: false, continueDelayMs: 0, uncertainHandoffs: [] as CodexHandoffAction[] };
Object.assign(window, { nativeThreadsFixture: fixture });
const api: NativeThreadsApi = {
  nativeThreadsSnapshot: async () => ({ ok: true, value: { state: 'ready', transport: 'owned-stdio-server',
    statusScope: 'connection', userAgent: 'codex-cli/0.163.0 · isolated UI fixture',
    capabilities: { list: 'supported', read: 'supported', fork: 'unverified',
      startTurn: false, interruptTurn: false, approve: false, resumeExternal: false, exclusiveHandoff: false },
    externalControl: { executionOwner: 'unverified', reason: 'exclusive-owner-contract-unavailable' },
    errorCode: null, uncertainForks: [...fixture.uncertain] } }),
  nativeThreadsList: async () => {
    fixture.calls.push('list');
    return fixture.failList ? { ok: false, error: { code: 'rpc_error', rpcCode: -32601,
      message: 'This installed Codex version does not support this action.' } }
      : { ok: true, value: { data: [...rows], nextCursor: null, statusScope: 'connection' } };
  },
  nativeThreadRead: async id => {
    fixture.calls.push(`read:${id}`);
    return { ok: true, value: { thread: rows.find(row => row.id === id)!, statusScope: 'connection' } };
  },
  nativeThreadFork: async ({ threadId, lastTurnId }) => {
    fixture.calls.push(`fork:${threadId}`);
    if (fixture.unknownFork) {
      fixture.uncertain.push({ actionId: '0199a001-0000-7000-8000-000000000004', threadId,
        lastTurnId: null, requestedAt: new Date().toISOString(), state: 'unknown', reasonCode: 'rpc_timeout', observedForkId: null });
      return { ok: false, error: { code: 'fork_outcome_unknown',
        message: 'The fork outcome is unknown. Reload native threads and inspect them before trying again.' } };
    }
    const fork = thread(FORK, 'Fork of fixture worker', { forkedFromId: threadId, status: { type: 'idle' } });
    rows.push(fork);
    return { ok: true, value: { thread: fork, statusScope: 'connection',
      actionId: '0199a001-0000-7000-8000-000000000005', sourceThreadId: threadId,
      lastTurnId: lastTurnId ?? null, executionStarted: false, attachments: { state: 'matched', source: 1, fork: 1, missing: 0 } } };
  },
  nativeThreadHandoffSnapshot: async () => ({ ok: true, value: { available: true, transport: 'owned-stdio-server',
    exclusivity: 'codex-thread-writer-lock', approvals: 'declined', active: null,
    uncertainHandoffs: [...fixture.uncertainHandoffs], errorCode: null } }),
  nativeThreadContinue: async ({ threadId, text }) => {
    fixture.calls.push(`continue:${threadId}:${text}`);
    if (fixture.continueDelayMs) await new Promise(resolve => setTimeout(resolve, fixture.continueDelayMs));
    if (fixture.ownerActive) return { ok: false, error: { code: 'handoff_owner_active', rpcCode: -32600,
      message: 'Another Codex client still owns this thread. Close or switch away from it in Codex, wait for Codex to release it, then try again. Nothing was sent.' } };
    return { ok: true, value: { actionId: '0199a001-0000-7000-8000-000000000006', threadId, turnId: 'fixture-turn-1',
      turnStatus: 'completed', approvalsRefused: 1, released: true, executionOwner: 'released',
      assistantText: 'Fixture final reply', assistantTextTruncated: false } };
  },
  nativeThreadAcknowledgeHandoff: async ({ actionId }) => {
    fixture.uncertainHandoffs = fixture.uncertainHandoffs.filter(row => row.actionId !== actionId);
    return api.nativeThreadHandoffSnapshot!();
  },
  nativeThreadAcknowledgeFork: async ({ actionId }) => {
    fixture.calls.push(`acknowledge:${actionId}`);
    fixture.uncertain = fixture.uncertain.filter(row => row.actionId !== actionId);
    return api.nativeThreadsSnapshot();
  },
};
createRoot(document.getElementById('root')!).render(createElement(NativeThreadsSurface, { language: 'en', api }));
