import { useEffect, useId, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Checkbox, Notice, Panel, PanelStack, Select, TextField } from './design';
import type { AgentTask } from './agent-mode-types';
import type { Language } from './types';
import { stripIpcErrorPrefix } from './ipc-error';
import './surfaces/agent-loop-file-watcher.css';

type Scope = { familyId: string; generation: number; revision: number };
type Metadata = { name: string; byteLength: number; sha256?: string };
export interface LoopFileWatcherEvent {
  eventId: string; sequence: number; actionId: string; workId: string; workKey: string;
  state: 'pending' | 'unknown' | 'delivered'; metadata: Metadata; scope: Scope; runId: string; createdAt: string;
}
export interface LoopFileWatcherRow {
  id: string; taskId: string; projectId: string; name: string; enabled: boolean; reason: string;
  scope: Scope; runId: string | null; eventBound: number; emitted: number; instruction: string;
  baseline: Metadata | null; events: LoopFileWatcherEvent[]; contentIncluded: false; coalescing: string;
}
export interface LoopFileWatcherStatus {
  capability: 'explicit-selected-local-file-metadata'; genericExternalWatchers: false; rows: LoopFileWatcherRow[];
  availability?: 'owned' | 'recovery_required'; recoveryRequired?: boolean; retainedRowsLoaded?: boolean; reason?: string;
  recoveryReceipt?: LoopFileWatcherRecoveryReceipt | null;
  retainedRecovery?: { recoveryId: string; receipt: LoopFileWatcherRecoveryReceipt | null } | null;
}
export interface LoopFileWatcherRecoveryReview {
  version: 1; reviewId: string; reviewDigest: string; recoverable: boolean; reason: string;
  owner: { pid: number; nonce: string; state: 'absent' | 'live' | 'unknown'; proof: 'pid-signal-zero' } | null;
  sourceCount: number; eventCounts: { pending: number; unknown: number; delivered: number }; contentIncluded: false; startsRun: false;
  retainedRecovery?: { recoveryId: string; receipt: LoopFileWatcherRecoveryReceipt | null } | null;
}
export interface LoopFileWatcherRecoveryReceipt {
  version: 1; recoveryId: string; reviewDigest?: string; state: 'completed' | 'rejected' | 'unknown'; terminal: boolean;
  ownerHeld: boolean; recovered: boolean; sourceCount?: number; unknownCount?: number; enabled: false; startsRun: false; reason?: string;
}
export type LoopFileWatcherRequest = { action: 'status' }
  | { action: 'recovery-review' }
  | { action: 'recover'; reviewId: string; reviewDigest: string; explicitUserAction: true }
  | { action: 'recovery-status'; reviewId: string }
  | { action: 'select'; taskId: string; scope: Scope; projectId: string; explicitUserAction: true }
  | { action: 'enable'; watcherId: string; scope: Scope; instruction: string; eventBound: number; explicitUserAction: true }
  | { action: 'disable' | 'refresh'; watcherId: string }
  | { action: 'reconcile'; watcherId: string; eventId: string };
export type LoopFileWatcherResponse = LoopFileWatcherStatus | LoopFileWatcherRow | { cancelled: boolean; source?: LoopFileWatcherRow }
  | LoopFileWatcherRecoveryReview | { receipt: LoopFileWatcherRecoveryReceipt | null }
  | (LoopFileWatcherRecoveryReceipt & { ownerAcquired: boolean; status: LoopFileWatcherStatus });
export interface AgentLoopFileWatcherProps {
  task: AgentTask | null; projects: Array<{ id: string; label: string }>;
  request: (body: LoopFileWatcherRequest) => Promise<LoopFileWatcherResponse>;
  language: Language; disabled?: boolean; observationKey?: string;
}
const sameScope = (a: Scope, b: Scope) => a.familyId === b.familyId && a.generation === b.generation && a.revision === b.revision;
const scopeText = (scope: Scope) => `${scope.familyId} · g${scope.generation} / r${scope.revision}`;

/** This leaf observes metadata and submits explicit source intents. The existing
 * task owner alone checks live Run authority; retained rows never grant it. */
export function AgentLoopFileWatcher({ task, projects, request, language, disabled = false, observationKey = '' }: AgentLoopFileWatcherProps) {
  const ru = language === 'ru';
  const t = (en: string, russian: string) => ru ? russian : en;
  const transport = useRef(request); transport.current = request;
  const mounted = useRef(false), statusSequence = useRef(0), activeActions = useRef(new Set<string>());
  const lastObservation = useRef(observationKey);
  const [status, setStatus] = useState<LoopFileWatcherStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  const [project, setProject] = useState('');
  const [instruction, setInstruction] = useState('');
  const [bound, setBound] = useState('4');
  const [acknowledged, setAcknowledged] = useState(false);
  const [recoveryReview, setRecoveryReview] = useState<LoopFileWatcherRecoveryReview | null>(null);
  const [recoveryAcknowledged, setRecoveryAcknowledged] = useState(false);
  const [recoveryReceipt, setRecoveryReceipt] = useState<LoopFileWatcherRecoveryReceipt | null>(null);
  const [recoveryUncertain, setRecoveryUncertain] = useState(false);
  const recoveryAttempt = useRef<{ reviewId: string; reviewDigest: string } | null>(null);
  const recoveryInspectionId = recoveryAttempt.current?.reviewId ?? recoveryReview?.retainedRecovery?.recoveryId ?? status?.retainedRecovery?.recoveryId ?? recoveryReceipt?.recoveryId;
  const instructionId = useId(), boundId = useId();
  const scope = task ? { familyId: task.familyId, generation: task.generation, revision: task.revision } : null;
  const scopeKey = task ? `${task.id}:${task.familyId}:${task.generation}:${task.revision}` : '';
  const current = status?.rows.find(row => row.taskId === task?.id);
  const others = status?.rows.filter(row => row.taskId !== task?.id) ?? [];
  const projectId = projects.some(row => row.id === project) ? project : projects[0]?.id ?? '';
  const currentLoop = task?.mode === 'loop';
  const canTryEnable = currentLoop && task && ['ready', 'running', 'review_required'].includes(task.status);
  const busy = pending.length > 0;
  const sourceOwned = Boolean(status && status.availability !== 'recovery_required' && !status.recoveryRequired && status.retainedRowsLoaded !== false && !recoveryUncertain);
  const sourceLocked = disabled || !sourceOwned;
  const needsRecovery = status?.recoveryRequired === true || status?.availability === 'recovery_required';
  const mayReviewRecovery = needsRecovery || !status && Boolean(error);
  const unsettled = current?.events.some(event => event.state !== 'delivered');
  const eventBound = Number(bound);
  const remaining = 32 - (current?.events.length ?? 0);
  const substantive = instruction.trim().length > 0 && new TextEncoder().encode(instruction).length <= 8192
    && !/^(?:continue|proceed|go on|keep (?:going|working)|продолжай|продолжить)[.!\s]*$/iu.test(instruction.trim());

  function acceptRecoveryReceipt(value: LoopFileWatcherRecoveryReceipt | null | undefined) {
    if (!value || !mounted.current) return;
    if (recoveryAttempt.current && value.recoveryId !== recoveryAttempt.current.reviewId) return;
    setRecoveryReceipt(value);
    setRecoveryUncertain(!value.terminal || value.ownerHeld);
  }
  async function inspectRecovery(reviewId: string) {
    const value = await transport.current({ action: 'recovery-status', reviewId });
    if (!('receipt' in value)) throw new Error(t('Recovery receipt is unavailable.', 'Квитанция восстановления недоступна.'));
    if (mounted.current) setRecoveryReview(current => current?.retainedRecovery?.recoveryId === reviewId
      ? { ...current, retainedRecovery: { recoveryId: reviewId, receipt: value.receipt } } : current);
    acceptRecoveryReceipt(value.receipt);
  }
  async function loadStatus() {
    const sequence = ++statusSequence.current;
    const value = await transport.current({ action: 'status' });
    if (!('rows' in value) || !Array.isArray(value.rows)) throw new Error(t('Source status is unavailable.', 'Состояние источника недоступно.'));
    if (mounted.current && sequence === statusSequence.current) {
      setStatus(value); acceptRecoveryReceipt(value.recoveryReceipt);
      if (value.retainedRecovery) { setRecoveryUncertain(true); acceptRecoveryReceipt(value.retainedRecovery.receipt); }
      if (value.recoveryRequired) setAcknowledged(false);
    }
  }
  async function perform(key: string, body: LoopFileWatcherRequest) {
    if (activeActions.current.has(key)) return;
    activeActions.current.add(key);
    setPending(old => [...old, key]); setError(null);
    if (body.action === 'select') setAcknowledged(false);
    if (body.action === 'recovery-review') { setRecoveryReview(null); setRecoveryAcknowledged(false); }
    if (body.action === 'recover') {
      recoveryAttempt.current = { reviewId: body.reviewId, reviewDigest: body.reviewDigest };
      setRecoveryReview(null); setRecoveryAcknowledged(false); setAcknowledged(false); setRecoveryUncertain(true);
    }
    try {
      if (body.action === 'recovery-status') await inspectRecovery(body.reviewId);
      else {
        const result = await transport.current(body);
        if (mounted.current && body.action === 'recovery-review' && 'recoverable' in result) {
          setRecoveryReview(result);
          if (result.retainedRecovery) { setRecoveryUncertain(true); acceptRecoveryReceipt(result.retainedRecovery.receipt); }
        }
        if (body.action === 'recover' && 'recoveryId' in result) acceptRecoveryReceipt(result);
      }
      if (body.action === 'enable' && mounted.current) setAcknowledged(false);
      await loadStatus();
    } catch (reason) {
      if (mounted.current) setError(stripIpcErrorPrefix(reason instanceof Error ? reason.message : String(reason)));
      // A lost mutation response is reconciled through status, never replayed.
      if (body.action === 'recover') try { await inspectRecovery(body.reviewId); } catch { /* Keep the exact attempt held. */ }
      if (body.action !== 'status') try { await loadStatus(); } catch { /* Keep the original actionable error. */ }
    } finally { activeActions.current.delete(key); if (mounted.current) setPending(old => old.filter(item => item !== key)); }
  }
  useEffect(() => {
    mounted.current = true;
    void loadStatus().catch(reason => { if (mounted.current) setError(stripIpcErrorPrefix(reason instanceof Error ? reason.message : String(reason))); });
    return () => { mounted.current = false; ++statusSequence.current; };
  }, []);
  useEffect(() => { setAcknowledged(false); }, [scopeKey]);
  useEffect(() => {
    if (lastObservation.current === observationKey) return;
    lastObservation.current = observationKey; setAcknowledged(false);
    // Parent control/Run observations can retire a source. Read metadata only;
    // retain this mounted owner and never refresh file bytes or enable a source.
    void loadStatus().catch(reason => { if (mounted.current) setError(stripIpcErrorPrefix(reason instanceof Error ? reason.message : String(reason))); });
  }, [observationKey]);

  function metadata(value: Metadata | null) {
    return value ? <dl className="agent-loop-file-watcher__metadata">
      <dt>{t('File', 'Файл')}</dt><dd>{value.name}</dd>
      <dt>{t('Size', 'Размер')}</dt><dd>{value.byteLength.toLocaleString()} {t('bytes', 'байт')}</dd>
      <dt>SHA-256</dt><dd><code>{value.sha256 ?? t('Not read until explicit Enable', 'Чтение только после явного включения')}</code></dd>
    </dl> : <p>{t('Selected; contents have not been hashed. Enable reads at most 32 KiB to compute metadata.', 'Файл выбран; хеш ещё не вычислен. Включение прочитает не более 32 КиБ для вычисления метаданных.')}</p>;
  }
  function source(row: LoopFileWatcherRow, historical: boolean) {
    const exact = !historical && scope !== null && sameScope(row.scope, scope);
    return <article className="agent-loop-file-watcher__source" key={row.id}>
      <h4>{row.name}</h4>
      <BadgeRow label={t('Source state', 'Состояние источника')}>
        <Badge tone={row.enabled ? 'success' : 'neutral'}>{row.enabled ? t('Enabled', 'Включён') : t('Off', 'Выключен')}</Badge>
        <Badge>{historical ? t('Retained history', 'Сохранённая история') : exact ? t('Current scope', 'Текущая область') : t('Earlier scope', 'Предыдущая область')}</Badge>
      </BadgeRow>
      <p className="agent-loop-file-watcher__identity">{t('Task', 'Задача')}: {row.taskId}<br />{t('Recorded scope', 'Сохранённая область')}: {scopeText(row.scope)}<br />{t('Recorded Run', 'Сохранённый запуск')}: {row.runId ?? t('None', 'Нет')}</p>
      <p>{t('State', 'Состояние')}: <code>{row.reason}</code> · {row.emitted}/{row.eventBound} {t('events in this enable period', 'событий за это включение')}</p>
      {metadata(row.baseline)}
      <div className="agent-loop-file-watcher__actions">
        <Button onClick={() => void perform(`disable:${row.id}`, { action: 'disable', watcherId: row.id })}
          disabled={!sourceOwned || pending.includes(`disable:${row.id}`)} busy={pending.includes(`disable:${row.id}`)}>{t('Disable future reads', 'Отключить дальнейшее чтение')}</Button>
      </div>
      {row.events.length > 0 && <details open={row.events.some(event => event.state !== 'delivered')}>
        <summary>{t('Retained events and receipts', 'Сохранённые события и подтверждения')} ({row.events.length})</summary>
        <ul className="agent-loop-file-watcher__events">{row.events.map(event => <li key={event.eventId}>
          <BadgeRow label={t('Event state', 'Состояние события')}><Badge tone={event.state === 'delivered' ? 'success' : 'warning'}>#{event.sequence} · {event.state}</Badge></BadgeRow>
          <p className="agent-loop-file-watcher__identity">{event.eventId}<br />{scopeText(event.scope)}<br />Run: {event.runId}<br />{event.createdAt}</p>
          {metadata(event.metadata)}
          {event.state !== 'delivered' && <><p>{t('Delivery is unconfirmed. Reconcile only checks the existing work receipt; it does not resend.', 'Доставка не подтверждена. Сверка только проверяет сохранённое подтверждение работы и не отправляет событие повторно.')}</p>
            <Button disabled={!sourceOwned || pending.includes(`reconcile:${event.eventId}`)} busy={pending.includes(`reconcile:${event.eventId}`)}
              onClick={() => void perform(`reconcile:${event.eventId}`, { action: 'reconcile', watcherId: row.id, eventId: event.eventId })}>{t('Reconcile receipt', 'Сверить подтверждение')}</Button></>}
        </li>)}</ul>
      </details>}
    </article>;
  }

  return <section className="agent-loop-file-watcher" aria-label={t('Selected local file for Loop', 'Выбранный локальный файл для Loop')}>
    <PanelStack><Panel title={t('Selected file changes', 'Изменения выбранного файла')}>
      <BadgeRow label={t('Source capability', 'Возможности источника')}><Badge>{t('Off by default', 'По умолчанию выключен')}</Badge><Badge>{t('Metadata only', 'Только метаданные')}</Badge></BadgeRow>
      <p>{t('Choose one file inside an already granted local project. Events include its name, size and SHA-256; the file body is never sent to the task.', 'Выберите один файл в локальном проекте с уже предоставленным доступом. События содержат имя, размер и SHA-256; содержимое файла не отправляется задаче.')}</p>
      <Notice>{t('Enable requires an existing explicit Loop Run. It grants no tools or additional file access. Pause, correction, Stop, project revocation and restart stop future reading; a later Run never reactivates this source automatically.', 'Для включения нужен действующий явный запуск Loop. Источник не предоставляет инструменты или дополнительный доступ к файлам. Пауза, исправление, остановка, отзыв проекта и перезапуск прекращают дальнейшее чтение; следующий запуск не включает источник автоматически.')}</Notice>
      {error && <Notice tone="error">{error} {t('Refresh metadata before taking another action.', 'Обновите метаданные перед следующим действием.')}</Notice>}
      <div className="agent-loop-file-watcher__actions"><Button disabled={busy} onClick={() => void perform('status', { action: 'status' })} busy={pending.includes('status')}>{t('Refresh metadata', 'Обновить метаданные')}</Button></div>
      {(mayReviewRecovery || recoveryReview || recoveryReceipt || recoveryUncertain) && <section className="agent-loop-file-watcher__recovery" aria-label={t('Retained source owner recovery', 'Восстановление сохранённого владельца источника')}>
        <h4>{t('Recover retained source ownership', 'Восстановить сохранённого владельца источника')}</h4>
        {needsRecovery ? <Notice tone="warning">{t('This instance has not acquired the retained source owner. Source rows have not been loaded; stopping future reads is not confirmed. Review the old owner and retained receipt counts before recovery.', 'Этот экземпляр не получил владение сохранённым источником. Записи источников не загружены; прекращение дальнейшего чтения не подтверждено. Перед восстановлением проверьте прежнего владельца и число сохранённых квитанций.')} {status?.reason}</Notice> : null}
        {mayReviewRecovery ? <Button disabled={busy} busy={pending.includes('recovery-review')} onClick={() => void perform('recovery-review', { action: 'recovery-review' })}>{t('Review retained owner', 'Проверить сохранённого владельца')}</Button> : null}
        {status?.retainedRecovery && !recoveryReview?.retainedRecovery ? <Notice tone="warning">{t('A retained recovery transaction is available for exact receipt inspection. Inspection never resumes it.', 'Сохранённая транзакция восстановления доступна для проверки точной квитанции. Проверка не возобновляет её.')} <code>{status.retainedRecovery.recoveryId}</code></Notice> : null}
        {recoveryReview ? <>
          <BadgeRow label={t('Owner review', 'Проверка владельца')}><Badge tone={recoveryReview.recoverable ? 'neutral' : 'warning'}>{!recoveryReview.owner ? t('No retained owner in this review', 'В этой проверке нет сохранённого владельца') : recoveryReview.owner.state === 'absent' ? t('Previous owner absent', 'Прежний владелец отсутствует') : recoveryReview.owner.state === 'live' ? t('Live owner — recovery blocked', 'Живой владелец — восстановление заблокировано') : t('Owner unverified — recovery blocked', 'Владелец не проверен — восстановление заблокировано')}</Badge></BadgeRow>
          <p>{t('Review reason', 'Причина результата проверки')}: <code>{recoveryReview.reason}</code></p>
          <dl className="agent-loop-file-watcher__metadata"><dt>PID</dt><dd>{recoveryReview.owner?.pid ?? t('Unknown', 'Неизвестен')}</dd><dt>{t('Owner identity', 'Идентификатор владельца')}</dt><dd><code>{recoveryReview.owner?.nonce ?? t('Unknown', 'Неизвестен')}</code></dd><dt>{t('Retained sources', 'Сохранённые источники')}</dt><dd>{recoveryReview.sourceCount}</dd><dt>{t('Pending / unknown / delivered events', 'Ожидающие / неопределённые / доставленные события')}</dt><dd>{recoveryReview.eventCounts.pending} / {recoveryReview.eventCounts.unknown} / {recoveryReview.eventCounts.delivered}</dd></dl>
          <p className="agent-loop-file-watcher__identity">{recoveryReview.reviewId}<br />SHA-256: {recoveryReview.reviewDigest}</p>
          {recoveryReview.retainedRecovery ? <div className="agent-loop-file-watcher__recovery-receipt">
            <Notice tone="warning">{t('An earlier recovery transaction is retained. Inspect its original identity; this review cannot resume or replay it.', 'Сохранена прежняя транзакция восстановления. Проверьте её исходный идентификатор; эта проверка не возобновляет и не повторяет транзакцию.')}</Notice>
            <p className="agent-loop-file-watcher__identity">{recoveryReview.retainedRecovery.recoveryId}</p>
            <p>{t('Retained receipt', 'Сохранённая квитанция')}: {recoveryReview.retainedRecovery.receipt?.state ?? t('Unavailable — outcome unknown', 'Недоступна — исход неизвестен')}</p>
            <Button disabled={busy} onClick={() => void perform('retained-recovery-status', { action: 'recovery-status', reviewId: recoveryReview.retainedRecovery!.recoveryId })}>{t('Inspect retained recovery receipt', 'Проверить сохранённую квитанцию восстановления')}</Button>
          </div> : null}
          <p>{t('Recovery retains unknown outcomes without resending, and stores every source OFF. It starts no Run and reads no selected file. A live or unverified owner cannot be replaced.', 'Восстановление сохраняет неопределённые исходы без повторной отправки и записывает все источники выключенными. Оно не запускает Run и не читает выбранные файлы. Живого или непроверенного владельца заменить нельзя.')}</p>
          {recoveryReview.recoverable && recoveryReview.owner?.state === 'absent' ? <>
            <Checkbox checked={recoveryAcknowledged} disabled={disabled || busy || recoveryUncertain} onChange={setRecoveryAcknowledged} label={t('I reviewed this exact owner and these retained receipts. Recover ownership with all sources OFF and keep unknown outcomes without replay.', 'Я проверил этого владельца и сохранённые квитанции. Подтверждаю восстановление владения с выключенными источниками и сохранением неопределённых исходов без повторной отправки.')} />
            <Button disabled={disabled || busy || recoveryUncertain || !recoveryAcknowledged} busy={pending.includes(`recover:${recoveryReview.reviewId}`)} onClick={() => void perform(`recover:${recoveryReview.reviewId}`, { action: 'recover', reviewId: recoveryReview.reviewId, reviewDigest: recoveryReview.reviewDigest, explicitUserAction: true })}>{t('Recover reviewed owner with sources OFF', 'Восстановить проверенного владельца с выключенными источниками')}</Button>
          </> : null}
        </> : null}
        {recoveryReceipt ? <div role="status" className="agent-loop-file-watcher__recovery-receipt">
          <p>{t('Recovery receipt', 'Квитанция восстановления')}: <code>{recoveryReceipt.recoveryId}</code> · {recoveryReceipt.state}</p>
          <p>{t('Terminal', 'Завершено')}: {recoveryReceipt.terminal ? t('Yes', 'Да') : t('No', 'Нет')} · {t('Recovery writer held', 'Владелец восстановления удерживается')}: {recoveryReceipt.ownerHeld ? t('Yes', 'Да') : t('No', 'Нет')} · {t('Sources', 'Источники')}: {recoveryReceipt.sourceCount ?? t('Unknown', 'Неизвестно')} · {t('Unknown outcomes', 'Неопределённые исходы')}: {recoveryReceipt.unknownCount ?? t('Unknown', 'Неизвестно')}</p>
          {recoveryReceipt.reason ? <p><code>{recoveryReceipt.reason}</code></p> : null}
          {recoveryReceipt.recovered && recoveryReceipt.state === 'completed' && recoveryReceipt.terminal && !recoveryReceipt.ownerHeld ? <Notice>{t('Recovery stored the sources OFF and started no Run. Further reading requires valid live explicit Run authority and a separate Enable. Current ownership is shown by the refreshed source status.', 'Восстановление сохранило источники выключенными и не запускало Run. Для дальнейшего чтения нужны действующее разрешение явного Run и отдельное включение. Текущее владение показывает обновлённое состояние источников.')}</Notice> : recoveryReceipt.state === 'rejected' && recoveryReceipt.terminal && !recoveryReceipt.ownerHeld ? <Notice tone="warning">{t('Recovery was rejected before source metadata changed. Review the retained owner again before a new explicit attempt.', 'Восстановление отклонено до изменения метаданных источников. Перед новой явной попыткой заново проверьте сохранённого владельца.')}</Notice> : <Notice tone="warning">{t('Recovery is not confirmed complete. Keep this receipt and inspect it; do not repeat the mutation or assume reads stopped.', 'Завершение восстановления не подтверждено. Сохраните квитанцию и проверьте её; не повторяйте изменение и не считайте чтение остановленным.')}</Notice>}
        </div> : null}
        {recoveryUncertain ? <Notice tone="warning">{t('The original recovery identity is retained. Inspect its receipt and owner metadata; further mutations are held until the terminal outcome is confirmed.', 'Идентификатор исходного восстановления сохранён. Проверьте его квитанцию и метаданные владельца; новые изменения заблокированы до подтверждения завершённого исхода.')}</Notice> : null}
        {recoveryInspectionId && recoveryInspectionId !== recoveryReview?.retainedRecovery?.recoveryId ? <Button disabled={busy} onClick={() => void perform('recovery-status', { action: 'recovery-status', reviewId: recoveryInspectionId })}>{t('Inspect recovery receipt', 'Проверить квитанцию восстановления')}</Button> : null}
      </section>}
      {!status && !error && <p role="status">{t('Loading source metadata…', 'Загрузка метаданных источника…')}</p>}
      {currentLoop && task && scope ? <>
        <p className="agent-loop-file-watcher__identity">{t('Selected task scope', 'Область выбранной задачи')}: {scopeText(scope)}</p>
        <p>{t('Saved Run identifiers describe history. The owner checks live Run authority again when Enable is pressed.', 'Сохранённые идентификаторы запусков описывают историю. При включении владелец заново проверит действующее разрешение на запуск.')}</p>
        <Select label={t('Granted local project', 'Локальный проект с доступом')} value={projectId} onChange={setProject}
          disabled={sourceLocked || busy || !projects.length} options={projects.length ? projects.map(row => ({ value: row.id, label: row.label })) : [{ value: '', label: t('No granted local projects', 'Нет локальных проектов с доступом') }]} />
        <div className="agent-loop-file-watcher__actions"><Button disabled={sourceLocked || busy || !projectId || task.status === 'stopped' || Boolean(current?.enabled) || Boolean(unsettled)}
          onClick={() => void perform('select', { action: 'select', taskId: task.id, scope, projectId, explicitUserAction: true })}>{t('Choose file…', 'Выбрать файл…')}</Button></div>
        {current && <>
          {source(current, false)}
          {!current.enabled && <div className="agent-loop-file-watcher__enable">
            <div className="nk-field"><label htmlFor={instructionId}>{t('Instruction for each change', 'Инструкция для каждого изменения')}</label>
              <textarea id={instructionId} className="nk-input" rows={3} maxLength={8192} value={instruction} disabled={sourceLocked || busy}
                onChange={event => { setInstruction(event.target.value); setAcknowledged(false); }} placeholder={t('Describe the specific work to enqueue when metadata changes.', 'Укажите конкретную работу при изменении метаданных.')} /></div>
            <TextField id={boundId} label={t('Maximum events', 'Максимум событий')} type="number" min={1} max={Math.max(0, remaining)} step={1} value={bound}
              disabled={sourceLocked || busy} onChange={event => { setBound(event.target.value); setAcknowledged(false); }} hint={t(`${remaining} retained event slots remain (32 total).`, `Осталось мест для событий: ${remaining} (всего 32).`)} />
            <Checkbox checked={acknowledged} disabled={sourceLocked || busy} onChange={setAcknowledged}
              label={t('I allow bounded reading of this selected file to compute metadata and enqueue this instruction during the current explicit Run.', 'Разрешаю ограниченное чтение выбранного файла для вычисления метаданных и постановки этой инструкции в очередь в текущем явно разрешённом запуске.')} />
            <div className="agent-loop-file-watcher__actions"><Button variant="primary" disabled={sourceLocked || busy || !canTryEnable || Boolean(unsettled) || !acknowledged || !substantive || !Number.isSafeInteger(eventBound) || eventBound < 1 || eventBound > remaining}
              onClick={() => void perform(`enable:${current.id}`, { action: 'enable', watcherId: current.id, scope, instruction: instruction.trim(), eventBound, explicitUserAction: true })}>{t('Enable selected file', 'Включить выбранный файл')}</Button></div>
            {!canTryEnable && <p>{t('Resume or explicitly Run this Loop before enabling. This panel does not start it.', 'Возобновите или явно запустите этот Loop перед включением. Эта панель не запускает задачу.')}</p>}
          </div>}
        </>}
      </> : <p>{t('Select a Loop task to choose a file. Retained receipts below remain available.', 'Выберите задачу Loop для выбора файла. Сохранённые подтверждения ниже остаются доступны.')}</p>}
      <p>{t('Only current metadata changes produce events; short intermediate changes may be coalesced. There is no scan or content history.', 'События отражают текущие изменения метаданных; краткие промежуточные изменения могут объединяться. Сканирование и история содержимого не ведутся.')}</p>
      {(others.length > 0 || current && !currentLoop) && <details open={others.some(row => row.enabled || row.events.some(event => event.state !== 'delivered')) || Boolean(current && !currentLoop && current.enabled)}><summary>{t('Other retained sources', 'Другие сохранённые источники')}</summary>
        {current && !currentLoop ? source(current, true) : null}{others.map(row => source(row, true))}</details>}
    </Panel></PanelStack>
  </section>;
}
