import { createElement } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { AgentToolsSurface } from '../../launcher/src/AgentToolsSurface';
import type { AgentToolsApi, AgentToolsStatus } from '../../launcher/src/agent-tools-types';
import '../../launcher/src/tokens.css';
import '../../launcher/src/design/components.css';

const selection = { windowId: '101', processId: '30:1', windowEpoch: 'a'.repeat(64) };
const fixture = { requests: [] as Record<string, unknown>[], approved: false, holdApproval: false, foreground: false, releaseApproval: () => {} };
(window as any).toolsUiFixture = fixture;
const status = {
  config: { version: 1, enabled: true, servers: [] }, runtime: { enabled: true, servers: [], sandbox: 'fixture' }, activeCount: 0,
  descriptors: [], skillRoots: [], selections: [], installCatalog: [], installations: { rows: [], truncated: false }, serverConfigDigests: {},
  capabilities: { stdio: false, install: false, oauth: false, secrets: false, nativeSandbox: false, skillWrites: false, pendingToolCalls: true },
  desktopTools: { enabled: true, selected: { ...selection, windowId: '202' }, bindings: [{ taskId: 'task-a', generation: 3, selection }], platform: 'darwin', state: 'enabled', windows: [], activeCount: 0, permissions: null, nativeStatus: null, permissionClient: null, modelImage: {}, providerId: 'fixture', created: true, reason: null },
} as unknown as AgentToolsStatus;
const api: AgentToolsApi = {
  async request(body) {
    fixture.requests.push(body);
    if (body.action === 'status') return status;
    if (body.action === 'remoteStatus') return null;
    if (body.action === 'vmNetworkStatus') return { mode: 'separately-approved-host-broker', guestNic: false, available: false, grants: [] };
    if (body.action === 'approveInvoke') {
      if (fixture.holdApproval) await new Promise<void>(resolve => { fixture.releaseApproval = resolve; });
      fixture.approved = true;
      return { scope: body.scope, tool: 'desktop/observe', idempotencyKey: 'retained-1', state: 'outcome_unknown', reason: 'Fixture acknowledgement unavailable' };
    }
    throw new Error(`Unexpected fixture action: ${body.action}`);
  },
  pickSkillRoot: async () => ({ cancelled: true }),
  listTasks: async () => ({ tasks: [{ id: 'task-a', generation: 3, status: 'awaiting_input' }] }),
  getTask: async () => ({ task: { id: 'task-a', familyId: 'family-a', generation: 3, revision: 1, originalRequest: 'Review the selected application window' }, dispatches: [], pendingToolCalls: fixture.approved ? [] : [
    { toolCallId: 'call-a', tool: 'desktop/observe', arguments: { selection, ...(fixture.foreground ? { waitForForeground: true } : {}) } },
  ] }),
};
createRoot(document.getElementById('root')!).render(createElement(AgentToolsSurface, { api, language: 'en' }));
