import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBrokerEndpoint } from "../src/config";
import { callTurnBroker, TurnBroker, type BrokerToolResult } from "../src/adapters/chatgpt-web/turn-broker";

// These schedules extend the single-owner harness tests: MCP-side requests cross a real
// broker socket, with two live owners and explicit delivery barriers, never timing sleeps.
async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "route-"));
  const socket = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socket);
  const environment = {
    cwd: root, roots: [root], writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const },
    tools: [{ name: "fixture_tool", description: "Only the test owner supplies results", parameters: { type: "object" } }],
  };
  const close = async () => {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  };
  try {
    const a = await broker.register(environment, undefined, "fault-owner-a");
    const b = await broker.register(environment, undefined, "fault-owner-b");
    return {
      broker, socket, a, b, close,
      claim: (token: string) => callTurnBroker<{ bindingId: string; activityId: string }>(socket, { method: "claim", token }),
      finishActivity: (token: string, activityId: string) => callTurnBroker(socket, { method: "activity_complete", token, activityId }),
      invoke: (bindingId: string, marker: string) => {
        const result = callTurnBroker<BrokerToolResult>(socket, {
          method: "invoke", bindingId, wireName: "fixture_tool", freeform: false, arguments: { marker },
        });
        // Revocation/cleanup may reject before the test reaches its assertion.
        void result.catch(() => {});
        return result;
      },
      batch: (token: string) => broker.nextToolBatch(token, AbortSignal.timeout(2_000)),
    };
  } catch (error) {
    await close();
    throw error;
  }
}

const result = (text: string): BrokerToolResult => ({ content: [{ type: "text", text }] });

test("cancelled owner rejects late results without settling a concurrent owner's invocation", async () => {
  const f = await fixture();
  try {
    const [a, b] = await Promise.all([f.claim(f.a), f.claim(f.b)]);
    const aResult = f.invoke(a.bindingId, "cancel-me");
    const bResult = f.invoke(b.bindingId, "survivor");
    const [aBatch, bBatch] = await Promise.all([f.batch(f.a), f.batch(f.b)]);
    expect(aBatch).toHaveLength(1);
    expect(bBatch).toHaveLength(1);
    const retired = f.broker.waitForRetirement(f.a);
    expect(f.broker.revokeTrace("fault-owner-a", new Error("fault-injected cancellation"))).toBe(1);
    await retired;
    await expect(aResult).rejects.toThrow("fault-injected cancellation");
    expect(() => f.broker.completeTool(f.a, aBatch[0]!.callId, result("late success")))
      .toThrow("invalid or expired");
    expect(() => f.broker.completeTool(f.b, aBatch[0]!.callId, result("misrouted late success")))
      .toThrow("not pending");
    await expect(f.claim(f.a)).rejects.toThrow("already finished");
    await expect(callTurnBroker(f.socket, { method: "resolve", bindingId: a.bindingId }))
      .rejects.toThrow("already finished");
    expect(await f.finishActivity(f.a, a.activityId)).toEqual({ completed: false, retired: true });
    expect(await f.batch(f.b)).toEqual(bBatch);
    expect(f.broker.beginCompletionFence(f.b)).toEqual({ blockedReason: "active_work", blockedCount: 2 });
    f.broker.completeTool(f.b, bBatch[0]!.callId, result("survived cancellation"));
    expect(await bResult).toEqual(result("survived cancellation"));
    await f.finishActivity(f.b, b.activityId);
    expect(f.broker.commitCompletionFence(f.b, revision(f.broker, f.b))).toBe(true);
    expect(f.broker.revokeTrace("fault-owner-a")).toBe(0);
  } finally {
    await f.close();
  }
});

test("a drained late call invalidates only its owner's fence and terminal bindings cannot enqueue again", async () => {
  const f = await fixture();
  try {
    const staleA = revision(f.broker, f.a);
    const staleB = revision(f.broker, f.b);
    const [a, b] = await Promise.all([f.claim(f.a), f.claim(f.b)]);
    const aResult = f.invoke(a.bindingId, "crossed-a-fence");
    const bResult = f.invoke(b.bindingId, "still-running-b");
    const [aBatch, bBatch] = await Promise.all([f.batch(f.a), f.batch(f.b)]);
    expect(aBatch).toHaveLength(1);
    expect(bBatch).toHaveLength(1);
    expect(f.broker.commitCompletionFence(f.a, staleA)).toBe(false);
    f.broker.completeTool(f.a, aBatch[0]!.callId, result("a-drained"));
    expect(await aResult).toEqual(result("a-drained"));
    // A delivered result is not terminal until the corresponding MCP activity has ended.
    expect(f.broker.beginCompletionFence(f.a)).toEqual({ blockedReason: "active_work", blockedCount: 1 });
    await f.finishActivity(f.a, a.activityId);
    expect(f.broker.commitCompletionFence(f.a, staleA)).toBe(false);
    const freshA = revision(f.broker, f.a);
    expect(freshA).toBeGreaterThan(staleA);
    expect(f.broker.commitCompletionFence(f.a, freshA)).toBe(true);
    expect(f.broker.commitCompletionFence(f.a, freshA)).toBe(true);
    expect(f.broker.commitCompletionFence(f.a, staleA)).toBe(false);
    await expect(f.invoke(a.bindingId, "forbidden-after-terminal")).rejects.toThrow("already finished");
    await expect(f.claim(f.a)).rejects.toThrow("already finished");
    expect(() => f.broker.completeTool(f.a, aBatch[0]!.callId, result("late overwrite"))).toThrow("not pending");
    expect(revision(f.broker, f.a)).toBe(freshA);
    // A's commit and rejected late traffic must not commit, revoke, or drain B.
    expect(f.broker.commitCompletionFence(f.b, staleB)).toBe(false);
    expect(f.broker.beginCompletionFence(f.b)).toEqual({ blockedReason: "active_work", blockedCount: 2 });
    expect(await f.batch(f.b)).toEqual(bBatch);
    f.broker.completeTool(f.b, bBatch[0]!.callId, result("b-drained"));
    expect(await bResult).toEqual(result("b-drained"));
    await f.finishActivity(f.b, b.activityId);
    expect(f.broker.commitCompletionFence(f.b, revision(f.broker, f.b))).toBe(true);
  } finally {
    await f.close();
  }
});

function revision(broker: TurnBroker, token: string) {
  const fence = broker.beginCompletionFence(token);
  expect(fence).toHaveProperty("revision");
  if (!("revision" in fence)) throw new Error(`Unexpected blocked fence: ${JSON.stringify(fence)}`);
  return fence.revision;
}

test("concurrent owners replay only their own delivered call and reject crossed or duplicate results", async () => {
  const f = await fixture();
  try {
    const [a, b] = await Promise.all([f.claim(f.a), f.claim(f.b)]);
    expect(a.bindingId).not.toBe(b.bindingId);
    const aResult = f.invoke(a.bindingId, "a-original");
    const bResult = f.invoke(b.bindingId, "b-original");
    const [aBatch, bBatch] = await Promise.all([f.batch(f.a), f.batch(f.b)]);
    expect(aBatch).toHaveLength(1);
    expect(bBatch).toHaveLength(1);
    expect(aBatch[0]!.arguments).toEqual({ marker: "a-original" });
    expect(bBatch[0]!.arguments).toEqual({ marker: "b-original" });
    expect(aBatch[0]!.callId).not.toBe(bBatch[0]!.callId);
    const [aReplay, bReplay] = await Promise.all([f.batch(f.a), f.batch(f.b)]);
    expect(aReplay).toEqual(aBatch);
    expect(bReplay).toEqual(bBatch);

    expect(() => f.broker.completeTool(f.a, bBatch[0]!.callId, result("crossed"))).toThrow("not pending");
    expect(() => f.broker.completeTool(f.b, aBatch[0]!.callId, result("crossed"))).toThrow("not pending");
    // Complete in reverse order; a duplicate must neither replace the first result nor drain A.
    f.broker.completeTool(f.b, bBatch[0]!.callId, result("b-accepted"));
    expect(await bResult).toEqual(result("b-accepted"));
    expect(() => f.broker.completeTool(f.b, bBatch[0]!.callId, result("b-conflict"))).toThrow("not pending");
    expect(await f.batch(f.a)).toEqual(aBatch);
    f.broker.completeTool(f.a, aBatch[0]!.callId, result("a-accepted"));
    expect(await aResult).toEqual(result("a-accepted"));
    await Promise.all([f.finishActivity(f.a, a.activityId), f.finishActivity(f.b, b.activityId)]);
    expect(f.broker.commitCompletionFence(f.a, revision(f.broker, f.a))).toBe(true);
    expect(f.broker.commitCompletionFence(f.b, revision(f.broker, f.b))).toBe(true);
  } finally {
    await f.close();
  }
});
