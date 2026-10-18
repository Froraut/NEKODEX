import { useEffect, useState } from 'react';
import { Badge, Button, Notice, Panel } from './design';
import { stripIpcErrorPrefix } from './ipc-error';
import type { BrowserTaskState, Language } from './types';
import type { TaskPlanObservation, TaskPlanPolicy, TaskRequirementBook, TaskRequirementCoverageInput } from './task-plan-types';

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
    <TaskRequirements task={task} language={language} plan={plan} onPlan={setPlan} />
  </section>;
}

function TaskRequirements({ task, language, plan, onPlan }: { task: BrowserTaskState; language: Language;
  plan: TaskPlanObservation | null; onPlan(value: TaskPlanObservation | null): void }) {
  const ru = language === 'ru'; const api = window.codexWebLauncher;
  const [book, setBook] = useState<TaskRequirementBook | null>(null);
  const [loaded, setLoaded] = useState(false); const [draft, setDraft] = useState('');
  const [consent, setConsent] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const refresh = async () => {
    if (!api) return;
    const [current, currentPlan] = await Promise.all([api.taskRequirements(task.accountId, task.id), api.taskPlan(task.accountId, task.id)]);
    setBook(current); onPlan(currentPlan); setLoaded(true);
  };
  const perform = async (operation: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await operation(); }
    catch (cause) { setError(errorText(cause)); try { await refresh(); } catch {} }
    finally { setBusy(false); }
  };
  const currentRequirements = book?.history.at(-1)?.requirements ?? [];
  return <section className="task-details__section">
    <h3>{ru ? 'Требования и подтверждения' : 'Requirements and confirmation'}</h3>
    <p>{ru ? 'Введите исходные требования самостоятельно, по одному на строку. Исправления сохраняются отдельными редакциями. Текст запроса и системные инструкции автоматически не копируются.' : 'Enter the original requirements yourself, one per line. Corrections are retained as separate revisions. Prompt text and system instructions are never copied automatically.'}</p>
    <Notice tone="warning" title={ru ? 'Проверка свойств результата недоступна' : 'Property verification is unavailable'}>
      {ru ? 'План отражает заявление модели; успешный инструмент подтверждает только наблюдённое действие. Ваше личное подтверждение отмечается отдельно и не становится проверкой со стороны системы.' : 'A plan is a model claim; a successful tool result establishes only an observed action. Your personal confirmation is labeled separately and does not become system verification.'}
    </Notice>
    <Button size="sm" disabled={!api || busy} busy={busy} onClick={() => { void perform(refresh); }}>{ru ? 'Загрузить / обновить требования и план' : 'Load / refresh requirements and plan'}</Button>
    {error ? <p role="alert">{error}</p> : null}
    {loaded ? <>
      <p>{ru ? 'Связи относятся к загруженной редакции. Перед новой оценкой обновите данные.' : 'Associations refer to the loaded revision. Refresh before a new assessment.'}</p>
      {book ? <p>{ru ? 'Редакция требований' : 'Requirements revision'} {book.requirementRevision} · {ru ? 'редакция плана' : 'plan revision'} {book.planRevision ?? (ru ? 'не наблюдалась' : 'unobserved')} · <code>{book.native.turnId}</code></p> : null}
      <label>{book ? (ru ? 'Полный список требований после исправления' : 'Complete requirements after correction') : (ru ? 'Исходные требования' : 'Original requirements')}
        <textarea rows={4} value={draft} disabled={busy} onChange={event => setDraft(event.target.value)} placeholder={ru ? 'Одно требование на строку; до 16 строк' : 'One requirement per line; up to 16 lines'} />
      </label>
      {book ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDraft(currentRequirements.map(row => row.text).join('\n'))}>{ru ? 'Скопировать текущий список в редактор' : 'Copy current requirements into editor'}</Button> : null}
      <label><input type="checkbox" checked={consent} disabled={busy} onChange={event => setConsent(event.target.checked)} /> {ru ? 'Разрешаю сохранить введённый мной текст требований локально, включая историю исправлений.' : 'Allow local retention of the requirement text I entered, including correction history.'}</label>
      <Button size="sm" disabled={busy || !consent || !draft.trim()} onClick={() => { void perform(async () => {
        if (!api) return;
        const saved = await api.saveTaskRequirements({ accountId: task.accountId, taskId: task.id, expectedRevision: book?.revision ?? 0,
          texts: draft.split(/\r?\n/).map(value => value.trim()).filter(Boolean), captureConsent: true });
        setBook(saved); setDraft(''); setConsent(false);
      }); }}>{book ? (ru ? 'Сохранить исправление' : 'Save correction') : (ru ? 'Сохранить исходные требования' : 'Save original requirements')}</Button>
      {book ? <>
        <p>{ru ? 'Связано с планом' : 'Associated with plan'}: {currentRequirements.filter(requirement => book.coverage.some(row => row.requirementId === requirement.id && row.stepIndexes.length)).length}/{currentRequirements.length} · {ru ? 'лично подтверждено' : 'personally confirmed'}: {book.coverage.filter(row => row.userAttestation).length}/{currentRequirements.length}</p>
        {book.invalidation ? <p role="status">{ru ? 'После изменения плана или требований прежние связи и личные подтверждения исключены из текущего покрытия; история сохранена.' : 'After a plan or requirement change, earlier associations and personal confirmations are excluded from current coverage; history is retained.'}</p> : null}
        {currentRequirements.map(requirement => <RequirementCoverageEditor key={requirement.id} requirement={requirement} book={book} plan={plan} ru={ru} busy={busy} onSave={input => perform(async () => {
          if (api) setBook(await api.updateTaskRequirementCoverage({ ...input, accountId: task.accountId, taskId: task.id, expectedRevision: book.revision }));
        })} />)}
        <details><summary>{ru ? 'Исходные требования и исправления' : 'Original requirements and corrections'} ({book.history.length}/8)</summary>
          {book.history.map(revision => <article key={revision.revision}><h4>{revision.source === 'user-original' ? (ru ? 'Исходная редакция' : 'Original revision') : (ru ? 'Исправление' : 'Correction')} {revision.revision}</h4><ol>{revision.requirements.map(row => <li key={row.id}>{row.text}</li>)}</ol></article>)}
        </details>
        <details><summary>{ru ? 'История связей и личных подтверждений' : 'Association and personal-confirmation history'} ({book.coverageHistory.length}/64)</summary>
          <ul>{book.coverageHistory.map(row => <li key={row.id}>{ru ? 'Требования' : 'Requirements'} {row.requirementRevision} · {ru ? 'план' : 'plan'} {row.planRevision ?? '—'} · {book.history.find(revision => revision.revision === row.requirementRevision)?.requirements.find(requirement => requirement.id === row.requirementId)?.text}
            {' · '}{row.userAttestation ? (ru ? 'подтверждено пользователем' : 'user-confirmed') : (ru ? 'без личного подтверждения' : 'no personal confirmation')}
            {' · '}{book.coverage.some(current => current.id === row.id) ? (ru ? 'текущая сохранённая оценка' : 'current retained assessment') : (ru ? 'предыдущая оценка, не текущее подтверждение' : 'previous assessment, not current confirmation')}
          </li>)}</ul>
        </details>
        <p>{ru ? 'При заполнении лимита новые изменения отклоняются; сохранённая история автоматически не удаляется.' : 'When a storage/history limit is reached, new changes are refused; retained history is never removed automatically.'}</p>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => {
          if (!window.confirm(ru ? 'Удалить сохранённые требования, исправления и личные подтверждения этой задачи? Наблюдённый план останется.' : 'Delete the retained requirements, corrections and personal confirmations for this task? Its observed plan will remain.')) return;
          void perform(async () => { if (api) { await api.deleteTaskRequirements(task.accountId, task.id, book.revision); setBook(null); } });
        }}>{ru ? 'Удалить эти требования и историю подтверждений' : 'Delete these requirements and confirmation history'}</Button>
      </> : null}
    </> : null}
  </section>;
}

function RequirementCoverageEditor({ requirement, book, plan, ru, busy, onSave }: {
  requirement: { id: string; text: string }; book: TaskRequirementBook; plan: TaskPlanObservation | null; ru: boolean; busy: boolean;
  onSave(input: Omit<TaskRequirementCoverageInput, 'accountId' | 'taskId' | 'expectedRevision'>): Promise<void>;
}) {
  const saved = book.coverage.find(row => row.requirementId === requirement.id);
  const [steps, setSteps] = useState<number[]>(saved?.stepIndexes ?? []);
  const [actions, setActions] = useState<string[]>(saved?.actionReferences.map(action => action.key) ?? []);
  const [confirmed, setConfirmed] = useState(Boolean(saved?.userAttestation));
  useEffect(() => { setSteps(saved?.stepIndexes ?? []); setActions(saved?.actionReferences.map(action => action.key) ?? []); setConfirmed(Boolean(saved?.userAttestation)); }, [book.requirementRevision, book.planRevision]);
  const latest = plan?.revisions.at(-1);
  const planMatches = (latest?.revision ?? null) === book.planRevision;
  const toggle = <T,>(values: T[], value: T, checked: boolean) => checked ? [...values, value] : values.filter(item => item !== value);
  return <article>
    <h4>{requirement.text}</h4>
    <p><Badge>{saved?.stepIndexes.length ? (ru ? 'Связано с планом' : 'Associated with plan') : (ru ? 'Нет связи с планом' : 'No plan association')}</Badge>{' '}
      {saved?.actionReferences.length ? <Badge>{ru ? 'Действие наблюдалось' : 'Action observed'}</Badge> : null}{' '}
      {saved?.userAttestation ? <Badge>{ru ? 'Подтверждено пользователем' : 'User-confirmed'}</Badge> : null}</p>
    <fieldset disabled={busy}><legend>{ru ? 'Связанные шаги текущей редакции плана' : 'Associated steps in this plan revision'}</legend>
      {planMatches && latest?.steps.length ? latest.steps.map((step, index) => <label key={index}><input type="checkbox" checked={steps.includes(index)} onChange={event => setSteps(toggle(steps, index, event.target.checked))} /> {step.text} · {({ pending: ru ? 'Ожидает' : 'Pending', in_progress: ru ? 'В работе' : 'In progress', completed: ru ? 'Заявлен выполненным' : 'Claimed complete' })[step.claimedStatus]}</label>) : <p>{ru ? 'Шаги не наблюдались или план нужно обновить.' : 'Steps are unobserved or the plan needs refreshing.'}</p>}
    </fieldset>
    <fieldset disabled={busy}><legend>{ru ? 'Наблюдённые успешные результаты инструментов этой задачи' : 'Observed successful tool results for this task'}</legend>
      <p>{ru ? 'Вы связываете действие с требованием; это не подтверждение свойства результата.' : 'You associate an action with this requirement; it does not verify a result property.'}</p>
      {book.availableActions.length ? book.availableActions.map(action => <label key={action.key}><input type="checkbox" checked={actions.includes(action.key)} disabled={!actions.includes(action.key) && actions.length >= 8} onChange={event => setActions(toggle(actions, action.key, event.target.checked))} /> <code>{action.namespace ? `${action.namespace}/` : ''}{action.name}</code> · {new Date(action.observedAt).toLocaleString()}</label>) : <p>{ru ? 'Владелец задачи не предоставил наблюдённых успешных результатов.' : 'The task owner supplied no observed successful results.'}</p>}
    </fieldset>
    <label><input type="checkbox" checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} /> {ru ? 'Я лично подтверждаю результат по этому требованию (подтверждение пользователя).' : 'I personally confirm the result for this requirement (user confirmation).'}</label>
    <Button size="sm" disabled={busy || !planMatches} onClick={() => { void onSave({ requirementId: requirement.id, stepIndexes: steps, actionKeys: actions, userConfirmed: confirmed }); }}>{ru ? 'Сохранить связи и личное подтверждение' : 'Save associations and personal confirmation'}</Button>
  </article>;
}
