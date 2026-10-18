import { expect, test } from "bun:test";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { registerAgentTools } = require("../launcher/electron/ipc/agent-tools.cjs");
const { createLifecycleAdmission } = require("../launcher/electron/lifecycle-admission.cjs");
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
