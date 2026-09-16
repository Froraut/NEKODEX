import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { RequestId } from "@modelcontextprotocol/sdk/types.js";
import { performance } from "node:perf_hooks";

type Receipt = { call: number; tool: string; started: number };
export type McpTransportEvidence = {
  phase: "received" | "reply_sent" | "send_failed" | "uncorrelated" | "tracking_overflow" | "transport_closed";
  call: number;
  tool: string;
  processId?: number;
  reason?: "duplicate_id";
  pendingCount?: number;
  outcome?: "success" | "tool_error" | "protocol_error";
  code?: number;
  elapsedMs?: number;
};

/** Observe before SDK argument validation and after the actual transport write. No payload,
 * supplied identifier, schema traversal or arbitrary tool name enters these diagnostics. */
export function observeMcpTransport(
  transport: Transport,
  toolNames: ReadonlySet<string>,
  report: (event: McpTransportEvidence) => void = event => console.error(`[chatgpt-web-mcp] transport ${JSON.stringify(event)}`),
): Transport {
  // A null entry is an ambiguous in-flight ID. Do not attach either reply to a guessed call.
  const pending = new Map<RequestId, Receipt | null>();
  let nextCall = 0;
  let closed = false;
  const emit = (evidence: McpTransportEvidence) => {
    try { report({ ...evidence, processId: process.pid }); } catch { /* Diagnostics cannot fail a tool. */ }
  };
  const recordClose = () => {
    if (closed) return;
    closed = true;
    emit({ phase: "transport_closed", call: 0, tool: "transport", pendingCount: pending.size });
    pending.clear();
  };
  const observed: Transport = {
    async start() {
      transport.onmessage = (message, extra) => {
        if ("method" in message && message.method === "tools/call" && "id" in message) {
          const name = message.params?.name;
          const receipt = { call: ++nextCall, tool: typeof name === "string" && toolNames.has(name) ? name : "unrecognized", started: performance.now() };
          emit({ phase: "received", call: receipt.call, tool: receipt.tool });
          if (pending.has(message.id)) {
            const previous = pending.get(message.id);
            if (previous) emit({ phase: "uncorrelated", call: previous.call, tool: previous.tool, reason: "duplicate_id" });
            emit({ phase: "uncorrelated", call: receipt.call, tool: receipt.tool, reason: "duplicate_id" });
            pending.set(message.id, null);
          } else if (pending.size >= 512) {
            emit({ phase: "tracking_overflow", call: receipt.call, tool: receipt.tool, pendingCount: pending.size });
          } else {
            pending.set(message.id, receipt);
          }
        }
        observed.onmessage?.(message, extra);
      };
      transport.onclose = () => { recordClose(); observed.onclose?.(); };
      transport.onerror = error => observed.onerror?.(error);
      await transport.start();
    },
    async send(message, options) {
      const id = "id" in message && !("method" in message) ? message.id : undefined;
      const receipt = id !== undefined ? pending.get(id) : undefined;
      let correlated = false;
      try {
        await transport.send(message, options);
        correlated = !!receipt && id !== undefined && pending.get(id) === receipt;
      }
      catch (error) {
        if (receipt && id !== undefined && pending.get(id) === receipt) {
          emit({ phase: "send_failed", call: receipt.call, tool: receipt.tool, elapsedMs: performance.now() - receipt.started });
        }
        throw error;
      } finally {
        if (receipt && id !== undefined && pending.get(id) === receipt) pending.delete(id);
      }
      if (receipt && correlated) emit({ phase: "reply_sent", call: receipt.call, tool: receipt.tool,
        elapsedMs: performance.now() - receipt.started,
        outcome: "error" in message ? "protocol_error" : "result" in message && message.result.isError === true ? "tool_error" : "success",
        ...("error" in message && Number.isSafeInteger(message.error.code) ? { code: message.error.code } : {}),
      });
    },
    async close() { await transport.close(); recordClose(); },
    get sessionId() { return transport.sessionId; },
    setProtocolVersion: version => transport.setProtocolVersion?.(version),
  };
  return observed;
}
