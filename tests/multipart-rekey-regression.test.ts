import { expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { chatGptNewTurnIdentity, chatGptStagedBaselineIdentities, throwIfChatGptSubmissionDialog } from "../src/adapters/chatgpt-web/browser-worker";
import { exactCodexAppTool } from "../src/adapters/chatgpt-web/mcp-server";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";

test("multipart rekey keeps acknowledged stages historical and binds the final Pro answer", () => {
  const acknowledgements = ["CODEX_MULTIPART_ACK transaction-1 stage-1", "CODEX_MULTIPART_ACK transaction-1 stage-2"];
  const baseline = chatGptStagedBaselineIdentities(["old-ack-1", "old-ack-2"], acknowledgements, [
    { identity: "remounted-ack-1", text: acknowledgements[0]! },
    { identity: "remounted-ack-2", text: acknowledgements[1]! },
  ]);
  expect(chatGptNewTurnIdentity(baseline, ["remounted-ack-1", "remounted-ack-2", "pro-answer"]))
    .toBe("pro-answer");
  const untrusted = chatGptStagedBaselineIdentities(baseline, acknowledgements, [
    { identity: "other-transaction", text: "CODEX_MULTIPART_ACK transaction-2 stage-1" },
  ]);
  expect(() => chatGptNewTurnIdentity(untrusted, ["other-transaction", "pro-answer"]))
    .toThrow("2 new conversation turns");
  expect(() => chatGptStagedBaselineIdentities(baseline, acknowledgements, [
    { identity: "copy-1", text: acknowledgements[0]! },
    { identity: "copy-2", text: acknowledgements[0]! },
  ])).toThrow("duplicate acknowledged context stages");
});

test("blocking submission dialogs produce an actionable error without auto-accepting", async () => {
  let visibleCount = 1;
  const page = { locator: () => ({ filter: () => ({ count: async () => visibleCount }) }) } as unknown as Page;
  await expect(throwIfChatGptSubmissionDialog(page)).rejects.toMatchObject({
    code: "chatgpt_submission_dialog", retryable: false, status: 409,
  });
  visibleCount = 0;
  await throwIfChatGptSubmissionDialog(page);
});

test("native app tool resolution accepts canonical flat names while rejecting ambiguous exports", () => {
  const flat = { name: "mcp__codex_app__read_thread", description: "Read a task", parameters: {} };
  const split = { ...flat, namespace: "mcp__codex_app", name: "read_thread" };
  const environment: ChatGptTurnEnvironment = {
    cwd: "/tmp", roots: ["/tmp"], writableRoots: [],
    sandboxPolicy: { type: "readOnly", networkAccess: false }, tools: [flat],
  };
  expect(exactCodexAppTool(environment, "read_thread")).toBe(flat);
  environment.tools = [split];
  expect(exactCodexAppTool(environment, "read_thread")).toBe(split);
  environment.tools = [flat, split];
  expect(() => exactCodexAppTool(environment, "read_thread")).toThrow("exactly one structured");
  environment.tools = [{ ...flat, freeform: true }];
  expect(() => exactCodexAppTool(environment, "read_thread")).toThrow("exactly one structured");
});
