import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { ACCEPTANCE_SCOPES, parseAcceptanceOptions, runAcceptance, type AcceptanceOperations } from "../src/acceptance";

function operations(): AcceptanceOperations & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    fixtures: () => { calls.push("fixtures"); return [{ id: "synthetic", passed: true, detail: "Fixture" }]; },
    localStartup: async () => { calls.push("startup"); },
    localCodex: async () => { calls.push("codex-catalog"); },
    liveSession: async () => {
      calls.push("session");
      return { solAvailable: true, extraHighAvailable: true, proAvailable: false };
    },
    livePrompt: async (_options, activate) => { calls.push("prompt"); activate(); return { markerMatched: true }; },
  };
}

test("acceptance defaults only to offline fixtures, without invoking any installed or account operation", async () => {
  const deps = operations();
  const report = await runAcceptance(parseAcceptanceOptions([]), deps);
  expect(deps.calls).toEqual(["fixtures"]);
  expect(report.requiredChecksPassed).toBe(true);
  expect(report.promptsActivated).toBe(0);
  expect(report.automaticPromptLimit).toBe(0);
  expect(report.checks.filter(item => item.status === "skipped").length).toBe(ACCEPTANCE_SCOPES.length - 1);
});

test.each([
  ["--live-prompt"], ["--prompt-count", "1"], ["--live-prompt", "--prompt-count", "2"],
  ["--live-prompt", "--prompt-count", "0"], ["--live-prompt", "--prompt-count", "1", "--live-prompt"],
  ["--model", "pro"], ["--live-session", "--timeout-ms", "0"], ["--live-session", "--timeout-ms", "300001"],
  ["--require", "unknown"], ["--reported-mcp", "verified"], ["--unknown"],
].map(args => ({ args })))("invalid or incomplete live consent is rejected: %j", ({ args }) => {
  expect(() => parseAcceptanceOptions(args)).toThrow();
});

test("declaring a required live gate never authorizes account access", async () => {
  const deps = operations();
  const report = await runAcceptance(parseAcceptanceOptions(["--require", "live-codex", "--require", "live-mcp", "--require", "live-chatgpt"]), deps);
  expect(deps.calls).toEqual(["fixtures"]);
  expect(report.requiredChecksPassed).toBe(false);
  expect(report.checks.find(item => item.scope === "live-chatgpt")).toMatchObject({ required: true, status: "skipped" });
});

test("operator attestations remain reported and cannot satisfy required live Codex/MCP gates", async () => {
  const deps = operations();
  const report = await runAcceptance(parseAcceptanceOptions([
    "--require", "live-codex", "--require", "live-mcp", "--reported-codex", "passed", "--reported-mcp", "failed",
  ]), deps);
  expect(report.requiredChecksPassed).toBe(false);
  expect(deps.calls).toEqual(["fixtures"]);
  for (const scope of ["live-codex", "live-mcp"]) {
    expect(report.checks.find(item => item.scope === scope)).toMatchObject({ status: "reported", evidence: { independentlyVerified: false } });
  }
});

test("session-only inspection exports fixed capability booleans and never sends a prompt", async () => {
  const deps = operations();
  deps.liveSession = async () => ({ solAvailable: true, extraHighAvailable: true, proAvailable: false, credential: "PRIVATE SESSION" });
  const report = await runAcceptance(parseAcceptanceOptions(["--live-session"]), deps);
  expect(report.checks.find(item => item.scope === "live-session")?.status).toBe("passed");
  expect(report.checks.find(item => item.scope === "live-chatgpt")?.status).toBe("skipped");
  expect(report.promptsActivated).toBe(0);
  expect(JSON.stringify(report)).not.toContain("PRIVATE SESSION");
});

test("failed fixtures block all account operations and preserve unverified scopes", async () => {
  const deps = operations();
  deps.fixtures = () => [{ id: "known-selector", passed: false, detail: "PRIVATE PAGE" }];
  const report = await runAcceptance(parseAcceptanceOptions(["--live-prompt", "--prompt-count", "1"]), deps);
  expect(deps.calls).toEqual([]);
  expect(report.requiredChecksPassed).toBe(false);
  expect(report.checks.find(item => item.scope === "live-chatgpt")?.status).toBe("skipped");
  expect(JSON.stringify(report)).not.toContain("PRIVATE PAGE");
});

test("one explicitly authorized prompt verifies only its exact marker and account scope", async () => {
  const deps = operations();
  const report = await runAcceptance(parseAcceptanceOptions(["--live-prompt", "--prompt-count", "1", "--model", "extra-high"]), deps);
  expect(deps.calls).toEqual(["fixtures", "session", "prompt"]);
  expect(report.requiredChecksPassed).toBe(true);
  expect(report.promptsActivated).toBe(1);
  expect(report.checks.find(item => item.scope === "live-chatgpt")).toMatchObject({ status: "passed", evidence: { toolsEnabled: false, automaticRetries: 0 } });
  expect(report.checks.find(item => item.scope === "live-codex")?.status).toBe("skipped");
  expect(report.checks.find(item => item.scope === "live-mcp")?.status).toBe("skipped");
});

test("unavailable Pro fails before send without falling back to a permitted lower effort", async () => {
  const deps = operations();
  const report = await runAcceptance(parseAcceptanceOptions(["--live-prompt", "--prompt-count", "1", "--model", "pro"]), deps);
  expect(deps.calls).toEqual(["fixtures", "session"]);
  expect(report.promptsActivated).toBe(0);
  expect(report.checks.find(item => item.scope === "live-chatgpt")?.status).toBe("failed");
});

test("a second activation is rejected before it can send and no automatic retry occurs", async () => {
  const deps = operations();
  let sends = 0;
  deps.livePrompt = async (_options, activate) => {
    deps.calls.push("prompt");
    activate(); sends++;
    activate(); sends++;
    return { markerMatched: true };
  };
  const report = await runAcceptance(parseAcceptanceOptions(["--live-prompt", "--prompt-count", "1"]), deps);
  expect(sends).toBe(1);
  expect(deps.calls.filter(item => item === "prompt").length).toBe(1);
  expect(report.promptsActivated).toBe(1);
  expect(report.requiredChecksPassed).toBe(false);
});

test("raw process/provider failures and an unmatched reply never become acceptance evidence", async () => {
  const deps = operations();
  deps.liveSession = async () => { throw new Error("token_SECRET /Users/private/session.json private prompt"); };
  const failed = await runAcceptance(parseAcceptanceOptions(["--live-session"]), deps);
  expect(failed.requiredChecksPassed).toBe(false);
  expect(JSON.stringify(failed)).not.toMatch(/token_SECRET|\/Users\/private|private prompt/);
  const mismatch = operations();
  mismatch.livePrompt = async (_options, activate) => { activate(); return { markerMatched: false }; };
  const report = await runAcceptance(parseAcceptanceOptions(["--live-prompt", "--prompt-count", "1"]), mismatch);
  expect(report.requiredChecksPassed).toBe(false);
  expect(report.checks.find(item => item.scope === "live-chatgpt")?.status).toBe("failed");
});

test("the real default runner does not require an account configuration and prints only JSON", () => {
  const result = Bun.spawnSync([process.execPath, resolve(import.meta.dir, "../scripts/acceptance.ts")], {
    env: { ...process.env, CODEX_CHATGPT_WEB_HOME: "/nonexistent/acceptance-profile", CODEX_ACCEPTANCE_SECRET: "not-for-report" },
    stdout: "pipe", stderr: "pipe",
  });
  expect(result.exitCode).toBe(0);
  expect(result.stderr.toString()).toBe("");
  expect(result.stdout.toString()).not.toContain("not-for-report");
  const report = JSON.parse(result.stdout.toString());
  expect(report).toMatchObject({ automaticPromptLimit: 0, promptsActivated: 0, requiredChecksPassed: true });
});

test("the opt-in real local-startup runner exercises only an isolated synthetic daemon", async () => {
  const report = await runAcceptance(parseAcceptanceOptions(["--local-startup"]));
  expect(report.requiredChecksPassed).toBe(true);
  expect(report.checks.find(item => item.scope === "local-startup")).toMatchObject({ status: "passed", evidence: { isolatedHome: true, syntheticResponses: 1 } });
  expect(report.promptsActivated).toBe(0);
  expect(report.checks.find(item => item.scope === "live-session")?.status).toBe("skipped");
});
