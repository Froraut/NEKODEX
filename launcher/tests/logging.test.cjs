const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { PassThrough } = require("node:stream");
const {
  createLogger,
  createRendererIpcGuard,
  exportSanitizedLogs,
  installProcessDiagnosticGuards,
  registerLoggedIpc,
  registerLoggedIpcEvent,
  sanitize,
} = require("../electron/logging.cjs");

test("launcher logs redact tunnel ids, runtime keys, and bearer credentials", () => {
  assert.deepEqual(sanitize({
    line: "tunnel_0123456789abcdef0123456789abcdef sk-exampleRuntimeSecret123",
    authorization: "Bearer this-must-never-be-recorded",
    nested: { controlToken: "also-secret" },
  }), {
    line: "[tunnel-id] [runtime-key]",
    authorization: "[redacted]",
    nested: { controlToken: "[redacted]" },
  });
});

test("failed launcher IPC calls are written to runtime activity", async () => {
  let registered;
  const errors = [];
  const ipcMain = {
    handle(channel, handler) {
      registered = { channel, handler };
    },
  };
  registerLoggedIpc(
    ipcMain,
    { error: (event, detail) => errors.push({ event, detail }) },
    "launcher:test",
    async () => {
      throw new Error("visible failure");
    },
    () => true,
  );

  await assert.rejects(registered.handler({}, 1), /visible failure/);
  assert.deepEqual(errors, [{
    event: "launcher.ipc_failed",
    detail: { channel: "launcher:test", message: "visible failure" },
  }]);
});

function rendererIpcFixture() {
  const mainFrame = {
    processId: 12,
    routingId: 34,
    parent: null,
    detached: false,
    isDestroyed: () => false,
    url: "file:///application/dist/index.html",
  };
  const contents = { isDestroyed: () => false, mainFrame };
  const window = { isDestroyed: () => false, webContents: contents };
  const fixture = {
    window,
    contents,
    mainFrame,
    // Equivalent native frame wrappers are not necessarily the same JavaScript object.
    event: { sender: contents, senderFrame: { ...mainFrame } },
  };
  fixture.authorize = createRendererIpcGuard({
    getMainWindow: () => fixture.window,
    isRendererUrlAllowed: url => url === "file:///application/dist/index.html",
  });
  return fixture;
}

test("launcher IPC accepts equivalent current top-frame wrappers only", () => {
  const { authorize, event, mainFrame } = rendererIpcFixture();
  assert.notEqual(event.senderFrame, mainFrame);
  assert.equal(authorize(event), true);
});

for (const [name, invalidate] of [
  ["another webContents", fixture => { fixture.event.sender = { ...fixture.contents }; }],
  ["another renderer process", fixture => { fixture.event.senderFrame.processId++; }],
  ["another frame routing ID", fixture => { fixture.event.senderFrame.routingId++; }],
  ["a missing frame identity", fixture => { delete fixture.event.senderFrame.processId; }],
  ["a child frame", fixture => { fixture.event.senderFrame.parent = fixture.mainFrame; }],
  ["a null sending frame", fixture => { fixture.event.senderFrame = null; }],
  ["a missing main frame", fixture => { fixture.contents.mainFrame = null; }],
  ["a detached sending frame", fixture => { fixture.event.senderFrame.detached = true; }],
  ["a detached main frame", fixture => { fixture.mainFrame.detached = true; }],
  ["a destroyed sending frame", fixture => { fixture.event.senderFrame.isDestroyed = () => true; }],
  ["a destroyed main frame", fixture => { fixture.mainFrame.isDestroyed = () => true; }],
  ["a destroyed webContents", fixture => { fixture.contents.isDestroyed = () => true; }],
  ["a destroyed window", fixture => { fixture.window.isDestroyed = () => true; }],
  ["a missing window", fixture => { fixture.window = null; }],
  ["a disallowed sending URL", fixture => { fixture.event.senderFrame.url = "https://untrusted.invalid/private"; }],
  ["a disallowed current URL", fixture => { fixture.mainFrame.url = "https://untrusted.invalid/private"; }],
  ["a destroyed native frame getter", fixture => {
    Object.defineProperty(fixture.event, "senderFrame", {
      get() { throw new Error("native getter exposed https://untrusted.invalid/private"); },
    });
  }],
]) {
  test(`launcher IPC rejects ${name} without exposing private details`, () => {
    const fixture = rendererIpcFixture();
    invalidate(fixture);
    assert.throws(() => fixture.authorize(fixture.event), {
      name: "Error",
      message: "Unauthorized launcher IPC sender",
    });
  });
}

test("IPC registration requires an explicit synchronous authorizer", async () => {
  const registered = [];
  const ipcMain = {
    handle: (_channel, handler) => registered.push(handler),
    on: (_channel, handler) => registered.push(handler),
  };
  const logger = { error() {} };
  let calls = 0;
  const handler = () => { calls++; };
  assert.throws(() => registerLoggedIpc(ipcMain, logger, "test", handler), /authorization is required/);
  assert.throws(() => registerLoggedIpcEvent(ipcMain, logger, "test", handler), /authorization is required/);
  assert.equal(registered.length, 0);

  registerLoggedIpc(ipcMain, logger, "test", handler, () => Promise.resolve(true));
  await assert.rejects(registered[0]({}), /Unauthorized launcher IPC sender/);
  assert.equal(calls, 0);
});

test("invoked IPC authorizes before calling privileged handlers", async () => {
  const fixture = rendererIpcFixture();
  let invoke;
  const errors = [];
  let calls = 0;
  registerLoggedIpc(
    { handle: (_channel, handler) => { invoke = handler; } },
    { error: (event, detail) => errors.push({ event, detail }) },
    "launcher:test",
    (_event, value) => { calls++; return value; },
    fixture.authorize,
  );
  await assert.rejects(invoke({ ...fixture.event, senderFrame: null }, "blocked"), /Unauthorized launcher IPC sender/);
  assert.equal(calls, 0);
  assert.equal(await invoke(fixture.event, "allowed"), "allowed");
  assert.equal(calls, 1);
  assert.deepEqual(errors, [{
    event: "launcher.ipc_failed",
    detail: { channel: "launcher:test", message: "Unauthorized launcher IPC sender" },
  }]);
});

test("one-way IPC rejects foreign senders and contains handler errors", async () => {
  const fixture = rendererIpcFixture();
  let listener;
  const errors = [];
  const actions = [];
  registerLoggedIpcEvent(
    { on: (_channel, handler) => { listener = handler; } },
    { error: (event, detail) => errors.push({ event, detail }) },
    "launcher:window-control",
    (_event, action) => {
      if (action === "failure") throw new Error("window action failed");
      actions.push(action);
    },
    fixture.authorize,
  );
  await listener({ ...fixture.event, sender: {} }, "close");
  assert.deepEqual(actions, []);
  await listener(fixture.event, "minimize");
  assert.deepEqual(actions, ["minimize"]);
  await listener(fixture.event, "failure");
  assert.deepEqual(errors.map(record => record.detail.message), [
    "Unauthorized launcher IPC sender",
    "window action failed",
  ]);
});

test("launcher activity restores valid records from the previous process", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-logging-"));
  const filePath = path.join(root, "launcher.jsonl");
  try {
    fs.writeFileSync(filePath, [
      JSON.stringify({ at: "2026-07-28T00:00:00.000Z", level: "info", event: "previous", detail: {} }),
      "not-json",
      "",
    ].join("\n"));
    const logger = createLogger({ filePath });
    assert.deepEqual(logger.recent().map((record) => record.event), ["previous"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("exported launcher logs remove local usernames, private ChatGPT titles, and URL paths", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-export-"));
  const filePath = path.join(root, "launcher.jsonl");
  const destinationPath = path.join(root, "shared", "diagnostics.jsonl");
  try {
    fs.writeFileSync(`${filePath}.1`, `${JSON.stringify({
      at: "2026-08-23T00:00:00.000Z",
      level: "error",
      event: "runtime.daemon_stdout",
      detail: {
        line: "prompt_attachment failed at C:\\Users\\private.user\\.codex and encoded C:\\\\Users\\\\private.user\\\\.codex; connector missing; visible rows: Private roadmap, Health notes",
      },
    })}\n`);
    fs.writeFileSync(filePath, `${JSON.stringify({
      at: "2026-08-23T00:01:00.000Z",
      level: "info",
      event: "runtime.stdout",
      detail: {
        line: "config loaded from /Users/local-person/.codex/config.toml",
        prompt: "private prompt",
        connector: "Codex Native4",
        url: "https://chatgpt.com/c/private-conversation?state=oauth-secret&email=private@example.com",
        message: "failed while loading 'https://accounts.google.com/o/oauth2/v2/auth?state=oauth-secret&login_hint=private@example.com'",
      },
    })}\n`);

    assert.equal(exportSanitizedLogs({ filePath, destinationPath }), 2);
    const exported = fs.readFileSync(destinationPath, "utf8");
    assert.doesNotMatch(exported, /private\.user|local-person|Private roadmap|Health notes|private prompt|private-conversation|oauth-secret|private@example\.com/);
    assert.match(exported, /\[user-home\]/);
    assert.match(exported, /visible rows: \[redacted\]/);
    assert.match(exported, /Codex Native4/);
    assert.match(exported, /"prompt":"\[redacted\]"/);
    assert.match(exported, /https:\/\/chatgpt\.com/);
    assert.match(exported, /https:\/\/accounts\.google\.com/);
    assert.throws(
      () => exportSanitizedLogs({ filePath, destinationPath: filePath }),
      /Refusing to overwrite a launcher source log/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("safe export independently redacts credential fields in legacy and rotated logs", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-legacy-export-"));
  const filePath = path.join(root, "launcher.jsonl");
  const destinationPath = path.join(root, "diagnostics.jsonl");
  const rawDetail = {
    Authorization: "Basic opaque-auth-value",
    nested: {
      runtimeKey: "opaque-runtime-value",
      controlToken: { value: "opaque-control-value" },
      records: [{ "set-cookie": "opaque-cookie-value", status: "failed" }],
    },
    operation: "doctor",
    prompt: "private prompt",
    path: "/Users/private-person/.codex/config.toml",
    url: "https://chatgpt.com/c/private-chat?state=private-state",
  };
  try {
    // Write directly to disk: export must not assume an earlier logger sanitized the records.
    const source = `${JSON.stringify({
      at: "2026-08-23T00:00:00.000Z",
      level: "error",
      event: "legacy.operation_failed",
      detail: rawDetail,
    })}\n`;
    fs.writeFileSync(`${filePath}.1`, source);
    fs.writeFileSync(filePath, source);

    assert.equal(exportSanitizedLogs({ filePath, destinationPath }), 2);
    const exported = fs.readFileSync(destinationPath, "utf8");
    const expectedDetail = {
      Authorization: "[redacted]",
      nested: {
        runtimeKey: "[redacted]",
        controlToken: "[redacted]",
        records: [{ "set-cookie": "[redacted]", status: "failed" }],
      },
      operation: "doctor",
      prompt: "[redacted]",
      path: "[user-home]/.codex/config.toml",
      url: "https://chatgpt.com",
    };
    for (const line of exported.trim().split("\n")) {
      assert.deepEqual(JSON.parse(line).detail, expectedDetail);
    }
    assert.doesNotMatch(exported, /opaque-|private-/);
    assert.equal(fs.readFileSync(filePath, "utf8"), source);
    assert.equal(fs.readFileSync(`${filePath}.1`, "utf8"), source);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a closed Windows diagnostic pipe is recorded without becoming an uncaught process error", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-gpt-process-pipe-"));
  const filePath = path.join(root, "process-stream-errors.log");
  const stream = new PassThrough();
  try {
    installProcessDiagnosticGuards({ filePath, streams: [stream] });
    stream.emit("error", Object.assign(new Error("write EOF"), { code: "EOF" }));
    assert.match(fs.readFileSync(filePath, "utf8"), /write EOF/);
  } finally {
    stream.destroy();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
