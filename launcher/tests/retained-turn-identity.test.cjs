const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserHost } = require('../electron/browser-host.cjs');

function retainedFixture() {
  const tab = {
    id: 'retained', traceId: 'completed-a', surfaceId: 'surface-a',
    conversationKey: 'conversation-a', connectorIdentity: 'connector', connectorBound: true,
    interactionMode: 'automatic', status: 'ready', helperPid: 1,
    authIdentityEpoch: 7, authPrincipalFingerprint: 'a'.repeat(64),
    view: { webContents: {
      isDestroyed: () => false, isLoadingMainFrame: () => false,
      getURL: () => 'https://chatgpt.com/c/conversation-a', setBackgroundThrottling() {},
    } },
  };
  const host = Object.assign(Object.create(BrowserHost.prototype), {
    accountId: 'account', authIdentityEpoch: 7, authPrincipalFingerprint: 'a'.repeat(64),
    authSessionFingerprint: 's'.repeat(64), authProbeRevision: 1, authGeneration: 1,
    turnTabs: new Map([[tab.id, tab]]), userCancelledTurnOwners: new Map(),
    state: { authenticated: true }, onAuthIdentityChanged() {},
    setState(patch) { Object.assign(this.state, patch); }, snapshot() { return this.state; },
    syncViewVisibility() {}, writeDescriptor() {}, logger: { info() {} },
    createTurnTab() { throw new Error('Required continuation must not create a fresh tab'); },
  });
  return { host, tab };
}

test('unchanged authenticated identity can resume its completed retained document', async () => {
  const { host, tab } = retainedFixture();
  const lease = await host.beginTurn('next-a', false, 2, tab.conversationKey, 'connector', true);
  assert.equal(lease.reused, true);
  assert.equal(lease.surfaceId, 'surface-a');
});

for (const [name, evidence] of [
  ['different principal', { status: 'authenticated', principalFingerprint: 'b'.repeat(64) }],
  ['same principal in a new session epoch', { status: 'authenticated', principalFingerprint: 'a'.repeat(64) }],
  ['signed out', { status: 'signed-out' }],
]) {
  test(`workspace mutation to ${name} cannot resume a previously completed document`, async () => {
    const { host, tab } = retainedFixture();
    host.applyWorkspaceSessionMutationEvidence(evidence);
    assert.throws(() => host.precheckRetainedTurn('next', tab.conversationKey, 'connector'),
      error => error.code === 'retained_conversation_unavailable');
    await assert.rejects(host.beginTurn('next', false, 2, tab.conversationKey, 'connector', true),
      error => error.code === 'retained_conversation_unavailable');
    assert.equal(host.turnTabs.get(tab.id), tab);
    assert.equal(tab.status, 'ready');
    assert.equal(tab.traceId, 'completed-a');
  });
}

test('principal mismatch rejects reuse even if an epoch were accidentally preserved', () => {
  const { host, tab } = retainedFixture();
  host.authPrincipalFingerprint = 'b'.repeat(64);
  assert.equal(host.exactRetainedTurnTab(tab.conversationKey, 'connector'), null);
});
