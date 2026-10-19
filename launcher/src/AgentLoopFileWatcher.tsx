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
}
export type LoopFileWatcherRequest = { action: 'status' }
  | { action: 'select'; taskId: string; scope: Scope; projectId: string; explicitUserAction: true }
  | { action: 'enable'; watcherId: string; scope: Scope; instruction: string; eventBound: number; explicitUserAction: true }
  | { action: 'disable' | 'refresh'; watcherId: string }
  | { action: 'reconcile'; watcherId: string; eventId: string };
export type LoopFileWatcherResponse = LoopFileWatcherStatus | LoopFileWatcherRow | { cancelled: boolean; source?: LoopFileWatcherRow };
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
  const instructionId = useId(), boundId = useId();
  const scope = task ? { familyId: task.familyId, generation: task.generation, revision: task.revision } : null;
  const scopeKey = task ? `${task.id}:${task.familyId}:${task.generation}:${task.revision}` : '';
  const current = status?.rows.find(row => row.taskId === task?.id);
  const others = status?.rows.filter(row => row.taskId !== task?.id) ?? [];
  const projectId = projects.some(row => row.id === project) ? project : projects[0]?.id ?? '';
  const currentLoop = task?.mode === 'loop';
  const canTryEnable = currentLoop && task && ['ready', 'running', 'review_required'].includes(task.status);
  const busy = pending.length > 0;
  const unsettled = current?.events.some(event => event.state !== 'delivered');
  const eventBound = Number(bound);
  const remaining = 32 - (current?.events.length ?? 0);
  const substantive = instruction.trim().length > 0 && new TextEncoder().encode(instruction).length <= 8192
    && !/^(?:continue|proceed|go on|keep (?:going|working)|продолжай|продолжить)[.!\s]*$/iu.test(instruction.trim());

  async function loadStatus() {
    const sequence = ++statusSequence.current;
    const value = await transport.current({ action: 'status' });
    if (!('rows' in value) || !Array.isArray(value.rows)) throw new Error(t('Source status is unavailable.', 'Состояние источника недоступно.'));
    if (mounted.current && sequence === statusSequence.current) setStatus(value);
  }
  async function perform(key: string, body: LoopFileWatcherRequest) {
    if (activeActions.current.has(key)) return;
    activeActions.current.add(key);
    setPending(old => [...old, key]); setError(null);
    if (body.action === 'select') setAcknowledged(false);
    try {
      await transport.current(body);
      if (body.action === 'enable' && mounted.current) setAcknowledged(false);
      await loadStatus();
    } catch (reason) {
      if (mounted.current) setError(stripIpcErrorPrefix(reason instanceof Error ? reason.message : String(reason)));
      // A lost mutation response is reconciled through status, never replayed.
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
          disabled={pending.includes(`disable:${row.id}`)} busy={pending.includes(`disable:${row.id}`)}>{t('Disable future reads', 'Отключить дальнейшее чтение')}</Button>
      </div>
      {row.events.length > 0 && <details open={row.events.some(event => event.state !== 'delivered')}>
        <summary>{t('Retained events and receipts', 'Сохранённые события и подтверждения')} ({row.events.length})</summary>
        <ul className="agent-loop-file-watcher__events">{row.events.map(event => <li key={event.eventId}>
          <BadgeRow label={t('Event state', 'Состояние события')}><Badge tone={event.state === 'delivered' ? 'success' : 'warning'}>#{event.sequence} · {event.state}</Badge></BadgeRow>
          <p className="agent-loop-file-watcher__identity">{event.eventId}<br />{scopeText(event.scope)}<br />Run: {event.runId}<br />{event.createdAt}</p>
          {metadata(event.metadata)}
          {event.state !== 'delivered' && <><p>{t('Delivery is unconfirmed. Reconcile only checks the existing work receipt; it does not resend.', 'Доставка не подтверждена. Сверка только проверяет сохранённое подтверждение работы и не отправляет событие повторно.')}</p>
            <Button disabled={pending.includes(`reconcile:${event.eventId}`)} busy={pending.includes(`reconcile:${event.eventId}`)}
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
      {!status && !error && <p role="status">{t('Loading source metadata…', 'Загрузка метаданных источника…')}</p>}
      {currentLoop && task && scope ? <>
        <p className="agent-loop-file-watcher__identity">{t('Selected task scope', 'Область выбранной задачи')}: {scopeText(scope)}</p>
        <p>{t('Saved Run identifiers describe history. The owner checks live Run authority again when Enable is pressed.', 'Сохранённые идентификаторы запусков описывают историю. При включении владелец заново проверит действующее разрешение на запуск.')}</p>
        <Select label={t('Granted local project', 'Локальный проект с доступом')} value={projectId} onChange={setProject}
          disabled={disabled || busy || !projects.length} options={projects.length ? projects.map(row => ({ value: row.id, label: row.label })) : [{ value: '', label: t('No granted local projects', 'Нет локальных проектов с доступом') }]} />
        <div className="agent-loop-file-watcher__actions"><Button disabled={disabled || busy || !projectId || task.status === 'stopped' || Boolean(current?.enabled) || Boolean(unsettled)}
          onClick={() => void perform('select', { action: 'select', taskId: task.id, scope, projectId, explicitUserAction: true })}>{t('Choose file…', 'Выбрать файл…')}</Button></div>
        {current && <>
          {source(current, false)}
          {!current.enabled && <div className="agent-loop-file-watcher__enable">
            <div className="nk-field"><label htmlFor={instructionId}>{t('Instruction for each change', 'Инструкция для каждого изменения')}</label>
              <textarea id={instructionId} className="nk-input" rows={3} maxLength={8192} value={instruction} disabled={disabled || busy}
                onChange={event => { setInstruction(event.target.value); setAcknowledged(false); }} placeholder={t('Describe the specific work to enqueue when metadata changes.', 'Укажите конкретную работу при изменении метаданных.')} /></div>
            <TextField id={boundId} label={t('Maximum events', 'Максимум событий')} type="number" min={1} max={Math.max(0, remaining)} step={1} value={bound}
              disabled={disabled || busy} onChange={event => { setBound(event.target.value); setAcknowledged(false); }} hint={t(`${remaining} retained event slots remain (32 total).`, `Осталось мест для событий: ${remaining} (всего 32).`)} />
            <Checkbox checked={acknowledged} disabled={disabled || busy} onChange={setAcknowledged}
              label={t('I allow bounded reading of this selected file to compute metadata and enqueue this instruction during the current explicit Run.', 'Разрешаю ограниченное чтение выбранного файла для вычисления метаданных и постановки этой инструкции в очередь в текущем явно разрешённом запуске.')} />
            <div className="agent-loop-file-watcher__actions"><Button variant="primary" disabled={disabled || busy || !canTryEnable || Boolean(unsettled) || !acknowledged || !substantive || !Number.isSafeInteger(eventBound) || eventBound < 1 || eventBound > remaining}
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
