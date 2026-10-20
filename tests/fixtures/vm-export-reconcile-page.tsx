import { createElement, useState } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { AgentVmExport } from '../../launcher/src/AgentVmExport';
import type { AgentToolsApi } from '../../launcher/src/agent-tools-types';

const request = {
  scope: { taskId: 'task', generation: 1, toolCallId: 'original-saved-call' },
  tool: 'vm-shell/export', arguments: { reviewId: 'saved-review', reviewDigest: 'saved-digest' },
  idempotencyKey: 'original-idempotency',
};
const state = { requests: [] as any[], request, hold: false, settled: false, release: () => {}, locked: false, switchTask: () => {}, lock: () => {} };
(window as any).fixture = state;
const api: AgentToolsApi = {
  async request(body) {
    state.requests.push(body);
    if (body.action === 'vmExportWorkspaces') return { roots: [] };
    if (body.action === 'vmExportStatus') return {
      reviews: [], receipts: body.scope.taskId === 'task' ? [{ state: state.settled ? 'completed' : 'outcome_unknown', result: {}, request }] : [],
    };
    if (body.action === 'reconcileVmExport') {
      if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
      state.settled = true;
      return { state: 'completed', result: { receiptId: 'settled' } };
    }
    throw new Error('Fixture forbids export execution or review');
  },
};
function Fixture() {
  const [taskId, setTask] = useState('task');
  const [locked, setLocked] = useState(false);
  state.switchTask = () => setTask('other-task');
  state.lock = () => setLocked(true);
  return createElement(AgentVmExport, {
    api, status: null, scope: { taskId, generation: 2, toolCallId: 'current-selection' }, locked,
    choose: (en: string) => en, act: async (work: () => Promise<void>) => work(), onChanged: async () => {},
  });
}
createRoot(document.getElementById('root')!).render(createElement(Fixture));
