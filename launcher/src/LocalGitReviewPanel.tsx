import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Notice, Panel, Select, TextField } from './design';
import type { Language } from './types';
import type { LocalGitReviewApi, LocalGitReviewAction, LocalGitReviewBases, LocalGitReviewCapture,
  LocalGitReviewDiff, LocalGitReviewDiffInput, LocalGitReviewOperation } from '../electron/local-git-review.cjs';
import './surfaces/remote-git-review.css';

export interface LocalGitReviewPanelProps {
  workspaceId: string; api: LocalGitReviewApi; language: Language; dirtyPaths: string[];
  disabled?: boolean; onChanged(): void | Promise<void>; onOpenFile?(path: string): void | Promise<void>;
}
const held = (row: LocalGitReviewAction) => row.ownerHeld || ['prepared', 'unknown'].includes(row.state);

/** Local editor drafts are never silently staged or discarded. Only the reviewed disk/index state can be applied. */
export default function LocalGitReviewPanel(props: LocalGitReviewPanelProps) {
  return <Session key={props.workspaceId} {...props} />;
}
function Session({ workspaceId, api, language, dirtyPaths, disabled = false, onChanged, onOpenFile }: LocalGitReviewPanelProps) {
  const t = (en: string, ru: string) => language === 'ru' ? ru : en;
  const [capture, setCapture] = useState<LocalGitReviewCapture | null>(null);
  const [bases, setBases] = useState<LocalGitReviewBases | null>(null), [baseId, setBaseId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [view, setView] = useState<LocalGitReviewDiffInput['kind']>('worktree');
  const [diff, setDiff] = useState<LocalGitReviewDiff | null>(null);
  const [message, setMessage] = useState(''), [authorName, setAuthorName] = useState(''), [authorEmail, setAuthorEmail] = useState('');
  const [action, setAction] = useState<LocalGitReviewAction | null>(null), [records, setRecords] = useState<LocalGitReviewAction[]>([]);
  const [busy, setBusy] = useState(false), [stale, setStale] = useState(true), [confirmed, setConfirmed] = useState(false), [error, setError] = useState('');
  const [pending, setPending] = useState<{ id: string; phase: 'prepare' | 'apply' } | null>(null);
  const alive = useRef(true), inFlight = useRef(false), drafts = useRef(dirtyPaths);
  drafts.current = dirtyPaths;
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const draftKey = [...dirtyPaths].sort().join('\0');
  useEffect(() => { setConfirmed(false); if (dirtyPaths.length) setStale(true); }, [draftKey]);
  const blocked = !!pending || records.some(held);
  const canMutate = !disabled && !busy && !blocked && !stale && !!capture && !capture.truncated && !dirtyPaths.length;
  const exactReview = !!action && !!capture && action.workspaceId === workspaceId
    && action.target.identity === capture.target.identity && action.target.path === capture.target.path
    && action.review.headOid === capture.repository.headOid && action.review.indexDigest === capture.repository.indexDigest;
  function invalidate() { setConfirmed(false); if (action?.state === 'reviewed') setAction(null); }
  async function perform(work: () => Promise<void>) {
    if (inFlight.current || disabled) return;
    inFlight.current = true; setBusy(true); setError('');
    try { await work(); }
    catch (reason) { if (alive.current) { setError(reason instanceof Error ? reason.message : String(reason)); setConfirmed(false); setStale(true); } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  function observe(row: LocalGitReviewAction) {
    if (!alive.current) return;
    if (row.workspaceId !== workspaceId) throw new Error('Local Git receipt belongs to another workspace');
    setAction(row); setConfirmed(false); setRecords(rows => [...rows.filter(old => old.actionId !== row.actionId), row]);
    if (held(row)) setPending({ id: row.actionId, phase: 'apply' }); else setPending(null);
    if (row.state === 'completed') { setStale(true); void onChanged(); }
  }
  async function inspect(id: string, phase: 'prepare' | 'apply' = 'apply') {
    const row = await api.workspaceGitReviewInspectAction(workspaceId, id);
    if (!alive.current) return;
    if (!row) {
      // Preparing only captures a plan. It cannot stage, commit or dispatch an effect.
      if (phase === 'prepare') { setPending(null); setStale(true); return; }
      setPending({ id, phase }); throw new Error(t('The exact action has no terminal record. Keep its identity and inspect; do not resend.', 'У точного действия нет завершающей записи. Сохраните идентификатор и проверяйте исход без повторной отправки.'));
    }
    if (row.actionId !== id) throw new Error('Local Git action identity differs');
    observe(row);
  }
  async function refresh() {
    const rows = await api.workspaceGitReviewListActions(workspaceId);
    if (!alive.current) return;
    setRecords(rows);
    const recovery = pending ?? (rows.find(held) ? { id: rows.find(held)!.actionId, phase: 'apply' as const } : null);
    if (recovery) { await inspect(recovery.id, recovery.phase); return; }
    const nextBases = await api.workspaceGitReviewBases(workspaceId);
    if (!alive.current) return;
    // IDs are regenerated for each captured base list. Preserve the chosen ref/OID by value.
    const previousChoice = bases?.choices.find(row => row.baseId === baseId);
    const choice = previousChoice && nextBases.choices.find(row => row.ref === previousChoice.ref && row.oid === previousChoice.oid);
    const next = await api.workspaceGitReviewCapture(workspaceId, choice ? { baseId: choice.baseId } : {});
    if (!alive.current) return;
    if (next.workspaceId !== workspaceId) throw new Error('Local Git capture belongs to another workspace');
    setBases(nextBases); setBaseId(choice?.baseId ?? ''); setCapture(next); setSelected([]); setDiff(null); setAction(null); setConfirmed(false); setStale(false);
  }
  async function prepare(operation: LocalGitReviewOperation) {
    if (!canMutate || !capture || drafts.current.length) return;
    const actionId = crypto.randomUUID(); setPending({ id: actionId, phase: 'prepare' }); setConfirmed(false);
    const row = await api.workspaceGitReviewPrepare(workspaceId, { actionId, captureId: capture.captureId, operation,
      ...(operation === 'commit' ? { message, author: { name: authorName, email: authorEmail } } : { paths: selected }) });
    if (!alive.current) return;
    if (row.actionId !== actionId || row.operation !== operation) throw new Error('Local Git review identity differs');
    observe(row);
  }
  async function readDiff(path?: string, stage?: 1 | 2 | 3) {
    if (!capture) return;
    const value = await api.workspaceGitReviewDiff(workspaceId, { captureId: capture.captureId, kind: stage ? 'conflict' : view, ...(path ? { path } : {}), ...(stage ? { stage } : {}) });
    if (!alive.current) return;
    if (value.state === 'current') setDiff(value); else {
      setDiff(previous => previous ?? value); setConfirmed(false); setStale(true);
      setError(value.reason ?? t('The review changed. Previous diff bytes are retained.', 'Просмотр устарел. Прежнее содержимое diff сохранено.'));
    }
  }
  const title = t('Local Git: stage and commit', 'Локальный Git: индекс и коммит');
  return <Panel title={title} className="nk-workspace__panel nk-local-git">
    <p>{t('Review the saved files and complete staged tree before applying an exact action. Editor drafts remain separate.', 'Проверьте сохранённые файлы и полный индекс перед применением точного действия. Черновики редактора сохраняются отдельно.')}</p>
    {dirtyPaths.length > 0 && <Notice tone="warning"><p>{t('Save or explicitly discard editor drafts before changing Git:', 'Перед изменением Git сохраните или явно удалите черновики редактора:')}</p><ul className="nk-workspace__paths-list">{dirtyPaths.map(path => <li key={path}><code>{path}</code></li>)}</ul></Notice>}
    {error && <Notice tone="warning">{error}</Notice>}
    {blocked && <Notice tone="warning">{t('An exact action needs inspection. Refresh never replays it.', 'Нужна проверка точного действия. Обновление не выполняет его повторно.')} <code>{pending?.id}</code></Notice>}
    {stale && capture && <Notice tone="warning">{t('Refresh the retained review before another mutation. The commit message is preserved.', 'Обновите сохранённый просмотр перед новым изменением. Сообщение коммита сохранено.')}</Notice>}
    <Button disabled={disabled || busy} onClick={() => void perform(refresh)}>{t('Refresh local Git', 'Обновить локальный Git')}</Button>
    {capture && <>
      <p><code>{capture.target.path}</code> · {capture.repository.headRef ?? 'HEAD'} · <code>{capture.repository.headOid ?? t('Unborn branch', 'Ветка без коммита')}</code></p>
      <Select label={t('Comparison base', 'Основа сравнения')} value={baseId} disabled={busy || disabled || blocked} options={[{ value: '', label: 'HEAD' }, ...(bases?.choices ?? []).map(row => ({ value: row.baseId, label: `${row.ref ?? row.kind} · ${row.oid ?? 'unborn'}` }))]} onChange={value => { setBaseId(value); setStale(true); invalidate(); }} />
      {capture.limitations.map(value => <Notice key={value} tone="warning">{value === 'global_and_system_git_configuration_and_attributes_disabled'
        ? t('Uses isolated Git settings; global/system config and attributes are excluded. Exact-byte staging refuses unsupported conversions.', 'Используются отдельные настройки Git без глобальной и системной конфигурации и атрибутов. Добавление точных байтов отклоняет неподдерживаемые преобразования.') : value}</Notice>)}
      <div className="nk-remote-git__files">{capture.entries.map(entry => <div className="nk-remote-git__file" key={entry.path}>
        <Checkbox label={`${entry.indexStatus}${entry.worktreeStatus} ${entry.originalPath ? `${entry.originalPath} → ` : ''}${entry.path}`} checked={selected.includes(entry.path)} disabled={busy || disabled || blocked} onChange={checked => {
          const linked = [entry.path, ...(entry.originalPath ? [entry.originalPath] : [])];
          setSelected(rows => checked ? [...new Set([...rows, ...linked])] : rows.filter(path => !linked.includes(path))); invalidate();
        }} />
        <Button size="sm" disabled={busy || disabled} onClick={() => void perform(() => readDiff(entry.path))}>{t('Diff', 'Изменения')}</Button>
        {onOpenFile && <Button size="sm" disabled={busy || disabled} onClick={() => void perform(async () => { await onOpenFile?.(entry.path); })}>{t('Open file', 'Открыть файл')}</Button>}
        {entry.stages?.map(row => <Button size="sm" key={row.stage} disabled={busy || disabled} onClick={() => void perform(() => readDiff(entry.path, row.stage as 1 | 2 | 3))}>{t('Conflict stage', 'Стадия конфликта')} {row.stage}</Button>)}
      </div>)}</div>
      <div className="nk-workspace__actions nk-workspace__form-actions"><Select label={t('Diff view', 'Вид изменений')} value={view} disabled={busy} onChange={value => setView(value as LocalGitReviewDiffInput['kind'])} options={[{ value: 'worktree', label: t('Working files', 'Рабочие файлы') }, { value: 'staged', label: t('Staged index', 'Индекс') }, { value: 'base', label: t('Selected base', 'Выбранная основа') }]} />
        <Button disabled={busy || disabled} onClick={() => void perform(() => readDiff())}>{t('Read complete diff', 'Прочитать полный diff')}</Button></div>
      {diff && <><p>{diff.path ?? '*'} · {diff.kind} · {diff.state}{diff.binary ? ' · binary' : ''}{diff.truncated ? ' · truncated' : ''}</p><pre className="nk-remote-git__diff" tabIndex={0} aria-label={t('Git diff', 'Изменения Git')}>{diff.text}</pre></>}
      <div className="nk-workspace__actions nk-workspace__form-actions"><Button disabled={!canMutate || !selected.length} onClick={() => void perform(() => prepare('stage'))}>{t('Review stage selected', 'Просмотреть добавление в индекс')}</Button>
        <Button disabled={!canMutate || !selected.length} onClick={() => void perform(() => prepare('unstage'))}>{t('Review unstage selected', 'Просмотреть исключение из индекса')}</Button></div>
      <h3>{t('Commit all staged entries', 'Коммит всего индекса')}</h3>
      <p>{t('Checked paths do not limit a commit. Every staged entry and all merge parents are reviewed below. The explicit author is also the committer.', 'Отмеченные пути не ограничивают коммит. Ниже проверяются все записи индекса и родители слияния. Указанный автор также записывается как создатель коммита.')}</p>
      <label className="nk-field">{t('Commit message', 'Сообщение коммита')}<textarea className="nk-remote-git__message" value={message} maxLength={16384} disabled={busy} onChange={event => { setMessage(event.target.value); invalidate(); }} /></label>
      <div className="nk-workspace__actions nk-workspace__form-actions"><TextField label={t('Author name', 'Имя автора')} value={authorName} disabled={busy} onChange={event => { setAuthorName(event.target.value); invalidate(); }} />
        <TextField label={t('Author email', 'Email автора')} value={authorEmail} disabled={busy} onChange={event => { setAuthorEmail(event.target.value); invalidate(); }} />
        <Button disabled={!canMutate || !message.trim() || !authorName.trim() || !authorEmail.trim() || capture.entries.some(row => row.kind === 'conflict')} onClick={() => void perform(() => prepare('commit'))}>{t('Review complete commit', 'Просмотреть полный коммит')}</Button></div>
    </>}
    {action && <div className="nk-remote-git__review"><h3>{action.operation} · {action.state}</h3>
      <p><code>{action.target.path}</code> · HEAD <code>{action.review.headOid ?? 'unborn'}</code></p>
      <p>{t('Parents', 'Родители')}: {action.review.parents.join(', ') || '∅'}</p>
      <p>{t('Reviewed index digest', 'Проверенный хеш индекса')}: <code>{action.review.indexDigest ?? '∅'}</code></p>
      <ul>{action.review.paths.map(path => <li key={path}><code>{path}</code></li>)}</ul>
      {action.operation === 'commit' && <details open><summary>{t('Complete staged tree', 'Полное дерево индекса')} · {action.review.stagedEntries?.length ?? '?'}</summary>
        <div className="nk-local-git__table" tabIndex={0} role="region" aria-label={t('Complete staged tree', 'Полное дерево индекса')}><table><thead><tr><th>{t('Path', 'Путь')}</th><th>{t('Mode', 'Режим')}</th><th>OID</th></tr></thead><tbody>{action.review.stagedEntries?.map(row => <tr key={row.path}><td><code>{row.path}</code></td><td>{row.mode}</td><td><code>{row.oid}</code></td></tr>)}</tbody></table></div></details>}
      {action.review.author && <p>{action.review.author.name} &lt;{action.review.author.email}&gt;</p>}
      {action.review.message && <pre className="nk-remote-git__diff">{action.review.message}</pre>}
      {action.reason && <Notice tone="warning">{action.reason}</Notice>}
      {action.result && <p>{t('Verified result', 'Подтверждённый результат')}: <code>{action.result.commitOid ?? action.result.indexDigest}</code>{action.result.treeOid && <> · tree <code>{action.result.treeOid}</code></>}</p>}
      <details><summary>{t('Exact receipt', 'Точная квитанция')}</summary><p>{action.actionId} · {action.reviewDigest}</p><pre>{JSON.stringify(action.review.files, null, 2)}</pre></details>
      {action.state === 'reviewed' && <><Checkbox label={t('I reviewed this exact action and its complete candidate.', 'Я проверил точное действие и полный состав изменений.')} checked={confirmed} disabled={!canMutate || !exactReview} onChange={setConfirmed} />
        <Button variant="primary" disabled={!canMutate || !exactReview || !confirmed || action.operation === 'commit' && !action.review.stagedEntries} onClick={() => void perform(async () => {
          if (!confirmed || !exactReview || drafts.current.length || action.state !== 'reviewed') return;
          setPending({ id: action.actionId, phase: 'apply' }); setConfirmed(false);
          const value = await api.workspaceGitReviewApply(workspaceId, { actionId: action.actionId, reviewDigest: action.reviewDigest });
          if (!alive.current) return;
          if (value.actionId !== action.actionId || value.reviewDigest !== action.reviewDigest) throw new Error('Local Git terminal receipt differs');
          observe(value);
        })}>{t('Apply reviewed action', 'Применить просмотренное действие')}</Button></>}
    </div>}
    {!!records.length && <details><summary>{t('Retained local Git actions', 'Сохранённые действия локального Git')}</summary>{records.map(row => <div className="nk-local-git__record" key={row.actionId}>
      <p>{row.operation} · {row.state} · <code>{row.actionId}</code></p><div className="nk-workspace__actions"><Button size="sm" disabled={busy || disabled} onClick={() => void perform(() => inspect(row.actionId))}>{t('Inspect exact action', 'Проверить точное действие')}</Button>
      {!held(row) && <Button size="sm" disabled={busy || disabled || blocked} onClick={() => void perform(async () => {
        // This only removes the private review record; repository ledgers and Git history remain intact.
        await api.workspaceGitReviewPruneActions(workspaceId, [row.actionId]); if (!alive.current) return;
        setRecords(rows => rows.filter(value => value.actionId !== row.actionId)); if (action?.actionId === row.actionId) setAction(null);
      })}>{t('Remove local review record', 'Убрать локальную запись просмотра')}</Button>}
    </div></div>)}</details>}
  </Panel>;
}
