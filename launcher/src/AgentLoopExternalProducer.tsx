import { useEffect, useId, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Checkbox, Notice, Panel, PanelStack, TextField } from './design';
import type { AgentTask } from './agent-mode-types';
import type { AgentLoopSourceAuthority } from '../../src/agent-mode/types';
import type { Language } from './types';
import { stripIpcErrorPrefix } from './ipc-error';
import './surfaces/agent-loop-external-producer.css';

type Scope = { familyId: string; generation: number; revision: number };
export interface LoopExternalProducerReceipt {
  producerId: string; eventId: string; sourceEventKey: string; state: 'accepted' | 'unchanged'; observationDigest: string;
  workId?: string; workKey?: string; taskId: string; generation: number; revision: number; createdAt: number;
}
export interface LoopExternalProducerRow {
  producerId: string; taskId: string; label: string; instruction: string; eventBound: number; acceptedEvents: number;
  remainingEvents: number; revoked: boolean; active: boolean; reason: string; authority: AgentLoopSourceAuthority;
  createdAt: number; credentialConfigured: true; receipts: LoopExternalProducerReceipt[]; receiptCount?: number; receiptsTruncated?: boolean;
}
export interface LoopExternalProducerStatus { rows: LoopExternalProducerRow[]; origin?: string; total?: number; truncated?: boolean }
export interface LoopExternalProducerReview {
  reviewId: string; reviewDigest: string; taskId: string; scope: Scope; label: string; instruction: string;
  eventBound: number; authority: AgentLoopSourceAuthority;
}
export type LoopExternalProducerRequest = { action: 'status'; taskId?: string }
  | { action: 'review'; taskId: string; scope: Scope; label: string; instruction: string; eventBound: number; explicitUserAction: true }
  | { action: 'register'; reviewId: string; reviewDigest: string; actionId: string; explicitUserAction: true }
  | { action: 'rotate'; producerId: string; actionId: string; explicitUserAction: true }
  | { action: 'revoke'; producerId: string; explicitUserAction: true };
/** This public DTO deliberately contains no credential or credential hash. */
export interface LoopExternalProducerResponse {
  status: LoopExternalProducerStatus; review?: LoopExternalProducerReview; credentialCopied: boolean; created?: boolean; rotated?: boolean;
}
export type LoopExternalProducerTransport = (body: LoopExternalProducerRequest) => Promise<LoopExternalProducerResponse>;
export interface AgentLoopExternalProducerProps {
  task: AgentTask | null; authority?: AgentLoopSourceAuthority; request: LoopExternalProducerTransport;
  language: Language; disabled?: boolean; observationKey?: string;
}
type UnknownAction = { action: 'register' | 'rotate'; actionId: string; taskId: string; runId: string; producerId?: string; inspected: boolean; replacementConfirmed?: boolean };
const sameScope = (a: Scope, b: Scope) => a.familyId === b.familyId && a.generation === b.generation && a.revision === b.revision;

/** Selected-task presentation only. Main owns credential generation, clipboard,
 * reviewed registration and the authenticated producer endpoint. */
export function AgentLoopExternalProducer({ task, authority, request, language, disabled = false, observationKey = '' }: AgentLoopExternalProducerProps) {
  const ru = language === 'ru'; const t = (en: string, russian: string) => ru ? russian : en;
  const transport = useRef(request); transport.current = request;
  const selectedTask = useRef(task); selectedTask.current = task;
  const mounted = useRef(false), reads = useRef(0), actions = useRef(new Set<string>());
  const scope = task ? { familyId: task.familyId, generation: task.generation, revision: task.revision } : null;
  const contextKey = JSON.stringify([task?.id, task?.familyId, task?.generation, task?.revision, task?.status, authority?.runId, observationKey]);
  const context = useRef(contextKey); context.current = contextKey;
  const [status, setStatus] = useState<LoopExternalProducerStatus | null>(null);
  const [review, setReview] = useState<LoopExternalProducerReview | null>(null);
  const [label, setLabel] = useState(''); const [instruction, setInstruction] = useState(''); const [bound, setBound] = useState('4');
  const [acknowledged, setAcknowledged] = useState(false); const [rotationAcknowledged, setRotationAcknowledged] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]); const [error, setError] = useState<string | null>(null);
  const [unknown, setUnknown] = useState<UnknownAction | null>(null);
  const [clipboardResult, setClipboardResult] = useState<{ actionId: string; copied: boolean } | null>(null);
  const instructionId = useId(); const busy = pending.length > 0;
  const eventBound = Number(bound);
  const live = Boolean(task?.mode === 'loop' && scope && authority?.active && sameScope(scope, authority)
    && ['ready', 'running', 'review_required'].includes(task.status));
  const currentProducer = status?.rows.find(row => row.taskId === task?.id && row.authority.runId === authority?.runId && !row.revoked);
  const heldRegistration = Boolean(unknown?.action === 'register' && !unknown.replacementConfirmed && unknown.taskId === task?.id && unknown.runId === authority?.runId);
  const rotationHeld = (row: LoopExternalProducerRow) => Boolean(unknown && !unknown.inspected && !unknown.replacementConfirmed && unknown.taskId === row.taskId && unknown.runId === row.authority.runId);
  const substantive = instruction.trim().length > 0 && instruction.trim().length <= 4096
    && !/^(?:continue|proceed|go on|keep (?:going|working)|продолжай|продолжить)[.!\s]*$/iu.test(instruction.trim());
  const valid = label.trim().length > 0 && label.trim().length <= 160 && substantive && Number.isSafeInteger(eventBound) && eventBound >= 1 && eventBound <= 512;
  const currentReview = review && task && scope && authority && review.taskId === task.id && sameScope(review.scope, scope)
    && review.authority.runId === authority.runId && review.label === label.trim() && review.instruction === instruction.trim() && review.eventBound === eventBound ? review : null;

  function accept(value: LoopExternalProducerResponse, captured: string) {
    if (!Array.isArray(value.status?.rows)) throw new Error(t('External producer metadata is unavailable.', 'Метаданные внешнего источника недоступны.'));
    if (mounted.current && context.current === captured) setStatus(value.status);
  }
  async function load(explicitInspection = false) {
    const captured = context.current, sequence = ++reads.current;
    const taskId = selectedTask.current?.id;
    const value = await transport.current({ action: 'status', ...(taskId ? { taskId } : {}) });
    if (sequence !== reads.current) return;
    accept(value, captured);
    if (explicitInspection && mounted.current && context.current === captured) setUnknown(old => old && (!taskId || old.taskId === taskId) ? { ...old, inspected: true } : old);
  }
  async function perform(key: string, body: LoopExternalProducerRequest) {
    const privacy = body.action === 'revoke';
    if (actions.current.has(key) || body.action !== 'status' && !privacy && (actions.current.size > 0 || disabled)) return;
    const captured = context.current;
    const operationRead = body.action === 'status' ? 0 : ++reads.current;
    const affectedRow = body.action === 'rotate' ? status?.rows.find(row => row.producerId === body.producerId) : undefined;
    actions.current.add(key); setPending(old => [...old, key]); setError(null);
    if (body.action === 'review' || body.action === 'register') { setReview(null); setAcknowledged(false); }
    if (body.action === 'rotate') setRotationAcknowledged(null);
    if (body.action === 'register' || body.action === 'rotate') setClipboardResult(null);
    try {
      if (body.action === 'status') await load(true);
      else {
        const value = await transport.current(body);
        if (operationRead === reads.current) accept(value, captured); else await load();
        if (mounted.current && context.current === captured && body.action === 'review' && value.review && operationRead === reads.current) setReview(value.review);
        if (mounted.current && context.current === captured && (body.action === 'register' || body.action === 'rotate')) {
          setClipboardResult({ actionId: body.actionId, copied: value.credentialCopied === true });
          if (body.action === 'rotate') setUnknown(old => old && affectedRow && old.taskId === affectedRow.taskId && old.runId === affectedRow.authority.runId ? { ...old, replacementConfirmed: true } : old);
        }
      }
    } catch (reason) {
      if (mounted.current) {
        setError(stripIpcErrorPrefix(reason instanceof Error ? reason.message : String(reason)));
        if (body.action === 'register' || body.action === 'rotate') setUnknown({ action: body.action, actionId: body.actionId,
          taskId: affectedRow?.taskId ?? task?.id ?? '', runId: affectedRow?.authority.runId ?? authority?.runId ?? '', ...(body.action === 'rotate' ? { producerId: body.producerId } : {}), inspected: false });
      }
      if (body.action !== 'status') try { await load(); } catch { /* Keep the original outcome and never replay. */ }
    } finally { actions.current.delete(key); if (mounted.current) setPending(old => old.filter(item => item !== key)); }
  }
  useEffect(() => {
    mounted.current = true; setReview(null); setAcknowledged(false); setRotationAcknowledged(null); setClipboardResult(null); setStatus(null); setError(null);
    void load().catch(reason => { if (mounted.current && context.current === contextKey) setError(stripIpcErrorPrefix(reason instanceof Error ? reason.message : String(reason))); });
    return () => { mounted.current = false; ++reads.current; };
  }, [contextKey]);
  const edit = (change: () => void) => { change(); setReview(null); setAcknowledged(false); };
  function setup(row: LoopExternalProducerRow) {
    const origin = status?.origin;
    const example = { producerId: row.producerId, eventId: 'event-001', sourceEventKey: 'report-revision-001',
      subject: 'Report revision changed', observationText: 'The report revision now contains a changed risk count.', observedAt: '2026-10-19T00:00:00Z' };
    return <details className="agent-loop-external-producer__setup"><summary>{t('Set up the external producer', 'Настроить внешний источник')}</summary>
      <p>{t('Use the bundled codex-chatgpt-web CLI. Supply the copied credential through standard input only; never put it in command arguments or the observation file. These examples do not run automatically.', 'Используйте CLI codex-chatgpt-web из поставки приложения. Передавайте скопированный credential только через стандартный ввод; не помещайте его в аргументы команды или файл наблюдения. Эти примеры не запускаются автоматически.')}</p>
      <p>{t('Producer ID', 'ID источника')}: <code>{row.producerId}</code><br />{t('Core origin', 'Адрес core')}: <code>{origin ?? t('Inspect status to obtain the current address', 'Обновите состояние для получения текущего адреса')}</code></p>
      {!row.active ? <Notice>{t('This binding is inactive, so it cannot publish new work. Retained receipt inspection does not reactivate it.', 'Эта привязка неактивна и не может публиковать новую работу. Проверка сохранённой квитанции не активирует её.')}</Notice> : null}
      <p>{t('Save this example as observation.json; replace the observation, timestamp and stable event identities for your event.', 'Сохраните пример в observation.json; укажите своё наблюдение, время и устойчивые идентификаторы события.')}</p>
      <pre><code>{JSON.stringify(example, null, 2)}</code></pre>
      {origin ? <>
        <p>{t('Publish once using a private outbox directory; retain that directory for exact receipt inspection.', 'Опубликуйте один раз, используя приватный каталог исходящих событий; сохраните этот каталог для проверки точной квитанции.')}</p>
        <pre><code>{`codex-chatgpt-web loop-events publish --origin '${origin}' --journal-dir './private-loop-outbox' --event-file './observation.json' --token-stdin`}</code></pre>
        <p>{t('For an event submitted through this CLI, inspect its receipt with the same origin, private journal, producer ID and event ID. An unknown publish result is not permission to submit the observation under a new identity.', 'Для события, отправленного этим CLI, проверьте квитанцию с тем же адресом core, приватным журналом, ID источника и ID события. Неопределённый результат публикации не разрешает отправлять наблюдение под новым идентификатором.')}</p>
        <pre><code>{`codex-chatgpt-web loop-events receipt --origin '${origin}' --journal-dir './private-loop-outbox' --producer-id '${row.producerId}' --event-id 'event-001' --token-stdin`}</code></pre>
      </> : <Notice>{t('Inspect producer status before configuring the CLI. No core address is inferred from saved history.', 'Перед настройкой CLI обновите состояние источника. Адрес core не выводится из сохранённой истории.')}</Notice>}
    </details>;
  }

  return <section className="agent-loop-external-producer" aria-label={t('Authenticated external Loop producer', 'Авторизованный внешний источник Loop')}>
    <Panel title={t('External Loop events', 'Внешние события Loop')}><PanelStack>
      <BadgeRow><Badge>{t('Off until explicit registration', 'Выключен до явной регистрации')}</Badge><Badge>{t('Credential stays protected', 'Credential остаётся защищённым')}</Badge></BadgeRow>
      <p>{t('Register an external producer for this task and current live Loop Run. Each changed observation adds your fixed processing instruction with untrusted event data. Registration and status never start a Run or grant tools.', 'Зарегистрируйте внешний источник для этой задачи и текущего действующего Run Loop. Каждое изменившееся наблюдение добавляет вашу фиксированную инструкцию обработки с недоверенными данными события. Регистрация и просмотр состояния не запускают Run и не предоставляют инструменты.')}</p>
      {error ? <Notice tone="error">{error} {t('Inspect retained status before another action.', 'Перед следующим действием проверьте сохранённое состояние.')}</Notice> : null}
      {unknown ? <Notice tone="warning">{t('The previous credential action has an unknown outcome. Its identity is retained and it is never replayed. Inspect status; for an observed active source, explicitly rotate and copy a replacement credential if needed.', 'Исход предыдущего действия с credential неизвестен. Его идентификатор сохранён, действие не повторяется. Проверьте состояние; при необходимости для наблюдаемого активного источника явно замените и скопируйте credential.')} <code>{unknown.action} · {unknown.actionId} · {unknown.taskId} · Run {unknown.runId}</code>{unknown.replacementConfirmed ? <p>{t('A separate credential replacement completed. The original action outcome remains unconfirmed.', 'Отдельная замена credential завершена. Исход первоначального действия остаётся неподтверждённым.')}</p> : null}</Notice> : null}
      {clipboardResult ? <Notice tone={clipboardResult.copied ? 'info' : 'warning'}>{clipboardResult.copied
        ? t('Credential copied to clipboard. No credential is displayed here. Configure the external producer separately.', 'Credential скопирован в буфер обмена. Здесь credential не отображается. Настройте внешний источник отдельно.')
        : t('Clipboard copy was not confirmed. Inspect status, then explicitly rotate and copy a replacement credential; registration is not replayed.', 'Копирование в буфер не подтверждено. Проверьте состояние, затем явно замените и скопируйте credential; регистрация не повторяется.')}</Notice> : null}
      <div className="agent-loop-external-producer__actions"><Button disabled={pending.includes('status')} busy={pending.includes('status')} onClick={() => void perform('status', { action: 'status', ...(task ? { taskId: task.id } : {}) })}>{t('Inspect producer status', 'Проверить состояние источников')}</Button></div>
      {status?.origin ? <p>{t('Current core origin', 'Текущий адрес core')}: <code>{status.origin}</code></p> : null}
      {status?.truncated ? <Notice>{t(`Showing the latest ${status.rows.length} of ${status.total ?? 'unknown'} registered sources. This is a partial metadata view; a source missing here is not proof it does not exist.`, `Показаны последние ${status.rows.length} из ${status.total ?? 'неизвестного числа'} зарегистрированных источников. Это неполная выборка метаданных; отсутствие источника здесь не доказывает, что его нет.`)}</Notice> : null}
      {!status && !error ? <p role="status">{t('Reading producer metadata…', 'Загрузка метаданных источников…')}</p> : null}
      {!task || task.mode !== 'loop' ? <p>{t('Select a Loop task to review a new source. Retained metadata remains available below.', 'Выберите задачу Loop для проверки нового источника. Сохранённые метаданные остаются доступны ниже.')}</p> : <>
        <p className="agent-loop-external-producer__identity">{task.id}<br />{task.familyId} · g{task.generation} / r{task.revision}<br />Run: {authority?.runId ?? t('No live Run observed', 'Действующий Run не наблюдается')}</p>
        {!live ? <Notice>{t('No matching live explicit Run authority is observed. Use the task Run control separately, then inspect status. This panel does not start execution.', 'Соответствующее действующее разрешение явного Run не наблюдается. Используйте отдельно запуск задачи, затем проверьте состояние. Эта панель не запускает выполнение.')}</Notice> : null}
        {currentProducer ? <Notice>{t('A source is already registered for this Run. Its event limit is fixed; credential rotation does not reset it.', 'Для этого Run уже зарегистрирован источник. Его лимит событий фиксирован; замена credential не сбрасывает лимит.')}</Notice> : null}
        <TextField label={t('Source label', 'Название источника')} value={label} maxLength={160} disabled={disabled || busy || !live || Boolean(currentProducer) || heldRegistration} onChange={event => edit(() => setLabel(event.target.value))} />
        <div className="nk-field"><label htmlFor={instructionId}>{t('Fixed processing instruction', 'Фиксированная инструкция обработки')}</label><textarea id={instructionId} className="nk-input" value={instruction} rows={3} maxLength={4096}
          disabled={disabled || busy || !live || Boolean(currentProducer) || heldRegistration} onChange={event => edit(() => setInstruction(event.target.value))} /></div>
        <TextField label={t('Maximum changed events', 'Максимум изменившихся событий')} type="number" min={1} max={512} step={1} value={bound} disabled={disabled || busy || !live || Boolean(currentProducer) || heldRegistration}
          onChange={event => edit(() => setBound(event.target.value))} hint={t('Choose 1–512 events. Default 4. Credential rotation keeps the existing budget.', 'Выберите 1–512 событий. По умолчанию 4. Замена credential сохраняет текущий бюджет.')} />
        <div className="agent-loop-external-producer__actions"><Button disabled={disabled || busy || !live || !valid || !status || Boolean(currentProducer) || heldRegistration} onClick={() => {
          if (task && scope) void perform('review', { action: 'review', taskId: task.id, scope, label: label.trim(), instruction: instruction.trim(), eventBound, explicitUserAction: true });
        }}>{t('Review exact producer registration', 'Проверить точную регистрацию источника')}</Button></div>
        {currentReview ? <div className="agent-loop-external-producer__card">
          <h4>{t('Review before registration', 'Проверка перед регистрацией')}</h4><p>{currentReview.label}</p><p className="agent-loop-external-producer__instruction">{currentReview.instruction}</p>
          <p className="agent-loop-external-producer__identity">{currentReview.taskId}<br />{currentReview.scope.familyId} · g{currentReview.scope.generation} / r{currentReview.scope.revision}<br />Run: {currentReview.authority.runId}<br />{t('Owner', 'Владелец')}: {currentReview.authority.ownerId}<br />SHA-256: {currentReview.reviewDigest}</p>
          <p>{t('Changed event limit', 'Лимит изменившихся событий')}: {currentReview.eventBound}</p>
          <Checkbox checked={acknowledged} disabled={disabled || busy || !live} onChange={setAcknowledged} label={t('I reviewed this source, fixed instruction, event limit, task family and exact live Run. Register it and copy its credential to my clipboard.', 'Я проверил источник, фиксированную инструкцию, лимит событий, семейство задачи и точный действующий Run. Зарегистрировать источник и скопировать его credential в мой буфер обмена.')} />
          <Button variant="primary" disabled={disabled || busy || !live || !acknowledged || heldRegistration || Boolean(currentProducer)} onClick={() => void perform('register', { action: 'register', reviewId: currentReview.reviewId, reviewDigest: currentReview.reviewDigest, actionId: crypto.randomUUID(), explicitUserAction: true })}>{t('Register and copy credential', 'Зарегистрировать и скопировать credential')}</Button>
        </div> : null}
      </>}
      {status && !status.rows.length ? <p>{t('No registered producer metadata in this view. This does not establish a live Run.', 'В этой выборке нет метаданных зарегистрированных источников. Это не подтверждает действующий Run.')}</p> : null}
      {status?.rows.map(row => <article className="agent-loop-external-producer__card" key={row.producerId}>
        <h4>{row.label}</h4><BadgeRow><Badge tone={row.active ? 'success' : 'neutral'}>{row.revoked ? t('Revoked', 'Отозван') : row.active ? t('Active binding', 'Действующая привязка') : t('Inactive retained binding', 'Неактивная сохранённая привязка')}</Badge><Badge>{row.reason}</Badge></BadgeRow>
        <p className="agent-loop-external-producer__identity">{row.producerId}<br />{row.taskId}<br />{row.authority.familyId} · g{row.authority.generation} / r{row.authority.revision}<br />Run: {row.authority.runId}</p>
        <p className="agent-loop-external-producer__instruction">{row.instruction}</p><p>{t('Accepted changed events', 'Принятые изменившиеся события')}: {row.acceptedEvents}/{row.eventBound} · {t('Remaining', 'Осталось')}: {row.remainingEvents}</p>
        <p>{t('Pause, correction, a new Run or revoked authority make this binding inactive. History remains. Unchanged observations are recorded without adding new work; mailbox acceptance is not a verified result.', 'Пауза, уточнение, новый Run или отзыв разрешения делают привязку неактивной. История сохраняется. Неизменившиеся наблюдения записываются без новой работы; принятие в почтовый ящик не подтверждает результат.')}</p>
        {setup(row)}
        {!row.revoked ? <div className="agent-loop-external-producer__actions"><Button disabled={pending.includes(`revoke:${row.producerId}`)} busy={pending.includes(`revoke:${row.producerId}`)} onClick={() => void perform(`revoke:${row.producerId}`, { action: 'revoke', producerId: row.producerId, explicitUserAction: true })}>{t('Revoke this source', 'Отозвать этот источник')}</Button></div> : null}
        {row.active && !row.revoked ? <>
          <Checkbox checked={rotationAcknowledged === row.producerId} disabled={disabled || busy || rotationHeld(row)} onChange={value => setRotationAcknowledged(value ? row.producerId : null)} label={t('Replace this source credential and copy the new credential. Keep its fixed instruction and remaining event budget.', 'Заменить credential этого источника и скопировать новый. Сохранить фиксированную инструкцию и оставшийся бюджет событий.')} />
          <div className="agent-loop-external-producer__actions"><Button disabled={disabled || busy || rotationAcknowledged !== row.producerId || rotationHeld(row)} onClick={() => void perform(`rotate:${row.producerId}`, { action: 'rotate', producerId: row.producerId, actionId: crypto.randomUUID(), explicitUserAction: true })}>{t('Rotate and copy credential', 'Заменить и скопировать credential')}</Button></div>
        </> : null}
        {row.receipts.length > 0 || Boolean(row.receiptCount) || row.receiptsTruncated ? <details><summary>{t('Retained event receipts', 'Сохранённые квитанции событий')} ({row.receipts.length}/{row.receiptCount ?? row.receipts.length})</summary>
          {row.receiptsTruncated ? <Notice>{t('Only the latest receipts are shown. A receipt missing from this projection is not proof the event was absent or not accepted. Use the CLI receipt command with the original event identities and private journal for exact inspection.', 'Показаны только последние квитанции. Отсутствие квитанции в этой выборке не доказывает отсутствие или непринятие события. Для точной проверки используйте команду CLI receipt с исходными идентификаторами события и приватным журналом.')}</Notice> : null}
          <ul className="agent-loop-external-producer__receipts">{row.receipts.map(receipt => <li key={receipt.eventId}>
          <Badge>{receipt.state === 'unchanged' ? t('Unchanged — no new work', 'Без изменений — новой работы нет') : t('Accepted into mailbox', 'Принято в почтовый ящик')}</Badge>
          <p className="agent-loop-external-producer__identity">{receipt.eventId}<br />{receipt.sourceEventKey}<br />g{receipt.generation} / r{receipt.revision}<br />{receipt.observationDigest}{receipt.workId ? <><br />{receipt.workId}</> : null}</p>
        </li>)}</ul></details> : null}
      </article>)}
    </PanelStack></Panel>
  </section>;
}
