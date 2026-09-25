import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile } from "../../config";
import { processRunning } from "../../process";

const ACTIVE_MARKER = ".active.json";
const DEFAULT_COMPLETED_TRACE_LIMIT = 50;

/** Process creation identity is checked only when both the lease and the OS can supply it. */
function processStartIdentity(pid: number): string | undefined {
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      // The command name is parenthesized and may contain spaces or closing parentheses.
      const fields = stat.slice(stat.lastIndexOf(")") + 2).trim().split(/\s+/);
      const startTicks = fields[19]; // field 22, counting from state (field 3).
      if (/^\d+$/.test(startTicks ?? "")) {
        const bootId = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
        if (bootId) return `linux:${bootId}:${startTicks}`;
      }
    } catch { /* Fall back to ps or PID existence when procfs is unavailable. */ }
  }
  if (process.platform === "win32") return undefined;
  try {
    const result = spawnSync("ps", ["-p", String(pid), "-o", "lstart="], {
      encoding: "utf8", timeout: 500, maxBuffer: 1024,
    });
    const started = result.status === 0 ? result.stdout.trim().replace(/\s+/g, " ") : "";
    return started ? `ps:${started}` : undefined;
  } catch { return undefined; }
}

// A helper's own creation identity cannot change during its lifetime.
const SELF_PROCESS_START = processStartIdentity(process.pid);

function completedTraceLimit(): number {
  const value = process.env.CODEX_CHATGPT_WEB_BROWSER_DIAGNOSTIC_TRACE_LIMIT;
  if (value && /^\d+$/.test(value)) {
    const parsed = Number(value);
    if (parsed >= 1 && parsed <= 1_000) return parsed;
  }
  return DEFAULT_COMPLETED_TRACE_LIMIT;
}

function traceIsActive(
  directory: string,
  starts: Map<number, string | undefined>,
  confirmMismatch = false,
): boolean {
  const marker = join(directory, ACTIVE_MARKER);
  try {
    if (!existsSync(marker) || statSync(marker).size > 256) return false;
    const owner = JSON.parse(readFileSync(marker, "utf8")) as { pid?: unknown; processStart?: unknown };
    if (typeof owner.pid !== "number" || !Number.isSafeInteger(owner.pid)
      || owner.pid <= 0 || !processRunning(owner.pid)) return false;
    if (typeof owner.processStart !== "string") return true; // Existing PID-only leases.
    let currentStart = starts.get(owner.pid);
    if (!starts.has(owner.pid)) {
      currentStart = processStartIdentity(owner.pid);
      starts.set(owner.pid, currentStart);
    }
    const kind = owner.processStart.startsWith("linux:") ? "linux:"
      : owner.processStart.startsWith("ps:") ? "ps:" : undefined;
    if (confirmMismatch && kind && currentStart?.startsWith(kind)
      && currentStart !== owner.processStart) {
      // A PID may have been reused after the removal-phase cache was populated.
      currentStart = processStartIdentity(owner.pid);
      starts.set(owner.pid, currentStart);
    }
    // Missing or differently sourced identity cannot prove that another helper's trace is stale.
    return !kind || !currentStart?.startsWith(kind) || currentStart === owner.processStart;
  } catch { return false; }
}

/** Helpers are separate processes: an in-memory active set cannot protect another turn's files. */
export function pruneBrowserDiagnostics(root: string): void {
  const limit = completedTraceLimit();
  const starts = new Map<number, string | undefined>([[process.pid, SELF_PROCESS_START]]);
  const traces = readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && /^[A-Za-z0-9_-]{6,160}$/.test(entry.name))
    .flatMap(entry => {
      const path = join(root, entry.name);
      try {
        return traceIsActive(path, starts) ? [] : [{ path, modifiedAt: statSync(path).mtimeMs }];
      } catch { return []; } // Another helper may have just pruned its completed trace.
    })
    .sort((left, right) => right.modifiedAt - left.modifiedAt);
  // Reprobe other PIDs before deletion: a new owner could have acquired a trace since listing.
  const removalStarts = new Map<number, string | undefined>([[process.pid, SELF_PROCESS_START]]);
  for (const trace of traces.slice(limit)) {
    // Recheck ownership because another process may have acquired this directory since listing.
    if (!traceIsActive(trace.path, removalStarts, true)) rmSync(trace.path, { recursive: true, force: true });
  }
}

export function retainBrowserDiagnosticTrace(root: string, directory: string): () => void {
  const marker = join(directory, ACTIVE_MARKER);
  const owner = `${JSON.stringify({ pid: process.pid, processStart: SELF_PROCESS_START })}\n`;
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
    // A later helper may have taken over this directory; release only our own marker.
    try {
      if (readFileSync(marker, "utf8") === owner) rmSync(marker, { force: true });
    } catch { /* The marker was already removed by another owner. */ }
    pruneBrowserDiagnostics(root);
  };
}
