import { expect, test } from "bun:test";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { StandaloneMcpHost } from "../src/agent-tools/mcp-host";
import { defaultToolsConfig } from "../src/agent-tools/config";
import type { StandaloneBuiltinToolsProvider } from "../src/agent-tools/types";

test("one builtin owner retains unknown-before-effect and reconciles only an exact late receipt without execution", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-builtin-owner-"))); let effects = 0; let reads = 0; let late = false; let host: StandaloneMcpHost | undefined;
  const scope = { taskId: "builtin-task", generation: 1, toolCallId: "owned-call" };
  const input = { scope, tool: "fixture/input", arguments: { value: "exact fixture input" }, idempotencyKey: "owned-input" };
  const builtin: StandaloneBuiltinToolsProvider = { serverId: "fixture", async discover() { return [{ id: "fixture/input", serverId: "fixture", name: "input", supported: true, inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } }]; },
    async execute(request) { effects++; expect(host!.getOutcome(request.idempotencyKey)?.state).toBe("outcome_unknown"); return { state: "outcome_unknown", reason: "Fixture effect happened; its terminal acknowledgement was delayed" }; },
    async reconcile() { reads++; return late ? { state: "completed", result: { exactFixtureTerminal: true } } : undefined; } };
  const create = () => new StandaloneMcpHost({ config: defaultToolsConfig(), journalPath: join(home, "tools.sqlite"), builtins: [builtin], isScopeActive: () => true });
  try {
    host = create(); expect((await host.discover(scope)).map(tool => tool.id)).toEqual([input.tool]);
    const grantId = host.authorize(input); expect((await host.invoke({ ...input, grantId })).state).toBe("outcome_unknown");
    expect((await host.reconcileExisting(input))?.state).toBe("outcome_unknown"); expect(effects).toBe(1);
    await expect(host.reconcileExisting({ ...input, arguments: { value: "changed" } })).rejects.toThrow("identity conflict"); expect(reads).toBe(1);
    late = true; expect((await host.reconcileExisting(input))?.state).toBe("completed"); expect(effects).toBe(1); expect(reads).toBe(2);
    await host.close(); host = create(); expect(host.existingOutcome(input)?.state).toBe("completed");
    expect((await host.reconcileExisting(input))?.state).toBe("completed"); expect(effects).toBe(1); expect(reads).toBe(2); expect(host.snapshot().servers).toHaveLength(0);
  } finally { await host?.close(); rmSync(home, { recursive: true, force: true }); }
});
test("builtin observation wait returns unknown without cancelling or dropping the accepted owner", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-builtin-wait-"))); let release!: () => void; let signal: AbortSignal | undefined;
  const accepted = new Promise<void>(resolve => { release = resolve; });
  const builtin: StandaloneBuiltinToolsProvider = { serverId: "fixture", async discover() { return [{ id: "fixture/input", serverId: "fixture", name: "input", supported: true, inputSchema: { type: "object", properties: {}, additionalProperties: false } }]; },
    async execute(_request, options) { signal = options?.signal; await accepted; return { state: "completed", result: { acknowledged: true } }; } };
  const host = new StandaloneMcpHost({ config: defaultToolsConfig(), journalPath: join(home, "tools.sqlite"), builtins: [builtin], isScopeActive: () => true, requestTimeoutMs: 20 });
  const input = { scope: { taskId: "fixture-task", generation: 1, toolCallId: "slow-input" }, tool: "fixture/input", arguments: {}, idempotencyKey: "slow-input" };
  try {
    await host.discover(input.scope); const grantId = host.authorize(input);
    expect((await host.invoke({ ...input, grantId })).state).toBe("outcome_unknown"); expect(signal?.aborted).toBe(false); expect(host.pendingBuiltinCount).toBe(1);
    release(); await host.waitForIdle(); expect(host.getOutcome(input.idempotencyKey)?.state).toBe("completed"); expect(host.pendingBuiltinCount).toBe(0); expect(signal?.aborted).toBe(false);
  } finally { release(); await host.close(); rmSync(home, { recursive: true, force: true }); }
});

test("approved human handoff remains owned past the ordinary observation deadline and settles once", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-human-handoff-")));
  let release!: () => void, returned = false, effects = 0;
  const humanReturn = new Promise<void>(resolve => { release = resolve; });
  const builtin: StandaloneBuiltinToolsProvider = {
    serverId: "desktop",
    waitsForUser: request => request.tool === "desktop/click" && request.arguments.waitForForeground === true,
    async discover() { return [{ id: "desktop/click", serverId: "desktop", name: "click", supported: true,
      inputSchema: { type: "object", properties: { waitForForeground: { const: true } }, required: ["waitForForeground"], additionalProperties: false } }]; },
    async execute() { await humanReturn; effects++; return { state: "completed", result: { clicked: true } }; },
  };
  const host = new StandaloneMcpHost({ config: defaultToolsConfig(), journalPath: join(home, "tools.sqlite"), builtins: [builtin], isScopeActive: () => true, requestTimeoutMs: 10 });
  const input = { scope: { taskId: "human-task", generation: 1, toolCallId: "click" }, tool: "desktop/click", arguments: { waitForForeground: true }, idempotencyKey: "one-click" };
  try {
    await host.discover(input.scope);
    const pending = host.invoke({ ...input, grantId: host.authorize(input) }).then(value => { returned = true; return value; });
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(returned).toBe(false); expect(effects).toBe(0); expect(host.pendingBuiltinCount).toBe(1);
    release(); expect((await pending).state).toBe("completed"); expect(effects).toBe(1);
    await host.waitForIdle(); expect(host.pendingBuiltinCount).toBe(0);
    expect(host.getOutcome(input.idempotencyKey)?.state).toBe("completed");
  } finally { release(); await host.close(); rmSync(home, { recursive: true, force: true }); }
});

test("concurrent worker discovery publishes complete catalogs without cross-scan duplicate identities or approval drift", async () => {
  const home = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-builtin-concurrent-")));
  let releaseFirst!: () => void, firstEntered!: () => void, malicious = false, effects = 0, active = true;
  const firstReady = new Promise<void>(resolve => { firstEntered = resolve; });
  const firstRelease = new Promise<void>(resolve => { releaseFirst = resolve; });
  const a = { taskId: "parallel-task", generation: 1, toolCallId: "worker-a" };
  const b = { taskId: "parallel-task", generation: 1, toolCallId: "worker-b" };
  const descriptor = { id: "fixture/input", serverId: "fixture", name: "input", supported: true,
    inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } };
  const builtin: StandaloneBuiltinToolsProvider = { serverId: "fixture", async discover(scope) {
    if (scope.toolCallId === a.toolCallId) { firstEntered(); await firstRelease; }
    return malicious ? [structuredClone(descriptor), structuredClone(descriptor)] : [structuredClone(descriptor)];
  }, async execute(request) { effects++; return { state: "completed", result: { call: request.scope.toolCallId } }; } };
  const host = new StandaloneMcpHost({ config: defaultToolsConfig(), journalPath: join(home, "tools.sqlite"), builtins: [builtin], isScopeActive: () => active });
  try {
    const first = host.discover(a); await firstReady;
    expect((await host.discover(b)).map(row => row.id)).toEqual([descriptor.id]);
    const inputB = { scope: b, tool: descriptor.id, arguments: { value: "B" } }, grantB = host.authorize(inputB);
    releaseFirst(); expect((await first).map(row => row.id)).toEqual([descriptor.id]);
    await expect(host.invoke({ ...inputB, scope: a, grantId: grantB, idempotencyKey: "wrong-scope" })).rejects.toThrow("Exact tool invocation approval");
    expect(effects).toBe(0);
    expect((await host.invoke({ ...inputB, grantId: grantB, idempotencyKey: "owned-b" })).result).toEqual({ call: b.toolCallId });
    const inputA = { scope: a, tool: descriptor.id, arguments: { value: "A" } };
    expect((await host.invoke({ ...inputA, grantId: host.authorize(inputA), idempotencyKey: "owned-a" })).state).toBe("completed");
    malicious = true;
    await expect(host.discover({ ...b, toolCallId: "malicious-catalog" })).rejects.toThrow("Builtin tool identity mismatch");
    // A rejected candidate cannot partially replace the last complete catalog.
    expect(() => host.authorize(inputA)).not.toThrow(); expect(effects).toBe(2);
    expect(() => host.authorize({ ...inputA, arguments: { value: 7 } })).toThrow("schema");
    active = false; expect(() => host.authorize(inputA)).toThrow("scope is unavailable");
  } finally { releaseFirst(); await host.close(); rmSync(home, { recursive: true, force: true }); }
}, 5000);
