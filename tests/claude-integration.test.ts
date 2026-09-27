import { expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig } from "../src/config";
import { installClaudeIntegration, inspectClaudeIntegration, removeClaudeIntegration } from "../src/claude-integration";
import { localApiKey, setLocalApiAccess } from "../src/local-api-access";
import { buildClaudeMessage, streamClaudeMessage } from "../src/messages/response";
import { translateClaudeMessages } from "../src/messages/request";
import type { AdapterEvent } from "../src/types";
import { ClientTurns } from "../src/client-turns";

test.serial("Claude connection restores prior settings, preserves unrelated edits and refreshes a rotated key", () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-claude-settings-"));
  const prior = { core: process.env.CODEX_CHATGPT_WEB_HOME, claude: process.env.CLAUDE_CONFIG_DIR };
  process.env.CODEX_CHATGPT_WEB_HOME = join(root, "bridge"); process.env.CLAUDE_CONFIG_DIR = join(root, "claude");
  mkdirSync(process.env.CLAUDE_CONFIG_DIR);
  const path = join(process.env.CLAUDE_CONFIG_DIR, "settings.json");
  const original = { model: "previous-choice", env: { ANTHROPIC_API_KEY: "previous-test-key", KEEP: "value" }, permissions: { allow: ["Read"] } };
  writeFileSync(path, JSON.stringify(original));
  try {
    expect(installClaudeIntegration(defaultConfig("full")).ready).toBe(true);
    const installed = JSON.parse(readFileSync(path, "utf8"));
    expect(installed.env.ANTHROPIC_API_KEY).toBe(localApiKey());
    expect(installed.env.CODEX_CHATGPT_WEB_CONTROL_TOKEN).toBeUndefined();
    expect(installed.permissions).toEqual(original.permissions);
    setLocalApiAccess(true, true);
    expect(inspectClaudeIntegration().ready).toBe(false);
    expect(installClaudeIntegration(defaultConfig("full")).ready).toBe(true);
    const current = JSON.parse(readFileSync(path, "utf8")); current.unrelated = true;
    writeFileSync(path, JSON.stringify(current));
    removeClaudeIntegration();
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ ...original, unrelated: true });
    installClaudeIntegration(defaultConfig("full"));
    const edited = JSON.parse(readFileSync(path, "utf8")); edited.env.ANTHROPIC_BASE_URL = "http://127.0.0.1:12345";
    writeFileSync(path, JSON.stringify(edited));
    expect(() => removeClaudeIntegration()).toThrow("preserving your edit");
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(edited);
  } finally {
    if (prior.core === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = prior.core;
    if (prior.claude === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prior.claude;
    rmSync(root, { recursive: true, force: true });
  }
});

test("Messages preserves images and tool errors without creating native environment authority", () => {
  const headers = new Headers({ "x-claude-code-session-id": "session", "x-claude-code-agent-id": "worker" });
  const value = translateClaudeMessages({ model: "claude-chatgpt-web-gpt-5.6-sol", max_tokens: 100, messages: [
    { role: "user", content: [{ type: "text", text: "Read this" }, { type: "image", source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" } }] },
    { role: "assistant", content: [{ type: "tool_use", id: "call_1", name: "Read", input: { path: "file" } }] },
    { role: "user", content: [{ type: "tool_result", tool_use_id: "call_1", is_error: true, content: "Permission denied" }] },
  ] }, headers);
  expect(value.body.client_metadata).toBeUndefined();
  expect(JSON.stringify(value.body.input)).not.toContain("<environment_context>");
  expect(JSON.stringify(value.body.input)).toContain("data:image/png;base64,aGVsbG8=");
  expect(JSON.stringify(value.body.input)).toContain("is_error");
  const other = translateClaudeMessages({ model: "chatgpt-web/gpt-5.6-sol", messages: [{ role: "user", content: "Read this" }] },
    new Headers({ "x-claude-code-session-id": "session", "x-claude-code-agent-id": "other" }));
  expect(value.body.prompt_cache_key).not.toBe(other.body.prompt_cache_key);
});

test("Messages never turns malformed tool arguments into an executable empty call or fabricates thinking signatures", async () => {
  const bad: AdapterEvent[] = [{ type: "thinking_delta", thinking: "Visible progress" },
    { type: "tool_call_start", id: "call_1", name: "Read" }, { type: "tool_call_delta", arguments: "{broken" },
    { type: "tool_call_end" }, { type: "done", stopReason: "tool_use", endTurn: false }];
  expect(buildClaudeMessage(bad, { model: "fixture", inputTokens: 1 }).status).toBe(502);
  let cancelled = false;
  async function* events() { yield* bad; }
  const stream = await new Response(streamClaudeMessage(events(), { model: "fixture", inputTokens: 1 }, async () => { cancelled = true; })).text();
  expect(stream).toContain("event: error");
  expect(stream).not.toContain('"tool_use"');
  expect(stream).not.toContain("signature_delta");
  expect(stream).not.toContain("event: message_stop");
  expect(cancelled).toBe(true);
});

test("external tool receipts reject changed arguments and declarations while accepting equivalent JSON", () => {
  const turns = new ClientTurns("claude");
  const original = { prompt_cache_key: "receipt-fixture", model: "chatgpt-web/gpt-5.6-sol",
    input: [{ type: "message", role: "user", content: "Read the fixture" }],
    tools: [{ type: "function", name: "Read", parameters: { type: "object", properties: { path: { type: "string" } } } }] };
  const run = turns.prepare(original);
  run.complete({ status: "completed", output: [{ type: "function_call", call_id: "read-1", name: "Read", arguments: '{ "path": "fixture" }' }] });
  run.release();
  const continued = { ...original, input: [...original.input,
    { type: "function_call", call_id: "read-1", name: "Read", arguments: '{"path":"fixture"}' },
    { type: "function_call_output", call_id: "read-1", output: "contents" }] };
  expect(() => turns.prepare({ ...continued, input: continued.input.map(item => item.type === "function_call"
    ? { ...item, arguments: '{"path":"different"}' } : item) })).toThrow("does not match");
  expect(() => turns.prepare({ ...continued, tools: [{ ...original.tools[0], parameters: { type: "object" } }] })).toThrow("declarations changed");
  const accepted = turns.prepare(continued);
  expect(accepted.context.threadId).toBe(run.context.threadId);
  expect(accepted.context.turnId).toBe(run.context.turnId);
  accepted.release();
});
