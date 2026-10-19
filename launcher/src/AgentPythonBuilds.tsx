import { useEffect, useId, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Checkbox, Notice, Panel } from './design';
import type { AgentToolsApi, AgentPythonBuildConfig, AgentPythonBuildSelection, AgentPythonBuildStatus, ToolScope } from './agent-tools-types';
import type { PythonBuildAction, PythonBuildReview } from '../../src/execution-environments/python-build';

/** Source selection stays in main. Only opaque selections and reviewed identities cross this surface. */
export function AgentPythonBuilds({ api, scope, locked, choose, act, onChanged }: {
  api: AgentToolsApi; scope?: ToolScope; locked: boolean; choose: (en: string, ru: string) => string;
  act: (work: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void>;
}) {
  const configId = useId();
  const [configText, setConfigText] = useState(JSON.stringify({ name: '', version: '', backend: '', buildRequires: [] }, null, 2));
  const [status, setStatus] = useState<AgentPythonBuildStatus | null>(null);
  const [selection, setSelection] = useState<AgentPythonBuildSelection | null>(null);
  const [action, setAction] = useState<PythonBuildAction | null>(null);
  const [prepareAck, setPrepareAck] = useState(''), [attachAck, setAttachAck] = useState('');
  const [reading, setReading] = useState(false), [control, setControl] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const alive = useRef(true), readingRef = useRef(false), controlRef = useRef(false), offered = useRef(false);
  const context = useRef(''); context.current = JSON.stringify([scope?.taskId, scope?.generation]);
  const selectedActionId = useRef<string | null>(null);
  const transport = useRef(api); transport.current = api;
  const scopeRef = useRef(scope); scopeRef.current = scope;
  const held = offered.current || status?.actions.some(row => row.ownerHeld || row.state === 'preparing' || row.state === 'unknown') === true;
  const bindings = status?.bindings.filter(row => row.taskId === scope?.taskId && row.generation === scope?.generation) ?? [];
  const prepareKey = action ? JSON.stringify([context.current, action.review.actionId, action.review.reviewDigest]) : '';
  const attachKey = action?.environment ? JSON.stringify([context.current, action.review.actionId, action.environment.closureDigest]) : '';
  function metadata(): AgentPythonBuildConfig {
    const value: unknown = JSON.parse(configText);
    const keys = ['name', 'version', 'backend', 'backendPath', 'buildRequires', 'additionalBuildRequires', 'configSettings', 'timeoutMs'];
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new Error(choose('Use only the documented build metadata fields.', 'Используйте только указанные поля метаданных сборки.'));
    const row = value as Record<string, unknown>;
    if (typeof row.name !== 'string' || !row.name.trim() || typeof row.version !== 'string' || !row.version.trim() || typeof row.backend !== 'string' || !row.backend.trim()
      || !Array.isArray(row.buildRequires) || row.buildRequires.some(entry => typeof entry !== 'string')) throw new Error(choose('Provide name, version, backend and a buildRequires string array.', 'Укажите name, version, backend и массив строк buildRequires.'));
    return value as AgentPythonBuildConfig;
  }
  async function read() {
    if (readingRef.current) return;
    const captured = context.current, target = scopeRef.current ? { ...scopeRef.current } : undefined;
    readingRef.current = true; setReading(true);
    try {
      const value = await transport.current.request({ action: 'pythonBuildStatus', ...(target ? { scope: target } : {}) }) as AgentPythonBuildStatus;
      if (!alive.current || captured !== context.current) return;
      setStatus(value);
      const current = value.actions.find(row => row.review.actionId === selectedActionId.current);
      if (current) setAction(current);
      if (current && !current.ownerHeld && !['preparing', 'unknown'].includes(current.state)) offered.current = false;
    } catch (cause) { if (alive.current && captured === context.current) setNotice(cause instanceof Error ? cause.message : 'python_build_status_unavailable'); }
    finally { readingRef.current = false; if (alive.current) { setReading(false); if (captured !== context.current) void read(); } }
  }
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => {
    // A new selection never inherits another task's preview or attachment authority.
    setPrepareAck(''); setAttachAck(''); setSelection(null); setAction(null); setStatus(null);
    selectedActionId.current = null; offered.current = false; void read();
  }, [scope?.taskId, scope?.generation]);
  async function perform(work: (captured: string) => Promise<void>) {
    if (locked || controlRef.current) return;
    const captured = context.current;
    await act(async () => { try { await work(captured); } finally { await read(); await onChanged().catch(() => {}); } });
  }
  async function controlAction(kind: 'cancelPythonBuild' | 'reconcilePythonBuild' | 'revokePythonBuild', actionId?: string) {
    if (controlRef.current || kind === 'revokePythonBuild' && !scope) return;
    controlRef.current = true; setControl(kind); setNotice('');
    const captured = context.current, target = scope ? { ...scope } : undefined;
    try {
      await transport.current.request({ action: kind, ...(actionId ? { actionId } : {}), ...(kind === 'revokePythonBuild' ? { scope: target } : {}), explicitUserAction: true });
    } catch (cause) { if (alive.current && captured === context.current) setNotice(cause instanceof Error ? cause.message : 'python_build_outcome_unavailable'); }
    finally { await read(); await onChanged().catch(() => {}); controlRef.current = false; if (alive.current) setControl(null); }
  }
  return <Panel className="agent-script-form" title={choose('Build native Python packages in Linux VM', 'Собрать native Python-пакеты в Linux VM')}>
    <p>{choose('Select source and the complete build dependency set. Review fixes the exact source bytes, backend, package hashes and admitted Linux runtime. Prepare runs the reviewed build inside the offline VM. Attaching its result to a task is separate.', 'Выберите исходники и полный набор сборочных зависимостей. Просмотр фиксирует байты исходников, backend, хеши пакетов и допущенный Linux runtime. Подготовка выполняет просмотренную сборку внутри VM без сети. Результат прикрепляется к задаче отдельно.')}</p>
    <Notice>{choose('This produces a Linux CPython 3.14 ARM64 environment. It does not install into the host Python. Reviews and selections are process-local; after a restart, retained VM receipts must be inspected before any new action.', 'Создаётся окружение Linux CPython 3.14 ARM64. В Python хоста ничего не устанавливается. Просмотры и выбор исходников действуют в текущем процессе; после перезапуска сначала проверьте сохранённые квитанции VM.')}</Notice>
    {notice ? <Notice tone="warning">{notice}</Notice> : null}
    {status && !status.supported ? <Notice tone="warning">{status.reason || choose('The reviewed VM build runtime is unavailable.', 'Просмотренный runtime сборки VM недоступен.')}</Notice> : null}
    <div className="agent-script-form__step"><h3>{choose('Source and dependencies', 'Исходники и зависимости')}</h3>
    <div className="nk-field"><label htmlFor={configId}>{choose('Build metadata (JSON)', 'Метаданные сборки (JSON)')}</label>
      <textarea id={configId} aria-describedby={`${configId}-hint`} className="nk-input" rows={8} maxLength={65536} value={configText} disabled={locked || held}
        onChange={event => { setConfigText(event.target.value); setSelection(null); setAction(null); selectedActionId.current = null; setPrepareAck(''); setAttachAck(''); }} />
      <p id={`${configId}-hint`} className="nk-field__hint">{choose('Required: name, version, backend, buildRequires. Optional: backendPath, additionalBuildRequires, configSettings, timeoutMs. These must match the selected source pyproject.toml and the complete selected wheel set.', 'Обязательны name, version, backend, buildRequires. Дополнительно: backendPath, additionalBuildRequires, configSettings, timeoutMs. Данные должны соответствовать pyproject.toml выбранных исходников и полному выбранному набору wheel.')}</p></div>
    <div className="agent-tools-state"><Button disabled={reading} busy={reading} onClick={() => void read()}>{choose('Inspect build state', 'Проверить состояние сборки')}</Button>
      <Button disabled={locked || held || !scope || !status?.supported || status.selectionAvailable === false || !api.pickPythonBuild} onClick={() => void perform(async captured => {
        if (!scope) return;
        const picked = await transport.current.pickPythonBuild!({ ...scope }, metadata());
        if (alive.current && context.current === captured && !picked.cancelled && picked.selection) { setSelection(picked.selection); setAction(null); selectedActionId.current = null; setPrepareAck(''); setAttachAck(''); }
      })}>{choose('Select source and build dependencies', 'Выбрать исходники и сборочные зависимости')}</Button></div>
    {selection ? <p><strong>{selection.name} {selection.version}</strong> · {selection.sourceKind} · {selection.sourceFileCount} {choose('source files', 'исходных файлов')} · {selection.buildWheelCount} build wheels · {selection.runtimeWheelCount} runtime wheels<br /><code>{selection.snapshotDigest}</code> · {selection.bytes} {choose('bytes', 'байт')} · {selection.excludedEntries} {choose('excluded entries', 'исключённых записей')}</p> : null}
    <Button disabled={locked || held || !scope || !selection || !status?.supported || status.selectionAvailable === false} onClick={() => void perform(async captured => {
      if (!scope || !selection) return;
      const id = crypto.randomUUID(), target = { ...scope }; selectedActionId.current = id; setAction(null); setPrepareAck(''); setAttachAck('');
      const review = await transport.current.request({ action: 'reviewPythonBuild', actionId: id, selectionId: selection.selectionId, scope: target, explicitUserAction: true }) as PythonBuildReview;
      if (alive.current && captured === context.current && review.actionId === id) setAction({ review, state: 'reviewed', ownerHeld: false });
    })}>{choose('Review this exact build', 'Просмотреть эту точную сборку')}</Button></div>
    {action ? <div className="agent-tools-review agent-script-form__step"><h3>{choose('Reviewed build', 'Просмотренная сборка')}</h3><BadgeRow><Badge tone={action.ownerHeld || action.state === 'unknown' ? 'warning' : 'neutral'}>{action.state}</Badge><code>{action.review.actionId}</code></BadgeRow>
      {action.reason ? <Notice>{action.reason}</Notice> : null}
      <details><summary>{choose('Exact build review and package hashes', 'Точный просмотр сборки и хеши пакетов')}</summary><pre>{JSON.stringify(action.review, null, 2)}</pre></details>
      {action.state === 'reviewed' ? <div className="agent-script-form__approval"><Checkbox disabled={locked || held || !scope} checked={prepareAck === prepareKey} onChange={checked => setPrepareAck(checked ? prepareKey : '')} label={choose('Run this exact reviewed source build in the offline VM for this task generation. Build hooks execute inside that VM.', 'Выполнить эту точную просмотренную сборку исходников в VM без сети для этого поколения задачи. Сборочные hooks исполняются внутри VM.')} />
        <Button disabled={locked || held || !scope || prepareAck !== prepareKey} onClick={() => void perform(async captured => {
          if (!scope || prepareAck !== prepareKey || offered.current) return;
          const id = action.review.actionId, target = { ...scope }; offered.current = true; setPrepareAck('');
          const value = await transport.current.request({ action: 'preparePythonBuild', actionId: id, reviewDigest: action.review.reviewDigest, scope: target, explicitUserAction: true }) as PythonBuildAction;
          if (alive.current && captured === context.current && value.review.actionId === id) { setAction(value); if (!value.ownerHeld && !['preparing', 'unknown'].includes(value.state)) offered.current = false; }
        })}>{choose('Prepare reviewed native package', 'Подготовить просмотренный native-пакет')}</Button></div> : null}
      {action.ownerHeld || action.state === 'preparing' || action.state === 'unknown' || offered.current ? <div className="agent-tools-state">
        <Button disabled={control !== null} onClick={() => void controlAction('cancelPythonBuild', action.review.actionId)}>{choose('Cancel this exact build', 'Отменить эту точную сборку')}</Button>
        <Button disabled={control !== null} onClick={() => void controlAction('reconcilePythonBuild', action.review.actionId)}>{choose('Inspect exact build outcome without replay', 'Проверить точный исход сборки без повтора')}</Button></div> : null}
      {action.environment ? <div className="agent-script-form__step"><h3>{choose('Built environment and task attachment', 'Собранное окружение и прикрепление к задаче')}</h3><p>{choose('Environment closure', 'Состав окружения')}: <code>{action.environment.closureDigest}</code></p>
        <ul>{action.environment.packages.map(pkg => <li key={pkg.name}>{pkg.name} {pkg.version} · <code>{pkg.artifactSha256}</code></li>)}</ul>
        <div className="agent-script-form__approval"><Checkbox disabled={locked || held || !scope || action.state !== 'ready' || bindings.length > 0} checked={attachAck === attachKey} onChange={checked => setAttachAck(checked ? attachKey : '')} label={choose('Attach this exact Linux environment to this task generation. Each VM command still needs separate approval.', 'Прикрепить это точное Linux-окружение к этому поколению задачи. Каждая команда VM по-прежнему требует отдельного подтверждения.')} />
        <Button disabled={locked || held || !scope || action.state !== 'ready' || bindings.length > 0 || attachAck !== attachKey} onClick={() => void perform(async () => {
          if (!scope || attachAck !== attachKey) return;
          await transport.current.request({ action: 'attachPythonBuild', actionId: action.review.actionId, scope: { ...scope }, explicitUserAction: true }); setAttachAck('');
        })}>{choose('Attach built environment', 'Прикрепить собранное окружение')}</Button></div></div> : null}
    </div> : null}
    {bindings.map(binding => <div className="agent-tools-records agent-script-form__record" key={binding.actionId}><strong>{choose('Attached built environment', 'Прикреплённое собранное окружение')}</strong><code>{binding.closureDigest}</code><small>{binding.taskId} · gen {binding.generation}</small><p>{choose('VM scripts must explicitly add python-environment to sys.path under Python -I -S. Attachment does not change Python startup behavior.', 'Скрипты VM должны явно добавлять python-environment в sys.path при Python -I -S. Прикрепление не меняет запуск Python.')}</p><Button disabled={control !== null} onClick={() => void controlAction('revokePythonBuild')}>{choose('Revoke built environment attachment', 'Отозвать прикрепление собранного окружения')}</Button></div>)}
    {status?.actions.length ? <details><summary>{choose('Build actions in this process', 'Сборки в текущем процессе')}</summary><ul className="agent-tools-records">{status.actions.map(row => <li key={row.review.actionId}><code>{row.review.name} {row.review.version} · {row.review.actionId}</code><span>{row.state}</span><Button disabled={locked} onClick={() => { selectedActionId.current = row.review.actionId; setAction(row); setPrepareAck(''); setAttachAck(''); }}>{choose('Inspect saved build', 'Открыть сохранённую сборку')}</Button></li>)}</ul></details> : null}
  </Panel>;
}
