import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Notice, Panel, Select, TextField } from './design';
import type { AgentToolsApi, AgentToolsStatus, ToolScope } from './agent-tools-types';
import type { VmExportReview, VmExportStatus } from '../../src/execution-environments/export-contract';
import { selectVmOutputCandidates } from '../../src/execution-environments/output';

/** Review reads the destination; only an approved saved vm-shell/export call may write it. */
export function AgentVmExport({ api, status, scope, locked, choose, act, onChanged }: {
  api: AgentToolsApi; status: AgentToolsStatus | null; scope?: ToolScope; locked: boolean;
  choose: (en: string, ru: string) => string;
  act: (operation: () => Promise<void>) => Promise<void>; onChanged: () => Promise<void>;
}) {
  const [roots, setRoots] = useState<{ id: string; label: string }[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [workspaceId, setWorkspaceId] = useState('');
  const [candidateKey, setCandidateKey] = useState('');
  const [destination, setDestination] = useState('');
  const [review, setReview] = useState<VmExportReview | null>(null);
  const [saved, setSaved] = useState<VmExportStatus>({ reviews: [], receipts: [] });
  const [busy, setBusy] = useState(false);
  const alive = useRef(true), inFlight = useRef(false), context = useRef('');
  context.current = JSON.stringify([scope?.taskId, scope?.generation]);
  const candidates = selectVmOutputCandidates(status?.vmTools?.operations ?? [], scope)
    .map(candidate => ({ ...candidate, key: JSON.stringify([candidate.operationId, candidate.path, candidate.sha256]) }));
  const selected = candidates.find(row => row.key === candidateKey);
  const disabled = locked || busy;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setRoots([]); setLoaded(false); setWorkspaceId(''); setCandidateKey(''); setDestination(''); setReview(null); setSaved({ reviews: [], receipts: [] }); }, [scope?.taskId, scope?.generation]);
  useEffect(() => { setReview(null); }, [workspaceId, candidateKey, destination]);
  async function perform(work: (captured: string) => Promise<void>) {
    if (locked || inFlight.current) return;
    inFlight.current = true; setBusy(true);
    const captured = context.current;
    try { await act(async () => { try { await work(captured); } finally { await onChanged().catch(() => {}); } }); }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  return <Panel title={choose('Publish a VM output file', 'Опубликовать выходной файл VM')}>
    <p>{choose('After confirmed VM shutdown, review one captured file and its destination in an existing project workspace. This review writes nothing. The Agent must then request vm-shell/export with this exact review; approve that saved call separately above.', 'После подтверждённой остановки VM просмотрите один сохранённый файл и место назначения в существующем рабочем каталоге проекта. Просмотр ничего не записывает. Затем Agent должен запросить vm-shell/export с этим точным просмотром; подтвердите сохранённый вызов отдельно выше.')}</p>
    {!scope && <Notice>{choose('Select an Agent task above.', 'Выберите Agent-задачу выше.')}</Notice>}
    <Button variant="secondary" disabled={disabled || !scope} onClick={() => void perform(async captured => {
      const target = { ...scope! };
      const workspaceResult = await api.request({ action: 'vmExportWorkspaces' }) as { roots: { id: string; label: string }[] };
      const records = await api.request({ action: 'vmExportStatus', scope: target }) as typeof saved;
      if (alive.current && captured === context.current) {
        setRoots(workspaceResult.roots); setSaved(records); setLoaded(true);
        if (!workspaceResult.roots.some(root => root.id === workspaceId)) setWorkspaceId('');
      }
    })}>{choose('Refresh destinations and saved exports', 'Обновить папки назначения и сохранённый экспорт')}</Button>
    {loaded && roots.length === 0 && <Notice>{choose('Add or grant a workspace folder in Projects and files, then refresh here.', 'Добавьте рабочую папку или разрешите доступ к ней в разделе «Проекты и файлы», затем обновите список здесь.')}</Notice>}
    {scope && candidates.length === 0 && <p className="agent-tools-muted">{choose('No captured output candidates from a confirmed stopped VM are available for this task.', 'Для этой задачи пока нет сохранённых файлов от VM с подтверждённой остановкой.')}</p>}
    <div className="agent-tools-grid">
      <Select label={choose('Captured output candidate', 'Сохранённый выходной файл')} value={candidateKey} disabled={disabled || !scope} onChange={setCandidateKey} options={[{ value: '', label: choose('Choose a file', 'Выберите файл') }, ...candidates.map(row => ({ value: row.key, label: `${row.path} · ${row.size} ${choose('bytes', 'байт')} · ${choose('generation', 'поколение')} ${row.sourceGeneration} · ${row.operationId.slice(0, 8)}` }))]} />
      <Select label={choose('Granted project workspace', 'Разрешённая рабочая папка проекта')} value={workspaceId} disabled={disabled || !scope || !loaded} onChange={setWorkspaceId} options={[{ value: '', label: choose('Choose a workspace', 'Выберите рабочую папку') }, ...roots.map(root => ({ value: root.id, label: root.label }))]} />
      <TextField label={choose('Relative destination file path', 'Относительный путь выходного файла')} value={destination} disabled={disabled || !scope} maxLength={4096} placeholder="results/output.txt" onChange={event => setDestination(event.target.value)} />
    </div>
    <Button disabled={disabled || !scope || !selected || !workspaceId || !destination.trim()} onClick={() => void perform(async captured => {
      if (!scope || !selected) return;
      setReview(null);
      const value = await api.request({ action: 'prepareVmExport', scope: { ...scope }, workspaceId, destinationPath: destination, operationId: selected.operationId, candidatePath: selected.path, candidateSha256: selected.sha256, explicitUserAction: true }) as VmExportReview;
      if (alive.current && captured === context.current) setReview(value);
    })}>{choose('Review exact file publication', 'Просмотреть точную публикацию файла')}</Button>
    {review && <div className="agent-tools-review" aria-live="polite">
      <Badge>{choose('Reviewed; publication still requires approval', 'Просмотрено; публикация ещё требует подтверждения')}</Badge>
      <p><strong>{review.candidatePath}</strong> → <strong>{review.destinationPath}</strong></p>
      <p>{choose('New file', 'Новый файл')}: {review.bytes} {choose('bytes', 'байт')}. {review.currentSha256 === null ? choose('The destination does not exist.', 'Файл назначения пока не существует.') : `${choose('Existing destination', 'Существующий файл')}: ${review.currentBytes} ${choose('bytes', 'байт')}.`}</p>
      <Notice>{choose('Publication checks the reviewed destination revision. If the file changes after review, publication is refused; review the new state before another request.', 'Публикация проверяет просмотренную версию файла назначения. Если файл изменится после просмотра, запись будет отклонена; перед новым запросом просмотрите новое состояние.')}</Notice>
      <dl><dt>{choose('Review ID', 'ID просмотра')}</dt><dd><code>{review.reviewId}</code></dd><dt>{choose('Review digest', 'Хеш просмотра')}</dt><dd><code>{review.reviewDigest}</code></dd><dt>{choose('Destination revision', 'Версия файла назначения')}</dt><dd><code>{review.expectedRevision ?? choose('New file', 'Новый файл')}</code></dd></dl>
      <details><summary>{choose('Exact file hashes', 'Точные хеши файлов')}</summary><p>SHA-256: <code>{review.candidateSha256}</code></p>{review.currentSha256 && <p>{choose('Existing file SHA-256', 'SHA-256 существующего файла')}: <code>{review.currentSha256}</code></p>}</details>
      <p>{choose('Continue the Agent task with this review ID and digest. No file has been published by this panel.', 'Продолжите Agent-задачу с этим ID просмотра и хешем. Эта панель ещё не публиковала файл.')}</p>
    </div>}
    {(saved.reviews.length > 0 || saved.receipts.length > 0) && <details><summary>{choose('Saved export reviews and receipts', 'Сохранённые просмотры и квитанции экспорта')}</summary><ul className="agent-tools-records">{saved.reviews.map(row => <li key={row.reviewId}><strong>{row.destinationPath}</strong><code>{row.reviewId}</code><small>{row.bytes} {choose('bytes', 'байт')} · {row.candidatePath}</small></li>)}{saved.receipts.map((row, index) => <li key={`${row.result?.receiptId ?? row.result?.reviewId ?? 'receipt'}:${index}`}><strong>{row.state}</strong>{row.result?.path && <span>{row.result.path}</span>}{row.result?.receiptId && <code>{row.result.receiptId}</code>}{row.reason && <span>{row.reason}</span>}</li>)}</ul></details>}
  </Panel>;
}
