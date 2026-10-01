const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { RuntimeHost } = require('../electron/runtime.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-tunnel-transition-'));
const configPath = path.join(root, 'config.json'), binary = path.join(root, 'unused-client');
const events = []; let busy = true;
const config = { version: 3, releaseVersion: 'test', mode: 'browser-only', browserInteractionMode: 'automatic',
  tunnel: { binaryPath: binary }, subagentProtocol: 'native' };
fs.writeFileSync(binary, 'unused test-only placeholder'); fs.writeFileSync(configPath, JSON.stringify(config));
const host = Object.create(RuntimeHost.prototype);
Object.assign(host, { coreHome: root, platform: process.platform, launcherProfile: 'production', app: { getVersion: () => 'test' },
  logger: { warn() {} },
  getBrowserInteractionMode: () => 'automatic', currentOperation: () => null,
  runtimeConfigSnapshot: () => ({ configured: true, owner: 'launcher', config: JSON.parse(fs.readFileSync(configPath)) }),
  supervisor: { configPath,
    getAccountTunnelStatus: () => ({ ready: true }),
    async stopForSetup() { events.push('idle-drain'); if (busy) throw Object.assign(new Error('active Native work'), { code: 'RUNTIME_NOT_IDLE' }); },
    async startIfConfigured() { events.push('core-start'); },
    async prepareAccountTunnelChange(id, mode) { events.push(`peer-stop:${id}:${mode}`); },
    async syncAccountTunnels() { events.push('peer-sync'); },
  } });
const input = suffix => ({ tunnelId: 'tunnel_' + suffix.repeat(32), runtimeKey: 'synthetic-private-key' });
async function main() {
  try {
    const before = fs.readFileSync(configPath);
    await assert.rejects(host.configureAccountTunnel('default', input('a')), /active Native work/);
    assert.equal(events[0], 'idle-drain'); assert.deepEqual(fs.readFileSync(configPath), before);
    assert.equal(fs.readdirSync(path.join(root, 'secrets/account-tunnels')).length, 0);
    busy = false; events.length = 0;
    await host.configureAccountTunnel('default', input('a'));
    assert.deepEqual(events, ['idle-drain', 'core-start']);
    assert.equal(JSON.parse(fs.readFileSync(configPath)).mode, 'full');
    events.length = 0;
    const second = '00000000-0000-4000-8000-000000000002';
    await host.configureAccountTunnel(second, input('b'));
    assert.deepEqual(events, [`peer-stop:${second}:automatic`, 'peer-sync']);
    assert.equal(JSON.parse(fs.readFileSync(configPath)).accountTunnels.length, 2);
    events.length = 0;
    host.supervisor.syncAccountTunnels = async () => { events.push('peer-sync'); throw new Error('injected post-commit startup error'); };
    const saved = await host.configureAccountTunnel(second, { ...input('b'), runtimeKey: 'rotated-private-key-fixture' });
    assert.deepEqual(saved, { ok: true, saved: true, ready: false, recoveryRequired: true });
    const binding = JSON.parse(fs.readFileSync(configPath)).accountTunnels.find(item => item.accountId === second);
    assert.equal(fs.readFileSync(binding.tunnel.runtimeKeyFile, 'utf8'), 'rotated-private-key-fixture');
    events.length = 0;
    const removed = await host.removeAccountTunnel(second);
    assert.deepEqual(removed, { ok: true, saved: true, ready: false, recoveryRequired: true });
    assert.deepEqual(events, [`peer-stop:${second}:automatic`, 'peer-sync']);
    assert.equal(JSON.parse(fs.readFileSync(configPath)).accountTunnels[0].accountId, 'default');
    console.log('ACCOUNT_TUNNEL_TRANSITION_OK idle-first-enable own-peer-update committed-recovery-receipt');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
