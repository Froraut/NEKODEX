import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const { AccountTunnelSupervisor } = createRequire(import.meta.url)('../launcher/electron/account-tunnel-supervisor.cjs');
test('real AccountTunnelPeer shutdown and exact restart retain identity without failed-Quit scheduling or spent-budget marker', async () => {
  const home = mkdtempSync(join(tmpdir(), 'ndx-real-peer-resume-')), events: string[] = [];
  const binding = { accountId: 'default', interactionMode: 'automatic', tunnel: { tunnelId: 'inert-id', alias: 'inert-alias', profileDir: join(home, 'profile') } };
  const config = { mode: 'full', accountTunnelMode: true, browserInteractionMode: 'automatic', automaticAppName: 'Inert connector', accountTunnels: [binding] };
  const logger = { info: (event: string) => events.push(event), warn: (event: string) => events.push(event), error: (event: string) => events.push(event) };
  const accounts = new AccountTunnelSupervisor({ app: {}, logger, coreHome: home, sourceRoot: home, readConfig: () => config }, () => {});
  accounts.configure(config); const peer = accounts.peers.get('default\0automatic');
  // Only transport/process-effect methods are inert. Actual peer, shutdown, stop,
  // resume admission, start preflight, marker writes and recovery budget are real.
  Object.assign(peer, { tunnel: { pid: process.pid }, runtimeStatus: 'ready',
    stopTunnelGracefully: async () => { peer.tunnel = null; peer.ownedTunnel = null; peer.verifiedTunnel = null; },
    assertTunnelClientReady() {}, waitForKnownTunnelStatus: async () => ({ absent: true, statusKnown: true, state: 'stopped', ready: false }),
    runTunnelStopCommand: async () => ({ code: 0, output: '' }), waitForTunnelStopped: async () => {},
    runTunnelConnectCommand: async () => ({ code: 0, output: '' }),
    waitForTunnel: async () => { peer.tunnel = { pid: process.pid, exitCode: null, signalCode: null }; },
    waitForTunnelMcpTransport: async () => {}, startTunnelMonitor() {},
  });
  try {
    const keys = accounts.ownedKeys(); await accounts.stop();
    expect(peer.shutdownRequested).toBe(true); expect(peer.runtimeStatus).toBe('stopped');
    peer.restartHistory.tunnel = Array(8).fill(Date.now()); peer.recoveryBackoffMs = { daemon: 0, tunnel: 300000 };
    // Establish the old helper's actual side effect on this real class, then
    // retire that fixture-only scheduled owner before exercising the new path.
    peer.allowRestartAfterQuitFailure();
    expect(peer.restartTimers.tunnel).not.toBeNull(); expect(events).toContain('runtime.recovery_backoff');
    await peer.shutdown();
    const previousBackoffs = events.filter(event => event === 'runtime.recovery_backoff').length;
    await accounts.restartOwned(keys);
    expect(accounts.peers.get('default\0automatic')).toBe(peer); expect(peer.runtimeStatus).toBe('ready');
    expect(peer.shutdownRequested).toBe(false); expect(peer.restartTimers.tunnel).toBeNull();
    expect(events.filter(event => event === 'runtime.account_tunnel_ready')).toHaveLength(1);
    expect(events.filter(event => event === 'runtime.recovery_backoff')).toHaveLength(previousBackoffs); expect(peer.recoveryTasks.size).toBe(0);
  } finally { peer.cancelRecoveries(); rmSync(home, { recursive: true, force: true }); }
});
