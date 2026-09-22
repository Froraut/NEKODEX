import { enqueueNativeUsageTelemetry } from "./native-usage-telemetry";
import { safeNativeModelId, validNativeReportedUsage,
  type NativeReportedUsage, type NativeUsageFailureCategory, type NativeUsageOutcome,
} from "./usage/native-contract";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Terminator every Responses SSE stream ends with; nothing after it carries meaning. */
const SSE_TERMINATOR = "data: [DONE]";
const MAX_TELEMETRY_SSE_FRAME_BYTES = 64 * 1024;
const MAX_TELEMETRY_JSON_BYTES = 256 * 1024;

interface NativeTerminalObservation {
  outcome: NativeUsageOutcome;
  reportedModelId: string | null;
  usage: NativeReportedUsage | null;
  failureCategory: NativeUsageFailureCategory | null;
}

function nativeReportedUsage(value: unknown): NativeReportedUsage | null {
  if (!isObject(value)) return null;
  const inputDetails = isObject(value.input_tokens_details) ? value.input_tokens_details : undefined;
  const outputDetails = isObject(value.output_tokens_details) ? value.output_tokens_details : undefined;
  const usage = {
    inputTokens: value.input_tokens,
    outputTokens: value.output_tokens,
    totalTokens: value.total_tokens,
    ...(inputDetails?.cached_tokens === undefined ? {} : { cachedInputTokens: inputDetails.cached_tokens }),
    ...(outputDetails?.reasoning_tokens === undefined ? {} : { reasoningOutputTokens: outputDetails.reasoning_tokens }),
  };
  return validNativeReportedUsage(usage) ? usage : null;
}

export function failureCategoryForHttp(status: number): NativeUsageFailureCategory | null {
  if (status === 401 || status === 403) return "http-auth";
  if (status === 429) return "http-rate-limit";
  if (status >= 500) return "http-server";
  if (status >= 300) return "http-client";
  return null;
}

function observeNativeTerminal(
  value: unknown,
  eventName?: string,
  standaloneJson = false,
): NativeTerminalObservation | undefined {
  if (!isObject(value)) return undefined;
  const response = isObject(value.response) ? value.response : value;
  const type = typeof value.type === "string" ? value.type : eventName;
  const rawStatus = typeof response.status === "string" ? response.status : undefined;
  const eventOutcome = type === "response.completed"
    ? "completed"
    : type === "response.incomplete"
      ? "incomplete"
      : type === "response.failed" || type === "error"
        ? "failed"
        : undefined;
  const outcome = eventOutcome ?? (standaloneJson
    ? rawStatus === "completed" ? "completed"
      : rawStatus === "incomplete" || rawStatus === "queued" || rawStatus === "in_progress" ? "incomplete"
        : rawStatus === "failed" ? "failed" : undefined
    : undefined);
  if (!outcome) return undefined;
  return {
    outcome,
    reportedModelId: safeNativeModelId(response.model),
    usage: nativeReportedUsage(response.usage),
    failureCategory: outcome === "failed" ? "protocol" : null,
  };
}

type NativeTelemetrySink = typeof enqueueNativeUsageTelemetry;

/** Bounded terminal interpretation has no delivery or stream lifecycle authority. */
function createTerminalInspector(eventStream: boolean) {
  const decoder = new TextDecoder();
  let terminal: NativeTerminalObservation | undefined;
  let lineBuffer = "";
  let lineCharacterCount = 0;
  let lineIsSingleCarriageReturn = false;
  let frameEvent: string | undefined;
  let frameData = "";
  let frameOversized = false;
  let jsonText = "";
  let jsonOversized = false;

  const finishFrame = (): void => {
    if (frameOversized && frameEvent) {
      terminal ??= observeNativeTerminal({ type: frameEvent }, frameEvent);
    } else if (frameData && frameData !== "[DONE]") {
      try {
        terminal ??= observeNativeTerminal(JSON.parse(frameData), frameEvent);
      } catch {
        // Unknown or partial frames carry no telemetry authority.
      }
    }
    frameEvent = undefined;
    frameData = "";
    frameOversized = false;
  };

  const inspectSseText = (text: string): void => {
    let offset = 0;
    while (offset < text.length) {
      const newline = text.indexOf("\n", offset);
      const end = newline < 0 ? text.length : newline;
      const segmentLength = end - offset;
      if (segmentLength > 0) {
        if (lineCharacterCount === 0 && segmentLength === 1 && text[offset] === "\r") {
          lineCharacterCount = 1;
          lineIsSingleCarriageReturn = true;
        } else {
          lineCharacterCount = 2;
          lineIsSingleCarriageReturn = false;
        }
      }
      if (!frameOversized) {
        const definitelyOversized = lineBuffer.length + segmentLength > MAX_TELEMETRY_SSE_FRAME_BYTES;
        const segment = definitelyOversized ? "" : text.slice(offset, end);
        if (definitelyOversized
          || Buffer.byteLength(lineBuffer, "utf8") + Buffer.byteLength(segment, "utf8")
            > MAX_TELEMETRY_SSE_FRAME_BYTES) {
          lineBuffer = "";
          frameOversized = true;
        } else lineBuffer += segment;
      }
      if (newline < 0) return;
      const blankLine = lineCharacterCount === 0 || lineIsSingleCarriageReturn;
      const line = frameOversized ? "" : lineBuffer.replace(/\r$/, "");
      lineBuffer = "";
      lineCharacterCount = 0;
      lineIsSingleCarriageReturn = false;
      offset = newline + 1;
      if (blankLine) {
        finishFrame();
        continue;
      }
      if (frameOversized) continue;
      if (line.startsWith("event:")) {
        if (!frameOversized) frameEvent = line.slice(6).trim().slice(0, 128);
        continue;
      }
      if (!line.startsWith("data:") || frameOversized) continue;
      const value = line.slice(5).trimStart();
      const next = frameData ? `${frameData}\n${value}` : value;
      if (Buffer.byteLength(next, "utf8") > MAX_TELEMETRY_SSE_FRAME_BYTES) {
        frameData = "";
        frameOversized = true;
      } else frameData = next;
    }
  };

  const inspectJsonText = (text: string): void => {
    if (jsonOversized) return;
    if (jsonText.length + text.length > MAX_TELEMETRY_JSON_BYTES) {
      jsonText = "";
      jsonOversized = true;
      return;
    }
    const next = jsonText + text;
    if (Buffer.byteLength(next, "utf8") > MAX_TELEMETRY_JSON_BYTES) {
      jsonText = "";
      jsonOversized = true;
    } else jsonText = next;
  };

  const finishInspection = (): void => {
    const trailing = decoder.decode();
    if (eventStream) {
      inspectSseText(trailing);
      if (lineBuffer) inspectSseText("\n");
      finishFrame();
    } else {
      inspectJsonText(trailing);
      if (!jsonOversized && jsonText) {
        try { terminal ??= observeNativeTerminal(JSON.parse(jsonText), undefined, true); }
        catch { /* Large/unrecognized JSON is deliberately not retained or interpreted. */ }
      }
    }
  };

  return {
    get terminal() { return terminal; },
    push(bytes: Uint8Array) {
      const text = decoder.decode(bytes, { stream: true });
      if (eventStream) inspectSseText(text);
      else inspectJsonText(text);
    },
    finish: finishInspection,
  };
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
  const inspector = createTerminalInspector(options.eventStream);
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
        onUncleanClose?.(bytes);
        controller.close();
      }
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
}
