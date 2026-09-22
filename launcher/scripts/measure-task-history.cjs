// Synthetic Task Center workload against the current built renderer.
const { chromium } = require('playwright-core');
const { createFixtureServer } = require('../tests/fixtures/ui-preview.cjs');
(async () => {
  const server = createFixtureServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    page.setDefaultTimeout(6000);
    await page.addInitScript(() => {
      window.taskFormatters = 0;
      Intl.DateTimeFormat = new Proxy(Intl.DateTimeFormat, {
        construct(target, args) { window.taskFormatters++; return Reflect.construct(target, args); },
      });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?scenario=benefits-astra&language=en`);
    await page.locator('.overview-activity').waitFor();
    await page.evaluate(() => {
      const tasks = Array.from({ length: 1000 }, (_, i) => ({ id: `task-${i}`, traceId: `trace-${i}`,
        accountId: 'fixture-primary', accountName: 'Primary', model: 'High', phase: 'completed',
        submission: 'accepted', terminal: true, canOpen: false, canCancel: false, canDismiss: true,
        retrySafe: false, tabId: `tab-${i}`, createdAt: 1000 + i, updatedAt: 2000 + i, sequence: 1 }));
      window.fixtureSetBrowser({ tasks });
    });
    const before = await page.evaluate(() => window.taskFormatters);
    await page.locator('.sidebar-item').filter({ hasText: 'Task center' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.task-center-list article').length === 1000);
    const loaded = await page.evaluate(() => window.taskFormatters);
    await page.locator('.task-history-filters input').fill('trace-99');
    await page.waitForFunction(() => document.querySelectorAll('.task-center-list article').length === 11);
    console.log(JSON.stringify({ rows: 1000, initialDateFormatters: loaded - before,
      filteredRows: 11, filterDateFormatters: await page.evaluate(() => window.taskFormatters) - loaded }, null, 2));
  } finally { await browser?.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
