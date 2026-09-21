import { expect, test } from 'bun:test';
import { parseRequest } from '../src/responses/parser';

test('unresolved message attachments never become text claiming a file was delivered', () => {
  for (const role of ['user', 'developer']) {
    for (const attachment of [
      { type: 'input_image', file_id: 'file-example' },
      { type: 'input_file', file_id: 'file-example' },
      { type: 'input_file', filename: 'report.pdf' },
      { type: 'input_file' },
    ]) {
      expect(() => parseRequest({ model: 'chatgpt-web/medium', input: [{ role, content: [attachment] }] }))
        .toThrow(/content was not sent|requires exactly one/);
    }
  }
});

test('inline images retain real bytes as structured image content', () => {
  const image = 'data:image/png;base64,iVBORw0KGgo=';
  const parsed = parseRequest({ model: 'chatgpt-web/medium', input: [{ role: 'user',
    content: [{ type: 'input_text', text: 'Inspect this image' }, { type: 'input_image', image_url: image }] }] });
  expect(parsed.context.messages[0]?.content).toEqual([
    { type: 'text', text: 'Inspect this image' }, { type: 'image', imageUrl: image },
  ]);
});
