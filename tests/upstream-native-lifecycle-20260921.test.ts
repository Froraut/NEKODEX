import { afterEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { SUMMARY_PREFIX } from "../src/responses/compaction";
import { ChatGptThreadEnvironmentStore } from "../src/adapters/chatgpt-web/thread-environment";
import type { CodexParsedRequest } from "../src/types";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
});

const workspace = resolve(process.cwd());
const environmentXml = `<environment_context>
  <cwd>${workspace}</cwd>
  <filesystem><workspace_roots><root>${workspace}</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>
</environment_context>`;

function compactedRequest(
  suffix: string,
  shape: "instruction-after-summary" | "summary-is-final",
  summaryTurnId?: string,
): CodexParsedRequest {
  const threadId = "01a0c403-0d4e-77f1-8eb9-4ac01c05f101";
  const turnId = "01a0c403-18a6-75b0-980e-485fa86e23bd";
  const environment = {
    type: "message",
    role: "user",
    id: `msg_environment_${suffix}`,
    content: [
      { type: "input_text", text: "<plugins>current plugins</plugins>" },
      { type: "input_text", text: environmentXml },
    ],
  };
  const summary = {
    type: "message",
    role: "user",
    id: `msg_summary_${suffix}`,
    content: [{ type: "input_text", text: `${SUMMARY_PREFIX}\n\nContinue the existing work.` }],
    ...(summaryTurnId ? { internal_chat_message_metadata_passthrough: { turn_id: summaryTurnId } } : {}),
  };
  const input = shape === "instruction-after-summary"
    ? [
      environment,
      summary,
      {
        type: "message",
        role: "developer",
        id: `msg_world_${suffix}`,
        content: [{ type: "input_text", text: "<world_state>current</world_state>" }],
      },
      {
        type: "message",
        role: "user",
        id: `msg_instruction_${suffix}`,
        content: [{ type: "input_text", text: "Continue the active task." }],
      },
    ]
    : [
      {
        type: "message",
        role: "developer",
        id: `msg_preamble_${suffix}`,
        content: [{ type: "input_text", text: "Current developer preamble" }],
      },
      environment,
      summary,
    ];
  return {
    modelId: "chatgpt-web/high",
    stream: true,
    context: { messages: [{ role: "user", content: "Continue the active task.", timestamp: 1 }] },
    options: { reasoning: "high" },
    _rawBody: {
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({
          request_kind: "turn",
          thread_id: threadId,
          turn_id: turnId,
          agent_name: "/root",
          sandbox_mode: "danger-full-access",
          workspaces: { [workspace]: { has_changes: true } },
        }),
      },
      input,
    },
  };
}

function writeNativeRollout(codexHome: string): void {
  const threadId = "01a0c403-0d4e-77f1-8eb9-4ac01c05f101";
  const turnId = "01a0c403-18a6-75b0-980e-485fa86e23bd";
  const rolloutPath = join(
    codexHome,
    "sessions",
    "2026",
    "09",
    "21",
    `rollout-2026-09-21T12-00-00-${threadId}.jsonl`,
  );
  mkdirSync(dirname(rolloutPath), { recursive: true });
  writeFileSync(rolloutPath, [
    JSON.stringify({ type: "session_meta", payload: { id: threadId, source: "vscode" } }),
    JSON.stringify({
      type: "turn_context",
      payload: {
        turn_id: turnId,
        cwd: workspace,
        workspace_roots: [workspace],
        approval_policy: "never",
        sandbox_policy: { type: "danger-full-access" },
        permission_profile: { type: "disabled" },
        model: "chatgpt-web/high",
      },
    }),
  ].join("\n") + "\n");
}

test.each(["instruction-after-summary", "summary-is-final"] as const)(
  "resolves the current trusted environment when native compaction uses the %s shape",
  shape => {
    const codexHome = mkdtempSync(join(tmpdir(), "nekodex-compacted-environment-"));
    temporaryPaths.push(codexHome);
    writeNativeRollout(codexHome);
    const request = compactedRequest(shape.replaceAll("-", "_"), shape);

    expect(new ChatGptThreadEnvironmentStore(undefined, Date.now, codexHome).resolve(request)).toEqual({
      cwd: workspace,
      roots: [workspace],
      writableRoots: [workspace],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    });
  },
);

test("does not cross a compaction summary attributed to another native turn", () => {
  const codexHome = mkdtempSync(join(tmpdir(), "nekodex-compacted-environment-mismatch-"));
  temporaryPaths.push(codexHome);
  writeNativeRollout(codexHome);
  const request = compactedRequest("mismatched_summary", "instruction-after-summary", "turn_other");

  expect(() => new ChatGptThreadEnvironmentStore(undefined, Date.now, codexHome).resolve(request))
    .toThrow("missing cwd");
});

test("does not trust server-shaped compaction item IDs without a matching native rollout", () => {
  const codexHome = mkdtempSync(join(tmpdir(), "nekodex-compacted-environment-unproven-"));
  temporaryPaths.push(codexHome);
  const request = compactedRequest("unproven_summary", "summary-is-final");

  expect(() => new ChatGptThreadEnvironmentStore(undefined, Date.now, codexHome).resolve(request))
    .toThrow("missing cwd");
});
