const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  BrowserWorkspaceManifest,
  MAX_WORKSPACES,
  normalizeManifest,
  safeWorkspaceLocation,
} = require("../electron/browser-workspace-manifest.cjs");

test("workspace locations retain only safe ChatGPT paths without query secrets", () => {
  assert.equal(safeWorkspaceLocation("https://chatgpt.com/c/abc?utm=x#message"), "https://chatgpt.com/c/abc");
  assert.equal(safeWorkspaceLocation("https://chatgpt.com/?temporary-chat=true"), null);
  assert.equal(safeWorkspaceLocation("https://chatgpt.com/auth/login?token=secret"), null);
  assert.equal(safeWorkspaceLocation("https://example.test/c/abc"), null);
});

test("workspace manifest is account-bound, bounded and rejects malformed entries", () => {
  const entries = Array.from({ length: MAX_WORKSPACES + 4 }, (_, index) => ({
    id: `window-${index}`,
    groupId: `group-${index}`,
    location: `https://chatgpt.com/c/${index}?private=value`,
    restore: "supported",
    bounds: { x: index, y: index, width: 900, height: 700 },
    lastActiveAt: index,
  }));
  entries.splice(2, 0, { id: "bad", groupId: "bad", location: "https://example.test/" });
  const manifest = normalizeManifest({ version: 1, accountId: "a", entries }, "a");
  assert.equal(manifest.entries.length, MAX_WORKSPACES);
  assert.equal(manifest.entries.some(entry => entry.id === "bad"), false);
  assert.equal(manifest.entries[0].location.includes("?"), false);
  assert.deepEqual(normalizeManifest({ version: 1, accountId: "a", entries }, "b").entries, []);
});

test("workspace manifest writes an owner-only atomic file and recovers from corruption", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-workspaces-"));
  const file = path.join(root, "workspace-a.json");
  try {
    const store = new BrowserWorkspaceManifest(file, "a");
    store.write([{ id: "one", groupId: "group", location: "https://chatgpt.com/c/one", restore: "supported" }]);
    assert.equal(store.read().entries[0].location, "https://chatgpt.com/c/one");
    if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o077, 0);
    fs.writeFileSync(file, "not json");
    assert.deepEqual(store.read().entries, []);
    assert.equal(store.lastReadStatus, "corrupt");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
