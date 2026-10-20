import { AgentToolImageProjectionError, decodeAgentToolImage } from "./tool-images";

import { inspectBoundedImageBytes, validateOwnedNativeImages, type OwnedNativeImage } from "../../launcher/electron/owned-native-images.cjs";
import { createHash } from "node:crypto";
import { nativeAttachmentNameAllowed, NATIVE_SELECTED_MAX_FILES, NATIVE_SELECTED_MAX_FILE_BYTES, NATIVE_SELECTED_MAX_TEXT_BYTES,
  NATIVE_SELECTED_MAX_IMAGES, NATIVE_SELECTED_MAX_IMAGE_BYTES, type NativeSelectedAttachment } from "./native-attachment-types";
export type { OwnedNativeImage, NativeSelectedAttachment };

type RecordValue = Record<string, unknown>;
function record(value: unknown): value is RecordValue { return Boolean(value && typeof value === "object" && !Array.isArray(value)); }
function reject(): never { throw new AgentToolImageProjectionError(); }

/** Only exact top-level MCP image blocks may carry pixels across this boundary. */
export function projectNativeToolImages(input: { result: unknown; toolCallId: string; receipt: string }): { result: unknown; images: OwnedNativeImage[] } {
  const { result, toolCallId, receipt } = input;
  const content = record(result) && Array.isArray(result.content) ? result.content : undefined;
  const accepted = new Set<object>();
  for (const part of content ?? []) if (record(part) && part.type === "image") {
    if (!Object.keys(part).every(key => ["type", "mimeType", "data", "annotations", "_meta"].includes(key))) reject();
    accepted.add(part);
  }
  // Do not search strings for image-looking text or interpret paths/URLs. Reject
  // structured alternate/nested image representations instead of flattening them.
  const ancestors = new Set<object>();
  function inspect(value: unknown, imageAllowed = false, root = false): void {
    if (!value || typeof value !== "object") return;
    if (ancestors.has(value)) reject();
    ancestors.add(value);
    if (record(value) && !(imageAllowed && accepted.has(value))) {
      if (["image", "input_image", "output_image", "image_url"].includes(String(value.type))
        || "image_url" in value
        || typeof value.mimeType === "string" && value.mimeType.startsWith("image/") && ("data" in value || "blob" in value)) reject();
    }
    for (const [key, child] of Object.entries(value)) {
      if (root && key === "content" && Array.isArray(child)) for (const part of child) inspect(part, true);
      else inspect(child);
    }
    ancestors.delete(value);
  }
  inspect(result, false, true);
  const images: OwnedNativeImage[] = [];
  let totalBytes = 0;
  const projected = content?.map(part => {
    if (!record(part) || !accepted.has(part)) return part;
    const decoded = decodeAgentToolImage(part.mimeType, part.data);
    const mimeType = decoded.mimeType;
    if (mimeType !== "image/png" && mimeType !== "image/jpeg") reject();
    totalBytes += decoded.byteLength;
    if (images.length >= 2 || totalBytes > 160 * 1024) reject();
    const attachmentIndex = images.length;
    images.push({ ...decoded, mimeType, source: { toolCallId, receipt, attachmentIndex } });
    return { type: "image", mimeType: decoded.mimeType, byteLength: decoded.byteLength, sha256: decoded.sha256,
      width: decoded.width, height: decoded.height, attachmentIndex, imageDelivery: { state: "included" } };
  });
  return { result: images.length ? { ...(result as RecordValue), content: projected } : result, images };
}

export interface NativeSelectedAttachmentContext {
  kind: 'selected-attachment';
  selectionId: string;
  receipt: string;
  name: string;
  mimeType: NativeSelectedAttachment['mimeType'];
  sha256: string;
  byteLength: number;
  delivery: 'included';
  /** UTF-8 file content is untrusted automatic-host context, never instructions or file authority. */
  text?: string;
  attachmentIndex?: number;
}

/** Validate unknown transport data, then construct a typed DTO from checked fields. */
function selectedAttachment(value: unknown): NativeSelectedAttachment {
  if (!record(value) || Object.keys(value).length !== 7
    || !['selectionId', 'receipt', 'name', 'mimeType', 'data', 'sha256', 'byteLength'].every(key => Object.hasOwn(value, key))) reject();
  const { selectionId, receipt, name, mimeType, data, sha256, byteLength } = value;
  if (typeof selectionId !== 'string' || !selectionId.trim() || selectionId.length > 512 || /[\u0000-\u001f]/u.test(selectionId)
    || typeof receipt !== 'string' || !receipt.trim() || receipt.length > 512 || /[\u0000-\u001f]/u.test(receipt)
    || !nativeAttachmentNameAllowed(name)
    || mimeType !== 'text/plain' && mimeType !== 'image/png' && mimeType !== 'image/jpeg'
    || typeof byteLength !== 'number' || !Number.isSafeInteger(byteLength) || byteLength < 1
    || byteLength > (mimeType === 'text/plain' ? NATIVE_SELECTED_MAX_FILE_BYTES : NATIVE_SELECTED_MAX_IMAGE_BYTES)
    || typeof data !== 'string' || data.length !== 4 * Math.ceil(byteLength / 3)
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)
    || typeof sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(sha256)) reject();
  return { selectionId, receipt, name, mimeType, data, sha256, byteLength };
}

/** Project only deliberately selected byte DTOs; never read a host path or fetch a URL.
 * Call once on a new Native turn chain. Continuations retain the same Native thread;
 * resending selected pixels would consume the durable binding's cumulative budget again.
 */
export function projectNativeSelectedAttachments(input: {
  attachments: readonly NativeSelectedAttachment[];
  modelImageInput: boolean;
}): { context: NativeSelectedAttachmentContext[]; images: OwnedNativeImage[] } {
  if (!Array.isArray(input.attachments) || input.attachments.length > NATIVE_SELECTED_MAX_FILES + NATIVE_SELECTED_MAX_IMAGES) reject();
  const context: NativeSelectedAttachmentContext[] = [], images: OwnedNativeImage[] = [];
  const selections = new Set<string>();
  let fileCount = 0, textBytes = 0, imageBytes = 0;
  for (const value of input.attachments) {
    const attachment = selectedAttachment(value);
    if (selections.has(attachment.selectionId)) reject();
    selections.add(attachment.selectionId);
    const bytes = Buffer.from(attachment.data, 'base64');
    if (bytes.length !== attachment.byteLength || bytes.toString('base64') !== attachment.data
      || createHash('sha256').update(bytes).digest('hex') !== attachment.sha256) reject();
    const { data, ...metadata } = attachment;
    if (attachment.mimeType === 'text/plain') {
      if (++fileCount > NATIVE_SELECTED_MAX_FILES || (textBytes += bytes.length) > NATIVE_SELECTED_MAX_TEXT_BYTES) reject();
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); } catch { reject(); }
      if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text!)) reject();
      context.push({ kind: 'selected-attachment', ...metadata, delivery: 'included', text: text! });
    } else {
      if (input.modelImageInput !== true || images.length >= NATIVE_SELECTED_MAX_IMAGES
        || (imageBytes += bytes.length) > NATIVE_SELECTED_MAX_IMAGE_BYTES) reject();
      const inspected = inspectBoundedImageBytes(bytes, attachment.mimeType);
      const attachmentIndex = images.length;
      images.push({ data, ...inspected, source: { kind: 'selected-attachment', selectionId: attachment.selectionId,
        receipt: attachment.receipt, name: attachment.name, attachmentIndex } });
      context.push({ kind: 'selected-attachment', ...metadata, delivery: 'included', attachmentIndex });
    }
  }
  return { context, images: validateOwnedNativeImages(images) };
}
