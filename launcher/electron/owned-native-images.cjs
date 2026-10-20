'use strict';
// Main-only typed bytes. No paths, URL fetching, image files, or text embedding.
const { digest, canonical, fail, plain, freeze } = require('./owned-native-admission.cjs');
const { crc32 } = require('node:zlib');
const MAX_IMAGES = 2, MAX_IMAGE_BYTES = 160 * 1024, MAX_DIMENSION = 8192, MAX_PIXELS = 16 * 1024 * 1024;
const keys = (value, expected) => plain(value) && Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\u0000-\u001f]/.test(value);
function bad() { throw fail('invalid_image', 'Native image bytes or provenance are invalid'); }
function sourceValid(source) {
  if (!plain(source) || !id(source.receipt) || !Number.isSafeInteger(source.attachmentIndex)
    || source.attachmentIndex < 0 || source.attachmentIndex > 31) return false;
  if (keys(source, ['toolCallId', 'receipt', 'attachmentIndex'])) return id(source.toolCallId);
  return keys(source, ['kind', 'selectionId', 'receipt', 'attachmentIndex', 'name'])
    && source.kind === 'selected-attachment' && id(source.selectionId)
    && typeof source.name === 'string' && source.name.length > 0 && source.name.length <= 160
    && source.name === source.name.trim() && !/[\u0000-\u001f\u007f/\\]/u.test(source.name)
    && source.name !== '.' && source.name !== '..';
}
function validateOwnedNativeImageMetadata(images) {
  if (!Array.isArray(images) || images.length > MAX_IMAGES) bad();
  let bytes = 0;
  const result = images.map(image => {
    if (!keys(image, ['mimeType', 'width', 'height', 'sha256', 'byteLength', 'source'])
      || !['image/png', 'image/jpeg'].includes(image.mimeType) || !/^[a-f0-9]{64}$/.test(image.sha256 || '')
      || !Number.isSafeInteger(image.byteLength) || image.byteLength < 1 || image.byteLength > MAX_IMAGE_BYTES
      || !Number.isSafeInteger(image.width) || image.width < 1 || image.width > MAX_DIMENSION
      || !Number.isSafeInteger(image.height) || image.height < 1 || image.height > MAX_DIMENSION
      || image.width * image.height > MAX_PIXELS
      || !sourceValid(image.source)) bad();
    bytes += image.byteLength;
    return { mimeType: image.mimeType, width: image.width, height: image.height, sha256: image.sha256,
      byteLength: image.byteLength, source: { ...image.source } };
  });
  if (bytes > MAX_IMAGE_BYTES) throw fail('image_budget_exceeded', 'Native image byte budget is exhausted');
  return freeze(result);
}
// Header/structure validation is bounded by the encoded-byte cap. This does not
// claim a full image-codec decode or establish that bytes came from a real tool.
function dimensions(bytes, mimeType) {
  if (mimeType === 'image/png') {
    if (bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) bad();
    let offset = 8, width, height, hasData = false, ended = false;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) bad();
      const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
      if (end > bytes.length) bad();
      const type = bytes.toString('ascii', offset + 4, offset + 8);
      if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) bad();
      if (offset === 8) {
        if (type !== 'IHDR' || length !== 13) bad();
        width = bytes.readUInt32BE(offset + 8); height = bytes.readUInt32BE(offset + 12);
        if (![1, 2, 4, 8, 16].includes(bytes[offset + 16]) || ![0, 2, 3, 4, 6].includes(bytes[offset + 17])
          || bytes[offset + 18] !== 0 || bytes[offset + 19] !== 0 || bytes[offset + 20] > 1) bad();
      } else if (type === 'IHDR') bad();
      if (type === 'IDAT' && length) hasData = true;
      if (type === 'IEND') { if (length || end !== bytes.length) bad(); ended = true; }
      offset = end;
    }
    if (!hasData || !ended) bad();
    return { width, height };
  }
  if (bytes.length < 12 || bytes[0] !== 255 || bytes[1] !== 216 || bytes.at(-2) !== 255 || bytes.at(-1) !== 217) bad();
  let offset = 2, width, height;
  while (offset < bytes.length - 2) {
    if (bytes[offset++] !== 255) bad();
    while (bytes[offset] === 255) offset++;
    const marker = bytes[offset++];
    if (marker === 218) { if (!width || !height) bad(); return { width, height }; }
    if (marker === 0 || marker === 216 || marker === 217 || marker >= 208 && marker <= 215 || offset + 2 > bytes.length) bad();
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length - 2) bad();
    if ([192, 193, 194].includes(marker)) {
      if (width || length < 8 || bytes[offset + 2] !== 8 || ![1, 3, 4].includes(bytes[offset + 7])) bad();
      height = bytes.readUInt16BE(offset + 3); width = bytes.readUInt16BE(offset + 5);
      if (length !== 8 + 3 * bytes[offset + 7]) bad();
    }
    offset += length;
  }
  bad();
}
/** Pure shared byte inspection; no provenance, filesystem, decoding process or Native owner is created. */
function inspectBoundedImageBytes(bytes, mimeType) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE_BYTES || !['image/png', 'image/jpeg'].includes(mimeType)) bad();
  const actual = dimensions(bytes, mimeType);
  if (!Number.isSafeInteger(actual.width) || actual.width < 1 || actual.width > MAX_DIMENSION
    || !Number.isSafeInteger(actual.height) || actual.height < 1 || actual.height > MAX_DIMENSION
    || actual.width * actual.height > MAX_PIXELS) bad();
  return freeze({ mimeType, byteLength: bytes.length, sha256: digest(bytes), ...actual });
}
function validateOwnedNativeImages(images = []) {
  if (!Array.isArray(images) || images.length > MAX_IMAGES) bad();
  const metadata = validateOwnedNativeImageMetadata(images.map(image => {
    if (!keys(image, ['data', 'mimeType', 'width', 'height', 'sha256', 'byteLength', 'source'])) bad();
    const { data, ...rest } = image; return rest;
  }));
  return freeze(images.map((image, index) => {
    if (typeof image.data !== 'string' || image.data.length !== 4 * Math.ceil(image.byteLength / 3)
      || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(image.data)) bad();
    const bytes = Buffer.from(image.data, 'base64');
    if (bytes.length !== image.byteLength || bytes.toString('base64') !== image.data || digest(bytes) !== image.sha256) bad();
    const actual = inspectBoundedImageBytes(bytes, image.mimeType);
    if (actual.width !== image.width || actual.height !== image.height) bad();
    return { data: image.data, ...metadata[index] };
  }));
}
function ownedNativeImageMetadata(images = []) {
  return validateOwnedNativeImageMetadata(validateOwnedNativeImages(images).map(({ data, ...metadata }) => metadata));
}
function ownedNativeInputHash(text, images = []) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 128 * 1024) throw fail('invalid_input', 'Native input text exceeds its bound');
  const imageAttachments = ownedNativeImageMetadata(images);
  return imageAttachments.length ? digest(canonical({ text, imageAttachments })) : digest(text);
}
function prepareOwnedNativeInput(text, images = []) {
  const validated = validateOwnedNativeImages(images), inputHash = ownedNativeInputHash(text, validated);
  const imageAttachments = validateOwnedNativeImageMetadata(validated.map(({ data, ...metadata }) => metadata));
  return { inputHash, imageAttachments, input: [{ type: 'text', text, text_elements: [] },
    ...validated.map(image => ({ type: 'image', url: `data:${image.mimeType};base64,${image.data}`, detail: 'high' }))] };
}
module.exports = { MAX_IMAGES, MAX_IMAGE_BYTES, inspectBoundedImageBytes, validateOwnedNativeImages, validateOwnedNativeImageMetadata,
  ownedNativeImageMetadata, ownedNativeInputHash, prepareOwnedNativeInput };
