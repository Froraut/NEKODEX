import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseRequest } from "../src/responses/parser";
import { ChatGptThreadEnvironmentStore } from "../src/adapters/chatgpt-web/thread-environment";
import {
  MANAGED_INTERRUPT_HOOK_END,
  installCodexInterruptHook,
  installCodexInterruptHookTrust,
  restoreCodexInterruptHook,
  restoreCodexInterruptHookTrust,
  verifyCodexInterruptHook,
  verifyCodexInterruptHookTrust,
} from "../src/codex-interrupt-hook";

test("sep19 authority: same-turn steering requires current rollout authority even with a warm cache", () => {
  const codexHome = mkdtempSync(join(tmpdir(), "nekodex-sep19-steering-"));
  try {
    const threadId = "01a06c66-4232-7ae1-9108-69b5f70e0671";
    const turnId = "01a06c66-4380-75c6-a0df-318f890ef6de";
    const root = resolve(codexHome, "workspace");
    const auxiliary = resolve(codexHome, "auxiliary");
    const xml = `<environment_context><cwd>${root}</cwd><filesystem><workspace_roots><root>${root}</root><root>${auxiliary}</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem></environment_context>`;
    const message = (id: string, role: string, text: string) => ({
      type: "message", id, role,
      internal_chat_message_metadata_passthrough: { turn_id: turnId },
      content: [{ type: role === "assistant" ? "output_text" : "input_text", text }],
    });
    const body = {
      model: "chatgpt-web/pro",
      client_metadata: { "x-codex-turn-metadata": JSON.stringify({
        request_kind: "turn", thread_id: threadId, turn_id: turnId,
        agent_name: "/root", sandbox_mode: "danger-full-access", workspaces: {},
      }) },
      input: [message("msg_env", "user", xml), message("msg_original", "user", "Inspect the workspace"),
        { ...message("msg_finished", "assistant", "Done."), phase: "final_answer" },
        message("msg_steering", "user", "Continue the same investigation")],
    };
    const rolloutPath = join(codexHome, "sessions", "2026", "09", "19",
      `rollout-2026-09-19T10-00-00-${threadId}.jsonl`);
    mkdirSync(dirname(rolloutPath), { recursive: true });
    writeFileSync(rolloutPath, [
      { type: "session_meta", payload: { id: threadId, source: "vscode" } },
      { type: "turn_context", payload: {
        turn_id: turnId, cwd: root, workspace_roots: [root, auxiliary], approval_policy: "never",
        sandbox_policy: { type: "danger-full-access" }, permission_profile: { type: "disabled" },
        model: "chatgpt-web/pro", summary: "auto",
      } },
    ].map(value => JSON.stringify(value)).join("\n") + "\n");
    const request = parseRequest(body);
    request.context.tools = [{ name: "current_only", description: "current", parameters: { type: "object" } }];
    const store = new ChatGptThreadEnvironmentStore(undefined, Date.now, codexHome);
    expect(store.resolve(request)).toEqual({
      cwd: root, roots: [root, auxiliary], writableRoots: [root, auxiliary],
      sandboxPolicy: { type: "dangerFullAccess" }, tools: request.context.tools,
    });
    rmSync(rolloutPath);
    expect(() => store.resolve(request)).toThrow("missing cwd");
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
  }
});

test("sep19 authority: literal TOML trust keys retain exact ownership across interleaved and JSON hooks", () => {
  const original = 'model = "example"\n';
  const installed = installCodexInterruptHook(original, "/Users/test/.codex/config.toml", { runtimeCommand: ["/opt/runtime"] });
  const stateKey = String.raw`D:\AppData\Codex\UserData\config.toml:interrupt:0:0`;
  const oldHeader = `[hooks.state.${JSON.stringify(installed.installed.stateKey)}]`;
  const journal = { ...installed.installed, stateKey,
    fragment: installed.installed.fragment.replace(oldHeader, `[hooks.state.${JSON.stringify(stateKey)}]`) };
  const foreign = '[mcp_servers.keep]\ncommand = "keep"\n\n';
  const edited = installed.text.replace(oldHeader, foreign + `[hooks.state.'${stateKey}']`);
  verifyCodexInterruptHook(edited, journal);
  expect(restoreCodexInterruptHook(edited, journal)).toBe(original + foreign);
  expect(() => verifyCodexInterruptHook(edited.replace("timeout = 3", "timeout = 2"), journal))
    .toThrow("changed after setup");
  expect(() => verifyCodexInterruptHook(edited.replace(MANAGED_INTERRUPT_HOOK_END,
    `[hooks.state.'${stateKey}'.extra]\nchanged = true\n` + MANAGED_INTERRUPT_HOOK_END), journal))
    .toThrow("changed after setup");
  const jsonTrust = installCodexInterruptHookTrust(original, stateKey, journal.trustedHash);
  const rewritten = jsonTrust.text.replace(`[hooks.state.${JSON.stringify(stateKey)}]`, `[hooks.state.'${stateKey}']`);
  verifyCodexInterruptHookTrust(rewritten, jsonTrust.installed);
  expect(restoreCodexInterruptHookTrust(rewritten, jsonTrust.installed)).toBe(original);
});
