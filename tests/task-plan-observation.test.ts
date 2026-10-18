import { afterEach, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRequest } from "../src/responses/parser";
import { taskPlanObservationForRequest } from "../src/adapters/chatgpt-web/task-plan-observation";
const { validTaskPlanObservation } = createRequire(import.meta.url)("../launcher/electron/task-plan-observation.cjs");
const threadId = "019c6e27-e55b-73d1-87d8-4e01f1f75043";
const turnId = "019c7714-3b77-74d1-9866-e1f484aae2ab";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
const plan = (id: string, status = "completed", text = "Inspect the changed flow") => ({ type: "function_call", id: `fc_${id}`,
  call_id: `call_${id}`, name: "update_plan", arguments: JSON.stringify({ plan: [{ step: text, status }] }) });
function fixture(records: unknown[] = []) {
  const home = mkdtempSync(join(tmpdir(), "nekodex-plan-")); dirs.push(home);
  mkdirSync(join(home, "sessions"));
  writeFileSync(join(home, "config.toml"), `sqlite_home = ${JSON.stringify(home)}\n`);
  const rollout = join(home, "sessions", `rollout-2026-10-18T01-00-00-${threadId}.jsonl`);
  writeFileSync(rollout, [
    { type: "session_meta", payload: { id: threadId, source: "cli", agent_path: "/root" } },
    { type: "turn_context", payload: { turn_id: turnId } },
    ...records.map(payload => ({ type: "response_item", payload })),
  ].map(row => JSON.stringify(row)).join("\n") + "\n");
  const db = new Database(join(home, "state_5.sqlite"));
  db.exec("CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT, agent_path TEXT); CREATE TABLE thread_spawn_edges (child_thread_id TEXT, parent_thread_id TEXT, status TEXT)");
  db.query("INSERT INTO threads VALUES (?, ?, ?)").run(threadId, rollout, "/root"); db.close();
  const request = (input: unknown[] = []) => parseRequest({ model: "chatgpt-web/high", input,
    client_metadata: { "x-codex-turn-metadata": { thread_id: threadId, turn_id: turnId,
      request_kind: "turn", sandbox_mode: "read-only", agent_name: "/root", workspaces: {} } } });
  const observe = () => taskPlanObservationForRequest(request(), { captureEnabled: true, codexHome: home, now: 100 });
  return { home, rollout, request, observe };
}

test("canonical indexed current-turn plans retain source IDs and a correction invalidates earlier completion claims", () => {
  const { observe } = fixture([plan("initial"), { type: "function_call_output", call_id: "call_initial", output: "Plan updated" },
    plan("correction", "in_progress", "Reopen the flow after a new finding"),
    { type: "function_call", call_id: "private", name: "exec_command", arguments: '{"cmd":"PRIVATE_ARGUMENTS"}' }]);
  const result = observe();
  expect(result.state).toBe("observed"); expect(result.native).toEqual({ threadId, turnId });
  expect(result.revisions[0]).toMatchObject({ revision: 1, sourceCallId: "call_initial", sourceMessageId: "fc_initial",
    steps: [{ claimedStatus: "completed", evidence: "observed", verification: "unverified" }] });
  expect(result.revisions.at(-1)).toMatchObject({ revision: 2, supersedes: 1, sourceCallId: "call_correction",
    steps: [{ claimedStatus: "in_progress", verification: "unverified" }] });
  expect(JSON.stringify(result)).not.toContain("PRIVATE_ARGUMENTS");
  expect(validTaskPlanObservation(result)).toBe(true);
  const promoted = structuredClone(result); promoted.revisions[0]!.steps[0]!.verification = "verified" as "unverified";
  expect(validTaskPlanObservation(promoted)).toBe(false);
  expect(validTaskPlanObservation({ ...result, rawToolArguments: "PRIVATE" })).toBe(false);
});

test("capture is off by default and request claims or tool success cannot manufacture a native plan", () => {
  const { home, request, observe } = fixture([{ type: "function_call_output", call_id: "call_spoof", output: "Plan updated" }]);
  const spoofed = request([plan("spoof")]);
  expect(taskPlanObservationForRequest(spoofed, { codexHome: home, now: 100 })).toEqual({
    version: 1, source: "native-codex-current-turn", observedAt: 100, state: "disabled", revisions: [], truncated: false });
  expect(taskPlanObservationForRequest(spoofed, { captureEnabled: true, codexHome: home, now: 100 })).toMatchObject({
    state: "unavailable", reason: "no-native-plan", revisions: [] });
  rmSync(join(home, "state_5.sqlite"));
  expect(observe()).toMatchObject({ state: "unavailable", reason: "native-source-unavailable", revisions: [] });
});

test("malformed or lookalike native plan sources retire the snapshot instead of preserving a stale completed plan", () => {
  for (const bad of [
    { ...plan("bad"), arguments: "{" },
    { ...plan("bad"), namespace: "mcp__spoof" },
    { ...plan("bad"), arguments: JSON.stringify({ plan: [{ step: "Claim", status: "verified" }] }) },
    { ...plan("bad"), arguments: JSON.stringify({ plan: [], arbitraryArguments: "PRIVATE" }) },
    plan("first"),
  ]) {
    const { observe } = fixture([plan("first"), bad]);
    const result = observe();
    expect(result).toMatchObject({ state: "unavailable", reason: "invalid-native-plan", revisions: [] });
    expect(validTaskPlanObservation(result)).toBe(true);
  }
});

test("a new native turn cannot reuse an old plan and retained revisions stay bounded", () => {
  const { observe, rollout } = fixture(Array.from({ length: 12 }, (_, index) => plan(String(index), "pending")));
  const result = observe();
  expect(result.truncated).toBe(true); expect(result.revisions).toHaveLength(8);
  expect(result.revisions[0]?.revision).toBe(5); expect(result.revisions.at(-1)?.revision).toBe(12);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(8000);
  expect(validTaskPlanObservation(result)).toBe(true);
  appendFileSync(rollout, JSON.stringify({ type: "turn_context", payload: { turn_id: threadId } }) + "\n");
  expect(observe()).toMatchObject({ state: "unavailable", reason: "native-source-unavailable", revisions: [] });
});
