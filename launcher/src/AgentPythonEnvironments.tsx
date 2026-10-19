import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Checkbox, Notice, Panel, Select } from './design';
import type { AgentToolsApi, AgentToolsStatus, SkillPythonEnvironmentAction, ToolScope } from './agent-tools-types';

/** Preparation and task attachment are explicit; neither sends a model or runs selected code. */
export function AgentPythonEnvironments({ api, status, scope, locked, choose, act, onChanged }: {
  api: AgentToolsApi; status: AgentToolsStatus | null; scope?: ToolScope; locked: boolean;
  choose: (en: string, ru: string) => string; act: (operation: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void>;
}) {
  const [wheelPaths, setWheelPaths] = useState<string[]>([]);
  const [action, setAction] = useState<SkillPythonEnvironmentAction | null>(null);
  const [pending, setPending] = useState<{ id: string; phase: 'review' | 'prepare' } | null>(null);
  const [prepareAck, setPrepareAck] = useState('');
  const [environmentId, setEnvironmentId] = useState('');
  const [bindingAck, setBindingAck] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [revoking, setRevoking] = useState<string | null>(null);
  const revokeInFlight = useRef(false);
  const inFlight = useRef(false), alive = useRef(true), pendingRef = useRef(pending);
  const context = useRef('');
  context.current = JSON.stringify([scope?.taskId, scope?.generation]);
  const data = status?.pythonEnvironments;
  const bindings = status?.scriptTools?.environmentBindings?.filter(row => row.taskId === scope?.taskId && row.generation === scope?.generation) ?? [];
  const environments = data?.environments ?? [];
  const selected = environments.find(row => row.environmentId === environmentId);
  const held = data?.actions.some(row => row.ownerHeld || row.state === 'prepared' || row.state === 'unknown') ?? false;
  const reviewKey = action ? JSON.stringify([action.actionId, action.reviewDigest]) : '';
  const bindingKey = JSON.stringify([scope?.taskId, scope?.generation, environmentId, selected?.runtimeClosureDigest, selected?.lockDigest]);
  const disabled = locked || busy;
  const executionAvailable = data?.supported === true && status?.capabilities.skillScripts === true
    && status.scriptTools?.capabilities.supported === true && status.scriptTools.capabilities.runtimes?.python.supported === true
    && !status.scriptTools.closed && !status.scriptTools.activeOperations.some(row => row.taskId === scope?.taskId && row.generation === scope?.generation);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setBindingAck(''); }, [scope?.taskId, scope?.generation, environmentId, selected?.runtimeClosureDigest, selected?.lockDigest]);
  function remember(value: typeof pending) { pendingRef.current = value; setPending(value); }
  async function perform(work: () => Promise<void>, refresh = true) {
    if (locked || inFlight.current) return;
    inFlight.current = true; setBusy(true); setNotice('');
    try { await act(async () => { try { await work(); } finally { if (refresh) await onChanged().catch(() => {}); } }); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  function observe(value: SkillPythonEnvironmentAction | null, expected: string) {
    if (!alive.current || pendingRef.current?.id !== expected) return;
    if (!value || value.actionId !== expected) {
      setNotice(choose('No exact saved receipt is available. Keep the action identity and inspect it again; preparation is not resent.', 'Точная сохранённая квитанция пока недоступна. Идентификатор сохранён; проверьте его снова. Подготовка повторно не отправляется.')); return;
    }
    setAction(value); setPrepareAck('');
    if (!value.ownerHeld && !['prepared', 'unknown'].includes(value.state)) remember(null);
  }
  function actionState(state: string) {
    return ({ reviewed: choose('Reviewed', 'Просмотрено'), prepared: choose('Preparation accepted', 'Подготовка принята'), ready: choose('Ready', 'Готово'), failed: choose('Failed', 'Ошибка'), unknown: choose('Inspection required', 'Нужна проверка') } as Record<string, string>)[state] ?? state;
  }
  async function revoke(bindingId: string) {
    if (!scope || revokeInFlight.current) return;
    revokeInFlight.current = true; setRevoking(bindingId);
    const captured = context.current, target = { ...scope };
    try {
      // Privacy revocation uses its dedicated IPC route even while a script approval is awaiting its owner.
      await api.request({ action: 'revokePythonEnvironment', scope: target, bindingId, explicitUserAction: true });
      if (alive.current && context.current === captured) setBindingAck('');
    } catch (cause) {
      if (alive.current && context.current === captured) setNotice(cause instanceof Error ? cause.message : choose('Revocation outcome is unavailable. Refresh the exact task state.', 'Исход отзыва недоступен. Обновите состояние этой задачи.'));
    } finally {
      await onChanged().catch(() => {});
      revokeInFlight.current = false;
      if (alive.current) setRevoking(null);
    }
  }
  return <Panel title={choose('Managed Python environments', 'Управляемые Python-окружения')}>
    <p>{choose('Select the complete set of compatible pure-Python wheel files. Review locks the exact runtime, package versions, artifact hashes and installed file tree. Prepare publishes that environment locally. A later task attachment and approval of each script call remain separate.', 'Выберите полный набор совместимых pure-Python wheel-файлов. Просмотр фиксирует runtime, версии пакетов, хеши архивов и состав файлов окружения. Подготовка сохраняет это окружение локально. Прикрепление к задаче и подтверждение каждого запуска скрипта выполняются отдельно.')}</p>
    <Notice>{choose('Preparation never downloads, resolves, imports package code or runs pip/build hooks. This route does not support native wheels, startup hooks, installation scripts or unsupported dependency markers/extras. Network access remains off. Other Python distributions and broader dependency formats remain separate planned capabilities.', 'Подготовка не скачивает пакеты, не подбирает версии, не импортирует код пакетов и не запускает pip или сборочные скрипты. Здесь пока не поддерживаются native wheels, startup hooks, установочные скрипты и неподдерживаемые markers/extras зависимостей. Доступ к сети остаётся выключенным. Другие Python distributions и более широкие форматы зависимостей остаются отдельными пунктами плана.')}</Notice>
    {!data?.supported && <Notice tone="warning">{data?.reason || choose('The admitted Python runtime is unavailable. Retained records can still be inspected.', 'Допущенный Python runtime недоступен. Сохранённые записи можно просмотреть.')}</Notice>}
    {notice && <Notice tone="warning">{notice}</Notice>}
    {held && <Notice tone="warning">{choose('A preparation has an unresolved outcome. Inspect its exact receipt before preparing or attaching another environment. This never reinstalls it.', 'Исход одной из подготовок не подтверждён. Проверьте её точную квитанцию перед подготовкой или прикреплением другого окружения. Повторная установка не выполняется.')}</Notice>}
    <div className="agent-tools-state">
      <Button disabled={disabled || !api.pickPythonWheels || !data?.supported || held || pending?.phase === 'prepare'} onClick={() => void perform(async () => {
        const picked = await api.pickPythonWheels!();
        if (alive.current && !picked.cancelled && picked.wheelPaths?.length) { setWheelPaths(picked.wheelPaths); setAction(null); setPrepareAck(''); remember(null); }
      }, false)}>{choose('Select wheel files', 'Выбрать wheel-файлы')}</Button>
      <Button disabled={disabled || !data?.supported || !wheelPaths.length || held || Boolean(pending)} onClick={() => void perform(async () => {
        const id = crypto.randomUUID(); remember({ id, phase: 'review' }); setPrepareAck(''); setAction(null);
        const value = await api.request({ action: 'reviewPythonEnvironment', actionId: id, wheelPaths: [...wheelPaths], explicitUserAction: true }) as SkillPythonEnvironmentAction;
        observe(value, id);
      })}>{choose('Review selected dependency set', 'Просмотреть выбранные зависимости')}</Button>
    </div>
    {wheelPaths.length > 0 && <ul className="agent-tools-records">{wheelPaths.map(path => <li key={path}><code>{path}</code></li>)}</ul>}
    {pending && <div className="agent-tools-state"><code>{pending.id}</code><Button disabled={disabled} onClick={() => void perform(async () => observe(await api.request({ action: 'pythonEnvironmentAction', actionId: pending.id }) as SkillPythonEnvironmentAction | null, pending.id))}>{choose('Read this exact receipt', 'Прочитать точную квитанцию')}</Button>
      {pending.phase === 'review' && <Button disabled={disabled} onClick={() => { remember(null); setAction(null); setPrepareAck(''); }}>{choose('Leave this preview wait', 'Закрыть ожидание просмотра')}</Button>}
    </div>}
    {action && <div className="agent-tools-records"><div>
      <Badge tone={action.state === 'ready' ? 'neutral' : action.ownerHeld ? 'warning' : 'neutral'}>{actionState(action.state)}</Badge>
      <code>{action.actionId}</code>{action.reason && <p>{action.reason}</p>}
      {action.environment && <><p>{choose('Environment', 'Окружение')}: <code>{action.environment.environmentId}</code></p>
        <p>{choose('Runtime closure', 'Состав runtime')}: <code>{action.environment.runtimeClosureDigest}</code></p>
        <p>{choose('Resolved lock', 'Зафиксированные зависимости')}: <code>{action.environment.lockDigest}</code> · {action.environment.fileCount} {choose('files', 'файлов')} · {action.environment.bytes} {choose('bytes', 'байт')}</p>
        <ul>{action.environment.packages.map(pkg => <li key={pkg.name}><strong>{pkg.name} {pkg.version}</strong> · SHA-256 <code>{pkg.artifactSha256}</code></li>)}</ul></>}
      {action.state === 'reviewed' && <><Checkbox disabled={disabled || held || Boolean(pending)} checked={prepareAck === reviewKey} onChange={checked => setPrepareAck(checked ? reviewKey : '')} label={choose('I reviewed this complete package set and exact hashes. Prepare only this local environment; do not run code or grant task access.', 'Я проверил полный набор пакетов и точные хеши. Подготовить только это локальное окружение; код не запускать и доступ задаче не выдавать.')} />
        <Button disabled={disabled || held || Boolean(pending) || prepareAck !== reviewKey || !action.environment} onClick={() => void perform(async () => {
          const id = action.actionId, digest = action.reviewDigest; remember({ id, phase: 'prepare' }); setPrepareAck('');
          observe(await api.request({ action: 'preparePythonEnvironment', actionId: id, reviewDigest: digest, explicitUserAction: true }) as SkillPythonEnvironmentAction, id);
        })}>{choose('Prepare reviewed environment', 'Подготовить просмотренное окружение')}</Button></>}
      {action.ownerHeld && <Button disabled={disabled} onClick={() => void perform(async () => observe(await api.request({ action: 'reconcilePythonEnvironment', actionId: action.actionId, explicitUserAction: true }) as SkillPythonEnvironmentAction, action.actionId))}>{choose('Inspect existing publication without reinstalling', 'Проверить сохранённый результат без переустановки')}</Button>}
    </div></div>}
    <Select label={choose('Prepared environment for task attachment', 'Подготовленное окружение для прикрепления к задаче')} value={environmentId} disabled={disabled} options={[{ value: '', label: '—' }, ...environments.map(row => ({ value: row.environmentId, label: `${row.packages.map(pkg => `${pkg.name} ${pkg.version}`).join(', ')} · ${row.environmentId.slice(0, 12)} · ${row.state === 'ready' ? choose('ready', 'готово') : choose('unavailable', 'недоступно')}` }))]} onChange={value => { setEnvironmentId(value); setBindingAck(''); }} />
    {selected?.reason && <Notice tone="warning">{selected.reason}</Notice>}
    <Checkbox disabled={disabled || !executionAvailable || !scope || selected?.state !== 'ready' || held || bindings.length > 0} checked={bindingAck === bindingKey} onChange={checked => setBindingAck(checked ? bindingKey : '')} label={choose('Attach this exact environment only to the selected task generation. Workspace access and approval of every script call remain separate.', 'Прикрепить это точное окружение только выбранному поколению задачи. Доступ к рабочему каталогу и подтверждение каждого вызова скрипта остаются отдельными.')} />
    <Button disabled={disabled || !executionAvailable || !scope || selected?.state !== 'ready' || held || bindings.length > 0 || bindingAck !== bindingKey} onClick={() => void perform(async () => {
      if (!scope || !selected || bindingAck !== bindingKey) return;
      const captured = context.current, target = { ...scope };
      await api.request({ action: 'bindPythonEnvironment', scope: target, environmentId: selected.environmentId, explicitUserAction: true });
      if (alive.current && context.current === captured) setBindingAck('');
    })}>{choose('Attach environment to this task generation', 'Прикрепить окружение к этому поколению задачи')}</Button>
    {bindings.map(binding => <div className="agent-tools-records" key={binding.id}><div><strong>{choose('Attached environment', 'Прикреплённое окружение')}</strong><code>{binding.environmentId}</code><small>{binding.taskId} · gen {binding.generation}</small>
      <Button disabled={revoking !== null || !scope} busy={revoking === binding.id} onClick={() => void revoke(binding.id)}>{choose('Revoke environment attachment', 'Отозвать прикрепление окружения')}</Button></div></div>)}
    {(data?.actions.length ?? 0) > 0 && <details><summary>{choose('Retained environment actions', 'Сохранённые действия окружений')}</summary><ul className="agent-tools-records">{data!.actions.map(row => <li key={row.actionId}><code>{row.actionId}</code><span>{actionState(row.state)}</span><Button size="sm" disabled={disabled} onClick={() => { setAction(row); setPrepareAck(''); remember(row.ownerHeld ? { id: row.actionId, phase: 'prepare' } : null); }}>{choose('View saved review', 'Открыть сохранённый просмотр')}</Button></li>)}</ul></details>}
  </Panel>;
}
