import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { createAgentDesktopToolsProvider } from "../src/browser-companion/agent-desktop-tools";
import { createMacosDesktopProvider, type NativeDesktopTransport } from "../src/browser-companion/macos-desktop";
import type { ToolScope } from "../src/agent-tools/types";

test("desktop controller is passive/off until explicit controls and binds bounded image/input to one task generation", async () => {
  const scope: ToolScope = { taskId: "controller-task", generation: 1, toolCallId: "observe-1" };
  const calls: string[] = []; let creates = 0, enabled = false, selected = false, closed = 0, activeGeneration = 1;
  let expire = false, failNextStatus = false, corruptNextImage = false, pendingOperation: { id: string; binding: unknown } | undefined, late: unknown;
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0, 1, 0, 1, 0, 0xff, 0xd9]);
  const pngId = "c".repeat(64);
  const selection = { windowId: "7", processId: "123:456", windowEpoch: "a".repeat(64) };
  const window = { ...selection, owner: "Private owner", title: "Private title", foreground: true, frame: { x: 10, y: 20, width: 1, height: 1 } };
  const transport: NativeDesktopTransport = {
    get activeCount() { return pendingOperation && !late ? 1 : 0; },
    async request(command, body = {}) {
      calls.push(command);
      if (command === "status" && failNextStatus) { failNextStatus = false; throw new Error("synthetic post-selection status failure"); }
      if (command === "status") return { providerId: "nekodex-macos-desktop-v1", enabled, uncertain: false, selected: selected ? window : null,
        selectionCurrent: selected, inputWindowBound: selected, screenCaptureGranted: true, accessibilityGranted: true, postEventGranted: false };
      if (command === "listWindows") return { windows: [window] };
      if (command === "enable") { enabled = true; return { enabled: true }; }
      if (command === "select") { selected = true; return { selected: window, inputWindowBound: true }; }
      if (command === "observe") return { kind: "desktop", providerId: "nekodex-macos-desktop-v1", platform: "darwin", scopeId: body.scopeId,
        observationId: randomUUID(), ...selection, frameId: "frame", frameEpoch: "b".repeat(64), screenshotId: pngId,
        coordinateSpace: "screenshot-pixels", width: 1, height: 1, screenshotResource: "native-desktop:private-png-resource" };
      if (command === "image") {
        if (body.encoding !== "jpeg") throw new Error("Raw PNG must not enter model result");
        const sourceScreenshotId = corruptNextImage ? "0".repeat(64) : pngId; corruptNextImage = false;
        return { mimeType: "image/jpeg", base64: jpeg.toString("base64"), sha256: createHash("sha256").update(jpeg).digest("hex"), sourceScreenshotId, width: 1, height: 1 };
      }
      if (command === "act") {
        if (expire) { pendingOperation = { id: body.operationId as string, binding: body.binding }; throw new Error("synthetic soft wait elapsed; physical owner retained"); }
        return { operationId: body.operationId, outcome: "completed", executed: true, reason: "synthetic native execution only" };
      }
      if (command === "invalidate") return { invalidated: true };
      throw new Error("Unexpected controller fixture command");
    },
    readExistingReceipt(id, binding) { return pendingOperation?.id === id && JSON.stringify(binding) === JSON.stringify(pendingOperation.binding) ? late : undefined; },
    async close() { closed++; },
  };
  const controller = createAgentDesktopToolsProvider({ platform: "darwin", isScopeActive: current => current.generation === activeGeneration,
    createProvider: () => { creates++; return createMacosDesktopProvider({ helperExecutable: "/unlaunched-controller-fixture", helperSha256: "f".repeat(64), platform: "darwin",
      isScopeActive: current => current.generation === activeGeneration, transportFactory: () => transport }); } });
  let sequence = 0;
  const invoke = (name: string, args: Record<string, unknown>) => controller.execute({ scope: { ...scope, toolCallId: `call-${++sequence}` }, tool: `desktop/${name}`, arguments: args, idempotencyKey: `desktop-owned-${sequence}` });
  try {
    expect(controller.status()).toMatchObject({ enabled: false, created: false, activeCount: 0, permissions: null, selected: null });
    expect((await controller.discover(scope)).every(tool => !tool.supported)).toBe(true);
    expect(creates).toBe(0); expect(calls).toEqual([]);
    await expect(controller.inspectPermissions(false)).rejects.toThrow("Explicit"); expect(creates).toBe(0);
    await controller.inspectPermissions(true); expect(creates).toBe(1); expect(calls).toEqual(["status"]);
    await controller.setEnabled(true, true); await controller.listWindows(true);
    await expect(controller.selectAndBind(scope, { ...selection, processId: "999:999" }, true)).rejects.toThrow("exact row");
    await controller.selectAndBind(scope, selection, true);
    expect(controller.status(scope).bindings).toMatchObject([{ taskId: scope.taskId, generation: 1, selection, observed: false }]);
    const beforeDiscovery = calls.length; const descriptors = await controller.discover(scope);
    expect(descriptors.map(row => row.id)).toEqual(["desktop/observe", "desktop/click", "desktop/type"]);
    expect(descriptors.every(row => row.supported)).toBe(true); expect(calls).toHaveLength(beforeDiscovery);
    expect(JSON.stringify(descriptors)).not.toContain("Private title");
    const observed = await invoke("observe", { selection }); expect(observed.state).toBe("completed");
    const output = observed.result as any;
    expect(output.content[0]).toEqual({ type: "image", mimeType: "image/jpeg", data: jpeg.toString("base64") });
    expect(output.structuredContent.modelImage.sourceScreenshotId).toBe(pngId);
    expect(Buffer.byteLength(JSON.stringify(output))).toBeLessThanOrEqual(256 * 1024);
    const binding = output.structuredContent.binding;
    expect((await invoke("click", { binding, x: 1, y: 0 })).state).toBe("failed");
    expect(calls.filter(row => row === "act")).toHaveLength(0);
    expect((await invoke("click", { binding, x: 0, y: 0 })).state).toBe("completed");
    expect((await invoke("type", { binding, text: "stale" })).state).toBe("failed");
    expect(calls.filter(row => row === "act")).toHaveLength(1);
    const fresh = await invoke("observe", { selection });
    const freshBinding = (fresh.result as any).structuredContent.binding;
    expire = true;
    const request = { scope: { ...scope, toolCallId: "retained-call" }, tool: "desktop/type", arguments: { binding: freshBinding, text: "offered text" }, idempotencyKey: "retained-exact-desktop-op" };
    expect((await controller.execute(request)).state).toBe("outcome_unknown");
    expect(pendingOperation?.id).toMatch(/^[0-9a-f-]{36}$/);
    const beforeRead = calls.length;
    expect(controller.status().activeCount).toBe(1); expect(controller.status().available).toBe(false);
    expect(await controller.reconcile(request)).toBeUndefined(); expect(calls).toHaveLength(beforeRead);
    controller.revoke(scope);
    late = { operationId: pendingOperation!.id, outcome: "completed", executed: true, reason: "synthetic late receipt" };
    expect((await controller.reconcile(request))?.state).toBe("completed");
    expect(await controller.reconcile({ ...request, arguments: { ...request.arguments, text: "changed payload" } })).toBeUndefined();
    expect(calls).toHaveLength(beforeRead); expect(controller.status().activeCount).toBe(0);
    expect(controller.status(scope).bindings).toEqual([]);
    await controller.selectAndBind(scope, selection, true);
    const beforeCorruptImage = calls.filter(row => row === "observe").length; corruptNextImage = true;
    expect((await invoke("observe", { selection })).state).toBe("failed");
    expect(calls.filter(row => row === "observe")).toHaveLength(beforeCorruptImage + 1);
    expect(controller.status()).toMatchObject({ available: false, selected: null });
    const capturesBeforeFailedControl = calls.filter(row => row === "observe").length;
    failNextStatus = true;
    await expect(controller.selectAndBind(scope, selection, true)).rejects.toThrow("post-selection");
    expect(controller.status().selected).toBeNull();
    expect((await invoke("observe", { selection })).state).toBe("failed");
    expect(calls.filter(row => row === "observe")).toHaveLength(capturesBeforeFailedControl);
    activeGeneration = 2; expect((await controller.discover({ ...scope, generation: 2 })).every(row => !row.supported)).toBe(true);
    await controller.close(); expect(closed).toBe(1); expect(controller.status()).toMatchObject({ state: "closed", enabled: false, activeCount: 0 });
    expect(creates).toBe(1);
  } finally { await controller.close(); }
});
