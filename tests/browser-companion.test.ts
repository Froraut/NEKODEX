import { expect, test } from "bun:test";
import { createBrowserCompanionHost } from "../src/browser-companion/host";
import { browserBindingOf, COMPANION_ORIGIN, type BrowserObservation } from "../src/browser-companion/protocol";
import { companionChatGptCapability, createMcpDesktopProvider, desktopBindingOf, toolSchemaDigest, type DesktopObservation } from "../src/browser-companion/providers";
import type { StandaloneToolsPort, ToolInvocation, ToolScope } from "../src/agent-tools/types";

const extensionId = "a".repeat(32);
async function fixture() {
  const host = createBrowserCompanionHost({ extensionId, hostId: "fixture-host" });
  const offer = host.createPairing();
  let credentials: { hostId: string; sessionId?: string; token?: string } = offer;
  async function post(route: string, payload: unknown = {}, extra: { origin?: string; host?: string; token?: string; signal?: AbortSignal } = {}) {
    const result = await host.fetch(new Request(`${COMPANION_ORIGIN}/v1/companion/${route}`, {
      method: "POST", headers: { origin: extra.origin ?? `chrome-extension://${extensionId}`, "content-type": "application/json",
        ...(extra.host ? { host: extra.host } : {}), ...(credentials.token ? { authorization: `Bearer ${extra.token ?? credentials.token}` } : {}) },
      body: JSON.stringify({ version: 1, hostId: credentials.hostId, sessionId: credentials.sessionId, ...(payload as object) }), signal: extra.signal,
    }));
    return { status: result.status, body: await result.json() as any };
  }
  const paired = await post("pair", { pairingCode: offer.pairingCode });
  expect(paired.status).toBe(200); credentials = paired.body;
  const observed: BrowserObservation = { kind: "browser", sessionId: credentials.sessionId!, scopeId: "scope-1", tabId: 12, windowId: 3,
    frameId: 0, documentId: "document-1", documentEpoch: "epoch-1", observationId: "observation-1", url: "https://example.com/fixture", title: "Fixture", text: "Fixture controls",
    refs: [{ ref: "input", role: "textbox", label: "Name" }, { ref: "submit", role: "button", label: "Submit" }] };
  expect((await post("select", { observation: observed })).status).toBe(200);
  return { host, post, offer, observed, binding: browserBindingOf(observed) };
}

test("private companion pairing pins extension, host, version and consumes its bootstrap", async () => {
  const f = await fixture();
  try {
    expect((await f.post("pair", { pairingCode: f.offer.pairingCode })).status).toBe(403);
    expect((await f.post("select", { observation: f.observed }, { origin: "https://example.com" })).status).toBe(403);
    expect((await f.post("select", { observation: f.observed }, { origin: `chrome-extension://${"b".repeat(32)}` })).status).toBe(403);
    expect((await f.post("select", { observation: f.observed }, { host: "evil.test:17843" })).status).toBe(403);
    expect((await f.post("select", { observation: f.observed }, { token: "wrong" })).status).toBe(403);
    expect((await f.post("select", { version: 2, observation: f.observed })).status).toBe(409);
    expect(JSON.stringify(f.host.status())).not.toContain(f.offer.pairingCode);
    expect((await f.post("execute-url", { url: "https://example.com", script: "anything" })).status).toBe(404);
    f.host.revoke(); expect(f.host.status().paired).toBe(false);
    expect((await f.post("select", { observation: f.observed })).status).toBe(403);
  } finally { f.host.close(); }
});

test("input binds exact observation, consumes it, and requires a fresh read before another input", async () => {
  const f = await fixture();
  try {
    expect(() => f.host.act({ ...f.binding, documentId: "foreign" }, { kind: "click", ref: "submit" })).toThrow("Stale");
    expect(() => f.host.act(f.binding, { kind: "click", ref: "unknown" })).toThrow("Unknown");
    expect(() => f.host.act(f.binding, { kind: "evaluate", script: "anything" })).toThrow();
    const waiting = f.host.act(f.binding, { kind: "type", ref: "input", text: "A" });
    const command = (await f.post("poll")).body.commands[0];
    expect(command.binding).toEqual(f.binding);
    expect((await f.post("result", { result: { operationId: command.operationId, outcome: "completed", executed: false } })).status).toBe(400);
    expect((await f.post("result", { result: { operationId: command.operationId, outcome: "completed", executed: true } })).status).toBe(200);
    expect((await waiting).outcome).toBe("completed");
    expect(() => f.host.act(f.binding, { kind: "click", ref: "submit" })).toThrow("Stale");
    const reading = f.host.observe(f.binding);
    const read = (await f.post("poll")).body.commands[0];
    const fresh = { ...f.observed, observationId: "observation-2" };
    expect((await f.post("result", { result: { operationId: read.operationId, outcome: "completed", executed: false, observation: fresh } })).status).toBe(200);
    expect((await reading).observation?.observationId).toBe("observation-2");
    expect(() => f.host.act(f.binding, { kind: "click", ref: "submit" })).toThrow("Stale");
    expect(f.host.observation()?.observationId).toBe("observation-2");
  } finally { f.host.close(); }
});

test("queued cancellation is not sent; dispatched cancellation stays unknown until its exact late receipt", async () => {
  const f = await fixture();
  try {
    const queued = new AbortController();
    const first = f.host.act(f.binding, { kind: "click", ref: "submit" }, queued.signal);
    queued.abort(); expect((await first).outcome).toBe("not_sent");
    expect((await f.post("select", { observation: { ...f.observed, scopeId: "scope-2" } })).status).toBe(200);
    const binding = browserBindingOf(f.host.observation()!);
    const delivered = new AbortController();
    const second = f.host.act(binding, { kind: "click", ref: "submit" }, delivered.signal);
    const command = (await f.post("poll")).body.commands[0];
    delivered.abort();
    expect(await second).toMatchObject({ outcome: "unknown", cancelRequested: true });
    expect(() => f.host.observe(binding)).toThrow("uncertain");
    expect((await f.post("result", { result: { operationId: "foreign", outcome: "completed", executed: true } })).status).toBe(400);
    expect((await f.post("result", { result: { operationId: command.operationId, outcome: "completed", executed: true } })).status).toBe(200);
    expect(f.host.receipt(command.operationId)).toMatchObject({ outcome: "completed", cancelRequested: true });
    expect(f.host.observation()).toBeUndefined();
    expect(f.host.status().operation).toBeNull();
    // Completed late receipt never restores the consumed observation or sends another click.
    expect(() => f.host.act(binding, { kind: "click", ref: "submit" })).toThrow("Stale");
  } finally { f.host.close(); }
});

test("navigation and fresh selection cannot silently rebind an in-flight observation", async () => {
  const f = await fixture();
  try {
    const abort = new AbortController(); const waiting = f.host.observe(f.binding, abort.signal);
    const command = (await f.post("poll")).body.commands[0];
    expect((await f.post("result", { result: { operationId: command.operationId, outcome: "completed", executed: false,
      observation: { ...f.observed, documentId: "new-navigation", observationId: "new-id" } } })).status).toBe(400);
    abort.abort(); expect((await waiting).outcome).toBe("unknown");
    expect((await f.post("select", { observation: { ...f.observed, scopeId: "scope-3" } })).status).toBe(400);
    expect(f.host.status().operation?.phase).toBe("unknown");
    expect(companionChatGptCapability(f.host, undefined).sendSupported).toBe(false);
  } finally { f.host.close(); }
});

test("pairing and selection do not claim a live popup after its polling owner disconnects", async () => {
  const f = await fixture(); const abort = new AbortController();
  try {
    expect(f.host.status().connected).toBe(false);
    const waiting = f.post("poll", {}, { signal: abort.signal });
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(f.host.status().connected).toBe(true);
    abort.abort(); expect((await waiting).body.commands).toEqual([]);
    expect(f.host.status().connected).toBe(false);
    expect(f.host.status().paired).toBe(true);
  } finally { f.host.close(); }
});

const scope: ToolScope = { taskId: "task", generation: 1, toolCallId: "call" };
function desktopFixture() {
  const schema = { type: "object", properties: { contract: { type: "string" } } };
  const observation: DesktopObservation = { kind: "desktop", providerId: "fixture-provider", scopeId: "task\0" + "1", observationId: "obs-1", platform: "darwin",
    windowId: "window-1", processId: "pid:start", windowEpoch: "window-epoch", frameId: "frame-1", frameEpoch: "frame-epoch", screenshotId: "image-1", coordinateSpace: "screenshot-pixels", width: 100, height: 80, screenshotResource: "provider-resource:fixture-image" };
  const calls: ToolInvocation[] = [];
  let mode: "complete" | "unknown" = "complete";
  let schemasMatch = true;
  const port: StandaloneToolsPort = {
    discover: async () => ["observe", "input"].map(name => ({ id: `fixture/${name}`, serverId: "fixture", name, inputSchema: schemasMatch ? schema : { type: "object" }, supported: true })),
    invoke: async request => {
      calls.push(request);
      return { idempotencyKey: request.idempotencyKey, scope: request.scope, tool: request.tool,
        state: request.tool.endsWith("input") && mode === "unknown" ? "outcome_unknown" : "completed",
        result: { structuredContent: request.tool.endsWith("observe") ? observation : { operationId: request.idempotencyKey, outcome: "completed", executed: true } } };
    },
  };
  const provider = createMcpDesktopProvider({ port, providerId: "fixture-provider", platform: "darwin", contract: "nekodex.observation-input.v1",
    observeTool: { id: "fixture/observe", schemaDigest: toolSchemaDigest(schema) }, inputTool: { id: "fixture/input", schemaDigest: toolSchemaDigest(schema) }, grant: () => "explicit-fixture-grant" });
  return { provider, calls, setUnknown: () => { mode = "unknown"; }, setMismatch: () => { schemasMatch = false; } };
}

test("MCP desktop adapter validates exact window/frame/screenshot and bounds before calling the provider", async () => {
  const f = desktopFixture();
  const observed = await f.provider.observe(scope);
  const binding = desktopBindingOf(observed);
  await expect(f.provider.act(scope, { ...binding, windowEpoch: "foreign" }, { kind: "click", x: 1, y: 1 })).rejects.toThrow("Stale");
  await expect(f.provider.act(scope, binding, { kind: "click", x: 100, y: 1 })).rejects.toThrow("outside");
  expect(f.calls.length).toBe(1);
  expect(await f.provider.act(scope, binding, { kind: "click", x: 30, y: 40 })).toMatchObject({ outcome: "completed", executed: true });
  expect(f.calls[1]!.arguments).toMatchObject({ binding, action: { kind: "click", x: 30, y: 40 } });
  await expect(f.provider.act(scope, binding, { kind: "type", text: "second" })).rejects.toThrow("Stale");
  f.setMismatch(); expect((await f.provider.capabilities(scope)).available).toBe(false);
});

test("MCP desktop unknown delivery blocks another input and fresh capture rather than replaying", async () => {
  const f = desktopFixture(); const observed = await f.provider.observe(scope);
  f.setUnknown();
  expect((await f.provider.act(scope, desktopBindingOf(observed), { kind: "type", text: "fixture text" })).outcome).toBe("unknown");
  f.provider.invalidate();
  await expect(f.provider.observe(scope)).rejects.toThrow("uncertain");
  await expect(f.provider.act(scope, desktopBindingOf(observed), { kind: "type", text: "fixture text" })).rejects.toThrow("uncertain");
  expect(f.calls.length).toBe(2);
});
