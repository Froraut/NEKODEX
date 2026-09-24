// Changed-flow checks for wave 3. Fixture IPC only; no provider, config or updater actions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createFixtureServer } = require('./fixtures/ui-preview.cjs');
const output = path.resolve(__dirname, '../output/playwright/astra-wave3');
fs.mkdirSync(output, { recursive: true });
let server, browser, base;
test.before(async () => {
  server = createFixtureServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });
async function open(setup, width = 1280) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (setup) await page.route('**/fixture-setup.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n;(${setup.toString()})();` });
  });
  await page.goto(`${base}/?scenario=benefits-astra`);
  await page.locator('.app-shell').waitFor();
  return { page, errors };
}
async function navigate(page, label) {
  const toggle = page.locator('button[aria-controls="app-sidebar"]');
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await page.locator('.sidebar-item').filter({ hasText: label }).first().click();
}
async function capture(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await page.screenshot({ path: path.join(output, `${name}.png`) });
}
async function focused(locator) { assert.equal(await locator.evaluate(el => el === document.activeElement), true); }

test('wave3 task confirmation keyboard focus and removed-account queue scope', { timeout: 12000 }, async () => {
  const { page, errors } = await open(undefined, 760);
  try {
    await navigate(page, 'Task center');
    const row = page.locator('.task-center article').filter({ hasText: 'trace-review-uncertain' });
    const dismiss = row.getByRole('button', { name: 'Dismiss', exact: true });
    await dismiss.focus(); await page.keyboard.press('Enter');
    await focused(row.getByRole('button', { name: 'Keep record', exact: true }));
    await page.keyboard.press('Escape');
    await focused(dismiss);
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === 'dismiss-task')), []);
    await dismiss.click();
    await page.evaluate(async () => {
      const current = await window.codexWebLauncher.snapshot();
      window.fixtureSetBrowser({ tasks: current.browser.tasks.filter(task => task.id !== 'task-uncertain') });
    });
    await page.getByRole('alertdialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.activeElement?.getAttribute('type') === 'search');
    const active = page.locator('.task-center article').filter({ hasText: 'trace-active' });
    await active.getByRole('button', { name: 'Cancel this task', exact: true }).click();
    await focused(active.getByRole('button', { name: 'Keep working', exact: true }));
    await page.locator('.task-center input[type="search"]').fill('active');
    await focused(page.locator('.task-center input[type="search"]'));
    const queue = page.locator('.task-queue');
    await queue.getByRole('combobox').selectOption('fixture-primary');
    await page.evaluate(async () => {
      const current = await window.codexWebLauncher.snapshot();
      window.fixtureSetBrowser({ queue: { ...current.browser.queue, accounts: current.browser.queue.accounts.filter(account => account.id !== 'fixture-primary') } });
    });
    assert.equal(await queue.getByRole('combobox').inputValue(), 'all');
    await queue.getByRole('button', { name: /^Resume new tasks/ }).click();
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === 'pause-queue')), [['pause-queue', null, false]]);
    await capture(page, 'task-keyboard-queue');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('wave3 proxy draft survives host changes with styled invalid controls', { timeout: 12000 }, async () => {
  const { page, errors } = await open(() => {
    const read = window.codexWebLauncher.accounts;
    window.fixtureProxy = { mode: 'http', url: 'http://127.0.0.1:8080' };
    window.codexWebLauncher.accounts = async () => {
      const pool = await read(); pool.accounts[0].proxy = { ...window.fixtureProxy }; return pool;
    };
  });
  try {
    await navigate(page, 'Accounts');
    const card = page.locator('.account-card').filter({ hasText: 'primary@example.test' });
    await card.waitFor();
    await card.locator('.account-safety summary').click();
    const proxy = card.locator('.account-proxy');
    await proxy.locator('summary').click();
    const input = proxy.locator('input[type="url"]');
    await input.fill('unfinished-address');
    await input.press('Tab');
    await page.evaluate(() => { window.fixtureProxy = { mode: 'https', url: 'https://127.0.0.1:8443' }; window.fixtureSetBrowser({ title: 'Refreshed evidence' }); });
    await page.waitForTimeout(250);
    assert.equal(await input.inputValue(), 'unfinished-address');
    assert.equal(await input.getAttribute('aria-invalid'), 'true');
    assert.ok(await input.evaluate(el => el.getBoundingClientRect().height >= 36));
    await input.focus(); await capture(page, 'proxy-draft-desktop');
    await page.setViewportSize({ width: 760, height: 900 });
    await capture(page, 'proxy-draft-compact');
    await proxy.getByRole('button', { name: 'Restore saved proxy', exact: true }).click();
    assert.equal(await input.inputValue(), 'https://127.0.0.1:8443');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('wave3 CSV download preserves date scope and neutralizes formula text', { timeout: 10000 }, async () => {
  const { page, errors } = await open(() => {
    const read = window.codexWebLauncher.usage;
    window.codexWebLauncher.usage = async query => ({ ...await read(query), generatedAt: '2026-09-22T08:00:00.000Z', selectedAccountId: 'fixture-primary',
      metrics: { total: 1, completed: 1, failed: 0, cancelled: 0, unrecorded: 0, knownOutcomeTotal: 1, knownOutcomeCompletionRate: 1 },
      rows: [{ day: '2026-09-21', accountId: 'fixture-primary', mode: 'automatic', effort: 'high', modelVersion: '=SUM(1)', modelVersionSource: 'observed', messageKind: 'task', accepted: 1, completed: 1, failed: 0, aborted: 0 }] });
  });
  try {
    await navigate(page, 'Activity');
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export displayed CSV', exact: true }).click(),
    ]);
    const file = await download.path();
    const csv = fs.readFileSync(file, 'utf8');
    assert.match(csv, /selected_account_id,generated_at/);
    const group = csv.split('\n').find(line => line.startsWith('group,'));
    assert.match(group, /2026-09-21/);
    assert.match(group, /'=SUM\(1\)/);
    assert.match(group, /fixture-primary,2026-09-22T08:00:00.000Z$/);
    await download.delete();
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('wave3 installing supersedes unresolved cancellation IPC', { timeout: 10000 }, async () => {
  const { page, errors } = await open(() => {
    window.codexWebLauncher.cancelUpdatePreparation = () => new Promise(resolve => { window.fixtureFinishCancel = resolve; });
  });
  try {
    await page.evaluate(() => window.fixtureSetUpdate({ status: 'verifying', version: '9.9.9' }));
    await navigate(page, 'Updates');
    await page.getByRole('button', { name: 'Cancel update', exact: true }).click();
    await page.waitForFunction(() => typeof window.fixtureFinishCancel === 'function');
    await page.evaluate(() => window.fixtureSetUpdate({ status: 'installing', version: '9.9.9' }));
    await page.getByRole('button', { name: /Cancel/ }).waitFor({ state: 'hidden' });
    assert.match(await page.locator('.updates-status').innerText(), /Restart|install/i);
    assert.doesNotMatch(await page.locator('.updates-card').innerText(), /Stopping preparation|installed app stays/i);
    await capture(page, 'installing-after-cancel');
    await page.evaluate(() => window.fixtureFinishCancel({ status: 'too-late' }));
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('wave3 Settings current capacity preserves drafts and Doctor retires old success', { timeout: 12000 }, async () => {
  const { page, errors } = await open(() => {
    const read = window.codexWebLauncher.snapshot;
    window.fixtureCapacity = { configured: 16, active: 16, maximum: 1000, restartRequired: false };
    window.codexWebLauncher.snapshot = async () => ({ ...await read(), browserCapacity: { ...window.fixtureCapacity } });
    let doctorCalls = 0;
    window.codexWebLauncher.doctor = () => ++doctorCalls === 1 ? Promise.resolve({ ok: true, checks: [{ id: 'fixture-check', message: 'Fixture healthy marker', status: 'ok' }] })
      : new Promise((_resolve, reject) => { window.fixtureFailDoctor = reject; });
  });
  try {
    await navigate(page, 'Settings');
    const input = page.locator('input[type="number"]').first();
    assert.equal(await input.inputValue(), '16');
    await page.evaluate(() => { window.fixtureCapacity = { configured: 24, active: 16, maximum: 500, restartRequired: true }; window.fixtureSetOperation({ name: 'fixture-change', status: 'completed', message: 'Fixture changed' }); });
    await page.waitForFunction(() => document.querySelector('input[type="number"]')?.value === '24');
    await input.fill('31');
    await page.evaluate(() => { window.fixtureCapacity = { configured: 32, active: 24, maximum: 600, restartRequired: true }; window.fixtureSetOperation({ name: 'fixture-change', status: 'completed', message: 'Fixture changed again' }); });
    await page.waitForFunction(() => document.querySelector('input[type="number"]')?.max === '600');
    assert.equal(await input.inputValue(), '31');
    const doctor = page.getByRole('button', { name: /Run doctor/ });
    await doctor.click();
    await page.getByText('Fixture healthy marker', { exact: true }).waitFor();
    await doctor.click();
    await page.waitForFunction(() => typeof window.fixtureFailDoctor === 'function');
    await page.getByText('Fixture healthy marker', { exact: true }).waitFor({ state: 'hidden' });
    await page.evaluate(() => window.fixtureFailDoctor(new Error('Fixture diagnostics unavailable')));
    await page.locator('.error-toast').waitFor();
    assert.equal(await page.getByText('Fixture healthy marker', { exact: true }).count(), 0);
    await capture(page, 'settings-current-evidence');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('wave3 Overview account and transition evidence precede retained catalog errors', { timeout: 10000 }, async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(() => {
      window.fixtureSetOperation({ name: 'catalog-verification', status: 'failed', message: 'Fixture catalog failed' });
      window.fixtureSetBrowser({ authenticated: true, authenticationStatus: 'unavailable', authenticationIssue: 'network' });
    });
    await navigate(page, 'Overview');
    assert.match(await page.locator('.workspace-intro .button-primary').innerText(), /Retry|verif/i);
    await page.evaluate(() => {
      window.fixtureSetBrowser({ authenticated: true, authenticationStatus: 'verified' });
      window.fixtureSetLifecycle({ revision: 2, transition: { kind: 'repair' }, runtimeStatus: 'ready', nativeAvailability: 'ready', webAvailability: 'ready', tunnelStatus: 'ready' });
    });
    await page.waitForFunction(() => document.querySelector('.workspace-intro .button-primary')?.disabled === true);
    assert.equal(await page.locator('.workspace-intro .button-primary').isDisabled(), true);
    await capture(page, 'overview-evidence-priority');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('wave3 workspace persistence warning and transient live windows remain inspectable', { timeout: 10000 }, async () => {
  const { page, errors } = await open(undefined, 760);
  try {
    await page.evaluate(async () => {
      const current = await window.codexWebLauncher.snapshot();
      const workspaces = current.browser.workspaces;
      workspaces.accounts[0].persistenceFailed = true;
      workspaces.accounts[0].items.push({ id: 'transient-window', groupId: 'transient-group', state: 'open', kind: 'window', title: 'Signing in', location: null, restorable: false, needsOriginalAccount: false, temporary: false, active: false });
      workspaces.total += 1;
      window.fixtureSetBrowser({ workspaces });
    });
    await navigate(page, 'Browser');
    const manager = page.locator('.browser-workspace-manager');
    await manager.waitFor();
    assert.match(await manager.locator('.browser-workspace-error').innerText(), /not all|could not save all/i);
    await manager.getByText('Signing in', { exact: true }).waitFor();
    assert.match(await manager.locator('.browser-workspace-manager-heading').innerText(), /2\s*\/\s*8/);
    await capture(page, 'workspace-persistence-warning');
    await page.evaluate(async () => {
      const current = await window.codexWebLauncher.snapshot();
      current.browser.workspaces.accounts[0].persistenceFailed = false;
      window.fixtureSetBrowser({ workspaces: current.browser.workspaces });
    });
    await manager.locator('.browser-workspace-error').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
