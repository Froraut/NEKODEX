// One rendered boundary check: consent, lost response reconciliation and explicit fork.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const repository = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-persistent-ui-'));
let browser, server;
async function main() {
  try {
    const build = spawnSync(path.join(repository, 'launcher/node_modules/esbuild/bin/esbuild'),
      ['tests/fixtures/native-persistent-ui.ts', '--bundle', '--format=esm', '--platform=browser',
        '--tsconfig=launcher/tsconfig.json', `--outdir=${output}`], { cwd: repository, encoding: 'utf8', timeout: 15_000 });
    assert.equal(build.status, 0, build.stderr || build.error?.message);
    server = http.createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html lang="en" data-theme="dark"><meta charset="UTF-8"><link rel="stylesheet" href="/native-persistent-ui.css"><style>body{font-family:system-ui;background:var(--bg-under);color:var(--text-primary);padding:20px}*{box-sizing:border-box}</style><div id="root"></div><script type="module" src="/native-persistent-ui.js"></script></html>');
      } else {
        const name = request.url?.slice(1);
        if (!name || !/^native-persistent-ui\.(js|css)$/.test(name)) { response.writeHead(404); response.end(); return; }
        response.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : 'text/css');
        response.end(fs.readFileSync(path.join(output, name)));
      }
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 700, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('heading', { name: 'Retained Native conversations' }).waitFor();
    await page.getByLabel('Native message').fill('Remember the fixture token.');
    assert.equal(await page.getByRole('button', { name: 'Create and send' }).isEnabled(), false);
    await page.getByRole('checkbox').check();
    await page.evaluate(() => { window.persistentFixture.snapshot.epoch = '0199a001-0000-7000-8000-000000000004'; });
    await page.getByRole('button', { name: 'Refresh conversations' }).click();
    assert.equal(await page.getByRole('checkbox').isChecked(), false);
    assert.equal(await page.getByRole('button', { name: 'Create and send' }).isEnabled(), false);
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create and send' }).click();
    await page.getByText('The original action needs a confirmed outcome; new sends are held.').waitFor();
    const heldCreate = page.getByRole('button', { name: 'Create and send' });
    assert.equal(await heldCreate.isDisabled() || await heldCreate.getAttribute('aria-disabled') === 'true', true);
    await page.getByRole('button', { name: 'Refresh conversations' }).click();
    await page.getByText('FIRST_RESULT', { exact: true }).waitFor();
    assert.equal(await page.getByLabel('Native message').inputValue(), '');
    await page.getByLabel('Native message').fill('Recall the token.');
    await page.getByRole('button', { name: 'Continue conversation' }).click();
    await page.getByText('FOLLOWUP_RESULT', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Fork retained context' }).click();
    await page.getByText('FORK_CONTEXT_RETAINED', { exact: true }).waitFor();
    const calls = await page.evaluate(() => window.persistentFixture.calls);
    assert.deepEqual(calls.filter(row => row.action !== 'snapshot').map(row => row.action), ['create', 'send', 'fork']);
    assert.equal(calls.filter(row => row.action === 'create').length, 1);
    assert.equal(calls.find(row => row.action === 'create').expectedContext.epoch, '0199a001-0000-7000-8000-000000000004');
    assert(calls.some(row => row.action === 'snapshot' && row.actionId === calls.find(row => row.action === 'create').actionId));
    assert.equal(calls.find(row => row.action === 'send').revision, 1);
    assert.equal(calls.find(row => row.action === 'fork').revision, 2);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    console.log(JSON.stringify({ consentRequired: true, accountChangeResetsConsent: true, lostResponseReconciledWithoutReplay: true,
      explicitFollowupAndFork: true, narrowOverflow: false, mutationCount: 3 }));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(output, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
