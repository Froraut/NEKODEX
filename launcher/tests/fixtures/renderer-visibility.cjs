// Run with the repository's Electron executable after build:renderer. This app uses only a
// temporary test profile and a loopback mock launcher; it never connects to Chrome or ChatGPT.
const { app, BrowserWindow, session } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const assert = require("node:assert/strict");
const { createFixtureServer } = require("./ui-preview.cjs");
const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-renderer-visibility-"));
app.setPath("userData", root);
app.setName("Codex renderer visibility fixture");
app.disableHardwareAcceleration();
let server, window;
const deadline = setTimeout(() => { process.stderr.write("Renderer visibility fixture timed out\n"); app.exit(1); }, 20_000);
async function waitFor(selector) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (await window.webContents.executeJavaScript(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(`Fixture did not render ${selector}`);
}
async function assertVisible(selector) {
  const result = await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return { present: false };
    const bounds = element.getBoundingClientRect();
    let visible = bounds.width > 0 && bounds.height > 0;
    for (let node = element; node instanceof Element; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (Number(style.opacity) < 0.99 || style.visibility === 'hidden' || style.display === 'none') visible = false;
    }
    return { present: true, visible, text: element.textContent };
  })()`);
  assert.equal(result.present, true, `${selector} must exist`);
  assert.equal(result.visible, true, `${selector} must be visible without an animation frame`);
  return result;
}
async function clickByText(selector, label) {
  const found = await window.webContents.executeJavaScript(`(() => {
    const button = [...document.querySelectorAll(${JSON.stringify(selector)})].find(node => node.textContent.trim() === ${JSON.stringify(label)});
    if (!button || button.disabled) return false;
    button.click(); return true;
  })()`);
  assert.equal(found, true, `Fixture control ${label} must be enabled`);
}
app.whenReady().then(async () => {
  app.dock?.hide();
  server = createFixtureServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !(details.url.startsWith(`${origin}/`) || details.url.startsWith("data:")) });
  });
  window = new BrowserWindow({ show: false, width: 1280, height: 900,
    webPreferences: { backgroundThrottling: false, contextIsolation: true, nodeIntegration: false, sandbox: true } });
  await window.loadURL(`${origin}/?scenario=existing-chrome-failed&no-animation-frames=true`);
  await waitFor(".app-shell");
  await assertVisible(".app-shell"); await assertVisible(".error-toast"); await assertVisible(".surface-transition");
  await clickByText(".error-toast button", "Dismiss");
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(await window.webContents.executeJavaScript("Boolean(document.querySelector('.error-toast'))"), false);
  await clickByText(".sidebar-item", "Browser");
  await waitFor(".existing-chrome-login-guide");
  const failure = await assertVisible(".existing-chrome-login-guide");
  assert.match(failure.text, /operating system blocked access/i);
  await clickByText(".existing-chrome-login-guide button", "Retry");
  assert.equal(await window.webContents.executeJavaScript("window.fixtureCalls.some(call => call[0] === 'existing-chrome-retry')"), true);
  await clickByText(".sidebar-item", "Setup"); await waitFor(".setup-list"); await assertVisible(".setup-list");
  await window.loadURL(`${origin}/?scenario=onboarding&no-animation-frames=true`);
  await waitFor(".welcome-stage"); await assertVisible(".welcome-stage");
  // Account setup navigation must not wait for an outgoing opacity animation either.
  await clickByText(".welcome button", "Continue");
  await new Promise(resolve => setTimeout(resolve, 50));
  await assertVisible(".welcome-stage");
  process.stdout.write("Renderer visibility passed: shell, errors, recovery, navigation, onboarding with animation frames paused\n");
  clearTimeout(deadline); window.destroy(); server.close();
  fs.rmSync(root, { recursive: true, force: true }); app.exit(0);
}).catch(error => {
  clearTimeout(deadline); process.stderr.write(`${error.message}\n`);
  if (window && !window.isDestroyed()) window.destroy(); server?.close();
  fs.rmSync(root, { recursive: true, force: true }); app.exit(1);
});
