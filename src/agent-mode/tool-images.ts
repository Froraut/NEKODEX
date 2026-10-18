import { createHash } from "node:crypto";
import type { AgentContinuation, AgentToolOutcome } from "./types";

const MAX_IMAGE_BYTES = 160 * 1024;
const MAX_IMAGES = 2;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_END = Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]);
type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
export class AgentToolImageProjectionError extends Error {
  constructor() { super("Tool image content is malformed, unsupported or exceeds its bounded image budget"); }
}
function reject(): never { throw new AgentToolImageProjectionError(); }
function dimensions(bytes: Buffer, mimeType: string): { width: number; height: number } {
  let width = 0; let height = 0;
  if (mimeType === "image/png") {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR" || !bytes.subarray(-12).equals(PNG_END)) reject();
    width = bytes.readUInt32BE(16); height = bytes.readUInt32BE(20);
  } else if (mimeType === "image/jpeg") {
    if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) reject();
    let offset = 2;
    while (offset + 3 < bytes.length) {
      if (bytes[offset++] !== 255) reject();
      while (offset < bytes.length && bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 218 || marker === 217 || marker === undefined) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) reject();
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) reject();
      if (marker >= 192 && marker <= 207 && ![196, 200, 204].includes(marker)) {
        if (length < 8) reject(); height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5); break;
      }
      offset += length;
    }
  } else reject();
  if (!width || !height || width > 16_384 || height > 16_384 || width * height > 40_000_000) reject();
  return { width, height };
}
function image(mimeType: unknown, data: unknown) {
  if ((mimeType !== "image/png" && mimeType !== "image/jpeg") || typeof data !== "string" || !data.length || data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || data.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data)) reject();
  const bytes = Buffer.from(data, "base64");
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES || bytes.toString("base64") !== data) reject();
  return { mimeType, data, byteLength: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), ...dimensions(bytes, mimeType) };
}

/** Canonical tool-result images stay toolResult content; they never create a human message. */
export function buildAgentToolContinuationInput(source: AgentContinuation, outcomes: AgentToolOutcome[]): RecordValue[] {
  const turnId = `agent_turn_${source.rootDispatchId}`;
  const input = [...source.input, ...source.output];
  let count = 0; let totalBytes = 0;
  const take = (value: ReturnType<typeof image>) => {
    const index = count++; totalBytes += value.byteLength;
    if (count > MAX_IMAGES || totalBytes > MAX_IMAGE_BYTES) reject();
    return index;
  };
  // Existing canonical images count toward the same per-request cap; history cannot evade it.
  for (const item of input) for (const field of ["content", "output"]) if (Array.isArray(item[field])) for (const part of item[field]) {
    if (!record(part) || part.type !== "input_image") continue;
    if (typeof part.image_url !== "string") reject();
    const matched = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.image_url);
    if (!matched) reject(); take(image(matched[1], matched[2]));
  }
  for (const call of source.pending) {
    const outcome = outcomes.find(row => row.scope.toolCallId === call.toolCallId && row.tool === call.tool);
    if (!outcome || outcome.state === "outcome_unknown") throw new Error("Owned tool result is unavailable; continuation cannot be sent");
    const images: RecordValue[] = [];
    let projectedResult = outcome.result ?? null;
    if (record(outcome.result) && Array.isArray(outcome.result.content)) {
      const content = outcome.result.content.map((part: unknown) => {
        if (!record(part)) return part;
        if (part.type === "resource" && record(part.resource) && typeof part.resource.mimeType === "string" && part.resource.mimeType.startsWith("image/") && "blob" in part.resource) reject();
        if (part.type !== "image") return part;
        if (Object.keys(part).some(key => !["type", "mimeType", "data", "annotations", "_meta"].includes(key))) reject();
        const value = image(part.mimeType, part.data); const attachmentIndex = take(value);
        images.push({ type: "input_image", image_url: `data:${value.mimeType};base64,${value.data}`, detail: "original" });
        return { type: "image", mimeType: value.mimeType, attachmentIndex, byteLength: value.byteLength, sha256: value.sha256, width: value.width, height: value.height };
      });
      if (images.length) projectedResult = { ...outcome.result, content };
    }
    const metadata = JSON.stringify({ state: outcome.state, result: projectedResult, receipt: outcome.idempotencyKey });
    input.push({ type: "function_call_output", call_id: call.toolCallId,
      output: images.length ? [{ type: "input_text", text: metadata }, ...images] : metadata,
      internal_chat_message_metadata_passthrough: { turn_id: turnId } });
  }
  return input;
}
