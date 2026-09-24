import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  extractChatGptTrailingEnvironmentDeltaClaim,
} from "../src/adapters/chatgpt-web/environment";
import { ChatGptThreadEnvironmentStore } from "../src/adapters/chatgpt-web/thread-environment";
import type { CodexParsedRequest } from "../src/types";

const root = resolve(process.cwd());
const threadId = "01a0c33d-ce24-7e73-8404-c5ec8d27692c";
const turnId = "01a0c33d-d000-7e73-8404-c5ec8d27692c";
const previousTurnId = "01a0c33d-c000-7e73-8404-c5ec8d27692c";

const unrestrictedDelta = `<environment_context>
  <current_date>2026-09-22</current_date>
  <timezone>Europe/Minsk</timezone>
  <filesystem><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>
</environment_context>`;

function message(id: string, role: "user" | "assistant", text: string, owner: string) {
  return {
    type: "message", id, role,
    content: [{ type: role === "user" ? "input_text" : "output_text", text }],
    internal_chat_message_metadata_passthrough: { turn_id: owner },
  };
}

function requestWithDelta(
  delta = unrestrictedDelta,
  options: { deltaTurnId?: string; metadataSandbox?: string } = {},
): CodexParsedRequest {
  const metadataSandbox = options.metadataSandbox ?? "danger-full-access";
  return {
    modelId: "gpt-5.6-sol",
    stream: true,
    context: { messages: [{ role: "user", content: "Inspect the workspace", timestamp: 1 }] },
    options: { reasoning: "high" },
    _rawBody: {
      client_metadata: { "x-codex-turn-metadata": JSON.stringify({
        request_kind: "turn", thread_id: threadId, turn_id: turnId,
        agent_name: "/root", sandbox_mode: metadataSandbox, workspaces: { [root]: {} },
      }) },
      input: [
        message("msg_old_environment", "user", `<environment_context><cwd>${root}</cwd><sandbox_mode>danger-full-access</sandbox_mode></environment_context>`, previousTurnId),
        message("msg_old_instruction", "user", "Earlier instruction", previousTurnId),
        message("msg_old_answer", "assistant", "Earlier answer", previousTurnId),
        message("msg_instruction", "user", "Inspect the workspace", turnId),
        { type: "reasoning", id: "rs_current", summary: [], internal_chat_message_metadata_passthrough: { turn_id: turnId } },
        { type: "function_call", id: "fc_current", name: "exec_command", arguments: "{}", call_id: "call_current",
          internal_chat_message_metadata_passthrough: { turn_id: turnId } },
        { type: "function_call_output", id: "fco_current", call_id: "call_current", output: "done",
          internal_chat_message_metadata_passthrough: { turn_id: turnId } },
        message("msg_date_delta", "user", delta, options.deltaTurnId ?? turnId),
      ],
    },
  };
}

function writeRollout(
  codexHome: string,
  options: { turn?: string; readOnlyNetwork?: boolean } = {},
): string {
  const rolloutPath = join(codexHome, "sessions", "2026", "09", "22",
    `rollout-2026-09-22T09-00-00-${threadId}.jsonl`);
  mkdirSync(dirname(rolloutPath), { recursive: true });
  const readOnly = options.readOnlyNetwork !== undefined;
  const permissionProfile = readOnly ? {
    type: "managed",
    file_system: {
      type: "restricted",
      entries: [{ access: "read", path: { type: "special", value: { kind: "root" } } }],
    },
    network: options.readOnlyNetwork ? "enabled" : "restricted",
  } : { type: "disabled" };
  const sandboxPolicy = readOnly
    ? { type: "read-only", network_access: options.readOnlyNetwork }
    : { type: "danger-full-access" };
  writeFileSync(rolloutPath, [
    { type: "session_meta", payload: { id: threadId, source: "vscode" } },
    { type: "turn_context", payload: {
      turn_id: options.turn ?? turnId,
      cwd: root,
      workspace_roots: [root],
      approval_policy: "never",
      sandbox_policy: sandboxPolicy,
      permission_profile: permissionProfile,
      model: "chatgpt-web/pro",
      summary: "auto",
    } },
  ].map(value => JSON.stringify(value)).join("\n") + "\n");
  return rolloutPath;
}

test("classifies only an exact same-turn trailing date delta with explicit sandbox policy", () => {
  expect(extractChatGptTrailingEnvironmentDeltaClaim(requestWithDelta())).toEqual({
    threadId,
    turnId,
    sandboxType: "dangerFullAccess",
  });
});

test("retains an explicit restricted-network assertion for comparison with the canonical rollout", () => {
  const delta = `<environment_context>
  <current_date>2026-09-22</current_date>
  <filesystem><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry></file_system></permission_profile></filesystem>
  <network_access>disabled</network_access>
</environment_context>`;
  expect(extractChatGptTrailingEnvironmentDeltaClaim(requestWithDelta(delta, {
    metadataSandbox: "read-only",
  }))).toEqual({ threadId, turnId, sandboxType: "readOnly", networkAccess: false });
});

test("rejects stale, missing, external, contradictory, or metadata-mismatched sandbox claims", () => {
  const missing = `<environment_context><current_date>2026-09-22</current_date></environment_context>`;
  const external = `<environment_context><filesystem><permission_profile type="external"><file_system type="external" /></permission_profile></filesystem></environment_context>`;
  const contradictory = `<environment_context><sandbox_mode>danger-full-access</sandbox_mode><permission_profile type="managed"><file_system type="restricted" /></permission_profile></environment_context>`;
  const readOnly = `<environment_context><permission_profile type="managed"><file_system type="restricted" /></permission_profile></environment_context>`;
  expect(extractChatGptTrailingEnvironmentDeltaClaim(requestWithDelta(unrestrictedDelta, {
    deltaTurnId: previousTurnId,
  }))).toBeUndefined();
  expect(extractChatGptTrailingEnvironmentDeltaClaim(requestWithDelta(missing))).toBeUndefined();
  expect(extractChatGptTrailingEnvironmentDeltaClaim(requestWithDelta(external))).toBeUndefined();
  expect(extractChatGptTrailingEnvironmentDeltaClaim(requestWithDelta(contradictory))).toBeUndefined();
  expect(extractChatGptTrailingEnvironmentDeltaClaim(requestWithDelta(readOnly))).toBeUndefined();
  expect(extractChatGptTrailingEnvironmentDeltaClaim(requestWithDelta(readOnly, {
    metadataSandbox: "read-only",
  }))).toBeUndefined();

  const staleInstruction = requestWithDelta();
  const staleInstructionInput = (staleInstruction._rawBody as { input: Array<Record<string, unknown>> }).input;
  const instruction = staleInstructionInput.find(item => item.id === "msg_instruction")!;
  instruction.internal_chat_message_metadata_passthrough = { turn_id: previousTurnId };
  expect(extractChatGptTrailingEnvironmentDeltaClaim(staleInstruction)).toBeUndefined();
});

test("rejects any trailing delta that attempts to carry filesystem authority", () => {
  for (const authority of [
    `<cwd>${root}</cwd>`,
    `<filesystem><workspace_roots><root>${root}</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>`,
    `<filesystem><permission_profile type="managed"><file_system type="restricted"><entry access="write"><path>${root}</path></entry></file_system></permission_profile></filesystem>`,
    `<filesystem><permission_profile type="managed"><file_system type="restricted"><entry access = "write"><special>:tmpdir</special></entry></file_system></permission_profile></filesystem><network_access>disabled</network_access>`,
    `<sandbox_mode>danger-full-access</sandbox_mode><file_system type="external" />`,
  ]) {
    expect(extractChatGptTrailingEnvironmentDeltaClaim(requestWithDelta(
      `<environment_context>${authority}</environment_context>`,
    ))).toBeUndefined();
  }
});

test("rejects a non-trailing delta and an intervening contextual user record", () => {
  const nonTrailing = requestWithDelta();
  const nonTrailingInput = (nonTrailing._rawBody as { input: unknown[] }).input;
  nonTrailingInput.push(message("msg_later", "assistant", "Later output", turnId));
  expect(extractChatGptTrailingEnvironmentDeltaClaim(nonTrailing)).toBeUndefined();

  const intervening = requestWithDelta();
  const interveningInput = (intervening._rawBody as { input: unknown[] }).input;
  interveningInput.splice(-1, 0, message(
    "msg_contextual_user",
    "user",
    "<subagent_notification>Context changed</subagent_notification>",
    turnId,
  ));
  expect(extractChatGptTrailingEnvironmentDeltaClaim(intervening)).toBeUndefined();
});

test("store resolves pathless date-delta authority only from the exact current native rollout", () => {
  const codexHome = mkdtempSync(join(tmpdir(), "nekodex-date-delta-"));
  try {
    const request = requestWithDelta();
    request.context.tools = [{ name: "current_tool", description: "current", parameters: { type: "object" } }];
    const store = new ChatGptThreadEnvironmentStore(undefined, Date.now, codexHome);

    expect(() => store.resolve(request)).toThrow("missing cwd");
    const rolloutPath = writeRollout(codexHome);
    expect(store.resolve(request)).toEqual({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: request.context.tools,
    });

    // A warm store must not turn the accepted rollout into stale authority for a later retry.
    rmSync(rolloutPath);
    expect(() => store.resolve(request)).toThrow("missing cwd");
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
  }
});

test("store rejects a trailing delta whose explicit network policy conflicts with the rollout", () => {
  const codexHome = mkdtempSync(join(tmpdir(), "nekodex-date-delta-network-"));
  try {
    writeRollout(codexHome, { readOnlyNetwork: false });
    const delta = `<environment_context>
  <current_date>2026-09-22</current_date>
  <filesystem><permission_profile type="managed"><file_system type="restricted"><entry access="read"><special>:root</special></entry></file_system></permission_profile></filesystem>
  <network_access>enabled</network_access>
</environment_context>`;
    const request = requestWithDelta(delta, { metadataSandbox: "read-only" });
    expect(() => new ChatGptThreadEnvironmentStore(undefined, Date.now, codexHome).resolve(request))
      .toThrow("Trailing environment delta conflicts with its current Codex rollout");
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
  }
});

test("store rejects a canonical rollout whose latest turn is not the claimed delta turn", () => {
  const codexHome = mkdtempSync(join(tmpdir(), "nekodex-date-delta-turn-"));
  try {
    writeRollout(codexHome, { turn: previousTurnId });
    expect(() => new ChatGptThreadEnvironmentStore(undefined, Date.now, codexHome).resolve(requestWithDelta()))
      .toThrow("current turn");
  } finally {
    rmSync(codexHome, { recursive: true, force: true });
  }
});
