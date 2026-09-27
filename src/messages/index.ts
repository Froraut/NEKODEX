import { randomUUID } from "node:crypto";
import type { AppConfig } from "../config";
import type { AdapterEvent } from "../types";
import type { ExternalClientContext } from "../external-client-context";
import { ClientTurns } from "../client-turns";
import { AsyncEventQueue } from "../event-queue";
import { readRequestBodyBytes } from "../http-body";
import { estimateTokens } from "../lib/token-estimate";
import { COMPACT_PROMPT } from "../responses/compaction";
import { translateClaudeMessages } from "./request";
import { anthropicError, buildClaudeMessage, streamClaudeMessage } from "./response";
import { compactClaudeEvents, compactClaudeStream } from "./compact";

async function readMessagesBody(req: Request): Promise<Json> {
  const request = new Request(req, { signal: AbortSignal.any([req.signal, AbortSignal.timeout(30_000)]) });
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(await readRequestBodyBytes(request, 4 * 1024 * 1024)));
}

type Json = Record<string, any>;
type Runner = (request: Request, config: AppConfig, options: {
  clientContext: ExternalClientContext;
  onAdapterEvent: (event: AdapterEvent) => void;
  onCompletedResponse: (response: Record<string, unknown>) => void;
}) => Promise<Response>;

/** The Messages transport owns client receipts; the existing adapter owns physical tool turns. */
export class ClaudeMessagesGateway {
  private readonly turns = new ClientTurns("claude");
  private readonly receipts = new Map<string, { session: string; agent: string; at: number }>();
  constructor(private readonly run: Runner) {}

  async countTokens(req: Request): Promise<Response> {
    try {
      const raw = await readMessagesBody(req);
      const translated = translateClaudeMessages(raw, this.sessionHeaders(raw, req.headers));
      return Response.json({ input_tokens: estimateTokens(JSON.stringify(translated.body), "chatgpt-web") },
        { headers: { "cache-control": "no-store", "x-nekodex-usage": "estimated" } });
    } catch { return anthropicError("Invalid token-count request"); }
  }

  private sessionHeaders(raw: Json, headers: Headers): Headers {
    const result = new Headers();
    const supplied = headers.get("x-claude-code-session-id");
    const agent = headers.get("x-claude-code-agent-id");
    if (supplied && supplied.length > 256 || agent && agent.length > 256) throw new Error("Claude session identity exceeds its limit");
    const latest = Array.isArray(raw.messages) ? raw.messages.at(-1) : null;
    const ids: string[] = latest?.role === "user" && Array.isArray(latest.content)
      ? latest.content.filter((part: Json) => part?.type === "tool_result" && typeof part.tool_use_id === "string").map((part: Json) => part.tool_use_id) : [];
    const sessions = new Set(ids.flatMap(id => {
      const receipt = this.receipts.get(id);
      return receipt ? [JSON.stringify([receipt.session, receipt.agent])] : [];
    }));
    if (sessions.size > 1) throw new Error("Tool results belong to different Claude sessions");
    const inferred = sessions.values().next().value;
    const owner: [string, string] | undefined = inferred ? JSON.parse(inferred) : undefined;
    if (owner && (supplied && supplied !== owner[0] || agent && agent !== owner[1])) throw new Error("Claude tool results changed session owner");
    result.set("x-claude-code-session-id", supplied || owner?.[0] || randomUUID());
    result.set("x-claude-code-agent-id", agent || owner?.[1] || "root");
    return result;
  }

  async respond(req: Request, config: AppConfig): Promise<Response> {
    let raw: Json, translated: ReturnType<typeof translateClaudeMessages>, prepared: ReturnType<ClientTurns["prepare"]>;
    let session: string, agent: string;
    try {
      if (config.browserInteractionMode === "manual") throw new Error("Claude Code requires automatic browser interaction");
      raw = await readMessagesBody(req);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Expected a Messages object");
      if (raw.stream !== undefined && typeof raw.stream !== "boolean") throw new Error("stream must be a boolean");
      if (raw.tools?.length && config.mode !== "full") throw new Error("Connect the local tools connector before using Claude functions");
      for (const [id, receipt] of this.receipts) if (Date.now() - receipt.at > 30 * 60_000) this.receipts.delete(id);
      const headers = this.sessionHeaders(raw, req.headers); session = headers.get("x-claude-code-session-id")!;
      agent = headers.get("x-claude-code-agent-id")!;
      translated = translateClaudeMessages(raw, headers);
      if (translated.compact) {
        delete translated.body.tools; delete translated.body.tool_choice;
        (translated.body.input as unknown[]).push({ type: "message", role: "user", content: COMPACT_PROMPT });
      }
      prepared = this.turns.prepare({ ...translated.body, stream: false, store: false });
    } catch (error) { return anthropicError(error instanceof Error ? error.message : "Invalid Messages request"); }

    const queue = new AsyncEventQueue<AdapterEvent>(10_000, 4 * 1024 * 1024, event => Buffer.byteLength(JSON.stringify(event)));
    const abort = new AbortController();
    const signal = AbortSignal.any([req.signal, abort.signal]);
    const settings = { ...config, useSavedChats: false, experimentalFreshConversationPerTurn: false };
    let outcome: Promise<void>;
    const cancel = async () => { abort.abort(new DOMException("Messages request cancelled", "AbortError")); queue.cancel(); await outcome; };
    const meta = { model: translated.requestedModel,
      inputTokens: estimateTokens(JSON.stringify(prepared.body.input) + String(prepared.body.instructions ?? ""), "chatgpt-web"),
      maxTokens: typeof raw.max_tokens === "number" ? raw.max_tokens : undefined };
    outcome = (async () => {
      try {
        const response = await this.run(new Request("http://127.0.0.1/v1/responses", {
          method: "POST", headers: { "content-type": "application/json" }, signal, body: JSON.stringify(prepared.body),
        }), settings, {
          clientContext: prepared.context,
          onAdapterEvent: event => queue.push(event),
          onCompletedResponse: value => {
            prepared.complete(value);
            if (value.status === "completed" && Array.isArray(value.output)) for (const item of value.output as Json[]) {
              if (item.type === "function_call" && typeof item.call_id === "string") {
                if (this.receipts.size >= 4096 && !this.receipts.has(item.call_id)) throw new Error("Claude tool receipt capacity reached");
                this.receipts.set(item.call_id, { session, agent, at: Date.now() });
              }
            }
          },
        });
        if (!response.ok) queue.push({ type: "error", message: "The Web model request was not accepted", status: response.status });
        // The canonical handler has already recorded the completed tool receipts.
        await response.body?.cancel().catch(() => {});
      } catch { queue.fail(new Error("The Web model request failed")); }
      finally { prepared.release(); queue.close(); }
    })();
    if (translated.stream) return new Response(streamClaudeMessage(
      translated.compact ? compactClaudeStream(queue, raw.messages) : queue, meta, cancel,
    ), { headers: { "content-type": "text/event-stream", "cache-control": "no-store", "x-accel-buffering": "no", "x-nekodex-usage": "estimated" } });
    try {
      const events: AdapterEvent[] = [];
      for await (const event of queue) events.push(event);
      await outcome;
      return buildClaudeMessage(translated.compact ? compactClaudeEvents(events, raw.messages) : events, meta);
    } catch { await cancel(); return anthropicError("The Web model request failed", 502, "api_error"); }
  }
}
