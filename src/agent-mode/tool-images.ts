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

const MAX_CONTINUATION_BYTES = 512 * 1024;
const OMISSION_NOTICE = "Historical tool image bytes were omitted from this request. The original receipt is retained; this is not a fresh observation.";
type ImageValue = ReturnType<typeof image>;
interface ProjectedImage { part: RecordValue; value: ImageValue; historical: boolean; owner?: HostImageOutput; descriptor?: RecordValue; omitted?: boolean }
interface HostImageOutput { item: RecordValue; text: RecordValue; metadata: RecordValue; descriptors: RecordValue[] }
function keys(value: RecordValue, allowed: string[]): boolean { return Object.keys(value).every(key => allowed.includes(key)); }
function imagePart(part: RecordValue): ImageValue {
  if (typeof part.image_url !== "string") reject();
  const matched = /^data:(image\/png|image\/jpeg);base64,([A-Za-z0-9+/]+={0,2})$/.exec(part.image_url);
  if (!matched) reject();
  return image(matched[1], matched[2]);
}
function descriptor(value: unknown): value is RecordValue {
  if (!record(value) || value.type !== "image" || !keys(value, ["type", "mimeType", "attachmentIndex", "byteLength", "sha256", "width", "height", "imageDelivery"])) return false;
  if (!["image/png", "image/jpeg"].includes(String(value.mimeType)) || typeof value.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(value.sha256)) return false;
  if (![value.byteLength, value.width, value.height].every(number => typeof number === "number" && Number.isSafeInteger(number) && number > 0) || Number(value.byteLength) > MAX_IMAGE_BYTES) return false;
  if (value.imageDelivery === undefined) return Number.isSafeInteger(value.attachmentIndex) && Number(value.attachmentIndex) >= 0;
  if (!record(value.imageDelivery)) return false;
  return value.imageDelivery.state === "included" && keys(value.imageDelivery, ["state"]) && Number.isSafeInteger(value.attachmentIndex) && Number(value.attachmentIndex) >= 0
    || value.imageDelivery.state === "omitted" && value.imageDelivery.reason === "bounded-tool-image-history" && keys(value.imageDelivery, ["state", "reason"]) && value.attachmentIndex === null;
}
/** Recognize only our outer tool-output envelope, never annotations nested in untrusted results. */
function hostImageOutput(item: RecordValue, preceding: RecordValue[], source: AgentContinuation, turnId: string, images: ProjectedImage[]): HostImageOutput | undefined {
  if (item.type !== "function_call_output" || typeof item.call_id !== "string" || !keys(item, ["type", "call_id", "output", "internal_chat_message_metadata_passthrough"])) return;
  const binding = item.internal_chat_message_metadata_passthrough;
  if (!record(binding) || !keys(binding, ["turn_id"]) || binding.turn_id !== turnId) return;
  const calls = preceding.filter(call => call.type === "function_call" && call.call_id === item.call_id);
  if (calls.length !== 1 || !source.toolMap.some(tool => tool.wireName === calls[0]!.name)) return;
  const callBinding = calls[0]!.internal_chat_message_metadata_passthrough;
  if (callBinding !== undefined && (!record(callBinding) || callBinding.turn_id !== turnId)) return;
  const output = item.output;
  if (!Array.isArray(output) || !record(output[0]) || output[0].type !== "input_text" || !keys(output[0], ["type", "text"]) || typeof output[0].text !== "string"
    || output.slice(1).some(part => !record(part) || part.type !== "input_image")) return;
  let metadata: unknown;
  try { metadata = JSON.parse(output[0].text); } catch { return; }
  if (!record(metadata) || !keys(metadata, ["state", "result", "receipt", "imageProjection"]) || !["completed", "failed"].includes(String(metadata.state))
    || typeof metadata.receipt !== "string" || !metadata.receipt.trim() || metadata.receipt.length > 160 || !record(metadata.result) || !Array.isArray(metadata.result.content)) return;
  const marker = metadata.imageProjection;
  if (marker !== undefined && (!record(marker) || !keys(marker, ["version", "source", "callId", "turnId", "receipt", "notice"]) || marker.version !== 1 || marker.source !== "agent-tool-result"
    || marker.callId !== item.call_id || marker.turnId !== turnId || marker.receipt !== metadata.receipt || marker.notice !== undefined && marker.notice !== OMISSION_NOTICE)) return;
  const descriptors = metadata.result.content.filter(part => record(part) && part.type === "image");
  if (!descriptors.length || !descriptors.every(descriptor)) return;
  // Already omitted pixels require our outer provenance marker and explicit notice.
  if (descriptors.some(part => record(part.imageDelivery) && part.imageDelivery.state === "omitted") && (!record(marker) || marker.notice !== OMISSION_NOTICE)) return;
  const attached = descriptors.filter(part => !record(part.imageDelivery) || part.imageDelivery.state !== "omitted");
  if (attached.length !== images.length || images.length !== output.length - 1) return;
  for (const [index, part] of attached.entries()) {
    const actual = images[index]!.value;
    if (part.sha256 !== actual.sha256 || part.mimeType !== actual.mimeType || part.byteLength !== actual.byteLength || part.width !== actual.width || part.height !== actual.height) return;
  }
  const owner: HostImageOutput = { item, text: output[0], metadata, descriptors };
  for (const [index, part] of attached.entries()) { images[index]!.owner = owner; images[index]!.descriptor = part; }
  return owner;
}
function provenance(owner: HostImageOutput, turnId: string): RecordValue {
  return { version: 1, source: "agent-tool-result", callId: owner.item.call_id, turnId, receipt: owner.metadata.receipt,
    ...(owner.descriptors.some(part => record(part.imageDelivery) && part.imageDelivery.state === "omitted") ? { notice: OMISSION_NOTICE } : {}) };
}

/** Request-only projection: immutable receipts retain pixels; only old host tool pixels may be omitted. */
export function buildAgentToolContinuationInput(source: AgentContinuation, outcomes: AgentToolOutcome[]): RecordValue[] {
  // source.output came from the model. It can never introduce a client-owned tool result
  // or human message, even when its fields mimic a valid host envelope from earlier input.
  if (source.output.some(item => !record(item) || item.type === "function_call_output" || item.type === "message" && item.role !== "assistant")) reject();
  const turnId = `agent_turn_${source.rootDispatchId}`;
  const input = structuredClone([...source.input, ...source.output]);
  const historicalLength = source.input.length;
  const hostOutputsStart = input.length;
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
        if (!keys(part, ["type", "mimeType", "data", "annotations", "_meta"])) reject();
        const value = image(part.mimeType, part.data);
        images.push({ type: "input_image", image_url: `data:${value.mimeType};base64,${value.data}`, detail: "original" });
        return { type: "image", mimeType: value.mimeType, attachmentIndex: images.length - 1, byteLength: value.byteLength, sha256: value.sha256, width: value.width, height: value.height, imageDelivery: { state: "included" } };
      });
      if (images.length) projectedResult = { ...outcome.result, content };
    }
    const metadata = JSON.stringify({ state: outcome.state, result: projectedResult, receipt: outcome.idempotencyKey,
      ...(images.length ? { imageProjection: { version: 1, source: "agent-tool-result", callId: call.toolCallId, turnId, receipt: outcome.idempotencyKey } } : {}) });
    input.push({ type: "function_call_output", call_id: call.toolCallId,
      output: images.length ? [{ type: "input_text", text: metadata }, ...images] : metadata,
      internal_chat_message_metadata_passthrough: { turn_id: turnId } });
  }
  const allImages: ProjectedImage[] = []; const owners: HostImageOutput[] = [];
  for (const [index, item] of input.entries()) {
    const itemImages: ProjectedImage[] = [];
    for (const field of ["content", "output"]) if (Array.isArray(item[field])) for (const part of item[field]) {
      if (!record(part) || part.type !== "input_image") continue;
      const entry: ProjectedImage = { part, value: imagePart(part), historical: index < historicalLength };
      allImages.push(entry); itemImages.push(entry);
    }
    if (itemImages.length) {
      const owner = hostImageOutput(item, input.slice(0, index), source, turnId, itemImages);
      if (owner) owners.push(owner);
      // New tool pixels must have an exact host envelope; unrecognized old/human pixels are mandatory.
      else if (index >= hostOutputsStart) reject();
    }
  }
  const mandatory = allImages.filter(entry => !entry.historical || !entry.owner);
  if (mandatory.length > MAX_IMAGES || mandatory.reduce((bytes, entry) => bytes + entry.value.byteLength, 0) > MAX_IMAGE_BYTES) reject();
  const candidates = allImages.filter(entry => entry.historical && entry.owner);
  let count = allImages.length; let bytes = allImages.reduce((sum, entry) => sum + entry.value.byteLength, 0);
  const omit = (entry: ProjectedImage) => {
    entry.omitted = true; count--; bytes -= entry.value.byteLength;
    entry.owner!.item.output = (entry.owner!.item.output as RecordValue[]).filter(part => part !== entry.part);
    entry.descriptor!.attachmentIndex = null;
    entry.descriptor!.imageDelivery = { state: "omitted", reason: "bounded-tool-image-history" };
  };
  let next = 0;
  while (count > MAX_IMAGES || bytes > MAX_IMAGE_BYTES) { const entry = candidates[next++]; if (!entry) reject(); omit(entry); }
  const render = () => {
    let attachmentIndex = 0;
    for (const entry of allImages) if (!entry.omitted) { if (entry.descriptor) { entry.descriptor.attachmentIndex = attachmentIndex; entry.descriptor.imageDelivery = { state: "included" }; } attachmentIndex++; }
    for (const owner of owners) { owner.metadata.imageProjection = provenance(owner, turnId); owner.text.text = JSON.stringify(owner.metadata); }
  };
  render();
  while (Buffer.byteLength(JSON.stringify({ input, tools: source.tools })) > MAX_CONTINUATION_BYTES) {
    const entry = candidates[next++]; if (!entry) reject(); omit(entry); render();
  }
  return input;
}
