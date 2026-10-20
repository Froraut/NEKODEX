import { afterEach, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { taskPlanCaptureEnabled } from "../src/adapters/chatgpt-web/task-plan-policy";
import type { TaskPlanObservation } from "../src/adapters/chatgpt-web/task-plan-observation";
import { notifyLauncherTurn } from "../src/launcher-browser-control";
import { LAUNCHER_BROWSER_IDLE_URL } from "../src/launcher-browser-descriptor";
const require = createRequire(import.meta.url);
const { BrowserTaskLedger } = require("../launcher/electron/browser-task-ledger.cjs");
const { BrowserTurnLifecycle } = require("../launcher/electron/browser-turn-lifecycle.cjs");
const { BrowserControlServer } = require("../launcher/electron/control-server.cjs");
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function directory() { const dir = mkdtempSync(join(tmpdir(), "nk-plan-wire-")); dirs.push(dir); return dir; }
const native = { threadId: "019c6e27-e55b-73d1-87d8-4e01f1f75043", turnId: "019c7714-3b77-74d1-9866-e1f484aae2ab" };
function planObservation(): TaskPlanObservation {
  return { version: 1, observedAt: 100, source: "native-codex-current-turn", state: "observed", native,
    revisions: [{ revision: 1, sourceCallId: "call_plan", steps: [{ text: "PRIVATE_PLAN_CONTENT", claimedStatus: "completed",
      evidence: "observed", verification: "unverified" }] }], truncated: false };
}

test("Bun plan capture follows the private Electron policy and fails closed", () => {
  const home = directory(); expect(taskPlanCaptureEnabled(home)).toBe(false);
  mkdirSync(join(home, "task-plans"), { mode: 0o700 });
  const file = join(home, "task-plans", "policy.json");
  writeFileSync(file, JSON.stringify({ version: 1, enabled: true, revision: 1 }), { mode: 0o600 });
  expect(taskPlanCaptureEnabled(home)).toBe(true);
  writeFileSync(file, JSON.stringify({ version: 1, enabled: false, revision: 2 })); expect(taskPlanCaptureEnabled(home)).toBe(false);
  writeFileSync(file, JSON.stringify({ version: 1, enabled: true, revision: 3 }));
  if (process.platform !== "win32") {
    chmodSync(file, 0o644); expect(taskPlanCaptureEnabled(home)).toBe(false); chmodSync(file, 0o600);
    chmodSync(join(home, "task-plans"), 0o755); expect(taskPlanCaptureEnabled(home)).toBe(false); chmodSync(join(home, "task-plans"), 0o700);
  }
  writeFileSync(file, JSON.stringify({ version: 2, enabled: true, revision: 4 })); expect(taskPlanCaptureEnabled(home)).toBe(false);
});

test("separate control serialization stores a plan only after native metadata and exact live ownership match", async () => {
  const home = directory(); const journal = join(home, "tasks.json");
  const ledger = new BrowserTaskLedger(journal); const taskRecordId = ledger.start("trace_plan_123", "tab_plan_123", 1);
  const surfaceId = "p".repeat(32); const captures: unknown[] = []; let enabled = true;
  const lifecycle = new BrowserTurnLifecycle({ tabs: new Map([["tab_plan_123", { id: "tab_plan_123", traceId: "trace_plan_123",
    helperPid: process.pid, surfaceId, status: "running", taskRecordId }]]),
    context: { ledger, accountId: "account_a", taskPlans: { enabled: () => enabled,
      capture: (value: unknown) => { captures.push(value); return { captured: true }; } } },
    presentation: { requestStatePublication() {} } });
  const observation = planObservation();
  await expect(lifecycle.taskPlan("trace_plan_123", process.pid, surfaceId, taskRecordId, observation)).rejects.toThrow("stored task metadata");
  ledger.progress(taskRecordId, "preparing", 1, { version: 1, observedAt: 100, source: "validated-request",
    native: { ...native, source: "codex-client", state: "request-observed" }, lineage: [], tools: [], skills: [], toolsTruncated: false, skillsTruncated: false });
  const committed = readFileSync(journal, "utf8");
  const server = new BrowserControlServer({ logger: { info() {}, warn() {}, error() {}, debug() {} }, getBrowserHost: () => ({
    taskPlan: (...args: unknown[]) => lifecycle.taskPlan(...args) }), getPreferences: () => ({}), resolveNativeProxy: () => null });
  await server.start();
  try {
    const control = server.descriptor(); const descriptor = join(home, "descriptor.json");
    writeFileSync(descriptor, JSON.stringify({ version: 3, kind: "codex-web-gpt-launcher", profile: "development", pid: process.pid,
      endpoint: control.endpoint, control, helper: { executable: process.execPath, script: import.meta.path },
      partition: "persist:codex-web-gpt-dev-chatgpt", idleUrl: LAUNCHER_BROWSER_IDLE_URL, surfaceId, surfaceTargets: {}, createdAt: new Date().toISOString() }), { mode: 0o600 });
    const activity = { phase: "plan" as const, traceId: "trace_plan_123", helperPid: process.pid, surfaceId, taskRecordId, planObservation: observation };
    await notifyLauncherTurn(descriptor, activity, 1000);
    expect(captures).toEqual([{ accountId: "account_a", taskId: taskRecordId, observation }]);
    expect(readFileSync(journal, "utf8")).toBe(committed); expect(committed).not.toContain("PRIVATE_PLAN_CONTENT");
    const send = (body: unknown) => fetch(`${control.endpoint}/v1/turn/plan`, { method: "POST", headers: {
      authorization: `Bearer ${control.token}`, "content-type": "application/json" }, body: JSON.stringify(body) });
    for (const bad of [{ ...activity, surfaceId: "z".repeat(32) }, { ...activity, helperPid: process.pid + 1 },
      { ...activity, taskRecordId: "a".repeat(32) }, { ...activity, planObservation: { ...observation, native: { ...native, turnId: "other_turn" } } },
      { ...activity, planObservation: { ...observation, rawToolArguments: "PRIVATE" } }]) {
      expect((await send(bad)).status).not.toBe(200);
    }
    expect(captures).toHaveLength(1);
    enabled = false; await notifyLauncherTurn(descriptor, activity, 1000); expect(captures).toHaveLength(1);
  } finally { await server.close(); }
}, 5000);
