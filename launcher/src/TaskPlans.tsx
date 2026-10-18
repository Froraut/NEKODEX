import { useEffect, useState } from 'react';
import { Badge, Button, Notice, Panel } from './design';
import { stripIpcErrorPrefix } from './ipc-error';
import type { BrowserTaskState, Language } from './types';
import type { TaskPlanObservation, TaskPlanPolicy } from './task-plan-types';

const errorText = (value: unknown) => stripIpcErrorPrefix(value instanceof Error ? value.message : String(value));
export function TaskPlanCapture({ language }: { language: Language }) {
  const ru = language === 'ru';
  const api = window.codexWebLauncher;
  const [policy, setPolicy] = useState<TaskPlanPolicy | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { let alive = true; void api?.taskPlanPolicy().then(value => { if (alive) setPolicy(value); }).catch(cause => { if (alive) setError(errorText(cause)); }); return () => { alive = false; }; }, [api]);
  return <Panel title={ru ? 'Планы задач' : 'Task plans'}>
    <p>{ru ? 'По желанию сохраняйте текст планов из текущего хода Codex. Он может содержать личные данные. Системные инструкции и аргументы других инструментов сюда не записываются. Отключение сохраняет уже записанные планы.' : 'Optionally retain plan text from the current Codex turn. It may contain personal data. System instructions and other tool arguments are excluded. Disabling capture retains existing plans.'}</p>
    <Button disabled={busy || !policy} busy={busy} onClick={() => {
      if (!api || !policy) return; setBusy(true); setError('');
      void api.setTaskPlanCapture(!policy.enabled, policy.revision).then(setPolicy).catch(async cause => {
        setError(errorText(cause));
        // Refresh the captured revision without replaying a changed preference.
        try { setPolicy(await api.taskPlanPolicy()); } catch {}
      }).finally(() => setBusy(false));
    }}>{policy?.enabled ? (ru ? 'Отключить запись планов' : 'Disable plan capture') : (ru ? 'Включить запись планов' : 'Enable plan capture')}</Button>
    <Button variant="ghost" disabled={busy || !api} onClick={() => {
      if (!api) return; setBusy(true); setError('');
      void api.taskPlanPolicy().then(setPolicy).catch(cause => setError(errorText(cause))).finally(() => setBusy(false));
    }}>{ru ? 'Обновить состояние записи' : 'Refresh capture status'}</Button>
    {policy ? <p role="status">{policy.enabled ? (ru ? 'Запись включена для следующих запросов.' : 'Capture is enabled for subsequent requests.') : (ru ? 'Запись выключена.' : 'Capture is disabled.')}</p> : null}
    {error || policy?.storageIssue ? <Notice tone="warning" title={ru ? 'Запись требует внимания' : 'Capture needs attention'}>{error || policy?.storageIssue}</Notice> : null}
  </Panel>;
}

export function TaskPlanView({ task, language }: { task: BrowserTaskState; language: Language }) {
  const ru = language === 'ru';
  const api = window.codexWebLauncher;
  const [plan, setPlan] = useState<TaskPlanObservation | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Explicit loading keeps content-bearing storage out of background task snapshots.
  return <section className="task-details__section">
    <h3>{ru ? 'Наблюдённый план' : 'Observed plan'}</h3>
    <p>{ru ? 'Статус шага заявляет модель. Наблюдение update_plan подтверждает изменение плана; результат задачи требует отдельного подтверждения.' : 'Step status is a model claim. Observing update_plan confirms a plan change; task outcomes require separate evidence.'}</p>
    <Button size="sm" disabled={!api || busy} busy={busy} onClick={() => {
      if (!api) return; setBusy(true); setError('');
      void api.taskPlan(task.accountId, task.id).then(value => { setPlan(value); setLoaded(true); }).catch(cause => setError(errorText(cause))).finally(() => setBusy(false));
    }}>{ru ? 'Загрузить сохранённый план' : 'Load retained plan'}</Button>
    {error ? <p role="alert">{error}</p> : null}
    {loaded && !plan ? <p role="status">{ru ? 'Для этой задачи план не записан. Включите запись до следующего запроса.' : 'No plan was retained for this task. Enable capture before the next request.'}</p> : null}
    {plan ? <>
      <p><code>{plan.native?.threadId}</code> · <code>{plan.native?.turnId}</code></p>
      {plan.revisions.map((revision, index) => <article key={revision.sourceCallId}>
        <h4>{ru ? 'Редакция' : 'Revision'} {revision.revision} <Badge>{index === plan.revisions.length - 1 ? (ru ? 'Текущая' : 'Current') : (ru ? 'Заменена' : 'Superseded')}</Badge></h4>
        {revision.explanation ? <p>{revision.explanation}</p> : null}
        <p>{ru ? 'Исходный вызов' : 'Source call'}: <code>{revision.sourceCallId}</code>{revision.sourceMessageId ? <> · <code>{revision.sourceMessageId}</code></> : null}</p>
        <ol>{revision.steps.map((step, stepIndex) => <li key={stepIndex}>{step.text} <Badge>{({ pending: ru ? 'Ожидает' : 'Pending', in_progress: ru ? 'В работе' : 'In progress', completed: ru ? 'Заявлен выполненным' : 'Claimed complete' })[step.claimedStatus]}</Badge> · {ru ? 'результат не проверен' : 'outcome unverified'}</li>)}</ol>
      </article>)}
      {plan.truncated ? <p>{ru ? 'Сохранена ограниченная часть редакций.' : 'A bounded subset of revisions was retained.'}</p> : null}
      <Button size="sm" variant="ghost" disabled={busy} onClick={() => { if (!api) return; setBusy(true); void api.deleteTaskPlan(task.accountId, task.id).then(() => setPlan(null)).catch(cause => setError(errorText(cause))).finally(() => setBusy(false)); }}>{ru ? 'Удалить этот сохранённый план' : 'Delete this retained plan'}</Button>
    </> : null}
  </section>;
}
