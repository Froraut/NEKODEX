import { estimateTokens } from "../../lib/token-estimate";
import { ChatGptWebAdapterError } from "./adapter-error";
import type { ChatGptWebMultipartPartCount, ChatGptWebMultipartParts } from "./prompt-multipart-contract";

// Serialized context envelopes: version-3 inline messages and version-1 multipart records.
// Prompt compilation chooses their content; this module scrubs and partitions them.

const RETIRED_HANDLE_KIND = "turn|binding|call|request|control|handoff|operation|delivery";
const RETIRED_TURN_HANDLE = new RegExp(
  `(?<![A-Za-z0-9_-])(${RETIRED_HANDLE_KIND})_[A-Za-z0-9_-]{32,64}(?![A-Za-z0-9_-])`,
  "g",
);

/**
 * The accumulated Codex context replays earlier turns, including the broker handles those turns
 * held. A model that copies one binds to a finished turn and burns the round trip. The handle for
 * the current turn is supplied by the contract text, never by the replayed context.
 */
export function withoutRetiredTurnHandles(contextJson: string): string {
  // Every caller passes JSON generated from our context envelope. Decode first so escaped
  // control characters are handled as values, and schema keys cannot be rewritten as handles.
  const scrub = (value: unknown): unknown => {
    if (typeof value === "string") {
      return value.replace(RETIRED_TURN_HANDLE, (_handle, kind: string) => `[retired ${kind} handle]`);
    }
    if (Array.isArray(value)) return value.map(scrub);
    if (value === null || typeof value !== "object") return value;
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, scrub(entry)]));
  };
  const scrubMessage = (value: unknown): unknown => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return scrub(value);
    const message = value as Record<string, unknown>;
    return Object.fromEntries(Object.entries(message).map(([key, entry]) => {
      // These two exact history fields connect a native assistant tool call to its result.
      // Tool arguments and other nested content still use ordinary broker-handle scrubbing.
      if (message.role === "tool_result" && key === "tool_call_id") return [key, entry];
      if (message.role === "assistant" && key === "content" && Array.isArray(entry)) {
        return [key, entry.map(part => {
          if (part === null || typeof part !== "object" || Array.isArray(part)) return scrub(part);
          const nativePart = part as Record<string, unknown>;
          if (nativePart.type !== "tool_call") return scrub(part);
          return Object.fromEntries(Object.entries(nativePart).map(([partKey, partValue]) => [
            partKey, partKey === "id" ? partValue : scrub(partValue),
          ]));
        })];
      }
      return [key, scrub(entry)];
    }));
  };
  const scrubRecord = (value: unknown): unknown => {
    if (value === null || typeof value !== "object" || Array.isArray(value)) return scrub(value);
    const record = value as Record<string, unknown>;
    if (record.kind !== "message") return scrub(value);
    return Object.fromEntries(Object.entries(record).map(([key, entry]) => [
      key, key === "message" ? scrubMessage(entry) : scrub(entry),
    ]));
  };
  const root = JSON.parse(contextJson) as unknown;
  if (root !== null && typeof root === "object" && !Array.isArray(root)) {
    const envelope = root as Record<string, unknown>;
    if (envelope.version === 3 && Array.isArray(envelope.messages)) {
      return JSON.stringify(Object.fromEntries(Object.entries(envelope).map(([key, entry]) => [
        key, key === "messages" ? (entry as unknown[]).map(scrubMessage) : scrub(entry),
      ])));
    }
    if (envelope.version === 1 && Array.isArray(envelope.records)) {
      return JSON.stringify(Object.fromEntries(Object.entries(envelope).map(([key, entry]) => [
        key, key === "records" ? (entry as unknown[]).map(scrubRecord) : scrub(entry),
      ])));
    }
    if (envelope.kind === "message") return JSON.stringify(scrubRecord(root));
  }
  return JSON.stringify(scrub(root));
}

export type MultipartContextRecord =
  | { kind: "system"; system_index: number; content: string }
  | { kind: "message"; message_index: number; message: Record<string, unknown> };

export interface MultipartRecordWeight {
  tokens: number;
  chars: number;
}

function multipartRecordWeight(record: MultipartContextRecord): MultipartRecordWeight {
  const text = withoutRetiredTurnHandles(JSON.stringify(record));
  return { tokens: estimateTokens(text) + 1, chars: text.length + 1 };
}

function partitionMultipartRecordWeights(
  weights: readonly MultipartRecordWeight[],
  budgets: readonly MultipartRecordWeight[],
): number[] {
  // A fixed-point fraction of each part's own remaining budget. One step is less than one token.
  const scale = 1_000_000;
  const load = (part: number, tokens: number, chars: number): number => Math.max(
    Math.ceil(tokens * scale / budgets[part]!.tokens),
    Math.ceil(chars * scale / budgets[part]!.chars),
  );
  let lower = 0;
  let totalTokens = 0;
  let totalChars = 0;
  for (const weight of weights) {
    totalTokens += weight.tokens;
    totalChars += weight.chars;
  }
  let upper = load(0, totalTokens, totalChars);
  const boundaries = (capacity: number): number[] => {
    let offset = 0;
    return budgets.map((_budget, part) => {
      let tokens = 0;
      let chars = 0;
      while (offset < weights.length) {
        const weight = weights[offset]!;
        if (load(part, tokens + weight.tokens, chars + weight.chars) > capacity) break;
        tokens += weight.tokens;
        chars += weight.chars;
        offset += 1;
      }
      return offset;
    });
  };
  while (lower < upper) {
    const candidate = Math.floor((lower + upper) / 2);
    if (boundaries(candidate).at(-1) === weights.length) upper = candidate;
    else lower = candidate + 1;
  }
  if (lower > scale) {
    throw new ChatGptWebAdapterError(
      `The complete ordered context cannot fit within ${budgets.length} available message budgets. No history was discarded; compact earlier or reduce the source context.`,
      { status: 400, errorType: "invalid_request_error", code: "context_length_exceeded", retryable: false },
    );
  }
  return boundaries(lower);
}

/**
 * Partition complete semantic records without cutting a JSON string or an individual message.
 *
 * Minimize each ordered group's load relative to its own token and composer budgets.
 * Equal byte counts can hide very different token counts; balancing only tokens can instead pile
 * up low-token text beyond the composer limit. The final part also owns attachments and execution
 * instructions. Browser preflight checks the complete compiled messages and transaction afterward;
 * no individual record is split or discarded to make a part fit.
 */
export function partitionMultipartContext(
  records: readonly MultipartContextRecord[],
  totalParts: ChatGptWebMultipartPartCount,
  budgets: readonly MultipartRecordWeight[],
): ChatGptWebMultipartParts {
  if (budgets.length !== totalParts) throw new Error("ChatGPT multipart budget count does not match parts");
  const weights = records.map(multipartRecordWeight);
  const oversized = weights.findIndex(weight => budgets.every(budget => weight.tokens > budget.tokens || weight.chars > budget.chars));
  if (oversized >= 0) {
    const record = records[oversized]!;
    const label = record.kind === "system" ? `system record ${record.system_index}` : `message ${record.message_index}`;
    throw new ChatGptWebAdapterError(
      `Bigger Context ${label} is an indivisible record (${weights[oversized]!.tokens} estimated tokens, ${weights[oversized]!.chars} characters) exceeding every available per-message budget. Reduce that record; retrying cannot make it fit. No history was discarded.`,
      { status: 400, errorType: "invalid_request_error", code: "context_atomic_record_too_large", retryable: false },
    );
  }
  const boundaries = partitionMultipartRecordWeights(weights, budgets);
  let offset = 0;
  const groups = boundaries.map(end => {
    const group = records.slice(offset, end);
    offset = end;
    return group;
  });
  if (offset !== records.length) throw new Error("ChatGPT multipart context partition lost records");
  const payloads = groups.map((group, index) => withoutRetiredTurnHandles(JSON.stringify({
    version: 1,
    part_index: index + 1,
    total_parts: totalParts,
    records: group,
  })));
  return payloads;
}
