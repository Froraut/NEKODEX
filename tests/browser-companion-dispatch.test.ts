import { expect, test } from "bun:test";
// @ts-ignore Bundled extension sources are intentionally browser-native JavaScript.
import { createCompanionDispatcher } from "../browser-companion/dispatch.js";
// @ts-ignore Bundled extension sources are intentionally browser-native JavaScript.
import { runCompanionSession } from "../browser-companion/transport.js";

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
