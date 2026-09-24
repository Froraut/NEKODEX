const test = require('node:test');
const assert = require('node:assert/strict');
const { chromium } = require('playwright-core');
const { createFixtureServer } = require('./fixtures/ui-preview.cjs');
const copy = require('../src/i18n-en.json');

test('Accounts accepts a covered notification without a second query and refreshes for newer evidence', { timeout: 12000 }, async () => {
  const server = createFixtureServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' });
    page.setDefaultTimeout(4000);
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.route('**/fixture-setup.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
        const readSnapshot = window.codexWebLauncher.snapshot;
        window.codexWebLauncher.snapshot = async () => {
          const value = structuredClone(await readSnapshot());
          value.browser.observation = { sourceId: 'ui-pool', revision: 10 };
          value.browser.authenticated = true;
          window.fixtureSetBrowser({ observation: { sourceId: 'ui-pool', revision: 9 },
            authenticated: false, authenticationStatus: 'signed-out' });
          return value;
        };
        const readAccounts = window.codexWebLauncher.accounts;
        window.accountReads = 0;
        window.accountRevision = 10;
        window.codexWebLauncher.accounts = async () => {
          window.accountReads++;
          const value = structuredClone(await readAccounts());
          value.observation = { sourceId: 'ui-pool', revision: window.accountRevision };
          value.accounts[0].label = 'Current revision ' + window.accountRevision;
          if (window.accountReads === 1) return new Promise(resolve => { window.resolveAccountRead = () => resolve(value); });
          return value;
        };
      ` });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?scenario=benefits-astra&language=en`);
    await page.locator('.overview-activity').waitFor();
    assert.equal((await page.locator('.sidebar-session').innerText()).trim(), copy.sessionConnected);
    await page.locator('.sidebar-item').filter({ hasText: 'Accounts' }).click();
    await page.waitForFunction(() => !!window.resolveAccountRead);
    await page.evaluate(() => {
      window.fixtureSetBrowser({ observation: { sourceId: 'ui-pool', revision: 10 },
        authenticated: true, authenticationStatus: 'verified' });
      window.resolveAccountRead();
    });
    await page.getByText('Current revision 10', { exact: true }).waitFor();
    await page.evaluate(() => {
      for (let i = 0; i < 40; i++) window.fixtureSetBrowser({
        title: 'Navigation ' + i, authenticated: false, authenticationStatus: 'signed-out',
        observation: { sourceId: 'ui-pool', revision: 9 },
      });
    });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.accountReads), 1);
    assert.equal((await page.locator('.sidebar-session').innerText()).trim(), copy.sessionConnected);
    await page.evaluate(() => {
      window.accountRevision = 11;
      window.fixtureSetBrowser({ observation: { sourceId: 'ui-pool', revision: 11 },
        authenticated: true, authenticationStatus: 'verified' });
    });
    await page.getByText('Current revision 11', { exact: true }).waitFor();
    assert.equal(await page.evaluate(() => window.accountReads), 2);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close(); await new Promise(resolve => server.close(resolve));
  }
});
