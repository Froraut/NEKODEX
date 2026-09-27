import { randomUUID } from "node:crypto";
import type { AdapterEvent, CodexUsage } from "../types";
import { boundedChatText, chatOutputTokens } from "../chat-completions/contract";

export interface ClaudeResponseMeta { model: string; inputTokens: number; maxTokens?: number }
type Block = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> };
type Frame = { event: string; data: Record<string, unknown> };
const MISSING_TERMINAL = "The Web response ended without confirmed completion";

export function anthropicError(message: string, status = 400, type = "invalid_request_error"): Response {
  return Response.json({ type: "error", error: { type, message }, request_id: randomUUID() },
    { status, headers: { "cache-control": "no-store" } });
}

/** Text is streamed; executable tool arguments are published only after complete JSON validation. */
class ClaudeMessage {
  readonly id = `msg_${randomUUID().replaceAll("-", "")}`;
  readonly content: Block[] = [];
  terminal = false;
  reason = "end_turn";
  usage?: CodexUsage;
  private bytes = 0;
  private text = "";
  private limited = false;
  private textIndex: number | undefined;
  private phase?: string;
  private tool?: { id: string; name: string; json: string };
  constructor(readonly meta: ClaudeResponseMeta) {}
  start(): Frame {
    return { event: "message_start", data: { type: "message_start", message: { id: this.id, type: "message",
      role: "assistant", model: this.meta.model, content: [], stop_reason: null, stop_sequence: null,
      usage: { input_tokens: this.meta.inputTokens, output_tokens: 0 } } } };
  }
  private closeText(frames: Frame[]) {
    if (this.textIndex === undefined) return;
    frames.push({ event: "content_block_stop", data: { type: "content_block_stop", index: this.textIndex } });
    this.textIndex = undefined; this.phase = undefined;
  }
  accept(event: AdapterEvent): Frame[] {
    if (this.terminal) throw new Error("Events arrived after response completion");
    const frames: Frame[] = [];
    this.bytes += Buffer.byteLength(JSON.stringify(event));
    if (this.bytes > 4 * 1024 * 1024) throw new Error("Web response exceeded its byte limit");
    if (event.type === "text_delta") {
      if (this.tool) throw new Error("Text arrived inside unfinished tool arguments");
      const candidate = this.text + event.text;
      const limit = this.meta.maxTokens ?? 65536;
      // Ordinary-token count cannot exceed UTF-8 byte count. Most responses need
      // no repeated tokenization; approach the actual budget only when necessary.
      const allowed = Buffer.byteLength(candidate) <= limit ? candidate : boundedChatText(candidate, limit, this.text);
      const delta = allowed.slice(this.text.length);
      this.limited ||= delta.length < event.text.length;
      this.text = allowed;
      if (!delta) return frames;
      if (this.textIndex !== undefined && this.phase !== event.phase) this.closeText(frames);
      if (this.textIndex === undefined) {
        this.textIndex = this.content.length; this.phase = event.phase;
        this.content.push({ type: "text", text: "" });
        frames.push({ event: "content_block_start", data: { type: "content_block_start", index: this.textIndex,
          content_block: { type: "text", text: "" } } });
      }
      (this.content[this.textIndex] as { type: "text"; text: string }).text += delta;
      frames.push({ event: "content_block_delta", data: { type: "content_block_delta", index: this.textIndex,
        delta: { type: "text_delta", text: delta } } });
    } else if (event.type === "tool_call_start") {
      if (this.tool) throw new Error("Tool argument blocks overlap");
      this.closeText(frames); this.tool = { id: event.id, name: event.name, json: "" };
    } else if (event.type === "tool_call_delta") {
      if (!this.tool) throw new Error("Tool arguments have no owning call");
      this.tool.json += event.arguments;
    } else if (event.type === "tool_call_end") {
      if (!this.tool) throw new Error("Tool completion has no owning call");
      const input = JSON.parse(this.tool.json || "{}");
      if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Tool arguments must be an object");
      const block: Block = { type: "tool_use", id: this.tool.id, name: this.tool.name, input };
      if (chatOutputTokens(JSON.stringify([...this.content, block])) > (this.meta.maxTokens ?? 65536)) {
        throw new Error("Tool arguments exceed the requested output limit");
      }
      const index = this.content.length; this.content.push(block);
      frames.push({ event: "content_block_start", data: { type: "content_block_start", index,
        content_block: { type: "tool_use", id: block.id, name: block.name, input: {} } } },
      { event: "content_block_delta", data: { type: "content_block_delta", index, delta: { type: "input_json_delta", partial_json: JSON.stringify(input) } } },
      { event: "content_block_stop", data: { type: "content_block_stop", index } });
      this.tool = undefined;
    } else if (event.type === "assistant_boundary") this.closeText(frames);
    else if (event.type === "done") {
      if (this.tool) throw new Error("Web response ended during tool arguments");
      this.closeText(frames); this.terminal = true; this.usage = event.usage;
      this.reason = this.limited || ["max_tokens", "max_output_tokens", "length"].includes(event.stopReason ?? "") ? "max_tokens"
        : event.stopReason === "tool_use" || event.endTurn === false && this.content.some(block => block.type === "tool_use") ? "tool_use" : "end_turn";
      frames.push({ event: "message_delta", data: { type: "message_delta", delta: { stop_reason: this.reason, stop_sequence: null },
        usage: { output_tokens: this.outputTokens() } } });
    } else if (event.type === "error") throw Object.assign(new Error(event.message), { status: event.status });
    // Web reasoning summaries have no Anthropic signature. Keep the stream live;
    // never manufacture a signed thinking block or redacted provider payload.
    else if (event.type === "heartbeat" || event.type === "thinking_delta") frames.push({ event: "ping", data: { type: "ping" } });
    return frames;
  }
  outputTokens() { return this.usage?.outputTokens ?? chatOutputTokens(JSON.stringify(this.content)); }
  result() {
    if (!this.terminal) throw new Error(MISSING_TERMINAL);
    return { id: this.id, type: "message", role: "assistant", model: this.meta.model, content: this.content,
      stop_reason: this.reason, stop_sequence: null,
      usage: { input_tokens: this.usage?.inputTokens ?? this.meta.inputTokens, output_tokens: this.outputTokens() } };
  }
}

export function buildClaudeMessage(events: AdapterEvent[], meta: ClaudeResponseMeta): Response {
  try {
    const message = new ClaudeMessage(meta);
    for (const event of events) message.accept(event);
    return Response.json(message.result(), { headers: { "cache-control": "no-store", "x-nekodex-usage": "estimated" } });
  } catch { return anthropicError("The Web response did not satisfy the Messages contract", 502, "api_error"); }
}

export function streamClaudeMessage(events: AsyncIterable<AdapterEvent>, meta: ClaudeResponseMeta,
  onCancel: () => Promise<void>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder(); let cancelled = false;
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = ({ event, data }: Frame) => {
        if (cancelled) return;
        const bytes = encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        if ((controller.desiredSize ?? 0) < bytes.byteLength) throw new Error("Messages consumer stopped reading");
        controller.enqueue(bytes);
      };
      const message = new ClaudeMessage(meta);
      try {
        send(message.start());
        for await (const event of events) for (const frame of message.accept(event)) send(frame);
        message.result();
        send({ event: "message_stop", data: { type: "message_stop" } });
      } catch {
        if (!cancelled) {
          try { send({ event: "error", data: { type: "error", error: { type: "api_error", message: "The Web response did not complete successfully" } } }); } catch {}
        }
        await onCancel();
      } finally { if (!cancelled) controller.close(); }
    },
    async cancel() { cancelled = true; await onCancel(); },
  }, new ByteLengthQueuingStrategy({ highWaterMark: 4 * 1024 * 1024 }));
}
