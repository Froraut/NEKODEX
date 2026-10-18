import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAgentRemoteDescriptorPublisher } from "../launcher/electron/agent-remote-descriptor.cjs";
import { createLauncherRemoteBridge } from "../src/remote-workspace/launcher-bridge";
import { createAgentRemoteToolsProvider } from "../src/remote-workspace/agent-tools";
import type { RemoteAgentBinding, RemoteToolRequest } from "../src/remote-workspace/protocol";
import type { ToolOutcome } from "../src/agent-tools/types";

test("private existing-listener remote bridge preserves unknown owner, one offer and exact receipt across instance restart", async () => {
  const coreHome = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-remote-bridge-")));
  const token = "inert_fixture_token_".repeat(4);
  const scope = { taskId: "task-fixture", familyId: "family-fixture", generation: 1, revision: 1 };
  let instanceId = "", executes = 0, lookups = 0, cleanup = 0, ownerHeld = false, wrongInstance = false, failRevoke = false;
  let receipt: ToolOutcome | undefined, release: (() => void) | undefined;
  const revoked: unknown[] = [];
  const actions: string[] = [];
  let binding: RemoteAgentBinding;
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    expect(request.headers.get("authorization")).toBe(`Bearer ${token}`);
    expect(request.headers.get("x-nekodex-remote-instance")).toBe(instanceId);
    const action = new URL(request.url).pathname.split("/").at(-1);
    actions.push(action!);
    const body = await request.json() as any;
    let value: unknown;
    if (action === "status" || action === "attach" || action === "revoke") {
      if (action === "revoke") {
        revoked.push(body);
        if (failRevoke) { failRevoke = false; return new Response("fixture retirement unavailable", { status: 503 }); }
      }
      value = { mainInstanceId: instanceId, hosts: [], bindings: action === "revoke" ? [] : [binding], activeCount: ownerHeld ? 1 : 0 };
    }
    else if (action === "execute") {
      executes++; ownerHeld = true;
      receipt = { scope: body.scope, tool: body.tool, idempotencyKey: body.idempotencyKey, state: "outcome_unknown" };
      await new Promise<void>(resolve => { release = resolve; });
      value = receipt;
    } else if (action === "receipt") { lookups++; value = receipt ?? null; }
    else if (action === "invalidate") { cleanup++; expect(body).toEqual({ taskId: scope.taskId, familyId: scope.familyId, beforeGeneration: 2 }); value = { invalidated: true }; }
    else return new Response("unsupported", { status: 404 });
    return Response.json({ ok: true, instanceId: wrongInstance ? randomUUID() : instanceId, value });
  } });
  const publisherOptions = { coreHome, profile: "development" as const, control: { endpoint: `http://127.0.0.1:${server.port}`, token } };
  const publisher = createAgentRemoteDescriptorPublisher(publisherOptions); publisher.publish(); instanceId = publisher.instanceId;
  binding = { mainInstanceId: instanceId, attachmentId: randomUUID(), taskId: scope.taskId, familyId: scope.familyId, generation: 1,
    hostId: randomUUID(), fingerprint: "a".repeat(64), root: "/fixture", connectionId: randomUUID(), hostname: "fixture.invalid", username: "fixture", port: 22, label: "Inert fixture" };
  const bridge = createLauncherRemoteBridge({ descriptorPath: publisher.path, expectedProfile: "development", requestWaitMs: 50 });
  let currentGeneration = 1;
  const provider = createAgentRemoteToolsProvider({ bridge, isScopeActive: candidate => candidate.generation === currentGeneration,
    resolveTaskScope: () => ({ ...scope, generation: currentGeneration }) });
  const request: RemoteToolRequest = { scope: { taskId: scope.taskId, generation: 1, toolCallId: "call-fixture" }, tool: "remote/command",
    arguments: { binding, command: "printf fixture", timeoutSeconds: 30 }, idempotencyKey: "fixture-exact-call" };
  try {
    expect(provider.status().available).toBe(false); expect(executes).toBe(0);
    await provider.attach(scope, binding.hostId, true);
    const descriptors = await provider.discover(request.scope);
    expect(descriptors).toHaveLength(3); expect(descriptors.every(row => row.supported)).toBe(true);
    expect((descriptors[2]!.inputSchema.properties as any).binding.const).toEqual(binding);
    const unknown = await provider.execute(request);
    expect(unknown.state).toBe("outcome_unknown"); expect(executes).toBe(1); expect(ownerHeld).toBe(true);
    expect((await provider.execute(request)).state).toBe("outcome_unknown"); expect(executes).toBe(1);
    expect((await provider.reconcile(request))?.state).toBe("outcome_unknown"); expect(lookups).toBe(1);
    receipt = { ...receipt!, state: "completed", result: { isError: false, structuredContent: { source: "untrusted-remote-output", text: "fixture", binding } } };
    ownerHeld = false; release!();
    expect((await provider.reconcile(request))?.state).toBe("completed"); expect(executes).toBe(1);
    // New transport owner can retrieve an exact old signed request receipt, never execute it.
    const restarted = createAgentRemoteDescriptorPublisher(publisherOptions); restarted.publish(); instanceId = restarted.instanceId;
    expect((await bridge.receipt(request))?.result).toEqual(receipt.result); expect(executes).toBe(1);
    await expect(bridge.execute({ ...request, scope: { ...request.scope, toolCallId: "different" }, idempotencyKey: "different" })).rejects.toThrow("instance changed");
    expect(executes).toBe(1);
    wrongInstance = true; await expect(bridge.status()).rejects.toThrow(); wrongInstance = false;
    currentGeneration = 2; provider.invalidate(scope.taskId); expect(provider.status(request.scope).bound).toBe(false);
    await provider.settle(); expect(cleanup).toBe(1);
    await provider.close();
    expect(revoked).toEqual([{ taskId: scope.taskId, generation: 1 }]); expect(cleanup).toBe(1);
    // A lost attachment acknowledgement still has an exact shutdown revocation.
    binding = { ...binding, mainInstanceId: instanceId, generation: 2, attachmentId: randomUUID() };
    const unknownAttach = createAgentRemoteToolsProvider({ bridge, isScopeActive: () => true });
    wrongInstance = true;
    await expect(unknownAttach.attach({ ...scope, generation: 2 }, binding.hostId, true)).rejects.toThrow();
    wrongInstance = false;
    failRevoke = true;
    const firstClose = unknownAttach.close();
    expect(unknownAttach.close()).toBe(firstClose);
    await expect(firstClose).rejects.toThrow("unavailable");
    expect(unknownAttach.status().closed).toBe(true);
    await expect(unknownAttach.attach({ ...scope, generation: 2 }, binding.hostId, true)).rejects.toThrow("unavailable");
    const secondClose = unknownAttach.close();
    expect(secondClose).not.toBe(firstClose);
    await secondClose;
    expect(unknownAttach.close()).toBe(secondClose);
    expect(revoked.slice(-2)).toEqual([{ taskId: scope.taskId, generation: 2 }, { taskId: scope.taskId, generation: 2 }]);
    expect(revoked.at(-1)).toEqual({ taskId: scope.taskId, generation: 2 }); expect(cleanup).toBe(1); expect(executes).toBe(1);
    // A POST still waiting to be sent must finish before shutdown's final revoke.
    // Retiring first would let that delayed attachment acquire fresh authority.
    let sendAttach: (() => void) | undefined;
    const gate = new Promise<void>(resolve => { sendAttach = resolve; });
    const delayed = createAgentRemoteToolsProvider({ bridge: { ...bridge, async attach(input) { await gate; return bridge.attach(input); } }, isScopeActive: () => true });
    const priorActions = actions.length;
    const attaching = delayed.attach({ ...scope, generation: 2 }, binding.hostId, true);
    const retiring = delayed.close();
    expect(delayed.close()).toBe(retiring);
    await Promise.resolve();
    expect(actions.slice(priorActions)).toEqual([]);
    sendAttach!();
    await attaching; await retiring;
    expect(actions.slice(priorActions)).toEqual(["attach", "revoke"]);
    expect(delayed.status().closed).toBe(true); expect(delayed.status().bindings).toEqual([]);
    expect(cleanup).toBe(1); expect(executes).toBe(1);
  } finally { release?.(); server.stop(true); rmSync(coreHome, { recursive: true, force: true }); }
}, 5000);

test("remote descriptor rejects malformed, public or replaced paths before any request", async () => {
  const coreHome = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-remote-private-")));
  let requests = 0;
  const publisher = createAgentRemoteDescriptorPublisher({ coreHome, profile: "development", control: { endpoint: "http://127.0.0.1:1", token: "f".repeat(64) } });
  publisher.publish();
  const bridge = createLauncherRemoteBridge({ descriptorPath: publisher.path, expectedProfile: "development", fetch: (async () => { requests++; throw new Error("must not send"); }) as typeof fetch });
  const bytes = readFileSync(publisher.path);
  try {
    const malformed = { ...JSON.parse(bytes.toString()), models: [] };
    writeFileSync(publisher.path, JSON.stringify(malformed)); await expect(bridge.status()).rejects.toThrow();
    writeFileSync(publisher.path, bytes); chmodSync(publisher.path, 0o644); await expect(bridge.status()).rejects.toThrow("private");
    chmodSync(publisher.path, 0o600);
    const prior = publisher.path + ".prior"; renameSync(publisher.path, prior); symlinkSync(prior, publisher.path);
    await expect(bridge.status()).rejects.toThrow("canonical");
    expect(requests).toBe(0);
  } finally { rmSync(coreHome, { recursive: true, force: true }); }
}, 5000);
