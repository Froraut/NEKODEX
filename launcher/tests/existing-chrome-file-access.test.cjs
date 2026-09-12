const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { selectChromeConnectionFile, expectedChromeConnectionFile, validateConnectionContents } = require("../electron/existing-chrome-file-access.cjs");
const CONTENTS = "9222\n/devtools/browser/11111111-2222-3333-4444-555555555555\n";
function fixture() {
  const calls = [], controller = new AbortController();
  const homeDir = path.resolve("fixture-home"), expected = expectedChromeConnectionFile(homeDir);
  const stat = { isFile: () => true, isSymbolicLink: () => false, size: Buffer.byteLength(CONTENTS), uid: 123, dev: 1, ino: 2 };
  let offset = 0;
  const options = {
    platform: "darwin", homeDir, language: "en", signal: controller.signal, isCurrent: () => true, getuid: () => 123,
    dialog: { showOpenDialog: async (_window, input) => { calls.push(["dialog", input]); return { canceled: false, filePaths: [expected] }; } },
    window: {}, fileSystem: {
      lstatSync: file => { calls.push(["lstat", file]); return stat; },
      openSync: (file, flags) => { calls.push(["open", file, flags]); return 8; },
      fstatSync: fd => { calls.push(["fstat", fd]); return stat; },
      readSync: (_fd, target, start, length) => {
        calls.push(["read"]); const bytes = Buffer.from(CONTENTS).subarray(offset, offset + length);
        bytes.copy(target, start); offset += bytes.length; return bytes.length;
      },
      closeSync: fd => calls.push(["close", fd]),
    },
  };
  return { options, calls, controller, expected, stat };
}
const fileCalls = calls => calls.filter(([kind]) => kind !== "dialog");
test("macOS grants exactly one file and main reads it immediately after selection with bounded no-follow access", async () => {
  const { options, calls, expected } = fixture();
  assert.equal(await selectChromeConnectionFile(options), CONTENTS);
  const dialog = calls[0][1];
  assert.equal(dialog.defaultPath, expected);
  assert.deepEqual(dialog.properties, ["openFile", "noResolveAliases"]);
  assert.equal(Object.hasOwn(dialog, "securityScopedBookmarks"), false);
  assert.deepEqual(calls.map(([kind]) => kind), ["dialog", "lstat", "open", "fstat", "read", "read", "close"]);
  assert.equal(calls[2][2] & (fs.constants.O_NOFOLLOW ?? 0), fs.constants.O_NOFOLLOW ?? 0);
});
test("cancelled, other-path, directory and multi-file selections cause zero filesystem reads", async () => {
  for (const selected of [null, "different", "directory", "multiple"]) {
    const { options, calls, expected } = fixture();
    options.dialog.showOpenDialog = async () => selected === null ? { canceled: true, filePaths: [] }
      : { canceled: false, filePaths: selected === "multiple" ? [expected, expected]
        : [selected === "directory" ? path.dirname(expected) : `${expected}.other`] };
    if (selected === null) assert.equal(await selectChromeConnectionFile(options), null);
    else await assert.rejects(selectChromeConnectionFile(options), error => error.code === "chrome-file-selection-invalid");
    assert.deepEqual(fileCalls(calls), []);
  }
});
test("symlinks, non-regular files, replaced inode, different uid and oversized files are rejected before content reads", async () => {
  for (const kind of ["symlink", "directory", "replaced", "uid", "size"]) {
    const { options, calls, stat } = fixture();
    if (kind === "symlink") stat.isSymbolicLink = () => true;
    if (kind === "directory") stat.isFile = () => false;
    if (kind === "replaced") options.fileSystem.fstatSync = () => ({ ...stat, ino: 9 });
    if (kind === "uid") stat.uid = 999;
    if (kind === "size") stat.size = 2049;
    await assert.rejects(selectChromeConnectionFile(options));
    assert.ok(!calls.some(([kind]) => kind === "read"));
  }
});
test("cancellation or mode/owner change while picker is open forbids reads even after a late selection", async () => {
  for (const kind of ["cancel", "owner"]) {
    const { options, calls, controller, expected } = fixture();
    let current = true;
    options.isCurrent = () => current;
    let choose;
    options.dialog.showOpenDialog = () => new Promise(resolve => { choose = resolve; });
    const pending = selectChromeConnectionFile(options);
    await new Promise(resolve => setImmediate(resolve));
    if (kind === "cancel") controller.abort();
    else current = false;
    const rejected = assert.rejects(pending);
    choose({ canceled: false, filePaths: [expected] });
    await rejected;
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(fileCalls(calls), []);
  }
});
test("an abort during bounded reading prevents subsequent reads and still closes the descriptor", async () => {
  const { options, calls, controller } = fixture();
  options.fileSystem.readSync = () => { calls.push(["read"]); controller.abort(); return 1; };
  await assert.rejects(selectChromeConnectionFile(options));
  assert.equal(calls.filter(([kind]) => kind === "read").length, 1);
  assert.equal(calls.at(-1)[0], "close");
});
test("raw endpoint data and permission exceptions never appear in errors", async () => {
  for (const value of ["ws://secret.example", "9222\n/devtools/browser/SECRET\n", CONTENTS + "SECRET", "9".repeat(2049)]) {
    assert.throws(() => validateConnectionContents(value), error => !/SECRET|secret\.example/.test(error.message));
  }
  const { options } = fixture();
  options.fileSystem.openSync = () => { const error = new Error("SECRET filename"); error.code = "EPERM"; throw error; };
  await assert.rejects(selectChromeConnectionFile(options), error => error.code === "chrome-profile-access-denied" && !error.message.includes("SECRET"));
});
test("other operating systems and already-aborted attempts never open a picker", async () => {
  for (const platform of ["linux", "win32"]) {
    const { options, calls } = fixture(); options.platform = platform;
    await assert.rejects(selectChromeConnectionFile(options)); assert.deepEqual(calls, []);
  }
  const { options, calls, controller } = fixture(); controller.abort();
  await assert.rejects(selectChromeConnectionFile(options)); assert.deepEqual(calls, []);
});
