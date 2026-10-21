// Production dialog with an inert callback: no core, IPC, provider or model operations.
import { createElement, useState } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { AgentDispatchReconciliation } from '../../launcher/src/AgentDispatchReconciliation';
import { agentModeCopy } from '../../launcher/src/agent-mode-copy';
import type { AgentDispatch } from '../../launcher/src/agent-mode-types';

const base = { taskId: 'task', familyId: 'family', generation: 2, taskRevision: 1, ownerId: 'owner', workerId: 'worker', stageId: 'write', messageId: 'message',
  messages: [], state: 'unknown', reservedSpend: 0, createdAt: 0 } satisfies Omit<AgentDispatch, 'id'>;
const dispatches: Record<string, AgentDispatch> = { lost: { ...base, id: 'lost-dispatch' }, acked: { ...base, id: 'acked-dispatch', acceptanceReceipt: 'accept-1' } };
const state = { confirmed: [] as unknown[], kept: 0 };
(window as any).fixture = state;
function Page() {
  const [open, setOpen] = useState<string | null>(new URLSearchParams(location.search).get('dispatch'));
  return open ? createElement(AgentDispatchReconciliation, { dispatch: dispatches[open]!, text: agentModeCopy('en'), pending: false, error: null,
    onKeep: () => { state.kept++; setOpen(null); }, onConfirm: disposition => { state.confirmed.push(disposition); setOpen(null); } }) : null;
}
createRoot(document.getElementById('root')!).render(createElement(Page));
