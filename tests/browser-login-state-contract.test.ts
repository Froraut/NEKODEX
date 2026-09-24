import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { browserLoginStateExists, loginVerificationMarkerPath, verifyBrowserLoginSnapshot,
  writeBrowserLoginVerificationMarker } from "../src/browser-login-state";
const capabilities = { solAvailable: true, extraHighAvailable: true, proAvailable: false };
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "login-state-contract-"));
  const storageStatePath = join(root, "state.json");
  const state = { cookies: [], origins: [{ origin: "https://chatgpt.com", localStorage: [{ name: "owner", value: "A" }] }] };
  writeFileSync(storageStatePath, JSON.stringify(state));
  writeBrowserLoginVerificationMarker(storageStatePath, capabilities);
  return { root, storageStatePath, state };
}
test("deferred verifier receives A and refuses to attest replacement B", async () => {
  const f = fixture();
  try {
    const oldMarker = readFileSync(loginVerificationMarkerPath(f.storageStatePath), "utf8");
    let finish!: (value: typeof capabilities) => void;
    let reached = false;
    const pending = verifyBrowserLoginSnapshot(f.storageStatePath, async state => {
      expect(state).toEqual(f.state);
      reached = true;
      return new Promise(resolve => { finish = resolve; });
    });
    expect(reached).toBe(true);
    writeFileSync(f.storageStatePath, JSON.stringify({ cookies: [], origins: [] }));
    finish(capabilities);
    await expect(pending).rejects.toThrow("changed during verification");
    expect(readFileSync(loginVerificationMarkerPath(f.storageStatePath), "utf8")).toBe(oldMarker);
    expect(browserLoginStateExists(f)).toBe(false);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test("unchanged snapshot publishes capabilities and remains trusted", async () => {
  const f = fixture();
  try {
    expect(await verifyBrowserLoginSnapshot(f.storageStatePath, async state => {
      expect(state).toEqual(f.state);
      return capabilities;
    })).toEqual(capabilities);
    expect(browserLoginStateExists(f)).toBe(true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
test("capture-only marker cannot enter verifier, legacy authenticated marker upgrades only after inspection", async () => {
  const f = fixture();
  try {
    const marker = loginVerificationMarkerPath(f.storageStatePath);
    writeFileSync(marker, JSON.stringify({ version: 1, captureComplete: true }));
    let inspected = false;
    await expect(verifyBrowserLoginSnapshot(f.storageStatePath, async () => {
      inspected = true; return capabilities;
    })).rejects.toThrow("cannot be safely reverified");
    expect(inspected).toBe(false);
    writeFileSync(marker, JSON.stringify({ version: 1, authenticated: true, verifiedAt: new Date().toISOString() }));
    expect(browserLoginStateExists(f)).toBe(false);
    await verifyBrowserLoginSnapshot(f.storageStatePath, async () => { inspected = true; return capabilities; });
    expect(inspected).toBe(true);
    expect(browserLoginStateExists(f)).toBe(true);
  } finally { rmSync(f.root, { recursive: true, force: true }); }
});
