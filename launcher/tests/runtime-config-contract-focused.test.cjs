const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeSetupConfig, validateConfig } = require('../electron/runtime-config-contract.cjs');
const facade = require('../electron/runtime-supervisor.cjs');

test('setup normalization preserves legacy compatibility without runtime authority', () => {
  const legacy = { mode: 'pro-only' };
  assert.deepEqual(normalizeSetupConfig(legacy), { mode: 'browser-only' });
  assert.equal(legacy.mode, 'pro-only');
  assert.throws(() => validateConfig(legacy, '/descriptor'), /missing or unsupported/);
  assert.throws(() => normalizeSetupConfig(legacy, 'development'), /DEV launcher refuses/);
  assert.throws(() => normalizeSetupConfig({ ...legacy, purpose: 'dev-harness' }), /Production launcher refuses/);
  assert.equal(normalizeSetupConfig({ ...legacy, purpose: 'dev-harness' }, 'development').mode, 'browser-only');
  assert.throws(() => normalizeSetupConfig([]), /not an object/);
  assert.throws(() => normalizeSetupConfig({ mode: 'unknown' }), /invalid setup mode/);
  assert.equal(facade.validateConfig, validateConfig);
});

test('strict contract keeps identity and active tunnel mismatch rejection', () => {
  const tunnel = { binaryPath: '/bin/tunnel', tunnelId: `tunnel_${'a'.repeat(32)}`, runtimeKeyFile: '/key', profileDir: '/profile', profileName: 'p', alias: 'a' };
  const config = { version: 3, releaseVersion: '1.0.0', mode: 'full', browserInteractionMode: 'automatic',
    browserHost: 'launcher', browserHostDescriptorPath: '/descriptor', host: '127.0.0.1', port: 1234,
    controlToken: 'a'.repeat(40), contextWindow: 100, appName: 'test', chromeExecutablePath: '/chrome',
    storageStatePath: '/storage', brokerSocketPath: '/socket', headed: true, solAvailable: true, proAvailable: true,
    autoApproveToolCalls: false, runtimeCommand: ['/runtime'], tunnel, automaticTunnel: { ...tunnel } };
  assert.equal(validateConfig(config, '/descriptor', 'linux'), config);
  assert.throws(() => validateConfig({ ...config, automaticTunnel: { ...tunnel, alias: 'other' } }, '/descriptor', 'linux'), /does not match the active tunnel/);
});
