// Standalone inert CUA fixture: actual handoff panel, fake callbacks only.
// Bundle with launcher React dependencies and mount into #root. No Electron,
// process, network, real account/profile, or Native provider is used by this page.
import { createElement, useEffect, useState } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { NativeThreadHandoffPanel } from '../../launcher/src/NativeThreadHandoffPanel';
import type { CodexThreadHandoffReceipt, CodexThreadHandoffSnapshot, CodexThreadMetadata, NativeThreadsApi } from '../../launcher/src/native-threads-types';
import '../../launcher/src/tokens.css';
import '../../launcher/src/design/components.css';
import '../../launcher/src/surfaces/native-threads.css';

const threadId = '0199a001-0000-7000-8000-000000000001';
const actionId = '0199a001-0000-7000-8000-000000000002';
const turnId = 'fixture-owned-turn';
const thread: CodexThreadMetadata = { id: threadId, sessionId: threadId, parentThreadId: null,
  forkedFromId: null, name: 'Inert handoff fixture', agentNickname: null, agentRole: null,
  cwd: null, model: 'fixture', modelProvider: 'fixture', reasoningEffort: null, originator: 'fixture',
  source: 'appServer', status: { type: 'idle' }, createdAt: 1, updatedAt: 1, recencyAt: 1 };
const snapshot: CodexThreadHandoffSnapshot = { available: true, transport: 'owned-stdio-server',
  exclusivity: 'codex-thread-writer-lock', approvals: 'declined', active: null, uncertainHandoffs: [], errorCode: null };
let sendCount = 0, stopCount = 0, settledCount = 0, leaseHeld = false, sendPending = false;
let snapshotReads = 0, snapshotsInFlight = 0, maxSnapshotsInFlight = 0, holdSnapshots = false;
let pendingSend: ((value: { ok: true; value: CodexThreadHandoffReceipt }) => void) | null = null;
const heldSnapshots: Array<() => void> = [];
let notify = () => {};
const fakeApi = {
  async nativeThreadHandoffSnapshot() {
    snapshotReads++; snapshotsInFlight++; maxSnapshotsInFlight = Math.max(maxSnapshotsInFlight, snapshotsInFlight); notify();
    try {
      if (holdSnapshots) await new Promise<void>(resolve => heldSnapshots.push(resolve));
      return { ok: true as const, value: structuredClone(snapshot) };
    } finally { snapshotsInFlight--; notify(); }
  },
  nativeThreadContinue({ threadId: selected, text }: { threadId: string; text: string }) {
    if (selected !== threadId || !text.trim() || pendingSend) throw new Error('Invalid inert send');
    sendCount++; sendPending = true; leaseHeld = true;
    snapshot.active = { actionId, threadId, turnId, phase: 'running', stopAvailable: true, stopState: null }; notify();
    return new Promise<{ ok: true; value: CodexThreadHandoffReceipt }>(resolve => { pendingSend = resolve; });
  },
  async nativeThreadStopHandoff(input: { actionId: string; threadId: string }) {
    if (!snapshot.active || input.actionId !== actionId || input.threadId !== threadId || !leaseHeld) throw new Error('Invalid inert Stop target');
    if (!snapshot.active.stopState) stopCount++;
    snapshot.active.stopAvailable = false; snapshot.active.stopState = 'acknowledged'; notify();
    return { ok: true as const, value: structuredClone(snapshot) };
  },
};
function complete() {
  if (!pendingSend || !snapshot.active?.stopState) return;
  const finish = pendingSend; pendingSend = null; sendPending = false; leaseHeld = false; snapshot.active = null; notify();
  finish({ ok: true, value: { actionId, threadId, turnId, turnStatus: 'interrupted', approvalsRefused: 0,
    released: true, executionOwner: 'released', assistantText: null, assistantTextTruncated: false } });
}
function Harness() {
  const [, rerender] = useState(0);
  useEffect(() => { notify = () => rerender(value => value + 1); notify(); return () => { notify = () => {}; }; }, []);
  return createElement('main', { style: { maxWidth: '900px', margin: '20px auto', padding: '20px' } },
    createElement('h1', null, 'Inert owned handoff Stop fixture'),
    createElement('p', null, 'Type a message, choose Take over and send, wait for Stop this turn, then choose Stop. ACK must keep Send pending and the lease held. Use the fixture terminal button to finish.'),
    createElement('output', { 'aria-label': 'Fixture evidence', style: { display: 'block', whiteSpace: 'pre-wrap', marginBottom: '16px' } },
      `sendCount=${sendCount}; stopCount=${stopCount}; sendPending=${sendPending}; leaseHeld=${leaseHeld}; settledCount=${settledCount}; snapshotReads=${snapshotReads}; snapshotsInFlight=${snapshotsInFlight}; maxSnapshotsInFlight=${maxSnapshotsInFlight}`),
    createElement('div', { style: { display: 'flex', gap: '12px', marginBottom: '16px' } },
      createElement('button', { type: 'button', onClick: complete }, 'Fixture: terminal interrupted and release lease'),
      createElement('button', { type: 'button', onClick: () => { holdSnapshots = true; notify(); } }, 'Fixture: hold snapshot replies'),
      createElement('button', { type: 'button', onClick: () => { holdSnapshots = false; for (const release of heldSnapshots.splice(0)) release(); notify(); } }, 'Fixture: release snapshot replies')),
    createElement(NativeThreadHandoffPanel, { language: 'en', api: fakeApi as NativeThreadsApi, thread,
      onSettled: () => { settledCount++; notify(); } }));
}
createRoot(document.getElementById('root')!).render(createElement(Harness));
