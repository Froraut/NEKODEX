// One focused standalone browser flow. Does not launch Electron or a provider client.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { chromium } = require('playwright-core');
const repository = path.resolve(__dirname, '../..');
const output = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-native-threads-ui-'));
const screenshot = path.join(os.tmpdir(), 'nekodex-native-threads-ui-evidence.png');
let browser, server;
async function main() {
  try {
    // The launcher no longer ships esbuild (Vite uses Rolldown); Bun bundles the same entry.
    const esbuild = path.join(repository, 'launcher/node_modules/esbuild/bin/esbuild');
    const build = fs.existsSync(esbuild)
      ? spawnSync(esbuild, ['tests/fixtures/native-threads-ui.ts', '--bundle', '--format=esm', '--platform=browser',
        '--tsconfig=launcher/tsconfig.json', `--outdir=${output}`, '--loader:.png=file'],
      { cwd: repository, encoding: 'utf8', timeout: 15_000 })
      : spawnSync(process.env.BUN || 'bun', ['build', 'tests/fixtures/native-threads-ui.ts', '--target=browser',
        '--format=esm', `--outdir=${output}`], { cwd: repository, encoding: 'utf8', timeout: 15_000 });
    assert.equal(build.status, 0, build.stderr || build.error?.message);
    assert(fs.existsSync(path.join(output, 'native-threads-ui.js')), 'Surface fixture bundle is missing');
    server = http.createServer((request, response) => {
      if (request.url === '/') {
        response.setHeader('Content-Type', 'text/html');
        response.end('<!doctype html><html lang="en" data-theme="dark"><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/native-threads-ui.css"><style>body{margin:0;background:var(--bg-under);color:var(--text-primary);font-family:system-ui}#root{padding:24px;box-sizing:border-box}*{box-sizing:border-box}</style><div id="root"></div><script type="module" src="/native-threads-ui.js"></script></html>');
        return;
      }
      const filename = request.url?.slice(1);
      if (!filename || !/^[a-zA-Z0-9_.-]+$/.test(filename) || !fs.existsSync(path.join(output, filename))) {
        response.writeHead(404); response.end(); return;
      }
      response.setHeader('Content-Type', filename.endsWith('.js') ? 'text/javascript' : filename.endsWith('.css') ? 'text/css' : 'image/png');
      response.end(fs.readFileSync(path.join(output, filename)));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    browser = await chromium.launch({ channel: 'chrome', headless: true });
    const page = await browser.newPage({ viewport: { width: 1280, height: 1024 } });
    const errors = []; page.on('pageerror', reason => errors.push(reason.message));
    await page.goto(`http://127.0.0.1:${address.port}/`);
    await page.getByRole('heading', { name: 'Native Codex threads', exact: true }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.nativeThreadsFixture.calls), []);
    await page.getByRole('button', { name: 'Load native threads', exact: true }).click();
    await page.getByText('codex-cli/0.163.0 · isolated UI fixture', { exact: false }).waitFor();
    await page.getByRole('button', { name: /Read metadata: Fixture worker/ }).click();
    await page.getByText('Waiting for native approval', { exact: true }).waitFor();
    await page.getByText('Subagent threads stay with their parent conversation and cannot be handed off.', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Fork history', exact: true }).click();
    await page.getByText('Fork created', { exact: true }).waitFor();
    await page.getByRole('heading', { name: 'Fork of fixture worker', exact: true }).waitFor();
    await page.getByText('Stored thread attachments: Copied to the fork', { exact: false }).waitFor();
    assert.deepEqual(await page.evaluate(() => window.nativeThreadsFixture.calls), [
      'list', 'read:0199a001-0000-7000-8000-000000000002', 'fork:0199a001-0000-7000-8000-000000000002']);
    await page.screenshot({ path: screenshot, fullPage: true });
    await page.setViewportSize({ width: 640, height: 900 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await page.getByRole('button', { name: /Read metadata: Fixture parent/ }).click();
    // A draft belongs to its thread: switching selection clears it.
    await page.getByLabel('Message for this thread', { exact: true }).fill('Draft for the parent');
    await page.getByRole('button', { name: /Read metadata: Fork of fixture worker/ }).click();
    await page.getByRole('heading', { name: 'Fork of fixture worker', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Message for this thread', { exact: true }).inputValue(), '');
    await page.getByRole('button', { name: /Read metadata: Fixture parent/ }).click();
    await page.getByRole('heading', { name: 'Fixture parent', exact: true }).waitFor();
    assert.equal(await page.getByLabel('Message for this thread', { exact: true }).inputValue(), '');
    await page.getByLabel('Message for this thread', { exact: true }).fill('Fixture follow-up');
    await page.getByRole('button', { name: 'Take over and send', exact: true }).click();
    await page.getByText('Reply received; thread released to Codex', { exact: true }).waitFor();
    await page.getByText('Fixture final reply', { exact: true }).waitFor();
    await page.getByText('Approval or input requests declined: 1', { exact: true }).waitFor();
    await page.evaluate(() => { window.nativeThreadsFixture.ownerActive = true; });
    await page.getByLabel('Message for this thread', { exact: true }).fill('Second try');
    await page.getByRole('button', { name: 'Take over and send', exact: true }).click();
    await page.getByText(/Another Codex client still owns this thread/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    assert.deepEqual((await page.evaluate(() => window.nativeThreadsFixture.calls)).filter(call => call.startsWith('continue:')), [
      'continue:0199a001-0000-7000-8000-000000000001:Fixture follow-up', 'continue:0199a001-0000-7000-8000-000000000001:Second try']);
    await page.evaluate(() => { window.nativeThreadsFixture.unknownFork = true; });
    await page.getByRole('button', { name: 'Fork history', exact: true }).click();
    await page.getByText('Fork outcome requires inspection', { exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Fork history', exact: true }).getAttribute('aria-disabled'), 'true');
    await page.getByRole('button', { name: 'I inspected this action', exact: true }).click();
    assert.equal(await page.getByRole('button', { name: 'Fork history', exact: true }).isEnabled(), true);
    await page.evaluate(() => { window.nativeThreadsFixture.failList = true; });
    await page.getByRole('button', { name: 'Reload', exact: true }).click();
    await page.getByText('This installed Codex version does not support this action.', { exact: true }).waitFor();
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ initialRequests: 0, metadataTreeRead: 'passed', explicitFork: 'passed',
      unknownForkBlocked: 'passed', explicitInspectionAcknowledgment: 'passed', exclusiveHandoff: 'passed', ownerActiveRefusal: 'passed', forkAttachmentParity: 'passed', unsupportedVersion: 'passed', narrowOverflow: false, screenshot }));
  } finally {
    if (browser) await browser.close();
    if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(output, { recursive: true, force: true });
    console.log(JSON.stringify({ browserClosed: true, serverClosed: true, intermediateBundleRemoved: !fs.existsSync(output) }));
  }
}
main().catch(reason => { console.error(reason); process.exitCode = 1; });
