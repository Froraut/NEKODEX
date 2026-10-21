import { expect, test } from "bun:test";
// @ts-ignore Bundled extension sources are intentionally browser-native JavaScript.
import { createCompanionDispatcher } from "../browser-companion/dispatch.js";
// @ts-ignore Bundled extension sources are intentionally browser-native JavaScript.
import { companionPairingState, companionRequest, runCompanionSession } from "../browser-companion/transport.js";

const binding = { sessionId: "session", scopeId: "scope", tabId: 7, windowId: 3, frameId: 0, documentId: "document", documentEpoch: "epoch", observationId: "observation" };
function browserFixture() {
  const calls: any[] = [];
  let activeTab = 7, documentId = "document", fail = false;
  const api = {
    tabs: { query: async () => [{ id: activeTab }], captureVisibleTab: async () => { throw new Error("Unrequested capture"); } },
    scripting: { executeScript: async (request: any) => {
      calls.push(request);
      if (fail) throw new Error("Disconnected after injection began");
      return [{ frameId: 0, documentId, result: request.args[0].kind === "observe"
        ? { outcome: "completed", executed: false, snapshot: { documentEpoch: "epoch", observationId: "fresh", url: "https://chatgpt.com/c/fixture", title: "Fixture", text: "Observed reply", refs: [] } }
        : { outcome: "completed", executed: true } }];
    } },
  };
  return { api, calls, setActive: (id: number) => { activeTab = id; }, setDocument: (id: string) => { documentId = id; }, fail: () => { fail = true; } };
}

test("selected document dispatch never falls back to another active tab or document", async () => {
  const fixture = browserFixture(), dispatcher = createCompanionDispatcher(fixture.api, { capture: true });
  dispatcher.restore(binding);
  fixture.setActive(8);
  const command = { operationId: "act-1", kind: "act", binding, action: { kind: "click", ref: "send" } };
  expect(await dispatcher.execute(command)).toMatchObject({ outcome: "rejected", executed: false });
  expect(fixture.calls).toHaveLength(0);
  fixture.setActive(7);
  fixture.setDocument("foreign-document");
  expect(await dispatcher.execute(command)).toMatchObject({ outcome: "unknown", executed: true });
  expect(fixture.calls[0].target).toEqual({ tabId: 7, documentIds: ["document"] });
  fixture.setDocument("document");
  const observed = await dispatcher.execute({ operationId: "read-1", kind: "observe", binding });
  expect(observed).toMatchObject({ outcome: "completed", executed: false, observation: { ...binding, observationId: "fresh", text: "Observed reply" } });
  expect(dispatcher.binding().observationId).toBe("fresh");
  // Existing action is stale after that fresh observation, even with the same element reference.
  expect(await dispatcher.execute(command)).toMatchObject({ outcome: "rejected", executed: false });
});

test("session sends one receipt for consumed input and never executes a duplicate command", async () => {
  const fixture = browserFixture(), dispatcher = createCompanionDispatcher(fixture.api);
  dispatcher.restore(binding);
  const controller = new AbortController(), delivered: any[] = [];
  const command = { operationId: "act-1", kind: "act", binding, action: { kind: "click", ref: "send" } };
  let polls = 0;
  const request = async (_credentials: unknown, route: string, payload: any, signal: AbortSignal) => {
    if (route === "poll") { if (++polls > 2) throw new Error("Unexpected replay"); return { commands: [command] }; }
    delivered.push({ payload, signal }); return { accepted: true };
  };
  await expect(runCompanionSession({ credentials: {}, dispatcher, signal: controller.signal, say() {}, request })).rejects.toThrow("already consumed");
  expect(fixture.calls).toHaveLength(1);
  expect(delivered).toEqual([{ payload: { result: { operationId: "act-1", outcome: "completed", executed: true } }, signal: undefined }]);
});

test("unknown injection gets a terminal uncertain receipt and stops without retry", async () => {
  const fixture = browserFixture(), dispatcher = createCompanionDispatcher(fixture.api);
  dispatcher.restore(binding); fixture.fail();
  const delivered: any[] = [], controller = new AbortController(); let polls = 0;
  const request = async (_credentials: unknown, route: string, payload: any) => {
    if (route === "poll") { polls++; return { commands: [{ operationId: "uncertain-1", kind: "act", binding, action: { kind: "click", ref: "send" } }] }; }
    delivered.push(payload); return { accepted: true };
  };
  await runCompanionSession({ credentials: {}, dispatcher, signal: controller.signal, say() {}, request });
  expect(polls).toBe(1); expect(fixture.calls).toHaveLength(1);
  expect(delivered[0].result).toMatchObject({ operationId: "uncertain-1", outcome: "unknown", executed: true });
});

test("ChatGPT send needs the selected active document; reads do not, and uncertain sends are unknown", async () => {
  const calls: any[] = [];
  let activeTab = 7, mode: "ok" | "throw" = "ok";
  const api = {
    tabs: { query: async () => [{ id: activeTab }] },
    scripting: { executeScript: async (request: any) => {
      calls.push(request);
      if (mode === "throw") throw new Error("Tab closed while the send was in flight");
      const op = request.args[0].op;
      return [{ frameId: 0, documentId: "document", result: op === "send"
        ? { outcome: "completed", executed: true, chatgpt: { op: "send", userMessageId: "message:u", path: "/c/1" } }
        : { outcome: "completed", executed: false, chatgpt: { op: "read", path: "/c/1", userTurnFound: true, generating: true } } }];
    } },
  };
  const dispatcher = createCompanionDispatcher(api);
  dispatcher.restore(binding);
  const send = { operationId: "send-1", kind: "chatgpt", binding, chatgpt: { op: "send", text: "Hi", expectedAccount: "a".repeat(64), expectedModelLabel: "Pro" } };
  const read = { operationId: "read-1", kind: "chatgpt", binding, chatgpt: { op: "read", userMessageId: "message:u" } };
  activeTab = 8;
  expect(await dispatcher.execute(send)).toMatchObject({ outcome: "rejected", executed: false });
  expect(calls).toHaveLength(0);
  expect(await dispatcher.execute(read)).toMatchObject({ outcome: "completed", executed: false, chatgpt: { op: "read" } });
  // The bundled function receives only data plus the selected scope/epoch, on the exact document.
  expect(calls[0].target).toEqual({ tabId: 7, documentIds: ["document"] });
  expect(calls[0].args[0]).toEqual({ op: "read", userMessageId: "message:u", scopeId: "scope", documentEpoch: "epoch" });
  expect(calls[0].func.name).toBe("chatGptOperation");
  activeTab = 7;
  expect(await dispatcher.execute(send)).toMatchObject({ outcome: "completed", executed: true, chatgpt: { op: "send", userMessageId: "message:u" } });
  mode = "throw";
  expect(await dispatcher.execute({ ...send, operationId: "send-2" })).toMatchObject({ outcome: "unknown", executed: true });
  expect(await dispatcher.execute({ ...read, operationId: "read-2" })).toMatchObject({ outcome: "rejected", executed: false });
  expect(await dispatcher.execute({ ...read, chatgpt: { op: "evaluate" } })).toMatchObject({ outcome: "rejected", executed: false });
});

test("session survives a refused ChatGPT operation but stops after an unknown send", async () => {
  const replies = [{ outcome: "rejected", executed: false, reason: "Open a new chat in the selected ChatGPT tab before sending" },
    { outcome: "unknown", executed: true, reason: "ChatGPT did not show the sent message" }];
  const dispatcher = { execute: async () => replies.shift() };
  const delivered: any[] = []; let polls = 0;
  const request = async (_credentials: unknown, route: string, payload: any) => {
    if (route === "poll") { polls++; return { commands: [{ operationId: `send-${polls}`, kind: "chatgpt", binding, chatgpt: { op: "send" } }] }; }
    delivered.push(payload.result); return { accepted: true };
  };
  await runCompanionSession({ credentials: {}, dispatcher, signal: new AbortController().signal, say() {}, request });
  expect(polls).toBe(2);
  expect(delivered.map(row => row.outcome)).toEqual(["rejected", "unknown"]);
});

test("popup pairing state comes from the host: revoked, replaced or restarted pairings are never shown as retained", async () => {
  const credentials = { hostId: "host", sessionId: "session", token: "t".repeat(43) };
  const routes: string[] = [];
  const answer = (reply: () => unknown) => async (_credentials: unknown, route: string) => { routes.push(route); return reply(); };
  const refused = (status: number) => answer(() => { throw Object.assign(new Error("Companion session is not paired"), { status }); });
  expect(await companionPairingState(credentials, answer(() => ({ paired: true, selected: false })))).toEqual({ state: "paired", selected: false });
  // 403 revoked/foreign origin, 409 another host ID after a restart, 410 closed host: the pairing is dead.
  for (const status of [403, 409, 410]) expect(await companionPairingState(credentials, refused(status))).toEqual({ state: "retired" });
  // No HTTP answer proves nothing about the pairing.
  expect(await companionPairingState(credentials, answer(() => { throw new TypeError("Failed to fetch"); }))).toEqual({ state: "unreachable" });
  expect(await companionPairingState(credentials, refused(500))).toEqual({ state: "unreachable" });
  // The probe only ever uses the read-only state route: it cannot poll, select or execute.
  expect(new Set(routes)).toEqual(new Set(["state"]));
  const previous = globalThis.fetch;
  const sent: { url: string; body: any }[] = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json({ error: "Companion session is not paired" }, { status: 403 });
  }) as typeof fetch;
  try {
    await expect(companionRequest(credentials, "state")).rejects.toMatchObject({ status: 403, message: "Companion session is not paired" });
    expect(await companionPairingState(credentials)).toEqual({ state: "retired" });
    expect(sent.map(row => row.url)).toEqual(["http://127.0.0.1:17843/v1/companion/state", "http://127.0.0.1:17843/v1/companion/state"]);
    expect(sent[0]!.body).toEqual({ version: 1, hostId: "host", sessionId: "session" });
  } finally { globalThis.fetch = previous; }
});

test("observe/input pass occlusion proof only for the active tab of a non-minimized window, and never capture occluded pixels", async () => {
  const calls: any[] = [];
  let activeTab = 7, windowState: string | undefined = "normal", occluded = true, captures = 0;
  const api = {
    tabs: { query: async () => [{ id: activeTab }], captureVisibleTab: async () => { captures++; throw new Error("Occluded pixels must not be captured"); } },
    windows: { get: async (id: number) => { if (!windowState) throw new Error("No window"); return { id, state: windowState }; } },
    scripting: { executeScript: async (request: any) => {
      calls.push(request.args[0]);
      return [{ frameId: 0, documentId: "document", result: request.args[0].kind === "observe"
        ? { outcome: "completed", executed: false, ...(occluded ? { occluded: true } : {}), snapshot: { documentEpoch: "epoch", observationId: `fresh-${calls.length}`, url: "http://127.0.0.1:18731/", title: "P12", text: "Message", refs: [] } }
        : { outcome: "completed", executed: true } }];
    } },
  };
  const dispatcher = createCompanionDispatcher(api, { capture: true });
  dispatcher.restore(binding);
  const before = Date.now();
  const observed = await dispatcher.execute({ operationId: "observe-1", kind: "observe", binding, includeImage: true });
  expect(observed).toMatchObject({ outcome: "completed", observation: { observationId: "fresh-1", text: "Message" } });
  expect(observed.occluded).toBeUndefined(); expect(observed.observation.screenshot).toBeUndefined(); expect(captures).toBe(0);
  expect(calls[0].shownAt).toBeGreaterThanOrEqual(before); expect(calls[0].shownAt).toBeLessThanOrEqual(Date.now());
  const current = dispatcher.binding();
  expect(await dispatcher.execute({ operationId: "type-1", kind: "act", binding: current, action: { kind: "type", ref: "r", text: "x" } })).toMatchObject({ outcome: "completed", executed: true });
  expect(typeof calls[1].shownAt).toBe("number");
  // Minimized or unknown windows get no occlusion allowance: the page then requires real visibility.
  for (const state of ["minimized", undefined]) {
    windowState = state;
    await dispatcher.execute({ operationId: `type-${state}`, kind: "act", binding: current, action: { kind: "type", ref: "r", text: "x" } });
    expect(calls.at(-1).shownAt).toBeUndefined();
  }
  // Another active tab in the window is a switch away, never occlusion: nothing is injected.
  windowState = "normal"; activeTab = 8;
  const injected = calls.length;
  expect(await dispatcher.execute({ operationId: "type-2", kind: "act", binding: current, action: { kind: "type", ref: "r", text: "x" } })).toMatchObject({ outcome: "rejected", executed: false, reason: "Selected tab is no longer active in its window" });
  expect(calls).toHaveLength(injected);
});
