import { useEffect, useRef, useState } from 'react';
import { Button, Checkbox, Dialog, Notice, Panel, Select, TextField } from './design';
import type { Language } from './types';
import type { RemoteHost } from './remote-workspace-types';
import type { RemoteGitReviewApi, RemoteGitReviewAction, RemoteGitReviewBases, RemoteGitReviewCapture, RemoteGitReviewDiff, RemoteGitReviewDiffInput, RemoteGitReviewOperation } from '../electron/remote-git-review.cjs';
import './surfaces/remote-git-review.css';

const held = (action: RemoteGitReviewAction) => action.ownerHeld || action.state === 'unknown' || action.state === 'prepared' && !action.terminal;
const limitationCopy: Record<string, { en: string; ru: string }> = {
  global_and_system_git_configuration_and_attributes_disabled: {
    en: 'Review uses isolated Git settings: global and system configuration and attribute files are ignored. Results may differ from Git in your usual terminal.',
    ru: 'Просмотр использует отдельные настройки Git: глобальная и системная конфигурация и файлы атрибутов не учитываются. Результат может отличаться от Git в обычном терминале.',
  },
  configured_attributes_file_not_supported: {
    en: 'This repository configures a separate attributes file. Mutations with that configuration are not supported; reviewing it grants no permission to bypass its attributes.',
    ru: 'Для репозитория настроен отдельный файл атрибутов. Изменения с такой конфигурацией пока не поддерживаются; просмотр не разрешает обходить эти атрибуты.',
  },
  submodules_not_supported: {
    en: 'The index contains submodules. Git mutations for this repository are not supported here; a submodule is not another granted workspace.',
    ru: 'В индексе есть подмодули. Изменения Git для такого репозитория здесь пока не поддерживаются; подмодуль не становится отдельно разрешённой рабочей областью.',
  },
  sequencer_not_supported: {
    en: 'A rebase, cherry-pick, revert or bisect operation is in progress. Continuing or changing that workflow is not supported here.',
    ru: 'В репозитории выполняется rebase, cherry-pick, revert или bisect. Продолжение или изменение этого процесса здесь пока не поддерживается.',
  },
  merge_autostash_not_supported: {
    en: 'This merge retains an automatic stash. Git mutations in that state are not supported here; the stash will not be applied or removed automatically.',
    ru: 'Для этого слияния сохранён автоматический stash. Изменения Git в таком состоянии пока не поддерживаются; stash не применяется и не удаляется автоматически.',
  },
  sparse_checkout_not_supported: {
    en: 'Sparse checkout is enabled. Git mutations for a partial checkout are not supported here.',
    ru: 'Включён sparse checkout — частичная рабочая копия. Изменения Git для такой копии здесь пока не поддерживаются.',
  },
  split_index_not_supported: {
    en: 'This repository uses a split index. Git mutations for that index format are not supported here.',
    ru: 'Репозиторий использует разделённый индекс Git. Изменения такого индекса здесь пока не поддерживаются.',
  },
  index_skip_or_assume_flags_not_supported: {
    en: 'Some index entries use skip-worktree or assume-unchanged flags. Git mutations with those flags are not supported here; they are not cleared automatically.',
    ru: 'У записей индекса установлены skip-worktree или assume-unchanged. Изменения с такими флагами здесь пока не поддерживаются; автоматически они не снимаются.',
  },
};
/** Human workspace review only. No Agent attachment, command input or automatic SSH reads. */
export default function RemoteGitReview(props: { host: RemoteHost; api: RemoteGitReviewApi; language: Language; disabled?: boolean; mutationBlocked?: boolean; onOpenFile(path: string): Promise<void> }) {
  return <ReviewSession key={props.host.id} {...props} />;
}
function ReviewSession({ host, api, language, disabled = false, mutationBlocked = false, onOpenFile }: {
  host: RemoteHost; api: RemoteGitReviewApi; language: Language; disabled?: boolean; mutationBlocked?: boolean; onOpenFile(path: string): Promise<void>;
}) {
  const ru = language === 'ru';
  const t = (en: string, russian: string) => ru ? russian : en;
  const limitationText = (value: string) => limitationCopy[value]?.[ru ? 'ru' : 'en'] ?? value;
  const [capture, setCapture] = useState<RemoteGitReviewCapture | null>(null);
  const [bases, setBases] = useState<RemoteGitReviewBases | null>(null);
  const [baseId, setBaseId] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [diff, setDiff] = useState<RemoteGitReviewDiff | null>(null);
  const [diffKind, setDiffKind] = useState<RemoteGitReviewDiffInput['kind']>('worktree');
  const [diffPath, setDiffPath] = useState('');
  const [message, setMessage] = useState('');
  const [authorName, setAuthorName] = useState('');
  const [authorEmail, setAuthorEmail] = useState('');
  const [action, setAction] = useState<RemoteGitReviewAction | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [records, setRecords] = useState<RemoteGitReviewAction[]>([]);
  const [confirmed, setConfirmed] = useState(false);
  const [stale, setStale] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [metadataReady, setMetadataReady] = useState(false);
  const [forgetting, setForgetting] = useState<RemoteGitReviewAction | null>(null);
  const [prunePending, setPrunePending] = useState<string | null>(null);
  const alive = useRef(true), inFlight = useRef(false);
  const identity = `${host.id}:${host.fingerprint}:${host.canonicalRoot ?? host.root}:${host.connected}`;
  const context = useRef({ identity });
  if (context.current.identity !== identity) context.current = { identity };
  const captureContext = useRef<object | null>(null);
  const actionContext = useRef<object | null>(null);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  useEffect(() => { setConfirmed(false); setMetadataReady(false); setForgetting(null); if (captureContext.current) setStale(true); }, [identity]);
  const blocked = Boolean(pendingId || prunePending) || records.some(held) || Boolean(action && held(action));
  const locked = disabled || host.busy || busy || !host.connected;
  const canMutate = metadataReady && !locked && !mutationBlocked && !blocked && !stale && !!capture && captureContext.current === context.current && !capture.truncated;
  const actionTargetCurrent = !!action && !!capture && actionContext.current === context.current
    && action.target.hostId === capture.target.hostId && action.target.fingerprint === capture.target.fingerprint
    && action.target.connectionId === capture.target.connectionId && action.target.root === capture.target.root
    && action.review.headOid === capture.repository.headOid && action.review.indexDigest === capture.repository.indexDigest;
  async function perform(work: (token: object) => Promise<void>, metadataOnly = false) {
    if (inFlight.current || disabled || host.busy || !metadataOnly && !host.connected) return;
    inFlight.current = true; setBusy(true); setError('');
    const token = context.current;
    try { await work(token); }
    catch (reason) { if (alive.current && context.current === token) { setError(reason instanceof Error ? reason.message : String(reason)); setConfirmed(false); setStale(true); setMetadataReady(false); } }
    finally { inFlight.current = false; if (alive.current) setBusy(false); }
  }
  const current = (token: object) => alive.current && context.current === token;
  function observe(value: RemoteGitReviewAction, token: object) {
    if (!current(token)) return;
    setAction(value); setConfirmed(false);
    setRecords(rows => [...rows.filter(row => row.actionId !== value.actionId), value]);
    if (value.terminal && !value.ownerHeld) {
      setPendingId(null);
      if (value.state === 'completed') setStale(true);
    } else if (held(value)) setPendingId(value.actionId);
    else if (value.state === 'reviewed') { setPendingId(null); actionContext.current = token; }
  }
  async function inspect(actionId: string, token: object) {
    const value = await api.remoteGitInspectAction(host.id, actionId);
    if (!current(token)) return;
    if (!value || value.actionId !== actionId || value.hostId !== host.id) {
      setPendingId(actionId); setError(t('No exact terminal receipt is available. Keep this action identity; do not resend.', 'Точной завершающей квитанции нет. Сохранён исходный идентификатор; повторная отправка запрещена.')); return;
    }
    observe(value, token);
  }
  async function refresh(token: object) {
    // The persisted controller is the recovery source after UI remount, not a second mutation sender.
    const rows = await api.remoteGitListActions(host.id);
    if (!current(token)) return;
    setRecords(rows);
    setMetadataReady(true);
    if (prunePending) {
      if (rows.some(row => row.actionId === prunePending)) {
        setError(t('Local history removal is not confirmed. Keep this exact identity and refresh; do not repeat removal.', 'Удаление из локальной истории не подтверждено. Сохранён точный идентификатор; обновите состояние без повторного удаления.')); return;
      }
      if (action?.actionId === prunePending) { setAction(null); actionContext.current = null; }
      setPrunePending(null);
    }
    const exact = pendingId ?? rows.find(held)?.actionId;
    if (exact) { setPendingId(exact); await inspect(exact, token); return; }
    if (!host.connected) return;
    const nextBases = await api.remoteGitBases(host.id);
    if (!current(token)) return;
    const selectedBase = nextBases.choices.some(row => row.baseId === baseId) ? baseId : '';
    const next = await api.remoteGitCapture(host.id, selectedBase ? { baseId: selectedBase } : undefined);
    if (!current(token)) return;
    if (next.target.hostId !== host.id || next.target.root !== host.canonicalRoot) throw new Error('Remote Git capture destination differs');
    setBases(nextBases); setBaseId(selectedBase); setCapture(next); captureContext.current = token;
    setSelected([]); setDiffPath(''); setDiff(null); setStale(false); setConfirmed(false); setAction(null); actionContext.current = null;
  }
  function invalidatePlan() { setConfirmed(false); if (action?.state === 'reviewed') { setAction(null); actionContext.current = null; } }
  function observeDiff(value: RemoteGitReviewDiff, path: string, token: object) {
    if (!current(token)) return;
    if (value.state === 'current') { setDiff(value); setDiffPath(path); return; }
    setDiff(previous => previous ?? value);
    if (!diff) setDiffPath(path);
    setError(value.reason ?? t('The requested diff is unavailable. Earlier review bytes are retained.', 'Запрошенный diff недоступен. Прежнее содержимое просмотра сохранено.'));
    setConfirmed(false);
    if (value.state === 'stale') setStale(true);
  }
  async function prepare(operation: RemoteGitReviewOperation, token: object) {
    if (!canMutate || !capture) return;
    const actionId = crypto.randomUUID();
    setPendingId(actionId); setConfirmed(false); setAction(null); actionContext.current = null;
    const value = await api.remoteGitPrepare(host.id, { actionId, captureId: capture.captureId, operation,
      ...(operation === 'commit' ? { message, author: { name: authorName, email: authorEmail } } : { paths: selected }) });
    if (!current(token)) return;
    if (value.actionId !== actionId || value.hostId !== host.id) throw new Error('Remote Git preparation receipt differs');
    observe(value, token);
  }
  const repo = capture?.repository;
  return <Panel title={t('Remote Git Review', 'Git Review на сервере')}>
    <p>{t('Read the selected repository, inspect changes and open files in the existing editor. Index changes and commits require a separate reviewed Apply. No fetch, checkout or push is performed.', 'Просмотрите выбранный репозиторий и изменения, открывайте файлы в существующем редакторе. Индекс и коммит меняются только после отдельного просмотра и подтверждения. Fetch, checkout и push не выполняются.')}</p>
    <p className="nk-remote-git__target"><strong>{host.label}</strong> · {host.username || 'SSH config'}@{host.hostname}:{host.port ?? 'SSH config'} · <code>{host.canonicalRoot ?? host.root}</code></p>
    {!host.connected && <Notice>{t('Connect this saved host explicitly before reading Git state.', 'Сначала явно подключите этот сервер.')}</Notice>}
    {error && <Notice tone="warning">{error}</Notice>}
    {stale && capture && <Notice tone="warning">{t('The retained review may be stale. Its bytes and commit draft are preserved. Refresh and prepare a new review before changing the repository.', 'Сохранённый просмотр мог устареть. Его содержимое и черновик коммита сохранены. Обновите данные и подготовьте новый просмотр перед изменением репозитория.')}</Notice>}
    {blocked && <Notice tone="warning">{t('A prior action has no confirmed released outcome. Refresh inspects that exact action; it never resends it. New mutations remain blocked.', 'Результат прежнего действия ещё не подтверждён. Обновление проверяет именно его и ничего не отправляет повторно. Новые изменения заблокированы.')}</Notice>}
    <div className="nk-remote__actions"><Button disabled={disabled || host.busy || busy} onClick={() => void perform(refresh, true)}>{t('Refresh Git review', 'Обновить Git Review')}</Button>
      {(pendingId || prunePending) && <code>{pendingId ?? prunePending}</code>}</div>
    {capture && <>
      <p>{t('Captured review folder', 'Папка сохранённого просмотра')}: <code>{capture.target.root}</code></p>
      <p>{t('Branch', 'Ветка')}: <strong>{repo?.headRef ?? t('Detached or unborn HEAD', 'Отдельный или ещё не созданный HEAD')}</strong> · HEAD <code>{repo?.headOid ?? t('No initial commit', 'Первый коммит ещё не создан')}</code></p>
      {!!repo?.mergeHeads.length && <Notice tone="warning">{t('Merge in progress. A resolved commit includes the displayed parents; unresolved files block commit.', 'Идёт слияние. Коммит разрешённого слияния включает показанных родителей; конфликты блокируют коммит.')} {repo.mergeHeads.join(', ')}</Notice>}
      {capture.limitations.map((line, index) => <Notice key={index} tone="warning">{limitationText(line)}</Notice>)}
      {capture.truncated && <Notice tone="warning">{t('The file listing is truncated; mutations are disabled for this incomplete review.', 'Список файлов сокращён; изменения по неполному просмотру отключены.')}</Notice>}
      <Select label={t('Comparison base', 'Основа сравнения')} value={baseId} disabled={locked || blocked} onChange={value => { setBaseId(value); setStale(true); invalidatePlan(); }} options={[{ value: '', label: t('Captured HEAD', 'Зафиксированный HEAD') }, ...(bases?.choices ?? []).map(row => ({ value: row.baseId, label: `${row.ref ?? row.kind} · ${row.oid ?? t('unborn', 'без коммита')}` }))]} />
      <div className="nk-remote-git__files">{capture.entries.map(entry => <div className="nk-remote-git__file" key={entry.path}>
        <Checkbox label={entry.originalPath ? `${entry.originalPath} → ${entry.path}` : entry.path} checked={selected.includes(entry.path)} disabled={locked || blocked} onChange={checked => { setSelected(rows => checked ? [...rows, entry.path] : rows.filter(path => path !== entry.path)); invalidatePlan(); }} />
        <span>{entry.kind === 'conflict' ? t('Unresolved conflict', 'Неразрешённый конфликт') : entry.kind === 'untracked' ? t('Untracked file', 'Неотслеживаемый файл') : [entry.indexStatus.trim() ? t('Staged change', 'Изменение в индексе') : '', entry.worktreeStatus.trim() ? t('Working file changed', 'Рабочий файл изменён') : ''].filter(Boolean).join(' · ')}</span>
        <Button size="sm" disabled={locked} onClick={() => void perform(async token => { const value = await api.remoteGitDiff(host.id, { captureId: capture.captureId, kind: diffKind, path: entry.path }); observeDiff(value, entry.path, token); })}>{t('Inspect changes', 'Просмотреть изменения')}</Button>
        <Button size="sm" disabled={locked || entry.binary === true} onClick={() => void perform(async token => { if (current(token)) await onOpenFile(entry.path); })}>{t('Open in file editor', 'Открыть в редакторе')}</Button>
        {entry.stages && <div>{entry.stages.map(stage => <Button key={stage.stage} size="sm" disabled={locked || ![1, 2, 3].includes(stage.stage)} onClick={() => void perform(async token => { const value = await api.remoteGitDiff(host.id, { captureId: capture.captureId, kind: 'conflict', path: entry.path, stage: stage.stage as 1 | 2 | 3 }); observeDiff(value, entry.path, token); })}>{t('Read', 'Читать')} {stage.stage === 1 ? t('base', 'основу') : stage.stage === 2 ? t('ours', 'нашу версию') : t('theirs', 'их версию')}</Button>)}</div>}
      </div>)}</div>
      <div className="nk-remote__actions"><Select label={t('Diff view', 'Вид изменений')} value={diffKind} disabled={locked} onChange={value => setDiffKind(value as RemoteGitReviewDiffInput['kind'])} options={[{ value: 'worktree', label: t('Working files', 'Рабочие файлы') }, { value: 'staged', label: t('Staged index', 'Индекс') }, { value: 'base', label: t('Against selected base', 'От выбранной основы') }]} />
        <Button disabled={locked} onClick={() => void perform(async token => { const value = await api.remoteGitDiff(host.id, { captureId: capture.captureId, kind: diffKind }); observeDiff(value, '', token); })}>{t('Read full diff', 'Прочитать полный diff')}</Button></div>
      {diff && <><p>{diffPath || t('All captured changes', 'Все зафиксированные изменения')} · {diff.kind} · {diff.state}</p>
        {(diff.binary || diff.truncated || diff.state !== 'current') && <Notice tone="warning">{diff.reason ?? t('Binary, bounded or unavailable content. This is not a complete editable text view.', 'Двоичное, сокращённое или недоступное содержимое. Это не полный редактируемый текст.')}</Notice>}
        <pre className="nk-remote-git__diff">{diff.text}</pre></>}
      <div className="nk-remote__actions"><Button disabled={!canMutate || !selected.length} onClick={() => void perform(token => prepare('stage', token))}>{t('Review stage selected', 'Просмотреть добавление выбранного')}</Button>
        <Button disabled={!canMutate || !selected.length} onClick={() => void perform(token => prepare('unstage', token))}>{t('Review unstage selected', 'Просмотреть исключение из индекса')}</Button></div>
      <h3>{t('Commit the complete staged tree', 'Коммит всего подготовленного индекса')}</h3>
      <p>{t('This includes every staged path, not only checked files. It does not stage working files. Review the complete path list and parents before Apply. The explicitly reviewed author is also the committer.', 'Включаются все подготовленные пути, а не только отмеченные файлы. Рабочие файлы автоматически не добавляются. Перед подтверждением проверьте полный список и родителей. Указанный автор также записывается как создатель коммита.')}</p>
      <label>{t('Commit message', 'Сообщение коммита')}<textarea className="nk-remote-git__message" aria-label={t('Commit message', 'Сообщение коммита')} value={message} maxLength={16384} readOnly={busy} onChange={event => { setMessage(event.target.value); invalidatePlan(); }} /></label>
      <div className="nk-remote__actions"><TextField label={t('Author name', 'Имя автора')} value={authorName} disabled={busy} onChange={event => { setAuthorName(event.target.value); invalidatePlan(); }} /><TextField label={t('Author email', 'Email автора')} value={authorEmail} disabled={busy} onChange={event => { setAuthorEmail(event.target.value); invalidatePlan(); }} />
        <Button disabled={!canMutate || !message.trim() || !authorName.trim() || !authorEmail.trim() || capture.entries.some(row => row.kind === 'conflict')} onClick={() => void perform(token => prepare('commit', token))}>{t('Review staged commit', 'Просмотреть коммит индекса')}</Button></div>
    </>}
    {action && <div className="nk-remote-git__review">
      <h3>{t('Reviewed action', 'Просмотренное действие')}: {action.operation} · {action.state}</h3>
      <p>{action.target.username}@{action.target.hostname}:{action.target.port} · <code>{action.target.root}</code></p>
      <p>{t('Branch', 'Ветка')}: {action.review.headRef ?? 'HEAD'} · {t('Parents', 'Родители')}: {action.review.parents.join(', ') || t('Initial commit: no parents', 'Первый коммит: без родителей')}</p>
      <p>{action.operation === 'commit' ? t('Staged paths changed from the parent', 'Подготовленные пути, изменённые относительно родителя') : t('Paths changed by this action', 'Пути, изменяемые этим действием')}</p>
      <ul>{action.review.paths.map(path => <li key={path}><code>{path}</code></li>)}</ul>
      {action.operation === 'commit' && <>
        <p>{t('Complete staged index', 'Полный состав индекса')}: {action.review.stagedEntries?.length ?? t('Unavailable — do not approve', 'Недоступен — не подтверждайте')}</p>
        <p>{t('Every entry below belongs to the committed tree, including paths unchanged from its parent. The explicitly reviewed author is also the committer.', 'Каждый путь ниже входит в дерево коммита, включая неизменённые относительно родителя. Указанный автор также записывается как создатель коммита.')}</p>
        <details className="nk-remote-git__details"><summary>{t('Inspect every staged index entry', 'Просмотреть все записи индекса')}</summary>
          <table><thead><tr><th>{t('Path', 'Путь')}</th><th>{t('Mode', 'Режим')}</th><th>OID</th><th>{t('Stage', 'Стадия')}</th></tr></thead>
            <tbody>{action.review.stagedEntries?.map(entry => <tr key={`${entry.path}:${entry.stage}`}><td><code>{entry.path}</code></td><td><code>{entry.mode}</code></td><td><code>{entry.oid}</code></td><td>{entry.stage}</td></tr>)}</tbody></table>
        </details>
      </>}
      {action.review.author && <p>{t('Author', 'Автор')}: {action.review.author.name} &lt;{action.review.author.email}&gt;</p>}
      {action.review.message && <pre className="nk-remote-git__diff">{action.review.message}</pre>}
      {action.review.limitations.map((line, index) => <Notice tone="warning" key={index}>{limitationText(line)}</Notice>)}
      {action.reason && <Notice tone="warning">{action.reason}</Notice>}
      {action.result?.commitOid && <p>{t('Created commit', 'Создан коммит')}: <code>{action.result.commitOid}</code></p>}
      <details className="nk-remote-git__details"><summary>{t('Verification details', 'Сведения проверки')}</summary><p>{action.actionId} · {action.reviewDigest}</p><p>{t('Owner held', 'Владелец удерживается')}: {String(action.ownerHeld)} · {t('Terminal', 'Завершено')}: {String(action.terminal)}</p><pre>{JSON.stringify(action.review.files, null, 2)}</pre></details>
      {action.state === 'reviewed' && <><Checkbox label={t('I reviewed this exact target and candidate. Apply only this action.', 'Я проверил точную цель и подготовленные изменения. Подтверждаю только это действие.')} checked={confirmed} disabled={!canMutate || !actionTargetCurrent || action.operation === 'commit' && !action.review.stagedEntries} onChange={setConfirmed} />
        <Button variant="primary" disabled={!canMutate || !confirmed || !actionTargetCurrent || action.operation === 'commit' && !action.review.stagedEntries} onClick={() => void perform(async token => {
          if (!confirmed || action.state !== 'reviewed' || actionContext.current !== token || !actionTargetCurrent || action.operation === 'commit' && !action.review.stagedEntries) return;
          setPendingId(action.actionId); setConfirmed(false);
          const value = await api.remoteGitApply(host.id, { actionId: action.actionId, reviewDigest: action.reviewDigest });
          if (!current(token)) return;
          if (value.actionId !== action.actionId || value.reviewDigest !== action.reviewDigest) throw new Error('Remote Git action receipt differs');
          observe(value, token);
        })}>{t('Apply reviewed action', 'Применить просмотренное действие')}</Button></>}
    </div>}
    {records.length > 0 && <details className="nk-remote-git__details"><summary>{t('Retained Git actions', 'Сохранённые действия Git')}</summary>{records.map(row => <div key={row.actionId}><p>{row.operation} · {row.state} · {row.actionId}</p><Button size="sm" disabled={locked} onClick={() => void perform(token => inspect(row.actionId, token))}>{t('Inspect exact action', 'Проверить точное действие')}</Button>
      {['reviewed', 'completed', 'failed'].includes(row.state) && !row.ownerHeld && <Button size="sm" disabled={disabled || host.busy || busy || blocked || !metadataReady} onClick={() => setForgetting(row)}>{t('Remove from local history', 'Убрать из локальной истории')}</Button>}
    </div>)}</details>}
    <Dialog open={Boolean(forgetting)} title={t('Remove this action from local history?', 'Убрать это действие из локальной истории?')} onClose={() => { if (!busy) setForgetting(null); }} actions={<>
      <Button disabled={busy} onClick={() => setForgetting(null)}>{t('Cancel', 'Отмена')}</Button>
      <Button disabled={disabled || host.busy || busy || blocked || !forgetting || !['reviewed', 'completed', 'failed'].includes(forgetting.state) || forgetting.ownerHeld} onClick={() => {
        const value = forgetting; if (!value) return;
        void perform(async token => {
          if (blocked || !['reviewed', 'completed', 'failed'].includes(value.state) || value.ownerHeld) return;
          setPrunePending(value.actionId); setForgetting(null); setConfirmed(false);
          const result = await api.remoteGitPruneActions(host.id, [value.actionId]);
          if (!current(token)) return;
          if (result.removed !== 1) throw new Error('Exact local history removal is unconfirmed');
          setPrunePending(null); setRecords(rows => rows.filter(row => row.actionId !== value.actionId));
          if (action?.actionId === value.actionId) { setAction(null); actionContext.current = null; }
        }, true);
      }}>{t('Remove only this local record', 'Убрать только эту локальную запись')}</Button>
    </>}>
      <p>{t('This removes only the selected local review and action record. It does not undo any remote Git effect or delete the remote action ledger. A previous approval cannot be restored or replayed from this record.', 'Удаляется только выбранная локальная запись просмотра и действия. Это не отменяет изменения Git на сервере и не удаляет удалённый журнал действия. Прежнее подтверждение нельзя восстановить или повторить из этой записи.')}</p>
      <p>{forgetting?.operation} · {forgetting?.actionId}</p>
    </Dialog>
  </Panel>;
}
