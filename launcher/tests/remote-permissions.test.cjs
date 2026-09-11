const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createRemotePermissionPolicy, httpsOrigin } = require("../electron/remote-permissions.cjs");

function fixture({ consent = async () => true, timeoutMs = 1_000 } = {}) {
  const session = new EventEmitter();
  session.setPermissionCheckHandler = fn => { session.check = fn; };
  session.setPermissionRequestHandler = fn => { session.request = fn; };
  session.setDevicePermissionHandler = fn => { session.device = fn; };
  session.setDisplayMediaRequestHandler = fn => { session.display = fn; };
  const prompts = [];
  const contents = new EventEmitter();
  contents.url = "https://chatgpt.com/?temporary-chat=true";
  contents.destroyed = false;
  contents.visible = true;
  contents.isDestroyed = () => contents.destroyed;
  contents.getURL = () => contents.url;
  contents.session = session;
  const policy = createRemotePermissionPolicy({
    session,
    isAllowedPage: (url, kind) => httpsOrigin(url) === "https://chatgpt.com"
      || (kind === "auth" && httpsOrigin(url) === "https://accounts.google.com"),
    isVisible: wc => wc.visible,
    requestConsent: details => { prompts.push(details); return consent(details); },
    promptTimeoutMs: timeoutMs,
  });
  policy.register(contents);
  const details = () => ({ requestingUrl: contents.url, isMainFrame: true });
  const request = (permission, overrides = {}, wc = contents) => new Promise(resolve => {
    session.request(wc, permission, resolve, { ...details(), ...overrides });
  });
  return { session, contents, policy, prompts, details, request };
}

test("strict permission origins exclude insecure, credentialed, foreign-port and opaque URLs", () => {
  for (const value of ["https://chatgpt.com:444/", "https://me@chatgpt.com/", "http://chatgpt.com/", "about:blank", "file:///private/file", "garbage"]) {
    assert.equal(httpsOrigin(value), null);
  }
  assert.equal(httpsOrigin("https://chatgpt.com:443/"), "https://chatgpt.com");
});

test("clipboard checks never grant silently; each owned visible main-frame request needs consent", async () => {
  const f = fixture();
  try {
    for (const permission of ["clipboard-read", "clipboard-sanitized-write"]) {
      assert.equal(f.session.check(f.contents, permission, "https://chatgpt.com", f.details()), false);
      assert.equal(await f.request(permission), true);
      assert.equal(f.session.check(f.contents, permission, "https://chatgpt.com", f.details()), false);
    }
    assert.equal(f.prompts.length, 2);
    assert.equal(f.prompts[0].origin, "https://chatgpt.com");
    assert.equal(f.prompts[0].signal.aborted, true);
  } finally { f.policy.destroy(); }
});

test("foreign and same-origin child frames, workers, unknown views and missing frame evidence fail closed", async () => {
  const f = fixture();
  try {
    for (const details of [
      { isMainFrame: false }, { isMainFrame: undefined },
      { requestingUrl: "https://foreign.example/" },
      { requestingUrl: "https://chatgpt.com/previous-document" },
      { embeddingOrigin: "https://foreign.example" },
      { securityOrigin: "https://foreign.example" },
    ]) assert.equal(await f.request("clipboard-read", details), false);
    assert.equal(await f.request("clipboard-read", {}, null), false);
    assert.equal(await f.request("clipboard-read", {}, new EventEmitter()), false);
    assert.equal(f.session.check(f.contents, "clipboard-read", "https://foreign.example", f.details()), false);
    assert.equal(f.session.check(null, "clipboard-read", "https://chatgpt.com", f.details()), false);
    assert.equal(f.prompts.length, 0);
  } finally { f.policy.destroy(); }
});

test("owned pages on untrusted URLs and wrong sessions never receive a prompt", async () => {
  const f = fixture();
  try {
    for (const url of ["https://chatgpt.com.attacker.example/", "http://chatgpt.com/", "https://chatgpt.com:444/", "https://me@chatgpt.com/", "about:blank"]) {
      f.contents.url = url;
      assert.equal(await f.request("clipboard-read"), false);
    }
    f.contents.url = "https://chatgpt.com/";
    f.contents.session = {};
    assert.equal(await f.request("clipboard-read"), false);
    assert.throws(() => f.policy.register(f.contents), /ownership is invalid/);
    assert.equal(f.prompts.length, 0);
  } finally { f.policy.destroy(); }
});

test("only owned auth-role main frames on an exact allowed provider may request clipboard consent", async () => {
  const f = fixture();
  try {
    f.contents.url = "https://accounts.google.com/signin";
    assert.equal(await f.request("clipboard-read"), false);
    f.policy.unregister(f.contents);
    f.policy.register(f.contents, "auth");
    assert.equal(await f.request("clipboard-read"), true);
    assert.equal(await f.request("clipboard-read", { isMainFrame: false }), false);
    assert.equal(f.prompts.length, 1);
  } finally { f.policy.destroy(); }
});

test("sensitive and future permissions, hardware and screen capture are denied without prompting", async () => {
  const f = fixture();
  try {
    for (const permission of ["media", "display-capture", "geolocation", "notifications", "hid", "usb", "serial", "midi", "midiSysex", "storage-access", "top-level-storage-access", "fileSystem", "openExternal", "fullscreen", "pointerLock", "keyboardLock", "idle-detection", "deprecated-sync-clipboard-read", "unknown", "future-permission"]) {
      assert.equal(f.session.check(f.contents, permission, "https://chatgpt.com", f.details()), false);
      assert.equal(await f.request(permission), false);
    }
    assert.equal(f.session.device({ origin: "https://chatgpt.com", deviceType: "usb" }), false);
    f.session.display({ frame: {} }, value => assert.deepEqual(value, {}));
    f.session.emit("file-system-access-restricted", {}, { origin: "https://chatgpt.com", path: "/private" }, value => assert.equal(value, "deny"));
    assert.equal(f.prompts.length, 0);
  } finally { f.policy.destroy(); }
});

test("denied consent, failed dialogs and missing consent handlers fail closed", async () => {
  for (const consent of [async () => false, async () => { throw new Error("closed"); }, null]) {
    const f = fixture({ consent });
    try { assert.equal(await f.request("clipboard-read"), false); }
    finally { f.policy.destroy(); }
  }
});

test("hidden tabs cannot prompt and tab hiding cancels pending consent", async () => {
  let approve;
  const f = fixture({ consent: () => new Promise(resolve => { approve = resolve; }) });
  try {
    f.contents.visible = false;
    assert.equal(await f.request("clipboard-read"), false);
    f.contents.visible = true;
    const result = f.request("clipboard-read");
    await Promise.resolve();
    f.contents.visible = false;
    f.policy.refreshVisibility();
    assert.equal(await result, false);
    approve(true);
    assert.equal(f.prompts[0].signal.aborted, true);
  } finally { f.policy.destroy(); }
});

test("navigation and renderer death invalidate pending consent even after returning to the same URL", async () => {
  for (const event of ["did-start-navigation", "render-process-gone", "destroyed"]) {
    let approve;
    const f = fixture({ consent: () => new Promise(resolve => { approve = resolve; }) });
    let calls = 0;
    try {
      const result = new Promise(resolve => f.session.request(f.contents, "clipboard-read", value => {
        calls += 1; resolve(value);
      }, f.details()));
      await Promise.resolve();
      f.contents.emit(event, { isMainFrame: true });
      assert.equal(await result, false);
      approve(true);
      await Promise.resolve();
      assert.equal(calls, 1);
      assert.equal(f.prompts[0].signal.aborted, true);
    } finally { f.policy.destroy(); }
  }
});

test("a navigation before the consent microtask does not open a stale dialog", async () => {
  const f = fixture();
  try {
    const result = f.request("clipboard-read");
    f.contents.emit("did-start-navigation", { isMainFrame: true });
    assert.equal(await result, false);
    assert.equal(f.prompts.length, 0);
  } finally { f.policy.destroy(); }
});

test("pending requests are bounded and do not queue duplicate permission dialogs", async () => {
  const keepAlive = setTimeout(() => {}, 100);
  const f = fixture({ consent: () => new Promise(() => {}), timeoutMs: 10 });
  try {
    const first = f.request("clipboard-read");
    assert.equal(await f.request("clipboard-sanitized-write"), false);
    assert.equal(await first, false);
    assert.equal(f.prompts.length, 1);
    assert.equal(f.prompts[0].signal.aborted, true);
  } finally { f.policy.destroy(); clearTimeout(keepAlive); }
});

test("teardown denies pending callbacks once, removes listeners and keeps the session fail closed", async () => {
  const f = fixture({ consent: () => new Promise(() => {}) });
  const result = f.request("clipboard-read");
  await Promise.resolve();
  f.policy.destroy();
  f.policy.destroy();
  assert.equal(await result, false);
  for (const event of ["did-start-navigation", "render-process-gone", "destroyed"]) assert.equal(f.contents.listenerCount(event), 0);
  assert.equal(f.session.listenerCount("file-system-access-restricted"), 0);
  assert.equal(await f.request("clipboard-read"), false);
  assert.equal(f.session.check(f.contents, "media", "https://chatgpt.com", f.details()), false);
  assert.equal(f.session.device({}), false);
  f.session.display({}, value => assert.deepEqual(value, {}));
  assert.throws(() => f.policy.register(f.contents), /ownership is invalid/);
});
