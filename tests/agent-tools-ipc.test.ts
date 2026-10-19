import { expect, test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { registerAgentTools } = require("../launcher/electron/ipc/agent-tools.cjs");
const { createLifecycleAdmission } = require("../launcher/electron/lifecycle-admission.cjs");
test('pending production upgrade preserves cleanup and reads while fencing new tool work', async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  let version = '6.1.32-nekodex.8', coreError = '', ready = true;
  const received: any[] = [];
  registerAgentTools({ handle: (name: string, fn: any) => handlers.set(name, fn),
    getApplicationVersion: () => '6.1.32-nekodex.10',
    runtimeHost: { supervisor: { launcherProfile: 'production', readConfig: () => ({ releaseVersion: version }),
      ownedAgentRuntimeReady: async () => ready,
      control: async (_config: unknown, _endpoint: string, packet: any) => {
        received.push(packet.body); if (coreError) throw new Error(coreError);
        return { ok: true, value: { retained: true } };
      } } },
    remoteService: { revokeAgent: () => ({ revoked: true }) },
    oauthIpc: { handles: (action: string) => action === 'oauthList', request: async () => ({ providers: [] }), decorateStatus: (value: unknown) => value },
    workspaceService: { listRoots: () => [] }, vmExportService: { list: async () => ({ retained: true }) } });
  const request = (body: unknown) => handlers.get('launcher:agent-tools')!({}, body);
  for (const body of [{ action: 'approveInvoke' }, { action: 'grantScriptWorkspace' }, { action: 'setEnabled', enabled: true },
    { action: 'managedSkillAction', actionId: 'saved', command: 'enable' }]) {
    await expect(request(body)).rejects.toThrow('Application 6.1.32-nekodex.10 is installed; runtime 6.1.32-nekodex.8 is still active');
  }
  expect(received).toHaveLength(0);
  expect(await request({ action: 'oauthList' })).toEqual({ providers: [] });
  expect(await request({ action: 'vmExportStatus', scope: { taskId: 'task', generation: 1 } })).toEqual({ retained: true });
  expect(await request({ action: 'revokeRemoteTools', scope: { taskId: 'task', generation: 1 }, explicitUserAction: true })).toEqual({ revoked: true });
  for (const body of [{ action: 'status' }, { action: 'revokeVmWorkspace' }, { action: 'cancelVmOperation' },
    { action: 'setEnabled', enabled: false }, { action: 'setServerEnabled', enabled: false },
    { action: 'managedSkillAction', actionId: 'saved' }, { action: 'pythonEnvironmentAction', actionId: '11111111-1111-4111-8111-111111111111' }]) {
    expect(await request(body)).toEqual({ retained: true });
    expect(received.at(-1)).toEqual(body);
  }
  ready = false;
  await expect(request({ action: 'revokeVmWorkspace' })).rejects.toThrow('Start the current NEKODEX runtime');
  expect(received).toHaveLength(7);
  ready = true; coreError = 'HTTP 404: absent';
  await expect(request({ action: 'receipt' })).rejects.toThrow('Application 6.1.32-nekodex.10 is installed; runtime 6.1.32-nekodex.8 is still active');
  expect(received).toHaveLength(8);
  coreError = 'HTTP 409: owner conflict';
  await expect(request({ action: 'cancelVmOperation' })).rejects.toThrow('HTTP 409: owner conflict');
  coreError = ''; version = '6.1.32-nekodex.10';
  expect(await request({ action: 'approveInvoke' })).toEqual({ retained: true });
  expect(received).toHaveLength(10);
});
test("Agent tools IPC preserves owned runtime admission and the explicit native root picker", async () => {
  const handlers = new Map<string, (...args: any[]) => any>(); const received: any[] = []; let ready = true;
  const admission = createLifecycleAdmission();
  registerAgentTools({ handle: (name: string, handler: any) => handlers.set(name, admission.guard(name, handler)), runtimeHost: { supervisor: { readConfig: () => ({ fixture: true }), ownedAgentRuntimeReady: async () => ready,
    control: async (_config: unknown, endpoint: string, packet: any) => { received.push({ endpoint, packet }); return { ok: true, value: { fixture: true } }; } } }, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ["/fixture/selected-root"] }) } });
  expect(await handlers.get("launcher:agent-tools")!({}, { action: "status" })).toEqual({ fixture: true });
  expect((await handlers.get("launcher:agent-tools-pick-skill-root")!({})).cancelled).toBe(false);
  expect(received[1]).toEqual({ endpoint: "agent-tools", packet: { body: { action: "skillRoot", input: { root: "/fixture/selected-root", label: "selected-root" }, explicitUserAction: true } } });
  ready = false;
  await expect(handlers.get("launcher:agent-tools")!({}, { action: "discover", scope: {} })).rejects.toThrow("current NEKODEX runtime");
  expect(received).toHaveLength(2);
  ready = true;
  const transition = admission.acquire('fixture shutdown');
  try {
    expect(() => handlers.get('launcher:agent-tools')!({}, { action: 'approveInvoke' })).toThrow('Wait for');
    expect(() => handlers.get('launcher:agent-tools-revoke')!({}, { action: 'bindRemoteTools', explicitUserAction: true })).toThrow('only revokes');
    expect(() => handlers.get('launcher:agent-tools-observe')!({}, { action: 'approveInvoke' })).toThrow('only reads');
    expect(await handlers.get('launcher:agent-tools-observe')!({}, { action: 'remoteStatus' })).toEqual({ fixture: true });
    expect(await handlers.get('launcher:agent-tools-revoke')!({}, { action: 'revokeRemoteTools', scope: { taskId: 'fixture', generation: 1, toolCallId: 'revoke' }, explicitUserAction: true })).toEqual({ fixture: true });
    expect(received).toHaveLength(4);
  } finally { admission.release(transition); }
});

test('main remote privacy control stays available with the core absent and cannot attach', async () => {
  const handlers = new Map<string, (...args: any[]) => any>(); let attached = true, coreReads = 0;
  const snapshot = () => ({ bindings: attached ? [{ taskId: 'task', generation: 1 }] : [] });
  registerAgentTools({ handle: (name: string, fn: any) => handlers.set(name, fn), runtimeHost: { supervisor: { readConfig() { coreReads++; return null; } } },
    remoteService: { agentStatus: snapshot, revokeAgent() { attached = false; return snapshot(); } } });
  expect(await handlers.get('launcher:agent-tools-observe')!({}, { action: 'remoteStatus' })).toEqual({ bindings: [{ taskId: 'task', generation: 1 }] });
  expect(await handlers.get('launcher:agent-tools-revoke')!({}, { action: 'revokeRemoteTools', scope: { taskId: 'task', generation: 1, toolCallId: 'revoke' }, explicitUserAction: true })).toEqual({ bindings: [] });
  await expect(handlers.get('launcher:agent-tools-revoke')!({}, { action: 'bindRemoteTools', explicitUserAction: true })).rejects.toThrow('only revokes');
  expect(coreReads).toBe(0);
});

test('script workspace picker grants no authority and lifecycle drain permits only observation and revocation', async () => {
  const handlers = new Map<string, (...args: any[]) => any>();
  const calls: any[] = [], admission = createLifecycleAdmission();
  let readinessReads = 0;
  registerAgentTools({ handle: (name: string, handler: any) => handlers.set(name, admission.guard(name, handler)),
    runtimeHost: { supervisor: { readConfig: () => ({ fixture: true }),
      ownedAgentRuntimeReady: async (_config: unknown, options: unknown) => { readinessReads++; calls.push({ readiness: options }); return true; },
      control: async (_config: unknown, endpoint: string, packet: any) => { calls.push({ endpoint, packet }); return { ok: true, value: { retained: true } }; } } },
    dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: ['/fixture/script-workspace'] }) } });
  expect(await handlers.get('launcher:agent-tools-pick-script-workspace')!({})).toEqual({ cancelled: false, root: '/fixture/script-workspace' });
  expect(readinessReads).toBe(0); expect(calls).toHaveLength(0);
  const scope = { taskId: 'script-task', generation: 2, toolCallId: 'workspace-review' };
  const transition = admission.acquire('script cleanup');
  try {
    expect(() => handlers.get('launcher:agent-tools')!({}, { action: 'grantScriptWorkspace', scope, root: '/fixture/script-workspace', access: 'read-write', acknowledgeRestrictions: true, explicitUserAction: true })).toThrow('Wait for');
    expect(() => handlers.get('launcher:agent-tools-pick-script-workspace')!({})).toThrow('Wait for');
    expect(() => handlers.get('launcher:agent-tools-revoke')!({}, { action: 'grantScriptWorkspace', explicitUserAction: true })).toThrow('only revokes');
    expect(await handlers.get('launcher:agent-tools-observe')!({}, { action: 'scriptStatus', scope })).toEqual({ retained: true });
    expect(await handlers.get('launcher:agent-tools-revoke')!({}, { action: 'revokeScriptWorkspace', scope, grantId: 'fixture-id', explicitUserAction: true })).toEqual({ retained: true });
    expect(calls.filter(row => row.readiness)).toEqual([{ readiness: { allowDraining: true } }, { readiness: { allowDraining: true } }]);
    expect(calls.filter(row => row.packet).map(row => row.packet.body.action)).toEqual(['scriptStatus', 'revokeScriptWorkspace']);
  } finally { admission.release(transition); }
});
