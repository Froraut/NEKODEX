import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { createBrowserCompanionHost } from "../src/browser-companion/host";
import { createCompanionBrowserProvider } from "../src/browser-companion/providers";
import { browserBindingOf, COMPANION_ORIGIN, type BrowserObservation } from "../src/browser-companion/protocol";

/** Inert protocol bytes only. No image viewer, browser, screenshot capture or network listener is launched. */
test("companion host forwards exact image consent and accepts the bounded full observation envelope", async () => {
  const extensionId = "g".repeat(32), host = createBrowserCompanionHost({ extensionId });
  const offer = host.createPairing();
  let token: string | undefined, sessionId: string | undefined;
  const body = (payload: Record<string, unknown>) => JSON.stringify({ version: 1, hostId: offer.hostId, sessionId, ...payload });
  async function post(route: string, payload: Record<string, unknown> = {}) {
    return host.fetch(new Request(`${COMPANION_ORIGIN}/v1/companion/${route}`, { method: "POST",
      headers: { "content-type": "application/json", origin: `chrome-extension://${extensionId}`, ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: body(payload) }));
  }
  try {
    const paired = await post("pair", { pairingCode: offer.pairingCode });
    ({ token, sessionId } = await paired.json() as { token: string; sessionId: string });
    const selected: BrowserObservation = { kind: "browser", sessionId: sessionId!, scopeId: "selected-page", tabId: 7, windowId: 3, frameId: 0,
      documentId: "document", documentEpoch: "epoch", observationId: "selected", url: "https://example.com/inert", title: "Inert", text: "Ready", refs: [] };
    expect((await post("select", { observation: selected })).status).toBe(200);
    const provider = createCompanionBrowserProvider(host), binding = browserBindingOf(selected);
    const pending = provider.observe(binding, AbortSignal.timeout(1000), "image-call", { includeImage: true });
    const command = (await (await post("poll")).json() as any).commands[0];
    expect(command).toMatchObject({ operationId: "image-call", kind: "observe", includeImage: true, binding });
    // Inert SOF framing at the exact decoded limit exercises transport/schema,
    // not the visual validity of an externally captured screenshot.
    const bytes = Buffer.alloc(160 * 1024, 65);
    Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 1, 0, 1, 0]).copy(bytes);
    bytes[bytes.length - 2] = 0xff; bytes[bytes.length - 1] = 0xd9;
    const screenshot = { mimeType: "image/jpeg" as const, data: bytes.toString("base64"), width: 1, height: 1,
      sha256: createHash("sha256").update(bytes).digest("hex") };
    const observed: BrowserObservation = { ...selected, observationId: "fresh-image", text: "\u0001".repeat(16_000),
      refs: Array.from({ length: 100 }, (_, index) => ({ ref: `ref-${index}`, role: "button" as const, label: "\u0001".repeat(120) })), screenshot };
    const result = { operationId: "image-call", outcome: "completed", executed: false, observation: observed };
    expect(Buffer.byteLength(body({ result }))).toBeGreaterThan(256 * 1024);
    expect(Buffer.byteLength(body({ result }))).toBeLessThan(512 * 1024);
    expect((await post("result", { result: { ...result, observation: { ...observed, documentId: "foreign" } } })).status).toBe(400);
    expect((await post("result", { result: { ...result, observation: { ...observed, screenshot: { ...screenshot, sha256: "0".repeat(64) } } } })).status).toBe(400);
    expect(host.status().operation?.operationId).toBe("image-call");
    expect((await post("result", { result })).status).toBe(200);
    expect(await pending).toMatchObject({ operationId: "image-call", outcome: "completed", executed: false, binding, observation: observed });
    expect(host.observation()?.screenshot?.data).toBe(screenshot.data);
    const current = host.status().selected!;
    const textPending = provider.observe(current, AbortSignal.timeout(1000), "text-call");
    const textCommand = (await (await post("poll")).json() as any).commands[0];
    expect(textCommand.includeImage).toBeUndefined();
    const unapproved = { ...result, operationId: "text-call", observation: { ...observed, observationId: "unapproved-pixels" } };
    expect((await post("result", { result: unapproved })).status).toBe(400);
    expect(host.status().operation?.operationId).toBe("text-call");
    expect((await post("result", { result: { operationId: "text-call", outcome: "completed", executed: false,
      observation: { ...selected, observationId: "fresh-text" } } })).status).toBe(200);
    expect((await textPending).observation?.screenshot).toBeUndefined();
    expect(host.status().operation).toBeNull();
  } finally { host.close(); }
}, 3000);
