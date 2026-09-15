const { test } = require('node:test');
const assert = require('node:assert/strict');
const { BrowserHost } = require('../electron/browser-host.cjs');

test('retained viewport survives visible to background transfer and subsequent reuse', async () => {
  let viewport = { width: 0, height: 0 }, bounds, enabled = 0;
  const tab = { id: 'retained', surfaceId: 'surface', traceId: 'previous', helperPid: 1,
    conversationKey: 'a'.repeat(64), connectorIdentity: 'Codex Native4', connectorBound: true,
    interactionMode: 'automatic', status: 'ready', rendererReady: true, bootstrapReady: true,
    deviceEmulationViewport: { width: 1280, height: 800 }, deviceEmulationDirty: false,
    view: { setBounds: value => { bounds = value; viewport = { width: value.width, height: value.height }; },
      setVisible() {}, webContents: { isDestroyed: () => false, setBackgroundThrottling() {},
        disableDeviceEmulation: () => { viewport = { width: bounds.width, height: bounds.height }; },
        enableDeviceEmulation: value => { enabled++; viewport = value.viewSize; } } } };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    bounds: { x: 0, y: 0, width: 900, height: 650 }, manualOperation: null,
    turnTabs: new Map([[tab.id, tab]]), userCancelledTurnOwners: new Map(),
    hiddenTurnBounds: () => ({ x: 1281, y: 801, width: 1280, height: 800 }),
    show: () => host.presentTurnView(tab, true), syncViewVisibility: () => host.presentTurnView(tab, false),
    snapshot: () => ({}), writeDescriptor() {}, logger: { info() {} },
  });
  await host.beginTurn('compact', true, 2, tab.conversationKey, 'Codex Native4');
  assert.deepEqual(viewport, { width: 900, height: 650 });
  host.presentTurnView(tab, false);
  assert.equal(enabled, 1);
  // Completed compact helper disconnects; the next task must restore real dimensions.
  tab.status = 'ready'; viewport = { width: 0, height: 0 };
  await host.beginTurn('continued', false, 3, tab.conversationKey, 'Codex Native4');
  assert.equal(enabled, 2);
  assert.deepEqual(viewport, { width: 1280, height: 800 });
  assert.equal(tab.traceId, 'continued');
});
