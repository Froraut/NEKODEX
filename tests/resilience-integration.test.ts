import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultBrokerEndpoint, defaultConfig } from "../src/config";
import { TurnBroker, callTurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { responseRequest } from "../src/server";
import { createResponseContinuationScope, expandPreviousResponseInput, flushResponseState, rememberResponseState } from "../src/responses/state";
const { AccountQuotaReader } = require("../launcher/electron/account-quotas.cjs");

// All synthetic traffic, retained state and sockets stay outside the user's profiles.
const root = mkdtempSync(join(process.platform === "win32" ? require("node:os").tmpdir() : "/tmp", "nk-resilience-"));
const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
process.env.CODEX_CHATGPT_WEB_HOME = root;
afterAll(() => {
  flushResponseState();
  if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
  else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
  rmSync(root, { recursive: true, force: true });
});

test("resilience: native response survives closed Web admission", async () => {
  let forwarded = 0;
  const options = {
    webAdmission: () => new Response("Tool tunnel is unavailable", { status: 503 }),
    fetchUpstream: async () => { forwarded++; return new Response('{"id":"synthetic","status":"completed","output":[]}', { headers: { "content-type": "application/json" } }); },
  };
  const request = (model: string) => new Request("http://127.0.0.1/v1/responses", {
    method: "POST", headers: { authorization: "Bearer synthetic-test-credential", "content-type": "application/json" },
    body: JSON.stringify({ model, input: "synthetic", stream: false }),
  });
  const native = await responseRequest(request("gpt-5.6-sol"), defaultConfig("full"), undefined, options);
  expect(native.status).toBe(200);
  await native.text();
  expect(forwarded).toBe(1);
  const web = await responseRequest(request("chatgpt-web/gpt-5.6-sol"), defaultConfig("full"), undefined, options);
  expect(web.status).toBe(503);
  expect(forwarded).toBe(1);
});

test("resilience: retained continuation rejects another owner", () => {
  const scope = createResponseContinuationScope({ providerNamespace: "chatgpt-web", threadId: "thread-a" });
  const other = createResponseContinuationScope({ providerNamespace: "chatgpt-web", threadId: "thread-b" });
  const body = { input: [{ role: "user", content: "private owner A" }] };
  const result = rememberResponseState(body, { id: "resilience-owned", status: "completed", output: [{ role: "assistant", content: "answer A" }] }, { force: true, scope });
  expect(result.status).toBe("retained");
  const next = { previous_response_id: "resilience-owned", input: [{ role: "user", content: "continue" }] };
  expect(expandPreviousResponseInput(next, { scope: other })).toBe(next);
  expect(expandPreviousResponseInput(next, { scope })).not.toBe(next);
  flushResponseState();
});

test("resilience: clearing an in-flight quota read cannot return old account data", async () => {
  let deliver!: (response: Response) => void;
  const session = { fetch: () => new Promise<Response>(resolve => { deliver = resolve; }) };
  const reader = new AccountQuotaReader();
  const pending = reader.read(session, "default", 1, { refresh: true });
  reader.clear("default");
  const response = new Response("{}", { status: 401, headers: { "content-type": "application/json" } });
  Object.defineProperty(response, "url", { value: "https://chatgpt.com/api/auth/session" });
  deliver(response);
  expect(await pending).toMatchObject({ availability: "unavailable", reason: "stale_read" });
  expect(reader.snapshot(session, "default", 1)).toBeNull();
});

test("resilience: observation cancellation clears its completion fence and keeps replay guard", async () => {
  const socket = defaultBrokerEndpoint(join(root, "broker"));
  const broker = TurnBroker.forSocket(socket);
  try {
    const token = await broker.register({ cwd: root, roots: [root], writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" }, tools: [{ name: "synthetic", description: "Synthetic", parameters: { type: "object" } }] });
    const claimed = await callTurnBroker<{ bindingId: string; activityId: string }>(socket, { method: "claim", token });
    const operationId = "operation_" + "a".repeat(32);
    const request = { method: "invoke_async" as const, bindingId: claimed.bindingId, wireName: "synthetic", operationId, arguments: {} };
    await callTurnBroker(socket, request);
    const [dispatched] = await broker.nextToolBatch(token);
    const cancelled = await callTurnBroker<{ deliveryId: string }>(socket, { method: "operation_cancel", token, operationId });
    await callTurnBroker(socket, { method: "operation_poll", token, operationId, deliveryId: cancelled.deliveryId, waitMs: 0 });
    await callTurnBroker(socket, { method: "activity_complete", token, activityId: claimed.activityId });
    expect(broker.beginCompletionFence(token)).toHaveProperty("revision");
    broker.completeTool(token, dispatched!.callId, { content: [{ type: "text", text: "late side effect receipt" }] });
    expect(await callTurnBroker(socket, request)).toMatchObject({ state: "acknowledged" });
  } finally { await broker.close(); }
});

test("resilience: generation rollback preserves a concurrent configuration edit", () => {
  const { RuntimeGenerationStore } = require("../launcher/electron/runtime-generation.cjs");
  const configPath = join(root, "generation-config.json");
  const before = Buffer.from('{"releaseVersion":"old"}');
  const candidate = Buffer.from('{"releaseVersion":"new"}');
  writeFileSync(configPath, before);
  const store = new RuntimeGenerationStore({ configPath, journalPath: join(root, "generation-journal.json") });
  const staged = store.stage({ before, candidate, fromVersion: "old", toVersion: "new" });
  const concurrent = '{"releaseVersion":"new","userPreference":true}';
  writeFileSync(configPath, concurrent);
  expect(() => store.rollback(staged.id)).toThrow("concurrent");
  expect(readFileSync(configPath, "utf8")).toBe(concurrent);
  writeFileSync(configPath, candidate);
  expect(store.rollback(staged.id)).toMatchObject({ restored: true, fromVersion: "old" });
  expect(readFileSync(configPath).equals(before)).toBe(true);
});

test("resilience: runtime rollback stops the candidate before restoring and starting the previous generation", async () => {
  const { RuntimeGenerationStore } = require("../launcher/electron/runtime-generation.cjs");
  const { RuntimeHost } = require("../launcher/electron/runtime.cjs");
  const configPath = join(root, "ordered-generation.json");
  const before = Buffer.from('{"releaseVersion":"old"}');
  const candidate = Buffer.from('{"releaseVersion":"new"}');
  writeFileSync(configPath, before);
  const store = new RuntimeGenerationStore({ configPath, journalPath: join(root, "ordered-generation-journal.json") });
  const staged = store.stage({ before, candidate, fromVersion: "old", toVersion: "new" });
  const observed: string[] = [];
  const host = Object.create(RuntimeHost.prototype);
  host.runtimeGeneration = store;
  host.commandForRelease = (_args: unknown, version: string) => { observed.push(`validate:${version}`); return {}; };
  const readConfig = () => JSON.parse(readFileSync(configPath, "utf8"));
  host.supervisor = { readConfig,
    stopForSetup: async () => { observed.push(`stop:${readConfig().releaseVersion}`); },
    startIfConfigured: async () => { observed.push(`start:${readConfig().releaseVersion}`); return { status: "ready" }; },
  };
  expect(await host.rollbackManagedRuntimeUpgrade(staged.id)).toMatchObject({ restored: true, runtime: { status: "ready" } });
  expect(observed).toEqual(["validate:old", "stop:new", "start:old"]);
});
