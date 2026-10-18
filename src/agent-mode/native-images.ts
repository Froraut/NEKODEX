import { AgentToolImageProjectionError, decodeAgentToolImage } from "./tool-images";

export interface OwnedNativeImage {
  data: string;
  mimeType: "image/png" | "image/jpeg";
  width: number;
  height: number;
  sha256: string;
  byteLength: number;
  source: { toolCallId: string; receipt: string; attachmentIndex: number };
}

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
