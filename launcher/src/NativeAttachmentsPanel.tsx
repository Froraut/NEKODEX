import { useEffect, useId, useRef, useState } from 'react';
import { Button, Notice } from './design';
import type { Language } from './types';
import { nativeAttachmentNameAllowed, NATIVE_SELECTED_MAX_FILES, NATIVE_SELECTED_MAX_FILE_BYTES, NATIVE_SELECTED_MAX_TEXT_BYTES,
  NATIVE_SELECTED_MAX_IMAGES, NATIVE_SELECTED_MAX_IMAGE_BYTES, type NativeSelectedAttachment } from '../../src/agent-mode/native-attachment-types';

export type { NativeSelectedAttachment };
const textExtension = /\.(?:txt|md|csv|json|yaml|yml|log|xml|ts|tsx|js|mjs|py|c|h|cpp|hpp|css|html|sql|bsl)$/iu;
const imageMime = (name: string) => /\.png$/iu.test(name) ? 'image/png' as const : /\.jpe?g$/iu.test(name) ? 'image/jpeg' as const : undefined;
const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join('');

/** A browser File from explicit picker/drop consent; no path, URL or ambient host read. */
export async function prepareNativeSelectedFile(file: File): Promise<NativeSelectedAttachment> {
  const mimeType = imageMime(file.name) ?? (textExtension.test(file.name) ? 'text/plain' : undefined);
  if (!nativeAttachmentNameAllowed(file.name) || !mimeType || !Number.isSafeInteger(file.size) || file.size < 1
    || file.size > (mimeType === 'text/plain' ? NATIVE_SELECTED_MAX_FILE_BYTES : NATIVE_SELECTED_MAX_IMAGE_BYTES)) throw new Error('unsupported-attachment');
  const buffer = await file.arrayBuffer();
  if (buffer.byteLength !== file.size) throw new Error('attachment-changed');
  const bytes = new Uint8Array(buffer);
  if (mimeType === 'text/plain') {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(text)) throw new Error('unsupported-attachment');
  }
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const selectionId = crypto.randomUUID();
  return { selectionId, receipt: `selected-file:${selectionId}`, name: file.name, mimeType, data: btoa(binary),
    byteLength: bytes.length, sha256: hex(await crypto.subtle.digest('SHA-256', buffer)) };
}

export function NativeAttachmentsPanel({ language, scopeKey, attachments, onChange, modelImageInput, disabled = false }: {
  language: Language;
  /** Change when task/create identity or task generation changes; stale reads are discarded. */
  scopeKey: string;
  attachments: readonly NativeSelectedAttachment[];
  onChange: (attachments: NativeSelectedAttachment[]) => void;
  modelImageInput: boolean;
  disabled?: boolean;
}) {
  const ru = language === 'ru';
  const id = useId();
  const epoch = useRef(0);
  const current = useRef({ scopeKey, disabled, modelImageInput, attachments });
  current.current = { scopeKey, disabled, modelImageInput, attachments };
  const [reading, setReading] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => { epoch.current++; setReading(false); setError(false); }, [scopeKey]);
  useEffect(() => () => { epoch.current++; }, []);
  const select = async (files: File[]) => {
    if (current.current.disabled || reading || !files.length) return;
    const token = ++epoch.current, scope = scopeKey;
    setReading(true); setError(false);
    try {
      if (files.length + attachments.length > NATIVE_SELECTED_MAX_FILES + NATIVE_SELECTED_MAX_IMAGES) throw new Error();
      const additions: NativeSelectedAttachment[] = [];
      for (const file of files) additions.push(await prepareNativeSelectedFile(file));
      const next = [...attachments, ...additions];
      const text = next.filter(row => row.mimeType === 'text/plain'), images = next.filter(row => row.mimeType !== 'text/plain');
      if (text.length > NATIVE_SELECTED_MAX_FILES || text.reduce((sum, row) => sum + row.byteLength, 0) > NATIVE_SELECTED_MAX_TEXT_BYTES
        || images.length > NATIVE_SELECTED_MAX_IMAGES || images.reduce((sum, row) => sum + row.byteLength, 0) > NATIVE_SELECTED_MAX_IMAGE_BYTES
        || images.length > 0 && !current.current.modelImageInput) throw new Error();
      if (epoch.current !== token || current.current.scopeKey !== scope || current.current.disabled || current.current.attachments !== attachments) return;
      onChange(next);
    } catch { if (epoch.current === token && current.current.scopeKey === scope) setError(true); }
    finally { if (epoch.current === token) setReading(false); }
  };
  return <section aria-labelledby={`${id}-label`} className="agent-mode-field">
    <label id={`${id}-label`} htmlFor={id}>{ru ? 'Выбранные файлы и изображения' : 'Selected files and images'}</label>
    <input id={id} type="file" multiple disabled={disabled || reading}
      accept={modelImageInput ? '.txt,.md,.csv,.json,.yaml,.yml,.log,.xml,.ts,.tsx,.js,.mjs,.py,.c,.h,.cpp,.hpp,.css,.html,.sql,.bsl,.png,.jpg,.jpeg' : '.txt,.md,.csv,.json,.yaml,.yml,.log,.xml,.ts,.tsx,.js,.mjs,.py,.c,.h,.cpp,.hpp,.css,.html,.sql,.bsl'}
      aria-describedby={`${id}-hint`} onChange={event => { const files = Array.from(event.target.files ?? []); event.target.value = ''; void select(files); }} />
    <p id={`${id}-hint`} className="nk-field__hint">{ru
      ? 'Только явно выбранные UTF-8 файлы: до 4, по 32 КиБ, всего 64 КиБ. PNG/JPEG: до 2, всего 160 КиБ на Native thread, включая изображения инструментов. Содержимое отправится при запуске; продолжение не отправляет его повторно. PDF и двоичные файлы не поддерживаются.'
      : 'Explicitly selected UTF-8 files only: up to 4, 32 KiB each, 64 KiB total. PNG/JPEG: up to 2, 160 KiB per Native thread including tool images. Contents are sent when started; continuation does not resend them. PDF and binary files are unsupported.'}</p>
    {!modelImageInput ? <p className="nk-field__hint">{ru ? 'Выбранная модель не принимает изображения.' : 'The selected model does not accept images.'}</p> : null}
    {reading ? <p role="status">{ru ? 'Чтение выбранных файлов…' : 'Reading selected files…'}</p> : null}
    {error ? <Notice tone="error">{ru ? 'Файлы не добавлены: проверьте формат UTF-8/PNG/JPEG, имя, лимиты и поддержку изображений моделью. Файлы учётных данных исключены.' : 'Files were not added. Check UTF-8/PNG/JPEG format, names, limits and model image support. Credential filenames are excluded.'}</Notice> : null}
    {attachments.length ? <ul className="agent-mode-records">{attachments.map(row => <li key={row.selectionId}>
      <span>{row.name} · {row.mimeType} · {row.byteLength} B</span>
      <details><summary>{ru ? 'Точный источник' : 'Exact source'}</summary><p>{row.receipt}</p><code>SHA-256 {row.sha256}</code></details>
      <Button size="sm" disabled={disabled || reading} onClick={() => onChange(attachments.filter(item => item.selectionId !== row.selectionId))}>{ru ? 'Убрать' : 'Remove'}</Button>
    </li>)}</ul> : null}
  </section>;
}
