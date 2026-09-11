import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { runUiFixtureChecks } from "./acceptance-ui-fixtures";
import { VERSION } from "./version";

export const ACCEPTANCE_SCOPES = [
  "offline-fixtures", "local-startup", "local-codex-catalog", "live-session", "live-chatgpt", "live-codex", "live-mcp",
] as const;
export type AcceptanceScope = typeof ACCEPTANCE_SCOPES[number];
type ReportedOutcome = "passed" | "failed";
export interface AcceptanceOptions {
  localStartup: boolean;
  localCodex?: string;
  liveSession: boolean;
  livePrompt: boolean;
  promptCount: 0 | 1;
  model: "high" | "extra-high" | "pro";
  timeoutMs: number;
  required: AcceptanceScope[];
  reportedCodex?: ReportedOutcome;
  reportedMcp?: ReportedOutcome;
}
export interface AcceptanceCheck {
  scope: AcceptanceScope;
  status: "passed" | "failed" | "skipped" | "reported";
  required: boolean;
  detail: string;
  evidence?: Record<string, string | number | boolean>;
}
export interface AcceptanceReport {
  schemaVersion: 1;
  fixtureVersion: 1;
  sourceVersion: string;
  capturedAt: string;
  requiredChecksPassed: boolean;
  automaticPromptLimit: 0 | 1;
  promptsActivated: number;
  checks: AcceptanceCheck[];
}

function valueAfter(args: string[], index: number): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error("An option value is missing");
  return value;
}

export function parseAcceptanceOptions(args: string[]): AcceptanceOptions {
  const result: AcceptanceOptions = {
    localStartup: false, liveSession: false, livePrompt: false, promptCount: 0,
    model: "high", timeoutMs: 120_000, required: ["offline-fixtures"],
  };
  const seen = new Set<string>();
  for (let index = 0; index < args.length; index++) {
    const flag = args[index]!;
    if (seen.has(flag) && flag !== "--require") throw new Error("An option was specified more than once");
    seen.add(flag);
    if (flag === "--local-startup") result.localStartup = true;
    else if (flag === "--live-session") result.liveSession = true;
    else if (flag === "--live-prompt") result.livePrompt = true;
    else if (flag === "--local-codex") result.localCodex = valueAfter(args, index++);
    else if (flag === "--prompt-count") {
      if (valueAfter(args, index++) !== "1") throw new Error("Live acceptance permits exactly one prompt");
      result.promptCount = 1;
    } else if (flag === "--model") {
      const value = valueAfter(args, index++);
      if (value !== "high" && value !== "extra-high" && value !== "pro") throw new Error("Unsupported acceptance model");
      result.model = value;
    } else if (flag === "--timeout-ms") {
      const value = valueAfter(args, index++);
      if (!/^\d+$/.test(value) || Number(value) < 1_000 || Number(value) > 300_000) {
        throw new Error("Acceptance timeout must be 1000 to 300000 milliseconds");
      }
      result.timeoutMs = Number(value);
    } else if (flag === "--require") {
      const value = valueAfter(args, index++);
      if (!ACCEPTANCE_SCOPES.includes(value as AcceptanceScope)) throw new Error("Unknown required acceptance scope");
      result.required.push(value as AcceptanceScope);
    } else if (flag === "--reported-codex" || flag === "--reported-mcp") {
      const value = valueAfter(args, index++);
      if (value !== "passed" && value !== "failed") throw new Error("Reported outcome must be passed or failed");
      if (flag === "--reported-codex") result.reportedCodex = value;
      else result.reportedMcp = value;
    } else throw new Error("Unknown acceptance option");
  }
  if (result.livePrompt !== (result.promptCount === 1)) {
    throw new Error("Sending a prompt requires both --live-prompt and --prompt-count 1");
  }
  if (seen.has("--model") && !result.livePrompt) throw new Error("--model requires an explicitly authorized live prompt");
  if (result.livePrompt) result.liveSession = true;
  if (result.localStartup) result.required.push("local-startup");
  if (result.localCodex) result.required.push("local-codex-catalog");
  if (result.liveSession) result.required.push("live-session");
  if (result.livePrompt) result.required.push("live-chatgpt");
  result.required = [...new Set(result.required)];
  return result;
}

export interface AcceptanceOperations {
  fixtures(): Array<{ id: string; passed: boolean; detail: string }>;
  localStartup(): Promise<void>;
  localCodex(path: string): Promise<void>;
  liveSession(timeoutMs: number): Promise<{ solAvailable: boolean; extraHighAvailable: boolean; proAvailable: boolean }>;
  livePrompt(options: AcceptanceOptions, activate: () => void, capabilities: {
    solAvailable: boolean; extraHighAvailable: boolean; proAvailable: boolean;
  }): Promise<{ markerMatched: boolean }>;
}

/** Dependency results are reduced to a fixed allowlist; error messages and account text are never exported. */
export async function runAcceptance(
  options: AcceptanceOptions,
  operations: AcceptanceOperations = acceptanceOperations,
): Promise<AcceptanceReport> {
  if (options.livePrompt !== (options.promptCount === 1)) throw new Error("Explicit one-prompt authorization is required");
  const report: AcceptanceReport = {
    schemaVersion: 1, fixtureVersion: 1, sourceVersion: VERSION, capturedAt: new Date().toISOString(),
    requiredChecksPassed: false, automaticPromptLimit: options.promptCount, promptsActivated: 0,
    checks: ACCEPTANCE_SCOPES.map(scope => ({
      scope, status: "skipped", required: options.required.includes(scope), detail: "Not exercised by this run.",
    })),
  };
  const check = (scope: AcceptanceScope) => report.checks.find(item => item.scope === scope)!;
  async function record(scope: AcceptanceScope, detail: string, operation: () => Promise<Record<string, string | number | boolean>>): Promise<void> {
    const item = check(scope);
    try {
      item.evidence = await operation();
      item.status = "passed";
      item.detail = detail;
    } catch {
      item.status = "failed";
      item.detail = "The scoped check failed. Raw process, browser and account errors are excluded from this report.";
    }
  }
  await record("offline-fixtures", "Versioned synthetic structural/model fixtures passed; no browser or account was opened.", async () => {
    const fixtures = operations.fixtures();
    if (!fixtures.length || fixtures.some(item => !item.passed)) throw new Error("Fixture failure");
    return { fixturesChecked: fixtures.length, fixtureVersion: 1 };
  });
  if (options.localStartup) await record("local-startup", "An isolated local daemon served a synthetic response; no account or installed app was exercised.", async () => {
    await operations.localStartup(); return { isolatedHome: true, networkScope: "loopback-only", syntheticResponses: 1 };
  });
  if (options.localCodex) await record("local-codex-catalog", "The selected Codex executable accepted its isolated augmented catalog; no live Codex task ran.", async () => {
    await operations.localCodex(options.localCodex!); return { isolatedHome: true, liveTasks: 0 };
  });
  let capabilities: Awaited<ReturnType<AcceptanceOperations["liveSession"]>> | undefined;
  if (options.liveSession && check("offline-fixtures").status === "passed") {
    await record("live-session", "The owned launcher session was inspected through the doctor's authenticated capability-check boundary; no prompt was sent by this check.", async () => {
      capabilities = await operations.liveSession(options.timeoutMs);
      return {
        authenticated: true, solAvailable: capabilities.solAvailable,
        extraHighAvailable: capabilities.extraHighAvailable, proAvailable: capabilities.proAvailable,
      };
    });
  }
  if (options.livePrompt && capabilities && check("live-session").status === "passed") {
    await record("live-chatgpt", "One inert browser-only prompt returned the exact marker; this does not prove Codex, MCP, passkey login or persistence.", async () => {
      if (!capabilities!.solAvailable || (options.model === "pro" && !capabilities!.proAvailable)
        || (options.model === "extra-high" && !capabilities!.extraHighAvailable)) throw new Error("Requested model unavailable");
      const result = await operations.livePrompt(options, () => {
        if (report.promptsActivated >= 1) throw new Error("Acceptance prompt budget exhausted");
        report.promptsActivated++;
      }, capabilities!);
      if (!result.markerMatched || report.promptsActivated !== 1) throw new Error("Exact reply evidence missing");
      return { markerMatched: true, model: options.model, toolsEnabled: false, automaticRetries: 0 };
    });
  }
  for (const [scope, outcome] of [["live-codex", options.reportedCodex], ["live-mcp", options.reportedMcp]] as const) {
    if (outcome) Object.assign(check(scope), {
      status: "reported", detail: "Operator-reported outcome; this runner has not independently verified it.",
      evidence: { reportedOutcome: outcome, independentlyVerified: false },
    });
  }
  report.requiredChecksPassed = report.checks.every(item => !item.required || item.status === "passed");
  return report;
}

async function quietly<T>(operation: () => Promise<T>): Promise<T> {
  const original = { info: console.info, warn: console.warn, error: console.error, log: console.log, debug: console.debug };
  console.info = console.warn = console.error = console.log = console.debug = () => {};
  try { return await operation(); } finally { Object.assign(console, original); }
}

function isolatedScript(script: string, args: string[], marker: string): void {
  const directory = mkdtempSync(join(tmpdir(), "codex-acceptance-local-"));
  try {
    mkdirSync(join(directory, "codex"));
    const result = spawnSync(process.execPath, [resolve(import.meta.dir, "..", "scripts", script), ...args], {
      env: { ...process.env, CODEX_CHATGPT_WEB_HOME: join(directory, "app"), CODEX_HOME: join(directory, "codex") },
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 20_000, maxBuffer: 64 * 1024,
    });
    if (result.error || result.status !== 0 || !result.stdout.split(/\r?\n/).includes(marker)) {
      throw new Error("Isolated acceptance process failed");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

const acceptanceOperations: AcceptanceOperations = {
  fixtures: runUiFixtureChecks,
  localStartup: async () => isolatedScript("acceptance-local-startup.ts", [], "ACCEPTANCE_LOCAL_STARTUP_OK"),
  localCodex: async path => isolatedScript("smoke-codex-catalog.ts", [resolve(path)], "NATIVE_CODEX_CATALOG_SMOKE_OK"),
  liveSession: async timeoutMs => quietly(async () => {
    const { loadConfig } = await import("./config");
    const { inspectLauncherBrowserHost } = await import("./launcher-browser-host");
    const config = loadConfig();
    if (config.browserHost !== "launcher" || config.browserInteractionMode !== "automatic") {
      throw new Error("Live inspection requires the automatic owned launcher surface");
    }
    const evidence = await inspectLauncherBrowserHost(config.browserHostDescriptorPath!, { detectCapabilities: true, timeoutMs });
    if (typeof evidence.solAvailable !== "boolean" || typeof evidence.extraHighAvailable !== "boolean"
      || typeof evidence.proAvailable !== "boolean") throw new Error("Incomplete capability evidence");
    return { solAvailable: evidence.solAvailable, extraHighAvailable: evidence.extraHighAvailable, proAvailable: evidence.proAvailable };
  }),
  livePrompt: async (options, activate, capabilities) => quietly(async () => {
    const { loadConfig, providerConfig } = await import("./config");
    const { ChatGptBrowserWorker } = await import("./adapters/chatgpt-web/browser-worker");
    const { CHATGPT_WEB_MODEL_ID } = await import("./adapters/chatgpt-web/model");
    const config = loadConfig();
    if (config.browserHost !== "launcher" || config.browserInteractionMode !== "automatic") {
      throw new Error("Live prompt requires the automatic owned launcher surface");
    }
    const directory = mkdtempSync(join(tmpdir(), "codex-acceptance-prompt-"));
    const priorScreenshots = process.env.CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS;
    let worker: ReturnType<typeof ChatGptBrowserWorker.forProvider> | undefined;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      process.env.CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS = "0";
      const provider = providerConfig(config);
      provider.chatgptWeb = { ...provider.chatgptWeb, localToolsEnabled: false, autoApproveToolCalls: false, browserDiagnosticsPath: directory };
      worker = ChatGptBrowserWorker.forProvider(provider);
      const response = await worker.run({
        traceId: `acceptance_${randomUUID().replaceAll("-", "")}`,
        modelId: CHATGPT_WEB_MODEL_ID,
        reasoning: options.model === "pro" ? "max" : options.model === "extra-high" ? "xhigh" : "high",
        capabilities: { localToolsEnabled: false, ...capabilities, proModelVersion: config.proModelVersion },
        prepare: async () => ({ text: "Reply with exactly: CODEX WEB GPT READY", images: [], release: () => {} }),
        onSendActivated: activate, onTextDelta: () => {}, abortSignal: controller.signal,
      });
      return { markerMatched: response.trim() === "CODEX WEB GPT READY" };
    } finally {
      clearTimeout(timer);
      controller.abort();
      try { await worker?.close(); }
      finally {
        rmSync(directory, { recursive: true, force: true });
        if (priorScreenshots === undefined) delete process.env.CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS;
        else process.env.CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTICS = priorScreenshots;
      }
    }
  }),
};
