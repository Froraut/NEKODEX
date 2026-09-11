import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pruneBrowserDiagnostics, retainBrowserDiagnosticTrace } from "../src/adapters/chatgpt-web/browser-diagnostic-retention";

function trace(root: string, name: string, age: number): string {
  const directory = join(root, name);
  mkdirSync(directory);
  writeFileSync(join(directory, "checkpoint.json"), '{"checkpoint":"synthetic"}\n');
  utimesSync(directory, age, age);
  return directory;
}

test("diagnostic pruning preserves old active traces independently of completed retention", () => {
  const root = mkdtempSync(join(tmpdir(), "diagnostic-retention-"));
  try {
    const active = trace(root, "active-turn", 1);
    const release = retainBrowserDiagnosticTrace(root, active);
    utimesSync(active, 1, 1);
    trace(root, "finished-old", 2);
    const newest = trace(root, "finished-new", 3);
    pruneBrowserDiagnostics(root, 1);
    expect(existsSync(active)).toBe(true);
    expect(existsSync(join(active, "checkpoint.json"))).toBe(true);
    expect(existsSync(newest)).toBe(true);
    expect(existsSync(join(root, "finished-old"))).toBe(false);
    release();
    release();
    expect(existsSync(join(active, ".active.json"))).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("active markers from another live helper are protected and crashed helpers become eligible", async () => {
  const root = mkdtempSync(join(tmpdir(), "diagnostic-owner-"));
  const child = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], { stdout: "ignore", stderr: "ignore" });
  try {
    const active = trace(root, "child-active", 1);
    writeFileSync(join(active, ".active.json"), JSON.stringify({ pid: child.pid }));
    utimesSync(active, 1, 1);
    trace(root, "finished-new", 2);
    pruneBrowserDiagnostics(root, 1);
    expect(existsSync(active)).toBe(true);
    child.kill();
    await child.exited;
    pruneBrowserDiagnostics(root, 1);
    expect(existsSync(active)).toBe(false);
  } finally {
    child.kill();
    await child.exited;
    rmSync(root, { recursive: true, force: true });
  }
});

test("completed diagnostics support a bounded environment retention count", () => {
  const root = mkdtempSync(join(tmpdir(), "diagnostic-limit-"));
  const prior = process.env.CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTIC_TRACE_LIMIT;
  try {
    process.env.CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTIC_TRACE_LIMIT = "2";
    for (let index = 1; index <= 5; index++) trace(root, `trace-${index}`, index);
    pruneBrowserDiagnostics(root);
    expect(readdirSync(root).sort()).toEqual(["trace-4", "trace-5"]);
  } finally {
    if (prior === undefined) delete process.env.CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTIC_TRACE_LIMIT;
    else process.env.CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTIC_TRACE_LIMIT = prior;
    rmSync(root, { recursive: true, force: true });
  }
});
