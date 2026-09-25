import {
  uuid, responsesUsage, adapterFailureFromEvent, plaintextCollaborationFields, resolveOutputToolCall,
  outputToolCallItemId, freeformToolInput, completedToolCallItem, type OutputItem, type OutputToolCallKind,
} from "./responses/output-policy";
export { buildResponseJSON } from "./responses/json-output";
import type { AdapterEvent, CodexMessagePhase } from "./types";
import { classifyError } from "./lib/errors";
import { encodeCompactionSummary } from "./responses/compaction";
import { resolveStallTimeoutSec } from "./stall-timeout";

function sseEvent(name: string, data: Record<string, unknown>): string {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

export function bridgeToResponsesSSE(
  events: AsyncIterable<AdapterEvent>,
  modelId: string,
  toolNsMap?: Map<string, { namespace: string; name: string }>,
  freeformToolNames?: Set<string>,
  toolSearchToolNames?: Set<string>,
  onCancel?: () => void,
  heartbeatMs = 2_000,
  options?: {
    stallTimeoutSec?: number;
    hideThinkingSummary?: boolean;
    /**
     * Remote compaction v2 turn: accumulate all assistant text and, on done, emit ONE synthetic
     * `{type:"compaction", encrypted_content:"ocx1:"+base64(text)}` output item before
     * response.completed — codex-rs collect_compaction_output requires exactly one.
     */
    compaction?: boolean;
    /** Called after a terminal adapter event has been translated into its Responses event. */
    onProcessedTerminalEvent?: (event: AdapterEvent) => void;
    /** Called only when the HTTP client cancels the stream before terminal delivery. */
    onClientCancel?: () => void;
    onCompletedResponse?: (response: Record<string, unknown>) => void;
  },
): ReadableStream<Uint8Array> {
  // Best-effort unwrap of a PARTIAL freeform arg buffer for live input streaming
  // (`response.custom_tool_call_input.delta` — codex-rs uses it for UI preview only;
  // the completed custom_tool_call item stays authoritative). Compact `{"input":"...`
  // buffers get their string value progressively unescaped; anything else streams raw.
  const FREEFORM_WRAP_PREFIX = '{"input":"';
  const freeformPartialInput = (args: string): string => {
    if (!args.startsWith(FREEFORM_WRAP_PREFIX)) return args;
    const body = args.slice(FREEFORM_WRAP_PREFIX.length);
    let out = "";
    for (let i = 0; i < body.length; i++) {
      const c = body[i];
      if (c === '"') break; // unescaped closing quote: value complete
      if (c === "\\") {
        const n = body[i + 1];
        if (n === undefined) break; // escape split across chunks: wait for more
        i++;
        if (n === "n") out += "\n";
        else if (n === "t") out += "\t";
        else if (n === "r") out += "\r";
        else if (n === "u") {
          const hex = body.slice(i + 1, i + 5);
          if (hex.length === 4 && /^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4; }
          else break; // incomplete \uXXXX: wait for more
        } else out += n; // \" \\ \/ etc.
      } else out += c;
    }
    return out;
  };
  const encoder = new TextEncoder();
  const responseId = `resp_${uuid()}`;
  let seq = 0;
  // Set once the client is gone (cancel) or an enqueue throws on a torn-down controller, so we
  // never enqueue again and never throw a second time inside start() — the RC2 double-throw that
  // otherwise surfaced as proxy-side stream noise on every client disconnect.
  let closed = false;
  let clientCancelled = false;
  // RC3 keep-alive: Codex's idle timer is timeout(idle_timeout, stream.next()) over an
  // eventsource_stream; ANY received event re-arms it, while an unknown type is ignored
  // (responses.rs `_ => Ok(None)`). We emit a real, parser-ignored `response.heartbeat` only during
  // upstream silence so a stalled routed provider never trips "idle timeout waiting for SSE".
  let beat: ReturnType<typeof setInterval> | undefined;
  let controller: ReadableStreamDefaultController<Uint8Array>;
  let emittedFrames = 0;
  let gated = false;
  let stepping = false;
  const emit = (name: string, data: Record<string, unknown>): boolean => {
        if (closed) return false;
        try {
          controller.enqueue(encoder.encode(sseEvent(name, { type: name, sequence_number: seq++, ...data })));
          emittedFrames++;
          return true;
        } catch {
          closed = true;
          return false;
        }
      };
      const emitDone = () => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
          emittedFrames++;
        } catch {
          closed = true;
        }
      };

      const createdAt = Math.floor(Date.now() / 1000);
      let outputIndex = 0;
      const finishedItems: OutputItem[] = [];

      const responseSnapshot = (status: string, output: OutputItem[], endTurn?: boolean) => ({
        id: responseId, object: "response", created_at: createdAt,
        status, model: modelId, output, usage: null,
        ...(endTurn !== undefined ? { end_turn: endTurn } : {}),
      });

      const heartbeatFrame = encoder.encode('event: response.heartbeat\ndata: {"type":"response.heartbeat"}\n\n');
      let stallWarned = false;
      let lastAdapterEventAt = performance.now();
      let lastAdapterEventType = "<none>";
      let adapterEventCount = 0;
      const streamStartedAt = lastAdapterEventAt;
      const stallSec = resolveStallTimeoutSec(options?.stallTimeoutSec);
      const stallTimeoutMs = stallSec * 1000;

      let currentMsg: { itemId: string; outputIndex: number; text: string; phase?: CodexMessagePhase } | null = null;
      let currentReasoning: { itemId: string; outputIndex: number; text: string } | null = null;
      // Full assistant text of a compaction turn (across message boundaries) — becomes the
      // synthetic compaction item's payload on done.
      let compactionText = "";
      let currentToolCall: { itemId: string; outputIndex: number; callId: string; name: string; args: string; namespace?: string; kind: OutputToolCallKind; inputEmitted?: string } | null = null;
      const closeCurrentMessage = () => {
        if (!currentMsg) return;
        // Finalize the text part (Responses protocol). Without these .done events Codex never
        // commits the content part and renders the message as truncated / cut off.
        emit("response.output_text.done", {
          item_id: currentMsg.itemId, output_index: currentMsg.outputIndex, content_index: 0, text: currentMsg.text,
        });
        emit("response.content_part.done", {
          item_id: currentMsg.itemId, output_index: currentMsg.outputIndex, content_index: 0,
          part: { type: "output_text", text: currentMsg.text, annotations: [] },
        });
        const item = {
          type: "message", id: currentMsg.itemId, status: "completed", role: "assistant",
          content: [{ type: "output_text", text: currentMsg.text, annotations: [] }],
          ...(currentMsg.phase ? { phase: currentMsg.phase } : {}),
        };
        emit("response.output_item.done", { output_index: currentMsg.outputIndex, item });
        finishedItems.push(item as OutputItem);
        outputIndex++;
        currentMsg = null;
      };

      const closeCurrentReasoning = () => {
        if (!currentReasoning) return;
        emit("response.reasoning_summary_text.done", {
          item_id: currentReasoning.itemId, output_index: currentReasoning.outputIndex, summary_index: 0, text: currentReasoning.text,
        });
        emit("response.reasoning_summary_part.done", {
          item_id: currentReasoning.itemId, output_index: currentReasoning.outputIndex, summary_index: 0,
          part: { type: "summary_text", text: currentReasoning.text },
        });
        const item = {
          type: "reasoning", id: currentReasoning.itemId,
          summary: [{ type: "summary_text", text: currentReasoning.text }],
        };
        emit("response.output_item.done", { output_index: currentReasoning.outputIndex, item });
        finishedItems.push(item as OutputItem);
        outputIndex++;
        currentReasoning = null;
      };

      const closeCurrentToolCall = () => {
        if (!currentToolCall) return;
        // Finalize streamed function-call arguments so Codex commits the call (incl. MCP / computer_use).
        // Empty arguments serialize as "{}", as in the completed item.
        if (currentToolCall.kind === "function") {
          emit("response.function_call_arguments.done", {
            item_id: currentToolCall.itemId, output_index: currentToolCall.outputIndex, arguments: currentToolCall.args || "{}",
          });
        }
        if (currentToolCall.kind === "freeform") {
          emit("response.custom_tool_call_input.done", {
            item_id: currentToolCall.itemId, output_index: currentToolCall.outputIndex,
            input: freeformToolInput(currentToolCall.args),
          });
        }
        const item = completedToolCallItem(
          currentToolCall.kind, currentToolCall.itemId, currentToolCall.callId,
          currentToolCall.name, currentToolCall.args, currentToolCall.namespace,
        );
        emit("response.output_item.done", { output_index: currentToolCall.outputIndex, item });
        finishedItems.push(item);
        outputIndex++;
        currentToolCall = null;
      };

      // Boundaries and terminal events close whichever output item is still open.
      const closeOpenItems = () => {
        closeCurrentMessage();
        closeCurrentReasoning();
        closeCurrentToolCall();
      };

      // RC1: guarantee the Responses stream always ends with exactly one terminal event. Set true
      // when a done/error/catch terminal is emitted; if the adapter generator returns without one
      // we synthesize response.completed below, so Codex never hits the parser's
      // "stream closed before response.completed" (responses.rs) -> ApiError::Stream.
      let terminated = false;
      const it = events[Symbol.asyncIterator]();
      let iteratorStarted = false;
      let iteratorReturned = false;
      let upstreamDone = false;
      const returnIterator = () => {
        if (iteratorReturned) return;
        iteratorReturned = true;
        const finishReturn = () => {
          try {
            void it.return?.()?.catch(() => {});
          } catch {
            /* synchronous iterator cleanup failure is also best-effort */
          }
        };
        // Async-generator return() before the first next() does not enter the generator, so its
        // finally blocks cannot cancel prepared upstream bodies. The cancel hook has already
        // aborted the turn; bootstrap one cleanup step, then close the iterator without awaiting it.
        if (!iteratorStarted) {
          iteratorStarted = true;
          try {
            void it.next().then(finishReturn, () => {}).catch(() => {});
          } catch {
            /* synchronous iterator start failure is also best-effort */
          }
          return;
        }
        finishReturn();
      };
      const step = async () => {
        if (stepping || closed) return;
        stepping = true;
        gated = false;
        const emittedAtStart = emittedFrames;
        try {
        while (!terminated && !closed && emittedFrames === emittedAtStart) {
          iteratorStarted = true;
          const next = await it.next();
          // Cancellation cannot revoke a value already handed to a pending queue waiter.
          // Recheck before processing it, including completion/continuation callbacks.
          if (closed || clientCancelled) break;
          if (next.done) { upstreamDone = true; break; }
          const event = next.value;
          let terminalEvent = false;
          lastAdapterEventAt = performance.now();
          lastAdapterEventType = event.type;
          adapterEventCount += 1;
          stallWarned = false;
          // Compaction turns emit ONLY the synthetic compaction item + response.completed. The
          // summary text is accumulated silently: emitting it as a normal assistant message would
          // duplicate the summary if this response is ever replayed via previous_response_id
          // expansion (rememberResponseState stores input + output). Codex ignores extra items but
          // its compaction UI renders nothing mid-turn, so nothing is lost visually.
          if (options?.compaction) {
            if (event.type === "text_delta") { compactionText += event.text; continue; }
            if (event.type !== "done" && event.type !== "error") continue;
          }
          switch (event.type) {
            case "assistant_boundary": {
              // A guarded continuation starts a fresh assistant output item while keeping the
              // intermediate, suspicious text in the same Responses turn.
              closeOpenItems();
              break;
            }
            case "text_delta": {
              if (currentReasoning) closeCurrentReasoning();
              if (currentToolCall) closeCurrentToolCall();
              if (currentMsg && currentMsg.phase !== event.phase) closeCurrentMessage();
              if (!currentMsg) {
                const itemId = `msg_${uuid()}`;
                const item = {
                  type: "message", id: itemId, status: "in_progress", role: "assistant",
                  content: [] as { type: string; text: string; annotations: never[] }[],
                  ...(event.phase ? { phase: event.phase } : {}),
                };
                emit("response.output_item.added", { output_index: outputIndex, item });
                emit("response.content_part.added", {
                  item_id: itemId, output_index: outputIndex, content_index: 0,
                  part: { type: "output_text", text: "", annotations: [] },
                });
                currentMsg = { itemId, outputIndex, text: "", ...(event.phase ? { phase: event.phase } : {}) };
              }
              currentMsg.text += event.text;
              emit("response.output_text.delta", {
                item_id: currentMsg.itemId, output_index: currentMsg.outputIndex,
                content_index: 0, delta: event.text,
              });
              break;
            }
            case "thinking_delta": {
              if (options?.hideThinkingSummary) break;
              if (currentMsg) closeCurrentMessage();
              if (currentToolCall) closeCurrentToolCall();
              if (!currentReasoning) {
                const itemId = `rs_${uuid()}`;
                const item = { type: "reasoning", id: itemId, summary: [] as { type: string; text: string }[] };
                emit("response.output_item.added", { output_index: outputIndex, item });
                emit("response.reasoning_summary_part.added", {
                  item_id: itemId, output_index: outputIndex, summary_index: 0,
                  part: { type: "summary_text", text: "" },
                });
                currentReasoning = { itemId, outputIndex, text: "" };
              }
              currentReasoning.text += event.thinking;
              emit("response.reasoning_summary_text.delta", {
                item_id: currentReasoning.itemId, output_index: currentReasoning.outputIndex,
                summary_index: 0, delta: event.thinking,
              });
              break;
            }
            case "tool_call_start": {
              closeOpenItems();
              const { name: realName, namespace: ns, kind } = resolveOutputToolCall(
                event.name, toolNsMap, freeformToolNames, toolSearchToolNames,
              );
              const itemId = outputToolCallItemId(kind);
              const item = kind === "tool_search"
                ? { type: "tool_search_call", id: itemId, call_id: event.id, execution: "client", arguments: {}, status: "in_progress" }
                : kind === "freeform"
                ? { type: "custom_tool_call", id: itemId, call_id: event.id, name: realName, input: "", status: "in_progress" }
                : {
                    type: "function_call", id: itemId, call_id: event.id, name: realName,
                    arguments: "", status: "in_progress", ...(ns ? { namespace: ns } : {}),
                    ...plaintextCollaborationFields(ns, realName),
                  };
              emit("response.output_item.added", { output_index: outputIndex, item });
              currentToolCall = { itemId, outputIndex, callId: event.id, name: realName, args: "", namespace: ns, kind };
              break;
            }
            case "tool_call_delta": {
              if (currentToolCall) {
                currentToolCall.args += event.arguments;
                if (currentToolCall.kind === "function") {
                  emit("response.function_call_arguments.delta", {
                    item_id: currentToolCall.itemId, output_index: currentToolCall.outputIndex,
                    delta: event.arguments,
                  });
                }
                if (currentToolCall.kind === "freeform") {
                  // Hold while the buffer is still an ambiguous prefix of the JSON wrapper,
                  // then stream only the unwrapped input suffix (never rewind on mode flips).
                  if (!FREEFORM_WRAP_PREFIX.startsWith(currentToolCall.args)) {
                    const full = freeformPartialInput(currentToolCall.args);
                    const emitted = currentToolCall.inputEmitted ?? "";
                    if (full.startsWith(emitted) && full.length > emitted.length) {
                      emit("response.custom_tool_call_input.delta", {
                        item_id: currentToolCall.itemId, output_index: currentToolCall.outputIndex,
                        delta: full.slice(emitted.length),
                      });
                      currentToolCall.inputEmitted = full;
                    }
                  }
                }
              }
              break;
            }
            case "tool_call_end": {
              closeCurrentToolCall();
              break;
            }
            case "done": {
              closeOpenItems();
              if (options?.compaction && event.stopReason !== "max_tokens" && event.stopReason !== "content_filter") {
                // Exactly one checkpoint after authoritative completion. A truncated or filtered
                // summary must never be advertised as replacement history.
                const item = {
                  type: "compaction", id: `cmp_${uuid()}`,
                  encrypted_content: encodeCompactionSummary(compactionText),
                };
                emit("response.output_item.done", { output_index: outputIndex, item });
                finishedItems.push(item as OutputItem);
                outputIndex++;
              }
              if (event.stopReason === "max_tokens" || event.stopReason === "content_filter") {
                // Upstream stopped before a normal completion. Surface as incomplete so the
                // client can distinguish a truncated/filtered turn from a finished one.
                const response = {
                  ...responseSnapshot("incomplete", finishedItems, event.endTurn),
                  usage: responsesUsage(event.usage),
                  incomplete_details: {
                    reason: event.stopReason === "max_tokens" ? "max_output_tokens" : "content_filter",
                  },
                };
                // Cache max-output partials so previous_response_id replay can continue them;
                // rememberResponseState rejects content-filtered incomplete responses.
                options?.onCompletedResponse?.(response);
                emit("response.incomplete", { response });
              } else {
                const response = { ...responseSnapshot("completed", finishedItems, event.endTurn), usage: responsesUsage(event.usage) };
                options?.onCompletedResponse?.(response);
                emit("response.completed", {
                  response,
                });
              }
              terminalEvent = true;
              break;
            }
            case "error": {
              closeOpenItems();
              const failure = adapterFailureFromEvent(event);
              const failureDelivered = emit("response.failed", {
                response: {
                  ...responseSnapshot("failed", finishedItems),
                  // Partial consumption from a mid-stream upstream failure: surfaced so the request
                  // log can record real tokens instead of usageStatus "unreported" with 0.
                  ...(event.usage ? { usage: responsesUsage(event.usage) } : {}),
                  error: failure.error,
                  last_error: failure.error,
                  ...(event.retryable !== undefined ? { retryable: event.retryable } : {}),
                },
              });
              if (failureDelivered) options?.onProcessedTerminalEvent?.(event);
              terminalEvent = true;
              break;
            }
          }
          if (terminalEvent) {
            onCancel?.();
            terminated = true;
            returnIterator();
            break;
          }
        }
      } catch (err) {
        if (!terminated) {
          emit("response.failed", {
            response: {
              ...responseSnapshot("failed", finishedItems),
              error: classifyError(500, "proxy_error", err instanceof Error ? err.message : String(err)),
              last_error: classifyError(500, "proxy_error", err instanceof Error ? err.message : String(err)),
            },
          });
          onCancel?.();
          terminated = true;
          returnIterator();
        }
      }

      if (!terminated && !upstreamDone) {
        gated = true;
        stepping = false;
        return;
      }
      if (beat) { clearInterval(beat); beat = undefined; }

      if (!terminated) {
        // The adapter generator ended without an explicit done/error event. Mark as incomplete
        // rather than completed so Codex can distinguish a clean finish from a truncated stream.
        closeOpenItems();
        emit("response.incomplete", {
          response: {
            ...responseSnapshot("incomplete", finishedItems),
            usage: responsesUsage(undefined),
            incomplete_details: { reason: "adapter_eof" },
          },
        });
        terminated = true;
      }

      emitDone();
      try {
        controller.close();
      } catch {
        /* already closed (e.g. client cancelled) */
      }
      closed = true;
      gated = true;
      stepping = false;
      };

      const startStream = () => {
        emit("response.created", { response: responseSnapshot("in_progress", []) });
        gated = true;
        beat = setInterval(() => {
          if (closed || gated) return;
          const checkedAt = performance.now();
          const silenceMs = checkedAt - lastAdapterEventAt;
          if (silenceMs >= stallTimeoutMs / 2 && !stallWarned) {
            // Halfway to cancelling the turn. A healthy adapter heartbeats far more often than
            // this, so reaching here at all means a keep-alive gap that should be found before it
            // costs a user their turn.
            stallWarned = true;
            console.warn(
              `[bridge] upstream silence halfway to the stall budget model=${modelId}`
              + ` response=${responseId} stallSec=${stallSec} adapterEvents=${adapterEventCount}`
              + ` lastEvent=${lastAdapterEventType} sinceLastEventMs=${silenceMs}`,
            );
          }
          if (silenceMs >= stallTimeoutMs) {
            console.error(
              `[bridge] upstream_stall_timeout model=${modelId} response=${responseId}`
              + ` stallSec=${stallSec} adapterEvents=${adapterEventCount}`
              + ` lastEvent=${lastAdapterEventType} sinceLastEventMs=${silenceMs}`
              + ` sinceStreamStartMs=${checkedAt - streamStartedAt}`
              + ` iteratorStarted=${iteratorStarted} upstreamDone=${upstreamDone} emittedFrames=${emittedFrames}`,
            );
            closeOpenItems();
            emit("response.incomplete", {
              response: {
                ...responseSnapshot("incomplete", finishedItems),
                incomplete_details: { reason: "upstream_stall_timeout" },
              },
            });
            onCancel?.();
            terminated = true;
            returnIterator();
            emitDone();
            if (beat) clearInterval(beat);
            beat = undefined;
            try { controller.close(); } catch { /* already closed */ }
            closed = true;
            return;
          }
          try {
            controller.enqueue(heartbeatFrame);
            emittedFrames++;
          } catch {
            closed = true;
          }
        }, heartbeatMs);
      };

      const waitForCapacity = async () => {
        while (!closed && (controller.desiredSize ?? 1) <= 0) {
          await new Promise<void>(resolve => setTimeout(resolve, 5));
        }
      };

      const pump = async () => {
        while (!closed) {
          await waitForCapacity();
          if (closed) return;
          await step();
        }
      };

  const cancelStream = () => {
    // Client (Codex) disconnected. Stop emitting and let the caller abort the upstream fetch so a
    // cancelled turn does not leak the upstream stream or keep draining tokens (RC2).
    clientCancelled = true;
    closed = true;
    if (beat) clearInterval(beat);
    onCancel?.();
    options?.onClientCancel?.();
    returnIterator();
  };

  if (process.platform === "win32") {
    // Returning a Promise from a ReadableStream pull() served by Bun on Windows hits Bun#32111's
    // native teardown crash. Keep only Windows push-driven and retain HWM backpressure by polling
    // desiredSize; Darwin/Linux use the native pull contract below.
    return new ReadableStream<Uint8Array>({
      start(streamController) {
        controller = streamController;
        startStream();
        void pump().catch(error => {
          if (closed) return;
          closed = true;
          if (beat) clearInterval(beat);
          onCancel?.();
          returnIterator();
          try { controller.error(error); } catch { /* already closed */ }
        });
      },
      cancel: cancelStream,
    });
  }

  return new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      startStream();
    },
    pull() {
      return step();
    },
    cancel: cancelStream,
  });
}

export function formatErrorResponse(status: number, type: string, message: string): Response {
  return new Response(JSON.stringify({ error: classifyError(status, type, message) }), {
    status, headers: { "Content-Type": "application/json" },
  });
}
