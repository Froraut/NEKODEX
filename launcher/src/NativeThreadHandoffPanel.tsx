import { useEffect, useId, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Notice } from './design';
import type { Language } from './types';
import type { CodexThreadHandoffReceipt, CodexThreadHandoffSnapshot, CodexThreadMetadata, NativeThreadsApi,
  NativeThreadsResult } from './native-threads-types';

const en = {
  title: 'Continue here (exclusive handoff)',
  body: 'NEKODEX starts its own Codex connection, takes this thread only if no other Codex client holds it, sends this one message, waits for the final reply and then releases the thread back to Codex.',
  exclusivity: 'Codex enforces exclusivity with its per-thread writer lock. If the thread is open in Codex Desktop or a CLI session, Codex refuses and nothing is sent: close or switch away from it there first.',
  settings: 'The thread keeps its own model, service tier, sandbox and approval settings. Approval and input requests are declined here, so commands that need approval do not run.',
  message: 'Message for this thread', send: 'Take over and send', sending: 'Running in NEKODEX…',
  subagent: 'Subagent threads stay with their parent conversation and cannot be handed off.',
  active: 'Codex reports this thread active on this connection. Wait until it is idle.',
  stop: 'Stop this turn', stopping: 'Stopping…', stopUnknown: 'Stop outcome is unconfirmed; the turn remains owned until its final state.',
  released: 'Turn ended; thread released to Codex', noReply: 'The turn ended without a final assistant message.',
  truncated: 'The reply was shortened to 128 KiB here; the full reply is in the thread.',
  turn: 'Turn', status: 'Final state', refused: 'Approval or input requests declined',
  statuses: { completed: 'Completed', interrupted: 'Interrupted', failed: 'Failed' },
  failed: 'Handoff did not complete', unknown: 'Handoff outcome requires inspection',
  unknownBody: 'NEKODEX could not confirm the outcome. Open the thread in Codex and check whether the message was sent before continuing. Acknowledging does not confirm either outcome.',
  acknowledge: 'I inspected this thread', unavailable: 'Exclusive handoff is unavailable in this build.',
  generic: 'The exclusive handoff is unavailable. Check the configured official Codex executable and profile.',
};
const ru: typeof en = {
  title: 'Продолжить здесь (исключительная передача)',
  body: 'NEKODEX запускает своё подключение Codex, забирает этот чат только если его не держит другой клиент Codex, отправляет одно сообщение, ждёт итоговый ответ и возвращает чат Codex.',
  exclusivity: 'Исключительность обеспечивает сам Codex блокировкой записи чата. Если чат открыт в Codex Desktop или CLI, Codex откажет и ничего не будет отправлено: сначала закройте его там или переключитесь на другой.',
  settings: 'Чат сохраняет свою модель, уровень обслуживания (service tier), песочницу и правила согласований. Запросы согласования и ввода здесь отклоняются, поэтому команды, требующие согласования, не выполнятся.',
  message: 'Сообщение для этого чата', send: 'Забрать и отправить', sending: 'Выполняется в NEKODEX…',
  subagent: 'Чаты субагентов остаются у родительского диалога и не передаются.',
  active: 'Codex сообщает, что чат выполняется в этом подключении. Дождитесь ожидания.',
  stop: 'Остановить этот ход', stopping: 'Остановка…', stopUnknown: 'Остановка не подтверждена; ход остаётся под управлением NEKODEX до итогового состояния.',
  released: 'Ход завершён; чат возвращён Codex', noReply: 'Ход завершился без итогового сообщения ассистента.',
  truncated: 'Ответ сокращён здесь до 128 КиБ; полный ответ есть в чате.',
  turn: 'Ход', status: 'Итоговое состояние', refused: 'Отклонено запросов согласования или ввода',
  statuses: { completed: 'Завершён', interrupted: 'Прерван', failed: 'Ошибка' },
  failed: 'Передача не выполнена', unknown: 'Результат передачи нужно проверить',
  unknownBody: 'NEKODEX не смог подтвердить результат. Откройте чат в Codex и проверьте, было ли отправлено сообщение, прежде чем продолжать. Отметка не подтверждает ни один исход.',
  acknowledge: 'Я проверил этот чат', unavailable: 'Исключительная передача недоступна в этой сборке.',
  generic: 'Исключительная передача недоступна. Проверьте настроенный официальный исполняемый файл и профиль Codex.',
};
type SafeError = { code: string; message: string; rpcCode?: number };

export function NativeThreadHandoffPanel({ language, disabled = false, api, thread, onSettled }: {
  language: Language; disabled?: boolean; api: NativeThreadsApi; thread: CodexThreadMetadata; onSettled?: (threadId: string) => void;
}) {
  const text = language === 'ru' ? ru : en;
  const [snapshot, setSnapshot] = useState<CodexThreadHandoffSnapshot | null>(null);
  // Drafts, errors and receipts are keyed by thread, so nothing typed or received for one
  // thread is shown or sent for another, and a late result lands on its own thread.
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, SafeError>>({});
  const [receipts, setReceipts] = useState<Record<string, CodexThreadHandoffReceipt>>({});
  const [stopPending, setStopPending] = useState(false);
  const stopLock = useRef(false), refreshInFlight = useRef(false), currentApi = useRef(api);
  currentApi.current = api;
  const [busyThread, setBusyThread] = useState<string | null>(null);
  const locked = useRef(false), mounted = useRef(true), selectedThread = useRef(thread.id);
  selectedThread.current = thread.id;
  const messageId = useId();
  const message = drafts[thread.id] ?? '', error = errors[thread.id] ?? null, receipt = receipts[thread.id] ?? null;
  const busy = busyThread !== null;
  const refresh = async () => {
    if (!mounted.current || refreshInFlight.current) return;
    const source = api; refreshInFlight.current = true;
    try {
      const result = await source.nativeThreadHandoffSnapshot?.();
      if (mounted.current && source === currentApi.current && result?.ok) setSnapshot(result.value);
    } catch { /* Passive receipt state only; errors stay with the action that caused them. */ }
    finally { refreshInFlight.current = false; }
  };
  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, [api]);
  // A handoff started by an earlier mount (or another window) is visible only through the
  // main-owned snapshot. Re-read that local state while one is active; it starts no provider work.
  const activeAction = snapshot?.active?.actionId ?? null;
  useEffect(() => {
    if (!activeAction && !busy) return;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 2000);
    return () => clearInterval(timer);
  }, [activeAction, busy, api]);
  const keyed = <T,>(setter: (update: (rows: Record<string, T>) => Record<string, T>) => void, id: string, value: T | null) =>
    setter(rows => { const next = { ...rows }; if (value === null) delete next[id]; else next[id] = value; return next; });
  const unwrap = <T,>(result: NativeThreadsResult<T> | undefined): T => {
    if (!result || typeof result !== 'object' || !('ok' in result)) throw { code: 'handoff_unavailable', message: text.generic };
    if (!result.ok) throw result.error;
    return result.value;
  };
  const perform = async (actionThread: string, action: () => Promise<void>) => {
    if (disabled || locked.current) return;
    locked.current = true; setBusyThread(actionThread); keyed(setErrors, actionThread, null);
    try { await action(); }
    catch (reason) {
      // Only the registrar's sanitized envelope may reach this view, never an IPC exception text.
      const safe = reason && typeof reason === 'object' && 'code' in reason && 'message' in reason
        && !(reason instanceof Error) ? reason as SafeError : { code: 'handoff_unavailable', message: text.generic };
      if (mounted.current) keyed(setErrors, actionThread, safe);
    } finally {
      await refresh();
      if (mounted.current) setBusyThread(null);
      locked.current = false;
      // Refresh metadata only when the user is still looking at that thread.
      if (mounted.current && selectedThread.current === actionThread) onSettled?.(actionThread);
    }
  };
  const uncertain = snapshot?.uncertainHandoffs || [];
  const blocked = uncertain.some(action => action.threadId === thread.id) || Boolean(snapshot?.active);
  const subagent = Boolean(thread.parentThreadId);
  const activeHere = thread.status.type === 'active';
  const setMessage = (value: string) => keyed(setDrafts, thread.id, value || null);
  const send = () => {
    const target = thread.id, value = message;
    if (!value.trim()) return;
    void perform(target, async () => {
      keyed(setReceipts, target, null);
      const result = unwrap(await api.nativeThreadContinue?.({ threadId: target, text: value }));
      if (!mounted.current) return;
      keyed(setReceipts, target, result); keyed(setDrafts, target, null);
    });
  };
  const stop = async () => {
    const owned = snapshot?.active;
    if (disabled || stopLock.current || !owned?.stopAvailable || owned.threadId !== thread.id || !api.nativeThreadStopHandoff) return;
    stopLock.current = true; setStopPending(true);
    try {
      const result = unwrap(await api.nativeThreadStopHandoff({ actionId: owned.actionId, threadId: owned.threadId }));
      if (mounted.current) setSnapshot(result);
    } catch (reason) {
      const safe = reason && typeof reason === 'object' && 'code' in reason && 'message' in reason
        && !(reason instanceof Error) ? reason as SafeError : { code: 'handoff_unavailable', message: text.generic };
      if (mounted.current) keyed(setErrors, owned.threadId, safe);
    } finally { stopLock.current = false; if (mounted.current) setStopPending(false); await refresh(); }
  };
  const acknowledge = (actionId: string) => {
    const target = thread.id;
    void perform(target, async () => {
      const result = unwrap(await api.nativeThreadAcknowledgeHandoff?.({ actionId, threadId: target, confirmedInspection: true }));
      if (mounted.current) setSnapshot(result);
    });
  };
  if (!api.nativeThreadContinue) return null;
  return <section className="native-threads__handoff" aria-labelledby={`${messageId}-title`}>
    <h4 id={`${messageId}-title`}>{text.title}</h4>
    <p>{text.body}</p>
    <p className="native-threads__hint">{text.exclusivity} {text.settings}</p>
    {snapshot && !snapshot.available ? <Notice tone="warning" title={text.unavailable} /> : null}
    {uncertain.filter(action => action.threadId === thread.id).map(action => <Notice key={action.actionId} tone="warning"
      title={text.unknown} meta={`${action.actionId}${action.turnId ? ` · ${text.turn} ${action.turnId}` : ''}${action.reasonCode ? ` · ${action.reasonCode}` : ''}`}
      action={<Button size="sm" disabled={disabled || busy || action.state === 'pending'} onClick={() => acknowledge(action.actionId)}>{text.acknowledge}</Button>}>
      {text.unknownBody}</Notice>)}
    {snapshot?.active?.threadId === thread.id && snapshot.active.turnId && api.nativeThreadStopHandoff ? <div className="native-threads__actions">
      <Button size="sm" busy={stopPending} disabled={disabled || stopPending || !snapshot.active.stopAvailable} onClick={() => void stop()}>
        {snapshot.active.stopState ? text.stopping : text.stop}</Button>
      {snapshot.active.stopState === 'unknown' ? <p className="native-threads__hint">{text.stopUnknown}</p> : null}
    </div> : null}
    {error ? <Notice tone="error" title={text.failed} meta={`${error.code}${error.rpcCode === undefined ? '' : ` · RPC ${error.rpcCode}`}`}>{error.message}</Notice> : null}
    {receipt ? <Notice tone={receipt.turnStatus === 'completed' ? 'success' : 'warning'} title={text.released}
      meta={`${text.turn} ${receipt.turnId}`}>
      <BadgeRow><Badge>{text.status}: {text.statuses[receipt.turnStatus]}</Badge>
        {receipt.approvalsRefused ? <Badge tone="warning">{text.refused}: {receipt.approvalsRefused}</Badge> : null}</BadgeRow>
      {receipt.assistantText ? <p className="native-threads__reply">{receipt.assistantText}</p> : <p>{text.noReply}</p>}
      {receipt.assistantTextTruncated ? <p className="native-threads__hint">{text.truncated}</p> : null}
    </Notice> : null}
    {subagent ? <p className="native-threads__hint">{text.subagent}</p> : activeHere ? <p className="native-threads__hint">{text.active}</p> : <>
      <label htmlFor={messageId}>{text.message}</label>
      <textarea id={messageId} className="nk-input native-threads__prompt" value={message} maxLength={32768}
        disabled={disabled || busy || blocked} onChange={event => setMessage(event.target.value)} />
      <div className="native-threads__actions"><Button variant="primary" busy={busyThread === thread.id}
        disabled={disabled || busy || blocked || !message.trim() || snapshot?.available === false}
        onClick={send}>{busyThread === thread.id ? text.sending : text.send}</Button></div>
    </>}
  </section>;
}
