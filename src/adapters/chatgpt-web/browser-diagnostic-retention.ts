import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "../../config";
import { processRunning } from "../../process";

const ACTIVE_MARKER = ".active.json";
const DEFAULT_COMPLETED_TRACE_LIMIT = 50;

function completedTraceLimit(): number {
  const value = process.env.CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTIC_TRACE_LIMIT;
  if (value && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (parsed >= 1 && parsed <= 1_000) return parsed;
  }
  return DEFAULT_COMPLETED_TRACE_LIMIT;
}

function traceIsActive(directory: string): boolean {
  const marker = join(directory, ACTIVE_MARKER);
  try {
    if (!existsSync(marker) || statSync(marker).size > 256) return false;
    const owner = JSON.parse(readFileSync(marker, "utf8")) as { pid?: unknown };
    return typeof owner.pid === "number" && Number.isSafeInteger(owner.pid)
      && owner.pid > 0 && processRunning(owner.pid);
  } catch { return false; }
}

/** Helpers are separate processes: an in-memory active set cannot protect another turn's files. */
export function pruneBrowserDiagnostics(root: string, limit = completedTraceLimit()): void {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 1_000) {
    throw new RangeError("Browser diagnostic retention must be between 1 and 1000 completed traces");
  }
  const traces = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^[A-Za-z0-9_-]{6,160}$/.test(entry.name))
    .flatMap(entry => {
      const path = join(root, entry.name);
      try {
        return traceIsActive(path) ? [] : [{ path, modifiedAt: statSync(path).mtimeMs }];
      } catch { return []; } // Another helper may have just pruned its completed trace.
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  for (const trace of traces.slice(limit)) {
    // Recheck ownership because another process may have acquired this directory since listing.
    if (!traceIsActive(trace.path)) rmSync(trace.path, { recursive: true, force: true });
  }
}

export function retainBrowserDiagnosticTrace(root: string, directory: string): () => void {
  const marker = join(directory, ACTIVE_MARKER);
  const owner = `${JSON.stringify({ pid: process.pid })}\n`;
  if (!existsSync(directory)) {
    // Publish a fully owned directory in one rename. Other helpers must never see a newly
    // created trace without its active marker and prune it before the first checkpoint.
    const staging = mkdtempSync(join(root, ".initializing-"));
    try {
      atomicWriteFile(join(staging, ACTIVE_MARKER), owner);
      renameSync(staging, directory);
    } finally { rmSync(staging, { recursive: true, force: true }); }
  } else {
    atomicWriteFile(marker, owner);
  }
  try { pruneBrowserDiagnostics(root); } catch { /* Keep the active lease even if another trace is inaccessible. */ }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    rmSync(marker, { force: true });
    pruneBrowserDiagnostics(root);
  };
}
