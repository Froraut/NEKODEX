// Isolated source Electron proof. Creates no configuration, account or provider request.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { _electron: electron } = require('playwright-core');
const output = path.resolve(__dirname, '../output/playwright/architecture-refactor');
test('source Electron uses the refactored renderer and real isolated preload', { timeout: 25000 }, async () => {
  fs.mkdirSync(output, { recursive: true });
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'nekodex-refactor-dev-'));
  fs.mkdirSync(path.join(profile, 'launcher'));
  fs.writeFileSync(path.join(profile, 'launcher', 'launcher-state.json'), JSON.stringify({
    version: 1, language: 'en', onboardingComplete: true, browserInteractionMode: 'manual',
    coreSetupComplete: false, keepRunningOnClose: false, sidebarOpen: true,
  }));
  let app, child, page;
  const errors = [];
  let stderr = '';
  const identity = { source: path.resolve(__dirname, '..'), profile, status: 'starting' };
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [path.resolve(__dirname, '..'), '--dev-profile'],
      env: { ...process.env, CODEX_WEB_GPT_DEV_HOME: profile, CODEX_WEB_GPT_BUN: process.env.CODEX_WEB_GPT_BUN || path.join(os.homedir(), '.bun/bin/bun') },
      timeout: 12000,
    });
    child = app.process();
    identity.pid = child.pid;
    child.stderr?.on('data', chunk => { stderr += chunk.toString(); });
    // Electron exposes guest WebContents as Playwright pages too. The first page
    // may be a zero-width browser host; bind only the exact source renderer.
    const rendererUrl = pathToFileURL(path.resolve(__dirname, '../dist/index.html')).href;
    const selectionDeadline = Date.now() + 4000;
    while (!page && Date.now() < selectionDeadline) {
      page = app.windows().find(candidate => candidate.url() === rendererUrl);
      if (!page) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(page, 'source renderer window was not found');
    identity.rendererUrl = page.url();
    page.setDefaultTimeout(4000);
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('.app-shell').waitFor();
    const snapshot = await page.evaluate(() => window.codexWebLauncher.snapshot());
    assert.equal(snapshot.profile, 'development');
    assert.equal(snapshot.profilePaths.coreHome, profile);
    assert.equal(snapshot.profilePaths.userData, path.join(profile, 'launcher'));
    assert.equal(snapshot.profilePaths.codexHome, path.join(profile, 'codex-home'));
    assert.equal(snapshot.state.browserInteractionMode, 'manual');
    assert.equal(snapshot.state.coreSetupComplete, false);
    identity.version = snapshot.version;
    identity.profilePaths = snapshot.profilePaths;
    identity.title = await page.title();
    identity.screens = [];
    for (const label of ['Overview', 'Accounts', 'Task center', 'Connections', 'Settings']) {
      await page.locator('.sidebar-item').filter({ hasText: label }).first().click();
      identity.screens.push(label);
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
    await page.screenshot({ path: path.join(output, 'source-electron-settings.png') });
    assert.deepEqual(errors, []);
    assert.equal(fs.existsSync(path.join(profile, 'config.json')), false);
    identity.pageErrors = errors;
    identity.status = 'passed';
  } catch (error) {
    identity.status = 'failed';
    identity.error = String(error);
    identity.pageErrors = errors;
    identity.stderr = stderr;
    if (app) identity.windows = await Promise.all(app.windows().map(async candidate => ({ url: candidate.url(), title: await candidate.title(), body: await candidate.locator('body').innerText() })));
    if (page) await page.screenshot({ path: path.join(output, 'source-electron-failure.png') })
      .catch(captureError => { identity.captureError = String(captureError); });
    throw error;
  } finally {
    try {
      if (app) {
        await app.close();
        identity.closed = child.exitCode !== null || child.signalCode !== null;
      }
    } finally {
      fs.writeFileSync(path.join(output, 'source-electron.json'), JSON.stringify(identity, null, 2));
      fs.rmSync(profile, { recursive: true, force: true });
    }
  }
});
