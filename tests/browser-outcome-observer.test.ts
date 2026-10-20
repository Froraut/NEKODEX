import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { projectNativeToolImages } from "../src/agent-mode/native-images";
import { createAgentBrowserToolsProvider } from "../src/browser-companion/agent-tools";
import { browserBindingOf, type BrowserObservation, type CompanionReceipt } from "../src/browser-companion/protocol";
import type { BrowserProviderPort } from "../src/browser-companion/providers";
import type { ToolOutcome } from "../src/agent-tools/types";
import { browserTextTransitionReference, browserTextTransitionRequirement, resolveBrowserTextTransitionEvidence } from "../src/browser-companion/outcome-observer";

async function flow(priorText = "Ready", nextText = "Saved record 42", image: { requested: boolean; returned: boolean } = { requested: false, returned: false }) {
  let current: BrowserObservation | undefined = { kind: "browser", sessionId: "session", scopeId: "selected", tabId: 12, windowId: 4,
    frameId: 0, documentId: "doc", documentEpoch: "epoch", observationId: "selected", url: "https://example.com/records", title: "Records", text: priorText,
    refs: [{ ref: "save", role: "button", label: "Save" }] };
  const anchor = current;
  const data = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==";
  const screenshot = { mimeType: "image/png" as const, data, width: 1, height: 1, sha256: createHash("sha256").update(Buffer.from(data, "base64")).digest("hex") };
  let selected = browserBindingOf(current), count = 0, inputCount = 0;
  const receipts = new Map<string, CompanionReceipt>();
  const provider: BrowserProviderPort = {
    capabilities: () => ({ providerId: "inert-selected-provider", available: true, actions: ["observe", "click", "type"] }),
    current: () => current, selected: () => selected, receipt: id => receipts.get(id),
    async observe(binding, _signal, operationId) {
      current = { ...anchor, ...selected, observationId: `fresh-${++count}`, text: inputCount ? nextText : priorText, ...(image.returned ? { screenshot } : {}) };
      selected = browserBindingOf(current);
      const receipt: CompanionReceipt = { operationId: operationId!, binding, outcome: "completed", executed: false, cancelRequested: false, observation: current };
      receipts.set(operationId!, receipt); return receipt;
    },
    async act(binding, _action, _signal, operationId) {
      inputCount++; current = undefined;
      const receipt: CompanionReceipt = { operationId: operationId!, binding, outcome: "completed", executed: true, cancelRequested: false };
      receipts.set(operationId!, receipt); return receipt;
    },
  };
  const task = { id: "task", generation: 1, revision: 1, requirements: [{ id: "saved", text: browserTextTransitionRequirement(anchor.url, "Saved record 42") }] };
  const adapter = createAgentBrowserToolsProvider({ provider: () => provider, isScopeActive: scope => scope.taskId === task.id && scope.generation === 1 });
  const scope = { taskId: task.id, generation: 1, toolCallId: "attachment" };
  adapter.bind(scope, selected);
  const outcomes = new Map<string, ToolOutcome>();
  for (const [id, tool] of [["before", "observe"], ["action", "click"], ["after", "observe"]] as const) {
    const outcome = await adapter.execute({ scope: { ...scope, toolCallId: id }, idempotencyKey: id, tool: `browser/${tool}`,
      arguments: { binding: selected, ...(tool === "click" ? { ref: "save" } : image.requested ? { includeImage: true } : {}) } });
    expect(outcome.state).toBe("completed"); outcomes.set(id, outcome);
  }
  return { task, outcomes, inputCount, selection: { beforeReceipt: "before", actionReceipt: "action", afterReceipt: "after", expectedUrl: anchor.url, appearedText: "Saved record 42" }, lookup: (id: string) => outcomes.get(id) };
}

test("browser outcome requires independently recorded post-input site state and exact explicit requirement", async () => {
  const f = await flow();
  const reference = browserTextTransitionReference(f.task, "saved", f.selection, f.lookup);
  expect(resolveBrowserTextTransitionEvidence(f.task, reference, f.lookup)).toMatchObject({ outcome: "passed", observer: "selected-browser-text-transition-v1", taskRevision: 1 });
  expect(f.inputCount).toBe(1);
  expect(() => browserTextTransitionReference({ ...f.task, requirements: [{ id: "saved", text: "The purchase succeeded" }] }, "saved", f.selection, f.lookup)).toThrow("explicitly");
  expect(() => resolveBrowserTextTransitionEvidence({ ...f.task, generation: 2 }, reference, f.lookup)).toThrow("scope");
  const forged = structuredClone(f.outcomes.get("after")!);
  (forged.result as any).structuredContent.observation.windowId = 99;
  expect(() => resolveBrowserTextTransitionEvidence(f.task, reference, id => id === "after" ? forged : f.lookup(id))).toThrow("document");
  expect(() => browserTextTransitionReference(f.task, "saved", { ...f.selection, afterReceipt: "action" }, f.lookup)).toThrow("distinct");
});

test("completed input cannot make unchanged or absent website confirmation pass", async () => {
  for (const [before, after] of [["Saved record 42", "Saved record 42"], ["Ready", "Still waiting"]]) {
    const f = await flow(before, after);
    const reference = browserTextTransitionReference(f.task, "saved", f.selection, f.lookup);
    expect(resolveBrowserTextTransitionEvidence(f.task, reference, f.lookup).outcome).toBe("failed");
    const reordered = structuredClone(f.outcomes.get("after")!);
    (reordered.result as any).structuredContent.sourceOrder.sequence = 1;
    expect(() => browserTextTransitionReference(f.task, "saved", f.selection, id => id === "after" ? reordered : f.lookup(id))).toThrow("bracket");
  }
});


test("approved browser pixels reach the existing Native typed-image boundary without nested raw bytes", async () => {
  const f = await flow("Ready", "Saved record 42", { requested: true, returned: true });
  const observed = f.outcomes.get("before")!;
  const body = observed.result as any;
  expect(body.structuredContent.modelImage.state).toBe("included");
  expect(body.structuredContent.observation.screenshot).toBeUndefined();
  const projected = projectNativeToolImages({ toolCallId: observed.scope.toolCallId, receipt: observed.idempotencyKey, result: observed.result });
  expect(projected.images).toHaveLength(1);
  expect(projected.images[0]!.source).toEqual({ toolCallId: "before", receipt: "before", attachmentIndex: 0 });
  expect(JSON.stringify(projected.result)).not.toContain(projected.images[0]!.data);
  const reference = browserTextTransitionReference(f.task, "saved", f.selection, f.lookup);
  expect(resolveBrowserTextTransitionEvidence(f.task, reference, f.lookup).outcome).toBe("passed");
});

test("requested but unavailable pixels remain explicit text-only evidence", async () => {
  const f = await flow("Ready", "Saved record 42", { requested: true, returned: false });
  const observed = f.outcomes.get("before")!;
  expect((observed.result as any).structuredContent.modelImage.state).toBe("unavailable");
  expect(projectNativeToolImages({ toolCallId: "before", receipt: "before", result: observed.result }).images).toHaveLength(0);
});
