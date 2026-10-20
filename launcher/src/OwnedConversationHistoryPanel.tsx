import { useEffect, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Checkbox, Notice, Select } from './design';
import type { ConversationHistoryApi, HistoryMessage, HistoryPage, HistoryStatus } from './conversation-history-types';
import type { OwnedConversationStatus } from '../../src/conversation-history/owned-conversation';
import type { NativePersistentContext, NativePersistentConversation } from './native-persistent-types';
import type { Language } from './types';
import { stripIpcErrorPrefix } from './ipc-error';

export type OwnedConversationHistoryApi = Pick<ConversationHistoryApi, 'request'>;
type SourceStatus = Partial<OwnedConversationStatus> & { localCaptureDenied?: boolean; localCaptureReason?: string | null };
const PAGE = 20;

/** Future consent and retained SQLite text are separate from Native context retention. */
export function OwnedConversationHistoryPanel({ api, conversation, expectedContext, language, disabled = false, onRecordingStatus }: {
  api: OwnedConversationHistoryApi; conversation: NativePersistentConversation;
  expectedContext: NativePersistentContext | null; language: Language; disabled?: boolean; onRecordingStatus?: (ready: boolean) => void;
}) {
  const ru = language === 'ru', t = (en: string, russian: string) => ru ? russian : en;
  const transport = useRef(api); transport.current = api;
  const reportRecording = useRef(onRecordingStatus); reportRecording.current = onRecordingStatus;
  const mounted = useRef(false), revision = useRef(0), messageRevision = useRef(0), pending = useRef(new Set<string>());
  const [source, setSource] = useState<SourceStatus | null>(null);
  const [global, setGlobal] = useState<HistoryStatus | null>(null);
  const [bindings, setBindings] = useState<OwnedConversationStatus[]>([]);
  const [bindingId, setBindingId] = useState('');
  const [messages, setMessages] = useState<HistoryPage<HistoryMessage> | null>(null);
  const [offset, setOffset] = useState(0);
  const [consent, setConsent] = useState(false), [acknowledged, setAcknowledged] = useState(false);
  const [busy, setBusy] = useState<string[]>([]), [error, setError] = useState('');
  const contextKey = JSON.stringify(expectedContext), scopeKey = `${conversation.id}:${conversation.revision}:${contextKey}`;
  const currentScope = useRef(scopeKey); currentScope.current = scopeKey;
  const binding = bindings.find(row => row.historyThread.clientId === bindingId);
  const ask = <T,>(body: { action: string; [key: string]: unknown }) => transport.current.request(body) as Promise<T>;
  const failure = (reason: unknown) => stripIpcErrorPrefix(reason instanceof Error ? reason.message : String(reason));
  async function refresh() {
    const token = ++revision.current;
    const results = await Promise.allSettled([
      ask<HistoryStatus>({ action: 'status' }),
      ask<OwnedConversationStatus[]>({ action: 'owned-conversation-subscriptions' }),
      expectedContext ? ask<SourceStatus>({ action: 'owned-conversation-status', conversationId: conversation.id,
        revision: conversation.revision, expectedContext }) : Promise.resolve(null),
    ]);
    if (!mounted.current || token !== revision.current) return;
    const [globalResult, listResult, sourceResult] = results;
    setGlobal(globalResult.status === 'fulfilled' ? globalResult.value : null);
    const retained = listResult.status === 'fulfilled' ? listResult.value.filter(row => row.scope.conversationId === conversation.id) : [];
    const current = sourceResult.status === 'fulfilled' ? sourceResult.value : null;
    setSource(current);
    reportRecording.current?.(current?.available === true && current.enabled === true && current.localCaptureDenied !== true && globalResult.status === 'fulfilled'
      && globalResult.value.recordingEnabled && !globalResult.value.quotaReached);
    const all = current?.scope && current.historyThread
      ? [...retained.filter(row => row.historyThread.clientId !== current.historyThread!.clientId), current as OwnedConversationStatus] : retained;
    setBindings(all);
    setBindingId(previous => all.some(row => row.historyThread.clientId === previous) ? previous
      : current?.historyThread?.clientId ?? all.at(-1)?.historyThread.clientId ?? '');
    if (globalResult.status === 'rejected' || listResult.status === 'rejected') setError(t('History status could not be read. Saved text is unchanged.', 'Состояние истории не прочитано. Сохранённый текст не изменён.'));
  }
  async function readMessages(pageOffset = 0) {
    if (!binding) { setMessages(null); return; }
    const token = ++messageRevision.current;
    try {
      const value = await ask<HistoryPage<HistoryMessage>>({ action: 'thread', ...binding.historyThread, limit: PAGE, offset: pageOffset });
      if (mounted.current && token === messageRevision.current) { setMessages(value); setOffset(pageOffset); }
    } catch (reason) { if (mounted.current && token === messageRevision.current) setError(failure(reason)); }
  }
  async function perform(key: string, body?: { action: string; [key: string]: unknown }) {
    if (pending.current.has(key)) return;
    const requestedScope = scopeKey;
    pending.current.add(key); setBusy([...pending.current]); setError('');
    if (key === 'revoke') reportRecording.current?.(false);
    // Revocation invalidates earlier UI observations without replaying a request.
    ++revision.current; setConsent(false); setAcknowledged(false);
    try { if (body) await ask(body); if (currentScope.current === requestedScope) await refresh(); }
    catch (reason) { if (mounted.current && currentScope.current === requestedScope) setError(failure(reason)); }
    finally { pending.current.delete(key); if (mounted.current) setBusy([...pending.current]); }
  }
  useEffect(() => {
    mounted.current = true; setSource(null); setBindings([]); setMessages(null); setBindingId(''); setConsent(false); setAcknowledged(false); setError('');
    reportRecording.current?.(false);
    void refresh();
    return () => { mounted.current = false; ++revision.current; ++messageRevision.current; };
  }, [scopeKey]);
  useEffect(() => { setMessages(null); setOffset(0); void readMessages(); return () => { ++messageRevision.current; }; }, [bindingId, scopeKey]);
  const canEnable = !disabled && source?.available === true && global?.recordingEnabled === true && !global.quotaReached
    && consent && acknowledged && !busy.length && expectedContext !== null;
  const date = new Intl.DateTimeFormat(ru ? 'ru-RU' : 'en-US', { dateStyle: 'medium', timeStyle: 'medium', hourCycle: 'h23' });
  return <section className="native-persistent__history" aria-label={t('Recorded conversation text', 'Записанный текст диалога')}>
    <h3>{t('Future transcript recording and saved text', 'Будущая запись transcript и сохранённый текст')}</h3>
    <p>{t('This consent is separate from retaining Native context. Only future supported user/assistant text is recorded. Earlier, filtered or missing events remain gaps; unknown secrets may remain in text.',
      'Это согласие отдельно от сохранения контекста Native. Записывается только будущий поддержанный текст пользователя и ассистента. Прежние, отфильтрованные и пропущенные события остаются пробелами; неизвестные секреты могут сохраниться в тексте.')}</p>
    <BadgeRow><Badge>{source?.enabled ? t('Future recording allowed', 'Будущая запись разрешена') : t('Future recording off', 'Будущая запись выключена')}</Badge>
      {source?.localCaptureDenied === true ? <Badge tone="warning">{t('Local capture held', 'Локальная запись заблокирована')}</Badge> : null}
      <Badge>{t('Partial transcript coverage', 'Частичное покрытие transcript')}</Badge>
      <Badge>{t('Global recording', 'Общая запись')}: {global ? global.recordingEnabled ? t('On', 'Включена') : t('Off', 'Выключена') : t('Unknown', 'Неизвестно')}</Badge></BadgeRow>
    {source?.localCaptureDenied === true ? <Notice tone="warning" title={t('Local capture is blocked', 'Локальная запись заблокирована')} meta={source.localCaptureReason ?? undefined}>
      {t('Core recording consent may still be enabled while this local producer refuses capture. The first send remains held. Saved text and revocation remain available.',
        'Согласие core может оставаться включённым, пока локальный producer запрещает capture. Первая отправка остаётся заблокированной. Сохранённый текст и отзыв согласия доступны.')}</Notice> : null}
    {global?.recordingEnabled !== true ? <Notice title={t('Enable global history separately', 'Общая запись включается отдельно')}>
      {t('Open Conversation text history and enable recording there, then refresh. This panel never enables global recording.', 'Откройте историю текста диалогов, включите там запись и обновите этот блок. Здесь общая запись не включается.')}</Notice> : null}
    {error ? <Notice tone="warning" title={t('History action not confirmed', 'Действие истории не подтверждено')}>{error}</Notice> : null}
    <Checkbox checked={consent} disabled={disabled || !source?.available || busy.length > 0} onChange={setConsent}
      label={t('Record future supported text of this exact conversation.', 'Записывать будущий поддержанный текст именно этого диалога.')} />
    <Checkbox checked={acknowledged} disabled={disabled || !source?.available || busy.length > 0} onChange={setAcknowledged}
      label={t('I understand unknown secrets can remain despite known-pattern filtering.', 'Понимаю, что фильтр известных шаблонов может пропустить неизвестные секреты.')} />
    <div className="native-persistent__actions">
      <Button disabled={!canEnable} busy={busy.includes('enable')} onClick={() => expectedContext && void perform('enable', {
        action: 'owned-conversation-consent', conversationId: conversation.id, revision: conversation.revision, expectedContext,
        enabled: true, consent: true, acknowledgeUnknownSecrets: true })}>{t('Allow future text recording', 'Разрешить будущую запись текста')}</Button>
      <Button disabled={busy.includes('revoke')} busy={busy.includes('revoke')} onClick={() => void perform('revoke', {
        action: 'owned-conversation-revoke', conversationId: conversation.id })}>{t('Revoke future recording', 'Отозвать будущую запись')}</Button>
      <Button disabled={busy.includes('refresh')} onClick={() => void perform('refresh')}>{t('Refresh history status', 'Обновить состояние истории')}</Button>
    </div>
    <p className="native-persistent__hint">{t('Revocation retains saved text. Capture positions are local observations, not vendor sequence IDs. External clients and exclusive handoff are outside this source.',
      'Отзыв сохраняет записанный текст. Позиции capture — локальные наблюдения, не номера событий провайдера. Сторонние клиенты и exclusive handoff этим источником не охвачены.')}</p>
    {source?.scope ? <p className="native-persistent__hint">{t('Cursor', 'Курсор')}: {source.lastCursor ?? '—'} · {t('Gaps', 'Пробелы')}: {source.gapCount ?? 0}
      {source.lastGapReason ? ` · ${source.lastGapReason}` : ''} · {t('Active subscriptions', 'Действующие подписки')}: {source.activeSubscriptions ?? 0}</p> : null}
    {bindings.length ? <>
      <Select label={t('Retained recording binding', 'Сохранённая привязка записи')} value={bindingId} onChange={setBindingId}
        options={bindings.map(row => ({ value: row.historyThread.clientId, label: `${row.scope.workerBindingId.slice(0, 8)} · ${row.scope.threadId}` }))} />
      {binding ? <p className="native-persistent__hint">{t('Selected binding gaps', 'Пробелы выбранной привязки')}: {binding.gapCount} {binding.lastGapReason ?? ''}</p> : null}
      <div className="native-persistent__actions"><Button onClick={() => void readMessages(offset)}>{t('Read saved text', 'Прочитать сохранённый текст')}</Button></div>
      {messages ? <>
        <p>{t('Recorded messages', 'Записано сообщений')}: {messages.total} · {t('Incomplete', 'Неполных')}: {messages.coverage.incompleteMessages}</p>
        <ol className="native-persistent__history-messages">{messages.items.map(message => <li key={`${message.messageId}:${message.revisionId}`}>
          <BadgeRow><Badge>{message.role === 'user' ? t('User', 'Пользователь') : t('Assistant', 'Ассистент')}</Badge>
            <Badge>{message.ownedConversation?.attribution ?? message.author}</Badge>
            {message.ownedConversation?.phase ? <Badge>{message.ownedConversation.phase}</Badge> : null}
            <Badge>{message.coverage}</Badge></BadgeRow>
          <small>{date.format(message.timestamp)} · {message.turnId ?? '—'} · {message.messageId}</small>
          <pre className="native-persistent__answer">{message.text ?? t('Text was excluded or is unavailable.', 'Текст исключён или недоступен.')}</pre>
          {message.coverageReason ? <small>{message.coverageReason}</small> : null}
        </li>)}</ol>
        <div className="native-persistent__actions"><Button disabled={offset === 0} onClick={() => void readMessages(Math.max(0, offset - PAGE))}>{t('Previous', 'Назад')}</Button>
          <Button disabled={!messages.hasMore} onClick={() => void readMessages(offset + PAGE)}>{t('Next', 'Далее')}</Button></div>
      </> : null}
    </> : <p>{t('No retained text binding is available. Consent does not backfill earlier turns.', 'Сохранённых привязок текста пока нет. Согласие не добавляет прежние ходы задним числом.')}</p>}
  </section>;
}
