import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
const { RuntimeSupervisor } = createRequire(import.meta.url)('../launcher/electron/runtime-supervisor.cjs');
function fixture() {
  const events: string[] = [], config = { mode: 'full', accountTunnelMode: true, accountTunnels: [{ accountId: 'fixture' }] };
  const runtime = new RuntimeSupervisor({ app: {}, logger: { info() {}, warn() {}, error() {} }, coreHome: '/inert', sourceRoot: '/inert' });
  runtime.daemon = { pid: 123 }; let detached = false;
  Object.assign(runtime, { readConfig: () => config,
    runtimeSession: async (_: unknown, action: string) => { events.push(action); if (action === 'detach') detached = true; if (action === 'attach') detached = false; return { launcher_detached: detached }; },
    accountTunnelSupervisor: { stop: async () => { events.push('stop'); }, ownedKeys: () => ['old-owned'], restartOwned: async (keys: string[]) => { expect(keys).toEqual(['old-owned']); events.push('restart-owned'); }, snapshot: () => [{ ready: true }] },
    reportTunnelStatus: async () => { events.push('report'); } });
  return { runtime, events, config, detached: () => detached };
}
test('Native recovery temporarily stops owned peers and restores unchanged configuration without disposing daemon', async () => {
  const f = fixture(), daemon = f.runtime.daemon, saved = JSON.stringify(f.config);
  const value = await f.runtime.withNativeRecoveryQuiescence(async () => {
    f.events.push('proof'); expect(f.detached()).toBe(true); expect(f.runtime.stopping).toBe(true); return { state: 'reviewable' };
  });
  expect(value).toEqual({ state: 'reviewable' });
  expect(f.events).toEqual(['status', 'detach', 'stop', 'proof', 'restart-owned', 'attach', 'report']);
  expect(f.runtime.daemon).toBe(daemon); expect(JSON.stringify(f.config)).toBe(saved);
  expect(f.detached()).toBe(false); expect(f.runtime.stopping).toBe(false); expect(f.runtime.nativeRecoveryQuiescing).toBe(false);
});
test('foreign worker refusal and callback failure restore peers and preserve original refusal', async () => {
  for (const throws of [false, true]) {
    const f = fixture();
    const callback = async () => { f.events.push('proof'); if (throws) throw Object.assign(new Error('foreign worker'), { code: 'recovery_physical_owner_unverified' }); return { state: 'blocked', reasonCode: 'recovery_physical_owner_unverified' }; };
    if (throws) await expect(f.runtime.withNativeRecoveryQuiescence(callback)).rejects.toMatchObject({ code: 'recovery_physical_owner_unverified' });
    else expect(await f.runtime.withNativeRecoveryQuiescence(callback)).toMatchObject({ state: 'blocked' });
    expect(f.events.slice(-3)).toEqual(['restart-owned', 'attach', 'report']); expect(f.detached()).toBe(false);
  }
});
test('busy or unacknowledged idle fence never stops peers or calls recovery and compensates attach', async () => {
  const f = fixture(); f.runtime.runtimeSession = async (_: unknown, action: string) => {
    f.events.push(action); if (action === 'detach') throw new Error('active tool owner'); return { launcher_detached: false };
  };
  await expect(f.runtime.withNativeRecoveryQuiescence(async () => f.events.push('unexpected-proof'))).rejects.toThrow('active tool owner');
  expect(f.events).toEqual(['status', 'detach', 'attach', 'report']); expect(f.runtime.stopping).toBe(false);
});
test('partial stop and restore failure still attempt session attach and never run recovery after failed stop', async () => {
  const f = fixture(); f.runtime.accountTunnelSupervisor.stop = async () => { f.events.push('stop'); throw new Error('stop not terminal'); };
  f.runtime.accountTunnelSupervisor.restartOwned = async () => { f.events.push('restart-owned'); throw new Error('restore unavailable'); };
  await expect(f.runtime.withNativeRecoveryQuiescence(async () => f.events.push('unexpected-proof'))).rejects.toThrow('Restoring tool connections failed');
  expect(f.events).toEqual(['status','detach','stop','restart-owned','attach','report']); expect(f.runtime.nativeRecoveryQuiescing).toBe(false);
});
test('exact peer compensation does not start a configured peer that was deliberately stopped', async () => {
  const { AccountTunnelSupervisor } = createRequire(import.meta.url)('../launcher/electron/account-tunnel-supervisor.cjs');
  const f = fixture(), starts: string[] = [];
  const peers = new AccountTunnelSupervisor({}, () => {});
  const peer = (name: string, owned: boolean) => ({ tunnel: owned ? { pid: 12 } : null, runtimeStatus: owned ? 'ready' : 'stopped',
    async shutdown() { this.tunnel = null; this.runtimeStatus = 'stopped'; return { status: 'stopped' }; },
    allowRestartAfterQuitFailure() {}, async startIfConfigured() { starts.push(name); this.runtimeStatus = 'ready'; return { status: 'ready' }; } });
  peers.peers.set('old-owned', peer('old-owned', true)); peers.peers.set('deliberately-stopped', peer('deliberately-stopped', false));
  f.runtime.accountTunnelSupervisor = peers; f.runtime.reportTunnelStatus = async () => {};
  await f.runtime.withNativeRecoveryQuiescence(async () => ({ state: 'reviewable' }));
  expect(starts).toEqual(['old-owned']); expect(peers.peers.get('deliberately-stopped').runtimeStatus).toBe('stopped');
});

test('validated recovery pause refusal reconciles exact Apply action without calling authority or replaying', async () => {
  const { registerNativeAccounts } = createRequire(import.meta.url)('../launcher/electron/ipc/native-accounts.cjs');
  const handlers = new Map<string, Function>(); let calls = 0, pauses = 0;
  const actionId = '11111111-1111-4111-8111-111111111111';
  registerNativeAccounts({ handle: (name: string, handler: Function) => handlers.set(name, handler),
    withOwnerRecovery: async () => { pauses++; throw Object.assign(new Error('active tool owner'), { actionRecorded: false }); },
    getAuthority: () => ({ inspect: () => ({ available: false, profiles: [], activeCount: 0, receipts: [] }), recoverOwner: async () => { calls++; } }) });
  const handle = handlers.get('launcher:native-accounts')!;
  const rejected = await handle(null, { action: 'recover-owner', actionId, reviewDigest: 'a'.repeat(64) });
  expect(rejected.rejectedAction).toEqual({ actionId, knownNotStarted: true });
  const observed = await handle(null, { action: 'status', actionId });
  expect(observed.rejectedAction).toEqual(rejected.rejectedAction); expect(calls).toBe(0); expect(pauses).toBe(1);
  await expect(handle(null, { action: 'recover-owner', actionId, reviewDigest: 'bad' })).rejects.toThrow('Invalid Native recovery review');
  expect(pauses).toBe(1);
});

test('real legacy startTunnel compensation accepts explicit start while scheduled recovery remains fenced', async () => {
  const f = fixture(); f.config.accountTunnelMode = false;
  f.runtime.tunnel = { pid: 10 }; let adopted = false;
  Object.assign(f.runtime, {
    stopTunnelGracefully: async () => { f.runtime.tunnel = null; },
    assertTunnelClientReady() {},
    waitForKnownTunnelStatus: async () => {
      expect(f.runtime.stopping).toBe(true);
      f.runtime.scheduleRecovery('tunnel'); expect(f.runtime.restartTimers.tunnel).toBeNull();
      return { ready: true, pid: 11 };
    },
    waitForTunnelMcpTransport: async () => { adopted = true; expect(f.runtime.stopping).toBe(true); },
    startTunnelMonitor() {},
  });
  await f.runtime.withNativeRecoveryQuiescence(async () => ({ state: 'reviewable' }));
  expect(adopted).toBe(true); expect(f.runtime.tunnel.pid).toBe(11); expect(f.runtime.stopping).toBe(false);
});
