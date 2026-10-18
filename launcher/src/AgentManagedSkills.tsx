import { useEffect, useId, useRef, useState } from 'react';
import { Badge, Button, Notice, Panel, Select, TextField } from './design';
import type { AgentToolsApi, AgentToolsStatus, ManagedSkillReviewView, ManagedSkillResourceView, ManagedSkillTextResourceView, ManagedSkillImageResourceView, SkillIdentity, ToolScope } from './agent-tools-types';
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
  const reviewedSource = review?.action.manifest as { grant?: { label?: string }; identity?: { relativePath?: string; bytes?: number; digest?: string }; package?: { packageDigest: string; totalBytes: number; resources: (Omit<ManagedSkillTextResourceView, 'content'> | Omit<ManagedSkillImageResourceView, 'data'>)[] } } | undefined;
  const currentReview = useRef(review); currentReview.current = review;
  const [bytesVerified, setBytesVerified] = useState<ManagedSkillReviewView | null>(null);
  const [decodedPreview, setDecodedPreview] = useState<{ review: ManagedSkillReviewView | null; paths: string[]; failed: boolean }>({ review: null, paths: [], failed: false });
  const [previewError, setPreviewError] = useState('');
  useEffect(() => {
    let active = true; setBytesVerified(null); setDecodedPreview({ review, paths: [], failed: false }); setPreviewError('');
    if (!review) return;
    void (async () => {
      try {
        const packet = reviewedSource?.package;
        if (!packet && review.resources?.length) throw new Error('missing-manifest');
        if (packet) {
          if (review.content === undefined || !Array.isArray(review.resources) || review.resources.length !== packet.resources.length || packet.resources.length > 16
            || new Set(review.resources.map(resource => resource.relativePath)).size !== review.resources.length) throw new Error('incomplete');
          let imageCount = 0; let pixels = 0; let textBytes = new TextEncoder().encode(review.content).length; let totalBytes = textBytes;
          for (const expected of packet.resources) {
            const resource = review.resources.find(row => row.relativePath === expected.relativePath);
            if (!resource || resource.digest !== expected.digest || resource.bytes !== expected.bytes || resource.mediaType !== expected.mediaType || resource.kind !== expected.kind) throw new Error('descriptor');
            if (resource.kind === 'image') {
              if (expected.kind !== 'image' || resource.width !== expected.width || resource.height !== expected.height) throw new Error('dimensions');
              const bytes = imagePreviewBytes(resource); imageCount++; pixels += resource.width * resource.height;
              if (!globalThis.crypto?.subtle) throw new Error('crypto-unavailable');
              const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(byte => byte.toString(16).padStart(2, '0')).join('');
              if (digest !== resource.digest) throw new Error('digest');
            } else {
              if (typeof resource.content !== 'string' || new TextEncoder().encode(resource.content).length !== resource.bytes || resource.bytes > 32 * 1024) throw new Error('text');
              textBytes += resource.bytes;
            }
            totalBytes += resource.bytes;
          }
          if (imageCount > 8 || pixels > 32 * 1024 * 1024 || textBytes > 128 * 1024 || totalBytes !== packet.totalBytes || totalBytes > (imageCount ? 512 : 128) * 1024) throw new Error('bounds');
        }
        if (active && currentReview.current === review) setBytesVerified(review);
      } catch (cause) { if (active && currentReview.current === review) setPreviewError(cause instanceof Error && cause.message === 'crypto-unavailable' ? 'crypto-unavailable' : 'invalid'); }
    })();
    return () => { active = false; };
  }, [review]);
  const imageResources = review?.resources?.filter(resource => resource.kind === 'image') ?? [];
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
  return <Panel title={choose('Managed local skill copies', 'Управляемые локальные копии skills')}>
    <Notice>{choose('Import copies only explicitly selected local instructions, supporting text and PNG/JPEG images into private NEKODEX storage. You may also select supporting files beneath that skill directory. This grants no tools, filesystem access or execution. Scripts, other binary formats, network resources and official/vendor plugin copies are unsupported. Existing source files and client registries stay with their owner.', 'Импорт копирует только явно выбранные локальные инструкции, вспомогательный текст и изображения PNG/JPEG в частное хранилище NEKODEX. Можно также выбрать вспомогательные файлы внутри каталога этой skill. Это не даёт инструментов, доступа к файлам или исполнения. Скрипты, другие двоичные форматы, сетевые ресурсы и копии официальных или сторонних плагинов не поддерживаются. Исходные файлы и клиентские реестры остаются у своего владельца.')}</Notice>
    <Select label={choose('Discovered local source', 'Найденный локальный источник')} value={sourceId} disabled={locked} options={[{ value: '', label: choose('Discover and choose a source above', 'Найдите и выберите источник выше') }, ...sources.map(source => ({ value: source.id, label: `${source.relativePath} · ${source.digest.slice(0, 12)}` }))]} onChange={value => { setSourceId(value); setResourcePaths(''); freshReview(); }} />
    <TextField label={choose('Managed label', 'Название копии')} value={label} disabled={locked} onChange={event => { setLabel(event.target.value); freshReview(); }} />
    <Select label={choose('Import or explicit update', 'Импорт или явное обновление')} value={lineage} disabled={locked} options={[{ value: '', label: choose('Review this local source', 'Проверить этот локальный источник') }, ...lineageOptions]} onChange={value => { setLineage(value); freshReview(); }} />
    <div className="nk-field"><label htmlFor={resourcePathsId}>{choose('Supporting text and PNG/JPEG files (optional, one relative path per line)', 'Вспомогательные текстовые файлы и PNG/JPEG (необязательно, относительный путь в каждой строке)')}</label>
      <textarea className="nk-input" id={resourcePathsId} rows={3} maxLength={16384} value={resourcePaths} disabled={locked} aria-describedby={`${resourcePathsId}-hint`} onChange={event => { setResourcePaths(event.target.value); freshReview(); }} />
      <p className="nk-field__hint" id={`${resourcePathsId}-hint`}>{choose('Paths start with references/ or assets/ beneath the selected SKILL.md directory, for example references/guide.md. Select up to 16 .md, .txt, .json, .csv, .png, .jpg or .jpeg files. Text: 32 KiB per file, 128 KiB including SKILL.md. Images: 160 KiB each, 8192 pixels per dimension and 16 Mi pixels per image; up to 8 images and 32 Mi pixels combined. Mixed package: 512 KiB total. Leave empty to import only SKILL.md. Files are read only when you request a review.', 'Пути начинаются с references/ или assets/ внутри каталога выбранного SKILL.md, например references/guide.md. До 16 файлов .md, .txt, .json, .csv, .png, .jpg или .jpeg. Текст: 32 КиБ на файл, 128 КиБ вместе с SKILL.md. Изображения: до 160 КиБ каждое, до 8192 пикселей по каждой стороне и 16 Ми пикселей на изображение; до 8 изображений и 32 Ми пикселей суммарно. Смешанный набор: до 512 КиБ. Пустое поле — импорт только SKILL.md. Чтение выполняется только при запросе просмотра.')}</p>
    </div>
    <div className="agent-tools-state"><Button disabled={locked || !current || !label.trim() || !status?.capabilities.managedSkillImports} onClick={() => void act(async () => {
      const resources = resourcePaths.split('\n').map(value => value.trim()).filter(Boolean);
      if (resources.length > 16 || new Set(resources).size !== resources.length || resources.some(path => path.length > 512 || !/^(references|assets)\//.test(path) || path.split('/').length > 6 || path.split('/').some(part => !/^[A-Za-z0-9_-][A-Za-z0-9._-]*$/.test(part) || /^(?:secrets?|credentials?|tokens?|passwords?)(?:[._-]|$)/i.test(part)) || !/\.(md|txt|json|csv|png|jpg|jpeg)$/i.test(path))) throw new Error(choose('Select up to 16 unique relative text or PNG/JPEG paths in references/ or assets/. Use letters, numbers, underscores, hyphens and dots, with at most six path components. Scripts, secret stores, links and directory traversal are unsupported.', 'Укажите до 16 уникальных относительных путей в references/ или assets/. Допустимы латинские буквы, цифры, подчёркивания, дефисы и точки; до шести частей пути. Скрипты, хранилища секретов, ссылки и выход из каталога не поддерживаются.'));
      const input = resources.length ? { action: 'reviewSkillPackageImport', actionId, selection: { identity: current, resources }, label, updateLineageId: lineage || undefined, explicitUserAction: true }
        : { action: 'reviewSkillImport', actionId, identity: current, label, updateLineageId: lineage || undefined, explicitUserAction: true };
      setReview(await api.request(input) as ManagedSkillReviewView); await refresh();
    })}>{choose('Review the source and every selected file', 'Проверить источник и каждый выбранный файл')}</Button><Button disabled={locked} onClick={freshReview}>{choose('Start a new review', 'Начать новый просмотр')}</Button></div>
    {review ? <div><Badge>{review.action.state === 'reviewed' ? choose('Ready for your review', 'Готово к проверке') : review.action.state === 'imported' ? choose('Imported', 'Импортировано') : review.action.state === 'outcome_unknown' ? choose('Outcome unknown', 'Итог не установлен') : choose('In progress', 'В процессе')}</Badge><dl><dt>{choose('Name', 'Название')}</dt><dd>{review.action.label}</dd><dt>{choose('Source', 'Источник')}</dt><dd>{reviewedSource?.grant?.label} · {reviewedSource?.identity?.relativePath}</dd><dt>{choose('SKILL.md size', 'Размер SKILL.md')}</dt><dd>{reviewedSource?.identity?.bytes ?? 0} {choose('bytes', 'байт')}</dd><dt>SKILL.md SHA-256</dt><dd><code>{reviewedSource?.identity?.digest}</code></dd><dt>{choose('Immutable version', 'Зафиксированная версия')}</dt><dd><code title={review.action.versionId}>{review.action.versionId.slice(0, 16)}</code></dd>
      {reviewedSource?.package ? <><dt>{choose('Package SHA-256', 'SHA-256 набора')}</dt><dd><code>{reviewedSource.package.packageDigest}</code></dd><dt>{choose('Complete package size', 'Размер всего набора')}</dt><dd>{reviewedSource.package.totalBytes} {choose('bytes', 'байт')} · {reviewedSource.package.resources.length} {choose('supporting files', 'вспомогательных файлов')}</dd></> : null}</dl>
      {review.content !== undefined ? <><h3>SKILL.md</h3><pre>{review.content}</pre></> : null}
      {review.resources?.length ? <div><h3>{choose('Exact selected supporting files', 'Точные выбранные вспомогательные файлы')}</h3><ul className="agent-tools-records">{review.resources.map(resource => <li key={resource.relativePath}><strong>{resource.relativePath}</strong><small>{resource.mediaType} · {resource.bytes} {choose('bytes', 'байт')}</small><code>SHA-256 {resource.digest}</code>{resource.kind === 'image' ? <><small>{resource.width} × {resource.height} {choose('pixels', 'пикселей')}</small>{bytesVerified === review ? <img className="agent-tools-resource-image" src={`data:${resource.mediaType};base64,${resource.data}`} width={resource.width} height={resource.height} alt={choose('Selected local image: ', 'Выбранное локальное изображение: ') + resource.relativePath} loading="lazy" decoding="async" onLoad={event => imageDecoded(review, resource, event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} onError={() => imageDecodeFailed(review)} /> : null}</> : <pre>{resource.content}</pre>}</li>)}</ul></div> : null}
      {!packageReviewComplete ? <Notice tone="warning">{choose('The complete selected file preview is unavailable or still being verified. Import requires every selected descriptor and image SHA-256 to match, and every image preview to decode successfully. Scroll through all selected previews to load them. Inspect the retained review again if verification fails.', 'Полный просмотр выбранных файлов недоступен или ещё проверяется. Для импорта должны совпасть все описания файлов и SHA-256 изображений, а каждое изображение должно успешно отобразиться. Прокрутите все выбранные изображения, чтобы загрузить их. При ошибке повторно откройте сохранённую квитанцию просмотра.')}</Notice> : null}
      {previewError === 'crypto-unavailable' ? <Notice tone="warning">{choose('Local SHA-256 verification is unavailable in this renderer. Image package import is blocked.', 'Локальная проверка SHA-256 недоступна в этом окне. Импорт набора с изображениями заблокирован.')}</Notice> : null}
      {review.resources?.some(resource => resource.kind === 'image') ? <Notice>{choose('These local previews remain private in this window. Attaching a version shares image metadata only; each model image read requires separate approval of skill-resource/read.', 'Эти локальные изображения остаются частными в этом окне. Прикрепление версии передаёт только метаданные изображений; каждое чтение изображения моделью требует отдельного подтверждения skill-resource/read.')}</Notice> : null}
      {review.action.state === 'reviewed' ? <Button disabled={locked || !packageReviewComplete} onClick={() => void act(async () => { await api.request({ action: 'commitSkillImport', actionId: review.action.actionId, reviewDigest: review.action.reviewDigest, explicitUserAction: true }); setReview(await api.request({ action: 'managedSkillAction', actionId: review.action.actionId }) as ManagedSkillReviewView); await refresh(); })}>{choose('Import this reviewed immutable version', 'Импортировать эту проверенную версию')}</Button> : null}
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
