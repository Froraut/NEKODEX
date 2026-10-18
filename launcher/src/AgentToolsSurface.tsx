import { useEffect, useId, useRef, useState } from 'react';
import { Badge, Button, Checkbox, EmptyState, Notice, Page, Panel, Select, SurfaceHeader, TextField } from './design';
import type { Language } from './types';
import type { AgentToolsApi, AgentToolsStatus, ServerRecipe, SkillIdentity, ToolOutcome, ToolScope, RemoteAgentTaskScope, RemoteAgentStatus } from './agent-tools-types';
import { stripIpcErrorPrefix } from './ipc-error';
import './surfaces/agent-tools.css';
import { AgentToolsInstaller } from './AgentToolsInstaller';
import { AgentManagedSkills } from './AgentManagedSkills';
import { AgentSkillScripts } from './AgentSkillScripts';
import { AgentBrowserTools } from './AgentBrowserTools';
import { AgentDesktopTools } from './AgentDesktopTools';
import { AgentRemoteTools } from './AgentRemoteTools';
import { AgentToolOutcomeView } from './AgentToolOutcomeView';

/** The current owner supplies actionable calls separately from bounded image/history rows.
 * An explicitly empty projection must never resurrect old dispatch calls. */
export function agentPendingCalls(detail: Awaited<ReturnType<AgentToolsApi['getTask']>>) {
  if (detail.pendingToolCalls !== undefined) return detail.pendingToolCalls;
  return detail.dispatches.filter(dispatch => dispatch.generation === detail.task.generation)
    .flatMap(dispatch => dispatch.result?.continuation?.pending ?? [])
    .filter(call => !detail.toolOutcomes?.some(outcome => outcome.scope.generation === detail.task.generation && outcome.scope.toolCallId === call.toolCallId));
}

function Area({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  const id = useId(); return <div className="nk-field"><label htmlFor={id}>{label}</label><textarea id={id} className="nk-input" rows={3} value={value} onChange={event => onChange(event.target.value)} maxLength={32768} aria-describedby={hint ? `${id}-hint` : undefined} />{hint ? <p className="nk-field__hint" id={`${id}-hint`}>{hint}</p> : null}</div>;
}
/** All mutations cross guarded IPC. The surface cannot grant itself OS/file permissions. */
export function AgentToolsSurface({ api, language, disabled = false }: { api: AgentToolsApi; language: Language; disabled?: boolean }) {
  const ru = language === 'ru'; const choose = (en: string, russian: string) => ru ? russian : en;
  const transport = useRef(api); transport.current = api;
  const mounted = useRef(true); const busy = useRef(false);
  const [status, setStatus] = useState<AgentToolsStatus | null>(null);
  const [remoteStatus, setRemoteStatus] = useState<RemoteAgentStatus | null>(null);
  const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<{ id: string; generation: number; status: string }[]>([]);
  const [taskId, setTaskId] = useState(''); const selectedTask = tasks.find(task => task.id === taskId);
  const selectedTaskId = useRef(''); const taskLoadRevision = useRef(0);
  const [taskDetailScope, setTaskDetailScope] = useState<RemoteAgentTaskScope | undefined>();
  const remoteScope = taskDetailScope?.taskId === selectedTask?.id && taskDetailScope?.generation === selectedTask?.generation ? taskDetailScope : undefined;
  const [calls, setCalls] = useState<{ toolCallId: string; tool: string; arguments: Record<string, unknown> }[]>([]);
  const [pendingCallsTruncated, setPendingCallsTruncated] = useState(false);
  const [callId, setCallId] = useState(''); const selectedCall = calls.find(call => call.toolCallId === callId);
  const [result, setResult] = useState<ToolOutcome | null>(null);
  const [receiptKey, setReceiptKey] = useState(''); const [requirementId, setRequirementId] = useState('r1');
  const [evidenceReference, setEvidenceReference] = useState<{ sourceEventId: string; requirementId: string; subject: string; subjectRevision: string; property: string } | null>(null);
  const [id, setId] = useState(''); const [label, setLabel] = useState(''); const [version, setVersion] = useState('');
  const [command, setCommand] = useState(''); const [cwd, setCwd] = useState(''); const [args, setArgs] = useState('[]'); const [pins, setPins] = useState('');
  const [sandboxRequested, setSandboxRequested] = useState(false);
  const [review, setReview] = useState<{ reviewId: string; recipe: ServerRecipe; trust: string } | null>(null); const [trusted, setTrusted] = useState(false);
  const [skills, setSkills] = useState<SkillIdentity[]>([]); const [preview, setPreview] = useState('');
  const locked = disabled || pending;
  const browserEnabledForTask = !!selectedTask && status?.browserTools?.available === true && !!status.browserTools.selected && status.browserTools.bindings.some(row => row.taskId === selectedTask.id && row.generation === selectedTask.generation && Object.keys(row.binding).filter(key => key !== 'observationId').every(key => row.binding[key as keyof typeof row.binding] === status.browserTools!.selected![key as keyof typeof row.binding]));
  const desktopEnabledForTask = !!selectedTask && status?.desktopTools?.enabled === true && !!status.desktopTools.selected && status.desktopTools.bindings.some(row => row.taskId === selectedTask.id && row.generation === selectedTask.generation && row.selection.windowId === status.desktopTools!.selected!.windowId && row.selection.processId === status.desktopTools!.selected!.processId && row.selection.windowEpoch === status.desktopTools!.selected!.windowEpoch);
  const remoteEnabledForTask = !!remoteScope && !!remoteStatus?.bindings.some(row => row.taskId === remoteScope.taskId && row.familyId === remoteScope.familyId && row.generation === remoteScope.generation);
  const resourceEnabledForTask = status?.capabilities.skillResourceReads === true && !!selectedTask && !!status.managedSkills?.attachments.some(attachment => attachment.scope.taskId === selectedTask.id && attachment.scope.generation === selectedTask.generation
    && attachment.versionIds.some(versionId => status.managedSkills?.versions.some(version => version.versionId === versionId && !version.revoked && !version.forgotten && (version.resourceCount ?? 0) > 0)));
  const scriptsEnabledForTask = status?.capabilities.skillScripts === true && !!selectedTask && status?.scriptTools?.grants.some(grant => grant.taskId === selectedTask.id && grant.generation === selectedTask.generation);
  const discoveryEnabled = status?.config.enabled || browserEnabledForTask || desktopEnabledForTask || remoteEnabledForTask || resourceEnabledForTask || scriptsEnabledForTask;
  const callPrefix = selectedCall?.tool.split('/')[0];
  const configuredCallServer = status?.config.servers.find(server => server.id === callPrefix);
  // Existing user MCP namespaces win over built-ins, including remote/ and skill-resource/.
  const selectedCallEnabled = !!selectedCall && (configuredCallServer ? status?.config.enabled && configuredCallServer.enabled
    : callPrefix === 'browser' ? browserEnabledForTask : callPrefix === 'desktop' ? desktopEnabledForTask
      : callPrefix === 'remote' ? remoteEnabledForTask : callPrefix === 'skill-resource' ? resourceEnabledForTask : callPrefix === 'skill-script' ? scriptsEnabledForTask : status?.config.enabled);
  const isInspectionOnlyReceipt = (tool: string) => ['browser/', 'desktop/', 'remote/', 'skill-resource/', 'skill-script/'].some(prefix => tool.startsWith(prefix))
    && !status?.config.servers.some(server => tool.startsWith(`${server.id}/`));
  const scope = (toolCallId = `discovery:${taskId}`): ToolScope => { if (!selectedTask) throw new Error(choose('Select an owned Agent task.', 'Выберите существующую Agent-задачу.')); return { taskId: selectedTask.id, generation: selectedTask.generation, toolCallId }; };
  const refreshRemote = async () => {
    try {
      const next = await transport.current.request({ action: 'remoteStatus' }) as RemoteAgentStatus;
      if (mounted.current) setRemoteStatus(next);
    } catch (cause) { if (mounted.current) setRemoteStatus(null); throw cause; }
  };
  const clearPendingCalls = () => { setTaskDetailScope(undefined); setCallId(''); setCalls([]); setPendingCallsTruncated(false); };
  const refreshTask = async (value: string, loadRevision: number, minimumGeneration = 0) => {
    const detail = await transport.current.getTask(value);
    if (!mounted.current || selectedTaskId.current !== value || taskLoadRevision.current !== loadRevision
      || detail.task.id !== value || detail.task.generation < minimumGeneration) return;
    setTaskDetailScope({ taskId: detail.task.id, familyId: detail.task.familyId, generation: detail.task.generation, revision: detail.task.revision });
    setCalls(agentPendingCalls(detail)); setPendingCallsTruncated(detail.coverage?.pendingToolCalls?.truncated === true);
    setTasks(previous => previous.map(task => task.id === value ? { ...task, generation: detail.task.generation } : task));
  };
  const refresh = async () => {
    const value = selectedTaskId.current, loadRevision = ++taskLoadRevision.current;
    clearPendingCalls();
    const [nextStatus, listing] = await Promise.all([transport.current.request({ action: 'status' }) as Promise<AgentToolsStatus>, transport.current.listTasks(), refreshRemote().catch(() => undefined)]);
    if (!mounted.current) return;
    setStatus(nextStatus);
    const available = listing.tasks.filter(task => !['stopped', 'verified_complete'].includes(task.status)); setTasks(available);
    if (selectedTaskId.current !== value || taskLoadRevision.current !== loadRevision || !value) return;
    const selected = available.find(task => task.id === value);
    if (!selected) { selectedTaskId.current = ''; setTaskId(''); return; }
    await refreshTask(value, loadRevision, selected.generation);
  };
  const act = async (operation: () => Promise<void>) => {
    if (busy.current || disabled) return; busy.current = true; setPending(true); setError(null);
    try { await operation(); } catch (cause) { if (mounted.current) setError(stripIpcErrorPrefix(cause instanceof Error ? cause.message : String(cause))); }
    finally { busy.current = false; if (mounted.current) setPending(false); }
  };
  useEffect(() => { mounted.current = true; if (!disabled) void act(refresh); return () => { mounted.current = false; taskLoadRevision.current++; }; }, []);
  useEffect(() => { if (!disabled && !status && !busy.current) void act(refresh); }, [disabled]);
  const loadTask = async (value: string) => {
    selectedTaskId.current = value; const loadRevision = ++taskLoadRevision.current;
    clearPendingCalls(); setTaskId(value); setResult(null); setEvidenceReference(null);
    if (!value) return;
    await refreshTask(value, loadRevision, tasks.find(task => task.id === value)?.generation);
  };
  const invalidateReview = (setter: (value: string) => void) => (value: string) => { setter(value); setReview(null); setTrusted(false); };
  return <Page className="agent-tools-surface">
    <SurfaceHeader eyebrow={choose('Standalone Agent mode', 'Самостоятельный Agent mode')} title={choose('Tools and skills', 'Инструменты и skills')} subtitle={choose('Configure explicitly installed MCP servers and selected read-only instructions for owned Agent tasks.', 'Настройте явно установленные MCP-серверы и выберите инструкции только для чтения для Agent-задач.')} actions={<Button variant="secondary" disabled={locked} onClick={() => void act(refresh)}>{choose('Refresh', 'Обновить')}</Button>} />
    {error ? <Notice tone="error" role="alert">{error}</Notice> : null}
    <Notice tone="warning">{choose('Each server displays its execution boundary. Unrestricted servers have your user permissions; tool approval alone does not create OS isolation. The limited official catalog has a separate installer below; native commands, OAuth and automatic key import remain unavailable.', 'У каждого сервера показана граница исполнения. Сервер без изоляции имеет права вашего пользователя; подтверждение инструмента само по себе не создаёт OS sandbox. Ниже доступен установщик ограниченного официального каталога; native-команды, OAuth и импорт ключей недоступны.')}</Notice>
    <AgentToolsInstaller api={api} status={status} locked={locked} choose={choose} act={act} refresh={refresh} onReview={candidate => { setReview(candidate); setTrusted(false); }} />
    <Panel title={choose('Host state', 'Состояние host')} actions={<Button disabled={locked || !status} onClick={() => void act(async () => { await transport.current.request({ action: 'setEnabled', enabled: !status?.config.enabled, explicitUserAction: true }); await refresh(); })}>{status?.config.enabled ? choose('Disable and close owned servers', 'Выключить и закрыть свои серверы') : choose('Enable configured servers', 'Включить настроенные серверы')}</Button>}>
      <div className="agent-tools-state"><Badge tone={status?.config.enabled ? 'success' : 'neutral'}>{status?.config.enabled ? choose('Enabled', 'Включено') : choose('Disabled by default', 'По умолчанию выключено')}</Badge><span>{choose('Active operations', 'Активные операции')}: {status?.activeCount ?? 0}</span></div>
      {status?.config.servers.length ? <ul className="agent-tools-records">{status.config.servers.map(server => { const owner = status.runtime.servers.find(row => row.id === server.id); return <li key={server.id}><strong>{server.source.label}</strong><span>{server.id} · {server.source.version} · {owner?.connected ? `PID ${owner.pid}` : choose('Disconnected', 'Отключён')}</span><code>{server.command}</code><span>{owner?.sandbox ?? (server.trustedSandbox ? 'requested-unverified' : 'user-privileged')}</span>{owner?.boundary ? <pre>{JSON.stringify(owner.boundary, null, 2)}</pre> : null}<small>SHA-256: {server.commandSha256}</small><Button size="sm" disabled={locked} onClick={() => void act(async () => { await transport.current.request({ action: 'setServerEnabled', serverId: server.id, enabled: !server.enabled, expectedRecipeSha256: status.serverConfigDigests[server.id], explicitUserAction: true }); await refresh(); })}>{server.enabled ? choose('Disable this server', 'Выключить этот сервер') : choose('Enable this exact reviewed server', 'Включить этот проверенный сервер')}</Button><Button size="sm" disabled={locked} onClick={() => void act(async () => { await transport.current.request({ action: 'removeServer', serverId: server.id, explicitUserAction: true }); await refresh(); })}>{choose('Remove server configuration', 'Удалить настройку сервера')}</Button></li>; })}</ul> : <EmptyState title={choose('No servers configured', 'Серверы не настроены')} children={choose('Review an installed local executable below. Nothing is downloaded or started on this screen automatically.', 'Просмотрите установленный локальный исполняемый файл ниже. Эта панель ничего автоматически не скачивает и не запускает.')} />}
    </Panel>
    <Panel title={choose('Review an installed server', 'Проверить установленный сервер')}>
      <div className="agent-tools-grid"><TextField label={choose('Stable server ID', 'Постоянный ID сервера')} value={id} onChange={event => invalidateReview(setId)(event.target.value)} /><TextField label={choose('Source label', 'Название источника')} value={label} onChange={event => invalidateReview(setLabel)(event.target.value)} /><TextField label={choose('Installed version', 'Установленная версия')} value={version} onChange={event => invalidateReview(setVersion)(event.target.value)} /><TextField label={choose('Absolute executable path', 'Абсолютный путь к программе')} value={command} onChange={event => invalidateReview(setCommand)(event.target.value)} /><TextField label={choose('Working directory', 'Рабочий каталог')} value={cwd} onChange={event => invalidateReview(setCwd)(event.target.value)} /></div>
      <Area label={choose('Exact arguments (JSON string array)', 'Точные аргументы (JSON-массив строк)')} value={args} onChange={invalidateReview(setArgs)} hint={choose('No shell or installer commands. Do not put credentials in arguments.', 'Без команд shell и установщиков. Не указывайте секреты в аргументах.')} /><Area label={choose('Installed script files to pin (one absolute path per line)', 'Закрепить установленные скрипты (абсолютный путь в каждой строке)')} value={pins} onChange={invalidateReview(setPins)} />
      <Checkbox checked={sandboxRequested} disabled={locked || !status?.capabilities.mcpSandboxAvailable} onChange={value => { setSandboxRequested(value); setReview(null); setTrusted(false); }} label={choose('Require macOS OS sandbox: read/write only the reviewed working directory; no new network connections; no credential environment.', 'Требовать macOS OS sandbox: чтение/запись только проверенного рабочего каталога; без новых сетевых соединений и credential environment.')} />
      <Button variant="secondary" disabled={locked} onClick={() => void act(async () => { const parsed: unknown = JSON.parse(args); const candidate = await transport.current.request({ action: 'reviewServer', explicitUserAction: true, input: { id, label, version, command, cwd, args: parsed, pinnedFiles: pins.split('\n').map(value => value.trim()).filter(Boolean), sandbox: sandboxRequested } }); if (mounted.current) { setReview(candidate as typeof review); setTrusted(false); } })}>{choose('Review exact files and hashes', 'Проверить точные файлы и хеши')}</Button>
      {review ? <div className="agent-tools-review"><pre>{JSON.stringify(review.recipe, null, 2)}</pre><Checkbox checked={trusted} onChange={setTrusted} label={choose('I reviewed these exact files and trust this server to run with my user permissions.', 'Я проверил эти файлы и разрешаю этому серверу работать с правами моего пользователя.')} /><Button disabled={locked || !trusted} onClick={() => void act(async () => { await transport.current.request({ action: 'saveServer', reviewId: review.reviewId, enabled: !review.recipe.managedInstallation, explicitUserAction: true }); if (mounted.current) { setReview(null); setTrusted(false); } await refresh(); })}>{choose('Save reviewed server', 'Сохранить проверенный сервер')}</Button></div> : null}
    </Panel>
    <Panel title={choose('Owned task and pending tool call', 'Задача и ожидающий вызов инструмента')}>
      <Select label={choose('Agent task', 'Agent-задача')} value={taskId} disabled={locked} onChange={value => void act(() => loadTask(value))} options={[{ value: '', label: choose('Choose a task', 'Выберите задачу') }, ...tasks.map(task => ({ value: task.id, label: `${task.id} · ${task.status} · gen ${task.generation}` }))]} />
      <Button variant="secondary" disabled={locked || !selectedTask || !discoveryEnabled} onClick={() => void act(async () => { await transport.current.request({ action: 'discover', scope: scope(), explicitUserAction: true }); await refresh(); })}>{choose('Connect and discover tools', 'Подключить и найти инструменты')}</Button>
      {resourceEnabledForTask ? <Notice>{choose('Attached skill resources are available for exact, separately approved reads. Import previews stay private; each skill-resource/read sends only the requested immutable resource to the model.', 'Прикреплённые skill-ресурсы доступны для точного чтения с отдельным подтверждением. Просмотр импорта остаётся частным; каждый skill-resource/read передаёт модели только запрошенный неизменяемый ресурс.')}</Notice> : null}
      {status?.descriptors.length ? <ul className="agent-tools-records">{status.descriptors.map(tool => <li key={tool.id}><strong>{tool.id}</strong><Badge tone={tool.supported ? 'neutral' : 'warning'}>{tool.supported ? choose('Schema available; approval required', 'Схема доступна; требуется подтверждение') : choose('Unsupported schema', 'Схема не поддерживается')}</Badge><span>{tool.description ?? tool.unsupportedReason}</span></li>)}</ul> : null}
      <Select label={choose('Saved model tool request', 'Сохранённый запрос инструмента модели')} value={callId} disabled={locked || !calls.length} onChange={value => { setCallId(value); setResult(null); }} options={[{ value: '', label: choose('Select an exact pending call', 'Выберите точный ожидающий вызов') }, ...calls.map(call => ({ value: call.toolCallId, label: `${call.tool} · ${call.toolCallId}` }))]} />
      {pendingCallsTruncated ? <Notice tone="warning">{choose('The current pending-call projection is bounded. Additional retained calls are outside this view; the saved task history is preserved.', 'Список текущих вызовов ограничен. Дополнительные сохранённые вызовы не входят в эту выборку; история задачи сохранена.')}</Notice> : null}
      {selectedCall ? <><pre className="agent-tools-call">{JSON.stringify(selectedCall, null, 2)}</pre><Button disabled={locked || !selectedCallEnabled} onClick={() => void act(async () => { const outcome = await transport.current.request({ action: 'approveInvoke', scope: scope(selectedCall.toolCallId), explicitUserAction: true }) as ToolOutcome; if (mounted.current) setResult(outcome); await refresh(); })}>{choose('Approve and invoke this exact call', 'Подтвердить и выполнить этот вызов')}</Button></> : <p className="agent-tools-muted">{choose('The model must first return a tool call in this task. The host resolves arguments from its saved dispatch; this panel cannot invent a call.', 'Сначала модель должна вернуть вызов инструмента в этой задаче. Host берёт аргументы из сохранённого dispatch; панель не создаёт произвольные вызовы.')}</p>}
      {result ? <div aria-live="polite"><Badge tone={result.state === 'completed' ? 'success' : 'warning'}>{result.state}</Badge><AgentToolOutcomeView outcome={result} choose={choose} />{result.state === 'outcome_unknown' ? <Notice tone="warning">{choose('The effect may already have occurred. The retained receipt blocks automatic replay.', 'Действие могло уже произойти. Сохранённая квитанция блокирует автоматический повтор.')}</Notice> : null}</div> : null}
      <TextField label={choose('Retained receipt key', 'Ключ сохранённой квитанции')} value={receiptKey} onChange={event => { setReceiptKey(event.target.value); setEvidenceReference(null); }} />
      <Button disabled={locked || !receiptKey} onClick={() => void act(async () => { const receipt = await transport.current.request({ action: 'receipt', idempotencyKey: receiptKey }) as ToolOutcome | null; if (mounted.current) setResult(receipt); })}>{choose('Inspect saved receipt', 'Посмотреть сохранённую квитанцию')}</Button>
      {result && isInspectionOnlyReceipt(result.tool) ? <p className="agent-tools-muted">{choose('Browser, desktop, remote, skill-resource and skill-script receipts are available for execution inspection and reconciliation. Attaching them as task outcome evidence is unsupported here; application acceptance needs a separate trusted observer.', 'Квитанции браузера, рабочего стола, удалённого исполнения, чтения skill-ресурсов и исполнения skill-скриптов доступны для просмотра и сверки исполнения. Их прикрепление как доказательства результата задачи здесь не поддерживается; результат в приложении требует отдельного доверенного наблюдения.')}</p> : null}
      <TextField label={choose('Explicit terminal-result requirement ID', 'ID явного требования к terminal result')} value={requirementId} onChange={event => { setRequirementId(event.target.value); setEvidenceReference(null); }} />
      <Button disabled={locked || !result || result.state === 'outcome_unknown' || !requirementId || isInspectionOnlyReceipt(result.tool)} onClick={() => void act(async () => { const reference = await transport.current.request({ action: 'terminalReference', idempotencyKey: result!.idempotencyKey, requirementId }) as typeof evidenceReference; if (mounted.current) setEvidenceReference(reference); })}>{choose('Inspect exact terminal evidence reference', 'Посмотреть точную ссылку на terminal evidence')}</Button>
      {evidenceReference ? <div><pre>{JSON.stringify(evidenceReference, null, 2)}</pre><p>{choose('This proves only the immutable protocol result. To request this exact historical observation, the current task requirement must explicitly be:', 'Это доказывает только неизменяемый результат протокола. Для наблюдения этой исторической квитанции текущее требование задачи должно явно содержать:')}</p><pre>{`Observe the terminal MCP tool result for ${evidenceReference.subject}; property mcp.tool-terminal-result.`}</pre><Button disabled={locked || !selectedTask || !api.attachEvidence} onClick={() => void act(async () => { await transport.current.attachEvidence!(selectedTask!.id, evidenceReference); await refresh(); })}>{choose('Attach observed terminal evidence', 'Приложить наблюдение terminal result')}</Button></div> : null}
    </Panel>
    <Panel title={choose('Selected read-only skills', 'Выбранные skills только для чтения')} actions={<Button variant="secondary" disabled={locked} onClick={() => void act(async () => { await transport.current.pickSkillRoot(); await refresh(); })}>{choose('Choose skill root', 'Выбрать каталог skills')}</Button>}>
      <p className="agent-tools-muted">{choose('Selection is saved for the current task generation, source and content hash. Skill text never grants tool or filesystem permissions. Changed content requires a new explicit selection.', 'Выбор сохраняется для текущего поколения задачи, источника и хеша содержимого. Текст skill не даёт прав на инструменты или файлы. Изменённое содержимое требует нового явного выбора.')}</p>
      {status?.skillRoots.map(root => <div className="agent-tools-root" key={root.id}><span>{root.label} · {root.source}</span><Button size="sm" variant="secondary" disabled={locked} onClick={() => void act(async () => { const discovery = await transport.current.request({ action: 'skillsDiscover', grantId: root.id }) as { skills: SkillIdentity[]; truncated: boolean }; if (mounted.current) setSkills(discovery.skills); })}>{choose('Discover selected root', 'Просмотреть каталог')}</Button><Button size="sm" disabled={locked} onClick={() => void act(async () => { await transport.current.request({ action: 'removeSkillRoot', grantId: root.id, explicitUserAction: true }); setSkills([]); setPreview(''); await refresh(); })}>{choose('Revoke read access', 'Отозвать доступ для чтения')}</Button></div>)}
      {skills.length ? <ul className="agent-tools-records">{skills.map(skill => <li key={skill.id}><strong>{skill.relativePath}</strong><small>{skill.source} · SHA-256 {skill.digest}</small><Button size="sm" disabled={locked || !selectedTask} onClick={() => void act(async () => { const selected = await transport.current.request({ action: 'skillsSelect', scope: scope(`skill:${skill.id}`), identity: skill, explicitUserAction: true }) as { content: string }; if (mounted.current) setPreview(selected.content); await refresh(); })}>{choose('Select for this task and preview', 'Выбрать для задачи и просмотреть')}</Button></li>)}</ul> : null}
      {preview ? <pre className="agent-tools-skill-preview">{preview}</pre> : null}
    </Panel>
    <AgentBrowserTools api={api} status={status} scope={selectedTask ? { taskId: selectedTask.id, generation: selectedTask.generation, toolCallId: 'browser-selection' } : undefined} locked={locked} choose={choose} act={act} refresh={refresh} />
    <AgentDesktopTools api={api} desktop={status?.desktopTools} scope={selectedTask ? { taskId: selectedTask.id, generation: selectedTask.generation, toolCallId: 'desktop-selection' } : undefined} locked={locked} choose={choose} act={act} refresh={refresh} />
    <AgentRemoteTools api={api} remote={remoteStatus} scope={remoteScope} locked={locked} choose={choose} act={act} refresh={refresh} />
    <AgentSkillScripts api={api} status={status} scope={selectedTask ? { taskId: selectedTask.id, generation: selectedTask.generation, toolCallId: 'script-workspace-selection' } : undefined} locked={locked} choose={choose} act={act} onChanged={refresh} />
    <AgentManagedSkills api={api} status={status} sources={skills} scope={selectedTask ? { taskId: selectedTask.id, generation: selectedTask.generation, toolCallId: 'managed-skill-selection' } : undefined} locked={locked} choose={choose} act={act} refresh={refresh} />
  </Page>;
}
