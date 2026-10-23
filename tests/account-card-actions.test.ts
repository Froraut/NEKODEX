import { afterEach, expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const require = createRequire(import.meta.url);
const { createAccountRegistry } = require('../launcher/electron/account-registry.cjs');
const { AccountBrowserPool } = require('../launcher/electron/account-pool.cjs');
const { RuntimeHost } = require('../launcher/electron/runtime.cjs');
const dirs: string[] = [];
const directory = () => { const dir = mkdtempSync(join(tmpdir(), 'nekodex-card-actions-')); dirs.push(dir); return dir; };
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const id = '11111111-1111-4111-8111-111111111111';
function runtime(failMode?: string) {
  const configPath = join(directory(), 'runtime.json');
  const binding = (accountId: string, interactionMode: string, n: number) => ({ accountId, interactionMode,
    tunnel: { tunnelId: `tunnel_${String(n).repeat(32)}`, alias: `alias-${n}`, binaryPath: '/fixture/tunnel-client',
      profileDir: `/fixture/profile-${n}`, profileName: `profile-${n}`, runtimeKeyFile: `/fixture/retained-key-${n}` } });
  const bindings = [binding(id, 'automatic', 1), binding(id, 'manual', 2), binding('default', 'automatic', 3)];
  const config = { mode: 'full', accountTunnelMode: true, browserInteractionMode: 'automatic', accountTunnels: bindings,
    tunnel: bindings[0].tunnel, automaticTunnel: bindings[0].tunnel, manualTunnel: bindings[1].tunnel };
  writeFileSync(configPath, JSON.stringify(config));
  const events: string[] = [];
  const host = Object.assign(Object.create(RuntimeHost.prototype), {
    runtimeConfigSnapshot: () => ({ configured: true }),
    supervisor: { configPath, accountPeers: () => ({ configure() { events.push('configure'); },
      async prepareChange(accountId: string, mode: string) { events.push(`stop:${accountId}:${mode}`); if (failMode === mode) throw new Error('shutdown refused'); } }),
      async syncAccountTunnels() { events.push('recover'); } },
  });
  return { host, configPath, config, events };
}

test('rename persists the same owner and removed owners remain explicit after restart', () => {
  const dir = directory(); const registry = createAccountRegistry(dir);
  const owner = registry.add('Work').selectedId;
  registry.rename(owner, '  Production  ');
  expect(createAccountRegistry(dir).snapshot().accounts.find((row: any) => row.id === owner)?.label).toBe('Production');
  expect(() => registry.rename(owner, ' ')).toThrow();
  expect(() => registry.remove('default')).toThrow('built-in');
  registry.setEnabled('default', false);
  expect(() => registry.remove(owner)).toThrow('last enabled');
  registry.setEnabled('default', true); registry.remove(owner);
  const restored = createAccountRegistry(dir);
  expect(restored.snapshot().selectedId).toBe('default');
  expect(restored.snapshot().accounts.some((row: any) => row.id === owner)).toBe(false);
  expect(restored.hasRetainedOwner(owner)).toBe(true);
  expect(restored.isRemoved(owner)).toBe(true);
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), { registry: restored });
  try { pool.getHost(owner); throw new Error('unexpected success'); } catch (error: any) { expect(error.code).toBe('account_removed'); }
  expect(() => restored.select(owner)).toThrow();
});

test('both exact owned modes stop before routing is removed and metadata commits', async () => {
  const { host, configPath, events } = runtime();
  await host.removeAccountBindings(id, () => {
    expect(JSON.parse(readFileSync(configPath, 'utf8')).accountTunnels.map((row: any) => row.accountId)).toEqual(['default']);
    events.push('tombstone');
  });
  expect(events).toEqual(['configure', `stop:${id}:automatic`, `stop:${id}:manual`, 'tombstone']);
  expect(host.currentOperation()).toBeNull();
});

test('refused shutdown preserves config and metadata; metadata failure restores config before recovery', async () => {
  const refused = runtime('manual'); let commits = 0;
  await expect(refused.host.removeAccountBindings(id, () => { commits++; })).rejects.toThrow('shutdown refused');
  expect(commits).toBe(0);
  expect(JSON.parse(readFileSync(refused.configPath, 'utf8'))).toEqual(refused.config);
  const failed = runtime();
  await expect(failed.host.removeAccountBindings(id, () => { throw new Error('registry disk failed'); })).rejects.toThrow('registry disk failed');
  expect(JSON.parse(readFileSync(failed.configPath, 'utf8'))).toEqual(failed.config);
  expect(failed.events.at(-1)).toBe('recover');
});

test('CAS refuses an intervening config write after exact peers stop', async () => {
  const fixture = runtime(); let commits = 0;
  const original = fixture.host.supervisor.accountPeers;
  fixture.host.supervisor.accountPeers = () => { const peer = original(); return { ...peer,
    async prepareChange(owner: string, mode: string) { await peer.prepareChange(owner, mode); if (mode === 'manual') writeFileSync(fixture.configPath, JSON.stringify({ external: true })); },
  }; };
  await expect(fixture.host.removeAccountBindings(id, () => { commits++; })).rejects.toThrow('configuration changed');
  expect(commits).toBe(0); expect(JSON.parse(readFileSync(fixture.configPath, 'utf8'))).toEqual({ external: true });
});

test('reauth confirms and holds exact lease across logout/login despite another selected account', async () => {
  const calls: string[] = []; let selected = id; let releaseLogout!: () => void;
  const logout = new Promise<void>(resolve => { releaseLogout = resolve; });
  const host = { browserInteractionMode: () => 'automatic', async logout() { calls.push('logout-own'); await logout; }, async openLogin() { calls.push('login-own'); } };
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry: { snapshot: () => ({ selectedId: selected }) }, selectionRevision: 0,
    assertAccountOperationAvailable() {}, async selectAccount(owner: string) { selected = owner; },
    acquireAccountOperation(owner: string) { expect(owner).toBe(id); calls.push('lease'); return () => calls.push('release'); },
    getHost(owner: string) { expect(owner).toBe(id); return host; }, invalidateEvidence(owner: string) { expect(owner).toBe(id); calls.push('invalidate'); },
    toolProof: { forget(owner: string) { expect(owner).toBe(id); calls.push('forget'); } }, snapshot: () => ({ accountId: selected }),
  });
  await expect(pool.reauthenticateAccount(id, false)).rejects.toThrow('Confirm');
  expect(calls).toEqual([]);
  const result = pool.reauthenticateAccount(id, true);
  await new Promise(resolve => setImmediate(resolve));
  expect(calls).toEqual(['lease', 'invalidate', 'logout-own']);
  selected = 'default'; pool.selectionRevision++; releaseLogout(); await result;
  expect(calls).toEqual(['lease', 'invalidate', 'logout-own', 'forget', 'login-own', 'release']);
  expect(pool.embeddedLoginLeases.size).toBe(0);
});

test('removal refuses even a settled task draft or open workspace before touching runtime', async () => {
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry: { assertRemovable() {} }, getHost: () => ({ turnTabs: new Map([['draft', { status: 'ready' }]]) }),
  });
  let touched = false;
  await expect(pool.removeAccount(id, () => { touched = true; })).rejects.toThrow('Close');
  expect(touched).toBe(false);
});

test('pool commits removal before retiring only its idle host and preserves old affinity', async () => {
  const registry = createAccountRegistry(directory()); const owner = registry.add('Work').selectedId;
  const events: string[] = [];
  const own = { turnTabs: new Map(), async ready() {}, destroy() { events.push('destroy-own'); }, syncViewVisibility() {} };
  const primary = { turnTabs: new Map(), async ready() { events.push('ready-fallback'); }, syncViewVisibility() {} };
  const affinity = new Map([['a'.repeat(64), owner]]);
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry, hosts: new Map([[owner, own], ['default', primary]]), affinity, selectionRevision: 0,
    evidenceRestores: new Map(), evidenceRefreshing: new Set(), workspaceRegistrations: new Map(),
    workspaceSessionMutations: new Map(), capabilities: new Map(), connectors: new Map(), publishedAuthentication: new Map(),
    acquireAccountOperation(requested: string) { expect(requested).toBe(owner); return () => { events.push('release'); }; },
    writeDescriptor() { expect(registry.snapshot().selectedId).toBe('default'); expect(this.hosts.has(owner)).toBe(false); events.push('descriptor'); },
    publish() {}, accountSnapshot: () => registry.snapshot(),
  });
  const result = await pool.removeAccount(owner, async (commit: () => void) => {
    expect(registry.snapshot().accounts.some((row: any) => row.id === owner)).toBe(true);
    events.push('retire-bindings'); commit();
    expect(registry.isRemoved(owner)).toBe(true);
  });
  expect(result.accounts.map((row: any) => row.id)).toEqual(['default']);
  expect(events).toEqual(['ready-fallback', 'retire-bindings', 'destroy-own', 'descriptor', 'release']);
  expect(affinity.get('a'.repeat(64))).toBe(owner);
  expect(pool.hosts.get('default')).toBe(primary);
});

test('failed peer recovery remains an explicit failure after config rollback', async () => {
  const fixture = runtime();
  fixture.host.supervisor.syncAccountTunnels = async () => { throw new Error('peer restart refused'); };
  await expect(fixture.host.removeAccountBindings(id, () => { throw new Error('metadata refused'); })).rejects.toThrow('peer recovery needs inspection');
  expect(JSON.parse(readFileSync(fixture.configPath, 'utf8'))).toEqual(fixture.config);
  expect(fixture.host.currentOperation()).toBeNull();
});

test('missing config cannot hide a still-owned scoped tunnel peer', async () => {
  const pool = Object.assign(Object.create(RuntimeHost.prototype), {
    runtimeConfigSnapshot: () => ({ configured: false }),
    supervisor: { accountTunnelSupervisor: { peers: new Map([['owned', { binding: { accountId: id } }]]) } },
  });
  let commits = 0;
  await expect(pool.removeAccountBindings(id, () => { commits++; })).rejects.toThrow('repair the runtime');
  expect(commits).toBe(0);
});
