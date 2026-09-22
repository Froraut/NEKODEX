const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');
const { createFixtureServer } = require('./fixtures/ui-preview.cjs');
const russian = require('../src/i18n-ru.json');
let server, browser, base;
test.before(async () => {
  server = createFixtureServer(); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
});
test.after(async () => { await browser?.close(); await new Promise(resolve => server.close(resolve)); });
async function pageFor(language = 'en', scenario = 'benefits-astra', prepare) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
  page.setDefaultTimeout(4000);
  if (prepare) await prepare(page);
  await page.goto(`${base}/?scenario=${scenario}&language=${language}`);
  return page;
}
async function navigate(page, label, selector) {
  await page.locator('.sidebar-item').filter({ hasText: label }).first().click();
  await page.locator(selector).first().waitFor();
}
const localeRequests = page => page.evaluate(() => performance.getEntriesByType('resource')
  .map(entry => new URL(entry.name).pathname).filter(name => /\/i18n-.*\.js$/.test(name)));

test('saved Russian loads only its dictionary; language change waits before saving and retains a dirty field', { timeout: 12000 }, async () => {
  let releaseJapanese, requested;
  const requestedPromise = new Promise(resolve => { requested = resolve; });
  const page = await pageFor('ru', 'benefits-astra', async page => {
    await page.route('**/i18n-ja-*.js', async route => {
      requested(); await new Promise(resolve => { releaseJapanese = resolve; }); await route.continue();
    });
  });
  try {
    await page.locator('.overview-activity').waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'ru');
    assert.equal((await localeRequests(page)).length, 1);
    assert.match((await localeRequests(page))[0], /i18n-ru-/);
    await navigate(page, russian.settings, '.settings-list');
    const field = page.locator('.settings-list input[type="number"]').first();
    await field.fill('23');
    await page.locator('.language-menu select').selectOption('ja');
    await requestedPromise;
    assert.equal((await page.evaluate(() => window.codexWebLauncher.snapshot())).state.language, 'ru');
    assert.equal(await field.inputValue(), '23');
    releaseJapanese();
    await page.waitForFunction(() => document.documentElement.lang === 'ja');
    assert.equal((await page.evaluate(() => window.codexWebLauncher.snapshot())).state.language, 'ja');
    assert.equal(await field.inputValue(), '23');
    assert.equal(await page.locator('.language-menu select').inputValue(), 'ja');
    assert.equal((await localeRequests(page)).length, 2);
    await page.locator('.language-menu select').selectOption('ru');
    await page.waitForFunction(() => document.documentElement.lang === 'ru');
    assert.equal((await localeRequests(page)).length, 2);
    const output = path.resolve(__dirname, '../output/playwright/architecture-refactor/locale-settings.png');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output, fullPage: true });
  } finally { releaseJapanese?.(); await page.close(); }
});

test('onboarding ignores late dictionary completion and only saves the selected ready language', { timeout: 12000 }, async () => {
  let releaseRussian, requested;
  const requestedPromise = new Promise(resolve => { requested = resolve; });
  const page = await pageFor('en', 'onboarding', async page => {
    await page.route('**/i18n-ru-*.js', async route => {
      requested(); await new Promise(resolve => { releaseRussian = resolve; }); await route.continue();
    });
  });
  try {
    await page.locator('.welcome').waitFor();
    // Existing fixture has a saved language, so the wizard opens at mode choice.
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await page.getByRole('radio', { name: /Русский/ }).click();
    await requestedPromise;
    assert.equal(await page.locator('.welcome-footer .button-primary').isDisabled(), true);
    await page.getByRole('radio', { name: /English/ }).click();
    releaseRussian();
    await page.getByRole('button', { name: 'Continue', exact: true }).click();
    assert.equal((await page.evaluate(() => window.codexWebLauncher.snapshot())).state.language, 'en');
    assert.equal(await page.locator('.welcome').getAttribute('lang'), 'en');
  } finally { releaseRussian?.(); await page.close(); }
});

test('missing saved language keeps English UI available and recovers by explicit reload', { timeout: 12000 }, async () => {
  let requests = 0;
  const page = await pageFor('ru', 'benefits-astra', async page => {
    await page.route('**/i18n-ru-*.js', route => requests++ === 0 ? route.abort('failed') : route.continue());
  });
  try {
    await page.locator('.overview-activity').waitFor();
    await page.locator('.locale-notice[role="alert"]').waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'en');
    assert.equal((await page.evaluate(() => window.codexWebLauncher.snapshot())).state.language, 'ru');
    await navigate(page, 'Settings', '.settings-list');
    await page.locator('.locale-notice').getByRole('button', { name: 'Reload' }).click();
    await page.locator('.overview-activity').waitFor();
    assert.equal(await page.locator('html').getAttribute('lang'), 'ru');
    assert.equal(await page.locator('.locale-notice').count(), 0);
  } finally { await page.close(); }
});
