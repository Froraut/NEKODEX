import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright-core";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import { ChatGptBrowserWorker, type BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";

for (const multipart of [false, true]) {
  test(`the real browser turn fences a generic error after ${multipart ? "first context part" : "retained response"} activation`, async () => {
    const root = mkdtempSync(join(tmpdir(), "submitted-provider-fixture-"));
    let sends = 0;
    let finalActivations = 0;
    let released = 0;
    const page = { evaluate: async () => ({}), isClosed: () => false } as unknown as Page;
    const prepared = {
      text: "Synthetic context", images: [], release: () => { released++; },
      ...(multipart ? { multipart: { parts: ["{}", "{}"] as const, commit: "Synthetic task" } } : {}),
    };
    const worker = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
      config: { browserHost: "managed-chrome", browserDiagnosticsPath: root, appName: "Fixture connector" },
      runStage: async (_trace: string, _stage: string, _timeout: number, action: (signal: AbortSignal) => Promise<unknown>) => (
        action(new AbortController().signal)
      ),
      prepareTemporaryChatSurface: async () => {},
      selectModelAndEffort: async () => ({ effort: "high", thinkEnabled: true, localTools: false }),
      captureSubmissionBaseline: async () => ({}),
      attachPrompt: async () => {},
      attachPromptWithCompactionRetry: async () => {},
      attachFiles: async () => {},
      sendAttachedPrompt: async (...args: unknown[]) => {
        const lifecycle = args[5] as Pick<BrowserTurn, "onSendActivated"> | undefined;
        await lifecycle?.onSendActivated?.();
        sends++;
        return "user_turn";
      },
      waitForNewAssistantTurn: async () => {
        throw new ChatGptWebAdapterError("Synthetic generic ChatGPT response error", {
          status: 502, errorType: "server_error", code: "upstream_server_error", retryable: true,
        });
      },
    }) as { runBrowserTurn(turn: BrowserTurn, surface: undefined, page: Page, reused: boolean): Promise<string> };
    const turn: BrowserTurn = {
      traceId: `fixture_${multipart ? "context" : "response"}`,
      modelId: CHATGPT_WEB_MODEL_ID,
      capabilities: { localToolsEnabled: false, solAvailable: true, proAvailable: true },
      prepare: async () => prepared,
      prepareResume: async () => prepared,
      onSendActivated: () => { finalActivations++; },
      onTextDelta: () => { throw new Error("No output is expected after the provider failure"); },
    };
    try {
      await expect(worker.runBrowserTurn(turn, undefined, page, !multipart)).rejects.toMatchObject({
        code: "chatgpt_submitted_provider_error", retryable: false,
        message: expect.stringContaining(multipart ? "context part 1" : "response"),
      });
      expect(sends).toBe(1);
      expect(finalActivations).toBe(multipart ? 0 : 1);
      expect(released).toBe(1);
      const directories = readdirSync(root);
      expect(directories.length).toBe(1);
      expect(readdirSync(join(root, directories[0]!))).not.toContain(".active.json");
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}
