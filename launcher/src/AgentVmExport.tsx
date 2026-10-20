import { useEffect, useRef, useState } from 'react';
import { Badge, BadgeRow, Button, Notice, Panel, Select, TextField } from './design';
import type { AgentToolsApi, AgentToolsStatus, ToolScope } from './agent-tools-types';
import type {
  VmExportRequest,
  VmExportReview,
  VmExportStatus,
} from '../../src/execution-environments/export-contract';
import { selectVmOutputCandidates } from '../../src/execution-environments/output';
/** Review reads the destination; only an approved saved vm-shell/export call may write it. */
export function AgentVmExport({
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
  const [roots, setRoots] = useState<
    {
      id: string;
      label: string;
    }[]
  >([]);
  const [loaded, setLoaded] = useState(false);
  const [workspaceId, setWorkspaceId] = useState('');
  const [candidateKey, setCandidateKey] = useState('');
  const [destination, setDestination] = useState('');
  const [review, setReview] = useState<VmExportReview | null>(null);
  const [saved, setSaved] = useState<VmExportStatus>({ reviews: [], receipts: [] });
  const [busy, setBusy] = useState(false);
  const [reconciling, setReconciling] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const reconcileInFlight = useRef(false);
  const alive = useRef(true),
    inFlight = useRef(false),
    context = useRef('');
  context.current = JSON.stringify([scope?.taskId, scope?.generation]);
  const candidates = selectVmOutputCandidates(status?.vmTools?.operations ?? [], scope).map((candidate) => ({
    ...candidate,
    key: JSON.stringify([candidate.operationId, candidate.path, candidate.sha256]),
  }));
  const selected = candidates.find((row) => row.key === candidateKey);
  const disabled = locked || busy;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    setRoots([]);
    setLoaded(false);
    setWorkspaceId('');
    setCandidateKey('');
    setDestination('');
    setReview(null);
    setSaved({ reviews: [], receipts: [] });
    setNotice('');
  }, [scope?.taskId, scope?.generation]);
  useEffect(() => {
    setReview(null);
  }, [workspaceId, candidateKey, destination]);
  async function perform(work: (captured: string) => Promise<void>) {
    if (locked || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    const captured = context.current;
    try {
      await act(async () => {
        try {
          await work(captured);
        } finally {
          await onChanged().catch(() => {});
        }
      });
    } finally {
      inFlight.current = false;
      if (alive.current) setBusy(false);
    }
  }
  function publicationReview() {
    return (
      review && (
        <div className="agent-vm-review agent-vm-stack" aria-live="polite">
          <BadgeRow>
            <Badge>
              {choose(
                'Reviewed; publication still requires approval',
                'Просмотрено; публикация ещё требует подтверждения',
              )}
            </Badge>
          </BadgeRow>
          <p>
            <strong>{review.candidatePath}</strong> → <strong>{review.destinationPath}</strong>
          </p>
          <p>
            {choose('New file', 'Новый файл')}: {review.bytes} {choose('bytes', 'байт')}.{' '}
            {review.currentSha256 === null
              ? choose('The destination does not exist.', 'Файл назначения пока не существует.')
              : `${choose('Existing destination', 'Существующий файл')}: ${review.currentBytes} ${choose('bytes', 'байт')}.`}
          </p>
          <Notice>
            {choose(
              'Publication checks the reviewed destination revision. If the file changes after review, publication is refused; review the new state before another request.',
              'Публикация проверяет просмотренную версию файла назначения. Если файл изменится после просмотра, запись будет отклонена; перед новым запросом просмотрите новое состояние.',
            )}
          </Notice>
          <dl className="agent-vm-metadata">
            <dt>{choose('Review ID', 'ID просмотра')}</dt>
            <dd>
              <code>{review.reviewId}</code>
            </dd>
            <dt>{choose('Review digest', 'Хеш просмотра')}</dt>
            <dd>
              <code>{review.reviewDigest}</code>
            </dd>
            <dt>{choose('Destination revision', 'Версия файла назначения')}</dt>
            <dd>
              <code>{review.expectedRevision ?? choose('New file', 'Новый файл')}</code>
            </dd>
          </dl>
          <details className="agent-vm-details">
            <summary>{choose('Exact file hashes', 'Точные хеши файлов')}</summary>
            <p>
              SHA-256: <code>{review.candidateSha256}</code>
            </p>
            {review.currentSha256 && (
              <p>
                {choose('Existing file SHA-256', 'SHA-256 существующего файла')}:{' '}
                <code>{review.currentSha256}</code>
              </p>
            )}
          </details>
          <p>
            {choose(
              'Continue the Agent task with this review ID and digest. No file has been published by this panel.',
              'Продолжите Agent-задачу с этим ID просмотра и хешем. Эта панель ещё не публиковала файл.',
            )}
          </p>
        </div>
      )
    );
  }
  function savedExports() {
    if (!saved.reviews.length && !saved.receipts.length) return null;
    return (
      <details className="agent-vm-details">
        <summary>
          {choose('Saved export reviews and receipts', 'Сохранённые просмотры и квитанции экспорта')}
        </summary>
        <ul className="agent-tools-records agent-vm-records">
          {saved.reviews.map((row) => (
            <li key={row.reviewId}>
              <strong>{row.destinationPath}</strong>
              <code>{row.reviewId}</code>
              <small>
                {row.bytes} {choose('bytes', 'байт')} · {row.candidatePath}
              </small>
            </li>
          ))}
          {saved.receipts.map((row, index) => {
            const key = JSON.stringify(row.request);
            return (
              <li key={`${key}:${index}`}>
                <BadgeRow>
                  <Badge>{row.state}</Badge>
                </BadgeRow>
                {row.result?.path && <span>{row.result.path}</span>}
                {row.result?.receiptId && <code>{row.result.receiptId}</code>}
                <small>
                  {row.request.scope.taskId} · gen {row.request.scope.generation}
                </small>
                {row.reason && <span>{row.reason}</span>}
                {row.state === 'outcome_unknown' && (
                  <>
                    <p>
                      {choose(
                        'This saved outcome is unresolved. It does not by itself mean an export is still running. Inspect its retained proof without sending the export again.',
                        'Исход сохранённого действия ещё не установлен. Это само по себе не означает, что экспорт выполняется. Проверьте сохранённое доказательство без повторной отправки экспорта.',
                      )}
                    </p>
                    <Button
                      className="agent-vm-action agent-vm-action--small"
                      size="sm"
                      variant="secondary"
                      disabled={reconciling !== null}
                      busy={reconciling === key}
                      onClick={() => void reconcileExport(row.request)}
                    >
                      {choose(
                        'Inspect exact saved export outcome',
                        'Проверить точный сохранённый исход экспорта',
                      )}
                    </Button>
                  </>
                )}
              </li>
            );
          })}
        </ul>
      </details>
    );
  }
  // Observation stays available while an ordinary tool call holds the action lock.
  async function reconcileExport(request: VmExportRequest) {
    if (reconcileInFlight.current || !scope) return;
    const exactRequest = structuredClone(request);
    const target = { ...scope },
      captured = context.current;
    reconcileInFlight.current = true;
    setReconciling(JSON.stringify(exactRequest));
    setNotice('');
    try {
      await api.request({ action: 'reconcileVmExport', request: exactRequest, explicitUserAction: true });
      const records = (await api.request({ action: 'vmExportStatus', scope: target })) as VmExportStatus;
      if (alive.current && captured === context.current) setSaved(records);
    } catch (cause) {
      if (alive.current && captured === context.current) {
        setNotice(
          cause instanceof Error
            ? cause.message
            : choose(
                'The saved export outcome is unavailable. Inspect again without resending the export.',
                'Сохранённый исход экспорта недоступен. Проверьте его снова без повторной отправки экспорта.',
              ),
        );
      }
    } finally {
      await onChanged().catch(() => {});
      reconcileInFlight.current = false;
      if (alive.current) setReconciling(null);
    }
  }
  return (
    <Panel title={choose('Publish a VM output file', 'Опубликовать выходной файл VM')}>
      <div className="agent-vm-stack">
        <p>
          {choose(
            'After confirmed VM shutdown, review one captured file and its destination in an existing project workspace. This review writes nothing. The Agent must then request vm-shell/export with this exact review; approve that saved call separately above.',
            'После подтверждённой остановки VM просмотрите один сохранённый файл и место назначения в существующем рабочем каталоге проекта. Просмотр ничего не записывает. Затем Agent должен запросить vm-shell/export с этим точным просмотром; подтвердите сохранённый вызов отдельно выше.',
          )}
        </p>
        {notice && <Notice tone="warning">{notice}</Notice>}
        {!scope && <Notice>{choose('Select an Agent task above.', 'Выберите Agent-задачу выше.')}</Notice>}
        <Button
          className="agent-vm-action"
          variant="secondary"
          disabled={disabled || !scope}
          onClick={() =>
            void perform(async (captured) => {
              const target = { ...scope! };
              const workspaceResult = (await api.request({ action: 'vmExportWorkspaces' })) as {
                roots: {
                  id: string;
                  label: string;
                }[];
              };
              const records = (await api.request({ action: 'vmExportStatus', scope: target })) as typeof saved;
              if (alive.current && captured === context.current) {
                setRoots(workspaceResult.roots);
                setSaved(records);
                setLoaded(true);
                if (!workspaceResult.roots.some((root) => root.id === workspaceId)) setWorkspaceId('');
              }
            })
          }
        >
          {choose('Refresh destinations and saved exports', 'Обновить папки назначения и сохранённый экспорт')}
        </Button>
        {loaded && roots.length === 0 && (
          <Notice>
            {choose(
              'Add or grant a workspace folder in Projects and files, then refresh here.',
              'Добавьте рабочую папку или разрешите доступ к ней в разделе «Проекты и файлы», затем обновите список здесь.',
            )}
          </Notice>
        )}
        {scope && candidates.length === 0 && (
          <p className="agent-tools-muted">
            {choose(
              'No captured output candidates from a confirmed stopped VM are available for this task.',
              'Для этой задачи пока нет сохранённых файлов от VM с подтверждённой остановкой.',
            )}
          </p>
        )}
        <div className="agent-tools-grid">
          <div className="nk-field">
            <label htmlFor="agent-vm-export-candidate">
              {choose('Captured output candidate', 'Сохранённый выходной файл')}
            </label>
            <Select
              id="agent-vm-export-candidate"
              label={choose('Captured output candidate', 'Сохранённый выходной файл')}
              value={candidateKey}
              disabled={disabled || !scope}
              onChange={setCandidateKey}
              options={[
                { value: '', label: choose('Choose a file', 'Выберите файл') },
                ...candidates.map((row) => ({
                  value: row.key,
                  label: `${row.path} · ${row.size} ${choose('bytes', 'байт')} · ${choose('generation', 'поколение')} ${row.sourceGeneration} · ${row.operationId.slice(0, 8)}`,
                })),
              ]}
            />
          </div>
          <div className="nk-field">
            <label htmlFor="agent-vm-export-workspace">
              {choose('Granted project workspace', 'Разрешённая рабочая папка проекта')}
            </label>
            <Select
              id="agent-vm-export-workspace"
              label={choose('Granted project workspace', 'Разрешённая рабочая папка проекта')}
              value={workspaceId}
              disabled={disabled || !scope || !loaded}
              onChange={setWorkspaceId}
              options={[
                { value: '', label: choose('Choose a workspace', 'Выберите рабочую папку') },
                ...roots.map((root) => ({ value: root.id, label: root.label })),
              ]}
            />
          </div>
          <TextField
            label={choose('Relative destination file path', 'Относительный путь выходного файла')}
            value={destination}
            disabled={disabled || !scope}
            maxLength={4096}
            placeholder="results/output.txt"
            onChange={(event) => setDestination(event.target.value)}
          />
        </div>
        <Button
          className="agent-vm-action"
          disabled={disabled || !scope || !selected || !workspaceId || !destination.trim()}
          onClick={() =>
            void perform(async (captured) => {
              if (!scope || !selected) return;
              setReview(null);
              const value = (await api.request({
                action: 'prepareVmExport',
                scope: { ...scope },
                workspaceId,
                destinationPath: destination,
                operationId: selected.operationId,
                candidatePath: selected.path,
                candidateSha256: selected.sha256,
                explicitUserAction: true,
              })) as VmExportReview;
              if (alive.current && captured === context.current) setReview(value);
            })
          }
        >
          {choose('Review exact file publication', 'Просмотреть точную публикацию файла')}
        </Button>
        {publicationReview()}
        {savedExports()}
      </div>
    </Panel>
  );
}
