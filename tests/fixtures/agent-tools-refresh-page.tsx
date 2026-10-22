// Actual production component, inert API only; no core, account or model provider.
import { createElement } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { AgentToolsSurface } from '../../launcher/src/AgentToolsSurface';
import type { AgentToolsApi, AgentToolsStatus } from '../../launcher/src/agent-tools-types';

const state = { call: 'write', responseTask: 'task', generation: 2, truncated: false, hold: false, reads: 0, mutations: 0, requests: [] as string[], release: () => {} };
(window as any).fixture = state;
const status: AgentToolsStatus = {
  config: { version: 1, enabled: true, servers: [] }, runtime: { enabled: true, servers: [], sandbox: 'fixture' }, activeCount: 0,
  descriptors: [], skillRoots: [], selections: [], installCatalog: [], installations: { rows: [], truncated: false }, serverConfigDigests: {},
  capabilities: { stdio: false, install: false, oauth: false, secrets: false, nativeSandbox: false, skillWrites: false, pendingToolCalls: true },
};
const api: AgentToolsApi = {
  async request(body) {
    state.requests.push(body.action);
    if (body.action === 'status') return status;
    if (body.action === 'remoteStatus') return null;
    // The mounted host-network panel observes status; this does not grant or send anything.
    if (body.action === 'vmNetworkStatus') return { mode: 'separately-approved-host-broker', guestNic: false, available: false, grants: [] };
    state.mutations++; throw new Error('No mutations are available in this fixture');
  },
  pickSkillRoot: async () => ({ cancelled: true }),
  listTasks: async () => ({ tasks: [{ id: 'task', generation: 2, status: 'awaiting_input' }] }),
  async getTask() {
    state.reads++;
    const detail = { task: { id: state.responseTask, familyId: 'family', generation: state.generation, revision: 1 }, dispatches: [],
      pendingToolCalls: [{ toolCallId: state.call, tool: `fixture/${state.call}`, arguments: {} }],
      coverage: { pendingToolCalls: { total: 1, truncated: state.truncated } } };
    if (state.hold) await new Promise<void>(resolve => { state.release = resolve; });
    return detail;
  },
};
createRoot(document.getElementById('root')!).render(createElement(AgentToolsSurface, { api, language: 'en' }));
