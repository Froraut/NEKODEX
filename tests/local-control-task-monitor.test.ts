import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NekodexTaskMonitor } from "../src/local-control-api/task-monitor";
import { runLocalControlClient } from "../src/local-control-api/client";
const ADMIN = "synthetic-administrative-control-credential", READ = "nk-read-" + "a".repeat(64);
const scope = { taskId: "fixture-task", familyId: "fixture-family", generation: 1, revision: 1, actionId: "fixture-pause-1", explicitUserAction: true as const };
const origin = "http://127.0.0.1:17841";

test("named consumer persists unknown before one Pause, survives reopen, and reconciles only through scoped GET", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-monitor-contract-"));
  let posts = 0, gets = 0, acknowledged = false;
  const invoke = async (args: readonly string[], token: string) => runLocalControlClient(args, {
    input: (async function* () { yield token + "\n"; })(),
    request: async (url, init) => {
      const journal = readFileSync(join(directory, readdirSync(directory)[0]!), "utf8");
      expect(JSON.parse(journal).state).toBe("unknown"); expect(journal).not.toContain(ADMIN);
      if (init.method === "POST") { posts++; throw new Error("simulated lost receipt after acceptance"); }
      gets++; expect(init.method).toBe("GET"); expect(init.body).toBeUndefined();
      const query = new URL(url).searchParams; expect(query.get("actionId")).toBe(scope.actionId); expect(query.get("generation")).toBe("1");
      return Response.json({ apiVersion: "1", ok: true, value: acknowledged ? {
        task: { id: scope.taskId, familyId: scope.familyId, status: "paused", generation: 2, revision: 1, originalRequest: "PRIVATE TRANSCRIPT" }, duplicate: true,
      } : { found: false, actionId: scope.actionId } });
    },
  });
  const monitor = () => new NekodexTaskMonitor({ cli: ["fixture-existing-cli"], origin, journalDirectory: directory, invoke });
  try {
    expect((await monitor().pause(scope, ADMIN)).state).toBe("unknown");
    expect((await monitor().pause(scope, ADMIN)).state).toBe("unknown"); expect(posts).toBe(1);
    expect((await monitor().reconcile(scope.actionId, ADMIN)).state).toBe("unknown"); expect(posts).toBe(1); expect(gets).toBe(1);
    acknowledged = true;
    const result = await monitor().reconcile(scope.actionId, ADMIN);
    expect(result).toMatchObject({ state: "completed", result: { value: { duplicate: true, task: { state: "paused", familyId: scope.familyId } } } });
    expect(JSON.stringify(result)).not.toContain("PRIVATE TRANSCRIPT"); expect(JSON.stringify(result)).not.toContain(ADMIN);
    expect((await monitor().pause(scope, ADMIN)).state).toBe("completed"); expect(posts).toBe(1); expect(gets).toBe(2);
    await expect(monitor().pause({ ...scope, generation: 2 }, ADMIN)).rejects.toThrow("identity conflict"); expect(posts).toBe(1);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("snapshot requests metadata and coverage only; a read token cannot reach action transport", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-monitor-read-contract-")); const operations: string[] = [];
  const monitor = new NekodexTaskMonitor({ cli: ["fixture-existing-cli"], origin, journalDirectory: directory, invoke: async args => {
    operations.push(args[0]!); return { apiVersion: "1", ok: false, httpStatus: 503, error: { code: "source_unavailable" } };
  } });
  try {
    const snapshot = await monitor.snapshot(READ);
    expect(snapshot.content).toBe("metadata-only"); expect(snapshot.agentTasks.httpStatus).toBe(503);
    expect(operations).toEqual(["status", "agent-tasks", "history-coverage"]);
    await expect(monitor.pause(scope, READ)).rejects.toThrow("administrative"); expect(operations).toHaveLength(3);
    expect(readdirSync(directory)).toHaveLength(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("receipt route is admin-only, passive and strips the owner's retained task content", async () => {
  const { createLocalControlApiRoutes } = await import("../src/local-control-api/http");
  const directory = mkdtempSync(join(tmpdir(), "nekodex-monitor-route-contract-"));
  let reads = 0, posts = 0;
  const route = createLocalControlApiRoutes({ coreHome: directory, authorizeAdmin: request => request.headers.get("authorization") === `Bearer ${ADMIN}`,
    localGuard: () => undefined, port: () => 17841, peerAddress: () => "127.0.0.1", sources: { status: () => undefined },
    agentAction: () => { posts++; throw new Error("GET must never call action owner mutation"); },
    agentActionReceipt: input => { reads++; expect(input).toEqual({ ...scope, operation: "pause" }); return { task: { id: scope.taskId, familyId: scope.familyId, generation: 2, revision: 1, status: "paused", originalRequest: "PRIVATE TRANSCRIPT", secret: ADMIN }, duplicate: true }; },
  });
  const query = new URLSearchParams(Object.entries({ ...scope, operation: "pause" }).map(([key, value]) => [key, String(value)]));
  try {
    const call = (token: string) => route(new Request(`${origin}/admin/local-control-api-action?${query}`, { headers: { authorization: `Bearer ${token}` } }));
    expect((await call(READ))!.status).toBe(403); expect(reads).toBe(0);
    const response = await call(ADMIN), body = await response!.text();
    expect(response!.status).toBe(200); expect(JSON.parse(body)).toMatchObject({ ok: true, value: { task: { familyId: scope.familyId, status: "paused" }, duplicate: true } });
    expect(body).not.toContain(ADMIN); expect(body).not.toContain("PRIVATE TRANSCRIPT"); expect(reads).toBe(1); expect(posts).toBe(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
