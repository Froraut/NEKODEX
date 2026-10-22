import { useEffect, useId, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Checkbox, Notice, Panel, PanelStack, Select } from './design';
import type { AgentToolsApi, AgentToolsStatus, ToolScope } from './agent-tools-types';
import { AgentPythonBuilds } from './AgentPythonBuilds';
import { AgentPythonEnvironments } from './AgentPythonEnvironments';
import './surfaces/agent-script-forms.css';

/** Directory selection is local UI state. Only the explicit grant action creates authority. */
export function AgentSkillScripts({ api, status, scope, locked, choose, act, onChanged }: {
  api: AgentToolsApi; status: AgentToolsStatus | null; scope?: ToolScope; locked: boolean;
  choose: (en: string, ru: string) => string;
  act: (operation: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void>;
}) {
  const accessId = useId();
  const alive = useRef(true), revoking = useRef(new Set<string>());
  const [revokingIds, setRevokingIds] = useState<string[]>([]);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  async function revoke(taskId: string, generation: number, grantId: string) {
    const key = JSON.stringify([taskId, generation, grantId]);
    if (revoking.current.has(key)) return;
    revoking.current.add(key); setRevokingIds(ids => [...ids, key]); setRevokeError(null);
    try {
      // Independent revocation must remain reachable while approveInvoke awaits the
      // script executor. Revocation cancels only runs owned by this exact grant.
      await api.request({ action: 'revokeScriptWorkspace', scope: { taskId, generation, toolCallId: 'script-workspace-revocation' }, grantId, explicitUserAction: true });
      if (alive.current) await onChanged();
    } catch (cause) { if (alive.current) setRevokeError(cause instanceof Error ? cause.message : String(cause)); }
    finally { revoking.current.delete(key); if (alive.current) setRevokingIds(ids => ids.filter(id => id !== key)); }
  }
  const [root, setRoot] = useState('');
  const [access, setAccess] = useState<'read-only' | 'read-write'>('read-only');
  const [acknowledged, setAcknowledged] = useState<string | null>(null);
  const selectionKey = JSON.stringify([scope?.taskId, scope?.generation, root, access]);
  useEffect(() => { setAcknowledged(null); }, [scope?.taskId, scope?.generation, root, access]);
  const scripts = status?.scriptTools;
  const supported = status?.capabilities.skillScripts === true && scripts?.capabilities.supported === true && !scripts.closed;
  const javascriptAvailable = supported && (scripts?.capabilities.runtimes?.javascript.supported ?? true);
  const pythonAvailable = supported && scripts?.capabilities.runtimes?.python.supported === true;
  const grants = scripts?.grants.filter(grant => grant.taskId === scope?.taskId && grant.generation === scope?.generation) ?? [];
  const operations = scripts?.activeOperations.filter(operation => operation.taskId === scope?.taskId && operation.generation === scope?.generation) ?? [];
  return <PanelStack className="agent-script-panels"><Panel className="agent-script-form" title={choose('Restricted skill script workspace', 'Рабочий каталог ограниченных skill-скриптов')}>
    <Notice>{choose('Reviewed JS/MJS and Python scripts require a separate workspace grant for this task generation and approval of each exact saved tool call. Import, attachment and snapshot-write permissions do not grant execution. Python also requires an admitted runtime; source review remains available without one. This panel creates no model call and starts no script.', 'Проверенные JS/MJS и Python требуют отдельного разрешения на рабочий каталог для этого поколения задачи и подтверждения каждого точного сохранённого вызова. Импорт, прикрепление и разрешение записи снимков не дают исполнения. Python также требует допущенного runtime; просмотр исходного кода доступен и без него. Эта панель не создаёт вызовы модели и не запускает скрипты.')}</Notice>
    <BadgeRow><Badge tone={supported ? 'neutral' : 'warning'}>{supported ? choose('Restricted runner available', 'Ограниченный runner доступен') : choose('Restricted runner unavailable', 'Ограниченный runner недоступен')}</Badge>{scope ? <span>{scope.taskId} · gen {scope.generation}</span> : <span>{choose('Choose an owned task first.', 'Сначала выберите свою задачу.')}</span>}</BadgeRow>
    <BadgeRow><Badge tone={javascriptAvailable ? 'neutral' : 'warning'}>{choose('JavaScript runtime', 'JavaScript runtime')}: {javascriptAvailable ? choose('available', 'доступен') : choose('unavailable', 'недоступен')}</Badge><Badge tone={pythonAvailable ? 'neutral' : 'warning'}>{choose('Python runtime', 'Python runtime')}: {pythonAvailable ? choose('admitted', 'допущен') : choose('unavailable', 'недоступен')}</Badge></BadgeRow>
    {!pythonAvailable ? <p className="agent-tools-muted">{scripts?.capabilities.runtimes?.python.reason || choose('An admitted Python runtime is not available. Imported Python source cannot execute until runtime admission succeeds.', 'Допущенный Python runtime недоступен. Импортированный Python-код не может исполняться до успешного допуска runtime.')}</p> : null}
    <p>{choose('Only reviewed scripts can use the selected workspace and an admitted runtime in a private environment. Network and package installation during Run are unavailable. Prepared Python dependencies require a separate environment attachment below. Filesystem access includes global metadata and system-library reads in addition to the selected workspace; it is not complete filesystem concealment. Runtime-specific restrictions are enforced by the owner. Writes have no automatic rollback.', 'Только проверенные скрипты могут использовать выбранный рабочий каталог и допущенный runtime в частном окружении. Сеть и установка пакетов во время Run недоступны. Подготовленные Python-зависимости требуют отдельного прикрепления окружения ниже. Помимо выбранного каталога допускается чтение глобальных метаданных и системных библиотек; это не полное скрытие файловой системы. Особые ограничения runtime проверяет владелец. Запись не имеет автоматического отката.')}</p>
    <div className="agent-script-form__step"><h3>{choose('Workspace access', 'Доступ к рабочему каталогу')}</h3>
    <div className="agent-tools-state"><Button disabled={locked || !scope || !api.pickScriptWorkspace} onClick={() => void act(async () => {
      const selected = await api.pickScriptWorkspace!();
      if (!selected.cancelled && selected.root) { setRoot(selected.root); setAcknowledged(null); }
    })}>{choose('Select workspace directory', 'Выбрать рабочий каталог')}</Button></div>
    {root ? <dl><dt>{choose('Selected directory for the next explicit grant', 'Выбранный каталог для следующего явного разрешения')}</dt><dd><code>{root}</code></dd></dl> : <p className="agent-tools-muted">{choose('The directory picker selects a path only. Existing grants are listed below.', 'Выбор каталога задаёт только путь. Уже выданные разрешения показаны ниже.')}</p>}
    <div className="nk-field"><label htmlFor={accessId}>{choose('Workspace access', 'Доступ к рабочему каталогу')}</label>
    <Select id={accessId} label={choose('Workspace access', 'Доступ к рабочему каталогу')} value={access} disabled={locked} options={[
      { value: 'read-only', label: choose('Read only', 'Только чтение') },
      { value: 'read-write', label: choose('Read and write; no automatic rollback', 'Чтение и запись; без автоматического отката') },
    ]} onChange={value => { setAccess(value === 'read-write' ? 'read-write' : 'read-only'); setAcknowledged(null); }} /></div>
    <div className="agent-script-form__approval"><Checkbox disabled={locked || !scope || !root || !supported} checked={acknowledged === selectionKey} onChange={checked => setAcknowledged(checked ? selectionKey : null)} label={choose('I approve this exact directory and access mode for the selected task generation and acknowledge the runner restrictions and write risks.', 'Я разрешаю этот точный каталог и режим доступа выбранному поколению задачи и принимаю ограничения runner и риски записи.')} />
    <Button disabled={locked || !supported || !scope || !root || acknowledged !== selectionKey} onClick={() => void act(async () => {
      if (!scope || !supported || !root || acknowledged !== selectionKey) return;
      await api.request({ action: 'grantScriptWorkspace', scope, root, access, acknowledgeRestrictions: true, explicitUserAction: true });
      setAcknowledged(null); await onChanged();
    })}>{choose('Grant this exact workspace access', 'Разрешить этот точный доступ к каталогу')}</Button></div></div>
    {revokeError ? <Notice tone="error" role="alert">{revokeError}</Notice> : null}
    {grants.length ? <ul className="agent-tools-records">{grants.map(grant => <li key={grant.id}>
      <strong>{choose('Workspace grant', 'Разрешение на рабочий каталог')}</strong><code>{grant.id}</code><span>{grant.root}</span>
      <small>{grant.access} · {grant.taskId} · gen {grant.generation}</small>
      <p className="agent-tools-muted">{choose('Use this exact grant ID for a separately approved script call. Workspace paths are not shared with the model automatically.', 'Используйте этот точный ID разрешения в отдельно подтверждаемом вызове скрипта. Пути рабочих каталогов автоматически не передаются модели.')}</p>
      <Button size="sm" disabled={revokingIds.includes(JSON.stringify([grant.taskId, grant.generation, grant.id]))} onClick={() => void revoke(grant.taskId, grant.generation, grant.id)}>{choose('Stop scripts and revoke this workspace grant', 'Остановить скрипты и отозвать это разрешение на каталог')}</Button>
    </li>)}</ul> : <p className="agent-tools-muted">{choose('No workspace grants for this task generation.', 'Для этого поколения задачи нет разрешений на рабочий каталог.')}</p>}
    {operations.length ? <div className="agent-script-form__step"><h3>{choose('Owned active script operations', 'Свои активные операции скриптов')}</h3><ul className="agent-tools-records">{operations.map(operation => <li key={operation.operationId}><code>{operation.operationId}</code><small>{choose('Workspace grant', 'Разрешение на каталог')}: {operation.workspaceGrantId}</small><Button size="sm" disabled={revokingIds.includes(JSON.stringify([operation.taskId, operation.generation, operation.workspaceGrantId]))} onClick={() => void revoke(operation.taskId, operation.generation, operation.workspaceGrantId)}>{choose('Stop and revoke exact workspace', 'Остановить и отозвать точный каталог')}</Button></li>)}</ul></div> : null}
  </Panel><AgentPythonEnvironments api={api} status={status} scope={scope} locked={locked} choose={choose} act={act} onChanged={onChanged} />{api.pickPythonBuild ? <AgentPythonBuilds api={api} scope={scope} locked={locked} choose={choose} act={act} onChanged={onChanged} /> : null}</PanelStack>;
}
