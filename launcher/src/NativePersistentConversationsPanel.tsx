import { useEffect, useId, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Checkbox, EmptyState, Notice, Panel, PanelStack, Select } from './design';
import type { Language } from './types';
import type { NativePersistentApi, NativePersistentContext, NativePersistentRequest, NativePersistentSnapshot } from './native-persistent-types';
import type { NativeConversationMode } from './native-persistent-types';
import type { HistoryStatus } from './conversation-history-types';
import { OwnedConversationHistoryPanel } from './OwnedConversationHistoryPanel';
import type { OwnedConversationHistoryApi } from './OwnedConversationHistoryPanel';
import './surfaces/native-persistent.css';

type Mutation = Exclude<NativePersistentRequest, { action: 'snapshot' }>;
const settled = new Set(['completed', 'failed', 'rejected']);

/** Explicit retained conversations share the admitted account owner, never a second client. */
export function NativePersistentConversationsPanel({ api, language, disabled = false, historyApi }: {
  api: NativePersistentApi; language: Language; disabled?: boolean; historyApi?: OwnedConversationHistoryApi;
}) {
  const ru = language === 'ru';
  const promptId = useId();
  const mounted = useRef(false), reading = useRef(false);
  const pending = useRef(new Map<string, { body: Mutation; uncertain: boolean; nativeTurnNotStarted?: boolean }>());
  const [, renderPending] = useState(0);
  const draft = useRef({ selectedId: null as string | null, prompt: '' });
  const observedContext = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<NativePersistentSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [consent, setConsent] = useState(false);
  const [conversationMode, setConversationMode] = useState<NativeConversationMode>('canonical-text-v1');
  const [recordFutureText, setRecordFutureText] = useState(false), [acknowledgeSecrets, setAcknowledgeSecrets] = useState(false);
  const [globalHistory, setGlobalHistory] = useState<HistoryStatus | null>(null);
  const [turnNotStarted, setTurnNotStarted] = useState(false), [forkAtLastTurn, setForkAtLastTurn] = useState(false);
  const [recordingReady, setRecordingReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transport = useRef(api); transport.current = api;
  const historyTransport = useRef(historyApi); historyTransport.current = historyApi;
  const selected = snapshot?.conversations.find(row => row.id === selectedId);
  draft.current = { selectedId, prompt };
  const uncertain = [...pending.current.values()].some(row => row.uncertain)
    || snapshot?.actions.some(row => row.state === 'unknown' || settled.has(row.state) && row.ownerHeld === true) === true;
  const reserved = new Set([...pending.current.values()].flatMap(({ body }) => body.action === 'create' ? [] : [body.conversationId]));
  for (const row of snapshot?.conversations ?? []) if (row.status === 'running' && row.parentId) reserved.add(row.parentId);
  const selectionBusy = selectedId ? reserved.has(selectedId) : [...pending.current.values()].some(row => row.body.action === 'create');
  const locked = disabled || uncertain || selectionBusy;
  const textAllowed = Boolean(prompt.trim()) && new TextEncoder().encode(prompt).length <= 32 * 1024;

  const accept = (value: NativePersistentSnapshot, requestedContext: string | null) => {
    const contextKey = JSON.stringify([value.profileId, value.epoch, value.serverGeneration]);
    if (observedContext.current !== requestedContext && observedContext.current !== contextKey) return;
    if (observedContext.current !== contextKey || !value.models.some(row => row.id === model)) { setConsent(false); setRecordFutureText(false); setAcknowledgeSecrets(false); }
    observedContext.current = contextKey;
    // Concurrent replies may contain older snapshots. Never replace a newer row or terminal action.
    setSnapshot(previous => {
      if (!previous || JSON.stringify([previous.profileId, previous.epoch, previous.serverGeneration]) !== contextKey) return value;
      return { ...value,
        conversations: [...previous.conversations.filter(prior => !value.conversations.some(row => row.id === prior.id)), ...value.conversations.map(row => {
          const prior = previous.conversations.find(candidate => candidate.id === row.id);
          return prior && (prior.revision > row.revision || prior.revision === row.revision && (prior.updatedAt > row.updatedAt || prior.status !== 'running' && row.status === 'running')) ? prior : row;
        })],
        actions: [...previous.actions.filter(prior => !value.actions.some(row => row.actionId === prior.actionId)), ...value.actions.map(row => {
          const prior = previous.actions.find(candidate => candidate.actionId === row.actionId);
          return prior && settled.has(prior.state) && !settled.has(row.state) ? prior : row;
        })],
      };
    });
    setModel(previous => value.models.some(row => row.id === previous) ? previous : value.models[0]?.id || '');
    for (const [actionId, outstanding] of pending.current) {
      const receipt = value.observedAction?.actionId === actionId ? value.observedAction
        : value.actions.find(row => row.actionId === actionId);
      if (!receipt) continue;
      if (settled.has(receipt.state) && receipt.ownerHeld !== true) {
        pending.current.delete(actionId);
        const sourceId = outstanding.body.action === 'create' ? null : outstanding.body.conversationId;
        const sameDraft = draft.current.selectedId === sourceId
          && (!('text' in outstanding.body) || draft.current.prompt === outstanding.body.text);
        if (receipt.state === 'completed' && sameDraft) {
          if (receipt.conversationId) setSelectedId(value.conversations.some(row => row.id === receipt.conversationId) ? receipt.conversationId : null);
          setPrompt(''); setConsent(false);
        }
        if (receipt.state === 'failed' && outstanding.nativeTurnNotStarted && sameDraft && receipt.conversationId
          && value.conversations.some(row => row.id === receipt.conversationId)) setSelectedId(receipt.conversationId);
      } else outstanding.uncertain = receipt.state === 'unknown' || settled.has(receipt.state) && receipt.ownerHeld === true;
    }
    renderPending(revision => revision + 1);
  };
  const expectedContext = (): NativePersistentContext | null => snapshot?.available && snapshot.profileId && snapshot.epoch && snapshot.serverGeneration
    ? { profileId: snapshot.profileId, epoch: snapshot.epoch, serverGeneration: snapshot.serverGeneration } : null;
  const read = async () => {
    if (reading.current) return;
    reading.current = true; if (mounted.current) setBusy(true);
    try {
      // Each retained action gets its own passive lookup, including those omitted by a bounded list.
      const actionIds = [...pending.current.keys()];
      for (const actionId of actionIds.length ? actionIds : [undefined]) {
        const requestedContext = observedContext.current;
        const response = await transport.current.nativePersistentRequest({ action: 'snapshot', ...(actionId ? { actionId } : {}) });
        if (!mounted.current) return;
        if (response.ok) { accept(response.value, requestedContext); setError(null); }
        else setError(response.error.code);
      }
      if (historyTransport.current) {
        try { const next = await historyTransport.current.request({ action: 'status' }) as HistoryStatus;
          if (mounted.current) { setGlobalHistory(next); if (!next.recordingEnabled || next.quotaReached) { setRecordFutureText(false); setAcknowledgeSecrets(false); } }
        } catch { if (mounted.current) setGlobalHistory(null); }
      }
    } catch { if (mounted.current) setError('connection_unavailable'); }
    finally { reading.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true; void read();
    return () => { mounted.current = false; };
  }, []);
  const mutate = async (body: Mutation) => {
    const targetId = body.action === 'create' ? null : body.conversationId;
    if (disabled || uncertain || [...pending.current.values()].some(row =>
      body.action === 'create' ? row.body.action === 'create' : row.body.action !== 'create' && row.body.conversationId === targetId)) return;
    // Reserve synchronously before IPC; a second click cannot offer the same thread twice.
    pending.current.set(body.actionId, { body, uncertain: false }); renderPending(revision => revision + 1); setError(null); setTurnNotStarted(false);
    try {
      const requestedContext = observedContext.current;
      const response = await transport.current.nativePersistentRequest(body);
      if (!mounted.current) return;
      if (response.ok) accept(response.value, requestedContext);
      else {
        setError(response.error.code);
        if (response.error.knownNotStarted) pending.current.delete(body.actionId);
        else { const retained = pending.current.get(body.actionId); if (retained) retained.uncertain = true; }
        if (response.error.nativeTurnNotStarted) {
          const retained = pending.current.get(body.actionId); if (retained) retained.nativeTurnNotStarted = true;
          setTurnNotStarted(true); await read();
        }
      }
    } catch {
      const retained = pending.current.get(body.actionId); if (retained) retained.uncertain = true;
      if (mounted.current) setError('connection_unavailable');
    } finally { if (mounted.current) renderPending(revision => revision + 1); }
  };
  const create = () => {
    const context = expectedContext();
    if (!consent || !model || !textAllowed || !context || recordFutureText && (!acknowledgeSecrets || !globalHistory?.recordingEnabled || globalHistory.quotaReached)) return;
    void mutate({ action: 'create', actionId: crypto.randomUUID(), model, text: prompt, retainContext: true, expectedContext: context,
      conversationMode, ...(recordFutureText ? { recordFutureText: { consent: true as const, acknowledgeUnknownSecrets: true as const } } : {}) });
  };
  const send = () => {
    const context = expectedContext();
    if (!selected || selected.status !== 'idle' || !selected.ownerAvailable || !textAllowed || !context
      || selected.recordingRequiredBeforeFirstSend && !recordingReady) return;
    void mutate({ action: 'send', actionId: crypto.randomUUID(), conversationId: selected.id,
      revision: selected.revision, text: prompt, expectedContext: context });
  };
  const fork = () => {
    const context = expectedContext();
    if (!selected || selected.status !== 'idle' || !selected.ownerAvailable || prompt.trim() || !context) return;
    void mutate({ action: 'fork', actionId: crypto.randomUUID(), conversationId: selected.id, revision: selected.revision, expectedContext: context,
      ...(forkAtLastTurn && selected.lastTurnId ? { lastTurnId: selected.lastTurnId } : {}) });
  };
  const changeConnection = (action: 'closeIdle' | 'resume') => {
    const context = expectedContext();
    if (!selected || !context || prompt.trim() || (action === 'resume' ? !selected.resumeAvailable : !ready)) return;
    void mutate({ action, actionId: crypto.randomUUID(), conversationId: selected.id, revision: selected.revision, expectedContext: context });
  };
  const statusText = (status: string) => ({ idle: ru ? 'Готов' : 'Ready', running: ru ? 'Выполняется' : 'Running',
    unknown: ru ? 'Исход требует проверки' : 'Outcome needs inspection', unavailable: ru ? 'Исполнитель закрыт' : 'Owner closed',
    unloaded: ru ? 'Подключение закрыто' : 'Connection closed' })[status] || status;
  const ready = selected?.status === 'idle' && selected.ownerAvailable;
  useEffect(() => { setForkAtLastTurn(false); }, [selected?.id, selected?.lastTurnId]);
  useEffect(() => { setRecordingReady(false); }, [selected?.id, selected?.revision, snapshot?.serverGeneration]);

  return <Panel className="native-persistent" title={ru ? 'Сохранённые диалоги Native' : 'Retained Native conversations'}
    actions={<Button disabled={disabled || busy} busy={busy} onClick={() => void read()}>{ru ? 'Обновить диалоги' : 'Refresh conversations'}</Button>}>
    <PanelStack className="native-persistent__body">
    <p>{ru ? 'Создайте отдельный диалог с сохранением контекста, продолжайте его или создавайте ответвления. Используется уже подтверждённое подключение Native.'
      : 'Create a conversation with retained context, continue it or fork it. These conversations use the already admitted Native account.'}</p>
    {!snapshot?.available ? <Notice title={ru ? 'Нужно подключение Native' : 'Native connection required'}>
      {ru ? 'Подтвердите аккаунт и модели в Agent mode, затем обновите диалоги. Сохранённые записи не запускаются автоматически.'
        : 'Verify the account and models in Agent mode, then refresh conversations. Retained records never start automatically.'}
    </Notice> : null}
    {error ? <Notice tone="warning" title={ru ? 'Действие не подтверждено' : 'Action not confirmed'} meta={error}>
      {ru ? 'Обновите состояние, чтобы прочитать сохранённую квитанцию. Исходное сообщение повторно не отправляется.'
        : 'Refresh to inspect the retained receipt. The original message is not sent again.'}
    </Notice> : null}
    {turnNotStarted ? <Notice title={ru ? 'Первое сообщение не отправлено' : 'First message was not sent'}>
      {ru ? 'Запрошенная запись текста недоступна. Созданный диалог может быть сохранён без хода Native; черновик оставлен. Проверьте историю и явно отправьте сообщение после исправления настроек.'
        : 'Requested text recording is unavailable. The created conversation may be retained without a Native turn; your draft remains. Inspect history settings, then send explicitly.'}</Notice> : null}
    {snapshot?.busy ? <p role="status">{ru ? 'Есть активные диалоги. Другой свободный диалог можно продолжить независимо.' : 'Conversations are active. Another idle conversation can continue independently.'}</p> : null}
    {uncertain ? <Notice tone="warning" title={ru ? 'Исход действия требует проверки' : 'Action outcome needs inspection'}>{ru ? 'Ожидается подтверждённый исход исходного действия; новые отправки заблокированы.'
      : 'The original action needs a confirmed outcome; new sends are held.'}</Notice> : null}
    <div className="native-persistent__layout">
      <div className="native-persistent__sidebar">
        <div className="native-persistent__actions"><Button size="sm" disabled={disabled} onClick={() => { setSelectedId(null); setPrompt(''); setConsent(false); setRecordFutureText(false); setAcknowledgeSecrets(false); setTurnNotStarted(false); }}>
          {ru ? 'Новый диалог' : 'New conversation'}</Button></div>
        {!snapshot?.conversations.length ? <EmptyState title={ru ? 'Сохранённых диалогов пока нет' : 'No retained conversations yet'} /> :
          <ul className="native-persistent__list">{snapshot.conversations.map(row => <li key={row.id}>
            <Button variant={row.id === selectedId ? 'secondary' : 'ghost'} disabled={disabled}
              onClick={() => { setSelectedId(row.id); setPrompt(''); setConsent(false); setRecordFutureText(false); setAcknowledgeSecrets(false); setTurnNotStarted(false); }}>
              <span className="native-persistent__conversation-label"><strong>{row.model}</strong>{' '}
                <span><code>{row.id.slice(0, 8)}</code> <span>{statusText(row.status)}</span></span></span>
            </Button>
            {row.parentId ? <small>{ru ? 'Ответвление от' : 'Forked from'} {row.parentId.slice(0, 8)}</small> : null}
          </li>)}</ul>}
      </div>
      <div className="native-persistent__detail">
        {selected ? <>
          <BadgeRow className="native-persistent__metadata"><Badge>{statusText(selected.status)}</Badge> <code>{selected.threadId || selected.id}</code></BadgeRow>
          <Badge>{selected.conversationMode === 'canonical-text-v1' ? (ru ? 'Обычный текст' : 'Natural text') : (ru ? 'Прежний JSON-режим' : 'Legacy JSON mode')}</Badge>
          {selected.recordingRequiredBeforeFirstSend ? <Notice title={ru ? 'Первый ход требует записи текста' : 'The first turn requires text recording'}>
            {ru ? 'При создании была явно запрошена запись с первого сообщения. Разрешите запись в блоке истории ниже; черновик будет отправлен только после вашего отдельного нажатия.'
              : 'Recording from the first message was explicitly requested at creation. Allow recording in the history section below; the draft is sent only by a separate click.'}</Notice> : null}
          {selected.conversationMode === 'canonical-text-v1' && selected.lastTextPreview !== undefined ? <div className="native-persistent__summary">
            <h3>{ru ? 'Предпросмотр последнего текстового ответа' : 'Last text answer preview'}</h3>
            <pre className="native-persistent__answer">{selected.lastTextPreview}</pre>
            <small>{selected.lastTextTruncated ? (ru ? 'Предпросмотр сокращён до 2048 символов. Полный текст появится в истории ниже, если для этого хода была разрешена запись.' : 'Preview is limited to 2048 characters. Complete text appears in history below only if recording was allowed for that turn.')
              : (ru ? 'Это предпросмотр ответа. Transcript записывается только по отдельному согласию.' : 'This is an answer preview. Transcript recording requires separate consent.')}</small>
          </div> : null}
          {selected.conversationMode !== 'canonical-text-v1' && selected.lastSummary !== undefined ? <div className="native-persistent__summary">
            <h3>{ru ? 'Последний summary прежнего JSON-режима' : 'Last legacy JSON summary'}</h3>
            <pre className="native-persistent__answer">{selected.lastSummary}</pre>
          </div> : null}
          {!selected.ownerAvailable ? <Notice title={ru ? 'Контекст сохранён, исполнитель недоступен' : 'Context retained; owner unavailable'}>
            {selected.resumeAvailable ? (ru ? 'Можно явно возобновить подключение. При этом новое сообщение не отправляется.'
              : 'You can explicitly resume the connection. This does not send a new message.')
              : (ru ? 'Для возобновления нужен прежний подтверждённый аккаунт и определённый исход предыдущих действий. Автоматического запуска нет.'
                : 'Resuming requires the same verified account and resolved prior outcomes. There is no automatic execution.')}
          </Notice> : null}
        </> : <>
          <Select label={ru ? 'Режим нового диалога' : 'New conversation mode'} value={conversationMode} disabled={locked}
            options={[{ value: 'canonical-text-v1', label: ru ? 'Обычный текст пользователя и ассистента' : 'Natural user and assistant text' },
              { value: 'neko-json-v1', label: ru ? 'Прежний JSON-режим' : 'Legacy JSON mode' }]}
            onChange={value => { setConversationMode(value as NativeConversationMode); setRecordFutureText(false); setAcknowledgeSecrets(false); setConsent(false); }} />
          <Select label={ru ? 'Модель сохранённого диалога' : 'Retained conversation model'} value={model}
            disabled={locked || !snapshot?.available} options={(snapshot?.models || []).map(row => ({ value: row.id, label: row.label || row.id }))}
            onChange={value => { setModel(value); setConsent(false); setRecordFutureText(false); setAcknowledgeSecrets(false); }} />
          <Checkbox checked={consent} disabled={locked || !snapshot?.available} onChange={setConsent}
            label={ru ? 'Сохранить сообщения и контекст этого нового диалога локально для продолжения и ответвлений.'
              : 'Retain this new conversation’s messages and context locally for continuation and forks.'} />
          {conversationMode === 'canonical-text-v1' ? <div className="native-persistent__first-recording">
            <p>{ru ? 'Запись transcript — отдельное разрешение. Если она нужна с первого сообщения, включите оба согласия до «Создать и отправить».'
              : 'Transcript recording is separate. To record from the first message, select both permissions before Create and send.'}</p>
            <Badge>{ru ? 'Общая запись' : 'Global recording'}: {globalHistory ? globalHistory.recordingEnabled ? (ru ? 'Включена' : 'On') : (ru ? 'Выключена' : 'Off') : (ru ? 'Неизвестно' : 'Unknown')}</Badge>
            <Checkbox checked={recordFutureText} disabled={locked || !historyApi || !globalHistory?.recordingEnabled || globalHistory.quotaReached}
              onChange={value => { setRecordFutureText(value); setAcknowledgeSecrets(false); }}
              label={ru ? 'Записывать будущий поддержанный текст этого диалога, включая первое сообщение.' : 'Record future supported text of this conversation, including the first message.'} />
            <Checkbox checked={acknowledgeSecrets} disabled={locked || !recordFutureText} onChange={setAcknowledgeSecrets}
              label={ru ? 'Понимаю, что в записи могут остаться неизвестные секреты, даже после фильтра известных шаблонов.' : 'I understand recording can retain unknown secrets despite known-pattern filtering.'} />
            {!globalHistory?.recordingEnabled ? <small>{ru ? 'Сначала включите общую запись в истории текста диалогов и обновите диалоги. Этот блок не включает её автоматически.'
              : 'Enable global recording separately in Conversation text history, then refresh conversations. This panel never enables it automatically.'}</small> : null}
          </div> : null}
        </>}
        <div className="native-persistent__compose"><label htmlFor={promptId}>{ru ? 'Сообщение Native' : 'Native message'}</label>
        <textarea id={promptId} className="nk-input native-persistent__prompt" value={prompt} maxLength={32768}
          disabled={locked || !snapshot?.available || Boolean(selected && !ready)} onChange={event => setPrompt(event.target.value)} /></div>
        <div className="native-persistent__actions">
          <Button variant="primary" disabled={locked || !textAllowed || !snapshot?.available || (selected ? !ready || selected.recordingRequiredBeforeFirstSend && !recordingReady : !consent || !model || recordFutureText && !acknowledgeSecrets)}
            busy={selectionBusy} onClick={selected ? send : create}>{selected ? (ru ? 'Продолжить диалог' : 'Continue conversation') : (ru ? 'Создать и отправить' : 'Create and send')}</Button>
          {selected ? <Button disabled={locked || !ready || Boolean(prompt.trim())} onClick={fork}>{ru ? 'Ответвить сохранённый контекст' : 'Fork retained context'}</Button> : null}
          {selected && ready ? <Button disabled={locked || Boolean(prompt.trim())} onClick={() => changeConnection('closeIdle')}>
            {ru ? 'Закрыть подключение к диалогу' : 'Close conversation connection'}</Button> : null}
          {selected?.resumeAvailable ? <Button disabled={locked || Boolean(prompt.trim())} onClick={() => changeConnection('resume')}>
            {ru ? 'Возобновить сохранённый диалог' : 'Resume retained conversation'}</Button> : null}
          {prompt ? <Button disabled={disabled || selectionBusy} onClick={() => setPrompt('')}>
            {ru ? 'Очистить черновик' : 'Clear draft'}</Button> : null}
        </div>
        {selected?.lastTurnId ? <Checkbox checked={forkAtLastTurn} disabled={locked || !ready || Boolean(prompt.trim())} onChange={setForkAtLastTurn}
          label={ru ? `Ответвить на точной границе завершённого хода ${selected.lastTurnId}. Само ответвление не отправляет сообщение.`
            : `Fork at the exact completed turn ${selected.lastTurnId}. Forking itself sends no message.`} /> : null}
        {selected && prompt.trim() ? <small>{ru ? 'Перед ответвлением или закрытием подключения отправьте или очистите черновик сообщения.' : 'Send or clear the draft before forking or closing the connection.'}</small> : null}
        <p className="native-persistent__hint">{ru ? 'Сообщение отправляется только по нажатию. Инструменты Native отключены. Ответвление и возобновление сами не отправляют сообщение. Закрытие подключения сохраняет контекст. Передача стороннему клиенту пока недоступна.'
          : 'Messages are sent only by clicking. Native tools are disabled. Forking and resuming do not send a message. Closing the connection retains context. Handoff to another client is not available yet.'}</p>
        {selected?.conversationMode === 'canonical-text-v1' ? historyApi ? <OwnedConversationHistoryPanel key={selected.id} api={historyApi} conversation={selected}
          expectedContext={expectedContext()} language={language} disabled={disabled || uncertain} onRecordingStatus={setRecordingReady} /> : <Notice title={ru ? 'История текста недоступна' : 'Text history unavailable'}>
          {ru ? 'Предпросмотр не является полным transcript. Отдельный API истории не подключён.' : 'A preview is not a full transcript. The separate history API is not connected.'}</Notice> : null}
      </div>
    </div>
    </PanelStack>
  </Panel>;
}
