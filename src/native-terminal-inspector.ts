import { safeNativeModelId, validNativeReportedUsage,
  type NativeReportedUsage, type NativeUsageFailureCategory, type NativeUsageOutcome,
} from "./usage/native-contract";
import { isJsonRecord } from "./lib/json-record";

const MAX_TELEMETRY_SSE_FRAME_BYTES = 64 * 1024;
const MAX_TELEMETRY_JSON_BYTES = 256 * 1024;
// A terminal frame repeats the whole response, so long turns exceed the frame budget. Its event
// type and model lead the payload and its usage trails it, so a bounded head and tail suffice.
const OVERSIZED_FRAME_HEAD_CHARS = 16 * 1024;
const OVERSIZED_FRAME_TAIL_CHARS = 32 * 1024;

interface NativeTerminalObservation {
  outcome: NativeUsageOutcome;
  reportedModelId: string | null;
  usage: NativeReportedUsage | null;
  failureCategory: NativeUsageFailureCategory | null;
}

function nativeReportedUsage(value: unknown): NativeReportedUsage | null {
  if (!isJsonRecord(value)) return null;
  const inputDetails = isJsonRecord(value.input_tokens_details) ? value.input_tokens_details : undefined;
  const outputDetails = isJsonRecord(value.output_tokens_details) ? value.output_tokens_details : undefined;
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
  if (!isJsonRecord(value)) return undefined;
  const response = isJsonRecord(value.response) ? value.response : value;
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

/** Extract the balanced JSON object that follows the last `"usage":` key in a bounded tail. */
function trailingUsageObject(tail: string): unknown {
  const key = tail.lastIndexOf('"usage"');
  if (key < 0) return undefined;
  const open = /^\s*:\s*\{/.exec(tail.slice(key + 7, key + 7 + 64));
  if (!open) return undefined;
  const start = key + 7 + open[0].length - 1;
  let depth = 0;
  let inString = false;
  for (let index = start; index < tail.length; index += 1) {
    const character = tail[index];
    if (inString) {
      if (character === "\\") index += 1;
      else if (character === '"') inString = false;
    } else if (character === '"') inString = true;
    else if (character === "{") depth += 1;
    else if (character === "}" && --depth === 0) {
      try { return JSON.parse(tail.slice(start, index + 1)); }
      catch { return undefined; }
    }
  }
  return undefined;
}

/**
 * Interpret an oversized terminal frame from its bounded head and tail only. Every field is
 * re-validated by the same terminal/usage rules as a fully parsed frame; anything unrecognized
 * yields no usage rather than an estimate.
 */
function observeOversizedTerminal(head: string, tail: string, eventName?: string): NativeTerminalObservation | undefined {
  const type = eventName ?? /"type"\s*:\s*"([A-Za-z0-9_.]{1,64})"/.exec(head)?.[1];
  if (type !== "response.completed" && type !== "response.incomplete"
    && type !== "response.failed" && type !== "error") return undefined;
  const model = /"model"\s*:\s*"([^"\\]{1,128})"/.exec(head)?.[1];
  return observeNativeTerminal({
    type,
    response: { model, usage: type === "error" ? undefined : trailingUsageObject(tail) },
  }, eventName);
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
  let frameHead = "";
  let frameTail = "";
  let jsonText = "";
  let jsonOversized = false;

  const finishFrame = (): void => {
    if (!frameOversized && frameData === "[DONE]") {
      streamEnded = true;
    } else if (frameOversized) {
      terminal ??= observeOversizedTerminal(frameHead, frameTail, frameEvent);
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
    frameHead = "";
    frameTail = "";
  };

  /** Keep a bounded copy of the raw frame text so an oversized terminal frame stays readable. */
  const captureFrameText = (segment: string): void => {
    if (frameHead.length < OVERSIZED_FRAME_HEAD_CHARS) {
      frameHead += segment.slice(0, OVERSIZED_FRAME_HEAD_CHARS - frameHead.length);
    }
    frameTail = segment.length >= OVERSIZED_FRAME_TAIL_CHARS
      ? segment.slice(-OVERSIZED_FRAME_TAIL_CHARS)
      : (frameTail + segment).slice(-OVERSIZED_FRAME_TAIL_CHARS);
  };

  const inspectSseText = (text: string): void => {
    let offset = 0;
    while (!streamEnded && offset < text.length) {
      const newline = text.indexOf("\n", offset);
      const end = newline < 0 ? text.length : newline;
      const segmentLength = end - offset;
      captureFrameText(text.slice(offset, newline < 0 ? end : newline + 1));
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
        frameEvent = line.slice(6).trim().slice(0, 128);
        continue;
      }
      if (!line.startsWith("data:")) continue;
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
