// Focused source-renderer probe; synthetic IPC, no accounts or provider requests.
const fs = require('node:fs');
const path = require('node:path');
const { gzipSync } = require('node:zlib');
const { chromium } = require('playwright-core');
const { createFixtureServer } = require('../tests/fixtures/ui-preview.cjs');

async function measure() {
  const server = createFixtureServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    await page.addInitScript(() => {
      window.fixtureCommits = 0;
      window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber: true, renderers: new Map(),
        inject(renderer) { this.renderers.set(1, renderer); return 1; },
        onCommitFiberRoot() { window.fixtureCommits++; }, onCommitFiberUnmount() {}, checkDCE() {} };
    });
    await page.route('**/fixture-setup.js', async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: await response.text() + `
        window.codexWebLauncher.onLog = listener => { window.emitMeasuredLog = listener; return () => {}; };
      ` });
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?scenario=benefits-astra&language=en`);
    await page.locator('.overview-activity').waitFor();
    const initialScripts = await page.evaluate(() => performance.getEntriesByType('resource')
      .filter(entry => new URL(entry.name).pathname.endsWith('.js') && !entry.name.includes('fixture-setup'))
      .map(entry => new URL(entry.name).pathname));
    const files = initialScripts.map(name => fs.readFileSync(path.resolve(__dirname, '../dist', '.' + name)));
    const evidence = { initialJavaScriptBytes: files.reduce((n, file) => n + file.length, 0),
      initialJavaScriptGzipBytes: files.reduce((n, file) => n + gzipSync(file).length, 0), initialScripts, screens: {} };
    for (const [label, ready] of [['Settings', '.settings-list'], ['Activity', '.activity-filters']]) {
      await page.locator('.sidebar-item').filter({ hasText: label }).first().click();
      await page.locator(ready).first().waitFor();
      await page.waitForTimeout(200);
      evidence.screens[label] = await page.evaluate(async () => {
        const before = window.fixtureCommits;
        for (let i = 0; i < 120; i++) {
          window.emitMeasuredLog({ at: new Date().toISOString(), level: 'info', event: 'perf.sample', detail: { i } });
          await new Promise(resolve => setTimeout(resolve, 5));
        }
        await new Promise(resolve => setTimeout(resolve, 180));
        return { emittedLogs: 120, reactCommits: window.fixtureCommits - before,
          visibleRows: document.querySelectorAll('.activity-row').length };
      });
    }
    console.log(JSON.stringify(evidence, null, 2));
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
}
measure().catch(error => { console.error(error); process.exitCode = 1; });
