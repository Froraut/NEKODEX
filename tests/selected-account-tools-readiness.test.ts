import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { currentToolProof } from '../launcher/src/launcher-readiness';
import { deriveWorkspaceReadiness, workspaceReadinessInput } from '../launcher/src/workspace-readiness';
import type { BrowserState, LauncherSnapshot } from '../launcher/src/types';

const require = createRequire(import.meta.url);
const { AccountBrowserPool } = require('../launcher/electron/account-pool.cjs');
const selected = 'cf9444fa-df26-4328-96c9-38741290ac83';
const other = '00000000-0000-4000-8000-000000000001';
const connector = 'Fixture account connector';

function fixture() {
  const registry = { selectedId: selected, accounts: [{ id: selected, label: 'Prim3 fixture' }, { id: other, label: 'Other fixture' }] };
  let mode = 'automatic';
  const hosts = new Map(registry.accounts.map(({ id }) => {
    const state = { authenticated: true, authenticationStatus: 'verified', status: 'ready', tabs: [] };
    return [id, { state, connectorName: () => connector, snapshot: () => ({ ...state }), turnTabSnapshots: () => [] }];
  }));
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry: { snapshot: () => registry }, hosts, getHost: (id: string) => hosts.get(id),
    options: { getBrowserInteractionMode: () => mode, getAccountTunnel: (accountId: string, interactionMode: string) =>
      ({ accountId, interactionMode, ready: accountId === selected && interactionMode === 'automatic' }) },
    capabilities: new Map([[selected, {}]]), connectors: new Map([[selected, connector]]),
    evidenceEpochs: new Map(), observationSourceId: 'fixture-pool', observationRevision: 1,
  });
  const snapshot = (browser = pool.snapshot()): LauncherSnapshot => ({
    profile: 'production', browser, connectorName: connector, mcpCredentialsConfigured: true,
    state: { browserInteractionMode: mode, mcpSetupComplete: false, mcpRuntimeInstalled: true,
      coreSetupComplete: true, codexCatalogVerified: true, codexPickerConfirmed: true },
    smokePassed: true, runtimeCapabilities: { runtimeStatus: 'ready', nativeAvailability: 'ready',
      webAvailability: 'ready', brokerReady: true, tunnelStatus: 'ready' },
  } as LauncherSnapshot);
  return { pool, registry, hosts, snapshot, setMode: (value: string) => { mode = value; } };
}

test('selected Prim3 own verified connector makes global Connections and Overview ready while the legacy flag is false', () => {
  const { pool, snapshot } = fixture();
  const browser = pool.snapshot() as BrowserState;
  expect(browser.accountTools).toEqual({ accountId: selected, interactionMode: 'automatic',
    checked: true, connectorReady: true, tunnelReady: true });
  const launcher = snapshot(browser);
  expect(launcher.state.mcpSetupComplete).toBe(false);
  const proof = currentToolProof(launcher, null, browser);
  expect(proof).toBe(true);
  expect(deriveWorkspaceReadiness(workspaceReadinessInput({ snapshot: launcher, browser,
    catalogFailure: null, toolsVerified: proof })).connections.tools).toMatchObject({ key: 'verified', ready: true });
});

test('identity invalidation, another selected account, mismatched mode or unavailable own tunnel never borrow global proof', () => {
  const { pool, registry, hosts, snapshot } = fixture();
  const old = snapshot(); old.state.mcpSetupComplete = true;
  pool.invalidateEvidence(selected);
  expect(currentToolProof(old, null, pool.snapshot())).toBe(false);
  pool.capabilities.set(selected, {}); pool.connectors.set(selected, connector);
  hosts.get(selected)!.state.authenticationStatus = 'unavailable';
  expect(currentToolProof(old, null, pool.snapshot())).toBe(false);
  hosts.get(selected)!.state.authenticationStatus = 'verified';
  registry.selectedId = other;
  expect(currentToolProof(old, null, pool.snapshot())).toBe(false);
  registry.selectedId = selected;
  const browser = pool.snapshot() as BrowserState;
  expect(currentToolProof(old, null, { ...browser, accountTools: { ...browser.accountTools!, accountId: other } })).toBe(false);
  expect(currentToolProof(old, null, { ...browser, accountTools: { ...browser.accountTools!, interactionMode: 'manual' } })).toBe(false);
  expect(currentToolProof(old, null, { ...browser, accountTools: undefined })).toBe(false);
  pool.options.getAccountTunnel = () => ({ accountId: other, interactionMode: 'automatic', ready: true });
  expect(currentToolProof(old, null, pool.snapshot())).toBe(false);
  pool.options.getAccountTunnel = () => ({ accountId: selected, interactionMode: 'manual', ready: true });
  expect(currentToolProof(old, null, pool.snapshot())).toBe(false);
});

test('explicit Manual and legacy default proofs keep their contract, including name and runtime failure guards', () => {
  const { snapshot, setMode } = fixture();
  setMode('manual');
  const manual = snapshot(); manual.state.mcpSetupComplete = true;
  expect(currentToolProof(manual, null)).toBe(true);
  manual.state.mcpSetupComplete = false;
  expect(currentToolProof(manual, null)).toBe(false);
  setMode('automatic');
  const legacy = snapshot({ accountId: 'default', authenticated: true, authenticationStatus: 'verified' } as BrowserState);
  legacy.state.mcpSetupComplete = true;
  expect(currentToolProof(legacy, null)).toBe(true);
  legacy.state.setupConnectorName = 'Another connector';
  expect(currentToolProof(legacy, null)).toBe(false);
  const ready = snapshot();
  expect(currentToolProof(ready, { name: 'runtime-start', status: 'failed' } as never)).toBe(false);
  ready.runtimeCapabilities!.tunnelStatus = 'failed';
  expect(currentToolProof(ready, null)).toBe(false);
});
