export interface OwnedNativeImageMetadata {
  mimeType: 'image/png' | 'image/jpeg'; width: number; height: number; sha256: string; byteLength: number;
  source: { toolCallId: string; receipt: string; attachmentIndex: number };
}
export interface OwnedNativeImage extends OwnedNativeImageMetadata { data: string }
export const MAX_IMAGES: 2;
export const MAX_IMAGE_BYTES: number;
export function validateOwnedNativeImages(images?: unknown): OwnedNativeImage[];
export function validateOwnedNativeImageMetadata(images: unknown): OwnedNativeImageMetadata[];
export function ownedNativeImageMetadata(images?: OwnedNativeImage[]): OwnedNativeImageMetadata[];
export function ownedNativeInputHash(text: string, images?: OwnedNativeImage[]): string;
export function prepareOwnedNativeInput(text: string, images?: OwnedNativeImage[]): {
  inputHash: string; imageAttachments: OwnedNativeImageMetadata[];
  input: Array<{ type: 'text'; text: string; text_elements: [] } | { type: 'image'; url: string; detail: 'high' }>;
};
