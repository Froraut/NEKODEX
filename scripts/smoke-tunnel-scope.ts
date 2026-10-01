import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTurnBroker, RemoteTurnBroker, TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { opaqueId, type TurnBrokerOwner } from "../src/adapters/chatgpt-web/turn-broker-protocol";
import { parseHelperMessage } from "../src/adapters/chatgpt-web/browser-helper-protocol";
import { prepareScopedHelperPrompt } from "../src/adapters/chatgpt-web/launcher-helper-client";

const root = mkdtempSync(join(tmpdir(), "tunnel-scope-"));
const socket = join(root, "broker.sock");
const broker = TurnBroker.forSocket(socket);
const environment = {
  cwd: root, roots: [root], writableRoots: [root],
  sandboxPolicy: { type: "dangerFullAccess" as const },
  tools: [{ name: "fixture_tool", description: "Synthetic", parameters: { type: "object" } }],
};
const own = `tunnel_${"a".repeat(32)}`;
const other = `tunnel_${"b".repeat(32)}`;
const call = <T>(request: Parameters<typeof callTurnBroker<T>>[1]) => callTurnBroker<T>(socket, request);
const reject = async (request: Parameters<typeof call>[0]) => {
  await assert.rejects(call(request), /tunnel does not match/);
};

try {
  const scoped = await broker.register(environment);
  broker.setTunnelScope(scoped, own);
  await reject({ method: "claim", token: scoped, contract: "native", tunnelId: other });
  await reject({ method: "claim", token: scoped, contract: "native" });
  const activityId = opaqueId("activity");
  const { bindingId } = await call<{ bindingId: string }>({ method: "claim", token: scoped, contract: "native", tunnelId: own, activityId });
  await reject({ method: "resolve", bindingId, tunnelId: other });
  await reject({ method: "invoke_async", bindingId, wireName: "fixture_tool", freeform: false,
    arguments: {}, operationId: opaqueId("operation"), tunnelId: other });
  await reject({ method: "operation_status", token: scoped, tunnelId: other });
  await reject({ method: "operation_poll", token: scoped, operationId: opaqueId("operation"), tunnelId: other });
  await reject({ method: "operation_cancel", token: scoped, operationId: opaqueId("operation"), tunnelId: other });
  const resolved = await call<{ environment: { cwd: string } }>({ method: "resolve", bindingId, tunnelId: own });
  assert.equal(resolved.environment.cwd, root);
  assert.deepEqual((await call<{ operations: unknown[] }>({ method: "operation_status", token: scoped, tunnelId: own })).operations, []);
  const operationId = opaqueId("operation");
  const started = await call<{ state: string }>({ method: "invoke_async", bindingId, wireName: "fixture_tool",
    freeform: false, arguments: {}, operationId, tunnelId: own });
  assert.equal(started.state, "running");
  const [tool] = await broker.nextToolBatch(scoped);
  assert.equal(tool?.wireName, "fixture_tool");
  broker.completeTool(scoped, tool!.callId, { content: [{ type: "text", text: "own tunnel result" }] });
  const completed = await call<{ state: string; result: { content: Array<{ text: string }> } }>({
    method: "operation_poll", token: scoped, operationId, waitMs: 0, tunnelId: own,
  });
  assert.equal(completed.state, "completed");
  assert.equal(completed.result.content[0]?.text, "own tunnel result");
  await call({ method: "activity_complete", token: scoped, activityId, tunnelId: own });
  assert.throws(() => broker.setTunnelScope(scoped, other), /already assigned or bound/);
  broker.revoke(scoped);
  assert.throws(() => broker.setTunnelScope(scoped, own), /invalid or expired/);
  await assert.rejects(call({ method: "claim", token: scoped, contract: "native", tunnelId: own }), /can no longer run/);

  const legacy = await broker.register(environment);
  const legacyClaim = await call<{ bindingId: string }>({ method: "claim", token: legacy, contract: "native" });
  assert.ok(legacyClaim.bindingId);
  broker.revoke(legacy);

  const nonce = "manual_surface_nonce_123456789";
  const exerciseProductionManualRegistration = async (owner: TurnBrokerOwner, traceId: string) => {
    // Exactly the fifth-argument call made by turn-runtime, through its declared owner interface.
    const manual = await owner.registerSafe(environment, nonce, undefined, traceId,
      { tunnelScopePending: true });
    await reject({ method: "safe_start", token: manual, tunnelId: own });
    await reject({ method: "safe_start", token: manual });
    await owner.setTunnelScope(manual, own);
    await reject({ method: "safe_start", token: manual, tunnelId: other });
    await reject({ method: "safe_complete", token: manual, finalAnswer: "done" });
    await owner.confirmSafeTurnSent(manual, nonce);
    assert.deepEqual(await call({ method: "safe_start", token: manual, tunnelId: own }),
      { started: true, duplicate: false });
    await reject({ method: "claim", token: manual, contract: "safe", tunnelId: other });
    assert.deepEqual(await call({ method: "safe_complete", token: manual, finalAnswer: "done", tunnelId: own }),
      { completed: true, duplicate: false });
  };
  await exerciseProductionManualRegistration(broker, "trace_scope_local");
  await exerciseProductionManualRegistration(new RemoteTurnBroker(socket), "trace_scope_remote");
  const legacyManual = await broker.registerSafe(environment, nonce);
  broker.confirmSafeTurnSent(legacyManual, nonce);
  assert.deepEqual(await call({ method: "safe_start", token: legacyManual }), { started: true, duplicate: false });
  const pendingLegacy = await broker.registerSafe(environment, nonce, undefined, "unknown",
    { tunnelScopePending: true });
  broker.setTunnelScope(pendingLegacy);
  broker.confirmSafeTurnSent(pendingLegacy, nonce);
  assert.deepEqual(await call({ method: "safe_start", token: pendingLegacy }), { started: true, duplicate: false });

  const handshake = parseHelperMessage(JSON.stringify({ type: "event", id: "trace_helper", event: "prepared_selected",
    reused: false, tunnelScope: { accountTunnelRequired: true, tunnelId: own } }));
  assert.equal(handshake.type, "event");
  if (handshake.type !== "event" || handshake.event !== "prepared_selected") throw new Error("prepared handshake missing");
  const order: string[] = [];
  const selected = await prepareScopedHelperPrompt({ requireAccountTunnel: true, toolCapable: true,
    tunnelScope: handshake.tunnelScope,
    onTunnelSelected: async scope => { assert.equal(scope.tunnelId, own); order.push("scope"); },
    prepare: async () => { order.push("prepare"); return "prepared"; } });
  assert.equal(selected, "prepared");
  assert.deepEqual(order, ["scope", "prepare"]);
  await assert.rejects(prepareScopedHelperPrompt({ requireAccountTunnel: true, toolCapable: true,
    prepare: async () => { order.push("unsafe"); } }), /ready tunnel/);
  assert.deepEqual(order, ["scope", "prepare"]);
  assert.throws(() => parseHelperMessage(JSON.stringify({ type: "event", id: "trace_helper",
    event: "prepared_selected", reused: false, tunnelScope: { accountTunnelRequired: true } })), /scope is invalid/);
  assert.throws(() => parseHelperMessage(JSON.stringify({ type: "event", id: "trace_helper",
    event: "prepared_selected", reused: false,
    tunnelScope: { accountTunnelRequired: true, tunnelId: "tunnel_foreign_account" } })), /scope is invalid/);
  assert.equal(await prepareScopedHelperPrompt({ requireAccountTunnel: true, toolCapable: false,
    prepare: async () => "read-only" }), "read-only");
  assert.equal(await prepareScopedHelperPrompt({ requireAccountTunnel: false, toolCapable: true,
    prepare: async () => "legacy" }), "legacy");
  broker.setExternalOwnersAccepted(false);
  await assert.rejects(new RemoteTurnBroker(socket).registerSafe(environment, nonce, undefined,
    "trace_draining", { tunnelScopePending: true }), /draining/);
  const internalWhileDraining = await broker.registerSafe(environment, nonce, undefined,
    "trace_internal", { tunnelScopePending: true });
  await reject({ method: "safe_start", token: internalWhileDraining, tunnelId: own });
  broker.revoke(internalWhileDraining);
  console.log("tunnel scope smoke: broker and helper handshake OK");
} finally {
  await broker.close();
  rmSync(root, { recursive: true, force: true });
}
