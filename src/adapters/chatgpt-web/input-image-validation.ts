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

/** Match the browser attachment's URL and media-type requirements before starting a Web turn. */
export function validateChatGptWebInputImage(imageUrl: string): string | null {
  const parsed = parseDataUrl(imageUrl);
  if (!parsed) return "must be an inline base64 data URL";
  if (!chatGptWebInputImageExtension(parsed.mediaType)) {
    return `has unsupported media type: ${parsed.mediaType}`;
  }
  return null;
}
