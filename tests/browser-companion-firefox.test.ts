import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzipSync, strFromU8 } from "fflate";
import { buildBrowserCompanion } from "../scripts/build-browser-companion";
import { companionExtensionOrigin, FIREFOX_COMPANION_ID } from "../src/browser-companion/firefox-identity";
import { createBrowserCompanionRuntime } from "../src/browser-companion/runtime";
import { browserCompanionRequest } from "../src/browser-companion/http";
import type { BrowserCompanionHost } from "../src/browser-companion/host";
import { COMPANION_ORIGIN } from "../src/browser-companion/protocol";

test("Firefox identity requires a separate explicit exact profile origin; Chrome identity remains deterministic", () => {
  const origin = "moz-extension://c7b114ab-2233-4455-8899-0123456789ab";
  expect(companionExtensionOrigin(FIREFOX_COMPANION_ID, origin)).toBe(origin);
  expect(companionExtensionOrigin("a".repeat(32))).toBe(`chrome-extension://${"a".repeat(32)}`);
  for (const unpinned of [undefined, "moz-extension://*", `${origin}/`, `${origin}/popup.html`, `${origin}?x=1`, "https://example.com", "null"]) {
    expect(() => companionExtensionOrigin(FIREFOX_COMPANION_ID, unpinned)).toThrow();
  }
  expect(() => companionExtensionOrigin("foreign@example.com", origin)).toThrow();
  expect(() => companionExtensionOrigin("a".repeat(32), origin)).toThrow();
});

test("Firefox control pins one origin before pairing, rejects another profile and revokes its exact token", async () => {
  const extensionOrigin = "moz-extension://c7b114ab-2233-4455-8899-0123456789ab";
  let host!: BrowserCompanionHost, starts = 0;
  const runtime = createBrowserCompanionRuntime({ startListener: candidate => { host = candidate; starts++; return { stop() {} }; } });
  const control = async (body: object) => browserCompanionRequest(new Request("http://127.0.0.1/admin/browser-companion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), () => runtime);
  try {
    expect((await control({ action: "enable", extensionId: FIREFOX_COMPANION_ID })).status).toBe(400);
    expect(starts).toBe(0);
    expect((await control({ action: "enable", extensionId: FIREFOX_COMPANION_ID, extensionOrigin })).status).toBe(200);
    expect(starts).toBe(1);
    await expect(runtime.enable(FIREFOX_COMPANION_ID, "moz-extension://d7b114ab-2233-4455-8899-0123456789ab")).rejects.toThrow("Disable");
    const offer = runtime.createPairing().pairing;
    expect(offer).toMatchObject({ extensionId: FIREFOX_COMPANION_ID, extensionOrigin });
    const request = (route: string, origin: string, token?: string, sessionId?: string) => host.fetch(new Request(`${COMPANION_ORIGIN}/v1/companion/${route}`, { method: "POST", headers: { "content-type": "application/json", origin, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ version: 1, hostId: offer.hostId, pairingCode: offer.pairingCode, sessionId }) }));
    expect((await request("pair", "moz-extension://d7b114ab-2233-4455-8899-0123456789ab")).status).toBe(403);
    const paired = await request("pair", extensionOrigin);
    expect(paired.status).toBe(200);
    expect(paired.headers.get("access-control-allow-origin")).toBe(extensionOrigin);
    const credentials = await paired.json() as { token: string; sessionId: string };
    expect((await request("pair", extensionOrigin)).status).toBe(403);
    expect((await request("revoke", extensionOrigin, credentials.token, credentials.sessionId)).status).toBe(200);
    expect(runtime.status().companion?.paired).toBe(false);
    expect((await request("poll", extensionOrigin, credentials.token, credentials.sessionId)).status).toBe(403);
  } finally { await runtime.close(); }
});

test("Firefox development package preserves exact-document API floor, scoped permissions and complete shared transport", () => {
  const temporary = mkdtempSync(join(tmpdir(), "nekodex-firefox-build-"));
  try {
    const first = buildBrowserCompanion("firefox", join(temporary, "first"));
    const second = buildBrowserCompanion("firefox", join(temporary, "second"));
    const files = unzipSync(readFileSync(first.archive));
    const manifest = JSON.parse(strFromU8(files["manifest.json"]!));
    expect(manifest.browser_specific_settings.gecko).toEqual({ id: "browser-companion@nekodex.local", strict_min_version: "153.0", data_collection_permissions: { required: ["browsingActivity", "websiteContent"] } });
    expect(manifest.minimum_chrome_version).toBeUndefined();
    expect(manifest.permissions).toEqual(["activeTab", "scripting", "storage"]);
    expect(manifest.host_permissions).toEqual(["http://127.0.0.1:17843/*"]);
    expect(manifest.background).toBeUndefined();
    expect(Object.keys(files).sort()).toEqual(readdirSync(first.directory).sort());
    // Every shipped relative module import resolves inside the artifact.
    for (const [name, content] of Object.entries(files)) {
      if (!name.endsWith(".js")) continue;
      for (const match of strFromU8(content).matchAll(/from\s+["']\.\/([^"']+)["']/g)) expect(files[match[1]!]).toBeDefined();
    }
    expect(readFileSync(first.archive)).toEqual(readFileSync(second.archive));
    expect(() => buildBrowserCompanion("firefox", join(temporary, "first"))).toThrow("already exists");
    expect(JSON.parse(readFileSync(join(temporary, "first", "development-artifact.json"), "utf8"))).toMatchObject({ installState: "not-installed", signed: false, published: false });
  } finally { rmSync(temporary, { recursive: true, force: true }); }
});
