import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, EmptyState, Notice, Page, Panel, PanelStack, SurfaceHeader, TextField } from './design';
import { mergeNativeThreads, nativeExternalThreadControl, nativeThreadRows } from './native-threads-model';
import type { Language } from './types';
import type { CodexClientControlSnapshot, CodexStatusScope, CodexThreadMetadata, NativeThreadsApi,
  NativeThreadsResult } from './native-threads-types';
import './surfaces/native-threads.css';
import { NativePersistentConversationsPanel } from './NativePersistentConversationsPanel';
import type { NativePersistentApi } from './native-persistent-types';
import type { OwnedConversationHistoryApi } from './OwnedConversationHistoryPanel';

const en = {
  title: 'Native Codex threads', subtitle: 'Read Codex thread metadata and create a fork from existing history.',
  load: 'Load native threads', reload: 'Reload', more: 'Load more', loading: 'Loading…',
  initialTitle: 'Native history is loaded on request', initialBody: 'Load threads from the configured Codex profile. This does not send a message or start a turn.',
  emptyTitle: 'No native threads were returned', emptyBody: 'Only persisted history available to the configured Codex server can appear here.',
  scopeTitle: 'Status scope', scopeConnection: 'This connection', scopeServer: 'Configured Codex server',
  scopeConnectionBody: 'A separate Codex connection reports its own loaded state. A thread marked “Not loaded here” may be running in another Codex process.',
  scopeServerBody: 'Status comes from the explicitly configured server socket and describes work owned by that server.',
  scopeUnknown: 'Load metadata to identify the connected server and status scope.',
  version: 'Connected server', unavailable: 'Not connected', rows: 'Loaded threads', metadataOnly: 'Metadata only',
  search: 'Filter loaded threads', noMatch: 'No loaded threads match this filter', clear: 'Clear filter',
  unnamed: 'Untitled native thread', read: 'Read metadata', fork: 'Fork history', forkPending: 'Creating fork…',
  selected: 'Selected thread', parent: 'Parent thread', session: 'Session', forkedFrom: 'Forked from',
  parentMissing: 'Parent is outside the loaded page', model: 'Model', role: 'Role', agent: 'Agent', source: 'Source',
  cwd: 'Working directory', id: 'Thread ID', updated: 'Updated', missing: 'Not reported',
  forkHelp: 'Creates a new native thread from this history. Codex controls approval and sandbox settings; no message or model turn is started.',
  forkSuccess: 'Fork created', forkSuccessBody: 'The new thread is selected below. It has not received a new message.',
  failed: 'Native Codex action failed', unknownFork: 'Fork outcome requires inspection',
  unknownForkBody: 'A receipt was not returned. Reload and inspect native history before creating another fork of this thread.',
  acknowledge: 'I inspected this action', acknowledgeHelp: 'Acknowledging does not confirm whether a fork was created. It allows a separate new fork action after inspection.',
  genericFailure: 'Native Codex client control is unavailable. Check the configured official Codex executable and profile, then reload.',
  permission: 'Approvals and running turns stay in the native Codex client.',
  boundary: 'Fork through native turn ID (optional)',
  boundaryHelp: 'Use an exact native turn ID to include history through that turn. Leave empty for history available when Codex handles the request.',
  boundaryInvalid: 'Use a native turn ID of at most 128 characters without control characters.',
  forkSource: 'Source thread', forkBoundary: 'Accepted fork boundary', latestBoundary: 'Latest history at the provider',
  externalTitle: 'External execution remains with its owner',
  externalBody: 'No verified exclusive owner handoff is available for this connection. Idle or not loaded status does not grant permission to resume an external executor. Continue it in its owning client; approvals and sending are unavailable here.',
  owner: 'Current execution owner', ownerUnknown: 'Not established by metadata',
  originator: 'Historical originator',
  statuses: { notLoaded: 'Not loaded here', idle: 'Idle', systemError: 'Native error', active: 'Active' },
  flags: { waitingOnApproval: 'Waiting for native approval', waitingOnUserInput: 'Waiting for user input' },
};
const ru: typeof en = {
  title: 'Нативные чаты Codex', subtitle: 'Метаданные чатов Codex и создание ответвления из существующей истории.',
  load: 'Загрузить чаты Codex', reload: 'Обновить', more: 'Загрузить ещё', loading: 'Загрузка…',
  initialTitle: 'История загружается по запросу', initialBody: 'Загрузите чаты настроенного профиля Codex. Сообщение не отправляется, выполнение не запускается.',
  emptyTitle: 'Нативные чаты не найдены', emptyBody: 'Здесь отображается сохранённая история, доступная настроенному серверу Codex.',
  scopeTitle: 'Область статуса', scopeConnection: 'Это подключение', scopeServer: 'Настроенный сервер Codex',
  scopeConnectionBody: 'Отдельное подключение Codex сообщает о своей загруженной работе. Чат со статусом «Не загружен здесь» может выполняться в другом процессе Codex.',
  scopeServerBody: 'Статус получен через явно настроенный сокет сервера и относится к работе этого сервера.',
  scopeUnknown: 'Загрузите метаданные, чтобы определить сервер и область статуса.',
  version: 'Подключённый сервер', unavailable: 'Нет подключения', rows: 'Загруженные чаты', metadataOnly: 'Только метаданные',
  search: 'Фильтр загруженных чатов', noMatch: 'Нет загруженных чатов по этому фильтру', clear: 'Сбросить фильтр',
  unnamed: 'Нативный чат без названия', read: 'Прочитать метаданные', fork: 'Создать ответвление', forkPending: 'Создание ответвления…',
  selected: 'Выбранный чат', parent: 'Родительский чат', session: 'Сессия', forkedFrom: 'Ответвление от',
  parentMissing: 'Родитель вне загруженной страницы', model: 'Модель', role: 'Роль', agent: 'Агент', source: 'Источник',
  cwd: 'Рабочая папка', id: 'ID чата', updated: 'Обновлён', missing: 'Не сообщается',
  forkHelp: 'Создаёт новый нативный чат из этой истории. Настройки согласований и песочницы определяет Codex. Сообщение не отправляется, модель не запускается.',
  forkSuccess: 'Ответвление создано', forkSuccessBody: 'Новый чат выбран ниже. Новое сообщение в него не отправлялось.',
  failed: 'Действие Codex не выполнено', unknownFork: 'Результат ответвления нужно проверить',
  unknownForkBody: 'Подтверждение не получено. Обновите и проверьте историю Codex перед повторным ответвлением этого чата.',
  acknowledge: 'Я проверил это действие', acknowledgeHelp: 'Отметка не подтверждает создание ответвления. После проверки можно отдельно создать новое ответвление.',
  genericFailure: 'Управление нативным Codex недоступно. Проверьте настроенный официальный исполняемый файл и профиль Codex, затем обновите.',
  permission: 'Согласования и выполнение остаются в нативном клиенте Codex.',
  boundary: 'Ответвить по ID нативного хода включительно (необязательно)',
  boundaryHelp: 'Укажите точный ID хода Codex. Пустое поле означает историю, доступную в момент обработки запроса сервером.',
  boundaryInvalid: 'Нужен ID хода до 128 символов без управляющих символов.',
  forkSource: 'Исходный чат', forkBoundary: 'Принятая граница ответвления', latestBoundary: 'Актуальная история у провайдера',
  externalTitle: 'Внешнее выполнение остаётся у владельца',
  externalBody: 'Для этого подключения нет проверенной передачи исключительного владения. Статус ожидания или отсутствия загрузки не разрешает возобновлять внешний исполнитель. Продолжайте его в исходном клиенте; согласования и отправка здесь недоступны.',
  owner: 'Текущий владелец выполнения', ownerUnknown: 'Метаданные его не устанавливают',
  originator: 'Исторический источник создания',
  statuses: { notLoaded: 'Не загружен здесь', idle: 'Ожидает', systemError: 'Ошибка Codex', active: 'Выполняется' },
  flags: { waitingOnApproval: 'Ожидает согласования в Codex', waitingOnUserInput: 'Ожидает ввода пользователя' },
};
type SafeError = { code: string; message: string; rpcCode?: number };

export function NativeThreadsSurface({ language, disabled = false, api, historyApi }: {
  language: Language; disabled?: boolean; api: NativeThreadsApi & Partial<NativePersistentApi>; historyApi?: OwnedConversationHistoryApi;
}) {
  const text = language === 'ru' ? ru : en;
  const [threads, setThreads] = useState<CodexThreadMetadata[]>([]);
  const [client, setClient] = useState<CodexClientControlSnapshot | null>(null);
  const [scope, setScope] = useState<CodexStatusScope | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState<'list' | 'read' | 'fork' | 'acknowledge' | null>(null);
  const [error, setError] = useState<SafeError | null>(null);
  const [forkedId, setForkedId] = useState<string | null>(null);
  const [forkReceipt, setForkReceipt] = useState<{ sourceThreadId: string; lastTurnId: string | null } | null>(null);
  const [lastTurnId, setLastTurnId] = useState('');
  const [uncertainFork, setUncertainFork] = useState<string | null>(null);
  const locked = useRef(false), mounted = useRef(true);
  const detailsId = useId(), listId = useId();
  useEffect(() => {
    mounted.current = true;
    // Passive local receipt state survives navigation/restart; this never connects
    // an app-server or loads native history on mount.
    void api.nativeThreadsSnapshot().then(result => {
      if (mounted.current && result.ok) setClient(result.value);
    }).catch(() => {});
    return () => { mounted.current = false; };
  }, [api]);
  const tree = useMemo(() => nativeThreadRows(threads), [threads]);
  const normalized = query.trim().toLocaleLowerCase();
  const visible = tree.filter(({ thread }) => !normalized || [thread.name, thread.id, thread.agentNickname,
    thread.agentRole, thread.parentThreadId, thread.forkedFromId].some(value => value?.toLocaleLowerCase().includes(normalized)));
  const selected = threads.find(thread => thread.id === selectedId);
  const externalControl = selected ? nativeExternalThreadControl(selected) : null;
  const boundaryInvalid = lastTurnId.length > 128 || /[\u0000-\u001f]/.test(lastTurnId);
  const uncertainActions = client?.uncertainForks || [];
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(language, { dateStyle: 'medium', timeStyle: 'short' }), [language]);
  const isDisabled = disabled || busy !== null;
  const label = (thread: CodexThreadMetadata) => thread.name || thread.agentNickname || text.unnamed;
  const genericFailure = (): SafeError => ({ code: 'native_control_unavailable', message: text.genericFailure });
  const unwrap = <T,>(result: NativeThreadsResult<T>): T => {
    if (!result || typeof result !== 'object' || !('ok' in result)) throw genericFailure();
    if (!result.ok) throw result.error;
    return result.value;
  };
  const perform = async (kind: NonNullable<typeof busy>, action: () => Promise<void>) => {
    if (disabled || locked.current) return;
    locked.current = true; setBusy(kind); setError(null); setForkedId(null); setForkReceipt(null);
    try { await action(); }
    catch (reason) {
      if (!mounted.current) return;
      // Rejected Electron IPC exceptions can contain local source paths. Only the
      // registrar's structured, sanitized failure envelope may reach this view.
      const safe = reason && typeof reason === 'object' && 'code' in reason && 'message' in reason
        && !(reason instanceof Error) ? reason as SafeError : genericFailure();
      setError(safe);
      if (safe.code === 'fork_outcome_unknown') setUncertainFork(selectedId);
    } finally {
      if (mounted.current) {
        try {
          const result = await api.nativeThreadsSnapshot();
          if (mounted.current && result.ok) setClient(result.value);
        } catch { /* The action's safe error stays visible. Snapshot is passive. */ }
        if (mounted.current) setBusy(null);
      }
      locked.current = false;
    }
  };
  const load = (more = false) => void perform('list', async () => {
    const result = unwrap(await api.nativeThreadsList({ limit: 50, ...(more && nextCursor ? { cursor: nextCursor } : {}) }));
    if (!mounted.current) return;
    setThreads(previous => more ? mergeNativeThreads(previous, result.data) : result.data);
    setNextCursor(result.nextCursor); setScope(result.statusScope); setLoaded(true);
    if (!more) setSelectedId(null);
  });
  const read = (id: string) => void perform('read', async () => {
    const result = unwrap(await api.nativeThreadRead(id));
    if (!mounted.current) return;
    setThreads(previous => mergeNativeThreads(previous, [result.thread]));
    setSelectedId(result.thread.id); setLastTurnId(''); setScope(result.statusScope);
  });
  const fork = () => {
    if (!selected || boundaryInvalid) return;
    const id = selected.id;
    const boundary = lastTurnId || undefined;
    void perform('fork', async () => {
      const result = unwrap(await api.nativeThreadFork({ threadId: id, ...(boundary ? { lastTurnId: boundary } : {}) }));
      if (!mounted.current) return;
      setThreads(previous => mergeNativeThreads(previous, [result.thread]));
      setSelectedId(result.thread.id); setScope(result.statusScope); setForkedId(result.thread.id); setLastTurnId('');
      if (result.sourceThreadId === id && result.lastTurnId === (boundary ?? null) && result.executionStarted === false) {
        setForkReceipt({ sourceThreadId: result.sourceThreadId, lastTurnId: result.lastTurnId });
      }
    });
  };
  const acknowledge = (actionId: string, threadId: string) => void perform('acknowledge', async () => {
    const result = unwrap(await api.nativeThreadAcknowledgeFork({ actionId, threadId, confirmedInspection: true }));
    if (!mounted.current) return;
    setClient(result);
    if (uncertainFork === threadId) setUncertainFork(null);
  });
  const statusLabel = (thread: CodexThreadMetadata) => text.statuses[thread.status.type];
  const statusTone = (thread: CodexThreadMetadata) => thread.status.type === 'systemError' ? 'error'
    : thread.status.type === 'active' ? 'accent' : 'neutral';
  const fields = selected ? [[text.id, selected.id], [text.parent, selected.parentThreadId],
    [text.session, selected.sessionId], [text.forkedFrom, selected.forkedFromId], [text.model, selected.model],
    [text.role, selected.agentRole], [text.agent, selected.agentNickname], [text.source, selected.source],
    [text.originator, selected.originator],
    [text.cwd, selected.cwd], [text.updated, selected.updatedAt ? dateFormat.format(selected.updatedAt * 1000) : null]] : [];

  return <Page width="wide" className="native-threads">
    {api.nativePersistentRequest ? <NativePersistentConversationsPanel api={{ nativePersistentRequest: api.nativePersistentRequest }}
      language={language} disabled={disabled} historyApi={historyApi} /> : null}
    <SurfaceHeader title={text.title} subtitle={text.subtitle} actions={<Button variant="primary"
      busy={busy === 'list'} disabled={isDisabled} onClick={() => load()}>{loaded ? text.reload : text.load}</Button>} />
    <Notice title={text.scopeTitle} meta={client?.userAgent ? `${text.version}: ${client.userAgent}` : undefined}>
      {!scope ? text.scopeUnknown : scope === 'connection' ? text.scopeConnectionBody : text.scopeServerBody}
    </Notice>
    {error ? <Notice tone="error" title={text.failed} meta={`${error.code}${error.rpcCode === undefined ? '' : ` · RPC ${error.rpcCode}`}`}>{error.message}</Notice> : null}
    {uncertainActions.map(action => <Notice key={action.actionId} tone="warning" title={text.unknownFork}
      meta={`${action.threadId} · ${action.actionId}${action.observedForkId ? ` · ${action.observedForkId}` : ''}`}
      action={<Button size="sm" disabled={isDisabled || action.state === 'pending'}
        onClick={() => acknowledge(action.actionId, action.threadId)}>{text.acknowledge}</Button>}>
      {text.unknownForkBody} {text.acknowledgeHelp}
      {action.lastTurnId ? <> <span className="native-threads__notice-detail">{text.boundary}: <code>{action.lastTurnId}</code></span></> : null}
    </Notice>)}
    {uncertainFork && !uncertainActions.some(action => action.threadId === uncertainFork)
      ? <Notice tone="warning" title={text.unknownFork} meta={uncertainFork}>{text.unknownForkBody}</Notice> : null}
    {forkedId ? <Notice tone="success" title={text.forkSuccess} meta={forkedId}>{text.forkSuccessBody}
      {forkReceipt ? <> <span className="native-threads__notice-detail">{text.forkSource}: <code>{forkReceipt.sourceThreadId}</code><br />{' '}
        {text.forkBoundary}: <code>{forkReceipt.lastTurnId || text.latestBoundary}</code></span></> : null}</Notice> : null}
    <div className="native-threads__layout">
      <Panel title={text.rows} titleId={listId} className="native-threads__list-panel"
        actions={<Badge>{text.metadataOnly}</Badge>}>
        <PanelStack className="native-threads__panel-body">
        {threads.length ? <TextField type="search" label={text.search} value={query}
          onChange={event => setQuery(event.target.value)} /> : null}
        {!loaded && !threads.length ? <EmptyState icon="activity" title={text.initialTitle}>{text.initialBody}</EmptyState>
          : !threads.length ? <EmptyState icon="activity" title={text.emptyTitle}>{text.emptyBody}</EmptyState>
            : !visible.length ? <EmptyState title={text.noMatch}
              action={<Button size="sm" onClick={() => setQuery('')}>{text.clear}</Button>} />
              : <ul className="native-threads__list" aria-labelledby={listId} aria-busy={busy === 'list'}>
                {visible.map(({ thread, depth, parentMissing }) => <li key={thread.id}
                  className={`native-threads__row${selectedId === thread.id ? ' is-selected' : ''}`}
                  style={{ paddingInlineStart: `${Math.min(depth, 6) * 12 + 12}px` }}>
                  <div className="native-threads__row-head"><strong>{label(thread)}</strong>{' '}
                    <BadgeRow><Badge tone={statusTone(thread)}>{statusLabel(thread)}</Badge></BadgeRow></div>
                  <code>{thread.id}</code>
                  {thread.agentRole || thread.agentNickname ? <p>{[thread.agentRole, thread.agentNickname].filter(Boolean).join(' · ')}</p> : null}
                  {thread.parentThreadId ? <p>{text.parent}: <code>{thread.parentThreadId}</code>{parentMissing ? <> <small>{text.parentMissing}</small></> : null}</p> : null}
                  {thread.forkedFromId ? <p>{text.forkedFrom}: <code>{thread.forkedFromId}</code></p> : null}
                  <Button size="sm" variant="ghost" disabled={isDisabled} aria-controls={detailsId}
                    aria-label={`${text.read}: ${label(thread)} ${thread.id}`} onClick={() => read(thread.id)}>{text.read}</Button>
                </li>)}
              </ul>}
        {nextCursor ? <div className="native-threads__actions"><Button disabled={isDisabled} onClick={() => load(true)}>{text.more}</Button></div> : null}
        </PanelStack>
      </Panel>
      <Panel title={text.selected} id={detailsId} className="native-threads__details" aria-live="polite">
        <PanelStack className="native-threads__panel-body">
        {selected ? <>
          <h3>{label(selected)}</h3>
          <BadgeRow><Badge tone={statusTone(selected)}>{statusLabel(selected)}</Badge></BadgeRow>
          {selected.status.type === 'active' ? selected.status.activeFlags.map(flag => <p key={flag}>{text.flags[flag]}</p>) : null}
          <dl>{fields.map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value || text.missing}</dd></div>)}</dl>
          <p className="native-threads__scope">{text.scopeTitle}: {scope === 'configured-server' ? text.scopeServer : text.scopeConnection}</p>
          {externalControl ? <Notice title={text.externalTitle}>{text.externalBody} <span className="native-threads__notice-detail">{text.owner}: {text.ownerUnknown}</span></Notice> : null}
          <p>{text.forkHelp}</p>
          <TextField label={text.boundary} hint={text.boundaryHelp} value={lastTurnId} disabled={isDisabled}
            error={boundaryInvalid ? text.boundaryInvalid : undefined} onChange={event => setLastTurnId(event.target.value)} />
          <div className="native-threads__actions"><Button disabled={isDisabled || boundaryInvalid || client?.capabilities.fork === 'unsupported' || uncertainFork === selected.id
            || uncertainActions.some(action => action.threadId === selected.id)}
            busy={busy === 'fork'} onClick={fork}>{busy === 'fork' ? text.forkPending : text.fork}</Button></div>
          <p className="native-threads__hint">{text.permission}</p>
        </> : <p className="native-threads__hint">{text.read}</p>}
        </PanelStack>
      </Panel>
    </div>
  </Page>;
}
