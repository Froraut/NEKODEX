import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Badge, Button, Checkbox, EmptyState, Notice, Page, Panel, Select, SurfaceHeader, TextField } from './design';
import type { Language } from './types';
import type { AgentModeApi, AgentModeStatus, AgentModeDetail, AgentTask, AgentWorkspaceRoot, AgentWorkspaceGrantSummary, AgentArtifactObservation } from './agent-mode-types';
import { agentModeCopy } from './agent-mode-copy';
import { stripIpcErrorPrefix } from './ipc-error';
import './surfaces/agent-mode.css';
import { NativeAccountsPanel } from './NativeAccountsPanel';
import { OwnedNativeHistoryPanel } from './OwnedNativeHistoryPanel';

const lines = (text: string) => text.split('\n').map(value => value.trim()).filter(Boolean);
const requirementRows = (text: string) => lines(text).map((value, index) => ({ id: `r${index + 1}`, text: value }));
const stageRows = (text: string, requirementIds: string[]) => lines(text).map((instruction, index) => ({
  id: `s${index + 1}`, instruction, requirementIds, dependsOn: index ? [`s${index}`] : [],
}));
const errorText = (error: unknown) => stripIpcErrorPrefix(error instanceof Error ? error.message : String(error));
const terminal = (task: AgentTask) => task.status === 'stopped' || task.status === 'verified_complete';
type ModelRow = AgentModeStatus['models'][number];
const modelChoice = (row: ModelRow) => row.provider === 'owned-native' ? JSON.stringify([row.provider, row.id, row.admissionId]) : row.id;
const matchesModel = (task: AgentTask, row: ModelRow) => row.id === task.execution?.model
  && (row.provider ?? 'local-responses') === task.execution?.provider
  && (task.execution?.provider !== 'owned-native' || row.available === true && row.admissionId === task.execution.admissionId);

function TextArea({ label, value, onChange, hint, disabled, required, rows = 3 }: {
  label: string; value: string; onChange: (value: string) => void; hint?: string; disabled?: boolean; required?: boolean; rows?: number;
}) {
  const id = useId();
  return <div className="nk-field agent-mode-field">
    <label htmlFor={id}>{label}</label>
    <textarea id={id} className="nk-input" value={value} onChange={event => onChange(event.target.value)}
      rows={rows} readOnly={disabled} aria-disabled={disabled || undefined} required={required} maxLength={16384} aria-describedby={hint ? `${id}-hint` : undefined} />
    {hint ? <p className="nk-field__hint" id={`${id}-hint`}>{hint}</p> : null}
  </div>;
}

function RecordList({ children, empty }: { children: ReactNode[]; empty: string }) {
  return children.length ? <ul className="agent-mode-records">{children}</ul> : <p className="agent-mode-muted">{empty}</p>;
}

/** Durable Agent-mode task UI. The injected transport is the guarded daemon proxy,
 * and the task store remains the sole owner of execution and observed outcomes. */
export function AgentModeSurface({ language, api, disabled = false }: {
  language: Language; api: AgentModeApi; disabled?: boolean;
}) {
  const text = agentModeCopy(language);
  const transport = useRef(api); transport.current = api;
  const mounted = useRef(true);
  const actionPending = useRef(false);
  const selectedRef = useRef('');
  const heading = useRef<HTMLHeadingElement>(null);
  const [status, setStatus] = useState<AgentModeStatus | null>(null);
  const [detail, setDetail] = useState<AgentModeDetail | null>(null);
  const [selected, setSelected] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [request, setRequest] = useState('');
  const [requirements, setRequirements] = useState('');
  const [stages, setStages] = useState('');
  const [mode, setMode] = useState<'manual' | 'goal' | 'loop'>('manual');
  const [recurring, setRecurring] = useState(false);
  const [model, setModel] = useState('');
  const [turns, setTurns] = useState('8');
  const [concurrent, setConcurrent] = useState('1');
  const [correction, setCorrection] = useState('');
  const [replacementRequirements, setReplacementRequirements] = useState('');
  const [replacementStages, setReplacementStages] = useState('');
  const [workspaceRoots, setWorkspaceRoots] = useState<AgentWorkspaceRoot[]>([]);
  const [workspaceGrants, setWorkspaceGrants] = useState<AgentWorkspaceGrantSummary[]>([]);
  const [workspaceError, setWorkspaceError] = useState<string | null>(null);
  const [snapshotOptIn, setSnapshotOptIn] = useState(false);
  const [snapshotRoot, setSnapshotRoot] = useState('');
  const [snapshotPaths, setSnapshotPaths] = useState('');
  const [renewRoot, setRenewRoot] = useState('');
  const [renewPaths, setRenewPaths] = useState('');
  const [workKey, setWorkKey] = useState('');
  const [workText, setWorkText] = useState('');
  const workId = useRef(crypto.randomUUID());
  const [evidenceRoot, setEvidenceRoot] = useState('');
  const [evidenceFile, setEvidenceFile] = useState('');
  const [evidenceRequirement, setEvidenceRequirement] = useState('');
  const [evidenceProperty, setEvidenceProperty] = useState<'file-exists' | 'file-sha256'>('file-exists');
  const [evidenceExpectedHash, setEvidenceExpectedHash] = useState('');
  const [evidenceMapped, setEvidenceMapped] = useState(false);
  const [lastObservation, setLastObservation] = useState<(AgentArtifactObservation & { taskId: string }) | null>(null);
  const createId = useRef(crypto.randomUUID());
  // A failed transport response may follow a committed mutation. Repeating the
  // same explicit command reuses its receipt identity, never silently replays it.
  const uncertain = useRef(new Map<string, string>());
  const locked = disabled || pending !== null;

  const getDetail = async (taskId: string) => {
    const result = await transport.current.request({ action: 'get', taskId }) as AgentModeDetail;
    if (mounted.current && selectedRef.current === taskId) {
      setDetail(result);
      // A durable command receipt resolves a lost transport response. It does
      // not rerun the operation; a later deliberate action receives a new ID.
      for (const [key, actionId] of uncertain.current) if (result.receipts.some(row => row.id === `action:${actionId}`)) {
        uncertain.current.delete(key);
        const command = JSON.parse(key) as { action: string; input?: { id: string }; work?: { workId: string } };
        if (command.action === 'create' && command.input?.id === createId.current) createId.current = crypto.randomUUID();
        if (command.action === 'enqueue-work' && command.work?.workId === workId.current) workId.current = crypto.randomUUID();
      }
    }
    return result;
  };
  const refreshWorkspaces = async () => {
    if (!transport.current.workspaceRoots || !transport.current.workspaceGrants) return;
    try {
      const [roots, grants] = await Promise.all([transport.current.workspaceRoots(), transport.current.workspaceGrants()]);
      if (!mounted.current) return;
      setWorkspaceRoots(roots); setWorkspaceGrants(grants); setWorkspaceError(null);
      setSnapshotRoot(current => roots.some(row => row.id === current) ? current : roots[0]?.id ?? '');
      setRenewRoot(current => roots.some(row => row.id === current) ? current : roots[0]?.id ?? '');
      setEvidenceRoot(current => roots.some(row => row.id === current) ? current : roots[0]?.id ?? '');
    } catch (cause) { if (mounted.current) setWorkspaceError(errorText(cause)); }
  };
  const refresh = async (preferredId = selectedRef.current) => {
    const result = await transport.current.request({ action: 'status' }) as AgentModeStatus;
    if (!mounted.current) return;
    setStatus(result);
    setModel(current => result.models.some(row => modelChoice(row) === current) ? current : result.models[0] ? modelChoice(result.models[0]) : '');
    const id = result.tasks.some(row => row.id === preferredId) ? preferredId : result.tasks[0]?.id ?? '';
    if (selectedRef.current !== id) setDetail(null);
    selectedRef.current = id; setSelected(id);
    if (id) await getDetail(id); else setDetail(null);
    await refreshWorkspaces();
  };
  const act = async (name: string, operation: () => Promise<void>) => {
    if (actionPending.current || disabled) return;
    actionPending.current = true; setPending(name); setError(null); setNotice(null);
    try { await operation(); }
    catch (cause) {
      const message = errorText(cause);
      if (mounted.current) setError(message === 'The workspace file changed after observation. Inspect its current revision and observe it again before verification.' ? text.evidenceStale : message);
    }
    finally { actionPending.current = false; if (mounted.current) setPending(null); }
  };
  const mutate = async (body: Record<string, unknown>) => {
    const current = body.taskId && detail?.task.id === body.taskId ? detail.task : undefined;
    const command = current ? { ...body, scope: { familyId: current.familyId, generation: current.generation, revision: current.revision } } : body;
    const key = JSON.stringify(command);
    const actionId = uncertain.current.get(key) ?? crypto.randomUUID();
    uncertain.current.set(key, actionId);
    const receipt = await transport.current.request({ ...command, actionId });
    uncertain.current.delete(key);
    return receipt;
  };
  useEffect(() => {
    mounted.current = true;
    if (!disabled) void act('refresh', () => refresh());
    return () => { mounted.current = false; };
    // The injected API is read through a ref: App may recreate its small prop object.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!disabled && !status && !actionPending.current) void act('refresh', () => refresh());
    // A shell transition becoming ready is the only retry trigger here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [disabled]);

  const create = () => void act('create', async () => {
    const maxTurns = Number(turns), maxConcurrent = Number(concurrent);
    const selectedModel = status?.models.find(row => modelChoice(row) === model);
    if (!request.trim() || !lines(requirements).length || lines(requirements).length > 128 || !lines(stages).length || lines(stages).length > 128 || !selectedModel
      || !Number.isSafeInteger(maxTurns) || maxTurns < 1 || maxTurns > 10000
      || !Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32) throw new Error(text.invalid);
    if (mode === 'loop' && !recurring) throw new Error(text.recurringRequired);
    if (selectedModel.provider === 'owned-native' && (selectedModel.available !== true || !selectedModel.admissionId || maxConcurrent !== 1)) throw new Error(text.invalid);
    const rows = requirementRows(requirements);
    const input = {
      id: createId.current, familyId: createId.current, ownerMode: 'agent', mode, recurringAuthorized: mode === 'loop' && recurring,
      originalRequest: request.trim(), requirements: rows, stages: stageRows(stages, rows.map(row => row.id)),
      bounds: { maxConcurrent, maxTurns, maxSpend: null }, execution: selectedModel.provider === 'owned-native'
        ? { provider: 'owned-native', model: selectedModel.id, admissionId: selectedModel.admissionId }
        : { provider: 'local-responses', model: selectedModel.id },
    };
    const workspaceSelection = snapshotOptIn ? selectedWorkspace(snapshotRoot, snapshotPaths) : undefined;
    await mutate({ action: 'create', input, ...(workspaceSelection ? { workspaceSelection } : {}) });
    const created = createId.current; createId.current = crypto.randomUUID();
    if (mounted.current) { setRequest(''); setRequirements(''); setStages(''); setRecurring(false); setSnapshotOptIn(false); setSnapshotPaths(''); }
    await refresh(created);
    if (mounted.current) {
      setNotice(text.saved);
    }
  });
  const control = (action: 'pause' | 'resume' | 'stop') => {
    const taskId = selectedRef.current;
    void act(action, async () => {
      await mutate({ action: 'control', taskId, control: { action } });
      await refresh(taskId); if (mounted.current) setNotice(text.saved);
    });
  };
  const correct = () => {
    const task = detail?.task;
    if (!task || !correction.trim()) return;
    void act('correct', async () => {
      const rows = replacementRequirements.trim() ? requirementRows(replacementRequirements) : task.requirements;
      const replacement = replacementStages.trim() ? stageRows(replacementStages, rows.map(row => row.id))
        : task.stages.map(({ id, instruction, requirementIds, dependsOn }) => ({ id, instruction, requirementIds: replacementRequirements.trim() ? rows.map(row => row.id) : requirementIds, dependsOn }));
      await mutate({ action: 'control', taskId: task.id, control: { action: 'correct', text: correction.trim(), requirements: rows, stages: replacement } });
      await refresh(task.id);
      if (mounted.current) { setCorrection(''); setReplacementRequirements(''); setReplacementStages(''); setNotice(text.saved); }
    });
  };
  const execute = (action: 'step' | 'run') => {
    const taskId = selectedRef.current;
    void act(action, async () => {
      await mutate({ action, taskId, explicitUserAction: true });
      await refresh(taskId); if (mounted.current) setNotice(text.sent);
    });
  };
  const adoptContinuation = (dispatchId: string) => {
    const taskId = selectedRef.current;
    void act(`adopt:${dispatchId}`, async () => {
      await mutate({ action: 'resume-continuation', taskId, dispatchId });
      await refresh(taskId); if (mounted.current) setNotice(text.adoptToolsHint);
    });
  };
  const reconcileTool = (idempotencyKey: string) => {
    const taskId = selectedRef.current;
    if (!detail?.toolOutcomes?.some(row => row.idempotencyKey === idempotencyKey && row.state === 'outcome_unknown')) return;
    void act(`reconcile:${idempotencyKey}`, async () => {
      const result = await mutate({ action: 'reconcile-tool', taskId, idempotencyKey }) as { unchanged: boolean };
      await refresh(taskId);
      if (mounted.current) setNotice(result.unchanged ? text.reconcileUnchanged : text.toolReconciled);
    });
  };
  const enqueueWork = () => {
    const taskId = selectedRef.current;
    void act('enqueue-work', async () => {
      if (!workKey.trim() || workKey.trim().length > 128 || !workText.trim() || /^(?:continue|proceed|go on|keep (?:going|working)|продолжай|продолжить)[.!\s]*$/iu.test(workText.trim())) throw new Error(text.invalidWork);
      await mutate({ action: 'enqueue-work', taskId, work: { workId: workId.current, workKey: workKey.trim(), text: workText.trim() } });
      workId.current = crypto.randomUUID();
      if (mounted.current) { setWorkKey(''); setWorkText(''); }
      await refresh(taskId); if (mounted.current) setNotice(text.saved);
    });
  };
  const loadPacket = (selectedWorkId: string) => {
    const taskId = selectedRef.current;
    void act(`cycle:${selectedWorkId}`, async () => {
      await mutate({ action: 'cycle', taskId, workId: selectedWorkId, explicitUserAction: true });
      await refresh(taskId); if (mounted.current) setNotice(text.cycleLoaded);
    });
  };
  const review = (verify = false) => {
    const task = detail?.task;
    if (!task) return;
    const action = verify ? 'verify' : 'review';
    void act(action, async () => {
      await mutate({ action, taskId: task.id, ...(verify ? { reviewId: task.review?.id } : {}) });
      await refresh(task.id); if (mounted.current) setNotice(text.saved);
    });
  };
  const selectedWorkspace = (rootId: string, pathsText: string) => {
    const paths = lines(pathsText);
    if (!workspaceRoots.some(root => root.id === rootId) || !paths.length || paths.length > 64 || new Set(paths).size !== paths.length
      || paths.some(path => path.startsWith('/') || /^[A-Za-z]:/.test(path) || path.includes('\\') || path.includes('\0') || path.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'))) throw new Error(text.snapshotInvalid);
    return { rootId, paths };
  };
  const renewWorkspace = () => {
    const taskId = selectedRef.current;
    void act('workspace-grant', async () => {
      await mutate({ action: 'workspace-grant', taskId, workspaceSelection: selectedWorkspace(renewRoot, renewPaths) });
      await refresh(taskId); if (mounted.current) { setRenewPaths(''); setNotice(text.saved); }
    });
  };
  const revokeWorkspace = (grantId: string) => void act(`revoke:${grantId}`, async () => {
    if (!transport.current.revokeWorkspaceGrant) throw new Error(text.snapshotUnavailable);
    await transport.current.revokeWorkspaceGrant(grantId);
    await refreshWorkspaces(); if (mounted.current) setNotice(text.saved);
  });
  const observeArtifact = () => {
    const task = detail?.task;
    if (!task) return;
    void act('workspace-evidence', async () => {
      if (!evidenceMapped || !task.requirements.some(row => row.id === evidenceRequirement)
          || (evidenceProperty === 'file-sha256' && !/^[a-f0-9]{64}$/i.test(evidenceExpectedHash.trim()))) throw new Error(text.evidenceInvalid);
      selectedWorkspace(evidenceRoot, evidenceFile.trim());
      if (lines(evidenceFile).length !== 1) throw new Error(text.evidenceInvalid);
      const evidenceSelection = { workspaceId: evidenceRoot, relativePath: evidenceFile.trim(), requirementId: evidenceRequirement, property: evidenceProperty,
        ...(evidenceProperty === 'file-sha256' ? { expectedSha256: evidenceExpectedHash.trim().toLowerCase() } : {}) };
      const result = await mutate({ action: 'workspace-evidence', taskId: task.id, evidenceSelection }) as AgentArtifactObservation;
      if (mounted.current) { setLastObservation({ ...result, taskId: task.id }); setEvidenceMapped(false); }
      await refresh(task.id);
    });
  };
  const selectTask = (id: string) => {
    if (actionPending.current || disabled) return;
    selectedRef.current = id; setSelected(id); setDetail(null);
    setCorrection(''); setReplacementRequirements(''); setReplacementStages(''); setRenewPaths('');
    setWorkKey(''); setWorkText(''); workId.current = crypto.randomUUID();
    void act('get', async () => { await getDetail(id); });
  };
  const task = detail?.task;
  const nativeSelection = status?.models.find(row => modelChoice(row) === model)?.provider === 'owned-native';
  const nativeTurnHint = language === 'ru'
    ? 'Лимит считает ходы, отправленные в Native. Точное число внутренних запросов Codex и их денежная стоимость пока недоступны. В этой версии у Native-задачи один исполнитель.'
    : 'The bound counts turns offered to Native. Exact internal Codex requests and monetary cost are unavailable. This version admits one worker per Native task.';
  useEffect(() => { if (detail?.task.id) heading.current?.focus(); }, [detail?.task.id]);
  useEffect(() => {
    setEvidenceMapped(false);
    setEvidenceRequirement(current => task?.requirements.some(row => row.id === current) ? current : task?.requirements[0]?.id ?? '');
  }, [task?.id, task?.generation, task?.revision]);
  const canExecute = Boolean(task && status?.configured && status.accepting !== false && status.models.some(row => matchesModel(task, row) && row.accepting !== false)
    && !terminal(task) && ['ready', 'running'].includes(task.status) && task.turns < task.bounds.maxTurns
    && task.stages.some(stage => stage.status === 'pending' && (stage.dependsOn ?? []).every(id => task.stages.some(row => row.id === id && row.status === 'completed')))
    && !detail?.dispatches.some(row => ['unknown', 'offered', 'admitted', 'acked'].includes(row.state)));
  const canRunLoop = Boolean(task?.mode === 'loop' && task.status === 'review_required' && status?.configured && status.accepting !== false
    && status.models.some(row => matchesModel(task, row) && row.accepting !== false) && task.turns < task.bounds.maxTurns
    && !detail?.dispatches.some(row => ['unknown', 'offered', 'admitted', 'acked'].includes(row.state)));
  const loopRunActive = Boolean(task?.loopRun && task.loopRun.generation === task.generation && task.loopRun.ownerId === status?.ownerId);
  const taskState = (value: AgentTask) => text.taskStates[value.status] ?? value.status;
  const date = (value: number) => new Intl.DateTimeFormat(language === 'ru' ? 'ru-RU' : 'en-US', { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' }).format(value);
  const modeOptions = [{ value: 'manual', label: text.manual }, { value: 'goal', label: text.goal }, { value: 'loop', label: text.loop }];

  const workspaceControls = Boolean(api.workspaceRoots && api.workspaceGrants && api.revokeWorkspaceGrant);
  const rootOptions = workspaceRoots.length ? workspaceRoots.map(root => ({ value: root.id, label: root.name })) : [{ value: '', label: text.noWorkspace }];
  const workspaceFields = (prefix: string, rootId: string, changeRoot: (value: string) => void, paths: string, changePaths: (value: string) => void) => <>
    <div className="nk-field"><label htmlFor={`${prefix}-snapshot-root`}>{text.workspaceRoot}</label><Select id={`${prefix}-snapshot-root`} value={rootId} options={rootOptions} onChange={changeRoot} disabled={locked || !workspaceRoots.length} /></div>
    <TextArea label={text.snapshotPaths} value={paths} onChange={changePaths} disabled={locked} hint={text.snapshotHint} />
  </>;

  return <Page width="wide" className="agent-mode-surface">
    <SurfaceHeader title={text.title} subtitle={text.subtitle} actions={<Button disabled={locked} busy={pending === 'refresh'} onClick={() => void act('refresh', () => refresh())}>{text.refresh}</Button>} />
    {api.nativeAccounts ? <NativeAccountsPanel language={language} api={api.nativeAccounts} disabled={disabled} /> : null}
    {error ? <Notice tone="error" title={text.error}>{error} {text.readAfterError}</Notice> : null}
    {notice ? <Notice>{notice}</Notice> : null}
    {status?.accepting === false ? <Notice tone="warning">{text.admissionHold}</Notice> : null}
    {!status && pending ? <p role="status">{text.loading}</p> : null}
    {status ? <>
      <Notice tone={status.configured ? 'info' : 'warning'} title={status.configured ? text.configured : text.unconfigured}>
        {status.capabilities.tools ? text.toolsHint : text.textOnly}
      </Notice>
      <div className="agent-mode-capabilities" aria-label={text.capability}>
        {(['tools', 'workspace', 'autoSchedule', 'observedEvidence'] as const).map(key => <Badge key={key}>{text[key]}: {status.capabilities[key] ? text.available : text.unavailable}</Badge>)}
      </div>
    </> : null}
    <Panel title={text.newTask}>
      <form className="agent-mode-form" onSubmit={event => { event.preventDefault(); if (!locked) create(); }}>
        <TextArea label={text.request} value={request} onChange={setRequest} disabled={locked} required rows={3} />
        <div className="agent-mode-columns">
          <TextArea label={text.requirements} value={requirements} onChange={setRequirements} disabled={locked} required />
          <TextArea label={text.stages} value={stages} onChange={setStages} disabled={locked} required hint={text.stagesHint} />
        </div>
        <div className="agent-mode-columns">
          <div className="nk-field"><label htmlFor="agent-mode-select">{text.mode}</label>
            <Select id="agent-mode-select" value={mode} options={modeOptions} onChange={value => { setMode(value as typeof mode); setRecurring(false); }} disabled={locked} />
            <p className="nk-field__hint">{text.modeHint}</p>
          </div>
          <div className="nk-field"><label htmlFor="agent-mode-model">{text.model}</label>
            <Select id="agent-mode-model" value={model} options={status?.models.length ? status.models.map(row => ({ value: modelChoice(row), label: `${row.label || row.id}${row.provider === 'owned-native' ? ' · Native' : ''}` })) : [{ value: '', label: text.noModels }]}
              onChange={value => { setModel(value); if (status?.models.find(row => modelChoice(row) === value)?.provider === 'owned-native') setConcurrent('1'); }} disabled={locked || !status?.models.length} />
          </div>
          <TextField type="number" label={text.turns} value={turns} onChange={event => setTurns(event.target.value)} min={1} max={10000} step={1} required disabled={locked} />
          <TextField type="number" label={text.concurrent} value={concurrent} onChange={event => setConcurrent(event.target.value)} min={1} max={nativeSelection ? 1 : 32} step={1} required disabled={locked || nativeSelection} />
        </div>
        {nativeSelection ? <p className="agent-mode-muted">{nativeTurnHint}</p> : null}
        {mode === 'loop' ? <Checkbox label={text.recurrence} checked={recurring} onChange={setRecurring} disabled={locked} /> : null}
        <Checkbox label={text.snapshotOptIn} checked={snapshotOptIn} onChange={setSnapshotOptIn} disabled={locked || !workspaceControls || !workspaceRoots.length} />
        {snapshotOptIn ? workspaceFields('create', snapshotRoot, setSnapshotRoot, snapshotPaths, setSnapshotPaths) : <p className="agent-mode-muted">{workspaceControls ? (workspaceRoots.length ? text.snapshotHint : text.noWorkspace) : text.snapshotUnavailable}</p>}
        {workspaceError ? <Notice tone="warning">{workspaceError}</Notice> : null}
        <p className="agent-mode-muted">{text.money}</p>
        <div><Button type="submit" variant="primary" busy={pending === 'create'} disabled={locked || !status?.configured || !request.trim() || !requirements.trim() || !stages.trim() || (mode === 'loop' && !recurring)}>{text.create}</Button></div>
      </form>
    </Panel>
    {workspaceControls ? <Panel title={text.grants}><RecordList empty={text.none}>{workspaceGrants.map(row => <li key={row.id}>
      <Badge tone={row.state === 'active' ? 'success' : 'neutral'}>{row.state === 'active' ? text.active : text.revoked}</Badge> <code>{row.taskId}</code> · {text.generation}: {row.generation}
      <p>{workspaceRoots.find(root => root.id === row.workspaceId)?.name ?? row.workspaceId}</p><p className="agent-mode-prose">{row.paths.join('\n')}</p>
      {row.state === 'active' ? <Button size="sm" disabled={locked} busy={pending === `revoke:${row.id}`} onClick={() => revokeWorkspace(row.id)}>{text.revoke}</Button> : null}
    </li>)}</RecordList></Panel> : null}
    <div className="agent-mode-workspace">
      <Panel title={text.tasks} className="agent-mode-task-list">
        {status?.truncated ? <p className="agent-mode-muted">{text.truncated} ({status.tasks.length}/{status.total})</p> : null}
        {!status?.tasks.length ? <EmptyState icon="logs" title={text.empty}>{text.emptyBody}</EmptyState>
          : <ul>{status.tasks.map(row => <li key={row.id}><button className="agent-mode-task" type="button" disabled={locked} aria-current={selected === row.id ? 'true' : undefined} onClick={() => selectTask(row.id)}>
            <strong>{row.originalRequest}</strong><span>{taskState(row)} · {row.mode} · {row.turns}/{row.bounds.maxTurns}</span><code>{row.id}</code>
          </button></li>)}</ul>}
      </Panel>
      <div className="agent-mode-detail" aria-busy={pending === 'get' || undefined}>
        {!task ? <p className="agent-mode-muted">{text.noSelection}</p> : <>
          <Panel>
            <h2 tabIndex={-1} ref={heading}>{text.open}</h2>
            <div className="agent-mode-actions">
              <Badge>{taskState(task)}</Badge>
              <Button size="sm" disabled={locked || terminal(task) || task.status === 'paused'} busy={pending === 'pause'} onClick={() => control('pause')}>{text.pause}</Button>
              <Button size="sm" disabled={locked || terminal(task) || !['paused', 'awaiting_input'].includes(task.status)} busy={pending === 'resume'} onClick={() => control('resume')}>{text.resume}</Button>
              <Button size="sm" variant="danger" disabled={locked || terminal(task)} busy={pending === 'stop'} onClick={() => control('stop')}>{text.stop}</Button>
              <Button size="sm" variant="primary" disabled={locked || !canExecute}
                busy={pending === 'step'} onClick={() => execute('step')}>{text.step}</Button>
              {task.mode !== 'manual' ? <Button size="sm" disabled={locked || (!canExecute && !canRunLoop) || !status?.capabilities.autoSchedule} busy={pending === 'run'} onClick={() => execute('run')}>{task.mode === 'loop' ? text.loopRun : text.run}</Button> : null}
            </div>
            <p className="agent-mode-muted">{text.stepHint}</p>
            {task.execution?.provider === 'owned-native' ? <p className="agent-mode-muted">{nativeTurnHint}</p> : null}
            {task.bounds.maxSpend === null ? <p className="agent-mode-muted">{text.money}</p> : null}
            {detail.coverage && Object.values(detail.coverage).some(row => row.truncated) ? <Notice tone="warning">{text.truncated}</Notice> : null}
            <dl className="agent-mode-meta">
              <div><dt>{text.taskId}</dt><dd><code>{task.id}</code></dd></div>
              <div><dt>{text.model}</dt><dd>{task.execution?.model ?? text.noModels}</dd></div>
              <div><dt>{text.generation} / {text.revision}</dt><dd>{task.generation} / {task.revision}</dd></div>
              <div><dt>{text.usedTurns}</dt><dd>{task.turns} / {task.bounds.maxTurns}</dd></div>
              <div><dt>{text.concurrent}</dt><dd>{task.bounds.maxConcurrent}</dd></div>
              <div><dt>{text.spent}</dt><dd>{task.spent}</dd></div>
              <div><dt>{text.unpriced}</dt><dd>{task.unpricedTurns}</dd></div>
              <div><dt>{text.updated}</dt><dd>{date(task.updatedAt)}</dd></div>
              {task.reason ? <div><dt>{text.reason}</dt><dd>{task.reason}</dd></div> : null}
            </dl>
            <h3>{text.original}</h3><p className="agent-mode-prose">{task.originalRequest}</p>
            <h3>{text.requirements.split(' — ')[0]}</h3>
            <RecordList empty={text.none}>{task.requirements.map(row => <li key={row.id}><code>{row.id}</code> {row.text}</li>)}</RecordList>
            <h3>{text.stages.split(' — ')[0]}</h3>
            <RecordList empty={text.none}>{task.stages.map(row => <li key={row.id}><Badge>{text.stageStates[row.status] ?? row.status}</Badge> <strong>{row.id}</strong><p className="agent-mode-prose">{row.instruction}</p><small>{row.requirementIds.join(', ')}</small></li>)}</RecordList>
          </Panel>
          {task.execution?.provider === 'owned-native' && api.nativeHistory ? <OwnedNativeHistoryPanel language={language} task={task} api={api.nativeHistory} disabled={disabled} /> : null}
          {task.mode === 'loop' ? <Panel title={text.loopMailbox}>
            <p className="agent-mode-muted">{text.loopSourceHint}</p>
            <Notice tone={loopRunActive ? 'info' : 'warning'} title={task.reason === 'waiting_for_mailbox_work' ? text.waitingMailbox : undefined}>{loopRunActive ? text.loopRunActive : text.loopRunInactive}</Notice>
            <form className="agent-mode-form" onSubmit={event => { event.preventDefault(); if (!locked) enqueueWork(); }}>
              <TextField label={text.workKey} value={workKey} onChange={event => setWorkKey(event.target.value)} maxLength={128} required disabled={locked || terminal(task)} />
              <TextArea label={text.workText} value={workText} onChange={setWorkText} required disabled={locked || terminal(task)} />
              <div><Button type="submit" disabled={locked || terminal(task) || !workKey.trim() || !workText.trim()} busy={pending === 'enqueue-work'}>{text.enqueueWork}</Button></div>
            </form>
            <RecordList empty={text.none}>{(detail.workPackets ?? []).map(row => <li key={row.workId}><Badge>{row.state === 'pending' ? text.packetPending : row.state === 'claimed' ? text.packetClaimed : text.packetHeld}</Badge> <strong>{row.workKey}</strong><p className="agent-mode-prose">{row.text}</p><small>{text.generation}: {row.enqueuedGeneration} · <code>{row.workId}</code></small>
              {row.state !== 'claimed' && task.status === 'review_required' ? <div><Button size="sm" disabled={locked || terminal(task) || task.turns >= task.bounds.maxTurns || detail.dispatches.some(dispatch => ['unknown', 'offered', 'admitted', 'acked'].includes(dispatch.state))} busy={pending === `cycle:${row.workId}`} onClick={() => loadPacket(row.workId)}>{text.loadPacket}</Button></div> : null}</li>)}</RecordList>
          </Panel> : null}
          <Panel title={text.grants}>
            <p className="agent-mode-muted">{text.snapshotHint} {text.snapshotGeneration}</p>
            <RecordList empty={text.none}>{workspaceGrants.filter(row => row.taskId === task.id).map(row => <li key={row.id}><Badge tone={row.state === 'active' ? 'success' : 'neutral'}>{row.state === 'active' ? text.active : text.revoked}</Badge> {text.generation}: {row.generation}<p>{workspaceRoots.find(root => root.id === row.workspaceId)?.name ?? row.workspaceId}</p><p className="agent-mode-prose">{row.paths.join('\n')}</p></li>)}</RecordList>
            {workspaceControls && !terminal(task) ? <form className="agent-mode-form" onSubmit={event => { event.preventDefault(); if (!locked) renewWorkspace(); }}>
              {workspaceFields('renew', renewRoot, setRenewRoot, renewPaths, setRenewPaths)}
              <div><Button type="submit" disabled={locked || !renewRoot || !renewPaths.trim() || detail.dispatches.some(row => ['admitted', 'offered', 'acked', 'unknown'].includes(row.state))} busy={pending === 'workspace-grant'}>{text.renewSnapshot}</Button></div>
            </form> : null}
          </Panel>
          <Panel title={text.snapshotReceipts}>
            <RecordList empty={text.none}>{(detail.snapshotReceipts ?? []).map(row => <li key={row.dispatchId}><code>{row.dispatchId}</code> · {row.state}
              {row.failure ? <p>{row.failure}</p> : null}{row.receipt ? <><p>{text.generation}: {row.receipt.generation} · {row.receipt.totalBytes} bytes</p><code>{row.receipt.snapshotId}</code><ul>{row.receipt.files.map(file => <li key={file.path}>{file.path} · {file.size} bytes · {file.revision ?? 'missing'}</li>)}</ul></> : null}</li>)}</RecordList>
          </Panel>
          <Panel title={text.corrections}>
            <RecordList empty={text.none}>{task.corrections.map(row => <li key={row.revision}>{text.revision} {row.revision}: {row.text}</li>)}</RecordList>
            <form className="agent-mode-form" onSubmit={event => { event.preventDefault(); if (!locked) correct(); }}>
              <TextArea label={text.correction} value={correction} onChange={setCorrection} disabled={locked || terminal(task)} required hint={text.correctionHint} />
              <TextArea label={text.correctionRequirements} value={replacementRequirements} onChange={setReplacementRequirements} disabled={locked || terminal(task)} />
              <TextArea label={text.correctionStages} value={replacementStages} onChange={setReplacementStages} disabled={locked || terminal(task)} />
              <div><Button type="submit" disabled={locked || terminal(task) || !correction.trim()} busy={pending === 'correct'}>{text.correct}</Button></div>
            </form>
          </Panel>
          <Panel title={text.workers}>
            <RecordList empty={text.none}>{detail.workers.map(row => <li key={row.id}><strong>{row.name}</strong> · {row.state}<br /><code>{row.id}</code>{row.dispatchId ? <p><code>{row.dispatchId}</code></p> : null}</li>)}</RecordList>
          </Panel>
          <Panel title={text.mailbox}>
            <RecordList empty={text.none}>{detail.messages.map(row => <li key={row.id}><strong>{row.sender} → {row.recipient}</strong> · {row.state}<p className="agent-mode-prose">{row.text}</p><small>{text.revision} {row.revision} · {date(row.createdAt)}</small></li>)}</RecordList>
          </Panel>
          <Panel title={text.dispatches}>
            <RecordList empty={text.none}>{detail.dispatches.map(row => <li key={row.id}><code>{row.id}</code> · {row.state} · {row.stageId}
              {row.result ? <><p className="agent-mode-prose">{row.result.summary}</p><small>{row.result.outcome} · <code>{row.result.receiptId}</code></small></> : null}
              {row.result?.continuation && row.generation !== task.generation && task.stages.some(stage => stage.continuationFrom === row.id && stage.continuationGeneration !== task.generation) ? <div><p className="agent-mode-muted">{text.adoptToolsHint}</p><Button size="sm" disabled={locked || terminal(task)} busy={pending === `adopt:${row.id}`} onClick={() => adoptContinuation(row.id)}>{text.adoptTools}</Button></div> : null}</li>)}</RecordList>
          </Panel>
          <Panel title={text.toolReceipts}>
            <p className="agent-mode-muted">{text.reconcileToolHint}</p>
            <RecordList empty={text.none}>{(detail.toolOutcomes ?? []).map(row => <li key={row.idempotencyKey}><strong>{row.tool}</strong> · {row.state}
              {row.state === 'outcome_unknown' ? <p><Badge tone="warning">{text.originalUnknown}</Badge></p> : null}<p><code>{row.idempotencyKey}</code></p><small>{text.generation}: {row.scope.generation} · {row.scope.toolCallId}</small>{row.reason ? <p>{row.reason}</p> : null}
              {row.state === 'outcome_unknown' && !(detail.effectiveToolOutcomes ?? []).some(effective => effective.idempotencyKey === row.idempotencyKey && effective.state !== 'outcome_unknown') && !(detail.toolReconciliations ?? []).some(event => event.idempotencyKey === row.idempotencyKey) ? <div><Button size="sm" disabled={locked} busy={pending === `reconcile:${row.idempotencyKey}`} onClick={() => reconcileTool(row.idempotencyKey)}>{text.reconcileTool}</Button></div> : null}
            </li>)}</RecordList>
            {(detail.toolReconciliations ?? []).length ? <><h3>{text.lateToolOutcome}</h3><RecordList empty={text.none}>{(detail.toolReconciliations ?? []).map(event => <li key={event.id}>
              <Badge tone={event.outcome.state === 'completed' ? 'success' : 'error'}>{event.outcome.state}</Badge> <strong>{event.outcome.tool}</strong>
              {event.late ? <p>{text.lateReceipt}</p> : null}<p><code>{event.idempotencyKey}</code></p><small>{text.generation}: {event.originalScope.generation} · {text.observedGeneration}: {event.observedTaskGeneration} · {date(event.createdAt)}</small><p><code>{event.sourceDispatchId}</code> · <code>{event.id}</code></p>
            </li>)}</RecordList></> : null}
          </Panel>
          <Panel title={text.evidence}>
            <RecordList empty={text.none}>{task.evidence.map(row => <li key={row.id}><Badge tone={row.outcome === 'passed' ? 'success' : row.outcome === 'failed' ? 'error' : 'warning'}>{row.outcome}</Badge> <strong>{row.requirementId}</strong>
              <p className="agent-mode-prose">{row.subject} · {row.property}</p><small>{row.observer} · {row.subjectRevision} · <code>{row.sourceEventId}</code></small></li>)}</RecordList>
            <h3>{text.artifactEvidence}</h3>
            <p className="agent-mode-muted">{text.evidenceHint}</p>
            <form className="agent-mode-form" onSubmit={event => { event.preventDefault(); if (!locked) observeArtifact(); }}>
              <div className="nk-field"><label htmlFor="agent-artifact-root">{text.workspaceRoot}</label><Select id="agent-artifact-root" value={evidenceRoot} options={rootOptions} onChange={value => { setEvidenceRoot(value); setEvidenceMapped(false); }} disabled={locked || !workspaceRoots.length} /></div>
              <TextField label={text.evidenceFile} value={evidenceFile} onChange={event => { setEvidenceFile(event.target.value); setEvidenceMapped(false); }} maxLength={4096} required disabled={locked || terminal(task)} />
              <div className="nk-field"><label htmlFor="agent-artifact-requirement">{text.evidenceRequirement}</label><Select id="agent-artifact-requirement" value={evidenceRequirement} options={task.requirements.map(row => ({ value: row.id, label: `${row.id}: ${row.text}` }))} onChange={value => { setEvidenceRequirement(value); setEvidenceMapped(false); }} disabled={locked || terminal(task)} /></div>
              <div className="nk-field"><label htmlFor="agent-artifact-property">{text.evidenceProperty}</label><Select id="agent-artifact-property" value={evidenceProperty} options={[{ value: 'file-exists', label: text.evidenceExists }, { value: 'file-sha256', label: text.evidenceSha }]} onChange={value => { setEvidenceProperty(value as typeof evidenceProperty); setEvidenceMapped(false); }} disabled={locked || terminal(task)} /></div>
              {evidenceProperty === 'file-sha256' ? <TextField label={text.evidenceExpectedHash} value={evidenceExpectedHash} onChange={event => { setEvidenceExpectedHash(event.target.value); setEvidenceMapped(false); }} maxLength={64} pattern="[a-fA-F0-9]{64}" required disabled={locked || terminal(task)} /> : null}
              <Checkbox label={text.evidenceMapping} checked={evidenceMapped} onChange={setEvidenceMapped} disabled={locked || terminal(task)} />
              <div className="agent-mode-actions"><Button type="submit" disabled={locked || terminal(task) || !status?.capabilities.observedEvidence || !evidenceRoot || !evidenceFile.trim() || !evidenceRequirement || !evidenceMapped || (evidenceProperty === 'file-sha256' && !/^[a-f0-9]{64}$/i.test(evidenceExpectedHash.trim()))} busy={pending === 'workspace-evidence'}>{text.evidenceObserve}</Button>
                <Button disabled={locked || terminal(task)} onClick={() => {
                  // This prepares a new explicit read-only observation identity;
                  // it neither recaptures a failed attempt nor sends anything.
                  for (const key of uncertain.current.keys()) {
                    const command = JSON.parse(key) as { action: string; taskId?: string };
                    if (command.action === 'workspace-evidence' && command.taskId === task.id) uncertain.current.delete(key);
                  }
                  setEvidenceMapped(false);
                }}>{text.evidenceNewAttempt}</Button>
              </div>
            </form>
            {lastObservation?.taskId === task.id && lastObservation.evidence ? <dl className="agent-mode-meta">
              <div><dt>{text.evidenceProperty}</dt><dd>{lastObservation.evidence.property} · {lastObservation.evidence.outcome}</dd></div>
              <div><dt>{text.evidenceTime}</dt><dd>{lastObservation.reference?.observedAt ?? text.unavailable}</dd></div>
              <div><dt>{text.evidenceHash}</dt><dd><code>{lastObservation.reference?.actualSha256 ?? text.unavailable}</code></dd></div>
            </dl> : null}
          </Panel>
          <Panel title={text.review} actions={<div className="agent-mode-actions">
            <Button size="sm" disabled={locked || terminal(task)} busy={pending === 'review'} onClick={() => review()}>{text.reviewAction}</Button>
            {task.review ? <Button size="sm" disabled={locked || terminal(task) || !task.review.completeInput || task.review.findings.length > 0 || task.review.coverage.some(row => !row.evidenceIds.length) || task.review.generation !== task.generation || task.review.taskRevision !== task.revision || task.review.evidenceRevision !== task.evidenceRevision} busy={pending === 'verify'} onClick={() => review(true)}>{text.verify}</Button> : null}
          </div>}>
            {!task.review ? <p className="agent-mode-muted">{text.noReview}</p> : <>
              <h3>{text.recommendation}</h3><p className="agent-mode-prose">{task.review.recommendation}</p>
              {!task.review.completeInput ? <Notice tone="warning">{text.incomplete}</Notice> : null}
              <h3>{text.findings}</h3><RecordList empty={text.none}>{task.review.findings.map((finding, index) => <li key={index}>{finding}</li>)}</RecordList>
              <h3>{text.coverage}</h3><RecordList empty={text.none}>{task.review.coverage.map(row => <li key={row.requirementId}><strong>{row.requirementId}</strong>: {row.evidenceIds.join(', ') || text.none}</li>)}</RecordList>
              <small>{text.generation}: {task.review.generation} · {text.revision}: {task.review.taskRevision} · {text.evidence}: {task.review.evidenceRevision}</small>
            </>}
          </Panel>
          <Panel title={text.receipts}>
            <RecordList empty={text.none}>{detail.receipts.map(row => <li key={row.id}><details><summary>{row.kind} · <code>{row.id}</code></summary><pre>{JSON.stringify(row.body, null, 2)}</pre></details></li>)}</RecordList>
          </Panel>
        </>}
      </div>
    </div>
  </Page>;
}
