import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const require = createRequire(import.meta.url);
const { registerAgentTools } = require('../launcher/electron/ipc/agent-tools.cjs');
const { registerConversationHistory } = require('../launcher/electron/ipc/conversation-history.cjs');
const { createAgentOAuthIpc } = require('../launcher/electron/ipc/agent-oauth.cjs');

test('new launcher controls share exact core admission, main-owned OAuth and single native Python selection without executing work', async () => {
  const temporary = realpathSync(mkdtempSync(join(tmpdir(), 'nekodex-controls-ipc-'))), source = join(temporary, 'native-source');
  mkdirSync(source);
  const handlers = new Map<string, (...args: any[]) => any>(), control: any[] = [], readiness: any[] = [], registrations: any[] = [], oauthRequests: any[] = [];
  const handle = (channel: string, fn: any) => { if (handlers.has(channel)) throw new Error('Duplicate fixture channel'); handlers.set(channel, fn); };
  const invoke = (channel: string, ...args: any[]) => handlers.get(channel)!({}, ...args);
  const config = { name: 'selected-package', version: '1.0', backend: 'reviewed_backend', buildRequires: ['reviewed-backend==1.0'] };
  const scope = { taskId: randomUUID(), generation: 4, toolCallId: 'selected-build-review' };
  let draining = false, coreAvailable = true, coreConfigReads = 0;
  const runtimeHost = { supervisor: {
    readConfig() { coreConfigReads++; return coreAvailable ? { instance: 'owned-core' } : null; },
    async ownedAgentRuntimeReady(_config: any, options: any) { readiness.push(options); return !draining || options.allowDraining === true; },
    async control(_config: any, endpoint: string, packet: any) {
      control.push({ endpoint, ...packet });
      return { ok: true, value: packet.body.action === 'status'
        ? { servers: [{ id: 'retained-stdio' }], capabilities: { stdio: true, protectedOAuth: false } }
        : { action: packet.body.action, scope: packet.body.scope } };
    },
  } };
  let releaseSource!: (value: any) => void;
  const sourceGate = new Promise(resolve => { releaseSource = resolve; });
  let sourceBlocked = true; const openCalls: any[] = [], choices = [2, 0, 1];
  const nativeSelections = [{ canceled: false, filePaths: [source] }, { canceled: false, filePaths: [join(temporary, 'native-backend.whl')] }];
  const dialog = {
    async showOpenDialog(...args: any[]) { openCalls.push(args.at(-1)); if (sourceBlocked) { sourceBlocked = false; return sourceGate; } return nativeSelections.shift(); },
    async showMessageBox() { return { response: choices.shift() }; },
  };
  const summary = { selectionId: randomUUID(), name: config.name, version: config.version, sourceKind: 'tree', sourceFileCount: 1,
    buildWheelCount: 1, runtimeWheelCount: 0, bytes: 42, snapshotDigest: 'a'.repeat(64), excludedEntries: 0 };
  const service = { async register(...args: any[]) { registrations.push(args); return summary; } };
  const oauthIpc = createAgentOAuthIpc({ handle, dialog, service: {
    handles: (action: string) => ['oauthList', 'oauthBegin'].includes(action),
    async request(body: any) { oauthRequests.push(body); return { mainOwned: true, action: body.action }; },
    status: () => ({ oauthProviders: [{ id: 'redacted-provider' }], capabilities: { protectedOAuth: true } }),
  } });
  registerAgentTools({ handle, runtimeHost, dialog, pythonBuildSelectionService: service, oauthIpc });
  registerConversationHistory({ handle, runtimeHost });
  try {
    // Known new mutation bodies reach only the existing core control once, with no observation privilege.
    const review = { action: 'reviewPythonBuild', actionId: randomUUID(), selectionId: summary.selectionId, scope, explicitUserAction: true };
    const grant = { action: 'grantVmNetwork', scope, policy: { origins: ['https://approved.invalid'] }, explicitUserAction: true };
    await invoke('launcher:agent-tools', review); await invoke('launcher:agent-tools', grant);
    expect(control.map(row => row.body)).toEqual([review, grant]);
    expect(readiness).toEqual([{ allowDraining: false }, { allowDraining: false }]);
    draining = true;
    const buildStatus = { action: 'pythonBuildStatus', scope }, networkStatus = { action: 'vmNetworkStatus', scope };
    await invoke('launcher:agent-tools-observe', buildStatus); await invoke('launcher:agent-tools-observe', networkStatus);
    const transcript = { action: 'transcript-native-status', taskId: scope.taskId, scope: { familyId: 'owned-family', generation: 4, revision: 2 } };
    const revoke = { ...transcript, action: 'transcript-native-consent', enabled: false };
    await invoke('launcher:conversation-history', transcript); await invoke('launcher:conversation-history-revoke', revoke);
    expect(control.slice(2).map(row => row.body)).toEqual([buildStatus, networkStatus, transcript, revoke]);
    expect(readiness.slice(2)).toEqual(Array.from({ length: 4 }, () => ({ allowDraining: true })));
    const controlsBeforeRefusal = control.length;
    await expect(invoke('launcher:conversation-history', { ...revoke, enabled: true, consent: true })).rejects.toThrow('current NEKODEX runtime');
    expect(() => invoke('launcher:conversation-history-revoke', { ...revoke, enabled: true })).toThrow('only revokes');
    await expect(invoke('launcher:agent-tools-observe', { action: 'attachPythonBuild', actionId: review.actionId, scope, explicitUserAction: true })).rejects.toThrow('only observes');
    expect(control).toHaveLength(controlsBeforeRefusal);
    expect(readiness.at(-1)).toEqual({ allowDraining: false });

    // OAuth interception uses the injected main owner even when core is absent; status overlays only its metadata.
    coreAvailable = false; const beforeOAuth = coreConfigReads;
    await invoke('launcher:agent-tools-observe', { action: 'oauthList' });
    await invoke('launcher:agent-tools', { action: 'oauthBegin', providerId: 'registered-provider', explicitUserAction: true });
    expect(coreConfigReads).toBe(beforeOAuth); expect(control).toHaveLength(controlsBeforeRefusal);
    expect(oauthRequests.map(row => row.action)).toEqual(['oauthList', 'oauthBegin']);
    coreAvailable = true;
    const status = await invoke('launcher:agent-tools', { action: 'status' });
    expect(status).toEqual({ servers: [{ id: 'retained-stdio' }], oauthProviders: [{ id: 'redacted-provider' }], capabilities: { stdio: true, protectedOAuth: true } });

    // The actual picker stays single-owner across awaits. Cancelling native selection registers nothing.
    const first = invoke('launcher:agent-tools-pick-python-build-selection', scope, config);
    await expect(invoke('launcher:agent-tools-pick-python-build-selection', scope, config)).rejects.toThrow('unavailable');
    expect(openCalls).toHaveLength(1); expect(registrations).toHaveLength(0);
    releaseSource({ canceled: false, filePaths: [source] });
    expect(await first).toEqual({ cancelled: true }); expect(registrations).toHaveLength(0);
    const selected = await invoke('launcher:agent-tools-pick-python-build-selection', scope, config);
    expect(selected).toEqual({ cancelled: false, selection: summary });
    expect(registrations).toEqual([[scope, { source: { kind: 'tree', path: source }, buildWheelPaths: [join(temporary, 'native-backend.whl')], runtimeWheelPaths: [], config }, true]]);
    expect(JSON.stringify(selected)).not.toContain(temporary);
    const dialogCount = openCalls.length;
    await expect(invoke('launcher:agent-tools-pick-python-build-selection', scope, { ...config, sourcePath: '/renderer-supplied/source' })).rejects.toThrow('unavailable');
    expect(openCalls).toHaveLength(dialogCount); expect(registrations).toHaveLength(1);
    expect(control.filter(row => ['reviewPythonBuild', 'grantVmNetwork'].includes(row.body.action))).toHaveLength(2);
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}, 5000);
