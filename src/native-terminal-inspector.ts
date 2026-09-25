import { safeNativeModelId, validNativeReportedUsage,
  type NativeReportedUsage, type NativeUsageFailureCategory, type NativeUsageOutcome,
} from "./usage/native-contract";

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

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
    ...(inputDetails?.cached_tokens == null ? {} : { cachedInputTokens: inputDetails.cached_tokens }),
    ...(outputDetails?.reasoning_tokens == null ? {} : { reasoningOutputTokens: outputDetails.reasoning_tokens }),
  };
  return validNativeReportedUsage(usage) ? usage : null;
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

/** Bounded terminal interpretation has no delivery or stream lifecycle authority. */
export function createNativeTerminalInspector(eventStream: boolean) {
  const decoder = new TextDecoder();
  let terminal: NativeTerminalObservation | undefined;
  let streamEnded = false;
  let lineBuffer = "";
  let lineCharacterCount = 0;
  let lineIsSingleCarriageReturn = false;
  let frameEvent: string | undefined;
  let frameData = "";
  let frameOversized = false;
  let jsonText = "";
  let jsonOversized = false;

  const finishFrame = (): void => {
    if (!frameOversized && frameData === "[DONE]") {
      streamEnded = true;
    } else if (frameOversized && frameEvent) {
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
    while (!streamEnded && offset < text.length) {
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
      if (streamEnded) return;
      const text = decoder.decode(bytes, { stream: true });
      if (eventStream) inspectSseText(text);
      else inspectJsonText(text);
    },
    finish: finishInspection,
  };
}
