import { expect, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptWebAdapterError } from "../src/adapters/chatgpt-web/adapter-error";
import {
  CHATGPT_DIAGNOSTIC_CAUSE_MAX_CHARS,
  chatGptDiagnosticCauseChain,
  chatGptFailureMessageWithCause,
} from "../src/adapters/chatgpt-web/browser-diagnostics";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";

const PRIMARY = "ChatGPT model version 5.6 could not be selected and verified. The pending prompt was not sent; "
  + "check that this version is available in ChatGPT.";
const PAGE_TEXT = "Synthetic private conversation row";

function pinnedModelFailure(): ChatGptWebAdapterError {
  // Playwright appends a call log that can quote rendered elements; only its first line may survive.
  const playwright = Object.assign(new Error(
    "locator.click: Timeout 5000ms exceeded.\nCall log:\n  - waiting for getByRole('menuitemradio')\n"
    + `    - locator resolved to <div role="menuitemradio">${PAGE_TEXT}</div>`,
  ), { name: "TimeoutError" });
  return new ChatGptWebAdapterError(PRIMARY, {
    status: 400, errorType: "invalid_request_error", code: "model_version_unavailable", retryable: false,
    cause: new Error("ChatGPT did not retain model family 5.6", { cause: playwright }),
  });
}

const EXPECTED_CAUSE = "Error: ChatGPT did not retain model family 5.6 <- TimeoutError: locator.click: Timeout 5000ms exceeded.";

test("a failure diagnostic keeps the sanitized cause chain of a wrapped error", async () => {
  const diagnosticsRoot = mkdtempSync(join(tmpdir(), "nekodex-diagnostic-cause-"));
  let url = "https://chatgpt.com/?temporary-chat=true";
  const page: any = {
    url: () => url,
    isClosed: () => false,
    goto: async (target: string) => { url = target; },
    screenshot: async () => undefined,
    evaluate: async () => ({ documentComplete: false, viewport: { width: 0, height: 0 }, surfaceBound: false }),
  };
  const worker: any = Object.assign(Object.create(ChatGptBrowserWorker.prototype), {
    config: { appName: "Codex Native6", browserDiagnosticsPath: diagnosticsRoot },
    ensurePage: async () => page,
    prepareTemporaryChatSurface: async () => { url = "https://chatgpt.com/"; },
    selectConnector: async () => { throw pinnedModelFailure(); },
    clearChatGptComposerState: async () => {},
  });
  try {
    await expect(worker.verifyConnectorExclusive("verify_diagnostic_cause")).rejects.toThrow(PRIMARY);
    const [trace] = readdirSync(diagnosticsRoot).filter(name => name.startsWith("verify_diagnostic_cause-"));
    const failed = readdirSync(join(diagnosticsRoot, trace!)).find(name => name.endsWith("-connector-verification-failed.json"));
    const raw = readFileSync(join(diagnosticsRoot, trace!, failed!), "utf8");
    const captured = JSON.parse(raw);
    expect(captured.error).toBe(PRIMARY);
    expect(captured.cause).toBe(EXPECTED_CAUSE);
    expect(captured.state.viewport).toEqual({ width: 0, height: 0 });
    expect(raw).not.toContain(PAGE_TEXT);
    expect(raw).not.toContain("Call log");
  } finally {
    rmSync(diagnosticsRoot, { recursive: true, force: true });
  }
});

test("the logged failure message keeps its primary sentence and appends the cause", () => {
  expect(chatGptFailureMessageWithCause(PRIMARY, pinnedModelFailure())).toBe(`${PRIMARY} (cause: ${EXPECTED_CAUSE})`);
  expect(chatGptFailureMessageWithCause(PRIMARY, new Error(PRIMARY))).toBe(PRIMARY);
  expect(chatGptFailureMessageWithCause("aborted", new DOMException("aborted", "AbortError"))).toBe("aborted");
});

test("the cause chain is bounded, cycle-safe and redacted", () => {
  const long = new Error("outer", { cause: new Error(`inner ${"x".repeat(1_000)}`) });
  const chain = chatGptDiagnosticCauseChain(long)!;
  expect(chain.length).toBe(CHATGPT_DIAGNOSTIC_CAUSE_MAX_CHARS);
  expect(chain.endsWith("…")).toBe(true);

  const cyclic: Error & { cause?: unknown } = new Error("cycle");
  cyclic.cause = new Error("back", { cause: cyclic });
  expect(chatGptDiagnosticCauseChain(cyclic)).toBe("Error: back");

  const deep = new Error("0", { cause: new Error("1", { cause: new Error("2", { cause: new Error("3", { cause: new Error("4", { cause: new Error("5") }) }) }) }) });
  expect(chatGptDiagnosticCauseChain(deep)).toBe("Error: 1 <- Error: 2 <- Error: 3 <- Error: 4");

  const context = new Error("outer", {
    cause: new Error(`Prompt mismatch turn_${"a".repeat(16)} <codex_context_json>{"secret":1}\n"tail"}</codex_context_json>`),
  });
  expect(chatGptDiagnosticCauseChain(context)).toBe("Error: Prompt mismatch turn_[redacted] <codex_context_json>[redacted]");
  expect(chatGptDiagnosticCauseChain(new Error("no cause"))).toBeUndefined();
  expect(chatGptDiagnosticCauseChain("not an error")).toBeUndefined();
});
