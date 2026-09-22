// Integrated renderer behavior after architecture extraction. IPC is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createFixtureServer } = require('./fixtures/ui-preview.cjs');
const output = path.resolve(__dirname, '../output/playwright/architecture-refactor');
fs.mkdirSync(output, { recursive: true });
let server, browser, base;
test.before(async () => {
  server = createFixtureServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = 'http://127.0.0.1:' + server.address().port;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => {
  await browser?.close();
  await new Promise(resolve => server?.close(resolve));
});
async function open(setup, width = 1280, scenario = 'benefits-astra') {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  if (setup) await page.route('**/fixture-setup.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\n;(' + setup.toString() + ')();' });
  });
  await page.goto(base + '/?scenario=' + scenario + '&language=en');
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
  await page.screenshot({ path: path.join(output, name + '.png'), fullPage: true });
}

test('refactor safety draft survives changed host policy and restores locally by keyboard', { timeout: 12000 }, async () => {
  const { page, errors } = await open(() => {
    window.codexWebLauncher.setAccountSafety = async (...args) => {
      window.fixtureCalls.push(['save-safety', ...args]); return window.codexWebLauncher.accounts();
    };
    window.codexWebLauncher.resumeAccount = async (...args) => {
      window.fixtureCalls.push(['resume-safety', ...args]); return window.codexWebLauncher.accounts();
    };
  }, 760);
  try {
    await navigate(page, 'Accounts');
    const card = page.locator('.account-card').filter({ hasText: 'primary@example.test' });
    await card.locator('.account-safety summary').click();
    const form = card.locator('.account-safety');
    const first = form.locator('input[type="number"]').first();
    assert.equal(await first.inputValue(), '10');
    await first.fill('');
    await page.evaluate(async () => {
      const pool = structuredClone(await window.codexWebLauncher.accounts());
      pool.accounts[0].safety.policy.minIntervalSec = 23;
      window.fixtureSetAccounts(pool);
    });
    // A quota refresh is unnecessary; the pool subscription settles this host update.
    const restore = form.getByRole('button', { name: 'Restore saved policy', exact: true });
    await restore.waitFor();
    await page.waitForTimeout(250);
    assert.equal(await first.inputValue(), '');
    await restore.focus();
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.querySelector('.account-safety input[type="number"]')?.value === '23');
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => ['save-safety', 'resume-safety'].includes(call[0]))), []);
    await capture(page, 'safety-restore-compact');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('refactor workspace error stays with the original account including late failure', { timeout: 12000 }, async () => {
  const { page, errors } = await open(() => {
    const snapshot = window.codexWebLauncher.snapshot;
    window.codexWebLauncher.snapshot = async () => {
      const current = await snapshot();
      if (current.browser.workspaces.accounts.length === 1) {
        current.browser.workspaces.accounts.push({
          ...structuredClone(current.browser.workspaces.accounts[0]),
          accountId: 'fixture-secondary', label: 'Secondary',
          items: [{ ...current.browser.workspaces.accounts[0].items[1], id: 'secondary-saved', title: 'Secondary saved' }],
        });
      }
      return current;
    };
    window.codexWebLauncher.closeBrowserWorkspace = async (accountId, id) => {
      window.fixtureCalls.push(['close-workspace', accountId, id]);
      if (window.fixtureDelayClose) return new Promise((resolve, reject) => { window.fixtureRejectClose = () => reject(new Error('Primary storage failed')); });
      throw new Error('Primary storage failed');
    };
  });
  try {
    await navigate(page, 'Browser');
    const manager = page.locator('.browser-workspace-manager');
    const selector = manager.getByRole('combobox');
    await selector.selectOption('fixture-primary');
    await manager.locator('li').filter({ hasText: 'Saved conversation' }).locator('.browser-workspace-close').click();
    await manager.getByRole('alert').waitFor();
    await selector.selectOption('fixture-secondary');
    assert.equal(await manager.getByRole('alert').count(), 0);
    await selector.selectOption('fixture-primary');
    await page.evaluate(() => { window.fixtureDelayClose = true; });
    await manager.locator('li').filter({ hasText: 'Saved conversation' }).locator('.browser-workspace-close').click();
    await page.waitForFunction(() => typeof window.fixtureRejectClose === 'function');
    await page.evaluate(async () => {
      const current = await window.codexWebLauncher.snapshot();
      current.browser.workspaces.accounts = current.browser.workspaces.accounts.filter(account => account.accountId !== 'fixture-primary');
      window.fixtureSetBrowser({ workspaces: current.browser.workspaces });
      window.fixtureRejectClose();
    });
    await page.waitForFunction(() => document.querySelector('.browser-workspace-manager select')?.value === 'fixture-secondary');
    assert.equal(await manager.getByRole('alert').count(), 0);
    assert.equal(await selector.isEnabled(), true);
    await capture(page, 'workspace-account-error-scope');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('refactor usage preserves query identity and calendar export after feature extraction', { timeout: 12000 }, async () => {
  const { page, errors } = await open(() => {
    const read = window.codexWebLauncher.usage;
    window.codexWebLauncher.usage = async query => {
      const report = await read(query);
      if (query.source === 'web' && query.accountId === 'fixture-primary') {
        return new Promise(resolve => {
          window.fixtureDeliverOldUsage = () => resolve({ ...report, metrics: { ...report.metrics, total: 999 } });
        });
      }
      return report;
    };
  }, 1280, 'benefits-insights');
  try {
    await navigate(page, 'Activity');
    const dashboard = page.locator('.usage-dashboard');
    await dashboard.locator('.usage-calendar-section').waitFor();
    const tableToggle = dashboard.locator('.usage-calendar-section button[aria-expanded]');
    await tableToggle.click();
    assert.equal(await tableToggle.getAttribute('aria-expanded'), 'true');
    const download = page.waitForEvent('download');
    await dashboard.getByRole('button', { name: /CSV/ }).click();
    assert.match((await download).suggestedFilename(), /\.csv$/);
    await dashboard.getByRole('combobox', { name: 'Account', exact: true }).selectOption('fixture-primary');
    await page.waitForFunction(() => typeof window.fixtureDeliverOldUsage === 'function');
    await dashboard.getByRole('combobox', { name: 'Source', exact: true }).selectOption('native');
    await dashboard.locator('.usage-account-boundary').waitFor();
    await page.evaluate(() => window.fixtureDeliverOldUsage());
    await page.waitForTimeout(50);
    assert.equal(await dashboard.getByRole('combobox', { name: 'Source', exact: true }).inputValue(), 'native');
    assert.doesNotMatch(await dashboard.innerText(), /999/);
    await capture(page, 'usage-native-projection');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('refactor follow-up login start failure requires snapshot recovery in mounted Accounts', { timeout: 12000 }, async () => {
  const { page, errors } = await open(() => {
    let reads = 0;
    window.codexWebLauncher.codexLoginSnapshot = async () => {
      if (++reads === 2) throw new Error('Host snapshot unavailable');
      return null;
    };
    window.codexWebLauncher.startCodexLogin = async id => {
      window.fixtureCalls.push(['start-codex-login', id]);
      throw new Error('Start reply unavailable');
    };
  });
  try {
    await navigate(page, 'Accounts');
    const card = page.locator('.account-card').first();
    const start = card.locator('.account-codex-login header button');
    await start.click();
    const retry = card.getByRole('button', { name: 'Retry: Sign in to Codex', exact: true });
    await retry.waitFor();
    assert.equal(await start.isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === 'start-codex-login')),
      [['start-codex-login', 'fixture-primary']]);
    await capture(page, 'followup-login-recovery');
    await retry.focus(); await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.account-codex-login header button')?.disabled);
    assert.equal(await retry.count(), 0);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('refactor follow-up Manual browser prompt preserves pending confirmation and exact tab ownership', { timeout: 12000 }, async () => {
  const { page, errors } = await open(() => {
    window.fixtureSetState({ browserInteractionMode: 'manual' });
    window.fixtureSetBrowser({ visible: true, activeTabId: 'manual-owned',
      tabs: [{ id: 'manual-owned', traceId: 'trace-owned', title: 'Manual task', active: true,
        status: 'running', interactionMode: 'manual', closable: true, manualState: 'awaiting-user',
        manualDeadlineAt: new Date(Date.now() + 60000).toISOString(), canCopyPrompt: true, canConfirmSent: true }] });
    window.codexWebLauncher.copyManualPrompt = async id => window.fixtureCalls.push(['copy-prompt', id]);
    window.codexWebLauncher.confirmManualSent = id => {
      window.fixtureCalls.push(['confirm-prompt', id]);
      return new Promise(resolve => { window.fixtureConfirmManual = () => resolve(true); });
    };
  }, 760);
  try {
    await navigate(page, 'Browser');
    const guide = page.locator('.manual-turn-guide');
    await guide.waitFor();
    const copy = guide.locator('button').nth(1);
    const confirm = guide.locator('button').nth(2);
    await copy.focus(); await page.keyboard.press('Enter');
    await confirm.click();
    assert.equal(await confirm.isDisabled(), true);
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => /-prompt$/.test(call[0]))),
      [['copy-prompt', 'manual-owned'], ['confirm-prompt', 'manual-owned']]);
    await capture(page, 'followup-manual-confirm-compact');
    await page.evaluate(() => window.fixtureConfirmManual());
    await page.waitForFunction(() => !document.querySelector('.manual-turn-guide button:last-child')?.disabled);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});
