import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { RequestId } from "@modelcontextprotocol/sdk/types.js";

type Receipt = { call: number; tool: string; started: number };
export type McpTransportEvidence = {
  phase: "received" | "reply_sent" | "send_failed";
  call: number;
  tool: string;
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
  const pending = new Map<RequestId, Receipt>();
  let nextCall = 0;
  const emit = (evidence: McpTransportEvidence) => { try { report(evidence); } catch { /* Diagnostics cannot fail a tool. */ } };
  const observed: Transport = {
    async start() {
      transport.onmessage = (message, extra) => {
        if ("method" in message && message.method === "tools/call" && "id" in message) {
          const name = message.params?.name;
          const receipt = { call: ++nextCall, tool: typeof name === "string" && toolNames.has(name) ? name : "unrecognized", started: Date.now() };
          if (pending.size >= 512) pending.delete(pending.keys().next().value!);
          pending.set(message.id, receipt);
          emit({ phase: "received", call: receipt.call, tool: receipt.tool });
        }
        observed.onmessage?.(message, extra);
      };
      transport.onclose = () => { pending.clear(); observed.onclose?.(); };
      transport.onerror = error => observed.onerror?.(error);
      await transport.start();
    },
    async send(message, options) {
      const id = "id" in message && !("method" in message) ? message.id : undefined;
      const receipt = id !== undefined ? pending.get(id) : undefined;
      try { await transport.send(message, options); }
      catch (error) {
        if (receipt) emit({ phase: "send_failed", call: receipt.call, tool: receipt.tool, elapsedMs: Date.now() - receipt.started });
        throw error;
      } finally {
        if (receipt && id !== undefined) pending.delete(id);
      }
      if (receipt) emit({ phase: "reply_sent", call: receipt.call, tool: receipt.tool,
        elapsedMs: Date.now() - receipt.started,
        outcome: "error" in message ? "protocol_error" : "result" in message && message.result.isError === true ? "tool_error" : "success",
        ...("error" in message && Number.isSafeInteger(message.error.code) ? { code: message.error.code } : {}),
      });
    },
    close: () => transport.close(),
    get sessionId() { return transport.sessionId; },
    setProtocolVersion: version => transport.setProtocolVersion?.(version),
  };
  return observed;
}
