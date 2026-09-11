// Offline native Electron request-shape regression. Clipboard callbacks are always
// denied at the harness boundary, even when the production policy grants consent:
// no OS clipboard contents are read or written by this test.
// Run from the repository root:
// env -u ELECTRON_RUN_AS_NODE launcher/node_modules/.bin/electron launcher/scripts/smoke-remote-permissions.cjs
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { app, BrowserWindow, session } = require("electron");
const { createRemotePermissionPolicy } = require("../electron/remote-permissions.cjs");

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "codex-permission-smoke-"));
app.setPath("userData", scratch);
app.commandLine.appendSwitch("disable-background-networking");
const timeout = setTimeout(() => finish(new Error("Remote permission smoke timed out")), 20_000);
const origin = "https://permission-fixture.invalid";
let window;
let policy;
let finished = false;

async function run() {
  await app.whenReady();
  const isolated = session.fromPartition(`permission-smoke-${process.pid}`);
  isolated.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith(`${origin}/`) });
  });
  isolated.protocol.handle("https", request => new Response(
    "<!doctype html><title>Offline permission fixture</title><p>Fixture</p>",
    { headers: { "content-type": "text/html" } },
  ));
  const requests = [];
  const checks = [];
  let displayRequests = 0;
  let consent = true;
  let prompts = 0;
  let nextPrompt;
  const setRequest = isolated.setPermissionRequestHandler.bind(isolated);
  const setCheck = isolated.setPermissionCheckHandler.bind(isolated);
  const setDisplay = isolated.setDisplayMediaRequestHandler.bind(isolated);
  isolated.setPermissionRequestHandler = handler => setRequest((contents, permission, callback, details) => {
    const event = { permission, details, decisions: [] };
    requests.push(event);
    handler(contents, permission, granted => {
      event.decisions.push(granted);
      // Deliberate safety boundary: observe the policy, never perform clipboard IO.
      callback(false);
    }, details);
  });
  isolated.setPermissionCheckHandler = handler => setCheck((contents, permission, requestingOrigin, details) => {
    const decision = handler(contents, permission, requestingOrigin, details);
    checks.push({ permission, requestingOrigin, details, decision });
    // Keep the harness safe even if a future regression grants a silent check.
    return false;
  });
  isolated.setDisplayMediaRequestHandler = handler => setDisplay((request, callback) => {
    displayRequests += 1;
    handler(request, streams => {
      assert.deepEqual(streams, {});
      callback(streams);
    });
  });
  policy = createRemotePermissionPolicy({
    session: isolated,
    isAllowedPage: url => new URL(url).origin === origin,
    isVisible: () => true, // Host selection is simulated; the fixture window is hidden.
    requestConsent: async () => {
      prompts += 1;
      nextPrompt?.();
      nextPrompt = null;
      return typeof consent === "function" ? consent() : consent;
    },
  });
  window = new BrowserWindow({ show: false, webPreferences: {
    session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false,
  } });
  policy.register(window.webContents);
  await window.loadURL(`${origin}/main`);
  window.webContents.focus();
  assert.deepEqual(await window.webContents.executeJavaScript(
    "({focused:document.hasFocus(),secure:isSecureContext,clipboard:!!navigator.clipboard})",
  ), { focused: true, secure: true, clipboard: true });
  for (const accepted of [true, false]) {
    consent = accepted;
    const before = requests.length;
    const result = await window.webContents.executeJavaScript(
      "navigator.clipboard.readText().then(() => 'unexpected-read', error => error.name)", true,
    );
    assert.equal(result, "NotAllowedError");
    assert.equal(requests.length, before + 1);
    assert.equal(requests.at(-1).permission, "clipboard-read");
    assert.equal(requests.at(-1).details.isMainFrame, true);
    assert.equal(requests.at(-1).details.requestingUrl, `${origin}/main`);
    assert.deepEqual(requests.at(-1).decisions, [accepted]);
  }
  assert.equal(prompts, 2);
  const query = await window.webContents.executeJavaScript(
    "navigator.permissions.query({name:'clipboard-read'}).then(result => result.state)",
  );
  assert.equal(query, "denied");
  assert.ok(checks.some(event => event.permission === "clipboard-read" && event.decision === false));

  // A real in-page navigation invalidates the pending permission generation. No
  // Electron event is synthesized here, and the original renderer stays alive.
  let approve;
  consent = () => new Promise(resolve => { approve = resolve; });
  const prompted = new Promise(resolve => { nextPrompt = resolve; });
  const stale = window.webContents.executeJavaScript(
    "navigator.clipboard.readText().then(() => 'unexpected-read', error => error.name)", true,
  );
  await prompted;
  await window.webContents.executeJavaScript("location.hash = 'navigated'");
  assert.equal(await stale, "NotAllowedError");
  approve(true);
  await Promise.resolve();
  assert.deepEqual(requests.at(-1).decisions, [false]);
  assert.equal(prompts, 3);

  const mediaBefore = requests.length;
  const mediaResult = await window.webContents.executeJavaScript(
    "navigator.mediaDevices.getUserMedia({audio:true,video:true}).then(stream => { stream.getTracks().forEach(track => track.stop()); return 'unexpected-media'; }, error => error.name)", true,
  );
  assert.equal(mediaResult, "NotAllowedError");
  assert.equal(requests.length, mediaBefore + 1);
  assert.equal(requests.at(-1).permission, "media");
  assert.deepEqual(requests.at(-1).decisions, [false]);
  assert.equal(prompts, 3);

  const screenBefore = requests.length;
  const screenResult = await window.webContents.executeJavaScript(
    "navigator.mediaDevices.getDisplayMedia({video:true}).then(stream => { stream.getTracks().forEach(track => track.stop()); return 'unexpected-screen'; }, error => error.name)", true,
  );
  assert.equal(screenResult, "NotAllowedError");
  assert.equal(requests.length, screenBefore + 1);
  // Electron 41 gates getDisplayMedia through a media permission before its source
  // selection hook; the deny policy prevents any screen enumeration or picker.
  assert.equal(requests.at(-1).permission, "media");
  assert.deepEqual(requests.at(-1).decisions, [false]);
  assert.equal(displayRequests, 0); // Rejected before Electron asks for a source.
  assert.equal(prompts, 3);

  await window.webContents.executeJavaScript(`new Promise(resolve => {
    const child = document.createElement('iframe');
    child.onload = resolve;
    child.src = '/child';
    document.body.append(child);
  })`);
  const child = window.webContents.mainFrame.frames.find(frame => frame.url === `${origin}/child`);
  assert.ok(child);
  const childBefore = requests.length;
  const childResult = await child.executeJavaScript(
    "window.focus(); navigator.clipboard.readText().then(() => 'unexpected-read', error => error.name)", true,
  );
  assert.equal(childResult, "NotAllowedError");
  assert.equal(requests.length, childBefore + 1);
  assert.equal(requests.at(-1).details.isMainFrame, false);
  assert.deepEqual(requests.at(-1).decisions, [false]);
  assert.equal(prompts, 3);
  assert.ok(checks.every(event => event.decision === false));
  console.log(`PASS: Electron ${process.versions.electron} native clipboard consent/denial, silent denial, child-frame denial, navigation invalidation, media and screen denial; clipboard IO suppressed`);
}

function finish(error) {
  if (finished) return;
  finished = true;
  clearTimeout(timeout);
  if (error) console.error(error);
  policy?.destroy();
  window?.destroy();
  fs.rmSync(scratch, { recursive: true, force: true });
  app.exit(error ? 1 : 0);
}

run().then(() => finish(), finish);
