const assert = require('node:assert/strict');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');
const { AccountOperationLeases } = require('../electron/account-operation-leases.cjs');
const idA = 'default', idB = '00000000-0000-4000-8000-000000000002';
const tabs = new Map([[idB, { status: 'running', accountId: idB }]]);
const hosts = new Map([[idA, { turnTabs: new Map(), removeTurnTab() {} }], [idB, { turnTabs: tabs }]]);
const leases = new AccountOperationLeases();
const pool = Object.create(AccountBrowserPool.prototype);
Object.assign(pool, { options: { getBrowserInteractionMode: () => 'automatic',
  getAccountTunnel: id => ({ accountId: id, interactionMode: 'automatic', required: true,
    status: id === idA ? 'ready' : 'error', ready: id === idA, tunnelId: id === idA ? 'own-a' : 'own-b' }) },
  hosts, reservations: new Map(), connectors: new Map([[idA, 'Native6'], [idB, 'Native6']]),
  getHost: id => hosts.get(id), assertAccountOperationAvailable() {}, leases: () => leases,
  publish() {}, writeDescriptor() {},
});
async function main() {
  assert.equal(pool.assertAccountTunnelReady(idA, 'automatic').tunnelId, 'own-a');
  assert.throws(() => pool.assertAccountTunnelReady(idB, 'automatic'), error => error.code === 'account_tunnel_unavailable' && error.workStarted === false);
  let mutated = 0;
  await pool.withAccountTunnelMutation(idA, async () => { mutated++; assert.equal(leases.exclusiveLabel(idA), 'tool tunnel setup'); });
  assert.equal(mutated, 1); assert.equal(pool.connectors.has(idA), false); assert.equal(pool.connectors.get(idB), 'Native6');
  assert.equal(hosts.get(idB).turnTabs.values().next().value.status, 'running');
  await assert.rejects(pool.withAccountTunnelMutation(idB, async () => { throw new Error('must not reach mutation'); }), /active tasks/);
  assert.equal(leases.exclusiveLabel(idA), null);
  console.log('ACCOUNT_TUNNEL_ADMISSION_OK own-only busy-account-refusal healthy-other-work-preserved');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
