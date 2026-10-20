import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { projectNativeSelectedAttachments, type NativeSelectedAttachment } from '../src/agent-mode/native-images';
import { prepareOwnedNativeInput, ownedNativeImageMetadata, validateOwnedNativeImages } from '../launcher/electron/owned-native-images.cjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNg+A8AAQIBAEK+vGgAAAAASUVORK5CYII=', 'base64');
function selected(bytes: Buffer, name = 'notes.txt', mimeType: NativeSelectedAttachment['mimeType'] = 'text/plain', selectionId = 'selection-1'): NativeSelectedAttachment {
  return { selectionId, receipt: `selected-file:${selectionId}`, name, mimeType, data: bytes.toString('base64'),
    sha256: createHash('sha256').update(bytes).digest('hex'), byteLength: bytes.length };
}

test('selected UTF-8 and PNG retain exact selection receipts; image bytes stay outside automatic context and input hash binds provenance', () => {
  const text = selected(Buffer.from('\ufeffПривет\r\nexact\n'));
  const image = selected(png, 'selected.png', 'image/png', 'selection-2');
  const projected = projectNativeSelectedAttachments({ attachments: [text, image], modelImageInput: true });
  expect(projected.context[0]?.text).toBe('\ufeffПривет\r\nexact\n');
  expect(projected.context[1]).toMatchObject({ selectionId: image.selectionId, receipt: image.receipt, name: image.name,
    sha256: image.sha256, byteLength: png.length, attachmentIndex: 0, delivery: 'included' });
  expect(JSON.stringify(projected.context)).not.toContain(image.data);
  expect(validateOwnedNativeImages(projected.images)[0]?.source).toEqual({ kind: 'selected-attachment', selectionId: image.selectionId,
    receipt: image.receipt, name: image.name, attachmentIndex: 0 });
  expect(ownedNativeImageMetadata(projected.images)[0]).not.toHaveProperty('data');
  const input = prepareOwnedNativeInput(JSON.stringify(projected.context), projected.images);
  expect(input.input[1]).toEqual({ type: 'image', url: `data:image/png;base64,${image.data}`, detail: 'high' });
  const changed = projected.images.map(row => ({ ...row, source: { ...row.source, receipt: 'different-selection-receipt' } }));
  expect(prepareOwnedNativeInput(JSON.stringify(projected.context), changed).inputHash).not.toBe(input.inputHash);
});

test('selection admission refuses unsupported modalities, paths, credential names, mismatched bytes and invalid UTF-8 before offer', () => {
  const text = selected(Buffer.from('selected text'));
  for (const attachment of [
    { ...text, path: '/not-authorized' }, { ...text, name: '../notes.txt' }, { ...text, name: '.env.local' },
    { ...text, name: 'credentials.json' }, { ...text, name: 'private.key' }, { ...text, name: ' notes.txt' },
    { ...text, data: `${text.data}\n` }, { ...text, sha256: '0'.repeat(64) }, { ...text, mimeType: 'application/pdf' },
    selected(Buffer.from([0xc3, 0x28])), selected(Buffer.from([0, 1, 2])), { ...text, receipt: '\n' },
  ]) expect(() => projectNativeSelectedAttachments({ attachments: [attachment as NativeSelectedAttachment], modelImageInput: true })).toThrow();
  expect(() => projectNativeSelectedAttachments({ attachments: [selected(png, 'selected.png', 'image/png')], modelImageInput: false })).toThrow();
  expect(projectNativeSelectedAttachments({ attachments: [text], modelImageInput: false }).context[0]?.text).toBe('selected text');
  expect(() => projectNativeSelectedAttachments({ attachments: [text, text], modelImageInput: true })).toThrow();
});

test('selected file count and byte budgets reject entire batch; typed images share main image admission', () => {
  const text = selected(Buffer.alloc(32 * 1024, 65));
  expect(projectNativeSelectedAttachments({ attachments: [text, { ...text, selectionId: 'second' }], modelImageInput: true }).context).toHaveLength(2);
  expect(() => projectNativeSelectedAttachments({ attachments: [text, { ...text, selectionId: 'second' }, { ...text, selectionId: 'third' }], modelImageInput: true })).toThrow();
  expect(() => projectNativeSelectedAttachments({ attachments: Array.from({ length: 5 }, (_, i) => selected(Buffer.from('x'), 'notes.txt', 'text/plain', String(i))), modelImageInput: true })).toThrow();
  const images = projectNativeSelectedAttachments({ attachments: [selected(png, 'first.png', 'image/png', 'first'), selected(png, 'second.png', 'image/png', 'second')], modelImageInput: true }).images;
  expect(images).toHaveLength(2);
  expect(() => validateOwnedNativeImages([...images, images[0]])).toThrow();
  const metadata = ownedNativeImageMetadata(images);
  expect(() => validateOwnedNativeImages([{ ...images[0], source: { ...metadata[0]!.source, path: '/not-authorized' } }])).toThrow();
});
