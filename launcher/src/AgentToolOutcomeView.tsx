import { Notice } from './design';
import type { ToolOutcome } from './agent-tools-types';

const MAX_IMAGE_BYTES = 160 * 1024;
const MAX_IMAGE_COUNT = 4;
const MAX_TEXT = 32768;
const MAX_DIAGNOSTICS = 65536;
type Choose = (en: string, ru: string) => string;
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const bounded = (text: string, limit: number) => text.length <= limit ? text : `${text.slice(0, limit)}\n[…truncated]`;

function safeImage(value: Record<string, unknown>): { uri: string; mime: string; bytes: number } | undefined {
  if (!['image/jpeg', 'image/png'].includes(String(value.mimeType)) || typeof value.data !== 'string'
      || !value.data.length || value.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 || value.data.length % 4 !== 0
      || !/^[A-Za-z0-9+/]+={0,2}$/.test(value.data)) return;
  try {
    const binary = atob(value.data);
    if (binary.length > MAX_IMAGE_BYTES || btoa(binary) !== value.data) return;
    if (value.mimeType === 'image/jpeg') {
      if (binary.length < 4 || binary.charCodeAt(0) !== 255 || binary.charCodeAt(1) !== 216 || binary.charCodeAt(2) !== 255) return;
    } else {
      const magic = [137, 80, 78, 71, 13, 10, 26, 10];
      if (binary.length < 24 || magic.some((byte, index) => binary.charCodeAt(index) !== byte)) return;
      const dimension = (at: number) => binary.charCodeAt(at) * 16777216 + binary.charCodeAt(at + 1) * 65536 + binary.charCodeAt(at + 2) * 256 + binary.charCodeAt(at + 3);
      const width = dimension(16), height = dimension(20);
      if (!width || !height || width > 16384 || height > 16384 || width * height > 32 * 1024 * 1024) return;
    }
    return { uri: `data:${value.mimeType};base64,${value.data}`, mime: String(value.mimeType), bytes: binary.length };
  } catch { return; }
}

/** Diagnostic copies omit binary payloads. The original retained outcome is never mutated. */
function diagnosticJson(value: unknown, limit: number): string {
  const seen = new WeakSet<object>();
  try {
    const result = JSON.stringify(value, function (this: unknown, key, item: unknown) {
      if (typeof item === 'string') {
        if (key === 'base64' || (key === 'data' && object(this) && (this.type === 'image' || String(this.mimeType).startsWith('image/')))) return `[image bytes omitted; ${item.length} encoded characters]`;
        return bounded(item, MAX_TEXT);
      }
      if (item && typeof item === 'object') { if (seen.has(item)) return '[repeated object]'; seen.add(item); }
      return item;
    }, 2);
    return bounded(result ?? '', limit);
  } catch { return '[metadata unavailable]'; }
}

/** Displays only bytes already present in an approved retained result. No effect,
 * API call, URL fetch, permission request, capture or input originates here. */
export function AgentToolOutcomeView({ outcome, choose }: { outcome: ToolOutcome; choose: Choose }) {
  const result = object(outcome.result) ? outcome.result : undefined;
  const content = Array.isArray(result?.content) ? result.content : [];
  const structured = result?.structuredContent;
  const images: { uri: string; mime: string; bytes: number }[] = [];
  const texts: string[] = [];
  let omittedImages = 0, textBytes = 0;
  for (const part of content) {
    if (!object(part)) continue;
    if (part.type === 'image') {
      const image = images.length < MAX_IMAGE_COUNT ? safeImage(part) : undefined;
      if (image) images.push(image); else omittedImages++;
    } else if (part.type === 'text' && typeof part.text === 'string' && textBytes < MAX_TEXT) {
      // Built-in providers often publish identical JSON as text and metadata.
      if (structured !== undefined && part.text === JSON.stringify(structured)) continue;
      const text = bounded(part.text, MAX_TEXT - textBytes); textBytes += text.length; texts.push(text);
    }
  }
  const metadata = structured !== undefined ? diagnosticJson(structured, MAX_TEXT) : undefined;
  return <div className="agent-tools-outcome-view">
    <p><code>{outcome.tool}</code> · <code>{outcome.idempotencyKey}</code></p>
    {images.map((image, index) => <figure key={index} style={{ margin: 'var(--space-3) 0' }}>
      <img src={image.uri} alt={choose(`Approved tool image ${index + 1}`, `Изображение из подтверждённого результата ${index + 1}`)}
        loading="lazy" decoding="async" style={{ display: 'block', maxWidth: '100%', maxHeight: 420, objectFit: 'contain', borderRadius: 'var(--radius-md)' }} />
      <figcaption>{image.mime} · {image.bytes} {choose('bytes; retained result preview', 'байт; просмотр сохранённого результата')}</figcaption>
    </figure>)}
    {omittedImages ? <Notice tone="warning">{choose('An image was omitted because its format, dimensions or size exceeds the bounded preview. The original retained receipt is preserved.', 'Изображение не показано: формат, размеры или объём выходят за пределы предпросмотра. Исходная сохранённая квитанция не изменена.')}</Notice> : null}
    {texts.map((text, index) => <pre key={index}>{text}</pre>)}
    {metadata ? <div><strong>{choose('Observed result metadata', 'Метаданные полученного результата')}</strong><pre>{metadata}</pre></div> : null}
    {outcome.reason ? <p>{bounded(outcome.reason, MAX_TEXT)}</p> : null}
    <details><summary>{choose('Diagnostics (image bytes omitted)', 'Диагностика (байты изображения скрыты)')}</summary><pre>{diagnosticJson(outcome, MAX_DIAGNOSTICS)}</pre></details>
  </div>;
}
