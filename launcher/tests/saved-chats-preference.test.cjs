const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStateStore } = require('../electron/state.cjs');
const { validateConfig } = require('../electron/runtime-config-contract.cjs');

function runtimeConfig(overrides = {}) {
  const tunnel = { binaryPath: '/bin/tunnel', tunnelId: `tunnel_${'a'.repeat(32)}`, runtimeKeyFile: '/key',
    profileDir: '/profile', profileName: 'p', alias: 'a' };
  return { version: 3, releaseVersion: '1.0.0', mode: 'full', browserInteractionMode: 'automatic',
    browserHost: 'launcher', browserHostDescriptorPath: '/descriptor', host: '127.0.0.1', port: 1234,
    controlToken: 'a'.repeat(40), contextWindow: 100, appName: 'test', chromeExecutablePath: '/chrome',
    storageStatePath: '/storage', brokerSocketPath: '/socket', headed: true, solAvailable: true, proAvailable: false,
    autoApproveToolCalls: false, runtimeCommand: ['/runtime'], tunnel, automaticTunnel: { ...tunnel }, ...overrides };
}

test('saved chat preference defaults off and launcher state persists only booleans', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-saved-chats-state-'));
  const file = path.join(root, 'state.json');
  try {
    const store = createStateStore(file);
    assert.equal(store.read().useSavedChats, false);
    store.update({ useSavedChats: true });
    assert.equal(createStateStore(file).read().useSavedChats, true);
    fs.writeFileSync(file, JSON.stringify({ version: 1, useSavedChats: 'true' }));
    assert.equal(createStateStore(file).read().useSavedChats, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime config accepts the legacy default but rejects non-boolean saved-chat values', () => {
  const legacy = runtimeConfig();
  assert.equal(validateConfig(legacy, '/descriptor').useSavedChats, false);
  assert.equal(validateConfig(runtimeConfig({ useSavedChats: true }), '/descriptor').useSavedChats, true);
  assert.throws(() => validateConfig(runtimeConfig({ useSavedChats: 'yes' }), '/descriptor'), /invalid useSavedChats/);
});
