import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";

const require = createRequire(import.meta.url);
const { captureOwnedSession, restoreOwnedSession, disposeOwnedSessionSnapshot } = require("../launcher/electron/owned-session-rollback.cjs");

function browserFixture(entries: Map<string, string>) {
  const localStorage = {
    get length() { return entries.size; },
    key(index: number) { return [...entries.keys()][index] ?? null; },
    getItem(name: string) { return entries.get(name) ?? null; },
    setItem(name: string, value: string) { entries.set(name, value); },
  };
  const restoredCookies: unknown[] = [];
  return {
    restoredCookies,
    isDestroyed: () => false,
    getURL: () => "https://chatgpt.com/?temporary-chat=true",
    executeJavaScript: async (source: string) => runInNewContext(source, {
      location: { origin: "https://chatgpt.com" }, localStorage, TextEncoder,
    }),
    loadURL: async () => {},
    session: {
      cookies: { get: async () => [], set: async (cookie: unknown) => { restoredCookies.push(cookie); }, flushStore: async () => {} },
      flushStorageData() {},
    },
  };
}

test("sign-in rollback preserves a legitimate ChatGPT cache larger than 4 MiB", async () => {
  const original = "x".repeat(5_773_058);
  const entries = new Map([["workspace-cache", original], ["preferences", "retained"]]);
  const browser = browserFixture(entries);
  const snapshot = await captureOwnedSession(browser);
  entries.clear();
  await restoreOwnedSession(browser, snapshot, "https://chatgpt.com/?temporary-chat=true");
  expect(entries.get("workspace-cache")).toBe(original);
  expect(entries.get("preferences")).toBe("retained");
  disposeOwnedSessionSnapshot(snapshot);
  expect(snapshot.localStorage).toHaveLength(0);
});

test("oversized rollback state still fails before changing the browser session", async () => {
  const original = "x".repeat(64 * 1024 * 1024 + 1);
  const entries = new Map([["workspace-cache", original]]);
  const browser = browserFixture(entries);
  await expect(captureOwnedSession(browser)).rejects.toThrow("Rollback local storage is too large");
  expect(entries.get("workspace-cache")).toBe(original);
  expect(browser.restoredCookies).toHaveLength(0);
});
