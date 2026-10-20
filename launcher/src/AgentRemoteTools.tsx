import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Checkbox, Notice, Panel, Select } from './design';
import type { AgentToolsApi, RemoteAgentStatus, RemoteAgentTaskScope } from './agent-tools-types';
import type { RemoteAgentBinding } from '../electron/agent-remote-types.cjs';
import { stripIpcErrorPrefix } from './ipc-error';

/** Main supplies saved host/connection metadata. This surface never connects SSH or supplies roots. */
export function AgentRemoteTools({ api, remote, scope, locked, choose, act, refresh }: {
  api: AgentToolsApi; remote?: RemoteAgentStatus | null; scope?: RemoteAgentTaskScope; locked: boolean;
  choose: (en: string, ru: string) => string; act: (operation: () => Promise<void>) => Promise<void>; refresh: () => Promise<void>;
}) {
  const [hostId, setHostId] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [unknown, setUnknown] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const revokeOwner = useRef(false);
  const retained = useRef<{ key: string; binding: RemoteAgentBinding } | null>(null);
  const key = scope ? `${scope.taskId}:${scope.familyId}:${scope.generation}` : '';
  const consentKey = `${key}:${scope?.revision ?? ''}`;
  const attachment = remote?.bindings.find(row => row.taskId === scope?.taskId && row.familyId === scope?.familyId && row.generation === scope?.generation);
  if (remote && attachment) retained.current = { key, binding: attachment };
  else if (remote || retained.current?.key !== key) retained.current = null;
  const lastAttachment = attachment ?? retained.current?.binding;
  const selected = remote?.hosts.find(row => row.id === hostId);
  const available = !!selected?.connected && !!selected.canonicalRoot && !selected.busy;
  const identity = selected ? `${selected.id}:${selected.fingerprint}:${selected.canonicalRoot}:${selected.connected}` : '';
  useEffect(() => { setConfirmed(false); setUnknown(false); setError(null); }, [consentKey]);
  useEffect(() => { setConfirmed(false); }, [identity]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const refreshStatus = async () => {
    if (refreshing || revoking) return;
    setRefreshing(true); setError(null);
    try { await refresh(); if (mounted.current) { setUnknown(false); setConfirmed(false); } }
    catch (cause) { if (mounted.current) setError(stripIpcErrorPrefix(cause instanceof Error ? cause.message : String(cause))); }
    finally { if (mounted.current) setRefreshing(false); }
  };
  const revoke = async () => {
    if (revokeOwner.current || !scope) return;
    revokeOwner.current = true; setRevoking(true); setError(null); setConfirmed(false);
    try {
      await api.request({ action: 'revokeRemoteTools', scope: { taskId: scope.taskId, generation: scope.generation, toolCallId: 'remote-selection' }, explicitUserAction: true });
      retained.current = null;
      await refresh();
    } catch (cause) {
      if (mounted.current) { setUnknown(true); setError(stripIpcErrorPrefix(cause instanceof Error ? cause.message : String(cause))); }
    } finally { revokeOwner.current = false; if (mounted.current) setRevoking(false); }
  };
  return <Panel title={choose('Remote Agent tools', 'Удалённые инструменты Agent')}>
    <p>{choose('First connect a saved host in Remote workspace, then select it here and explicitly attach it to the current Agent task. This panel only reads connection metadata; opening or refreshing it never connects SSH.', 'Сначала подключите сохранённый host в разделе Remote workspace, затем выберите его здесь и явно прикрепите к текущей Agent-задаче. Панель читает только метаданные подключения; открытие и обновление не подключают SSH.')}</p>
    <div className="agent-tools-state"><Badge tone={attachment ? 'success' : 'neutral'}>{!remote ? choose('Status unavailable', 'Состояние недоступно') : attachment ? choose('Attached to this task generation', 'Прикреплено к этому поколению задачи') : choose('Off for this task', 'Выключено для этой задачи')}</Badge><span>{choose('Active remote operations', 'Активные удалённые операции')}: {remote?.activeCount ?? choose('Unknown', 'Неизвестно')}</span><Button variant="secondary" disabled={revoking || refreshing} onClick={() => void refreshStatus()}>{choose('Refresh remote status', 'Обновить удалённое состояние')}</Button></div>
    {!remote ? <Notice tone="warning">{choose('The main-process remote source is unavailable. Cached attachment details below do not establish a live connection. Revocation remains available for a retained attachment.', 'Удалённый источник main process недоступен. Сохранённые сведения о привязке ниже не подтверждают живое подключение. Отзыв сохранённой привязки остаётся доступен.')}</Notice> : null}
    {error ? <Notice tone="error" role="alert">{error}</Notice> : null}
    {unknown ? <Notice tone="warning">{choose('The attachment change may already have occurred. Refresh status to reconcile it before another attachment action; do not repeat the mutation automatically.', 'Изменение привязки могло уже произойти. Обновите состояние для сверки перед следующим действием; автоматический повтор запрещён.')}</Notice> : null}
    {!scope ? <p className="agent-tools-muted">{choose('Select an owned Agent task above. Its current family, generation and revision must be loaded before attachment.', 'Выберите Agent-задачу выше. Перед привязкой должны быть загружены её актуальные family, generation и revision.')}</p> : <p className="agent-tools-muted">{choose('Task', 'Задача')}: <code>{scope.taskId}</code> · {choose('Generation', 'Поколение')}: {scope.generation} · {choose('Revision', 'Редакция')}: {scope.revision}</p>}
    <Select label={choose('Saved remote host', 'Сохранённый удалённый host')} value={hostId} disabled={locked || revoking || !remote} onChange={value => { setHostId(value); setConfirmed(false); }} options={[{ value: '', label: choose('Choose an already connected host', 'Выберите уже подключённый host') }, ...(remote?.hosts ?? []).map(host => ({ value: host.id, label: `${host.label} · ${host.username}@${host.hostname}:${host.port} · ${host.connected ? choose('connected', 'подключён') : choose('disconnected', 'отключён')}${host.busy ? ` · ${choose('busy', 'занят')}` : ''}` }))]} />
    {selected ? <div className="agent-remote-identity"><strong>{selected.label}</strong><code>{selected.username}@{selected.hostname}:{selected.port}</code><span>{choose('Canonical root / command CWD', 'Канонический корень / CWD команд')}: <code>{selected.canonicalRoot ?? choose('Not established — connect in Remote workspace', 'Не определён — подключите в Remote workspace')}</code></span><small>{choose('Saved configuration fingerprint (not SSH host-key verification)', 'Отпечаток сохранённой настройки (не проверка SSH host key)')}: <code>{selected.fingerprint}</code></small></div> : null}
    <Notice tone="warning">{choose('The canonical root is a file-operation boundary and command working directory, not an OS sandbox. Commands run with the SSH user’s full permissions and can access locations outside that directory.', 'Канонический корень ограничивает файловые операции и задаёт рабочий каталог команд, но не является OS sandbox. Команды выполняются с полными правами SSH-пользователя и могут обращаться за пределы этого каталога.')}</Notice>
    <Checkbox checked={confirmed} disabled={locked || revoking || !scope || !available || unknown} onChange={setConfirmed} label={choose('I attach this exact connected host and canonical root to this task generation with the SSH user permissions shown above.', 'Я прикрепляю этот точный подключённый host и канонический корень к этому поколению задачи с указанными правами SSH-пользователя.')} />
    <div className="agent-tools-state"><Button disabled={locked || revoking || !scope || !available || !confirmed || unknown || !!attachment} onClick={() => void act(async () => {
      setConfirmed(false); setError(null);
      try { await api.request({ action: 'bindRemoteTools', hostId, scope, explicitUserAction: true }); await refresh(); }
      catch (cause) { if (mounted.current) setUnknown(true); throw cause; }
    })}>{choose('Attach connected remote host', 'Прикрепить подключённый host')}</Button><Button variant="secondary" disabled={revoking || refreshing || !scope} onClick={() => void revoke()}>{revoking ? choose('Revoking…', 'Отзывается…') : choose('Revoke remote attachment', 'Отозвать удалённую привязку')}</Button></div>
    {lastAttachment ? <div className="agent-remote-identity"><strong>{choose('Retained task attachment', 'Сохранённая привязка задачи')}: {lastAttachment.label}</strong><code>{lastAttachment.username}@{lastAttachment.hostname}:{lastAttachment.port}</code><span>{choose('Canonical root / command CWD', 'Канонический корень / CWD команд')}: <code>{lastAttachment.root}</code></span><small>{choose('Attachment', 'Привязка')}: <code>{lastAttachment.attachmentId}</code> · {choose('Connection', 'Подключение')}: <code>{lastAttachment.connectionId}</code></small></div> : null}
    <p className="agent-tools-muted">{choose('Every remote list, read or command still requires approval of the model’s exact saved tool call in the existing approval panel. Revocation blocks future work while preserving already dispatched commands and their receipts. Remote output proves execution only; task or business results require separate observation.', 'Каждый удалённый list, read или command требует подтверждения точного сохранённого запроса модели в существующей панели. Отзыв блокирует будущую работу и сохраняет уже отправленные команды и их квитанции. Удалённый вывод подтверждает только исполнение; результат задачи или бизнес-действия требует отдельного наблюдения.')}</p>
  </Panel>;
}
