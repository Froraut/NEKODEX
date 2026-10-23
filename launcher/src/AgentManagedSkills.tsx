import { useEffect, useId, useRef, useState } from 'react';
import { Badge, Button, Checkbox, Notice, Panel, Select, TextField } from './design';
import type { AgentToolsApi, AgentToolsStatus, ManagedSkillReviewView, ManagedSkillResourceView, ManagedSkillTextResourceView, ManagedSkillImageResourceView, ManagedSkillScriptResourceView, ManagedSkillDocumentResourceView, SkillIdentity, ToolScope } from './agent-tools-types';

function PdfPreview({ resource, verified, choose }: { resource: ManagedSkillDocumentResourceView; verified: boolean; choose: (en: string, ru: string) => string }) {
  if (!verified) return <Notice tone="warning">{choose('The PDF descriptor and preview binding have not been verified.', 'Описание PDF и связь с результатом просмотра ещё не проверены.')}</Notice>;
  const preview = resource.preview;
  return <div className="agent-tools-document-preview">
    <Badge tone={preview.state === 'completed' ? 'neutral' : 'warning'}>{preview.state}</Badge>
    <p>{choose('Text layer only. Images, layout, annotations and scanned pages are not fully represented; no OCR is performed.', 'Только текстовый слой. Изображения, оформление, аннотации и сканированные страницы представлены не полностью; OCR не выполняется.')}</p>
    <small>{preview.extractor.provider} · v{preview.extractor.version}</small>{' '}
    {preview.extractor.executableSha256 ? <code>{choose('Extractor SHA-256', 'SHA-256 обработчика')}: {preview.extractor.executableSha256}</code> : <p>{choose('No admitted extractor executable identity is available.', 'Идентификатор допущенного обработчика недоступен.')}</p>}
    {preview.pageCount !== undefined ? <p>{choose('Pages', 'Страниц')}: {preview.pageCount} · {choose('with text', 'с текстом')}: {preview.pagesWithText ?? '—'} · {choose('without text', 'без текста')}: {preview.pagesWithoutText ?? '—'}</p> : null}
    {preview.state === 'completed' ? <pre>{preview.text}</pre> : <Notice tone="warning">{choose('The PDF text preview is not confirmed. Importing this file does not mean its content was read successfully.', 'Текстовый просмотр PDF не подтверждён. Импорт файла не означает успешное чтение его содержимого.')}{preview.reason ? <p>{preview.reason}</p> : null}</Notice>}
  </div>;
}
export function AgentManagedSkills({ api, status, sources, scope, locked, choose, act, refresh }: {
  api: AgentToolsApi; status: AgentToolsStatus | null; sources: SkillIdentity[]; scope?: ToolScope; locked: boolean;
  choose: (en: string, ru: string) => string; act: (operation: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>;
}) {
  const [sourceId, setSourceId] = useState(''); const [label, setLabel] = useState(() => choose('Local text instructions', 'Локальные инструкции'));
  const [lineage, setLineage] = useState(''); const [actionId, setActionId] = useState<string>(() => crypto.randomUUID());
  const [review, setReview] = useState<ManagedSkillReviewView | null>(null);
  const [resourcePaths, setResourcePaths] = useState('');
  const resourcePathsId = useId();
  const current = sources.find(row => row.id === sourceId); const managed = status?.managedSkills;
  const freshReview = () => { setActionId(crypto.randomUUID()); setReview(null); };
  const lineageOptions = [...new Map((managed?.versions ?? []).map(version => [version.lineageId, { value: version.lineageId, label: `${version.label} · ${version.lineageId.slice(0, 12)}` }])).values()];
  const attached = managed?.attachments.find(row => row.scope.taskId === scope?.taskId && row.scope.generation === scope?.generation)?.versionIds ?? [];
  const reviewedSource = review?.action.manifest as { grant?: { label?: string }; identity?: { relativePath?: string; bytes?: number; digest?: string }; package?: { version?: 1 | 2 | 3 | 4 | 5; kind?: 'selected-local-text-package' | 'selected-local-mixed-package' | 'selected-local-executable-package' | 'selected-local-polyglot-package' | 'selected-local-document-package'; packageDigest: string; totalBytes: number; resources: (Omit<ManagedSkillTextResourceView, 'content'> | Omit<ManagedSkillImageResourceView, 'data'> | Omit<ManagedSkillScriptResourceView, 'content'> | Omit<ManagedSkillDocumentResourceView, 'preview'>)[] } } | undefined;
  const currentReview = useRef(review); currentReview.current = review;
  const [bytesVerified, setBytesVerified] = useState<ManagedSkillReviewView | null>(null);
  const [decodedPreview, setDecodedPreview] = useState<{ review: ManagedSkillReviewView | null; paths: string[]; failed: boolean }>({ review: null, paths: [], failed: false });
  const [previewError, setPreviewError] = useState('');
  const [scriptReviewAcknowledged, setScriptReviewAcknowledged] = useState<ManagedSkillReviewView | null>(null);
  const [pdfReviewAcknowledged, setPdfReviewAcknowledged] = useState<ManagedSkillReviewView | null>(null);
  useEffect(() => {
    let active = true; setBytesVerified(null); setDecodedPreview({ review, paths: [], failed: false }); setScriptReviewAcknowledged(null); setPdfReviewAcknowledged(null); setPreviewError('');
    if (!review) return;
    void (async () => {
      try {
        const packet = reviewedSource?.package;
        if (!packet && review.resources?.length) throw new Error('missing-manifest');
        if (packet) {
          if (review.content === undefined || !Array.isArray(review.resources) || review.resources.length !== packet.resources.length || packet.resources.length > 16
            || new Set(review.resources.map(resource => resource.relativePath)).size !== review.resources.length) throw new Error('incomplete');
          let imageCount = 0; let scriptCount = 0; let pythonCount = 0; let documentCount = 0; let documentBytes = 0; let previewTextBytes = 0; let pixels = 0; let textBytes = new TextEncoder().encode(review.content).length; let totalBytes = textBytes;
          for (const expected of packet.resources) {
            const resource = review.resources.find(row => row.relativePath === expected.relativePath);
            if (!resource || resource.digest !== expected.digest || resource.bytes !== expected.bytes || resource.mediaType !== expected.mediaType || resource.kind !== expected.kind) throw new Error('descriptor');
            if (resource.kind === 'document') {
              const preview = resource.preview;
              if (expected.kind !== 'document' || resource.format !== 'pdf' || expected.format !== 'pdf' || resource.mediaType !== 'application/pdf'
                || !/^(?:assets|references)\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.pdf$/i.test(resource.relativePath)
                || !Number.isSafeInteger(resource.bytes) || resource.bytes < 1 || resource.bytes > 2 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(resource.digest)
                || 'data' in resource || 'base64' in resource || 'content' in resource || !preview || preview.sourceSha256 !== resource.digest || preview.sourceBytes !== resource.bytes
                || preview.coverage !== 'text-layer-only' || !['completed', 'failed', 'unknown', 'unavailable'].includes(preview.state)
                || preview.extractor?.provider !== 'macos-pdfkit' || preview.extractor.version !== 1
                || preview.extractor.executableSha256 !== undefined && !/^[a-f0-9]{64}$/.test(preview.extractor.executableSha256)
                || preview.reason !== undefined && (typeof preview.reason !== 'string' || new TextEncoder().encode(preview.reason).length > 2048)
                || preview.text !== undefined && (typeof preview.text !== 'string' || preview.text.includes('\0') || new TextEncoder().encode(preview.text).length > 32 * 1024)) throw new Error('document');
              if (preview.state === 'completed' && (!preview.text?.trim() || !preview.extractor.executableSha256
                || !Number.isSafeInteger(preview.pageCount) || preview.pageCount! < 1 || preview.pageCount! > 32
                || !Number.isSafeInteger(preview.pagesWithText) || preview.pagesWithText! < 1
                || !Number.isSafeInteger(preview.pagesWithoutText) || preview.pagesWithoutText! < 0
                || preview.pagesWithText! + preview.pagesWithoutText! !== preview.pageCount)) throw new Error('document-preview');
              for (const count of [preview.pageCount, preview.pagesWithText, preview.pagesWithoutText]) if (count !== undefined && (!Number.isSafeInteger(count) || count < 0)) throw new Error('document-page-count');
              if (preview.text !== undefined && new TextDecoder('utf-8', { fatal: true }).decode(new TextEncoder().encode(preview.text)) !== preview.text) throw new Error('document-text-encoding');
              documentCount++; documentBytes += resource.bytes; previewTextBytes += new TextEncoder().encode(preview.text ?? '').length;
            } else if (resource.kind === 'image') {
              if (expected.kind !== 'image' || resource.width !== expected.width || resource.height !== expected.height) throw new Error('dimensions');
              const bytes = imagePreviewBytes(resource); imageCount++; pixels += resource.width * resource.height;
              if (!globalThis.crypto?.subtle) throw new Error('crypto-unavailable');
              const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
              if (digest !== resource.digest) throw new Error('digest');
            } else if (resource.kind === 'script') {
              const python = resource.mediaType === 'text/x-python' && resource.runtime === 'python';
              const javascript = resource.mediaType === 'text/javascript' && resource.runtime === undefined;
              if (expected.kind !== 'script' || expected.runtime !== resource.runtime || !python && !javascript || !resource.relativePath.startsWith('scripts/') || !/^scripts\/(?:[A-Za-z0-9_-][A-Za-z0-9._-]*\/)*[A-Za-z0-9_-][A-Za-z0-9._-]*\.(?:js|mjs|py)$/i.test(resource.relativePath)
                || python !== /\.py$/i.test(resource.relativePath)
                || typeof resource.content !== 'string' || resource.content.includes('\0') || !Number.isSafeInteger(resource.bytes) || resource.bytes < 0 || resource.bytes > 32 * 1024 || !/^[a-f0-9]{64}$/.test(resource.digest)) throw new Error('script');
              const sourceBytes = new TextEncoder().encode(resource.content);
              if (sourceBytes.length !== resource.bytes) throw new Error('script-bytes');
              if (!globalThis.crypto?.subtle) throw new Error('crypto-unavailable');
              const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', sourceBytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
              if (digest !== resource.digest) throw new Error('script-digest');
              scriptCount++;
              if (python) pythonCount++;
            } else {
              if (typeof resource.content !== 'string' || new TextEncoder().encode(resource.content).length !== resource.bytes || resource.bytes > 32 * 1024) throw new Error('text');
              textBytes += resource.bytes;
            }
            totalBytes += resource.bytes;
          }
          if (imageCount > 8 || documentCount > 4 || previewTextBytes > 128 * 1024 || pixels > 32 * 1024 * 1024 || textBytes > 128 * 1024 || totalBytes !== packet.totalBytes || totalBytes > (documentCount ? 4096 : imageCount || scriptCount ? 512 : 128) * 1024
            || totalBytes - documentBytes > (imageCount || scriptCount ? 512 : 128) * 1024
            || (documentCount > 0 ? packet.version !== 5 || packet.kind !== 'selected-local-document-package' : scriptCount > 0 && (pythonCount > 0 ? packet.version !== 4 || packet.kind !== 'selected-local-polyglot-package' : packet.version !== 3 || packet.kind !== 'selected-local-executable-package'))) throw new Error('bounds');
        }
        if (active && currentReview.current === review) setBytesVerified(review);
      } catch (cause) { if (active && currentReview.current === review) setPreviewError(cause instanceof Error && cause.message === 'crypto-unavailable' ? 'crypto-unavailable' : 'invalid'); }
    })();
    return () => { active = false; };
  }, [review]);
  const imageResources = review?.resources?.filter(resource => resource.kind === 'image') ?? [];
  const scriptResources = review?.resources?.filter(resource => resource.kind === 'script') ?? [];
  const documentResources = review?.resources?.filter(resource => resource.kind === 'document') ?? [];
  const packageReviewComplete = bytesVerified === review && (imageResources.length === 0 || decodedPreview.review === review && !decodedPreview.failed && imageResources.every(resource => decodedPreview.paths.includes(resource.relativePath)));
  const imageDecoded = (owner: ManagedSkillReviewView, resource: ManagedSkillImageResourceView, width: number, height: number) => {
    if (currentReview.current !== owner) return;
    if (width !== resource.width || height !== resource.height) { imageDecodeFailed(owner); return; }
    setDecodedPreview(previous => previous.review !== owner || previous.failed || previous.paths.includes(resource.relativePath) ? previous : { ...previous, paths: [...previous.paths, resource.relativePath] });
  };
  const imageDecodeFailed = (owner: ManagedSkillReviewView) => {
    if (currentReview.current !== owner) return;
    setDecodedPreview(previous => previous.review !== owner ? previous : { ...previous, failed: true });
    setPreviewError('invalid');
  };
  const importReviewComplete = packageReviewComplete && (scriptResources.length === 0 || scriptReviewAcknowledged === review) && (documentResources.length === 0 || pdfReviewAcknowledged === review);
  return <Panel title={choose('Managed local skill copies', 'Управляемые локальные копии skills')}>
    <Notice>{choose('Import copies only explicitly selected local instructions, supporting text, PNG/JPEG images, JS/MJS/Python scripts and PDF documents into private NEKODEX storage. You may also select supporting files beneath that skill directory. This grants no tools, filesystem access or execution. Other executable and binary formats, network resources and official/vendor plugin copies are unsupported. Existing source files and client registries stay with their owner.', 'Импорт копирует только явно выбранные локальные инструкции, вспомогательный текст, изображения PNG/JPEG, скрипты JS/MJS/Python и PDF-документы в частное хранилище NEKODEX. Можно также выбрать вспомогательные файлы внутри каталога этой skill. Это не даёт инструментов, доступа к файлам или исполнения. Другие исполняемые и двоичные форматы, сетевые ресурсы и копии официальных или сторонних плагинов не поддерживаются. Исходные файлы и клиентские реестры остаются у своего владельца.')}</Notice>
    <Select label={choose('Discovered local source', 'Найденный локальный источник')} value={sourceId} disabled={locked} options={[{ value: '', label: choose('Discover and choose a source above', 'Найдите и выберите источник выше') }, ...sources.map(source => ({ value: source.id, label: `${source.relativePath} · ${source.digest.slice(0, 12)}` }))]} onChange={value => { setSourceId(value); setResourcePaths(''); freshReview(); }} />
    <TextField label={choose('Managed label', 'Название копии')} value={label} disabled={locked} onChange={event => { setLabel(event.target.value); freshReview(); }} />
    <Select label={choose('Import or explicit update', 'Импорт или явное обновление')} value={lineage} disabled={locked} options={[{ value: '', label: choose('Review this local source', 'Проверить этот локальный источник') }, ...lineageOptions]} onChange={value => { setLineage(value); freshReview(); }} />
    <div className="nk-field"><label htmlFor={resourcePathsId}>{choose('Supporting files (optional, one relative path per line)', 'Вспомогательные файлы (необязательно, относительный путь в каждой строке)')}</label>
      <textarea className="nk-input" id={resourcePathsId} rows={3} maxLength={16384} value={resourcePaths} disabled={locked} aria-describedby={`${resourcePathsId}-hint`} onChange={event => { setResourcePaths(event.target.value); freshReview(); }} />
      <p className="nk-field__hint" id={`${resourcePathsId}-hint`}>{choose('Text/image/PDF paths start with references/ or assets/, and JS/MJS/Python paths with scripts/, beneath the selected SKILL.md directory, for example references/guide.md. Select up to 16 .md, .txt, .json, .csv, .png, .jpg, .jpeg, .js, .mjs, .py or .pdf files. Scripts: UTF-8 without NUL, 32 KiB per file; reviewed source is not sent as instructions and never runs automatically. Text: 32 KiB per file, 128 KiB including SKILL.md. Images: 160 KiB each, 8192 pixels per dimension and 16 Mi pixels per image; up to 8 images and 32 Mi pixels combined. PDFs: 2 MiB each, up to 4, text-layer preview only. Packages with PDFs: 4 MiB total, including at most 512 KiB of non-PDF resources; other mixed packages: 512 KiB total. Leave empty to import only SKILL.md. Files are read only when you request a review.', 'Пути текста, изображений и PDF начинаются с references/ или assets/, а JS/MJS/Python — с scripts/ внутри каталога выбранного SKILL.md, например references/guide.md. До 16 файлов .md, .txt, .json, .csv, .png, .jpg, .jpeg, .js, .mjs, .py или .pdf. Скрипты: UTF-8 без NUL, до 32 КиБ на файл; исходный код не передаётся как инструкции и не исполняется автоматически. Текст: 32 КиБ на файл, 128 КиБ вместе с SKILL.md. Изображения: до 160 КиБ каждое, до 8192 пикселей по каждой стороне и 16 Ми пикселей на изображение; до 8 изображений и 32 Ми пикселей суммарно. PDF: до 2 МиБ каждый, до 4 файлов, просмотр только текстового слоя. Набор с PDF: до 4 МиБ, включая не более 512 КиБ прочих ресурсов; другие смешанные наборы: до 512 КиБ. Пустое поле — импорт только SKILL.md. Чтение выполняется только при запросе просмотра.')}</p>
    </div>
    <div className="agent-tools-state"><Button disabled={locked || !current || !label.trim() || !status?.capabilities.managedSkillImports} onClick={() => void act(async () => {
      const resources = resourcePaths.split('\n').map(value => value.trim()).filter(Boolean);
      if (resources.length > 16 || new Set(resources).size !== resources.length || resources.some(path => path.length > 512 || !/^(references|assets|scripts)\//.test(path) || !(/^(references|assets)\/.+\.(md|txt|json|csv|png|jpg|jpeg|pdf)$/i.test(path) || /^scripts\/.+\.(js|mjs|py)$/i.test(path)) || path.split('/').length > 6 || path.split('/').some(part => !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part) || /^(?:secrets?|credentials?|tokens?|passwords?)(?:[._-]|$)/i.test(part)))) throw new Error(choose('Select up to 16 unique text/image/PDF paths in references/ or assets/, or JS/MJS/Python paths in scripts/. Use letters, numbers, underscores, hyphens and dots, with at most six path components. Other executable formats, secret stores, links and directory traversal are unsupported.', 'Укажите до 16 уникальных путей текста, изображений и PDF в references/ или assets/, либо JS/MJS/Python в scripts/. Допустимы латинские буквы, цифры, подчёркивания, дефисы и точки; до шести частей пути. Другие исполняемые форматы, хранилища секретов, ссылки и выход из каталога не поддерживаются.'));
      const input = resources.length ? { action: 'reviewSkillPackageImport', actionId, selection: { identity: current, resources }, label, updateLineageId: lineage || undefined, explicitUserAction: true }
        : { action: 'reviewSkillImport', actionId, identity: current, label, updateLineageId: lineage || undefined, explicitUserAction: true };
      setReview(await api.request(input) as ManagedSkillReviewView); await refresh();
    })}>{choose('Review the source and every selected file', 'Проверить источник и каждый выбранный файл')}</Button><Button disabled={locked} onClick={freshReview}>{choose('Start a new review', 'Начать новый просмотр')}</Button></div>
    {review ? <div><Badge>{review.action.state === 'reviewed' ? choose('Ready for your review', 'Готово к проверке') : review.action.state === 'imported' ? choose('Imported', 'Импортировано') : review.action.state === 'outcome_unknown' ? choose('Outcome unknown', 'Итог не установлен') : choose('In progress', 'В процессе')}</Badge><dl><dt>{choose('Name', 'Название')}</dt><dd>{review.action.label}</dd><dt>{choose('Source', 'Источник')}</dt><dd>{reviewedSource?.grant?.label} · {reviewedSource?.identity?.relativePath}</dd><dt>{choose('SKILL.md size', 'Размер SKILL.md')}</dt><dd>{reviewedSource?.identity?.bytes ?? 0} {choose('bytes', 'байт')}</dd><dt>SKILL.md SHA-256</dt><dd><code>{reviewedSource?.identity?.digest}</code></dd><dt>{choose('Immutable version', 'Зафиксированная версия')}</dt><dd><code title={review.action.versionId}>{review.action.versionId.slice(0, 16)}</code></dd>
      {reviewedSource?.package ? <><dt>{choose('Package SHA-256', 'SHA-256 набора')}</dt><dd><code>{reviewedSource.package.packageDigest}</code></dd><dt>{choose('Complete package size', 'Размер всего набора')}</dt><dd>{reviewedSource.package.totalBytes} {choose('bytes', 'байт')} · {reviewedSource.package.resources.length} {choose('supporting files', 'вспомогательных файлов')}</dd></> : null}</dl>
      {review.content !== undefined ? <><h3>SKILL.md</h3><pre>{review.content}</pre></> : null}
      {review.resources?.length ? <div><h3>{choose('Exact selected supporting files', 'Точные выбранные вспомогательные файлы')}</h3><ul className="agent-tools-records">{review.resources.map(resource => <li key={resource.relativePath}><strong>{resource.relativePath}</strong><small>{resource.mediaType} · {resource.bytes} {choose('bytes', 'байт')}</small>{resource.kind === 'script' ? <small>Runtime: {resource.runtime ?? 'javascript'}</small> : null}<code>SHA-256 {resource.digest}</code>{resource.kind === 'document' ? <PdfPreview resource={resource} verified={bytesVerified === review} choose={choose} /> : resource.kind === 'image' ? <><small>{resource.width} × {resource.height} {choose('pixels', 'пикселей')}</small>{bytesVerified === review ? <img className="agent-tools-resource-image" src={`data:${resource.mediaType};base64,${resource.data}`} width={resource.width} height={resource.height} alt={choose('Selected local image: ', 'Выбранное локальное изображение: ') + resource.relativePath} loading="lazy" decoding="async" onLoad={event => imageDecoded(review, resource, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} onError={() => imageDecodeFailed(review)} /> : null}</> : <>{resource.kind === 'script' ? <Badge>{choose('Reviewed source; separate run approval required', 'Исходный код; запуск требует отдельного подтверждения')}</Badge> : null}<pre>{resource.kind === 'script' ? resource.content.slice(0, 32 * 1024) : resource.content}</pre></>}</li>)}</ul></div> : null}
      {!packageReviewComplete ? <Notice tone="warning">{choose('The complete selected file preview is unavailable or still being verified. Import requires matching descriptors, verified image/script bytes, successful image decoding, and PDF preview SHA/size binding supplied by the local owner. The UI does not independently hash raw PDF bytes. Scroll through all selected previews to load them. Inspect the retained review again if verification fails.', 'Полный просмотр выбранных файлов недоступен или ещё проверяется. Для импорта должны совпасть описания файлов, проверенные байты изображений/скриптов, декодирование изображений и связь PDF-просмотра с SHA/размером от локального владельца. Интерфейс сам не хеширует исходные байты PDF. Прокрутите все выбранные изображения, чтобы загрузить их. При ошибке повторно откройте сохранённую квитанцию просмотра.')}</Notice> : null}
      {previewError === 'crypto-unavailable' ? <Notice tone="warning">{choose('Local SHA-256 verification is unavailable in this renderer. Image/script package import is blocked.', 'Локальная проверка SHA-256 недоступна в этом окне. Импорт набора с изображениями или скриптами заблокирован.')}</Notice> : null}
      {review.resources?.some(resource => resource.kind === 'image') ? <Notice>{choose('These local previews remain private in this window. Attaching a version shares image metadata only; each model image read requires separate approval of skill-resource/read.', 'Эти локальные изображения остаются частными в этом окне. Прикрепление версии передаёт только метаданные изображений; каждое чтение изображения моделью требует отдельного подтверждения skill-resource/read.')}</Notice> : null}
      {scriptResources.length ? <><Notice>{choose('Script source is shown for your review only. Import and attachment share metadata, grant no execution or workspace access, and do not insert code into model instructions. Running a script needs a separate explicit workspace grant and approval of each exact saved tool call.', 'Исходный код показан только для вашей проверки. Импорт и прикрепление передают метаданные, не дают исполнения или доступа к рабочему каталогу и не добавляют код в инструкции модели. Для запуска нужны отдельное явное разрешение на рабочий каталог и подтверждение каждого точного сохранённого вызова.')}</Notice><Checkbox disabled={locked || !packageReviewComplete} checked={scriptReviewAcknowledged === review} onChange={checked => setScriptReviewAcknowledged(checked ? review : null)} label={choose('I reviewed the exact script source and hashes shown above. This acknowledges import only.', 'Я проверил точный исходный код скриптов и хеши выше. Это подтверждает только импорт.')} /></> : null}
      {documentResources.length ? <><Notice>{choose('PDF review is limited to the available extracted text layer. A failed, unknown or unavailable preview may be unreadable; scanned pages have no OCR. Import and attachment expose metadata only. The model receives document text only after approval of its exact skill-resource/read request.', 'Просмотр PDF ограничен доступным извлечённым текстовым слоем. При failed, unknown или unavailable файл может быть нечитаемым; OCR сканов не выполняется. Импорт и прикрепление передают только метаданные. Модель получает текст документа только после подтверждения точного skill-resource/read.')}</Notice><Checkbox disabled={locked || !packageReviewComplete} checked={pdfReviewAcknowledged === review} onChange={checked => setPdfReviewAcknowledged(checked ? review : null)} label={choose('I acknowledge the selected PDF descriptors and preview limitations, including unavailable text and no OCR. This approves import only.', 'Я принимаю описания выбранных PDF и ограничения просмотра, включая недоступный текст и отсутствие OCR. Это разрешает только импорт.')} /></> : null}
      {review.action.state === 'reviewed' ? <Button disabled={locked || !importReviewComplete} onClick={() => void act(async () => { await api.request({ action: 'commitSkillImport', actionId: review.action.actionId, reviewDigest: review.action.reviewDigest, explicitUserAction: true }); setReview(await api.request({ action: 'managedSkillAction', actionId: review.action.actionId }) as ManagedSkillReviewView); await refresh(); })}>{choose('Import this reviewed immutable version', 'Импортировать эту проверенную версию')}</Button> : null}
      {review.action.state === 'imported' ? <Notice>{choose('Version imported. It is not attached automatically; select its task action below.', 'Версия импортирована. Она не прикрепляется автоматически; выберите действие для задачи ниже.')}</Notice> : null}
      {review.action.state === 'outcome_unknown' ? <Notice tone="warning">{choose('The retained import intent has no verified terminal copy. It will not be copied or committed automatically.', 'У сохранённой операции импорта нет подтверждённого результата. Автоматический повтор не выполняется.')}</Notice> : null}
    </div> : null}
    <details><summary>{choose('Receipt diagnostics and recovery', 'Диагностика квитанции')}</summary><TextField label={choose('Review receipt ID', 'ID квитанции просмотра')} value={actionId} disabled={locked} onChange={event => { setActionId(event.target.value); setReview(null); }} /><Button disabled={locked || !actionId} onClick={() => void act(async () => { setReview(await api.request({ action: 'managedSkillAction', actionId }) as ManagedSkillReviewView | null); await refresh(); })}>{choose('Inspect retained receipt', 'Посмотреть сохранённую квитанцию')}</Button>{review ? <pre>{JSON.stringify(review.action, null, 2)}</pre> : null}</details>
    <p>{choose('Updates create a separate retained version. Attaching it explicitly replaces that lineage for this task generation. Revocation/forget blocks future composition; already offered model input cannot be withdrawn. Referenced bytes and receipts are retained.', 'Обновление создаёт отдельную сохранённую версию. Явное прикрепление заменяет выбранную версию этой ветви для текущего поколения задачи. Отзыв или забывание блокирует последующее добавление текста в запросы; уже переданный модели текст нельзя отозвать. Связанные файлы и квитанции сохраняются.')}</p>
    {managed?.versions.length ? <ul className="agent-tools-records">{managed.versions.map(version => <li key={version.versionId}><strong>{version.label}</strong><code title={version.versionId}>{version.versionId.slice(0, 16)}</code><small>SKILL.md SHA-256 {version.contentDigest} · {version.bytes} {choose('bytes', 'байт')}</small>{version.packageDigest ? <small>{choose('Package SHA-256', 'SHA-256 набора')}: <code>{version.packageDigest}</code> · {version.resourceCount ?? 0} {choose('supporting files', 'вспомогательных файлов')}</small> : null}<Badge tone={version.revoked ? 'warning' : 'neutral'}>{version.revoked ? choose('Revoked; bytes retained', 'Отозвана; файлы сохранены') : attached.includes(version.versionId) ? choose('Attached to this generation', 'Прикреплена к этому поколению') : choose('Imported; not attached here', 'Импортирована; здесь не прикреплена')}</Badge><div className="agent-tools-state"><Button size="sm" disabled={locked || !scope || version.revoked} onClick={() => void act(async () => { await api.request({ action: 'attachManagedSkill', scope, versionId: version.versionId, explicitUserAction: true }); await refresh(); })}>{choose('Attach this exact version', 'Прикрепить эту версию')}</Button><Button size="sm" disabled={locked || !scope || !attached.includes(version.versionId)} onClick={() => void act(async () => { await api.request({ action: 'detachManagedSkill', scope, versionId: version.versionId, explicitUserAction: true }); await refresh(); })}>{choose('Detach from this generation', 'Открепить от этого поколения')}</Button><Button size="sm" disabled={locked || version.revoked} onClick={() => void act(async () => { await api.request({ action: 'revokeManagedSkill', versionId: version.versionId, forget: false, explicitUserAction: true }); await refresh(); })}>{choose('Revoke future use', 'Отозвать дальнейшее использование')}</Button><Button size="sm" disabled={locked} onClick={() => void act(async () => { await api.request({ action: 'revokeManagedSkill', versionId: version.versionId, forget: true, explicitUserAction: true }); await refresh(); })}>{choose('Forget and retain referenced data', 'Забыть с сохранением связанных данных')}</Button></div></li>)}</ul> : null}
    {managed?.actions.map(action => <div className="agent-tools-root" key={action.actionId}><span>{action.label} · {action.state}</span><Button size="sm" disabled={locked} onClick={() => void act(async () => { setActionId(action.actionId); setReview(await api.request({ action: 'managedSkillAction', actionId: action.actionId }) as ManagedSkillReviewView); await refresh(); })}>{choose('Inspect import receipt', 'Посмотреть import receipt')}</Button></div>)}
    <small>{choose('Retained versions', 'Сохранённых версий')}: {managed?.retainedVersions ?? 0} · {choose('Forgotten', 'Забытых')}: {managed?.forgottenVersions ?? 0}. {choose('No automatic cleanup or deletion.', 'Автоматическое удаление не выполняется.')}</small>
  </Panel>;
}

/** Host validates PNG CRC/JPEG structure first; renderer also bounds and pins the exact local data URL. */
function imagePreviewBytes(resource: Extract<ManagedSkillResourceView, { kind: 'image' }>): Uint8Array<ArrayBuffer> {
  if (!['image/png', 'image/jpeg'].includes(resource.mediaType) || !Number.isSafeInteger(resource.bytes) || resource.bytes < 1 || resource.bytes > 160 * 1024
    || !Number.isSafeInteger(resource.width) || !Number.isSafeInteger(resource.height) || resource.width < 1 || resource.height < 1 || resource.width * resource.height > 16 * 1024 * 1024
    || resource.width > 8192 || resource.height > 8192 || !/^[a-f0-9]{64}$/.test(resource.digest) || typeof resource.data !== 'string' || resource.data.length !== Math.ceil(resource.bytes / 3) * 4
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(resource.data)) throw new Error('image');
  const decoded = atob(resource.data);
  if (decoded.length !== resource.bytes || btoa(decoded) !== resource.data) throw new Error('base64');
  const bytes = new Uint8Array(decoded.length); for (let index = 0; index < decoded.length; index++) bytes[index] = decoded.charCodeAt(index);
  if (resource.mediaType === 'image/png' ? [137, 80, 78, 71, 13, 10, 26, 10].some((value, index) => bytes[index] !== value) : bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error('mime');
  return bytes;
}
