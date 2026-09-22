const test = require('node:test');
const assert = require('node:assert/strict');
const { AccountBrowserPool } = require('../electron/account-pool.cjs');
const { BrowserHost } = require('../electron/browser-host.cjs');

test('pool reads navigation only for selected account and preserves all account task/tab identities', () => {
  let navigationReads = 0;
  const hosts = new Map();
  for (const id of ['default', 'secondary']) {
    const host = Object.assign(Object.create(BrowserHost.prototype), {
      selectedTabId: `tab-${id}`,
      turnTabs: new Map([[`tab-${id}`, { id: `tab-${id}`, traceId: `trace-${id}`,
        label: id, status: 'running', loading: false }]]),
      taskSnapshot: () => [{ id: `task-${id}`, createdAt: id === 'default' ? 1 : 2, canCancel: true }],
      snapshot() {
        navigationReads++;
        assert.equal(id, 'default', 'background navigation must not be queried');
        return { authenticated: true, accountLabel: 'primary@example.test',
          tabs: [{ id: 'home', title: 'Home' }, ...this.turnTabSnapshots()] };
      },
    });
    hosts.set(id, host);
  }
  const pool = Object.assign(Object.create(AccountBrowserPool.prototype), {
    registry: { snapshot: () => ({ selectedId: 'default', accounts: [
      { id: 'default', label: 'Primary' }, { id: 'secondary', label: 'Secondary' }, { id: 'closed', label: 'Closed' },
    ] }) }, hosts, getHost: id => hosts.get(id), options: { maxTabs: 1000 },
    taskLedgers: new Map([
      ['default', {}], ['secondary', {}], ['closed', { storageIssue: 'task-history-unavailable',
        snapshot: () => [{ id: 'retained', createdAt: 3, terminal: true, submission: 'not-sent' }] }],
    ]),
    admissionQueue: { snapshot: () => ({ paused: true, entries: [] }) },
  });
  const result = pool.snapshot();
  assert.equal(navigationReads, 1);
  assert.equal(result.accountLabel, 'primary@example.test');
  assert.deepEqual(result.tabs.map(({ id, active, accountId, title }) => ({ id, active, accountId, title })), [
    { id: 'home', title: 'Home', active: undefined, accountId: undefined },
    { id: 'tab-default', title: 'Primary · default', active: true, accountId: 'default' },
    { id: 'tab-secondary', title: 'Secondary · secondary', active: false, accountId: 'secondary' },
  ]);
  assert.deepEqual(result.tasks.map(task => task.id), ['retained', 'task-secondary', 'task-default']);
  assert.equal(result.tasks[0].canCancel, false);
  assert.equal(result.tasks[0].retrySafe, true);
  assert.deepEqual(result.taskHistoryHealth, [{ accountId: 'closed', accountName: 'Closed', issue: 'task-history-unavailable' }]);
  assert.equal(result.queue.accounts.length, 3);
  assert.equal(hosts.get('secondary').turnTabSnapshots()[0].active, true);
});
