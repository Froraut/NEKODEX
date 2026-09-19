import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRequest } from "../src/responses/parser";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { chatGptPromptFilePayloads } from "../src/adapters/chatgpt-web/browser-worker";
import { resolveChatGptWebCompactionPlan } from "../src/chatgpt-web-compaction-policy";
import { readFirefoxLoginCookies } from "../src/firefox-login";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import { isSpawnCollaborationWireName } from "../src/collaboration-tools";
const { AccountSafety, DEFAULT_POLICY } = require("../launcher/electron/account-safety.cjs");
const { AccountNetwork } = require("../launcher/electron/account-network.cjs");
const { UsageStore } = require("../launcher/electron/usage-store.cjs");
const temp = () => mkdtempSync(join(tmpdir(), "nekodex-v508-test-"));

test("upstream508: accepted usage survives restart and duplicates preserve its first outcome", () => {
  const dir = temp();
  try {
    const now = new Date(2026, 8, 18, 12).getTime();
    const store = new UsageStore(dir, () => now);
    store.accept("trace", 123, "receipt", "max", "5.6");
    store.finish("trace", 123, "completed");
    const restarted = new UsageStore(dir, () => now);
    restarted.accept("trace", 123, "receipt", "max", "5.6");
    restarted.finish("trace", 123, "failed");
    expect(restarted.snapshot().rows[0]).toMatchObject({ accepted: 1, completed: 1, failed: 0, modelVersion: "5.6" });
    // Corrupt-primary recovery is covered by the dedicated versioned usage-store cases.
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("upstream508: provider cooldown survives restart and explicit resume cannot bypass it", () => {
  const dir = temp(); let now = 1000;
  try {
    const safety = new AccountSafety(dir, () => now);
    safety.setPolicy("default", { ...DEFAULT_POLICY, enabled: true });
    safety.admit("default", 0); safety.fail("default", "rate_limit_exceeded");
    const restarted = new AccountSafety(dir, () => now); restarted.resume("default");
    expect(() => restarted.admit("default", 0)).toThrow("cooling down");
    now += DEFAULT_POLICY.cooldownMinutes * 60_000 + 1;
    expect(() => restarted.admit("default", 0)).not.toThrow();
    expect(() => restarted.admit("default", 1)).toThrow("concurrency");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("upstream508: selected-skill provenance reaches a bounded physical attachment", () => {
  const instruction = "<skill><name>Example</name><path>/skills/example/SKILL.md</path>Do the task carefully.</skill>";
  const parsed = parseRequest({ model: "chatgpt-web/high", input: [
    { role: "user", content: instruction, internal_chat_message_metadata_passthrough: { content_item_kinds: ["skills.selected_skill_instructions"] } },
    { role: "user", content: "Summarize the example" },
  ] });
  parsed.modelId = CHATGPT_WEB_MODEL_ID; parsed.options.reasoning = "high";
  const prepared = compileChatGptWebPrompt(parsed, { localToolsEnabled: false, solAvailable: true, proAvailable: false }, undefined,
    { experimentalSkillAttachments: true });
  const files = chatGptPromptFilePayloads(prepared);
  expect(files).toHaveLength(1); expect(files[0]!.buffer.toString()).toBe(instruction);
  expect(prepared.text).toContain(files[0]!.name); expect(prepared.text).not.toContain("Do the task carefully");
  expect(() => chatGptPromptFilePayloads({ ...prepared, skillFiles: [...prepared.skillFiles!, ...prepared.skillFiles!] })).toThrow("duplicate");
});

test("upstream508: summary selection preserves the original Pro request and leaves ordinary turns unchanged", () => {
  const source = parseRequest({ model: "chatgpt-web/pro", input: "Summarize prior work", reasoning: { effort: "max" } });
  source.modelId = CHATGPT_WEB_MODEL_ID; source._compactionRequest = true;
  const caps = { localToolsEnabled: true, solAvailable: true, proAvailable: true };
  const plan = resolveChatGptWebCompactionPlan(source, "extra-high", caps);
  expect(source.options.reasoning).toBe("max"); expect(plan.execution.context).toBe(source.context);
  expect(plan.execution.options.reasoning).toBe("xhigh"); expect(plan.compactionExecution).toEqual({ effort: "xhigh", modelVersion: "5.6" });
  source._compactionRequest = false;
  expect(resolveChatGptWebCompactionPlan(source, "5.5-pro", caps).execution).toBe(source);
});

test("upstream508: account proxy is explicit and recycles only the selected session", async () => {
  const dir = temp(); const calls: unknown[] = [];
  try {
    const network = new AccountNetwork(dir);
    network.save("default", { mode: "socks5", url: "socks5://127.0.0.1:1080" });
    const session = { setProxy: async (value: unknown) => { calls.push(value); }, closeAllConnections: async () => { calls.push("closed"); } };
    await new AccountNetwork(dir).apply(session, network.get("default"));
    expect(calls).toEqual([{ mode: "fixed_servers", proxyRules: "socks5://127.0.0.1:1080", proxyBypassRules: "<local>;localhost;127.0.0.1;[::1]" }, "closed"]);
    expect(() => network.save("default", { mode: "https", url: "https://user:secret@proxy.test:8443" })).toThrow("credentials");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("upstream508: Firefox capture imports only the owned profile's eligible login cookies", () => {
  const dir = temp();
  try {
    const db = new Database(join(dir, "cookies.sqlite"));
    db.run("CREATE TABLE moz_cookies(host TEXT, name TEXT, value TEXT, path TEXT, expiry INTEGER, isSecure INTEGER, isHttpOnly INTEGER, sameSite INTEGER, originAttributes TEXT)");
    const insert = db.query("INSERT INTO moz_cookies VALUES (?, ?, ?, '/', 2000000000, 1, 1, 1, ?)");
    insert.run(".chatgpt.com", "login", "test-only", "");
    insert.run(".example.com", "unrelated", "not-imported", "");
    insert.run(".chatgpt.com", "container", "not-imported", "^userContextId=2"); db.close();
    const captured = readFirefoxLoginCookies(dir);
    expect(captured.cookies.map(cookie => cookie.name)).toEqual(["login"]);
    expect(captured.cookies[0]).toMatchObject({ httpOnly: true, secure: true, sameSite: "Lax" });
    expect(captured.origins).toEqual([]);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("upstream508: disabling Web delegation preserves unrelated tools and native delegation", () => {
  const body = { model: "chatgpt-web/high", input: "Inspect files", tools: [
    { type: "function", name: "multi_agent_v1__spawn_agent", parameters: { type: "object" } },
    { type: "function", name: "warehouse__spawn_agent", parameters: { type: "object" } },
  ] };
  expect(parseRequest(body, { allowWebSubagents: false }).context.tools?.map(tool => tool.name)).toEqual(["warehouse__spawn_agent"]);
  expect(parseRequest({ ...body, model: "gpt-6-astra" }, { allowWebSubagents: false }).context.tools).toHaveLength(2);
  expect(isSpawnCollaborationWireName("multi_agent_v1__send_input")).toBeTrue();
  expect(isSpawnCollaborationWireName("warehouse__spawn_agent")).toBeFalse();
});
