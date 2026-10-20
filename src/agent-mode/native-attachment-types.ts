/** Explicitly selected bytes only. This DTO never accepts a filesystem path or remote URL. */
export interface NativeSelectedAttachment {
  selectionId: string;
  receipt: string;
  name: string;
  mimeType: 'text/plain' | 'image/png' | 'image/jpeg';
  data: string;
  sha256: string;
  byteLength: number;
}
export const NATIVE_SELECTED_MAX_FILES = 4;
export const NATIVE_SELECTED_MAX_FILE_BYTES = 32 * 1024;
export const NATIVE_SELECTED_MAX_TEXT_BYTES = 64 * 1024;
export const NATIVE_SELECTED_MAX_IMAGES = 2;
export const NATIVE_SELECTED_MAX_IMAGE_BYTES = 160 * 1024;
/** Names are display labels, never paths; commonly named credential files are excluded. */
export function nativeAttachmentNameAllowed(name: unknown): name is string {
  return typeof name === 'string' && name.length > 0 && name.length <= 160 && name === name.trim()
    && !/[\u0000-\u001f\u007f/\\]/u.test(name) && name !== '.' && name !== '..'
    && !/^(?:\.env(?:\..*)?|credentials(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)(?:\..*)?)$/iu.test(name)
    && !/\.(?:pem|p12|pfx|key|keystore)$/iu.test(name);
}
