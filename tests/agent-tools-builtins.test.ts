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
