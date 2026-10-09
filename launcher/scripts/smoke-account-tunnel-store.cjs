const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const store = require('../electron/account-tunnels.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-account-tunnels-'));
const actual = path.join(root, 'generation.json'), configPath = path.join(root, 'config.json');
const idA = 'tunnel_' + 'a'.repeat(32), idB = 'tunnel_' + 'b'.repeat(32);
try {
  fs.writeFileSync(actual, JSON.stringify({ version: 3, mode: 'browser-only', browserInteractionMode: 'automatic',
    subagentProtocol: 'native', marker: 'preserve-route-and-settings' }));
  fs.symlinkSync(actual, configPath);
  const prepare = (accountId, tunnelId, runtimeKey, extra = {}) => store.prepareAccountTunnel({
    coreHome: root, configPath, accountId, tunnelId, runtimeKey, ...extra });
  const a = prepare('default', idA, 'synthetic-a', { principalFingerprint: '1'.repeat(64) });
  assert.equal(store.accountTunnelConfigSnapshot(configPath).config.accountTunnels, undefined);
  store.commitAccountTunnel(a);
  const b = prepare('00000000-0000-4000-8000-000000000002', idB, 'synthetic-b'); store.commitAccountTunnel(b);
  const config = store.accountTunnelConfigSnapshot(configPath).config;
  assert.equal(fs.lstatSync(configPath).isSymbolicLink(), true);
  assert.equal(config.subagentProtocol, 'native'); assert.equal(config.marker, 'preserve-route-and-settings');
  const ownA = store.accountTunnelFor(config, 'default'), ownB = store.accountTunnelFor(config, '00000000-0000-4000-8000-000000000002');
  assert.notEqual(ownA.tunnel.runtimeKeyFile, ownB.tunnel.runtimeKeyFile);
  assert.notEqual(ownA.tunnel.profileDir, ownB.tunnel.profileDir);
  assert.equal(fs.readFileSync(ownA.tunnel.runtimeKeyFile, 'utf8'), 'synthetic-a');
  assert.equal(fs.statSync(ownA.tunnel.runtimeKeyFile).mode & 0o777, 0o600);
  const devRoot = path.join(root, 'separate-dev-profile');
  fs.mkdirSync(devRoot);
  const devConfig = path.join(devRoot, 'config.json');
  fs.writeFileSync(devConfig, JSON.stringify({ mode: 'browser-only', browserInteractionMode: 'automatic' }));
  const dev = store.prepareAccountTunnel({ coreHome: devRoot, configPath: devConfig,
    accountId: 'default', tunnelId: idA, runtimeKey: 'synthetic-dev' });
  assert.notEqual(dev.binding.tunnel.alias, ownA.tunnel.alias,
    'global tunnel-client aliases must not collide between application profiles');
  assert.notEqual(dev.binding.tunnel.profileName, ownA.tunnel.profileName);
  const same = prepare('default', idA, undefined, { reuseSavedCredentials: true });
  assert.equal(same.binding.tunnel.alias, ownA.tunnel.alias, 'reconnect retains the same profile-scoped alias');
  assert.equal(store.accountTunnelFor(config, '00000000-0000-4000-8000-000000000004'), undefined);
  assert.equal(store.accountTunnelFor(config, 'default', 'manual'), undefined);
  assert.throws(() => prepare('00000000-0000-4000-8000-000000000003', idA, 'synthetic-c'), /already belongs/);
  assert.throws(() => prepare('00000000-0000-4000-8000-000000000003', idB, undefined, { reuseSavedCredentials: true }), /already belongs/);
  const publicView = store.accountTunnelView(config, 'default', 'automatic', {
    tunnelId: idA, status: 'ready', ready: true }, '1'.repeat(64));
  assert.equal(publicView.ready, true);
  assert.equal(JSON.stringify(publicView).includes('runtimeKey'), false);
  assert.equal(store.accountTunnelView(config, 'default', 'automatic', {
    tunnelId: idA, status: 'ready', ready: true }, '2'.repeat(64)).ready, false);
  const change = prepare('00000000-0000-4000-8000-000000000002', idB, 'replacement');
  fs.writeFileSync(actual, JSON.stringify({ ...config, marker: 'newer-writer' }));
  assert.throws(() => store.commitAccountTunnel(change), /configuration changed/);
  store.discardAccountTunnel(change);
  assert.equal(fs.existsSync(change.createdKey), false);
  const removed = store.prepareRemoveAccountTunnel({ configPath, accountId: 'default' });
  store.commitAccountTunnel(removed);
  const after = store.accountTunnelConfigSnapshot(configPath).config;
  assert.equal(store.accountTunnelFor(after, 'default'), undefined);
  assert.equal(store.accountTunnelFor(after, '00000000-0000-4000-8000-000000000002').tunnel.tunnelId, idB);
  assert.equal(fs.existsSync(ownA.tunnel.runtimeKeyFile), true);
  console.log('ACCOUNT_TUNNEL_STORE_OK own-bindings unique-keys no-fallback identity symlink CAS removal');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
