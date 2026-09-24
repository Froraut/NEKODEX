import { parseDataUrl } from "../image";

const imageExtensions = new Map([
  ["image/png", "png"],
  ["image/jpeg", "jpg"],
  ["image/gif", "gif"],
  ["image/webp", "webp"],
]);

export function chatGptWebInputImageExtension(mediaType: string): string | undefined {
  return imageExtensions.get(mediaType.toLowerCase());
}

/** Match the browser attachment's encoding and size requirements before either transport starts. */
export function validateChatGptWebInputImage(imageUrl: string): string | null {
  const parsed = parseDataUrl(imageUrl);
  if (!parsed) return "must be an inline base64 data URL";
  if (!chatGptWebInputImageExtension(parsed.mediaType)) {
    return `has unsupported media type: ${parsed.mediaType}`;
  }
  const { base64 } = parsed;
  if (base64.length === 0) return "is empty";
  // Bound work before scanning or decoding an attacker-controlled payload. Padding can reduce
  // the decoded size by at most two bytes, so this early bound cannot reject a valid 20 MB image.
  if (base64.length > Math.ceil(20_000_000 / 3) * 4) return "exceeds 20 MB";
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    return "contains invalid base64 data";
  }
  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const size = base64.length / 4 * 3 - padding;
  if (size === 0) return "is empty";
  if (size > 20_000_000) return "exceeds 20 MB";
  return null;
}
