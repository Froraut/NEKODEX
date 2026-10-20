import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { passkeyLoginFailure } = require("../launcher/electron/passkey-login-progress.cjs");
const { parseBindings, createChromeProfileBindingStore } = require("../launcher/electron/chrome-profile-binding.cjs");
const { createProfileClaimServer } = require("../launcher/electron/chrome-profile-choice.cjs");
const { isExistingChromeErrorCode, existingChromeError } = require("../launcher/electron/existing-chrome-errors.cjs");
const { BrowserHost } = require("../launcher/electron/browser-host.cjs");

const FP = "a".repeat(64);
const binding = (profileId: string) => ({ profileId, profileName: "Work", googleEmail: null, chatgptLabel: "Work",
  principalFingerprint: FP, verifiedAt: "2026-10-20T10:00:00.000Z" });

test("A4: 'before the timeout' is a timeout, not a verification failure", () => {
  const result = passkeyLoginFailure(new Error("ChatGPT login was not completed before the timeout"),
    { aborted: false, progressPhase: "verifying" });
  expect(result).toEqual({ phase: "timed-out", errorCode: "passkey-timeout" });
});

test("A1: chrome-discovery-timeout is a public existing-Chrome code", () => {
  expect(isExistingChromeErrorCode("chrome-discovery-timeout")).toBe(true);
  expect(passkeyLoginFailure(Object.assign(new Error("x"), { code: "chrome-discovery-timeout" }),
    { aborted: false, progressPhase: "importing" }).errorCode).toBe("chrome-discovery-timeout");
});

test("A3: one invalid binding no longer discards the other accounts", () => {
  const good = "11111111-2222-4333-8444-555555555555";
  const parsed = parseBindings(JSON.stringify({ version: 2, accounts: {
    default: binding("Default"), [good]: { broken: true }, "not-an-id": binding("Profile 2") } }));
  expect(Object.keys(parsed.accounts)).toEqual(["default"]);
  expect(parsed.skipped).toBe(2);
});

test("A3: saving after a partly invalid file keeps the other account's binding", () => {
  const dir = mkdtempSync(join(tmpdir(), "nk-binding-"));
  const store = createChromeProfileBindingStore(dir);
  const other = "11111111-2222-4333-8444-555555555555";
  writeFileSync(store.file, JSON.stringify({ version: 2, accounts: { default: binding("Default"), [other]: { broken: true } } }));
  const tx = store.begin(other, { id: "Profile 3", name: "Personal" });
  expect(tx.corruptPreviousFile).toBe(true);
  tx.commit({ principalFingerprint: "b".repeat(64), label: "Personal" });
  expect(store.read("default")?.profileId).toBe("Default");
  expect(store.read(other)?.profileId).toBe("Profile 3");
});

test("A2: the claim wait starts only when the caller says Chrome was launched", async () => {
  const server = await createProfileClaimServer({ timeoutMs: 50 });
  let failed: any = null;
  server.loaded.catch((error: any) => { failed = error; });
  await new Promise(resolve => setTimeout(resolve, 120));
  expect(failed).toBeNull();
  server.startWaiting();
  await new Promise(resolve => setTimeout(resolve, 120));
  expect(failed?.code).toBe("chrome-profile-claim-missing");
  server.cleanup();
});

test("A6: import keeps the view's Cloudflare cookies and skips Chrome's", async () => {
  const removed: string[] = [];
  const set: string[] = [];
  let cleared: any = "none";
  const jar = [
    { name: "cf_clearance", domain: ".chatgpt.com", path: "/", secure: true },
    { name: "__cf_bm", domain: ".chatgpt.com", path: "/", secure: true },
    { name: "__Secure-next-auth.session-token", domain: "chatgpt.com", path: "/", secure: true },
    { name: "oai-did", domain: ".chatgpt.com", path: "/", secure: true },
  ];
  const session: any = {
    clearStorageData: async (options?: any) => { cleared = options ?? "all"; },
    flushStorageData() {}, cookies: { flushStore: async () => {}, get: async () => jar,
      remove: async (url: string, name: string) => { removed.push(`${name}@${url}`); },
      set: async (cookie: any) => { set.push(cookie.name); } },
  };
  const contents = { isDestroyed: () => false, session, loadURL: async () => {} };
  const host: any = Object.assign(Object.create(BrowserHost.prototype), { view: { webContents: contents },
    turnTabs: new Map(), authGeneration: 0, authPrincipalFingerprint: null, authSessionFingerprint: null,
    retireAuthenticatedIdentity() {}, removeTurnTab() {} });
  await host.clearOwnedSessionForPasskey({ keepCloudflareCookies: true });
  expect(cleared.storages).not.toContain("cookies");
  expect(removed).toEqual(["__Secure-next-auth.session-token@https://chatgpt.com/", "oai-did@https://chatgpt.com/"]);
  removed.length = 0;
  await host.clearOwnedSessionForPasskey();
  expect(cleared).toBe("all");
  expect(removed).toEqual([]);
});
