import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createAgentToolsComposition } from "../src/agent-tools/composition";
import { createAgentRemoteToolsProvider } from "../src/remote-workspace/agent-tools";
import type { RemoteAgentBinding, RemoteAgentStatus } from "../src/remote-workspace/protocol";

test("tool composition retains failed remote cleanup until exact revocation succeeds without reopening execution", async () => {
  const home = mkdtempSync(join(tmpdir(), "neko-remote-cleanup-"));
  const taskId = randomUUID(), hostId = randomUUID(), instanceId = randomUUID();
  const scope = { taskId, familyId: taskId, generation: 1, revision: 1 };
  const binding: RemoteAgentBinding = { taskId, familyId: taskId, generation: 1, mainInstanceId: instanceId, attachmentId: randomUUID(), hostId,
    fingerprint: "a".repeat(64), root: "/fixture", connectionId: randomUUID(), hostname: "fixture.invalid", username: "fixture", port: 22, label: "Inert cleanup fixture" };
  let attached = false, revokeAttempts = 0, executions = 0;
  const status = (): RemoteAgentStatus => ({ mainInstanceId: instanceId, hosts: [], bindings: attached ? [binding] : [], activeCount: 0 });
  const remote = createAgentRemoteToolsProvider({ isScopeActive: () => true, resolveTaskScope: () => scope,
    bridge: { status: async () => status(), attach: async () => { attached = true; return status(); },
      revoke: async () => { if (++revokeAttempts === 1) throw Error("Injected lost cleanup receipt"); attached = false; return status(); },
      invalidate: async () => { throw Error("Close must not require a core generation fence"); },
      execute: async () => { executions++; throw Error("Cleanup cannot execute"); }, receipt: async () => undefined },
  });
  const tools = createAgentToolsComposition({ home, authorize: () => true, isScopeActive: () => true, remoteTools: remote });
  try {
    await tools.bindRemoteTools(scope, hostId, true);
    expect((await tools.toolsPort.discover({ taskId, generation: 1, toolCallId: "discovery" })).filter(row => row.supported)).toHaveLength(3);
    await expect(tools.close()).rejects.toThrow("Injected lost cleanup receipt");
    expect(attached).toBe(true);
    await expect(tools.toolsPort.discover({ taskId, generation: 1, toolCallId: "after-close" })).rejects.toThrow("scope is unavailable");
    await tools.close();
    expect(attached).toBe(false);
    expect(revokeAttempts).toBe(2); expect(executions).toBe(0);
    await tools.close(); expect(revokeAttempts).toBe(2);
  } finally { await tools.close(); rmSync(home, { recursive: true, force: true }); }
});
