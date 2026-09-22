// Focused integration flows for the 2026-09-22 changes, against fixture-only IPC.
// Build the renderer first. No real accounts, provider calls, updates, or config edits.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createFixtureServer } = require('./fixtures/ui-preview.cjs');
const output = path.resolve(__dirname, '../output/playwright/astra-improvements');
fs.mkdirSync(output, { recursive: true });
let server, browser, base;
test.before(async () => {
  server = createFixtureServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });

async function open({ scenario = 'benefits-astra', width = 1280, language = 'en', setup } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (setup) await page.route('**/fixture-setup.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n;(${setup.toString()})();` });
  });
  await page.goto(`${base}/?scenario=${scenario}&language=${language}`);
  await page.locator(scenario === 'onboarding' ? '.welcome' : '.app-shell').waitFor();
  return { page, errors };
}
async function navigate(page, label) {
  const toggle = page.locator('button[aria-controls="app-sidebar"]');
  if (await toggle.count() && await toggle.getAttribute('aria-expanded') === 'false') await toggle.click();
  await page.locator('.sidebar-item').filter({ hasText: label }).first().click();
}
async function capture(page, name) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true, `${name}: document overflow`);
  await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true });
}
async function count(page, selector, expected) {
  await page.waitForFunction(({ selector, expected }) => document.querySelectorAll(selector).length === expected, { selector, expected });
}

test('Astra task filters, protected dismissal, history health and global pause compose', { timeout: 15000 }, async () => {
  const { page, errors } = await open({ width: 760 });
  try {
    await navigate(page, 'Task center');
    const center = page.locator('.task-center');
    await count(page, '.task-center-list article', 3);
    await center.getByRole('searchbox').fill('review-uncertain');
    await center.getByRole('combobox', { name: 'Status', exact: true }).selectOption('attention');
    await center.getByRole('combobox', { name: 'Account', exact: true }).selectOption('fixture-primary');
    await count(page, '.task-center-list article', 1);
    const row = center.locator('article');
    await row.getByRole('button', { name: 'Dismiss', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === 'dismiss-task')), []);
    await row.getByRole('button', { name: 'Keep record', exact: true }).click();
    await row.getByRole('button', { name: 'Dismiss', exact: true }).click();
    await capture(page, 'task-confirm-compact');
    await row.getByRole('button', { name: 'Close page and remove record', exact: true }).click();
    await count(page, '.task-center-list article', 0);
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === 'dismiss-task')), [['dismiss-task', 'fixture-primary', 'task-uncertain']]);
    await center.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await count(page, '.task-center-list article', 2);
    await page.evaluate(() => window.fixtureSetBrowser({ taskHistoryHealth: [{ accountId: 'fixture-tertiary', accountName: 'Tertiary', issue: 'task-history-unavailable' }] }));
    await center.locator('.task-history-warning').waitFor();
    assert.match(await center.locator('.task-history-warning').innerText(), /Tertiary/);
    const queue = page.locator('.task-queue');
    await queue.getByRole('combobox').selectOption('fixture-primary');
    await queue.getByRole('button', { name: /^Resume new tasks/ }).click();
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === 'pause-queue')), [['pause-queue', 'fixture-primary', false]]);
    assert.match(await queue.innerText(), /all accounts|global/i);
    await capture(page, 'tasks-health-and-pause');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Astra workspace restore and same-identity tools readiness update in place', { timeout: 15000 }, async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(async () => {
      const pool = await window.codexWebLauncher.accounts();
      pool.accounts[0].connectorReady = false;
      window.fixtureSetAccounts(pool);
    });
    await navigate(page, 'Browser');
    await page.locator('.account-tools-handoff').waitFor();
    const manager = page.locator('.browser-workspace-manager');
    await manager.waitFor();
    await manager.getByRole('button', { name: /Restore/ }).click();
    await manager.getByRole('button', { name: /Restore/ }).waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === 'restore-workspaces')), [['restore-workspaces', 'fixture-primary']]);
    await page.evaluate(async () => {
      const pool = await window.codexWebLauncher.accounts();
      pool.accounts[0].connectorReady = true;
      window.fixtureSetAccounts(pool);
    });
    await count(page, '.account-tools-handoff', 0);
    await capture(page, 'workspaces-restored');
    await page.setViewportSize({ width: 760, height: 900 });
    await capture(page, 'workspaces-compact');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Astra Settings invalidates diagnostics only after successful removal', { timeout: 15000 }, async () => {
  const { page, errors } = await open();
  try {
    await navigate(page, 'Settings');
    await page.locator('.route-diagnostics > button').click();
    await page.locator('.route-diagnostics-result').waitFor();
    await page.evaluate(() => { window.fixtureCancelUninstall = true; });
    await page.getByRole('button', { name: /Remove Codex integration/ }).click();
    await page.waitForFunction(() => window.fixtureCalls.some(call => call[0] === 'uninstall-integration'));
    assert.equal(await page.locator('.route-diagnostics-result').count(), 1);
    await page.evaluate(() => { window.fixtureCancelUninstall = false; });
    await page.getByRole('button', { name: /Remove Codex integration/ }).click();
    await count(page, '.route-diagnostics-result', 0);
    await capture(page, 'settings-integration-removed');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Astra onboarding language preview has correct unsaved semantics', { timeout: 10000 }, async () => {
  const { page, errors } = await open({ scenario: 'onboarding' });
  try {
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('radio', { name: /Русский/ }).click();
    assert.equal(await page.locator('.welcome').getAttribute('lang'), 'ru');
    assert.equal(await page.getByRole('radio', { name: /English/ }).getAttribute('lang'), 'en');
    assert.equal(await page.evaluate(async () => (await window.codexWebLauncher.snapshot()).state.language), 'en');
    await capture(page, 'onboarding-russian');
    await page.getByRole('radio', { name: /English/ }).click();
    assert.equal(await page.locator('.welcome').getAttribute('lang'), 'en');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Astra updater gates transitions and announces only actual download estimates', { timeout: 10000 }, async () => {
  const { page, errors } = await open();
  try {
    await page.evaluate(() => {
      window.fixtureSetUpdate({ status: 'available', version: '9.9.9' });
      window.fixtureSetLifecycle({ revision: 1, transition: { kind: 'repair' }, runtimeStatus: 'ready', nativeAvailability: 'ready', webAvailability: 'ready', tunnelStatus: 'ready' });
    });
    await navigate(page, 'Updates');
    assert.equal(await page.locator('.updates-actions .button-primary').isDisabled(), true);
    await page.locator('.updates-wait').waitFor();
    await page.evaluate(() => window.fixtureSetUpdate({ status: 'downloading', version: '9.9.9', downloadedBytes: 1024 * 1024, totalBytes: 4 * 1024 * 1024, bytesPerSecond: 1048576, remainingSeconds: 3 }));
    const progress = page.getByRole('progressbar');
    await progress.waitFor();
    assert.match(await progress.getAttribute('aria-valuetext'), /download/i);
    assert.equal(await page.getByRole('button', { name: /Cancel update/ }).isEnabled(), true);
    await capture(page, 'update-download-estimate');
    await page.evaluate(() => window.fixtureSetUpdate({ status: 'verifying', version: '9.9.9' }));
    await count(page, '.updates-eta', 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Astra usage retains historical totals and exposes qualified median evidence', { timeout: 10000 }, async () => {
  const { page, errors } = await open({ setup: () => {
    const read = window.codexWebLauncher.usage;
    window.codexWebLauncher.usage = async query => ({ ...await read(query), lifetime: 42, lifetimeUnclassified: 42,
      metrics: { total: 8, completed: 8, failed: 0, cancelled: 0, unrecorded: 0, knownOutcomeTotal: 8, knownOutcomeCompletionRate: 1 },
      durations: { observedSamples: 8, medianMs: 4100, p95Ms: null },
      period: { startDay: '2026-09-15', endDay: '2026-09-21', days: 7 },
      calendar: [{ day: '2026-09-21', total: 8, completed: 8, failed: 0, cancelled: 0, unrecorded: 0 }],
      diagnosticGroups: [{ source: 'web', accountId: 'fixture-primary', mode: 'automatic', effort: 'high', modelVersion: '5.6-sol', modelVersionSource: 'observed', messageKind: 'task', accepted: 8, completed: 8, failed: 0, cancelled: 0, knownOutcomeTotal: 8, knownOutcomeCompletionRate: 1, durations: { observedSamples: 8, eligibleSamples: 8, medianMs: 4100, p95Ms: null }, failures: [], classifiedFailureSamples: 0 }] });
  } });
  try {
    await navigate(page, 'Activity');
    await page.locator('.usage-breakdown summary').click();
    assert.match(await page.locator('.usage-breakdown').innerText(), /42/);
    await page.locator('.usage-diagnostic-facts').waitFor();
    assert.match(await page.locator('.usage-diagnostic-facts').innerText(), /4.1|8/);
    assert.equal(await page.locator('.usage-diagnostic-empty').count(), 0);
    await capture(page, 'usage-median-and-history');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Astra account session resume and proxy draft restore stay scoped', { timeout: 10000 }, async () => {
  const { page, errors } = await open({ setup: () => {
    const read = window.codexWebLauncher.accounts;
    window.codexWebLauncher.accounts = async () => {
      const pool = await read();
      pool.accounts[0] = { ...pool.accounts[0], availability: { eligible: false, reason: 'session-limit', retryAt: null },
        proxy: { mode: 'http', url: 'http://127.0.0.1:8080' }, safety: { ...pool.accounts[0].safety, stopped: false } };
      return pool;
    };
    window.codexWebLauncher.resumeAccount = async id => { window.fixtureCalls.push(['resume-account', id]); return read(); };
    window.codexWebLauncher.setAccountProxy = async (...args) => { window.fixtureCalls.push(['save-proxy', ...args]); return read(); };
  } });
  try {
    await navigate(page, 'Accounts');
    const card = page.locator('.account-card').filter({ hasText: 'primary@example.test' });
    await card.waitFor();
    await card.locator('.account-safety summary').click();
    await card.getByRole('button', { name: 'Resume after review', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === 'resume-account')), [['resume-account', 'fixture-primary']]);
    const proxy = card.locator('.account-proxy');
    await proxy.locator('summary').click();
    await proxy.getByRole('combobox').selectOption('direct');
    await proxy.getByRole('button', { name: 'Restore saved proxy', exact: true }).click();
    assert.equal(await proxy.locator('input[type="url"]').inputValue(), 'http://127.0.0.1:8080');
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === 'save-proxy')), []);
    await capture(page, 'accounts-recovery');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('Astra integrated navigation covers all eight sections and compact Russian tasks', { timeout: 15000 }, async () => {
  const { page, errors } = await open();
  try {
    for (const label of ['Overview', 'Accounts', 'Browser', 'Activity', 'Task center', 'Connections', 'Updates', 'Settings']) {
      await navigate(page, label);
      if (label === 'Accounts') await page.locator('.account-card').first().waitFor();
      if (label === 'Activity') await page.locator('.usage-empty-state').waitFor();
      await capture(page, `navigation-${label.toLowerCase().replaceAll(' ', '-')}`);
    }
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
  const russian = await open({ width: 760, language: 'ru' });
  try {
    await navigate(russian.page, 'Центр задач');
    await russian.page.locator('.task-history-filters').waitFor();
    await capture(russian.page, 'tasks-russian-compact');
    assert.deepEqual(russian.errors, []);
  } finally { await russian.page.close(); }
});
