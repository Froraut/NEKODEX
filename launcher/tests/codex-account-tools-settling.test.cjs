const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createCodexAccountTools } = require('../electron/codex-account-tools.cjs');

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function loginProgress(active, phase = active ? 'waiting' : 'completed') {
  return {
    flowId: 'flow-1', accountId: 'default', phase, active,
    startedAt: new Date(0).toISOString(), deadlineAt: new Date(60_000).toISOString(), completedAt: active ? null : new Date(1).toISOString(),
    ownershipCurrent: true, canOpen: active, canCancel: active,
    verificationUrl: null, userCode: null, error: null,
    scope: 'shared-codex-auth-store', authOutcome: active ? 'pending' : 'completed', cancelStatus: null,
    actualAccount: null, requiresOpenaiAuth: null, requiresIdentityConfirmation: false,
    desktopAccountChange: 'not_performed', selectionLock: active ? { flowId: 'flow-1', accountId: 'default' } : null,
  };
}

test('terminal Codex login remains settling until bounded account reconciliation releases its lease', async () => {
  const reconciliation = deferred();
  let current = loginProgress(true);
  let leaseHeld = false;
  let inspectionSignal;
  const host = {
    withReadOnlyInspection: async (name, action) => {
      assert.equal(name, 'Codex sign-in reconciliation');
      const controller = new AbortController();
      inspectionSignal = controller.signal;
      return action(controller.signal);
    },
    probeAuthentication: ({ signal }) => {
      assert.equal(signal, inspectionSignal);
      return reconciliation.promise;
    },
  };
  const pool = {
    accountSnapshot: () => ({ accounts: [{ id: 'default', authenticated: true }] }),
    accountIdentityLease: id => ({ accountId: id, identityEpoch: 1, principalFingerprint: 'principal' }),
    currentOperation: () => null,
    acquireAccountOperation: () => {
      leaseHeld = true;
      return () => { leaseHeld = false; };
    },
    getHost: () => host,
  };
  const controller = {
    selectionLock: () => current.active ? { flowId: current.flowId, accountId: current.accountId } : null,
    start: async () => current,
    status: () => current,
    destroy: async () => {},
  };
  const tools = createCodexAccountTools({
    getPool: () => pool,
    BrowserWindow: class {}, clipboard: { writeText() {} }, codexHome: '/tmp',
    logger: { warn() {} }, quotaReader: { clear() {} }, createController: () => controller,
  });

  const started = await tools.start('default');
  assert.equal(started.settling, false);
  assert.equal(leaseHeld, true);

  current = loginProgress(false);
  const terminal = tools.status(current.flowId, current.accountId);
  assert.equal(terminal.active, false);
  assert.equal(terminal.settling, true);
  await Promise.resolve();
  assert.ok(inspectionSignal instanceof AbortSignal);

  reconciliation.resolve({ authenticated: false });
  await reconciliation.promise;
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(leaseHeld, false);
  assert.equal(tools.snapshot().settling, false);
});
