import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Notice, Panel, PanelStack } from './design';
import type { Language } from './types';
import './surfaces/conversation-history.css';

interface OwnedNativeStatus {
  available: boolean;
  recordingEnabled: boolean;
  enabled?: boolean;
  quotaReached?: boolean;
  mode: 'future-validated-final-summaries' | 'future-authenticated-events';
  transcriptCoverage: 'partial';
  unknownSecretsPossible: true;
}

interface OwnedNativeHistoryPanelProps {
  language: Language;
  task: { id: string; familyId: string; generation: number; revision: number; execution?: unknown };
  api: { request(body: { action: string; [key: string]: unknown }): Promise<unknown> };
  disabled?: boolean;
}

function statusOf(value: unknown, events = false): OwnedNativeStatus {
  if (!value || typeof value !== 'object') throw new Error('Invalid history status');
  const status = value as Partial<OwnedNativeStatus>;
  if (typeof status.available !== 'boolean' || typeof status.recordingEnabled !== 'boolean'
    || status.enabled !== undefined && typeof status.enabled !== 'boolean'
    || status.quotaReached !== undefined && typeof status.quotaReached !== 'boolean'
    || status.mode !== (events ? 'future-authenticated-events' : 'future-validated-final-summaries') || status.transcriptCoverage !== 'partial'
    || status.unknownSecretsPossible !== true) throw new Error('Invalid history status');
  return status as OwnedNativeStatus;
}

/** Reset presentation and confirmations whenever the task's admitted scope changes. */
export function OwnedNativeHistoryPanel(props: OwnedNativeHistoryPanelProps) {
  const { id, familyId, generation, revision } = props.task;
  return <PanelStack className="conversation-history__native-panels">
    <ScopedOwnedNativeHistoryPanel key={JSON.stringify([id, familyId, generation, revision, 'summaries'])} {...props} />
    <ScopedOwnedNativeHistoryPanel key={JSON.stringify([id, familyId, generation, revision, 'events'])} {...props} events />
  </PanelStack>;
}

function ScopedOwnedNativeHistoryPanel({ language, task, api, disabled = false, events = false }: OwnedNativeHistoryPanelProps & { events?: boolean }) {
  const ru = language === 'ru';
  const transport = useRef(api); transport.current = api;
  const mounted = useRef(false);
  const sequence = useRef(0);
  const readingRef = useRef(false);
  const changingRef = useRef(false);
  const [status, setStatus] = useState<OwnedNativeStatus | null>(null);
  const [contentConsent, setContentConsent] = useState(false);
  const [riskConsent, setRiskConsent] = useState(false);
  const [reading, setReading] = useState(false);
  const [changing, setChanging] = useState(false);
  const [error, setError] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const body = (action: string) => ({
    action,
    taskId: task.id,
    scope: { familyId: task.familyId, generation: task.generation, revision: task.revision },
  });

  const read = async () => {
    if (readingRef.current || changingRef.current) return;
    const token = ++sequence.current;
    readingRef.current = true;
    setReading(true); setError(false);
    try {
      const next = statusOf(await transport.current.request(body(events ? 'transcript-native-status' : 'owned-native-status')), events);
      if (!mounted.current || token !== sequence.current) return;
      setStatus(next); setUncertain(false);
    } catch {
      if (mounted.current && token === sequence.current) { setStatus(null); setError(true); }
    } finally {
      if (mounted.current && token === sequence.current) { readingRef.current = false; setReading(false); }
    }
  };

  useEffect(() => {
    mounted.current = true;
    void read();
    return () => {
      mounted.current = false;
      sequence.current++;
      readingRef.current = false;
    };
    // The keyed parent owns scope changes. API object identity must not trigger reads.
  }, []);

  const enableAllowed = !disabled && !uncertain && !reading && !changing && status?.available === true
    && status.recordingEnabled && status.enabled !== true && !status.quotaReached && contentConsent && riskConsent;

  const consent = async (enabled: boolean) => {
    if (changingRef.current || enabled && !enableAllowed) return;
    // Revoke stays available during a passive read, global-off, or a draining task.
    // Supersede the read locally; the authority still owns both requests.
    const token = ++sequence.current;
    changingRef.current = true; readingRef.current = false;
    setChanging(true); setReading(false); setError(false);
    try {
      const next = statusOf(await transport.current.request({
        ...body(events ? 'transcript-native-consent' : 'owned-native-consent'), enabled,
        ...(enabled ? { consent: true, acknowledgeUnknownSecrets: true } : {}),
      }), events);
      if (!mounted.current || token !== sequence.current) return;
      setStatus(next); setUncertain(false); setContentConsent(false); setRiskConsent(false);
    } catch {
      if (mounted.current && token === sequence.current) {
        setStatus(null); setError(true); setUncertain(true);
        setContentConsent(false); setRiskConsent(false);
      }
    } finally {
      if (mounted.current && token === sequence.current) { changingRef.current = false; setChanging(false); }
    }
  };

  return <Panel title={events ? (ru ? 'Подписка на поддержанный текст Native' : 'Supported Native text subscription') : (ru ? 'Итоговые ответы Native в истории' : 'Native final summaries in history')}>
    <PanelStack className="conversation-history__stack conversation-history__consent">
    {events ? <p>{ru
      ? 'Отдельное согласие разрешает будущие подтверждённые текстовые события этой задачи и поколения. Сейчас Native предоставляет только частичные проекции итоговых ответов и запросов к пользователю. Полная переписка клиента и фоновый поток недоступны. Ранее завершённые ответы не загружаются.'
      : 'Separate consent permits future authenticated text events for this task and generation. Native currently provides only partial projections of final answers and requests for user input. Complete client transcripts and background feeds are unavailable. Previously completed answers are not imported.'}</p> : <p>{ru
      ? 'Запись по умолчанию выключена. С вашего согласия локальная история может сохранять только будущие проверенные итоговые ответы этой задачи в текущем поколении. Ранее завершённые ответы не загружаются.'
      : 'Recording is off by default. With your consent, local history can retain only future validated final summaries from this task in its current generation. Previously completed answers are not imported.'}</p>}
    <div className="conversation-history__coverage">
    <p>{ru
      ? 'Это частичная история, а не полная переписка. Запросы к модели, служебные инструкции, JSON-оболочки, вызовы инструментов и их аргументы и результаты, схемы и внутренние рассуждения не сохраняются этим способом.'
      : 'This is partial history, not a full transcript. This capture excludes model requests, host instructions, JSON envelopes, tool calls and their arguments and results, schemas, and internal reasoning.'}</p>
    </div>
    <p>{ru
      ? 'Фильтр исключает известные шаблоны секретов, но не гарантирует их полного удаления: итоговый текст может содержать личные сведения и неизвестные секреты.'
      : 'The filter excludes known secret patterns but cannot guarantee complete removal: final text may contain private data and unfamiliar secrets.'}</p>

    {error ? <Notice tone="error" title={uncertain
      ? (ru ? 'Результат изменения неизвестен. Обновите статус, чтобы проверить сохранённое согласие. Запрос автоматически не повторяется.' : 'The change outcome is unknown. Refresh status to check the saved consent. The request is not automatically retried.')
      : (ru ? 'Не удалось получить статус истории. Обновите статус перед включением записи.' : 'History status could not be read. Refresh status before enabling recording.')} /> : null}
    {status && typeof status.enabled === 'boolean' ? <p role="status">{status.enabled
      ? (ru ? 'Согласие для этой задачи включено.' : 'Consent for this task is enabled.')
      : (ru ? 'Согласие для этой задачи выключено.' : 'Consent for this task is off.')}</p> : null}
    {status && !status.recordingEnabled ? <Notice title={ru
      ? 'Глобальная запись выключена. Чтобы сохранять новые итоги, включите запись в разделе «История». Для этой задачи также нужно отдельное согласие; оно само по себе не включает глобальную запись.'
      : 'Global recording is off. To retain new summaries, enable recording in History. This task also needs separate consent; consent does not enable global recording.'} /> : null}
    {status && !status.available ? <Notice title={ru
      ? 'Источник Native для этой задачи сейчас недоступен. Включить запись пока нельзя; согласие можно отозвать.'
      : 'The Native source for this task is currently unavailable. Recording cannot be enabled yet; consent can still be revoked.'} /> : null}
    {status?.quotaReached ? <Notice tone="warning" title={ru
      ? 'Достигнут лимит хранения. Новые итоги не сохраняются; существующая история сохранена.'
      : 'The storage limit has been reached. New summaries are not retained; existing history is preserved.'} /> : null}

    {!status?.enabled ? <div className="conversation-history__consent-checks">
      <Checkbox checked={contentConsent} disabled={disabled || changing || uncertain} onChange={setContentConsent} label={events ? (ru ? 'Разрешаю будущие поддержанные текстовые события этой задачи и поколения: сейчас это частичные ответы Native, включая ожидание ввода.' : 'I allow future supported text events for this task and generation: currently partial Native answers, including requests for user input.') : ru
        ? 'Разрешаю сохранять только будущие итоговые ответы этой задачи в её текущем поколении в приватной локальной истории.'
        : 'I allow only future final summaries from this task in its current generation to be retained in private local history.'} />
      <Checkbox checked={riskConsent} disabled={disabled || changing || uncertain} onChange={setRiskConsent} label={ru
        ? 'Понимаю, что личные сведения и неизвестные секреты могут остаться: фильтр не гарантирует полного удаления.'
        : 'I understand that private data and unfamiliar secrets may remain: the filter does not guarantee complete removal.'} />
    </div> : null}
    <div className="conversation-history__actions">
      <Button disabled={reading || changing} busy={reading} onClick={() => void read()}>{events ? (ru ? 'Обновить статус подписки' : 'Refresh subscription status') : (ru ? 'Обновить статус' : 'Refresh status')}</Button>
      <Button disabled={!enableAllowed} busy={changing} onClick={() => void consent(true)}>{events ? (ru ? 'Разрешить поддержанные события' : 'Allow supported text events') : (ru ? 'Разрешить запись итогов' : 'Allow summary recording')}</Button>
      <Button disabled={changing} onClick={() => void consent(false)}>{events ? (ru ? 'Отозвать согласие на события' : 'Revoke event consent') : (ru ? 'Отозвать согласие' : 'Revoke consent')}</Button>
    </div>
    <p className="conversation-history__muted">{ru
      ? 'Отзыв согласия и глобальное отключение блокируют сохранение ещё не завершённых результатов. Ранее сохранённая история остаётся. Новое поколение задачи требует отдельного согласия.'
      : 'Revoking consent or disabling global recording blocks retention of pending results. Previously saved history remains. A new task generation requires separate consent.'}</p>
    </PanelStack>
  </Panel>;
}
