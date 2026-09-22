import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import {
  ChatGptCompletionTracker, ChatGptTurnDomHealthTracker,
} from "../src/adapters/chatgpt-web/browser-response-policy";

// Execute the shipped early-continue branch from each loop. This bounded fixture deliberately
// excludes acquisition/streaming orchestration; it proves the wiring, not just a tracker reset.
const source = ts.createSourceFile("worker.ts", readFileSync("src/adapters/chatgpt-web/browser-worker.ts", "utf8"),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
function suspensionBranch(methodName: string): string {
  let method: ts.MethodDeclaration | undefined;
  function findMethod(node: ts.Node): void {
    if (ts.isMethodDeclaration(node) && node.name.getText(source) === methodName) method = node;
    else ts.forEachChild(node, findMethod);
  }
  findMethod(source);
  if (!method) throw new Error(`Missing worker boundary ${methodName}`);
  let branch: ts.IfStatement | undefined;
  function findBranch(node: ts.Node): void {
    if (ts.isIfStatement(node) && node.expression.getText(source) === "!snapshot.responsePresent && externalProgressLive") branch = node;
    else ts.forEachChild(node, findBranch);
  }
  findBranch(method);
  if (!branch) throw new Error(`Missing suspension branch in ${methodName}`);
  return branch.getText(source);
}

for (const method of ["waitForMultipartAcknowledgement", "runBrowserTurn"]) {
  for (const terminal of ["empty", "missing-action"]) {
    test(`${method} live-progress branch restarts ${terminal} grace`, async () => {
      class ObservedHealth extends ChatGptTurnDomHealthTracker {
        suspensions = 0;
        override suspendForLiveProgress(): void { this.suspensions++; super.suspendForLiveProgress(); }
      }
      const health = new ObservedHealth(100, 10, 60);
      const state = { responsePresent: true, running: false,
        currentText: terminal === "empty" ? "" : "answer", completionActionVisible: terminal === "empty" };
      expect(health.update(state, 0)).toBeUndefined();
      const run = new Function("snapshot", "externalProgressLive", "domHealthTracker", "setTimeout",
        `return (async () => { for (let i = 0; i < 1; i++) { ${suspensionBranch(method)} } })();`);
      await run({ responsePresent: false }, true, health, (resolve: () => void) => resolve());
      expect(health.suspensions).toBe(1); // The intended worker branch was reached.
      const grace = terminal === "empty" ? 10 : 60;
      expect(health.update(state, 1000)).toBeUndefined();
      expect(health.update(state, 1000 + grace - 1)).toBeUndefined();
      expect(health.update(state, 1000 + grace)).toContain(terminal === "empty" ? "without a final answer" : "completed-turn action");
    });
  }
}

test("live suspension retains response history and absence still expires", () => {
  const health = new ChatGptTurnDomHealthTracker(100);
  const state = { responsePresent: true, running: true, currentText: "partial", completionActionVisible: false };
  health.update(state, 0);
  health.update({ ...state, responsePresent: false, externalProgressLive: true }, 1000);
  expect(health.update({ ...state, responsePresent: false }, 2000)).toBeUndefined();
  expect(health.update({ ...state, responsePresent: false }, 2100)).toContain("DOM disappeared");
});

test("completion still requires a changed settled answer after an observed tool batch", () => {
  const tracker = new ChatGptCompletionTracker(2, 60);
  const state = { responsePresent: true, running: false, currentText: "pre-tool", completionActionVisible: true };
  expect(tracker.observeToolBatch(1, state.currentText)).toBeTrue();
  expect(tracker.update(state, 0)).toBeFalse();
  expect(tracker.update({ ...state, externalToolCallsInFlight: true }, 100)).toBeFalse();
  expect(tracker.update(state, 101)).toBeFalse();
  expect(tracker.update({ ...state, currentText: "post-tool" }, 102)).toBeFalse();
  expect(tracker.update({ ...state, currentText: "post-tool" }, 104)).toBeTrue();
});

// The accepted-turn observer retains a direct liveness consumer outside response policy.
// Reach its ordinary observation-fault catch (not the timeout/rebind shortcut).
test.each([true, false])("accepted-turn observation fault respects direct MCP liveness: %s", async live => {
  const { ChatGptBrowserWorker } = await import("../src/adapters/chatgpt-web/browser-worker");
  const worker: {
    submissionDomState(): Promise<unknown>;
    waitForTurnDomOrExternalProgress(): Promise<void>;
    waitForNewAssistantTurn(...args: unknown[]): Promise<{ identity: string }>;
  } = Object.create(ChatGptBrowserWorker.prototype);
  const fault = new Error("injected ordinary DOM observation fault");
  let observations = 0;
  let waits = 0;
  worker.submissionDomState = async () => {
    observations++;
    if (observations === 1) throw fault;
    return { responseIdentities: ["answer"], turnIdentities: ["answer"], acknowledgementTurns: [] };
  };
  worker.waitForTurnDomOrExternalProgress = async () => { waits++; };
  const hidden = {
    filter() { return this; }, last() { return this; }, getByText() { return this; },
    isVisible: async () => false,
  };
  const page = { isClosed: () => false, locator: () => hidden };
  const progress = { snapshot: () => ({ revision: 1, lastToolBatchRevision: 0, activeToolCalls: live ? 1 : 0 }) };
  const result = worker.waitForNewAssistantTurn(page, { initialTurnIdentities: [], domCache: {} },
    undefined, undefined, progress);
  if (live) {
    expect((await result).identity).toBe("answer");
    expect(observations).toBe(2);
    expect(waits).toBe(1);
  } else {
    await expect(result).rejects.toBe(fault);
    expect(observations).toBe(1);
    expect(waits).toBe(0);
  }
});
