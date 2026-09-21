const test = require("node:test");
const assert = require("node:assert/strict");
const { BrowserWorkspaceDirectory } = require("../electron/browser-workspace-directory.cjs");

function manager(items) {
  return {
    snapshot: () => ({ items, restoreAttempted: false, restoreResult: null, manifestStatus: "ready" }),
    open: options => ["open", options],
    restore: () => ["restore"],
    focus: id => ["focus", id],
    close: id => ["close", id],
  };
}

test("workspace directory reports open capacity and routes actions to the requested account", () => {
  const directory = new BrowserWorkspaceDirectory({ platform: "linux", maximum: 16 });
  directory.register("a", "Alpha", manager([
    { id: "open", state: "open" },
    { id: "saved", state: "saved" },
  ]));
  directory.register("b", "Beta", manager([{ id: "other", state: "open" }]));
  assert.deepEqual(directory.snapshot(), {
    platform: "linux",
    nativeTabs: false,
    maximum: 16,
    total: 2,
    accounts: [
      { accountId: "a", label: "Alpha", items: [{ id: "open", state: "open" }, { id: "saved", state: "saved" }], restoreAttempted: false, restoreResult: null, manifestStatus: "ready" },
      { accountId: "b", label: "Beta", items: [{ id: "other", state: "open" }], restoreAttempted: false, restoreResult: null, manifestStatus: "ready" },
    ],
  });
  assert.deepEqual(directory.focus("b", "other"), ["focus", "other"]);
  assert.throws(() => directory.open("missing"), /not available/);
});

test("workspace directory exposes uninitialized accounts without creating their browser host", () => {
  const directory = new BrowserWorkspaceDirectory({ platform: "darwin" });
  let resolved = false;
  const snapshot = directory.snapshot([{ id: "default", label: "Primary" }]);
  assert.equal(resolved, false);
  assert.deepEqual(snapshot.accounts[0], {
    accountId: "default", label: "Primary", nativeTabs: true, items: [], restoreAttempted: false,
    restoreResult: null, manifestStatus: "uninitialized", persistenceFailed: false,
  });
});
