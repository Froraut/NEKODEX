import { useEffect, useId, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Checkbox, EmptyState, Notice, Panel, PanelStack, Select } from './design';
import type { Language } from './types';
import type { NativePersistentApi, NativePersistentContext, NativePersistentRequest, NativePersistentSnapshot } from './native-persistent-types';
import './surfaces/native-persistent.css';

type Mutation = Exclude<NativePersistentRequest, { action: 'snapshot' }>;
const settled = new Set(['completed', 'failed', 'rejected']);

/** Explicit retained conversations share the admitted account owner, never a second client. */
export function NativePersistentConversationsPanel({ api, language, disabled = false }: {
  api: NativePersistentApi; language: Language; disabled?: boolean;
}) {
  const ru = language === 'ru';
  const promptId = useId();
  const mounted = useRef(false), reading = useRef(false);
  const pending = useRef(new Map<string, { body: Mutation; uncertain: boolean }>());
  const [, renderPending] = useState(0);
  const draft = useRef({ selectedId: null as string | null, prompt: '' });
  const observedContext = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<NativePersistentSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transport = useRef(api); transport.current = api;
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
    if (observedContext.current !== contextKey || !value.models.some(row => row.id === model)) setConsent(false);
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
    pending.current.set(body.actionId, { body, uncertain: false }); renderPending(revision => revision + 1); setError(null);
    try {
      const requestedContext = observedContext.current;
      const response = await transport.current.nativePersistentRequest(body);
      if (!mounted.current) return;
      if (response.ok) accept(response.value, requestedContext);
      else {
        setError(response.error.code);
        if (response.error.knownNotStarted) pending.current.delete(body.actionId);
        else { const retained = pending.current.get(body.actionId); if (retained) retained.uncertain = true; }
      }
    } catch {
      const retained = pending.current.get(body.actionId); if (retained) retained.uncertain = true;
      if (mounted.current) setError('connection_unavailable');
    } finally { if (mounted.current) renderPending(revision => revision + 1); }
  };
  const create = () => {
    const context = expectedContext();
    if (!consent || !model || !textAllowed || !context) return;
    void mutate({ action: 'create', actionId: crypto.randomUUID(), model, text: prompt, retainContext: true, expectedContext: context });
  };
  const send = () => {
    const context = expectedContext();
    if (!selected || selected.status !== 'idle' || !selected.ownerAvailable || !textAllowed || !context) return;
    void mutate({ action: 'send', actionId: crypto.randomUUID(), conversationId: selected.id,
      revision: selected.revision, text: prompt, expectedContext: context });
  };
  const fork = () => {
    const context = expectedContext();
    if (!selected || selected.status !== 'idle' || !selected.ownerAvailable || prompt.trim() || !context) return;
    void mutate({ action: 'fork', actionId: crypto.randomUUID(), conversationId: selected.id, revision: selected.revision, expectedContext: context });
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
    {snapshot?.busy ? <p role="status">{ru ? 'Есть активные диалоги. Другой свободный диалог можно продолжить независимо.' : 'Conversations are active. Another idle conversation can continue independently.'}</p> : null}
    {uncertain ? <Notice tone="warning" title={ru ? 'Исход действия требует проверки' : 'Action outcome needs inspection'}>{ru ? 'Ожидается подтверждённый исход исходного действия; новые отправки заблокированы.'
      : 'The original action needs a confirmed outcome; new sends are held.'}</Notice> : null}
    <div className="native-persistent__layout">
      <div className="native-persistent__sidebar">
        <div className="native-persistent__actions"><Button size="sm" disabled={disabled} onClick={() => { setSelectedId(null); setPrompt(''); setConsent(false); }}>
          {ru ? 'Новый диалог' : 'New conversation'}</Button></div>
        {!snapshot?.conversations.length ? <EmptyState title={ru ? 'Сохранённых диалогов пока нет' : 'No retained conversations yet'} /> :
          <ul className="native-persistent__list">{snapshot.conversations.map(row => <li key={row.id}>
            <Button variant={row.id === selectedId ? 'secondary' : 'ghost'} disabled={disabled}
              onClick={() => { setSelectedId(row.id); setPrompt(''); setConsent(false); }}>
              <span className="native-persistent__conversation-label"><strong>{row.model}</strong>{' '}
                <span><code>{row.id.slice(0, 8)}</code> <span>{statusText(row.status)}</span></span></span>
            </Button>
            {row.parentId ? <small>{ru ? 'Ответвление от' : 'Forked from'} {row.parentId.slice(0, 8)}</small> : null}
          </li>)}</ul>}
      </div>
      <div className="native-persistent__detail">
        {selected ? <>
          <BadgeRow className="native-persistent__metadata"><Badge>{statusText(selected.status)}</Badge> <code>{selected.threadId || selected.id}</code></BadgeRow>
          {selected.lastSummary !== undefined ? <div className="native-persistent__summary">
            <h3>{ru ? 'Последний сохранённый ответ' : 'Last retained answer'}</h3>
            <pre className="native-persistent__answer">{selected.lastSummary}</pre>
          </div> : null}
          {!selected.ownerAvailable ? <Notice title={ru ? 'Контекст сохранён, исполнитель недоступен' : 'Context retained; owner unavailable'}>
            {selected.resumeAvailable ? (ru ? 'Можно явно возобновить подключение. При этом новое сообщение не отправляется.'
              : 'You can explicitly resume the connection. This does not send a new message.')
              : (ru ? 'Для возобновления нужен прежний подтверждённый аккаунт и определённый исход предыдущих действий. Автоматического запуска нет.'
                : 'Resuming requires the same verified account and resolved prior outcomes. There is no automatic execution.')}
          </Notice> : null}
        </> : <>
          <Select label={ru ? 'Модель сохранённого диалога' : 'Retained conversation model'} value={model}
            disabled={locked || !snapshot?.available} options={(snapshot?.models || []).map(row => ({ value: row.id, label: row.label || row.id }))}
            onChange={value => { setModel(value); setConsent(false); }} />
          <Checkbox checked={consent} disabled={locked || !snapshot?.available} onChange={setConsent}
            label={ru ? 'Сохранить сообщения и контекст этого нового диалога локально для продолжения и ответвлений.'
              : 'Retain this new conversation’s messages and context locally for continuation and forks.'} />
        </>}
        <div className="native-persistent__compose"><label htmlFor={promptId}>{ru ? 'Сообщение Native' : 'Native message'}</label>
        <textarea id={promptId} className="nk-input native-persistent__prompt" value={prompt} maxLength={32768}
          disabled={locked || !snapshot?.available || Boolean(selected && !ready)} onChange={event => setPrompt(event.target.value)} /></div>
        <div className="native-persistent__actions">
          <Button variant="primary" disabled={locked || !textAllowed || !snapshot?.available || (selected ? !ready : !consent || !model)}
            busy={selectionBusy} onClick={selected ? send : create}>{selected ? (ru ? 'Продолжить диалог' : 'Continue conversation') : (ru ? 'Создать и отправить' : 'Create and send')}</Button>
          {selected ? <Button disabled={locked || !ready || Boolean(prompt.trim())} onClick={fork}>{ru ? 'Ответвить сохранённый контекст' : 'Fork retained context'}</Button> : null}
          {selected && ready ? <Button disabled={locked || Boolean(prompt.trim())} onClick={() => changeConnection('closeIdle')}>
            {ru ? 'Закрыть подключение к диалогу' : 'Close conversation connection'}</Button> : null}
          {selected?.resumeAvailable ? <Button disabled={locked || Boolean(prompt.trim())} onClick={() => changeConnection('resume')}>
            {ru ? 'Возобновить сохранённый диалог' : 'Resume retained conversation'}</Button> : null}
          {prompt ? <Button disabled={disabled || selectionBusy} onClick={() => setPrompt('')}>
            {ru ? 'Очистить черновик' : 'Clear draft'}</Button> : null}
        </div>
        {selected && prompt.trim() ? <small>{ru ? 'Перед ответвлением или закрытием подключения отправьте или очистите черновик сообщения.' : 'Send or clear the draft before forking or closing the connection.'}</small> : null}
        <p className="native-persistent__hint">{ru ? 'Сообщение отправляется только по нажатию. Инструменты Native отключены. Ответвление и возобновление сами не отправляют сообщение. Закрытие подключения сохраняет контекст. Передача стороннему клиенту пока недоступна.'
          : 'Messages are sent only by clicking. Native tools are disabled. Forking and resuming do not send a message. Closing the connection retains context. Handoff to another client is not available yet.'}</p>
      </div>
    </div>
    </PanelStack>
  </Panel>;
}
