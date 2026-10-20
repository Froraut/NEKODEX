import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, linkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const { collectSupportReport, buildSupportReport, writeSupportReport } = require("../launcher/electron/support-report.cjs");
const now = Date.parse("2026-10-18T00:00:00.000Z");

// Real saved-file boundary, including current-owner read failure and hostile
// fields in otherwise valid snapshots. No Electron/provider fixture is needed.
test("saved support report combines owners without conversation content or credentials", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-support-"));
  try {
    const logPath = join(directory, "launcher.jsonl");
    const destinationPath = join(directory, "report.json");
    const secret = "sk-abcdefghijklmnopqrstuvwxyz";
    const privateText = "PRIVATE_CHAT_PROMPT_AND_OUTPUT";
    const credentialPath = "/Users/private-owner/.credentials/private-key.json";
    writeFileSync(logPath, JSON.stringify({ at: new Date(now).toISOString(), level: "error", event: "launcher.renderer_gone",
      detail: { exitCode: 9, reason: "crashed", prompt: privateText, chatTitle: privateText, args: { key: secret },
        output: privateText, message: `${credentialPath} ${secret}`, nested: { content: privateText } } }) + "\n");
    let calls = 0;
    const report = await collectSupportReport({ now: () => now, sources: {
      app: { version: "6.1.32-nekodex.7", platform: "darwin", arch: "arm64", packaged: true, path: credentialPath },
      build: { commit: "f1016ab", releaseVersion: "6.1.32-nekodex.7", args: privateText },
      runtime: () => { calls++; return { value: { runtimeStatus: "ready", brokerReady: true }, observedAt: now - 1000 }; },
      route: { value: { active: true, routeMatches: false, configPath: credentialPath, profile: privateText,
        availability: { current: true, brokerReady: false }, issueCodes: ["route-mismatch", privateText] }, observedAt: now - 120_000 },
      accounts: [{ id: "real-account-123", label: privateText, authenticated: true, connectorReady: false }],
      tasks: [{ id: "real-task-123", traceId: "real-trace-123", accountId: "real-account-123", phase: "send-uncertain", submission: "uncertain", terminal: true,
        title: privateText, prompt: privateText, args: secret, output: privateText }, { id: "completed-task", phase: "completed", terminal: true }],
      logs: { filePath: logPath }, processMemory: { rss: 1234, heapUsed: 456, args: privateText, external: -1 },
      crashes: [{ at: now - 100, reason: "crashed", exitCode: 9, dumpPath: credentialPath }],
      toolCounters: { completed: 3, failed: 1, samples: 4, meanLatencyMs: 33.5, toolName: privateText, outputs: privateText },
      broker: () => { throw new Error(`${secret} ${credentialPath}`); },
    } });
    const receipt = writeSupportReport({ destinationPath, report, sourceLogPaths: [logPath] });
    const savedText = readFileSync(destinationPath, "utf8");
    const saved = JSON.parse(savedText);
    expect(receipt.committed).toBe(true);
    expect(receipt.bytes).toBe(Buffer.byteLength(savedText));
    expect(statSync(destinationPath).mode & 0o777).toBe(0o600);
    expect(calls).toBe(1);
    expect(saved.reportVersion).toBe(1);
    expect(saved.sections.runtime.freshness).toBe("current");
    expect(saved.sections.route.freshness).toBe("stale");
    expect(saved.sections.accounts.freshness).toBe("unknown");
    expect(saved.sections.broker).toMatchObject({ available: false, reason: "collection-failed" });
    expect(saved.sections.tasks.data).toMatchObject({ total: 2, unresolved: 1, tasks: [{ id: "task-1", accountId: "account-1", phase: "send-uncertain", submission: "uncertain" }] });
    expect(saved.sections.accounts.data.accounts[0].id).toBe("account-1");
    expect(saved.sections.processMemory.data).toEqual({ rss: 1234, heapUsed: 456 });
    expect(saved.sections.toolCounters.data.meanLatencyMs).toBe(33.5);
    expect(JSON.parse(saved.sections.logs.data.text).detail).toEqual({ exitCode: 9, reason: "crashed" });
    for (const forbidden of [secret, privateText, credentialPath, "real-account-123", "real-task-123", "real-trace-123", "completed-task"]) {
      expect(savedText).not.toContain(forbidden);
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 5000);

test("bounded structural logs preserve newest records and unsupported sources stay unknown", () => {
  const records = Array.from({ length: 80 }, (_, sequence) => ({ at: new Date(now).toISOString(), level: "info", event: "runtime.observed", detail: { sequence, result: "private output" } }));
  const report = buildSupportReport({ logs: { records }, app: {}, runtime: { value: { brokerReady: true }, observedAt: now + 1000 } }, { now, maxLogRecords: 4, maxLogBytes: 400 });
  const logs = report.sections.logs.data;
  expect(logs.truncated).toBe(true);
  expect(Buffer.byteLength(logs.text)).toBeLessThanOrEqual(400);
  expect(logs.recordCount).toBeGreaterThan(0);
  expect(JSON.parse(logs.text.trim().split("\n").at(-1)).detail.sequence).toBe(79);
  expect(logs.text).not.toContain("private output");
  expect(report.sections.app).toMatchObject({ available: false, reason: "no-supported-fields" });
  expect(report.sections.crashes).toMatchObject({ available: false, reason: "not-supplied" });
  expect(report.sections.runtime.freshness).toBe("unknown");
});

test("process memory preserves observed roles and byte totals without guessing partial totals", () => {
  const report = buildSupportReport({ processMemory: { rss: 500, processes: [
    { pid: 12, kind: "main", workingSetSize: 300, privateBytes: 200, title: "private chat title" },
    { pid: 13, kind: "chatgpt", workingSetSize: 700, args: "private tool args" },
    { pid: 14, kind: "PRIVATE_UNTRUSTED_ROLE", workingSetSize: 0 },
  ] } }, { now });
  const memory = report.sections.processMemory.data;
  expect(memory).toMatchObject({ rss: 500, unit: "bytes", processCount: 3, truncated: false,
    processes: [{ pid: 12, kind: "main", workingSetSize: 300, privateBytes: 200 }, { pid: 13, kind: "chatgpt", workingSetSize: 700 }, { pid: 14, kind: "other", workingSetSize: 0 }],
    total: { workingSetSize: 1000, privateBytes: null } });
  expect(JSON.stringify(memory)).not.toContain("private chat title");
  expect(JSON.stringify(memory)).not.toContain("private tool args");
  expect(JSON.stringify(memory)).not.toContain("PRIVATE_UNTRUSTED_ROLE");
});

test("report write rejects direct and hard-linked source log destinations", () => {
  const directory = mkdtempSync(join(tmpdir(), "nekodex-support-alias-"));
  try {
    const source = join(directory, "source.jsonl"), alias = join(directory, "alias.json");
    writeFileSync(source, "preserved source\n");
    linkSync(source, alias);
    const report = buildSupportReport({}, { now });
    for (const destinationPath of [source, alias]) {
      expect(() => writeSupportReport({ destinationPath, report, sourceLogPaths: [source] })).toThrow("Refusing to overwrite");
    }
    expect(readFileSync(source, "utf8")).toBe("preserved source\n");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
