const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createFixtureServer } = require('./fixtures/ui-preview.cjs');
let server, browser, base;
test.before(async () => {
  server = createFixtureServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
async function open() {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(4000);
  await page.route('**/fixture-setup.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: await response.text() + '\nwindow.codexWebLauncher.onLog = listener => { window.emitLog = listener; return () => {}; };' });
  });
  await page.goto(base + '/?scenario=benefits-astra&language=en&no-animation-frames=true');
  await page.locator('.overview-activity').waitFor();
  return page;
}
async function navigate(page, label, selector) {
  await page.locator('.sidebar-item').filter({ hasText: label }).first().click();
  await page.locator(selector).first().waitFor();
}

test('deferred screens retain offscreen log history and stable filtered rows without animation frames', { timeout: 12000 }, async () => {
  const page = await open();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    const scripts = await page.evaluate(() => performance.getEntriesByType('resource').map(entry => entry.name));
    assert.equal(scripts.some(name => /\/(AccountSettings|SettingsSurface|ActivitySurface|TaskCenter|Updates)-.*\.js/.test(name)), false);
    await navigate(page, 'Settings', '.settings-list');
    await page.evaluate(() => {
      for (let i = 0; i < 301; i++) window.emitLog({ at: new Date().toISOString(), level: 'info', event: 'perf.sample', detail: { i } });
    });
    await navigate(page, 'Activity', '.activity-row');
    assert.equal(await page.locator('.activity-row').count(), 300);
    const search = page.locator('.activity-filters input');
    await search.fill('i: 299');
    assert.equal(await page.locator('.activity-row').count(), 1);
    await page.locator('.activity-row').evaluate(row => { row.dataset.retained = 'yes'; });
    await page.evaluate(() => window.emitLog({ at: new Date().toISOString(), level: 'info', event: 'perf.sample', detail: { i: 301 } }));
    await page.waitForTimeout(150);
    assert.equal(await search.inputValue(), 'i: 299');
    assert.equal(await search.evaluate(input => input === document.activeElement), true);
    assert.equal(await page.locator('.activity-row').getAttribute('data-retained'), 'yes');
    await search.fill('i: 301');
    assert.equal(await page.locator('.activity-row').count(), 1);
    for (const [label, selector] of [['Accounts', '.account-settings'], ['Task center', '.task-center'],
      ['Updates', '.updates-surface'], ['Settings', '.settings-list']]) await navigate(page, label, selector);
    assert.deepEqual(errors, []);
  } finally { await page.close(); }
});

test('failed feature load preserves navigation and explicit reload recovers the screen', { timeout: 12000 }, async () => {
  const page = await open();
  let failedFetches = 0;
  await page.route('**/SettingsSurface-*.js', route => {
    if (failedFetches++ === 0) return route.abort('failed');
    return route.continue();
  });
  try {
    await navigate(page, 'Settings', '.surface-empty[role="alert"]');
    assert.equal(failedFetches, 1);
    await navigate(page, 'Overview', '.overview-activity');
    await navigate(page, 'Settings', '.surface-empty[role="alert"]');
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await page.locator('.overview-activity').waitFor();
    await navigate(page, 'Settings', '.settings-list');
    assert.equal(failedFetches, 2);
  } finally { await page.close(); }
});
