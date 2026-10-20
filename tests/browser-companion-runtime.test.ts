import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { createBrowserCompanionRuntime } from "../src/browser-companion/runtime";
import { browserCompanionRequest } from "../src/browser-companion/http";
import { browserBindingOf, COMPANION_ORIGIN } from "../src/browser-companion/protocol";
import type { BrowserCompanionHost } from "../src/browser-companion/host";

const extensionId = "c".repeat(32);
test("companion runtime is off by default, explicitly owns one listener, and leaves conflicting ports alone", async () => {
  let starts = 0, stops = 0;
  const runtime = createBrowserCompanionRuntime({ startListener: () => { starts++; return { stop: async () => { stops++; } }; } });
  try {
    expect(runtime.status()).toMatchObject({ enabled: false, state: "disabled", restartPolicy: "off", chatGptSendSupported: false });
    expect(starts).toBe(0);
    await expect(runtime.enable("not-an-extension")).rejects.toThrow("extension ID");
    expect((await runtime.enable(extensionId)).enabled).toBe(true);
    expect((await runtime.enable(extensionId)).enabled).toBe(true); expect(starts).toBe(1);
    await expect(runtime.enable("d".repeat(32))).rejects.toThrow("Disable");
    const offered = runtime.createPairing();
    expect(offered.pairing).toMatchObject({ extensionId, origin: COMPANION_ORIGIN, version: 1 });
    expect(JSON.stringify(runtime.status())).not.toContain(offered.pairing.pairingCode);
    expect((await runtime.disable()).enabled).toBe(false); expect(stops).toBe(1);
    expect(runtime.browserProvider()).toBeUndefined();
    await runtime.close(); expect(runtime.status().state).toBe("closed");
    await expect(runtime.enable(extensionId)).rejects.toThrow("closed");
  } finally { await runtime.close(); }
  const conflict = createBrowserCompanionRuntime({ startListener: () => { throw Object.assign(new Error("fixture port owner"), { code: "EADDRINUSE" }); } });
  try {
    expect(await conflict.enable(extensionId)).toMatchObject({ enabled: false, state: "unavailable" });
    expect(conflict.status().reason).toContain("will not stop another process");
    expect(() => conflict.createPairing()).toThrow("Enable");
  } finally { await conflict.close(); }
});

test("owned listener shutdown settles dispatched input as unknown and retains the cancellation receipt", async () => {
  let host!: BrowserCompanionHost;
  let stopped = false;
  const runtime = createBrowserCompanionRuntime({ startListener: candidate => { host = candidate; return { stop: async () => { stopped = true; } }; } });
  try {
    await runtime.enable(extensionId);
    const offer = runtime.createPairing().pairing;
    let token: string | undefined, sessionId: string | undefined;
    const post = async (route: string, payload: Record<string, unknown> = {}) => {
      const response = await host.fetch(new Request(`${COMPANION_ORIGIN}/v1/companion/${route}`, { method: "POST",
        headers: { "content-type": "application/json", origin: `chrome-extension://${extensionId}`, ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ version: 1, hostId: offer.hostId, sessionId, ...payload }) }));
      expect(response.ok).toBe(true); return await response.json() as any;
    };
    ({ token, sessionId } = await post("pair", { pairingCode: offer.pairingCode }));
    expect(runtime.createPairing().status.companion?.paired).toBe(false);
    // The deliberate new offer revoked the old session. Pair it once before sending fixture input.
    const offer2 = runtime.createPairing().pairing;
    const paired = await host.fetch(new Request(`${COMPANION_ORIGIN}/v1/companion/pair`, { method: "POST", headers: { "content-type": "application/json", origin: `chrome-extension://${extensionId}` }, body: JSON.stringify({ version: 1, hostId: offer2.hostId, pairingCode: offer2.pairingCode }) }));
    ({ token, sessionId } = await paired.json() as any);
    const observed = { kind: "browser" as const, sessionId: sessionId!, scopeId: "scope", tabId: 1, windowId: 1, frameId: 0 as const,
      documentId: "document", documentEpoch: "epoch", observationId: "observation", url: "https://example.com", title: "Fixture", text: "", refs: [{ ref: "button", role: "button" as const, label: "Save" }] };
    await post("select", { observation: observed });
    const pending = runtime.browserProvider()!.act(browserBindingOf(observed), { kind: "click", ref: "button" });
    const operationId = (await post("poll")).commands[0].operationId;
    const disabled = await runtime.disable();
    expect(await pending).toMatchObject({ operationId, outcome: "unknown", cancelRequested: true });
    expect(disabled.lastReceipt).toMatchObject({ operationId, outcome: "unknown", cancelRequested: true });
    expect(stopped).toBe(true); expect(disabled.enabled).toBe(false);
  } finally { await runtime.close(); }
});

test("admin companion factory configures only reviewed actions and never exposes page execution", async () => {
  let starts = 0;
  const runtime = createBrowserCompanionRuntime({ startListener: () => { starts++; return { stop() {} }; } });
  const request = async (body: unknown) => {
    const response = await browserCompanionRequest(new Request("http://127.0.0.1:17841/admin/browser-companion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), () => runtime);
    return { status: response.status, body: await response.json() as any };
  };
  try {
    expect((await request({ action: "status" })).body.value.enabled).toBe(false); expect(starts).toBe(0);
    expect((await request({ action: "enable", extensionId, origin: "https://evil.test" })).status).toBe(400);
    expect((await request({ action: "act", script: "anything" })).status).toBe(400);
    expect((await request({ action: "enable", extensionId })).body.value.enabled).toBe(true);
    const result = await request({ action: "create-pairing" }); expect(result.body.value.pairing.pairingCode.length).toBe(43);
    expect((await request({ action: "revoke" })).body.value.companion.paired).toBe(false);
    expect((await request({ action: "disable" })).body.value.enabled).toBe(false);
  } finally { await runtime.close(); }
});

test("runtime quit joins an in-flight owned shutdown instead of racing a replacement", async () => {
  let release!: () => void, stops = 0;
  const runtime = createBrowserCompanionRuntime({ startListener: () => ({ stop: async () => { stops++; await new Promise<void>(resolve => { release = resolve; }); } }) });
  await runtime.enable(extensionId);
  const stopping = runtime.disable();
  const closing = runtime.close();
  expect(runtime.status().state).toBe("transitioning");
  await expect(runtime.enable(extensionId)).rejects.toThrow("in progress");
  release(); await Promise.all([stopping, closing]);
  expect(stops).toBe(1); expect(runtime.status().state).toBe("closed");
});

test("browser companion IPC uses current owned runtime and validates pairing clipboard payloads", async () => {
  const require = createRequire(import.meta.url);
  const { registerBrowserCompanion } = require("../launcher/electron/ipc/browser-companion.cjs");
  const handlers = new Map<string, (...args: any[]) => Promise<any>>();
  let ready = false, controls = 0, copied = "";
  registerBrowserCompanion({ handle: (channel: string, fn: (...args: any[]) => Promise<any>) => handlers.set(channel, fn), runtimeHost: { supervisor: {
    readConfig: () => ({ fixture: true }), ownedRuntimeReady: async () => ready,
    control: async (_config: unknown, route: string, body: unknown) => { controls++; expect(route).toBe("browser-companion"); expect(body).toEqual({ body: { action: "status" } }); return { ok: true, value: { enabled: false } }; },
  } }, clipboard: { writeText: (text: string) => { copied = text; } } });
  await expect(handlers.get("launcher:browser-companion")!(null, { action: "status" })).rejects.toThrow("Start"); expect(controls).toBe(0);
  ready = true; expect(await handlers.get("launcher:browser-companion")!(null, { action: "status" })).toEqual({ enabled: false });
  await expect(handlers.get("launcher:browser-companion")!(null, { action: "enable", extensionId: "evil" })).rejects.toThrow("Invalid");
  await expect(handlers.get("launcher:browser-companion-copy")!(null, "private arbitrary text")).rejects.toThrow("Invalid");
  const text = JSON.stringify({ version: 1, origin: COMPANION_ORIGIN, hostId: "fixture", extensionId, pairingCode: "e".repeat(43) });
  expect(await handlers.get("launcher:browser-companion-copy")!(null, text)).toEqual({ copied: true }); expect(copied).toBe(text);
});
