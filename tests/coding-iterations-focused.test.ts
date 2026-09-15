import { afterAll, expect, spyOn, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parseRequest } from "../src/responses/parser";
import { rememberResponseState, expandPreviousResponseInput, flushResponseState } from "../src/responses/state";
import { runStructuredCompactionOnce, existingStructuredCompactionRun, cancelStructuredCompactionNativeTurn } from "../src/adapters/chatgpt-web/compaction-handoff";
import { ChatGptThreadEnvironmentStore } from "../src/adapters/chatgpt-web/thread-environment";
const require = createRequire(import.meta.url);
const { createUpdateController } = require("../launcher/electron/update.cjs");
const home = mkdtempSync(join(tmpdir(), "nekodex-three-coding-"));
const oldHome = process.env.CODEX_CHATGPT_WEB_HOME;
process.env.CODEX_CHATGPT_WEB_HOME = home;
afterAll(() => {
  flushResponseState();
  if (oldHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
  else process.env.CODEX_CHATGPT_WEB_HOME = oldHome;
  rmSync(home, { recursive: true, force: true });
});

test("coding iterations: tool history rejects unresolved images and unpaired search output", () => {
  expect(() => parseRequest({ model: "chatgpt-web/medium", input: [{ type: "function_call_output", call_id: "fixture", output: [{ type: "input_image", file_id: "file_fixture" }] }] })).toThrow();
  expect(() => parseRequest({ model: "chatgpt-web/medium", input: [{ type: "tool_search_call", call_id: "fixture", arguments: {} }, { type: "tool_search_output", tools: [] }] })).toThrow();
});

test("coding iterations: cancelled successful compaction cannot replay from cache", async () => {
  const key = "coding-compact-fixture";
  const owner = { ownerKey: key, traceIds: [key], nativeThreadId: "coding-thread", nativeTurnId: "coding-turn" };
  expect(await runStructuredCompactionOnce(key, owner, async () => "summary")).toBe("summary");
  const reason = new Error("fixture interruption");
  await cancelStructuredCompactionNativeTurn(owner.nativeThreadId, owner.nativeTurnId, reason).settlement;
  await expect(existingStructuredCompactionRun(key, owner)!).rejects.toBe(reason);
  await expect(runStructuredCompactionOnce(key, owner, async () => "must not run")).rejects.toBe(reason);
});

test("coding iterations: delta history remains complete across checkpoint rollover and disk snapshot", () => {
  const expected: unknown[] = [];
  for (let index = 0; index < 9; index++) {
    const input = { role: "user", content: `question ${index}` };
    const output = { type: "message", role: "assistant", content: [{ type: "output_text", text: `answer ${index}` }] };
    const raw = index === 0 ? { input: [input] } : expandPreviousResponseInput({ previous_response_id: `coding-response-${index - 1}`, input: [input] });
    rememberResponseState(raw, { id: `coding-response-${index}`, status: "completed", output: [output] });
    expected.push(input, output);
  }
  const replay = expandPreviousResponseInput({ previous_response_id: "coding-response-8", input: [] }) as { input: unknown[] };
  expect(replay.input).toEqual(expected);
  flushResponseState();
  const snapshot = JSON.parse(readFileSync(join(home, "responses-state.json"), "utf8"));
  expect(snapshot.version).toBe(1);
  expect(snapshot.states.find(([id]: [string]) => id === "coding-response-8")[1].items).toEqual(expected);
});

test("coding iterations: failed environment write retains prior in-memory authority", () => {
  const impossibleFile = join(home, "directory-not-file"); mkdirSync(impossibleFile);
  const store = new ChatGptThreadEnvironmentStore(impossibleFile);
  const internal = store as unknown as { loaded: boolean; threads: Map<string, unknown>; set(id: string, value: any): void };
  internal.loaded = true;
  const old = { cwd: home, roots: [home], writableRoots: [], sandboxPolicy: { type: "readOnly", networkAccess: false }, updatedAt: Date.now() };
  internal.threads.set("thread", old);
  expect(() => internal.set("thread", { ...old, cwd: "/changed", tools: [] })).toThrow();
  expect(internal.threads.get("thread")).toBe(old);
});

test("coding iterations: update recheck coalesces and respects completion cooldown", async () => {
  let now = 1_000_000; const clock = spyOn(Date, "now").mockImplementation(() => now);
  let calls = 0;
  const controller = createUpdateController({ currentVersion: "5.2.0-nekodex.2", platform: "darwin", arch: "arm64", packaged: true,
    executablePath: "/fixture/NEKODEX", runtimeExecutable: "/fixture/bun", logsDirectory: home,
    dependencies: { fetchRelease: async () => { calls++; if (calls === 1) throw new Error("fixture offline"); return []; } } });
  try {
    expect((await controller.checkOnce()).status).toBe("error");
    await controller.recheck(); expect(calls).toBe(1);
    now += 60_001;
    await Promise.all([controller.recheck(), controller.recheck()]);
    expect(calls).toBe(2);
    expect(controller.getState().status).toBe("up-to-date");
  } finally { clock.mockRestore(); }
});
