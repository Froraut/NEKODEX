import { appendFileSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Durable broker lifecycle evidence. The production daemon runs with stdio ignored, so console
 * lines from the broker never reach a log. Events carry identifiers, counts and tool names only;
 * never prompt text, tool arguments or tool results.
 */
export type TurnBrokerEventName =
  | "broker_registered"
  | "broker_promoted"
  | "broker_retired"
  | "broker_lease_expired"
  | "broker_operation_cancelled"
  | "broker_queued_call_cancelled"
  | "broker_tool_results_rejected";

export type TurnBrokerEventFields = Record<string, string | number | boolean | null | undefined>;

const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_ROTATIONS = 2;
const MAX_FIELD_CHARS = 200;

interface SinkOptions { path: string; maxBytes: number; rotations: number }

let sink: SinkOptions | undefined;
let sinkBytes: number | undefined;
let warned = false;

/** Enable (or disable with undefined) the size-rotated JSONL sink for this process. */
export function configureTurnBrokerEventLog(
  path: string | undefined,
  options: { maxBytes?: number; rotations?: number } = {},
): void {
  sink = path ? {
    path,
    maxBytes: Math.max(4_096, options.maxBytes ?? DEFAULT_MAX_BYTES),
    rotations: Math.max(1, Math.min(9, options.rotations ?? DEFAULT_ROTATIONS)),
  } : undefined;
  sinkBytes = undefined;
  warned = false;
}

function sanitized(fields: TurnBrokerEventFields): Record<string, string | number | boolean | null> {
  const output: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    output[key] = typeof value === "string" && value.length > MAX_FIELD_CHARS
      ? `${value.slice(0, MAX_FIELD_CHARS - 1)}…`
      : value;
  }
  return output;
}

function rotate(options: SinkOptions): void {
  for (let index = options.rotations; index >= 1; index -= 1) {
    const source = index === 1 ? options.path : `${options.path}.${index - 1}`;
    const target = `${options.path}.${index}`;
    try {
      if (index === options.rotations) rmSync(target, { force: true });
      renameSync(source, target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  sinkBytes = 0;
}

/** Record one event. Diagnostics never fail the broker operation that produced them. */
export function recordTurnBrokerEvent(event: TurnBrokerEventName, fields: TurnBrokerEventFields = {}): void {
  const options = sink;
  if (!options) return;
  try {
    const line = `${JSON.stringify({ at: new Date().toISOString(), event, pid: process.pid, ...sanitized(fields) })}\n`;
    const bytes = Buffer.byteLength(line, "utf8");
    if (sinkBytes === undefined) {
      mkdirSync(dirname(options.path), { recursive: true, mode: 0o700 });
      try { sinkBytes = statSync(options.path).size; } catch { sinkBytes = 0; }
    }
    if (sinkBytes + bytes > options.maxBytes) rotate(options);
    appendFileSync(options.path, line, { encoding: "utf8", mode: 0o600 });
    sinkBytes = (sinkBytes ?? 0) + bytes;
  } catch (error) {
    sinkBytes = undefined;
    if (!warned) {
      warned = true;
      console.error(`[chatgpt-web] turn broker event log is unavailable: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
