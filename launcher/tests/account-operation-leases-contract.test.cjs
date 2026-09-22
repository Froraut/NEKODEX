const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountOperationLeases } = require('../electron/account-operation-leases.cjs');
test('multiple reads block exclusive ownership until each exact release; stale release cannot clear successor', () => {
  const leases = new AccountOperationLeases();
  const first = leases.acquireRead('default', 'quota', () => {});
  const second = leases.acquireRead('default', 'identity', () => {});
  first(); first();
  assert.throws(() => leases.acquireExclusive('default', 'login'), /identity/);
  second();
  const release = leases.acquireExclusive('default', 'login');
  assert.throws(() => leases.acquireRead('default', 'quota', () => {}), /login/);
  release();
  const successor = leases.acquireExclusive('default', 'replacement');
  release();
  assert.equal(leases.exclusiveLabel('default'), 'replacement');
  successor();
  assert.equal(leases.exclusiveLabel('default'), null);
});
test('drain cancels captured owners and waits for their releases', async () => {
  const leases = new AccountOperationLeases();
  let cancelled = 0;
  const release = leases.acquireRead('default', 'quota', () => { cancelled++; });
  let settled = false;
  const drain = leases.cancelAndDrain().then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(cancelled, 1);
  assert.equal(settled, false);
  release(); await drain;
  assert.equal(settled, true);
});
test('timed out cancellation retains the unsettled owner and its blocker', async () => {
  const leases = new AccountOperationLeases();
  let cancelled = false;
  const release = leases.acquireRead('default', 'quota', () => { cancelled = true; });
  const keepAlive = setTimeout(() => {}, 1000);
  try {
    await assert.rejects(leases.cancelAndDrain(5), /timed out/);
    assert.equal(cancelled, true);
    assert.throws(() => leases.acquireExclusive('default', 'login'), /quota/);
    release();
  } finally { clearTimeout(keepAlive); }
});
