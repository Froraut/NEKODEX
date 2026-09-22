// Focused flows for accepted wave-4 findings and wave-5 fixes. All IPC is synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createFixtureServer } = require('./fixtures/ui-preview.cjs');
const output = path.resolve(__dirname, '../output/playwright/astra-wave5');
fs.mkdirSync(output, { recursive: true });
let server, browser, base;
test.before(async () => {
  server = createFixtureServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await new Promise(resolve => server?.close(resolve)); });
async function open(setup, width = 1280, language = 'en') {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(5000);
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  if (setup) await page.route('**/fixture-setup.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: `${await response.text()}\n;(${setup.toString()})();` });
  });
  await page.goto(`${base}/?scenario=benefits-astra&language=${language}`);
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

test('wave5 inspection capacity explains explicit recovery without closing work', { timeout: 10000 }, async () => {
  const { page, errors } = await open(() => {
    const read = window.codexWebLauncher.snapshot;
    window.codexWebLauncher.snapshot = async () => {
      const current = await read(); current.browser.queue.paused = false;
      current.browser.queue.entries[0].reason = 'inspection-tabs'; return current;
    };
  }, 760);
  try {
    await navigate(page, 'Task center');
    const reason = await page.locator('.task-queue article header').innerText();
    assert.match(reason, /inspect|review/i);
    assert.match(reason, /clos(?:e|ing)/i);
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => ['dismiss-task','close-tab'].includes(call[0]))), []);
    await capture(page, 'inspection-capacity');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('wave5 delayed expired quota evidence enables row and portfolio refresh', { timeout: 10000 }, async () => {
  const { page, errors } = await open(() => {
    const accounts = window.codexWebLauncher.accounts;
    window.codexWebLauncher.accounts = async () => { const pool = await accounts(); return { ...pool, accounts: pool.accounts.slice(0,1) }; };
    window.fixtureClock = Date.now(); Date.now = () => window.fixtureClock;
    window.fixtureRetryAt = window.fixtureClock + 1000;
    const read = window.codexWebLauncher.accountCodexQuotaSnapshot;
    window.codexWebLauncher.accountCodexQuotaSnapshot = async id => {
      const snapshot = await read(id);
      return new Promise(resolve => { window.fixtureDeliverQuota = () => resolve({ ...snapshot, availability:'unavailable', coverage:'none', reason:'rate-limited', retryAt:new Date(window.fixtureRetryAt).toISOString(), freshness:undefined, freshUntil:null }); });
    };
  });
  try {
    await navigate(page, 'Accounts');
    await page.waitForFunction(() => typeof window.fixtureDeliverQuota === 'function');
    await page.evaluate(() => { window.fixtureClock = window.fixtureRetryAt + 1000; window.fixtureDeliverQuota(); });
    const portfolio = page.getByRole('button', { name:'Refresh account limits', exact:true });
    await portfolio.waitFor();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(button => button.textContent.trim() === 'Refresh account limits' && !button.disabled));
    const card = page.locator('.account-card').first();
    const refresh = card.getByRole('button', { name:'Refresh allowance', exact:true });
    assert.equal(await refresh.isEnabled(), true);
    await refresh.click();
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === 'quota-refresh')), [['quota-refresh','fixture-primary']]);
    await capture(page, 'quota-cooldown-expired');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('wave5 mode change retires completed and pending old routing evidence', { timeout: 12000 }, async () => {
  const { page, errors } = await open(() => {
    const read = window.codexWebLauncher.routeDiagnostics;
    window.fixtureDiagnosticCalls = 0;
    window.codexWebLauncher.routeDiagnostics = async () => {
      window.fixtureDiagnosticCalls++;
      const report = await read();
      if (window.fixtureDelayDiagnostic) return new Promise(resolve => { window.fixtureFinishDiagnostic = () => resolve(report); });
      return report;
    };
    window.codexWebLauncher.setBrowserInteractionMode = async mode => {
      window.fixtureCalls.push(['mode', mode]);
      window.fixtureSetState({ browserInteractionMode:mode });
      const current = await window.codexWebLauncher.snapshot();
      return { state:current.state, credentialsRequired:false, targetMode:mode };
    };
  });
  try {
    await navigate(page, 'Settings');
    await page.locator('.route-diagnostics > button').click();
    await page.locator('.route-diagnostics-result').waitFor();
    await page.getByRole('radio', { name:/^Manual mode/ }).click();
    await page.locator('.route-diagnostics-result').waitFor({ state:'hidden' });
    assert.equal(await page.evaluate(() => window.fixtureDiagnosticCalls), 1);
    await page.evaluate(() => { window.fixtureDelayDiagnostic = true; });
    await page.locator('.route-diagnostics > button').click();
    await page.waitForFunction(() => typeof window.fixtureFinishDiagnostic === 'function');
    await page.getByRole('radio', { name:/^Automatic mode/ }).click();
    await page.evaluate(() => window.fixtureFinishDiagnostic());
    await page.waitForTimeout(50);
    assert.equal(await page.locator('.route-diagnostics-result').count(), 0);
    assert.equal(await page.evaluate(() => window.fixtureDiagnosticCalls), 2);
    await capture(page, 'mode-diagnostic-reset');
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('wave5 saved workspace removal failure keeps a retryable row', { timeout: 10000 }, async () => {
  const { page, errors } = await open(() => {
    window.fixtureDeleteFails = true;
    window.codexWebLauncher.closeBrowserWorkspace = async (accountId, id) => {
      window.fixtureCalls.push(['close-workspace',accountId,id]);
      if (window.fixtureDeleteFails) throw new Error('Fixture workspace storage unavailable');
      const current = await window.codexWebLauncher.snapshot();
      const account = current.browser.workspaces.accounts.find(account => account.accountId === accountId);
      account.items = account.items.filter(item => item.id !== id);
      window.fixtureSetBrowser({ workspaces:current.browser.workspaces });
      return current.browser;
    };
  });
  try {
    await navigate(page, 'Browser');
    const manager = page.locator('.browser-workspace-manager');
    const row = manager.locator('li').filter({ hasText:'Saved conversation' });
    await row.locator('.browser-workspace-close').click();
    await manager.getByRole('alert').waitFor();
    assert.equal(await row.count(),1);
    await capture(page, 'workspace-delete-retry');
    await page.evaluate(() => { window.fixtureDeleteFails = false; });
    await row.locator('.browser-workspace-close').click();
    await row.waitFor({ state:'hidden' });
    assert.deepEqual(await page.evaluate(() => window.fixtureCalls.filter(call => call[0] === 'close-workspace')), [['close-workspace','fixture-primary','workspace-saved'],['close-workspace','fixture-primary','workspace-saved']]);
    assert.deepEqual(errors,[]);
  } finally { await page.close(); }
});
