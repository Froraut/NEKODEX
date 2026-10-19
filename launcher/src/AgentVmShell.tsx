import { useEffect, useRef, useState } from 'react';
import { AgentVmExport } from './AgentVmExport';
import { Badge, BadgeRow, Button, Checkbox, Notice, Panel, PanelStack } from './design';
import './surfaces/agent-vm.css';
import type {
  AgentToolsApi,
  AgentToolsStatus,
  AgentVmEnvironmentReview,
  ToolScope,
} from './agent-tools-types';
/** Preparing an image, attaching a directory and approving one saved tool call are separate actions. */
export function AgentVmShell({
  api,
  status,
  scope,
  locked,
  choose,
  act,
  onChanged,
}: {
  api: AgentToolsApi;
  status: AgentToolsStatus | null;
  scope?: ToolScope;
  locked: boolean;
  choose: (en: string, ru: string) => string;
  act: (operation: () => Promise<void>) => Promise<void>;
  onChanged: () => Promise<void>;
}) {
  const [review, setReview] = useState<AgentVmEnvironmentReview | null>(null);
  const [prepareAck, setPrepareAck] = useState('');
  const [preparation, setPreparation] = useState<string | null>(null);
  const [root, setRoot] = useState('');
  const [attachAck, setAttachAck] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [control, setControl] = useState<string | null>(null);
  const [observed, setObserved] = useState<{
    key: string;
    source: AgentToolsStatus | null;
    vmEnvironment: AgentToolsStatus['vmEnvironment'];
    vmTools: AgentToolsStatus['vmTools'];
  } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const refreshingRef = useRef(false);
  const inFlight = useRef(false),
    controlInFlight = useRef(false),
    alive = useRef(true);
  const context = useRef('');
  context.current = JSON.stringify([scope?.taskId, scope?.generation]);
  const fresh = observed?.key === context.current && observed.source === status ? observed : null;
  const environment = fresh ? fresh.vmEnvironment : status?.vmEnvironment,
    tools = fresh ? fresh.vmTools : status?.vmTools;
  const effectiveStatus =
    fresh && status ? { ...status, vmEnvironment: environment, vmTools: tools } : status;
  const bindings =
    tools?.bindings.filter((row) => row.taskId === scope?.taskId && row.generation === scope?.generation) ??
    [];
  const operations =
    tools?.activeOperations.filter(
      (row) => row.ownerHeld || (row.taskId === scope?.taskId && row.generation === scope?.generation),
    ) ?? [];
  const ownerHeld = tools?.activeOperations.some((row) => row.ownerHeld) ?? false;
  const preparing = Boolean(preparation) || environment?.review?.state === 'preparing';
  const disabled = locked || busy;
  const available = environment?.supported === true;
  const attachAvailable =
    environment?.prepared === true && tools?.available === true && !tools.closed && !ownerHeld;
  const reviewKey = review ? JSON.stringify([review.actionId, review.reviewDigest]) : '';
  const attachmentKey = JSON.stringify([scope?.taskId, scope?.generation, root, environment?.runtimeDigest]);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setRoot('');
    setAttachAck('');
  }, [scope?.taskId, scope?.generation]);
  useEffect(() => {
    setAttachAck('');
  }, [root, environment?.runtimeDigest]);
  useEffect(() => {
    if (environment?.prepared) {
      setPreparation(null);
      setPrepareAck('');
    }
  }, [environment?.prepared, environment?.runtimeDigest]);
  useEffect(() => {
    const saved = environment?.review;
    if (saved && saved.actionId === preparation && saved.state === 'failed') {
      setPreparation(null);
      setReview(saved);
      setPrepareAck('');
      setNotice(
        saved.reason ||
          choose(
            'Preparation failed. Start a new explicit review to try again.',
            'Подготовка завершилась ошибкой. Для новой попытки выполните новый явный просмотр.',
          ),
      );
    }
  }, [environment?.review, preparation]);
  async function refreshVmState() {
    if (refreshingRef.current) return;
    refreshingRef.current = true;
    setRefreshing(true);
    const captured = context.current,
      source = status,
      target = scope ? { ...scope } : undefined;
    try {
      const value = (await api.request({ action: 'vmStatus', ...(target ? { scope: target } : {}) })) as Pick<
        AgentToolsStatus,
        'vmEnvironment' | 'vmTools'
      >;
      if (alive.current && captured === context.current) {
        setObserved({ key: captured, source, vmEnvironment: value.vmEnvironment, vmTools: value.vmTools });
        setNotice('');
      }
    } catch (cause) {
      if (alive.current && captured === context.current)
        setNotice(
          cause instanceof Error
            ? cause.message
            : choose(
                'VM state is unavailable. Inspect again without resending the operation.',
                'Состояние VM недоступно. Проверьте его снова без повторной отправки действия.',
              ),
        );
    } finally {
      refreshingRef.current = false;
      if (alive.current) setRefreshing(false);
    }
  }
  async function perform(work: () => Promise<void>) {
    if (locked || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setNotice('');
    try {
      await act(async () => {
        try {
          await work();
        } finally {
          await onChanged().catch(() => {});
        }
      });
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  // Stopping/revoking stays usable while a tool call owns the ordinary UI action lock.
  async function controlOperation(
    action: 'revokeVmWorkspace' | 'cancelVmOperation' | 'reconcileVmOperation',
    id: string,
    operationScope?: ToolScope,
  ) {
    const selectedScope = operationScope ?? scope;
    if (!selectedScope || controlInFlight.current) return;
    const target = { ...selectedScope },
      captured = context.current;
    controlInFlight.current = true;
    setControl(id);
    setNotice('');
    try {
      await api.request({
        action,
        scope: target,
        ...(action === 'revokeVmWorkspace' ? { bindingId: id } : { operationId: id }),
        explicitUserAction: true,
      });
    } catch (cause) {
      if (alive.current && captured === context.current)
        setNotice(
          cause instanceof Error
            ? cause.message
            : choose(
                'The exact saved operation needs inspection.',
                'Нужно проверить точное сохранённое действие.',
              ),
        );
    } finally {
      await onChanged().catch(() => {});
      controlInFlight.current = false;
      if (alive.current) setControl(null);
    }
  }
  function environmentPreparation() {
    return (
      !environment?.prepared && (
        <>
          <Button
            className="agent-vm-action"
            variant="secondary"
            disabled={disabled || !available || preparing || ownerHeld}
            onClick={() =>
              void perform(async () => {
                setReview(null);
                setPrepareAck('');
                const value = (await api.request({
                  action: 'reviewVmEnvironment',
                  actionId: crypto.randomUUID(),
                  explicitUserAction: true,
                })) as AgentVmEnvironmentReview;
                if (alive.current) setReview(value);
              })
            }
          >
            {choose('Review local VM environment', 'Просмотреть локальное VM-окружение')}
          </Button>
          {review && (
            <div className="agent-vm-review agent-vm-stack">
              <details className="agent-vm-details">
                <summary>{choose('Reviewed image identity', 'Идентификаторы просмотренного образа')}</summary>
                <dl className="agent-vm-metadata">
                  <dt>{choose('Helper SHA-256', 'SHA-256 helper')}</dt>
                  <dd>
                    <code>{review.helperSha256}</code>
                  </dd>
                  <dt>{choose('Guest manifest SHA-256', 'SHA-256 манифеста гостя')}</dt>
                  <dd>
                    <code>{review.guestManifestSha256}</code>
                  </dd>
                </dl>
              </details>
              <Checkbox
                disabled={disabled || preparing || ownerHeld || review.state !== 'reviewed'}
                checked={prepareAck === reviewKey}
                onChange={(checked) => setPrepareAck(checked ? reviewKey : '')}
                label={choose(
                  'Prepare this reviewed local environment. Do not start a VM, attach a folder or run a command.',
                  'Подготовить просмотренное локальное окружение. VM не запускать, папку не прикреплять и команды не выполнять.',
                )}
              />
              <Button
                className="agent-vm-action"
                disabled={
                  disabled ||
                  !available ||
                  preparing ||
                  ownerHeld ||
                  prepareAck !== reviewKey ||
                  review.state !== 'reviewed'
                }
                onClick={() =>
                  void perform(async () => {
                    setPreparation(review.actionId);
                    setPrepareAck('');
                    await api.request({
                      action: 'prepareVmEnvironment',
                      actionId: review.actionId,
                      reviewDigest: review.reviewDigest,
                      explicitUserAction: true,
                    });
                  })
                }
              >
                {choose('Prepare reviewed environment', 'Подготовить просмотренное окружение')}
              </Button>
            </div>
          )}
          {preparation && (
            <Notice>
              {choose(
                'Preparation was submitted. Inspect its current status before another action; this does not resend preparation.',
                'Подготовка отправлена. Проверьте её текущее состояние перед следующим действием; подготовка повторно не отправляется.',
              )}{' '}
              <code>{preparation}</code>
            </Notice>
          )}
        </>
      )
    );
  }
  function workspaceBindings() {
    return (
      bindings.length > 0 && (
        <ul className="agent-tools-records agent-vm-records">
          {bindings.map((binding) => (
            <li key={binding.id}>
              <strong>{binding.label}</strong>
              <small>
                {choose('Attached to current task generation', 'Прикреплено к текущему поколению задачи')}
              </small>
              <Button
                className="agent-vm-action agent-vm-action--small"
                size="sm"
                variant="secondary"
                disabled={control !== null}
                busy={control === binding.id}
                onClick={() => void controlOperation('revokeVmWorkspace', binding.id)}
              >
                {choose('Revoke workspace access', 'Отозвать доступ к папке')}
              </Button>
            </li>
          ))}
        </ul>
      )
    );
  }
  function activeOperations() {
    return (
      operations.length > 0 && (
        <ul className="agent-tools-records agent-vm-records">
          {operations.map((operation) => (
            <li key={operation.operationId}>
              <strong>
                {operation.ownerHeld
                  ? choose('VM owner retained', 'Владелец VM удерживается')
                  : choose('VM operation', 'VM-операция')}
              </strong>
              <code>{operation.operationId}</code>
              <small>
                {operation.taskId} · gen {operation.generation}
              </small>
              <div className="agent-vm-actions">
                <Button
                  className="agent-vm-action agent-vm-action--small"
                  size="sm"
                  disabled={control !== null}
                  busy={control === operation.operationId}
                  onClick={() =>
                    void controlOperation('cancelVmOperation', operation.operationId, {
                      taskId: operation.taskId,
                      generation: operation.generation,
                      toolCallId: 'vm-owner-administration',
                    })
                  }
                >
                  {choose('Cancel this operation', 'Отменить эту операцию')}
                </Button>
                <Button
                  className="agent-vm-action agent-vm-action--small"
                  size="sm"
                  variant="secondary"
                  disabled={control !== null}
                  onClick={() =>
                    void controlOperation('reconcileVmOperation', operation.operationId, {
                      taskId: operation.taskId,
                      generation: operation.generation,
                      toolCallId: 'vm-owner-administration',
                    })
                  }
                >
                  {choose('Inspect exact saved outcome', 'Проверить точный сохранённый исход')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )
    );
  }
  return (
    <PanelStack className="agent-vm-surface">
      <Panel title={choose('Isolated Linux shell', 'Изолированный Linux shell')}>
        <div className="agent-vm-stack">
          <BadgeRow>
            <Badge tone={attachAvailable ? 'success' : 'neutral'}>
              {environment?.prepared
                ? choose('Environment prepared', 'Окружение подготовлено')
                : choose('Preparation required', 'Нужна подготовка')}
            </Badge>
            <span>
              {choose(
                '2 CPUs · 2 GB RAM · offline · no shared host folders',
                '2 CPU · 2 ГБ RAM · без сети · без общих папок с macOS',
              )}
            </span>
          </BadgeRow>
          <p>
            {choose(
              'Run external Linux programs and pipelines in a separate virtual machine. This is a Linux environment; macOS applications, Xcode and Darwin binaries do not run here.',
              'Запускайте внешние Linux-программы и pipelines в отдельной виртуальной машине. Это Linux-среда: приложения macOS, Xcode и Darwin-бинарные файлы здесь не запускаются.',
            )}
          </p>
          {!available && (
            <Notice tone="warning">
              {environment?.reason ||
                choose(
                  'This environment is unavailable on this host. Saved task records remain visible.',
                  'Окружение недоступно на этом компьютере. Сохранённые записи задач доступны для просмотра.',
                )}
            </Notice>
          )}
          {notice && <Notice tone="warning">{notice}</Notice>}
          {ownerHeld && (
            <Notice tone="warning">
              {choose(
                'A VM operation still owns the environment. Cancel or inspect that exact operation before another run; an uncertain result is never replayed automatically.',
                'Одна из VM-операций ещё удерживает окружение. Отмените или проверьте именно её перед новым запуском; действие с неопределённым исходом автоматически не повторяется.',
              )}
            </Notice>
          )}
          {environmentPreparation()}
          <Button
            className="agent-vm-action"
            variant="secondary"
            disabled={refreshing}
            busy={refreshing}
            onClick={() => void refreshVmState()}
          >
            {choose('Refresh VM state', 'Обновить состояние VM')}
          </Button>
          {locked && (
            <p className="agent-tools-muted">
              {choose(
                'A tool call may still be running. Refresh VM state here to inspect its owner and cancel that exact operation.',
                'Вызов инструмента может ещё выполняться. Обновите состояние VM здесь, чтобы увидеть владельца и отменить именно эту операцию.',
              )}
            </p>
          )}
          <hr className="agent-vm-divider" />
          {!scope && (
            <p className="agent-tools-muted">
              {choose(
                'Select an Agent task above to attach its workspace.',
                'Выберите Agent-задачу выше, чтобы прикрепить её рабочую папку.',
              )}
            </p>
          )}
          <p>
            {choose(
              'Choose the folder from which explicitly requested input files may be copied into the VM. It is never mounted in the guest. Every saved vm-shell/run call still needs its own approval above.',
              'Выберите папку, из которой явно запрошенные входные файлы можно копировать в VM. Она не подключается к гостевой системе как общий диск. Каждый сохранённый вызов vm-shell/run по-прежнему требует отдельного подтверждения выше.',
            )}
          </p>
          <Button
            className="agent-vm-action"
            variant="secondary"
            disabled={disabled || !scope || !attachAvailable || !api.pickScriptWorkspace || bindings.length > 0}
            onClick={() =>
              void perform(async () => {
                const captured = context.current,
                  selected = await api.pickScriptWorkspace!();
                if (alive.current && captured === context.current && !selected.cancelled && selected.root) {
                  setRoot(selected.root);
                  setAttachAck('');
                }
              })
            }
          >
            {choose('Choose input workspace', 'Выбрать папку входных файлов')}
          </Button>
          {root && (
            <p>
              <code>{root}</code>
            </p>
          )}
          <Checkbox
            disabled={disabled || !scope || !root || !attachAvailable || bindings.length > 0}
            checked={Boolean(root) && attachAck === attachmentKey}
            onChange={(checked) => setAttachAck(checked ? attachmentKey : '')}
            label={choose(
              'Allow requested file snapshots only for this task generation. Command execution and publishing output files need separate approval.',
              'Разрешить запрошенные снимки файлов только для этого поколения задачи. Выполнение команды и публикация выходных файлов подтверждаются отдельно.',
            )}
          />
          <Button
            className="agent-vm-action"
            disabled={
              disabled ||
              !scope ||
              !root ||
              !attachAvailable ||
              bindings.length > 0 ||
              attachAck !== attachmentKey
            }
            onClick={() =>
              void perform(async () => {
                if (!scope || !root || attachAck !== attachmentKey) return;
                const target = { ...scope },
                  captured = context.current;
                await api.request({
                  action: 'attachVmWorkspace',
                  scope: target,
                  root,
                  acknowledgeIsolation: true,
                  explicitUserAction: true,
                });
                if (alive.current && captured === context.current) {
                  setAttachAck('');
                  setRoot('');
                }
              })
            }
          >
            {choose('Attach input workspace to this task', 'Прикрепить входную папку к задаче')}
          </Button>
          {workspaceBindings()}
          {activeOperations()}
          <Notice>
            {choose(
              'Returned files stay private as output candidates. A guest result is not proof of VM shutdown or successful publication. Export into your host workspace is a separate reviewed action after confirmed shutdown.',
              'Возвращённые файлы остаются частными кандидатами результата. Ответ гостевой системы не доказывает остановку VM или успешную публикацию. Экспорт в рабочую папку выполняется отдельным просмотренным действием после подтверждённой остановки.',
            )}
          </Notice>
        </div>
      </Panel>
      <AgentVmExport
        api={api}
        status={effectiveStatus}
        scope={scope}
        locked={locked}
        choose={choose}
        act={act}
        onChanged={onChanged}
      />
    </PanelStack>
  );
}
