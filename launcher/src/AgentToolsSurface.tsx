import type { VmExportRequest, VmExportStatus } from '../../src/execution-environments/export-contract';
import { selectVmOutputCandidates } from '../../src/execution-environments/output';
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Checkbox, EmptyState, Notice, Page, Panel, PanelStack, Select, SurfaceHeader, TextField } from './design';
import type { Language } from './types';
import type { AgentToolsApi, AgentToolsStatus, ServerRecipe, SkillIdentity, ToolOutcome, ToolScope, RemoteAgentTaskScope, RemoteAgentStatus } from './agent-tools-types';
import { stripIpcErrorPrefix } from './ipc-error';
import './surfaces/agent-tools.css';
import type { AgentOAuthPanelPort } from '../../src/agent-tools/oauth-types';
import { AgentOAuthPanel } from './AgentOAuthPanel';
import { NativeModelsOfflineBanner } from './NativeModelsOfflineNotice';
import type { NativeAccountsApi } from './native-accounts-types';
import { AgentOAuthMcpPanel, oauthMcpCallMatches, oauthMcpConnectionMatches, type OAuthMcpTransport, type OAuthMcpTaskConnection } from './AgentOAuthMcpPanel';
import { AgentToolsInstaller } from './AgentToolsInstaller';
import { AgentManagedSkills } from './AgentManagedSkills';
import { AgentSkillScripts } from './AgentSkillScripts';
import { AgentVmShell } from './AgentVmShell';
import { AgentHostNetwork } from './AgentHostNetwork';
import { AgentBrowserTools } from './AgentBrowserTools';
import { AgentDesktopTools } from './AgentDesktopTools';
import { AgentRemoteTools } from './AgentRemoteTools';
import { AgentToolOutcomeView } from './AgentToolOutcomeView';
import { AgentToolAvailability } from './AgentToolAvailability';
import { AgentToolsCallSummary, desktopCallAttached, toolOutcomeLabel } from './AgentToolsCallSummary';

/** The current owner supplies actionable calls separately from bounded image/history rows.
 * An explicitly empty projection must never resurrect old dispatch calls. */
export function agentPendingCalls(detail: Awaited<ReturnType<AgentToolsApi['getTask']>>) {
  if (['stopped', 'verified_complete'].includes(detail.task.status ?? '')) return [];
  if (detail.pendingToolCalls !== undefined) return detail.pendingToolCalls;
  return detail.dispatches.filter(dispatch => dispatch.generation === detail.task.generation)
    .flatMap(dispatch => dispatch.result?.continuation?.pending ?? [])
    .filter(call => !detail.toolOutcomes?.some(outcome => outcome.scope.generation === detail.task.generation && outcome.scope.toolCallId === call.toolCallId));
}

function Area({ label, value, onChange, hint }: { label: string; value: string; onChange: (value: string) => void; hint?: string }) {
  const id = useId(); return <div className="nk-field"><label htmlFor={id}>{label}</label><textarea id={id} className="nk-input" rows={3} value={value} onChange={event => onChange(event.target.value)} maxLength={32768} aria-describedby={hint ? `${id}-hint` : undefined} />{hint ? <p className="nk-field__hint" id={`${id}-hint`}>{hint}</p> : null}</div>;
}
/** All mutations cross guarded IPC. The surface cannot grant itself OS/file permissions. */
export function AgentToolsSurface({ api, language, disabled = false, oauthMcpRequest, nativeAccounts }: { api: AgentToolsApi; language: Language; disabled?: boolean; oauthMcpRequest?: OAuthMcpTransport; nativeAccounts?: NativeAccountsApi }) {
  const ru = language === 'ru'; const choose = (en: string, russian: string) => ru ? russian : en;
  const transport = useRef(api); transport.current = api;
  const mounted = useRef(true); const busy = useRef(false);
  const disabledRef = useRef(disabled); disabledRef.current = disabled;
  const sectionPrefix = useId();
  const [activeSection, setActiveSection] = useState('calls');
  const [status, setStatus] = useState<AgentToolsStatus | null>(null);
  const oauthScopeKey = status?.oauthScope ? JSON.stringify([status.oauthScope.accountId, status.oauthScope.epoch]) : '';
  const oauthApi = useMemo<AgentOAuthPanelPort | undefined>(() => status?.capabilities.oauth && oauthScopeKey ? {
    list: () => transport.current.request({ action: 'oauthList' }) as ReturnType<AgentOAuthPanelPort['list']>,
    begin: input => transport.current.request({ action: 'oauthBegin', ...input }) as ReturnType<AgentOAuthPanelPort['begin']>,
    cancel: input => transport.current.request({ action: 'oauthCancel', ...input }) as ReturnType<AgentOAuthPanelPort['cancel']>,
    refresh: input => transport.current.request({ action: 'oauthRefresh', ...input }) as ReturnType<AgentOAuthPanelPort['refresh']>,
    revoke: input => transport.current.request({ action: 'oauthRevoke', ...input }) as ReturnType<AgentOAuthPanelPort['revoke']>,
    removeProvider: input => transport.current.request({ action: 'oauthRemoveProvider', ...input }) as ReturnType<NonNullable<AgentOAuthPanelPort['removeProvider']>>,
    ...(api.pickOAuthProvider ? {
      pickProvider: () => transport.current.pickOAuthProvider!(),
      registerProvider: (input: Parameters<NonNullable<AgentOAuthPanelPort['registerProvider']>>[0]) => transport.current.request({ action: 'oauthRegisterProvider', ...input }) as ReturnType<NonNullable<AgentOAuthPanelPort['registerProvider']>>,
    } : {}),
  } : undefined, [status?.capabilities.oauth, oauthScopeKey, Boolean(api.pickOAuthProvider)]);
  const [remoteStatus, setRemoteStatus] = useState<RemoteAgentStatus | null>(null);
  const [oauthMcpConnection, setOAuthMcpConnection] = useState<OAuthMcpTaskConnection | null>(null);
  const [oauthMcpRefreshRevision, setOAuthMcpRefreshRevision] = useState(0);
  const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<{ id: string; generation: number; status: string }[]>([]);
  const [taskId, setTaskId] = useState(''); const selectedTask = tasks.find(task => task.id === taskId);
  const historical = !!selectedTask && ['stopped', 'verified_complete'].includes(selectedTask.status);
  const actionableTask = historical ? undefined : selectedTask;
  const [savedOutcomes, setSavedOutcomes] = useState<ToolOutcome[]>([]);
  const [savedExports, setSavedExports] = useState<VmExportStatus | null>(null);
  const selectedTaskId = useRef(''); const taskLoadRevision = useRef(0);
  const [taskRequest, setTaskRequest] = useState('');
  const [taskDetailScope, setTaskDetailScope] = useState<RemoteAgentTaskScope | undefined>();
  const remoteScope = taskDetailScope?.taskId === selectedTask?.id && taskDetailScope?.generation === selectedTask?.generation ? taskDetailScope : undefined;
  const [calls, setCalls] = useState<{ toolCallId: string; tool: string; arguments: Record<string, unknown> }[]>([]);
  const [pendingCallsTruncated, setPendingCallsTruncated] = useState(false);
  const [callId, setCallId] = useState(''); const selectedCall = calls.find(call => call.toolCallId === callId);
  const selectedDesktopHandoff = !!selectedCall && ['desktop/observe', 'desktop/click', 'desktop/type'].includes(selectedCall.tool) && selectedCall.arguments.waitForForeground === true;
  const [foregroundHandoffScope, setForegroundHandoffScope] = useState<ToolScope | null>(null);
  const [handoffCancelling, setHandoffCancelling] = useState(false);
  const [result, setResult] = useState<ToolOutcome | null>(null);
  const resultTarget = useRef<HTMLDivElement>(null);
  const approvalFocus = useRef<{ element: HTMLButtonElement; scope: ToolScope; dispose: () => void } | null>(null);
  const retireApprovalFocus = () => { approvalFocus.current?.dispose(); approvalFocus.current = null; };
  const retainApprovalFocus = (element: HTMLButtonElement, approvedScope: ToolScope) => {
    retireApprovalFocus();
    if (document.activeElement !== element || !document.hasFocus()) return;
    // Any subsequent user movement or window departure ends this one-shot handoff.
    // A foreground desktop wait is deliberately excluded by the caller.
    const moved = (event: FocusEvent) => { if (event.target !== element) retireApprovalFocus(); };
    const left = () => retireApprovalFocus();
    document.addEventListener('focusin', moved);
    document.addEventListener('pointerdown', left, true);
    document.addEventListener('visibilitychange', left);
    window.addEventListener('blur', left);
    approvalFocus.current = { element, scope: approvedScope, dispose: () => {
      document.removeEventListener('focusin', moved);
      document.removeEventListener('pointerdown', left, true);
      document.removeEventListener('visibilitychange', left);
      window.removeEventListener('blur', left);
    } };
  };
  useLayoutEffect(() => {
    const held = approvalFocus.current;
    if (!held) return;
    if (held.element.isConnected) { if (!pending) retireApprovalFocus(); return; }
    retireApprovalFocus();
    if (!result || result.scope.taskId !== held.scope.taskId || result.scope.generation !== held.scope.generation
      || result.scope.toolCallId !== held.scope.toolCallId || activeSection !== 'calls' || disabled
      || !document.hasFocus() || document.visibilityState !== 'visible') return;
    if (!document.activeElement || document.activeElement === document.body) resultTarget.current?.focus();
  });
  useEffect(() => () => retireApprovalFocus(), []);

  const [receiptKey, setReceiptKey] = useState(''); const [requirementId, setRequirementId] = useState('r1');
  const [evidenceReference, setEvidenceReference] = useState<{ sourceEventId: string; requirementId: string; subject: string; subjectRevision: string; property: string } | null>(null);
  const [editingServer, setEditingServer] = useState<{ id: string; enabled: boolean } | null>(null);
  const serverEditor = useRef<HTMLDivElement>(null);
  const [openTaskId, setOpenTaskId] = useState('');
  const [id, setId] = useState(''); const [label, setLabel] = useState(''); const [version, setVersion] = useState('');
  const [command, setCommand] = useState(''); const [cwd, setCwd] = useState(''); const [args, setArgs] = useState('[]'); const [pins, setPins] = useState('');
  const [sandboxRequested, setSandboxRequested] = useState(false);
  const [review, setReview] = useState<{ reviewId: string; recipe: ServerRecipe; trust: string } | null>(null); const [trusted, setTrusted] = useState(false);
  const [skillDiscovery, setSkillDiscovery] = useState<{ root: string; truncated: boolean } | null>(null);
  const [skills, setSkills] = useState<SkillIdentity[]>([]); const [preview, setPreview] = useState('');
  const locked = disabled || pending;
  const browserEnabledForTask = !!selectedTask && status?.browserTools?.available === true && !!status.browserTools.selected && status.browserTools.bindings.some(row => row.taskId === selectedTask.id && row.generation === selectedTask.generation && Object.keys(row.binding).filter(key => key !== 'observationId').every(key => row.binding[key as keyof typeof row.binding] === status.browserTools!.selected![key as keyof typeof row.binding]));
  const desktopEnabledForTask = !!selectedTask && status?.desktopTools?.enabled === true && status.desktopTools.bindings.some(row => row.taskId === selectedTask.id && row.generation === selectedTask.generation);
  const desktopEnabledForCall = desktopCallAttached(status?.desktopTools, selectedTask, selectedCall);
  const remoteEnabledForTask = !!remoteScope && !!remoteStatus?.bindings.some(row => row.taskId === remoteScope.taskId && row.familyId === remoteScope.familyId && row.generation === remoteScope.generation);
  const resourceEnabledForTask = status?.capabilities.skillResourceReads === true && !!selectedTask && !!status.managedSkills?.attachments.some(attachment => attachment.scope.taskId === selectedTask.id && attachment.scope.generation === selectedTask.generation
    && attachment.versionIds.some(versionId => status.managedSkills?.versions.some(version => version.versionId === versionId && !version.revoked && !version.forgotten && (version.resourceCount ?? 0) > 0)));
  const scriptsEnabledForTask = status?.capabilities.skillScripts === true && !!selectedTask && status?.scriptTools?.grants.some(grant => grant.taskId === selectedTask.id && grant.generation === selectedTask.generation);
  const vmRunEnabledForTask = !!selectedTask && status?.vmEnvironment?.prepared === true && status.vmTools?.available === true && !status.vmTools.closed
    && status.vmTools.bindings.some(binding => binding.taskId === selectedTask.id && binding.generation === selectedTask.generation);
  const vmExportEnabledForTask = selectVmOutputCandidates(status?.vmTools?.operations ?? [], selectedTask ? { taskId: selectedTask.id, generation: selectedTask.generation } : undefined).length > 0;
  const networkGrantsForTask = status?.vmNetwork?.available && selectedTask ? status.vmNetwork.grants.filter(row => !row.revoked && row.grant.scope.taskId === selectedTask.id && row.grant.scope.generation === selectedTask.generation) : [];
  const networkEnabledForTask = networkGrantsForTask.length > 0;
  const networkCallGranted = networkGrantsForTask.some(row => row.grant.id === selectedCall?.arguments.grantId && row.grant.scope.actionId === selectedCall?.arguments.actionId);
  const oauthEnabledForTask = !!oauthMcpRequest && oauthMcpConnectionMatches(oauthMcpConnection, remoteScope, oauthScopeKey, oauthMcpRefreshRevision);
  const oauthCallEnabledForTask = oauthEnabledForTask && oauthMcpCallMatches(oauthMcpConnection, selectedCall);
  const discoveryEnabled = status?.config.enabled || browserEnabledForTask || desktopEnabledForTask || remoteEnabledForTask || resourceEnabledForTask || scriptsEnabledForTask || vmRunEnabledForTask || vmExportEnabledForTask || networkEnabledForTask || oauthEnabledForTask;
  const callPrefix = selectedCall?.tool.split('/')[0];
  const configuredCallServer = status?.config.servers.find(server => server.id === callPrefix);
  // Existing user MCP namespaces win over built-ins, including remote/ and skill-resource/.
  const selectedCallEnabled = !!selectedCall && (configuredCallServer ? status?.config.enabled && configuredCallServer.enabled
    : callPrefix === 'browser' ? browserEnabledForTask : callPrefix === 'desktop' ? desktopEnabledForCall
      : callPrefix === 'oauth_mcp_tools' ? oauthCallEnabledForTask : callPrefix === 'vm-network' ? networkCallGranted
      : callPrefix === 'vm-shell' ? (selectedCall.tool === 'vm-shell/export' ? (vmExportEnabledForTask || !!selectedTask) : vmRunEnabledForTask) : callPrefix === 'remote' ? remoteEnabledForTask : callPrefix === 'skill-resource' ? resourceEnabledForTask : callPrefix === 'skill-script' ? scriptsEnabledForTask : status?.config.enabled);
  const isInspectionOnlyReceipt = (tool: string) => ['browser/', 'desktop/', 'remote/', 'skill-resource/', 'skill-script/', 'vm-shell/', 'vm-network/'].some(prefix => tool.startsWith(prefix))
    && !status?.config.servers.some(server => tool.startsWith(`${server.id}/`));
  const scope = (toolCallId = `discovery:${taskId}`): ToolScope => { if (!actionableTask) throw new Error(choose('Select an owned Agent task.', 'Выберите существующую Agent-задачу.')); return { taskId: actionableTask.id, generation: actionableTask.generation, toolCallId }; };
  const refreshRemote = async () => {
    try {
      const next = await transport.current.request({ action: 'remoteStatus' }) as RemoteAgentStatus;
      if (mounted.current) setRemoteStatus(next);
    } catch (cause) { if (mounted.current) setRemoteStatus(null); throw cause; }
  };
  const clearPendingCalls = () => { setTaskRequest(''); setTaskDetailScope(undefined); setOAuthMcpConnection(null); setOAuthMcpRefreshRevision(value => value + 1); setCallId(''); setCalls([]); setPendingCallsTruncated(false); };
  const refreshTask = async (value: string, loadRevision: number, minimumGeneration = 0) => {
    const detail = await transport.current.getTask(value);
    if (!mounted.current || selectedTaskId.current !== value || taskLoadRevision.current !== loadRevision
      || detail.task.id !== value || detail.task.generation < minimumGeneration) return;
    setTaskRequest('originalRequest' in detail.task && typeof detail.task.originalRequest === 'string' ? detail.task.originalRequest : '');
    setTaskDetailScope({ taskId: detail.task.id, familyId: detail.task.familyId, generation: detail.task.generation, revision: detail.task.revision });
    setSavedOutcomes(detail.toolOutcomes ?? []);
    setCalls(['stopped', 'verified_complete'].includes(detail.task.status ?? tasks.find(task => task.id === value)?.status ?? '') ? [] : agentPendingCalls(detail)); setPendingCallsTruncated(detail.coverage?.pendingToolCalls?.truncated === true);
    setTasks(previous => previous.map(task => task.id === value ? { ...task, generation: detail.task.generation, ...(detail.task.status ? { status: detail.task.status } : {}) } : task));
  };
  const refresh = async () => {
    const value = selectedTaskId.current, loadRevision = ++taskLoadRevision.current;
    clearPendingCalls();
    const [nextStatus, listing] = await Promise.all([transport.current.request({ action: 'status' }) as Promise<AgentToolsStatus>, transport.current.listTasks(), refreshRemote().catch(() => undefined)]);
    if (!mounted.current) return;
    setStatus(nextStatus);
    const retained = tasks.find(task => task.id === value);
    const available = !listing.tasks.some(task => task.id === value) && retained ? [...listing.tasks, retained] : listing.tasks; setTasks(available);
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
  // A Native check settling while another Tools action runs must not be lost: re-read OAuth status once idle.
  // The idle check and act() run in one synchronous turn, so busy cannot flip in between; a disabled
  // surface (screen transition) also defers instead of dropping the one-time re-read.
  // A deferred retry must use the current render's act/refresh, not the closures it was scheduled with.
  const latestRefresh = useRef(() => {}); latestRefresh.current = () => void act(refresh);
  const refreshWhenIdle = () => { if (!mounted.current) return; if (busy.current || disabledRef.current) { window.setTimeout(refreshWhenIdle, 500); return; } latestRefresh.current(); };
  useEffect(() => { mounted.current = true; if (!disabled) void act(refresh); return () => { mounted.current = false; taskLoadRevision.current++; }; }, []);
  useEffect(() => { if (!disabled && !status && !busy.current) void act(refresh); }, [disabled]);
  const loadTask = async (value: string) => {
    selectedTaskId.current = value; const loadRevision = ++taskLoadRevision.current;
    clearPendingCalls(); setTaskId(value); setResult(null); setEvidenceReference(null); setSavedOutcomes([]); setSavedExports(null);
    if (!value) return;
    await refreshTask(value, loadRevision, tasks.find(task => task.id === value)?.generation);
  };
  const editServer = (server: ServerRecipe) => {
    setEditingServer({ id: server.id, enabled: server.enabled }); setId(server.id);
    setLabel(server.source.label); setVersion(server.source.version); setCommand(server.command);
    setCwd(server.cwd); setArgs(JSON.stringify(server.args)); setPins(server.pinnedFiles.map(file => file.path).join('\n'));
    setSandboxRequested(Boolean(server.trustedSandbox)); setReview(null); setTrusted(false);
    requestAnimationFrame(() => serverEditor.current?.focus());
  };
  const invalidateReview = (setter: (value: string) => void) => (value: string) => { setter(value); setReview(null); setTrusted(false); };
  return <Page className="agent-tools-surface">
    <SurfaceHeader eyebrow={choose('Standalone Agent mode', 'Самостоятельный Agent mode')} title={choose('Agent tools', 'Инструменты агентов')} subtitle={choose('Review exact tool calls and manage access for Agent tasks.', 'Проверяйте точные вызовы инструментов и управляйте доступом для Agent-задач.')} actions={<Button className="agent-tools-button" variant="secondary" disabled={locked} onClick={() => void act(refresh)}>{choose('Refresh', 'Обновить')}</Button>} />
    {error ? <Notice tone="error" role="alert">{error}</Notice> : null}

    <Panel title={choose('Current task', 'Текущая задача')} className="agent-tools-context">
      {taskRequest ? <p className="agent-tools-context__request">{taskRequest.length > 200 ? `${taskRequest.slice(0, 200)}…` : taskRequest}</p> : null}
      <Select label={choose('Agent task', 'Agent-задача')} value={taskId} disabled={locked} onChange={value => void act(() => loadTask(value))} options={[{ value: '', label: choose('Choose a task', 'Выберите задачу') }, ...tasks.map(task => ({ value: task.id, label: `${task.id} · ${task.status} · gen ${task.generation}` }))]} />
      <div className="agent-tools-context__meta" aria-live="polite">
        {selectedTask ? <><code>{selectedTask.id}</code><span>{choose('Generation', 'Поколение')} {selectedTask.generation}</span><Badge tone={historical || !calls.length ? 'neutral' : 'warning'}>{historical ? choose('Closed · receipts available', 'Закрыта · квитанции доступны') : !remoteScope ? choose('Task details unavailable', 'Данные задачи недоступны') : choose(`${calls.length} pending calls`, `Ожидают вызовы: ${calls.length}`)}</Badge></> : <span>{choose('Choose a task to review its calls and access.', 'Выберите задачу для проверки её вызовов и доступа.')}</span>}
      </div>
    </Panel>
    <div className="agent-tools-layout">
      <nav className="agent-tools-navigation" aria-label={choose('Tool sections', 'Разделы инструментов')}>
        <h2>{choose('Sections', 'Разделы')}</h2>
        {[
          { id: 'calls', label: choose('Calls and receipts', 'Вызовы и квитанции'), detail: selectedTask ? !remoteScope ? choose('Loading or unavailable', 'Загрузка или недоступно') : choose(`${calls.length} pending`, `Ожидают: ${calls.length}`) : choose('Choose a task', 'Выберите задачу') },
          { id: 'connections', label: choose('Connections', 'Подключения'), detail: status ? choose(`${status.config.servers.length} configured servers`, `Настроено серверов: ${status.config.servers.length}`) : choose('Status unavailable', 'Состояние недоступно') },
          { id: 'local', label: choose('Local access and skills', 'Локальный доступ и skills'), detail: choose('Instructions and host network', 'Инструкции и сеть хоста') },
          { id: 'browser', label: choose('Browser and desktop', 'Браузер и окна'), detail: choose('Task attachments', 'Привязки задачи') },
          { id: 'remote', label: choose('Remote access', 'Удалённый доступ'), detail: !remoteStatus ? choose('Status unavailable', 'Состояние недоступно') : remoteEnabledForTask ? choose('Attached to task', 'Привязан к задаче') : choose('Not attached', 'Не привязан') },
          { id: 'execution', label: choose('Python and VM', 'Python и VM'), detail: choose('Execution environments', 'Среды исполнения') },
        ].map(section => <button key={section.id} type="button" aria-current={activeSection === section.id ? 'location' : undefined} aria-controls={`${sectionPrefix}-${section.id}`} onClick={() => setActiveSection(section.id)}><span>{section.label}</span><small>{section.detail}</small></button>)}
      </nav>
      <div className="agent-tools-sections">
        <section id={`${sectionPrefix}-calls`} className="agent-tools-section" aria-label={choose('Calls and receipts', 'Вызовы и квитанции')} hidden={activeSection !== 'calls'}>
    <Panel title={choose('Owned task and pending tool call', 'Задача и ожидающий вызов инструмента')}>
      <PanelStack className="agent-tools-panel-body">
      {historical ? <Notice>{choose('This task is closed. Saved outcomes remain available for inspection; discovery, new approvals and task attachments are disabled.', 'Эта задача закрыта. Сохранённые исходы доступны для просмотра; поиск инструментов, новые подтверждения и прикрепления к задаче отключены.')}</Notice> : null}
      {selectedTask && savedOutcomes.length ? <details><summary>{choose('Saved tool receipts', 'Сохранённые квитанции инструментов')}</summary><ul className="agent-tools-records agent-tools-main-records">{savedOutcomes.map(outcome => <li key={outcome.idempotencyKey}><code>{outcome.tool} · gen {outcome.scope.generation}</code><span>{toolOutcomeLabel(outcome.state, choose)}</span><Button className="agent-tools-button" size="sm" disabled={locked} onClick={() => { setResult(outcome); setEvidenceReference(null); }}>{choose('Inspect retained result', 'Просмотреть сохранённый результат')}</Button></li>)}</ul></details> : null}
      {historical && selectedTask ? <div className="agent-tools-records agent-tools-history">
        <Button className="agent-tools-button" disabled={locked} onClick={() => void act(async () => {
          const id = selectedTask.id, generation = selectedTask.generation, revision = taskLoadRevision.current;
          const records = await transport.current.request({ action: 'vmExportStatus', scope: { taskId: id, generation } }) as VmExportStatus;
          if (mounted.current && selectedTaskId.current === id && taskLoadRevision.current === revision) setSavedExports(records);
        })}>{choose('Read saved VM export receipts', 'Прочитать сохранённые квитанции экспорта VM')}</Button>
        {savedExports?.receipts.map(row => <div className="agent-tools-record" key={row.request.idempotencyKey}><BadgeRow><Badge>{row.state}</Badge><code>{row.request.idempotencyKey}</code><small>{row.request.scope.taskId} · gen {row.request.scope.generation}</small></BadgeRow><pre>{JSON.stringify(row.result, null, 2)}</pre>{row.reason ? <p>{row.reason}</p> : null}
          {row.state === 'outcome_unknown' ? <Button className="agent-tools-button" disabled={locked} onClick={() => void act(async () => {
            const request: VmExportRequest = structuredClone(row.request), id = selectedTask.id, generation = selectedTask.generation, revision = taskLoadRevision.current;
            await transport.current.request({ action: 'reconcileVmExport', request, explicitUserAction: true });
            const records = await transport.current.request({ action: 'vmExportStatus', scope: { taskId: id, generation } }) as VmExportStatus;
            if (mounted.current && selectedTaskId.current === id && taskLoadRevision.current === revision) setSavedExports(records);
          })}>{choose('Inspect exact saved publication without replay', 'Проверить сохранённую публикацию без повтора')}</Button> : null}
        </div>)}
        {savedExports && !savedExports.receipts.length ? <p>{choose('No saved export receipts in this view.', 'В этой выборке нет сохранённых квитанций экспорта.')}</p> : null}
      </div> : null}
      <form className="agent-tools-grid" onSubmit={event => { event.preventDefault(); void act(async () => {
        const id = openTaskId.trim(); if (!id) return;
        const detail = await transport.current.getTask(id);
        if (!mounted.current) return;
        const row = { id: detail.task.id, generation: detail.task.generation, status: detail.task.status ?? 'stopped' };
        setTasks(previous => [...previous.filter(task => task.id !== row.id), row]);
        selectedTaskId.current = row.id; setTaskId(row.id); clearPendingCalls();
        await refreshTask(row.id, ++taskLoadRevision.current, row.generation);
      }); }}>
        <TextField label={choose('Open saved task by exact ID', 'Открыть сохранённую задачу по точному ID')} value={openTaskId} maxLength={128} disabled={locked} onChange={event => setOpenTaskId(event.target.value)} />
        <Button type="submit" disabled={locked || !openTaskId.trim()}>{choose('Open task', 'Открыть задачу')}</Button>
      </form>
      <Button className="agent-tools-button" variant="secondary" disabled={locked || !actionableTask || !discoveryEnabled} onClick={() => void act(async () => { await transport.current.request({ action: 'discover', scope: scope(), explicitUserAction: true }); await refresh(); })}>{choose('Connect and discover tools', 'Подключить и найти инструменты')}</Button>
      {resourceEnabledForTask ? <Notice>{choose('Attached skill resources are available for exact, separately approved reads. Import previews stay private; each skill-resource/read sends only the requested immutable resource to the model.', 'Прикреплённые skill-ресурсы доступны для точного чтения с отдельным подтверждением. Просмотр импорта остаётся частным; каждый skill-resource/read передаёт модели только запрошенный неизменяемый ресурс.')}</Notice> : null}
      {status?.descriptors.length ? <details><summary>{choose('Discovered tool availability', 'Доступность найденных инструментов')}</summary><ul className="agent-tools-records agent-tools-main-records">{status.descriptors.map(tool => <li key={tool.id}><AgentToolAvailability tool={tool} language={language} /></li>)}</ul></details> : null}
      <Select label={choose('Saved model tool request', 'Сохранённый запрос инструмента модели')} value={callId} disabled={locked || !calls.length} onChange={value => { setCallId(value); setResult(null); }} options={[{ value: '', label: choose('Select an exact pending call', 'Выберите точный ожидающий вызов') }, ...calls.map(call => ({ value: call.toolCallId, label: `${call.tool} · ${call.toolCallId}` }))]} />
      {pendingCallsTruncated ? <Notice tone="warning">{choose('The current pending-call projection is bounded. Additional retained calls are outside this view; the saved task history is preserved.', 'Список текущих вызовов ограничен. Дополнительные сохранённые вызовы не входят в эту выборку; история задачи сохранена.')}</Notice> : null}
      {selectedCall ? <>
        <AgentToolsCallSummary call={selectedCall} choose={choose} customServer={!!configuredCallServer} />
        {!selectedCallEnabled ? <Notice tone="warning">{choose('This call is unavailable for the current task attachments or server state. Review the relevant section; approval remains disabled.', 'Этот вызов недоступен при текущих привязках задачи или состоянии сервера. Проверьте соответствующий раздел; подтверждение отключено.')}</Notice> : null}
        {selectedDesktopHandoff ? <Notice tone="info">{choose('This exact call includes a manual return to the selected window. After approval, return through its title bar or Dock without changing its content, size or focused control, then release keys and mouse buttons. NEKODEX will wait without activating the window. Input still requires the original image, frame, focus and owner to match.', 'Этот точный вызов включает ручной возврат в выбранное окно. После подтверждения вернитесь через его заголовок или Dock, не меняя содержимое, размер и выбранный элемент, затем отпустите клавиши и кнопки мыши. NEKODEX будет ждать без активации окна. Для ввода должны совпасть исходное изображение, положение, фокус и владелец.')}</Notice> : null}
        <Button className="agent-tools-button" disabled={locked || historical || !selectedCallEnabled} onClick={event => {
          const button = event.currentTarget, keyboard = event.detail === 0;
          void act(async () => {
            const approvedScope = scope(selectedCall.toolCallId);
            if (keyboard && !selectedDesktopHandoff) retainApprovalFocus(button, approvedScope);
            if (selectedDesktopHandoff) setForegroundHandoffScope(approvedScope);
            const outcome = await transport.current.request({ action: 'approveInvoke', scope: approvedScope, explicitUserAction: true }) as ToolOutcome;
            if (mounted.current) { setResult(outcome); if (selectedDesktopHandoff && outcome.state !== 'outcome_unknown') setForegroundHandoffScope(null); }
            await refresh();
          });
        }}>{selectedDesktopHandoff ? choose('Approve this call and wait for the selected window', 'Подтвердить вызов и ждать выбранное окно') : choose('Approve and invoke this exact call', 'Подтвердить и выполнить этот вызов')}</Button>
      </> : <p className="agent-tools-muted">{choose('The model must first return a tool call in this task. The host resolves arguments from its saved dispatch; this panel cannot invent a call.', 'Сначала модель должна вернуть вызов инструмента в этой задаче. Host берёт аргументы из сохранённого dispatch; панель не создаёт произвольные вызовы.')}</p>}
      {foregroundHandoffScope ? <div className="agent-tools-actions" role="status">
        <span>{choose('Approved desktop wait for task', 'Подтверждено ожидание окна для задачи')} {foregroundHandoffScope.taskId.slice(0, 8)} · {foregroundHandoffScope.generation}</span>
        <Button className="agent-tools-button" variant="secondary" disabled={disabled || handoffCancelling} onClick={() => {
          const cancelledScope = foregroundHandoffScope;
          setHandoffCancelling(true);
          // Cancellation bypasses only the UI's in-flight lock. The backend still
          // checks the exact frozen task scope and retires its native owner.
          void transport.current.request({ action: 'revokeDesktopTools', scope: cancelledScope, explicitUserAction: true }).then(() => {
            if (mounted.current) setForegroundHandoffScope(null);
          }).catch(() => {
            if (mounted.current) setError(choose('Window revocation is unconfirmed. Inspect the retained operation before another action.', 'Отзыв привязки окна не подтверждён. Проверьте сохранённую операцию перед следующим действием.'));
          }).finally(() => { if (mounted.current) setHandoffCancelling(false); });
        }}>{choose('Cancel waiting and revoke this task window', 'Отменить ожидание и отозвать окно задачи')}</Button>
        <span>{choose('Revocation stops further access; it does not undo input that may already have been dispatched.', 'Отзыв прекращает дальнейший доступ и не откатывает ввод, который мог уже произойти.')}</span>
      </div> : null}
      {result ? <div ref={resultTarget} className="agent-tools-result" tabIndex={-1} role="region" aria-label={choose('Tool call result', 'Результат вызова инструмента')} aria-live="polite"><BadgeRow><Badge tone={result.state === 'completed' ? 'success' : 'warning'}>{toolOutcomeLabel(result.state, choose)}</Badge></BadgeRow><AgentToolOutcomeView outcome={result} choose={choose} />{result.state === 'outcome_unknown' ? <Notice tone="warning">{choose('The effect may already have occurred. The retained receipt blocks automatic replay.', 'Действие могло уже произойти. Сохранённая квитанция блокирует автоматический повтор.')}</Notice> : null}</div> : null}
      <TextField label={choose('Retained receipt key', 'Ключ сохранённой квитанции')} value={receiptKey} onChange={event => { setReceiptKey(event.target.value); setEvidenceReference(null); }} />
      <Button className="agent-tools-button" disabled={locked || !receiptKey} onClick={() => void act(async () => { const receipt = await transport.current.request({ action: 'receipt', idempotencyKey: receiptKey }) as ToolOutcome | null; if (mounted.current) setResult(receipt); })}>{choose('Inspect saved receipt', 'Посмотреть сохранённую квитанцию')}</Button>
      {result && isInspectionOnlyReceipt(result.tool) ? <p className="agent-tools-muted">{choose('Browser, desktop, remote, skill-resource, skill-script, VM and host-network receipts are available for execution inspection and reconciliation. Attaching them as task outcome evidence is unsupported here; application acceptance needs a separate trusted observer.', 'Квитанции браузера, рабочего стола, удалённого исполнения, чтения skill-ресурсов, исполнения skill-скриптов, VM и сети хоста доступны для просмотра и сверки исполнения. Их прикрепление как доказательства результата задачи здесь не поддерживается; результат в приложении требует отдельного доверенного наблюдения.')}</p> : null}
      <TextField label={choose('Explicit terminal-result requirement ID', 'ID явного требования к terminal result')} value={requirementId} onChange={event => { setRequirementId(event.target.value); setEvidenceReference(null); }} />
      <Button className="agent-tools-button" disabled={locked || !result || result.state === 'outcome_unknown' || !requirementId || isInspectionOnlyReceipt(result.tool)} onClick={() => void act(async () => { const reference = await transport.current.request({ action: 'terminalReference', idempotencyKey: result!.idempotencyKey, requirementId }) as typeof evidenceReference; if (mounted.current) setEvidenceReference(reference); })}>{choose('Inspect exact terminal evidence reference', 'Посмотреть точную ссылку на terminal evidence')}</Button>
      {evidenceReference ? <div className="agent-tools-evidence"><pre>{JSON.stringify(evidenceReference, null, 2)}</pre><p>{choose('This proves only the immutable protocol result. To request this exact historical observation, the current task requirement must explicitly be:', 'Это доказывает только неизменяемый результат протокола. Для наблюдения этой исторической квитанции текущее требование задачи должно явно содержать:')}</p><pre>{`Observe the terminal MCP tool result for ${evidenceReference.subject}; property mcp.tool-terminal-result.`}</pre><Button className="agent-tools-button" disabled={locked || !actionableTask || !api.attachEvidence} onClick={() => void act(async () => { await transport.current.attachEvidence!(selectedTask!.id, evidenceReference); await refresh(); })}>{choose('Attach observed terminal evidence', 'Приложить наблюдение terminal result')}</Button></div> : null}
      </PanelStack>
    </Panel>
        </section>
        <section id={`${sectionPrefix}-connections`} className="agent-tools-section" aria-label={choose('Connections', 'Подключения')} hidden={activeSection !== 'connections'}>
    <Notice tone="warning">{choose('Each server displays its execution boundary. Unrestricted servers have your user permissions; tool approval alone does not create OS isolation. The limited official catalog has a separate installer below; Provider authorization uses the protected service when it is configured. Automatic key import is unavailable.', 'У каждого сервера показана граница исполнения. Сервер без изоляции имеет права вашего пользователя; подтверждение инструмента само по себе не создаёт OS sandbox. Ниже доступен установщик ограниченного официального каталога; Авторизация провайдеров использует защищённый сервис, если он настроен. Автоматический импорт ключей недоступен.')}</Notice>
    <AgentOAuthPanel api={oauthApi} scopeKey={oauthScopeKey} locked={locked} choose={choose}
      accountOffline={status?.oauthRegistry?.reasonCode === 'account_authority_offline'}
      offlineBanner={nativeAccounts ? fallback => <NativeModelsOfflineBanner api={nativeAccounts} language={language} disabled={locked} fallback={fallback}
        consequence={choose('Until then provider authorization and OAuth MCP tools are unavailable.', 'До этого авторизация провайдеров и OAuth MCP-инструменты недоступны.')}
        onRestored={refreshWhenIdle} /> : undefined} />
    <AgentOAuthMcpPanel request={oauthMcpRequest} accountScopeKey={oauthScopeKey} refreshRevision={oauthMcpRefreshRevision} scope={remoteScope && actionableTask ? { taskId: remoteScope.taskId, generation: remoteScope.generation, toolCallId: 'oauth-mcp-control' } : undefined} language={language} disabled={locked} onConnectionChange={setOAuthMcpConnection} />
    <AgentToolsInstaller api={api} status={status} locked={locked} choose={choose} act={act} refresh={refresh} onReview={candidate => { setReview(candidate); setTrusted(false); }} />
    <Panel title={choose('Host state', 'Состояние host')} actions={<Button className="agent-tools-button" disabled={locked || !status} onClick={() => void act(async () => { await transport.current.request({ action: 'setEnabled', enabled: !status?.config.enabled, explicitUserAction: true }); await refresh(); })}>{status?.config.enabled ? choose('Disable and close owned servers', 'Выключить и закрыть свои серверы') : choose('Enable configured servers', 'Включить настроенные серверы')}</Button>}>
      <PanelStack className="agent-tools-panel-body">
      <BadgeRow className="agent-tools-state"><Badge tone={status?.config.enabled ? 'success' : 'neutral'}>{!status ? choose('Status unavailable', 'Состояние недоступно') : status.config.enabled ? choose('Enabled', 'Включено') : choose('Disabled by default', 'По умолчанию выключено')}</Badge><span>{choose('Active operations', 'Активные операции')}: {status?.activeCount ?? choose('Unknown', 'Неизвестно')}</span></BadgeRow>
      {!status ? <Notice>{pending ? choose('Loading server inventory…', 'Загрузка списка серверов…') : choose('Server inventory is unavailable. Refresh to inspect the current state.', 'Список серверов недоступен. Обновите данные, чтобы проверить текущее состояние.')}</Notice> : status.config.servers.length ? <ul className="agent-tools-records agent-tools-main-records">{status.config.servers.map(server => { const owner = status.runtime.servers.find(row => row.id === server.id); return <li key={server.id}><strong>{server.source.label}</strong><span>{server.id} · {server.source.version} · {owner?.connected ? `PID ${owner.pid}` : choose('Disconnected', 'Отключён')}</span><code>{server.command}</code><span>{owner?.sandbox ?? (server.trustedSandbox ? 'requested-unverified' : 'user-privileged')}</span>{owner?.boundary ? <pre>{JSON.stringify(owner.boundary, null, 2)}</pre> : null}<small>SHA-256: {server.commandSha256}</small><div className="agent-tools-actions"><Button className="agent-tools-button" size="sm" disabled={locked} onClick={() => void act(async () => { await transport.current.request({ action: 'setServerEnabled', serverId: server.id, enabled: !server.enabled, expectedRecipeSha256: status.serverConfigDigests[server.id], explicitUserAction: true }); await refresh(); })}>{server.enabled ? choose('Disable this server', 'Выключить этот сервер') : choose('Enable this exact reviewed server', 'Включить этот проверенный сервер')}</Button>{server.managedInstallation ? <small>{choose('Managed package recipes are immutable. Use the reviewed installer to create a new installation and configuration.', 'Рецепты управляемых пакетов неизменяемы. Создайте новую установку и конфигурацию через проверенный установщик.')}</small> : null}{!server.managedInstallation ? <Button className="agent-tools-button" size="sm" variant="secondary" disabled={locked} onClick={() => editServer(server)}>{choose('Edit and review', 'Изменить и проверить')}</Button> : null}<Button className="agent-tools-button" size="sm" disabled={locked} onClick={() => void act(async () => { await transport.current.request({ action: 'removeServer', serverId: server.id, explicitUserAction: true }); await refresh(); })}>{choose('Remove server configuration', 'Удалить настройку сервера')}</Button></div></li>; })}</ul> : <EmptyState title={choose('No servers configured', 'Серверы не настроены')} children={choose('Review an installed local executable below. Nothing is downloaded or started on this screen automatically.', 'Просмотрите установленный локальный исполняемый файл ниже. Эта панель ничего автоматически не скачивает и не запускает.')} />}
      </PanelStack>
    </Panel>
    <Panel title={choose('Review an installed server', 'Проверить установленный сервер')}>
      <PanelStack className="agent-tools-panel-body">
      <div ref={serverEditor} tabIndex={-1}>
      {editingServer ? <Notice>{choose('Editing saved server', 'Изменение сохранённого сервера')}: {editingServer.id}. {choose('Review files and approve again before saving.', 'Перед сохранением снова проверьте файлы и подтвердите доверие.')} <Button size="sm" variant="ghost" disabled={locked} onClick={() => { setEditingServer(null); setReview(null); setTrusted(false); setId(''); setLabel(''); setVersion(''); setCommand(''); setCwd(''); setArgs('[]'); setPins(''); setSandboxRequested(false); }}>{choose('Cancel edit', 'Отменить изменение')}</Button></Notice> : null}
      <div className="agent-tools-grid"><TextField label={choose('Stable server ID', 'Постоянный ID сервера')} disabled={locked || Boolean(editingServer)} value={id} onChange={event => invalidateReview(setId)(event.target.value)} /><TextField label={choose('Source label', 'Название источника')} value={label} onChange={event => invalidateReview(setLabel)(event.target.value)} /><TextField label={choose('Installed version', 'Установленная версия')} value={version} onChange={event => invalidateReview(setVersion)(event.target.value)} /><TextField label={choose('Absolute executable path', 'Абсолютный путь к программе')} value={command} onChange={event => invalidateReview(setCommand)(event.target.value)} /><TextField label={choose('Working directory', 'Рабочий каталог')} value={cwd} onChange={event => invalidateReview(setCwd)(event.target.value)} /></div>
      <Area label={choose('Exact arguments (JSON string array)', 'Точные аргументы (JSON-массив строк)')} value={args} onChange={invalidateReview(setArgs)} hint={choose('No shell or installer commands. Do not put credentials in arguments.', 'Без команд shell и установщиков. Не указывайте секреты в аргументах.')} /><Area label={choose('Installed script files to pin (one absolute path per line)', 'Закрепить установленные скрипты (абсолютный путь в каждой строке)')} value={pins} onChange={invalidateReview(setPins)} />
      <Checkbox checked={sandboxRequested} disabled={locked || !status?.capabilities.mcpSandboxAvailable} onChange={value => { setSandboxRequested(value); setReview(null); setTrusted(false); }} label={choose('Require macOS OS sandbox: read/write only the reviewed working directory; no new network connections; no credential environment.', 'Требовать macOS OS sandbox: чтение/запись только проверенного рабочего каталога; без новых сетевых соединений и credential environment.')} />
      <Button className="agent-tools-button" variant="secondary" disabled={locked} onClick={() => void act(async () => { const parsed: unknown = JSON.parse(args); const candidate = await transport.current.request({ action: 'reviewServer', explicitUserAction: true, input: { id, label, version, command, cwd, args: parsed, pinnedFiles: pins.split('\n').map(value => value.trim()).filter(Boolean), sandbox: sandboxRequested } }); if (mounted.current) { setReview(candidate as typeof review); setTrusted(false); } })}>{choose('Review exact files and hashes', 'Проверить точные файлы и хеши')}</Button>
      {review ? <div className="agent-tools-review"><pre>{JSON.stringify(review.recipe, null, 2)}</pre><Checkbox checked={trusted} onChange={setTrusted} label={choose('I reviewed these exact files and trust this server to run with my user permissions.', 'Я проверил эти файлы и разрешаю этому серверу работать с правами моего пользователя.')} /><Button className="agent-tools-button" disabled={locked || !trusted} onClick={() => void act(async () => { await transport.current.request({ action: 'saveServer', reviewId: review.reviewId, enabled: editingServer?.id === review.recipe.id ? (status?.config.servers.find(server => server.id === editingServer.id)?.enabled ?? editingServer.enabled) : !review.recipe.managedInstallation, explicitUserAction: true }); if (mounted.current) { setReview(null); setTrusted(false); } await refresh(); })}>{choose('Save reviewed server', 'Сохранить проверенный сервер')}</Button></div> : null}
      </div>
      </PanelStack>
    </Panel>
        </section>
        <section id={`${sectionPrefix}-local`} className="agent-tools-section" aria-label={choose('Local access and skills', 'Локальный доступ и skills')} hidden={activeSection !== 'local'}>
    <Panel title={choose('Selected read-only skills', 'Выбранные skills только для чтения')} actions={<Button className="agent-tools-button" variant="secondary" disabled={locked} onClick={() => void act(async () => { await transport.current.pickSkillRoot(); await refresh(); })}>{choose('Choose skill root', 'Выбрать каталог skills')}</Button>}>
      <PanelStack className="agent-tools-panel-body">
      <p className="agent-tools-muted">{choose('Selection is saved for the current task generation, source and content hash. Skill text never grants tool or filesystem permissions. Changed content requires a new explicit selection.', 'Выбор сохраняется для текущего поколения задачи, источника и хеша содержимого. Текст skill не даёт прав на инструменты или файлы. Изменённое содержимое требует нового явного выбора.')}</p>
      {status?.skillRoots.map(root => <div className="agent-tools-root" key={root.id}><span>{root.label} · {root.source}</span><div className="agent-tools-actions"><Button className="agent-tools-button" size="sm" variant="secondary" disabled={locked} onClick={() => void act(async () => { const discovery = await transport.current.request({ action: 'skillsDiscover', grantId: root.id }) as { skills: SkillIdentity[]; truncated: boolean }; if (mounted.current) { setSkills(discovery.skills); setSkillDiscovery({ root: root.label, truncated: discovery.truncated }); } })}>{choose('Discover selected root', 'Просмотреть каталог')}</Button><Button className="agent-tools-button" size="sm" disabled={locked} onClick={() => void act(async () => { await transport.current.request({ action: 'removeSkillRoot', grantId: root.id, explicitUserAction: true }); setSkills([]); setPreview(''); await refresh(); })}>{choose('Revoke read access', 'Отозвать доступ для чтения')}</Button></div></div>)}
      {selectedTask ? <ul className="agent-tools-records">{status?.selections.filter(row => row.scope.taskId === selectedTask.id && row.scope.generation === selectedTask.generation).flatMap(row => row.skills).map(skill => <li key={`${skill.id}:${skill.digest}`}><strong>{skill.relativePath}</strong><small>{choose('Attached to this task', 'Прикреплён к этой задаче')} · {skill.digest}</small><Button size="sm" disabled={locked || historical} onClick={() => void act(async () => { await transport.current.request({ action: 'skillsDeselect', scope: scope(`skill:${skill.id}`), identity: skill, explicitUserAction: true }); setPreview(''); await refresh(); })}>{choose('Detach from this task', 'Открепить от этой задачи')}</Button></li>)}</ul> : null}
      {skillDiscovery ? <Notice>{skillDiscovery.root}: {skillDiscovery.truncated ? choose('More skills exist beyond this bounded view; choose a narrower root.', 'За пределами выборки есть ещё skills; выберите более узкий каталог.') : !skills.length ? choose('No supported skills found in this root.', 'В этом каталоге не найдено поддерживаемых skills.') : `${skills.length} ${choose('skills found', 'skills найдено')}`}</Notice> : null}
      {skills.length ? <ul className="agent-tools-records agent-tools-main-records">{skills.map(skill => <li key={skill.id}><strong>{skill.relativePath}</strong><small>{skill.source} · SHA-256 {skill.digest}</small><Button className="agent-tools-button" size="sm" disabled={locked || !actionableTask} onClick={() => void act(async () => { const selected = await transport.current.request({ action: 'skillsSelect', scope: scope(`skill:${skill.id}`), identity: skill, explicitUserAction: true }) as { content: string }; if (mounted.current) setPreview(selected.content); await refresh(); })}>{choose('Select for this task and preview', 'Выбрать для задачи и просмотреть')}</Button></li>)}</ul> : null}
      {preview ? <pre className="agent-tools-skill-preview">{preview}</pre> : null}
      </PanelStack>
    </Panel>
    <AgentHostNetwork api={api} status={status} scope={selectedTask ? { taskId: selectedTask.id, generation: selectedTask.generation, toolCallId: 'host-network-selection' } : undefined}
      taskStatus={selectedTask?.status} locked={locked} choose={choose} act={act} onChanged={refresh} />
    {!historical ? <>
    <AgentManagedSkills api={api} status={status} sources={skills} scope={actionableTask ? { taskId: actionableTask.id, generation: actionableTask.generation, toolCallId: 'managed-skill-selection' } : undefined} locked={locked} choose={choose} act={act} refresh={refresh} />
    </> : null}
        </section>
        <section id={`${sectionPrefix}-browser`} className="agent-tools-section" aria-label={choose('Browser and desktop', 'Браузер и окна')} hidden={activeSection !== 'browser'}>
    {!historical ? <>
    <AgentBrowserTools api={api} status={status} scope={actionableTask ? { taskId: actionableTask.id, generation: actionableTask.generation, toolCallId: 'browser-selection' } : undefined} locked={locked} choose={choose} act={act} refresh={refresh} />
    <AgentDesktopTools api={api} desktop={status?.desktopTools} scope={actionableTask ? { taskId: actionableTask.id, generation: actionableTask.generation, toolCallId: 'desktop-selection' } : undefined} locked={locked} choose={choose} act={act} refresh={refresh} />
    </> : <Notice>{choose('This task is closed; new attachments are unavailable.', 'Задача закрыта; новые привязки недоступны.')}</Notice>}
        </section>
        <section id={`${sectionPrefix}-remote`} className="agent-tools-section" aria-label={choose('Remote access', 'Удалённый доступ')} hidden={activeSection !== 'remote'}>
    {!historical ? <>
    <AgentRemoteTools api={api} remote={remoteStatus} scope={historical ? undefined : remoteScope} locked={locked} choose={choose} act={act} refresh={refresh} />
    </> : <Notice>{choose('This task is closed; new attachments are unavailable.', 'Задача закрыта; новые привязки недоступны.')}</Notice>}
        </section>
        <section id={`${sectionPrefix}-execution`} className="agent-tools-section" aria-label={choose('Python and VM', 'Python и VM')} hidden={activeSection !== 'execution'}>
    {!historical ? <>
    <AgentSkillScripts api={api} status={status} scope={actionableTask ? { taskId: actionableTask.id, generation: actionableTask.generation, toolCallId: 'script-workspace-selection' } : undefined} locked={locked} choose={choose} act={act} onChanged={refresh} />
    <AgentVmShell api={api} status={status} scope={actionableTask ? { taskId: actionableTask.id, generation: actionableTask.generation, toolCallId: 'vm-workspace-selection' } : undefined} locked={locked} choose={choose} act={act} onChanged={refresh} />
    </> : <Notice>{choose('This task is closed; inspect retained results in Calls and receipts.', 'Задача закрыта; сохранённые результаты доступны в разделе «Вызовы и квитанции».')}</Notice>}
        </section>
      </div>
    </div>
  </Page>;
}
