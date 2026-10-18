import { useEffect, useId, useRef, useState } from 'react';
import { Badge, Button, Checkbox, EmptyState, Notice, Panel, Select } from './design';
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
  const mounted = useRef(false), inFlight = useRef(false), pending = useRef<Mutation | null>(null);
  const observedContext = useRef<string | null>(null);
  const [snapshot, setSnapshot] = useState<NativePersistentSnapshot | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [model, setModel] = useState('');
  const [prompt, setPrompt] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const transport = useRef(api); transport.current = api;
  const selected = snapshot?.conversations.find(row => row.id === selectedId);
  const locked = disabled || busy || uncertain || snapshot?.busy === true;
  const textAllowed = Boolean(prompt.trim()) && new TextEncoder().encode(prompt).length <= 32 * 1024;

  const accept = (value: NativePersistentSnapshot) => {
    const contextKey = JSON.stringify([value.profileId, value.epoch, value.serverGeneration]);
    if (observedContext.current !== contextKey || !value.models.some(row => row.id === model)) setConsent(false);
    observedContext.current = contextKey;
    setSnapshot(value);
    setModel(previous => value.models.some(row => row.id === previous) ? previous : value.models[0]?.id || '');
    const outstanding = pending.current;
    if (outstanding) {
      const receipt = value.observedAction?.actionId === outstanding.actionId ? value.observedAction
        : value.actions.find(row => row.actionId === outstanding.actionId);
      if (receipt && settled.has(receipt.state)) {
        pending.current = null; setUncertain(false);
        if (receipt.conversationId) setSelectedId(value.conversations.some(row => row.id === receipt.conversationId) ? receipt.conversationId : null);
        if (receipt.state === 'completed') { setPrompt(''); setConsent(false); }
      } else setUncertain(true);
    }
  };
  const expectedContext = (): NativePersistentContext | null => snapshot?.available && snapshot.profileId && snapshot.epoch && snapshot.serverGeneration
    ? { profileId: snapshot.profileId, epoch: snapshot.epoch, serverGeneration: snapshot.serverGeneration } : null;
  const read = async () => {
    if (inFlight.current) return;
    inFlight.current = true; if (mounted.current) setBusy(true);
    try {
      const response = await transport.current.nativePersistentRequest({ action: 'snapshot',
        ...(pending.current ? { actionId: pending.current.actionId } : {}) });
      if (!mounted.current) return;
      if (response.ok) { accept(response.value); setError(null); }
      else setError(response.error.code);
    } catch { if (mounted.current) setError('connection_unavailable'); }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
  };
  useEffect(() => {
    mounted.current = true; void read();
    return () => { mounted.current = false; };
  }, []);
  const mutate = async (body: Mutation) => {
    if (inFlight.current || locked || pending.current) return;
    inFlight.current = true; pending.current = body; setBusy(true); setError(null);
    try {
      const response = await transport.current.nativePersistentRequest(body);
      if (!mounted.current) return;
      if (response.ok) accept(response.value);
      else {
        // The next read checks durable receipts, without replaying this action.
        setError(response.error.code);
        if (response.error.knownNotStarted) { pending.current = null; setUncertain(false); }
        else setUncertain(true);
      }
    } catch { if (mounted.current) { setError('connection_unavailable'); setUncertain(true); } }
    finally { inFlight.current = false; if (mounted.current) setBusy(false); }
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
  const statusText = (status: string) => ({ idle: ru ? 'Готов' : 'Ready', running: ru ? 'Выполняется' : 'Running',
    unknown: ru ? 'Исход требует проверки' : 'Outcome needs inspection', unavailable: ru ? 'Исполнитель закрыт' : 'Owner closed' })[status] || status;
  const ready = selected?.status === 'idle' && selected.ownerAvailable;

  return <Panel className="native-persistent" title={ru ? 'Сохранённые диалоги Native' : 'Retained Native conversations'}
    actions={<Button disabled={disabled || busy} busy={busy} onClick={() => void read()}>{ru ? 'Обновить диалоги' : 'Refresh conversations'}</Button>}>
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
    {uncertain ? <p role="status">{ru ? 'Ожидается подтверждённый исход исходного действия; новые отправки заблокированы.'
      : 'The original action needs a confirmed outcome; new sends are held.'}</p> : null}
    <div className="native-persistent__layout">
      <div>
        <Button size="sm" disabled={locked} onClick={() => { setSelectedId(null); setPrompt(''); setConsent(false); }}>
          {ru ? 'Новый диалог' : 'New conversation'}</Button>
        {!snapshot?.conversations.length ? <EmptyState title={ru ? 'Сохранённых диалогов пока нет' : 'No retained conversations yet'} /> :
          <ul className="native-persistent__list">{snapshot.conversations.map(row => <li key={row.id}>
            <Button variant={row.id === selectedId ? 'secondary' : 'ghost'} disabled={locked}
              onClick={() => { setSelectedId(row.id); setPrompt(''); setConsent(false); }}>
              {row.model} · {row.id.slice(0, 8)} · {statusText(row.status)}
            </Button>
            {row.parentId ? <small>{ru ? 'Ответвление от' : 'Forked from'} {row.parentId.slice(0, 8)}</small> : null}
          </li>)}</ul>}
      </div>
      <div className="native-persistent__detail">
        {selected ? <>
          <div><Badge>{statusText(selected.status)}</Badge> <code>{selected.threadId || selected.id}</code></div>
          {selected.lastSummary !== undefined ? <pre className="native-persistent__answer">{selected.lastSummary}</pre> : null}
          {!selected.ownerAvailable ? <Notice title={ru ? 'Контекст сохранён, исполнитель недоступен' : 'Context retained; owner unavailable'}>
            {ru ? 'Автоматического возобновления после перезапуска нет. Сохранённая запись не означает действующее подключение.'
              : 'Restart does not automatically resume this conversation. A retained record does not establish a live connection.'}
          </Notice> : null}
        </> : <>
          <Select label={ru ? 'Модель сохранённого диалога' : 'Retained conversation model'} value={model}
            disabled={locked || !snapshot?.available} options={(snapshot?.models || []).map(row => ({ value: row.id, label: row.label || row.id }))}
            onChange={value => { setModel(value); setConsent(false); }} />
          <Checkbox checked={consent} disabled={locked || !snapshot?.available} onChange={setConsent}
            label={ru ? 'Сохранить сообщения и контекст этого нового диалога локально для продолжения и ответвлений.'
              : 'Retain this new conversation’s messages and context locally for continuation and forks.'} />
        </>}
        <label htmlFor={promptId}>{ru ? 'Сообщение Native' : 'Native message'}</label>
        <textarea id={promptId} className="nk-input native-persistent__prompt" value={prompt} maxLength={32768}
          disabled={locked || !snapshot?.available || Boolean(selected && !ready)} onChange={event => setPrompt(event.target.value)} />
        <div className="native-persistent__actions">
          <Button variant="primary" disabled={locked || !textAllowed || !snapshot?.available || (selected ? !ready : !consent || !model)}
            busy={busy} onClick={selected ? send : create}>{selected ? (ru ? 'Продолжить диалог' : 'Continue conversation') : (ru ? 'Создать и отправить' : 'Create and send')}</Button>
          {selected ? <Button disabled={locked || !ready || Boolean(prompt.trim())} onClick={fork}>{ru ? 'Ответвить сохранённый контекст' : 'Fork retained context'}</Button> : null}
        </div>
        {selected && prompt.trim() ? <small>{ru ? 'Перед ответвлением отправьте или очистите черновик сообщения.' : 'Send or clear the draft before forking.'}</small> : null}
        <p className="native-persistent__hint">{ru ? 'Сообщение отправляется только по нажатию. Инструменты Native отключены. Ответвление сохраняет контекст, но само не отправляет сообщение. Передача стороннему клиенту пока недоступна.'
          : 'Messages are sent only by clicking. Native tools are disabled. Forking retains context without sending a message. Handoff to another client is not available yet.'}</p>
      </div>
    </div>
  </Panel>;
}
