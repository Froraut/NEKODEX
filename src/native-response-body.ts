import { enqueueNativeUsageTelemetry } from "./native-usage-telemetry";
import { createNativeTerminalInspector } from "./native-terminal-inspector";
import type { NativeUsageFailureCategory, NativeUsageOutcome } from "./usage/native-contract";

type NativeTelemetrySink = typeof enqueueNativeUsageTelemetry;
const SSE_TERMINATOR = "data: [DONE]";

export function failureCategoryForHttp(status: number): NativeUsageFailureCategory | null {
  if (status === 401 || status === 403) return "http-auth";
  if (status === 429) return "http-rate-limit";
  if (status >= 500) return "http-server";
  if (status >= 300) return "http-client";
  return null;
}


export function observeNativeResponseBody(
  body: ReadableStream<Uint8Array>,
  options: {
    endpoint: "responses" | "responses/compact";
    requestedModelId: string | null;
    startedAt: string;
    startedAtMs: number;
    httpStatus: number;
    eventStream: boolean;
    signal: AbortSignal;
  },
  report: NativeTelemetrySink = enqueueNativeUsageTelemetry,
): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  const inspector = createNativeTerminalInspector(options.eventStream);
  let finalized = false;
  let inspectionDisabled = false;
  const finalize = (
    outcome: NativeUsageOutcome,
    category: NativeUsageFailureCategory | null,
  ): void => {
    if (finalized) return;
    finalized = true;
    const observation = inspectionDisabled ? undefined : inspector.terminal;
    try {
      report({
        endpoint: options.endpoint,
        requestedModelId: options.requestedModelId,
        reportedModelId: observation?.reportedModelId ?? null,
        startedAt: options.startedAt,
        durationMs: Math.max(0, Math.round(Date.now() - options.startedAtMs)),
        outcome,
        httpStatus: options.httpStatus,
        failureCategory: category,
        usageStatus: observation?.usage ? "reported" : "unreported",
        usage: observation?.usage ?? null,
      });
    } catch {
      // Telemetry reporting is isolated from native byte delivery.
    }
  };

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      let terminal = inspectionDisabled ? undefined : inspector.terminal;
      let chunk: Awaited<ReturnType<typeof reader.read>>;
      try {
        chunk = await reader.read();
      } catch (error) {
        if (terminal) finalize(terminal.outcome, terminal.failureCategory);
        else {
          const aborted = options.signal.aborted
            || (error instanceof DOMException && error.name === "AbortError");
          finalize(aborted ? "aborted" : "failed", aborted ? "aborted" : "stream");
        }
        controller.error(error);
        return;
      }
      if (chunk.done) {
        if (!inspectionDisabled) {
          try { inspector.finish(); terminal = inspector.terminal; }
          catch { terminal = undefined; inspectionDisabled = true; }
        }
        const httpFailure = failureCategoryForHttp(options.httpStatus);
        const outcome = terminal?.outcome ?? (httpFailure ? "failed"
          : options.eventStream || inspectionDisabled ? "incomplete" : "completed");
        // A terminal's explicit null means success/incompletion without a protocol failure.
        finalize(outcome, terminal ? terminal.failureCategory : httpFailure
          ?? ((options.eventStream || inspectionDisabled) ? "protocol" : null));
        controller.close();
        return;
      }
      if (!inspectionDisabled) {
        try {
          inspector.push(chunk.value);
        } catch {
          // Disable authority from a broken inspector while forwarding this and all later bytes.
          terminal = undefined;
          inspectionDisabled = true;
        }
      }
      controller.enqueue(chunk.value);
    },
    async cancel(reason) {
      const terminal = inspectionDisabled ? undefined : inspector.terminal;
      if (terminal) finalize(terminal.outcome, terminal.failureCategory);
      else finalize("aborted", "aborted");
      await reader.cancel(reason);
    },
  });
}

/**
 * ChatGPT's backend routinely resets the native Codex connection instead of closing it cleanly,
 * which Bun surfaces as ECONNRESET while reading the body. Passed through untouched that reaches
 * Codex as a truncated HTTP body and the opaque "error decoding response body".
 *
 * A reset that arrives after the stream already delivered `data: [DONE]` is an unclean TCP close on
 * a turn that finished: every byte the protocol defines has been forwarded, so the stream is closed
 * normally rather than failed. A reset before that genuinely truncated the turn and is still raised,
 * because inventing a terminal event there would tell Codex a turn ended when it did not.
 */
export function withUncleanCloseTolerance(
  body: ReadableStream<Uint8Array>,
  isEventStream: boolean,
  onUncleanClose?: (bytes: number) => void,
): ReadableStream<Uint8Array> {
  if (!isEventStream) return body;
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let lineBuffer = "";
  let completed = false;
  let oversizedLine = false;
  let bytes = 0;
  const inspectLines = (text: string): void => {
    if (completed) return;
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf("\n", offset);
      const end = newline < 0 ? text.length : newline;
      if (!oversizedLine) {
        if (lineBuffer.length + end - offset > SSE_TERMINATOR.length + 1) {
          lineBuffer = "";
          oversizedLine = true;
        } else lineBuffer += text.slice(offset, end);
      }
      if (newline < 0) break;
      if (!oversizedLine && lineBuffer.replace(/\r$/, "") === SSE_TERMINATOR) completed = true;
      lineBuffer = "";
      oversizedLine = false;
      offset = newline + 1;
      if (completed) break;
    }
  };
  const inspectTrailingLine = (): void => {
    // A reset can arrive before the final line separator. Treat only an exact unterminated
    // terminator line as complete; text embedded in a JSON data payload must not qualify.
    if (lineBuffer.replace(/\r$/, "") === SSE_TERMINATOR) completed = true;
  };
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const chunk = await reader.read();
        if (chunk.done) {
          inspectLines(decoder.decode());
          inspectTrailingLine();
          controller.close();
          return;
        }
        bytes += chunk.value.byteLength;
        inspectLines(decoder.decode(chunk.value, { stream: true }));
        controller.enqueue(chunk.value);
      } catch (error) {
        inspectTrailingLine();
        if (!completed) {
          controller.error(error);
          return;
        }
        try { onUncleanClose?.(bytes); }
        catch { /* Diagnostics must not prevent delivery of the completed stream. */ }
        controller.close();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
