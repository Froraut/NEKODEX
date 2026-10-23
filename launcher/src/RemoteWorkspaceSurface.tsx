import { useEffect, useRef, useState } from 'react';
import type { Language } from './types';
import type { RemoteWorkspaceApi, RemoteHost, RemoteHostInput, RemoteListing, RemotePreview, RemoteDraft, RemoteReceipt, RemoteCommandApproval, RemoteCommandResult } from './remote-workspace-types';
import { Badge, BadgeRow, Button, Dialog, Notice, Page, Panel, PanelStack, Select, SurfaceHeader, TextField } from './design';
import './surfaces/remote-workspace.css';
import RemoteWorktreeControls from './RemoteWorktreeControls';
import RemoteGitReview from './RemoteGitReview';

const copy = {
  en: { title: 'Remote workspace', subtitle: 'Browse and edit a selected SSH folder with SFTP, then explicitly review any remote command.',
    hosts: 'SSH hosts', add: 'Add host', label: 'Name', hostname: 'Hostname or IP', user: 'SSH user', port: 'Port', root: 'Absolute POSIX folder',
    host: 'Selected host', connect: 'Connect', disconnect: 'Disconnect', forget: 'Remove host', security: 'Uses system OpenSSH, an existing SSH agent/key and known_hosts. Unknown or changed host keys are rejected. No password is saved. Optional aliases read a bounded Host subset from ~/.ssh/config only when you connect: HostName, User, Port, IdentityFile, IdentitiesOnly, HostKeyAlias, StrictHostKeyChecking yes, ConnectTimeout (1–60), ServerAliveInterval (1–300) and ServerAliveCountMax (1–10). Include, Match, proxy commands and other directives are unsupported. Changes require reconnection and fresh command approval.',
    status: 'Connection status', connected: 'Connected', connecting: 'Connecting', disconnected: 'Disconnected', active: 'An operation still owns this host', statusRefresh: 'Refresh status',
    cancelOperation: 'Cancel SSH transport', cancelling: 'Requesting cancellation…', cancellationPending: 'Transport cancellation requested; waiting for the operation receipt.', noActiveOperation: 'There is no active operation to cancel.',
    cancelHint: 'Cancels the local SSH connection. A remote process may continue; inspect its exact receipt and outcome before another mutation.', reconnectHint: 'Connect explicitly after the current operation settles. Previous command approvals cannot be reused.',
    previousPage: 'Previous', nextPage: 'Next', pageLimit: 'Directory scan limit reached. Enter a relative file path to open a file directly.', files: 'Files', refresh: 'Refresh', up: 'Parent folder', path: 'Relative file path', open: 'Open file', save: 'Save remote file', draft: 'Retain draft locally',
    filesNotLoaded: 'File list not loaded. Choose Refresh to read this folder.', filesConnect: 'Connect to this host, then choose Refresh to read its files.',
    emptyFolder: 'This folder is empty.', emptyPage: 'No entries on this page. Use the page controls or open a relative file path.',
    empty: 'Add a host, select it and connect. Connections start only when you choose Connect.', changed: 'Unsaved draft', retained: 'Draft retained locally', saved: 'Saved and read back from the remote host',
    binary: 'This binary file cannot be edited here.', missing: 'Saving creates a new file in this remote folder.', conflict: 'The remote version changed. Your draft is retained. Read the current version and deliberately choose a new baseline.',
    review: 'Read current remote version', baseline: 'Use this version as the save baseline', latest: 'Current remote version', drafts: 'Recoverable drafts', recover: 'Recover', discard: 'Discard draft',
    command: 'Remote command', commandHint: 'Runs with your SSH user permissions in the canonical folder. Commands can change the server. Review the exact target before every execution. Requires POSIX and python3 on the server.',
    timeout: 'Execution limit (seconds)', reviewCommand: 'Review command', execute: 'Execute on this host', cancel: 'Cancel', confirm: 'Execute this remote command?', output: 'Command output', truncated: 'Output is truncated.', history: 'Transaction history',
    reconciliation: 'Observed remote outcome', reconcile: 'Record observation and unblock', unknown: 'Outcome unknown. Inspect the remote host before retrying. The operation will not be replayed automatically.',
    limit: 'SFTP checks the revision immediately before atomic rename. SFTP v3 cannot exclude a simultaneous edit by another writer. Links and special files are blocked; use a folder you control.',
    savedHosts: 'Host settings saved. Connect explicitly to open the folder.', discardTitle: 'Discard this recovery draft?', discardBody: 'This removes only the local recovery draft. Remote files remain as they are.',
  },
  ru: { title: 'Удалённая рабочая область', subtitle: 'Открывайте и редактируйте выбранную папку SSH через SFTP. Каждая команда запускается после отдельного просмотра.',
    hosts: 'Серверы SSH', add: 'Добавить сервер', label: 'Название', hostname: 'Имя сервера или IP', user: 'Пользователь SSH', port: 'Порт', root: 'Абсолютный путь POSIX',
    host: 'Выбранный сервер', connect: 'Подключиться', disconnect: 'Отключиться', forget: 'Убрать сервер', security: 'Используются системный OpenSSH, существующий агент/ключ SSH и known_hosts. Неизвестные и изменившиеся ключи отклоняются. Пароль не сохраняется. Псевдоним читает ограниченный Host-блок ~/.ssh/config только при подключении: HostName, User, Port, IdentityFile, IdentitiesOnly, HostKeyAlias, StrictHostKeyChecking yes, ConnectTimeout (1–60), ServerAliveInterval (1–300) и ServerAliveCountMax (1–10). Include, Match, прокси-команды и другие директивы не поддерживаются. После изменения нужны переподключение и новое подтверждение команды.',
    status: 'Состояние подключения', connected: 'Подключено', connecting: 'Подключение', disconnected: 'Отключено', active: 'Сервер ещё занят операцией', statusRefresh: 'Обновить состояние',
    cancelOperation: 'Отменить соединение SSH', cancelling: 'Запрашивается отмена…', cancellationPending: 'Отмена соединения запрошена; ожидается квитанция операции.', noActiveOperation: 'Нет активной операции для отмены.',
    cancelHint: 'Отменяется локальное соединение SSH. Процесс на сервере может продолжаться; перед новым изменением проверьте точную квитанцию и результат.', reconnectHint: 'Подключитесь явно после завершения текущей операции. Прежние подтверждения команд повторно не используются.',
    previousPage: 'Назад', nextPage: 'Далее', pageLimit: 'Достигнут предел просмотра папки. Введите относительный путь файла, чтобы открыть его напрямую.', files: 'Файлы', refresh: 'Обновить', up: 'Родительская папка', path: 'Относительный путь файла', open: 'Открыть файл', save: 'Сохранить на сервере', draft: 'Сохранить черновик локально',
    filesNotLoaded: 'Список файлов ещё не загружен. Нажмите «Обновить», чтобы прочитать эту папку.', filesConnect: 'Подключитесь к серверу, затем нажмите «Обновить», чтобы прочитать список файлов.',
    emptyFolder: 'Эта папка пуста.', emptyPage: 'На этой странице нет записей. Перейдите на другую страницу или откройте файл по относительному пути.',
    empty: 'Добавьте сервер, выберите его и подключитесь. Подключение начинается только по кнопке «Подключиться».', changed: 'Есть несохранённый черновик', retained: 'Черновик сохранён локально', saved: 'Файл сохранён и прочитан с сервера',
    binary: 'Двоичный файл нельзя редактировать здесь.', missing: 'Сохранение создаст новый файл внутри этой папки.', conflict: 'Версия на сервере изменилась. Черновик сохранён. Прочитайте текущую версию и явно выберите новую основу сохранения.',
    review: 'Прочитать текущую версию', baseline: 'Использовать эту версию как основу', latest: 'Текущая версия на сервере', drafts: 'Сохранённые черновики', recover: 'Восстановить', discard: 'Удалить черновик',
    command: 'Команда на сервере', commandHint: 'Выполняется с правами пользователя SSH в канонической папке. Команды могут менять сервер. Перед каждым запуском проверьте точную цель. На сервере нужны POSIX и python3.',
    timeout: 'Лимит выполнения (секунд)', reviewCommand: 'Просмотреть команду', execute: 'Выполнить на этом сервере', cancel: 'Отмена', confirm: 'Выполнить эту команду на сервере?', output: 'Результат команды', truncated: 'Вывод сокращён.', history: 'История операций',
    reconciliation: 'Наблюдаемый результат на сервере', reconcile: 'Записать наблюдение и разблокировать', unknown: 'Результат неизвестен. Проверьте сервер перед повторением. Автоматического повтора не будет.',
    limit: 'SFTP проверяет версию непосредственно перед атомарным переименованием. SFTP v3 не исключает одновременное изменение другим процессом. Ссылки и специальные файлы заблокированы; выбирайте папку под вашим контролем.',
    savedHosts: 'Параметры сервера сохранены. Подключитесь явно, чтобы открыть папку.', discardTitle: 'Удалить сохранённый черновик?', discardBody: 'Будет удалён только локальный черновик. Файлы на сервере останутся как есть.',
  },
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
const initialHost: RemoteHostInput = { label: '', hostname: '', username: '', port: 22, root: '' };

export default function RemoteWorkspaceSurface({ language, api }: { language: Language; api: RemoteWorkspaceApi }) {
  const c = language === 'ru' ? copy.ru : copy.en;
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [selected, setSelected] = useState('');
  const [form, setForm] = useState(initialHost);
  const [editingHost, setEditingHost] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const cancellationOwner = useRef<string | null>(null);
  const hostsRequest = useRef(0);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const alive = useRef(true);
  const [drafts, setDrafts] = useState<RemoteDraft[]>([]);
  const [receipts, setReceipts] = useState<RemoteReceipt[]>([]);
  const [discarding, setDiscarding] = useState<RemoteDraft | null>(null);
  const [reconcileNotes, setReconcileNotes] = useState<Record<string, string>>({});
  const host = hosts.find(h => h.id === selected);
  const selection = useRef(selected); selection.current = selected;
  const editorDraft = useRef<{ hostId: string; path: string; text: string; expectedRevision: string | null; dirty: boolean } | null>(null);
  const draftQueue = useRef<Promise<unknown>>(Promise.resolve());
  const [listing, setListing] = useState<RemoteListing | null>(null);
  const [filePath, setFilePath] = useState('');
  const [createMode, setCreateMode] = useState(false);
  const [preview, setPreview] = useState<RemotePreview | null>(null);
  const [latest, setLatest] = useState<RemotePreview | null>(null);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [command, setCommand] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [approval, setApproval] = useState<RemoteCommandApproval | null>(null);
  const [output, setOutput] = useState<RemoteCommandResult | null>(null);

  async function refreshHosts() { const request = ++hostsRequest.current; const rows = await api.remoteWorkspaceHosts(); if (alive.current && request === hostsRequest.current) setHosts(rows); return rows; }
  async function refreshHost(id: string) {
    const [ds, rs] = await Promise.all([api.remoteWorkspaceDrafts(id), api.remoteWorkspaceReceipts(id)]);
    if (alive.current && selection.current === id) { setDrafts(ds); setReceipts(rs); }
  }
  useEffect(() => { alive.current = true; void refreshHosts().catch(e => { if (alive.current) setError(message(e)); }); return () => { alive.current = false;
    const draft = editorDraft.current; if (draft?.dirty) void retain(draft).catch(() => {});
  }; }, [api]);
  useEffect(() => {
    if (!selected) return;
    let retired = false, timer: ReturnType<typeof setTimeout> | undefined;
    // Local owner/receipt metadata only: no SSH startup or operation replay.
    async function observeOwner() {
      try { await refreshHosts(); if (!retired) await refreshHost(selected); }
      catch { /* The original action reports its failure. Explicit refresh remains available. */ }
      if (!retired) timer = setTimeout(() => void observeOwner(), 3000);
    }
    void observeOwner();
    return () => { retired = true; if (timer) clearTimeout(timer); };
  }, [api, selected, busy]);
  async function cancelTransport() {
    const cancel = api.remoteWorkspaceCancelOperation, id = selection.current;
    if (!cancel || !id || cancellationOwner.current) return;
    cancellationOwner.current = id; setCancelling(true);
    try {
      const draft = editorDraft.current;
      const result = await cancel(id);
      if (alive.current && selection.current === id) {
        setApproval(null); setListing(null);
        setNote(result.requested ? c.cancellationPending : c.noActiveOperation);
      }
      if (draft?.hostId === id && draft.dirty) await retain(draft);
      await refreshHosts(); await refreshHost(id);
    } catch (failure) { if (alive.current && selection.current === id) setError(message(failure)); }
    finally { cancellationOwner.current = null; if (alive.current) setCancelling(false); }
  }
  function retain(draft: NonNullable<typeof editorDraft.current>) {
    const work = draftQueue.current.catch(() => {}).then(() => api.remoteWorkspaceRetainDraft(draft.hostId, { path: draft.path, text: draft.text, expectedRevision: draft.expectedRevision }));
    draftQueue.current = work; return work;
  }
  async function act(action: () => Promise<void>) { setBusy(true); setError(''); setNote(''); try { await action(); } catch (e) { if (alive.current) setError(message(e)); }
    finally { if (alive.current) { setBusy(false); void refreshHosts().catch(() => {}); } } }
  async function keepCurrent() { const d = editorDraft.current; if (d?.dirty) { await retain(d); if (alive.current && selection.current === d.hostId) setNote(c.retained); } }
  async function choose(id: string) { await act(async () => { await keepCurrent(); setEditingHost(null); setForm(initialHost); setCreateMode(false); setSelected(id); selection.current = id; editorDraft.current = null;
    setPreview(null); setLatest(null); setListing(null); setText(''); setDirty(false); setFilePath(''); setOutput(null); setApproval(null); setReceipts([]); setDrafts([]); if (id) await refreshHost(id); }); }
  async function loadDirectory(id: string, directory: string, cursor: string | null = null) { const rows = await api.remoteWorkspaceListPage(id, directory, cursor); if (selection.current === id && alive.current) setListing(rows); }
  async function openFile(file: string, creating = false) { const id = selected; await act(async () => { await keepCurrent(); const p = await api.remoteWorkspacePreview(id, file); const ds = await api.remoteWorkspaceDrafts(id);
    if (selection.current !== id || !alive.current) return; if (creating && p.state !== 'missing') throw new Error(language === 'ru' ? 'Файл уже существует. Откройте его или выберите другой путь.' : 'A file already exists. Open it or choose another path.'); const draft = ds.find(d => d.path === file); const value = draft?.text ?? p.text ?? '';
    const baseline = draft ? { ...p, revision: draft.expectedRevision } : p;
    setPreview(baseline); setLatest(draft && draft.expectedRevision !== p.revision ? p : null); setText(value); setDirty(Boolean(draft) || creating); setCreateMode(false); setFilePath(file);
    editorDraft.current = { hostId: id, path: file, text: value, expectedRevision: baseline.revision, dirty: Boolean(draft) || creating }; await refreshHost(id);
  }); }
  function edit(value: string) { setText(value); setDirty(true); if (editorDraft.current) editorDraft.current = { ...editorDraft.current, text: value, dirty: true }; }
  const connected = Boolean(host?.connected);
  const unresolved = receipts.some(r => r.state === 'unknown') || Boolean(host?.unknownReceiptIds?.length);
  const operationBusy = busy || Boolean(host?.busy) || cancelling;
  return <Page className="nk-remote"><PanelStack><SurfaceHeader title={c.title} subtitle={c.subtitle} />
    {error && <Notice tone="error">{error}</Notice>}{note && <Notice>{note}</Notice>}
    <Panel title={c.hosts} className="nk-remote__panel"><details className="nk-remote__security"><summary>{language === 'ru' ? 'Правила подключения SSH' : 'SSH connection rules'}</summary><p>{c.security}</p></details><div className="nk-remote__host-form">
      <div className="nk-remote__wide-field nk-remote__labelled-select"><label htmlFor="nk-remote-connection-mode">{language === 'ru' ? 'Способ подключения' : 'Connection mode'}</label><Select id="nk-remote-connection-mode" label={language === 'ru' ? 'Способ подключения' : 'Connection mode'} value={form.connectionMode ?? 'direct'} disabled={operationBusy} options={[{ value: 'direct', label: language === 'ru' ? 'Явный сервер, пользователь и порт' : 'Explicit host, user and port' }, { value: 'ssh-config-alias', label: language === 'ru' ? 'Псевдоним Host из SSH config' : 'SSH config Host alias' }]} onChange={value => setForm({ ...form, connectionMode: value as 'direct' | 'ssh-config-alias', username: '', port: value === 'ssh-config-alias' ? null : 22 })} /></div>
      <TextField label={c.label} value={form.label} disabled={operationBusy} onChange={e => setForm({ ...form, label: e.target.value })} />
      <TextField label={form.connectionMode === 'ssh-config-alias' ? (language === 'ru' ? 'Псевдоним Host' : 'Host alias') : c.hostname} value={form.hostname} disabled={operationBusy} onChange={e => setForm({ ...form, hostname: e.target.value })} />
      <TextField label={c.user} value={form.username} placeholder={form.connectionMode === 'ssh-config-alias' ? (language === 'ru' ? 'Из config; иначе текущий пользователь' : 'From config; otherwise current user') : ''} disabled={operationBusy} onChange={e => setForm({ ...form, username: e.target.value })} />
      <TextField label={c.port} type="number" min={1} max={65535} value={form.port ?? ''} placeholder={form.connectionMode === 'ssh-config-alias' ? 'SSH config / 22' : ''} disabled={operationBusy} onChange={e => setForm({ ...form, port: e.target.value === '' && form.connectionMode === 'ssh-config-alias' ? null : Number(e.target.value) })} />
      <TextField className="nk-remote__wide-field" label={c.root} value={form.root} placeholder="/home/user/project" disabled={operationBusy} onChange={e => setForm({ ...form, root: e.target.value })} />
      <Button disabled={operationBusy || !form.label || !form.hostname || !form.root || form.connectionMode !== 'ssh-config-alias' && (!form.username || form.port === null)} onClick={() => void act(async () => {
        await keepCurrent(); const row = await api.remoteWorkspaceAddHost({ ...form, ...(editingHost ? { id: editingHost } : {}) }); await refreshHosts(); setForm(initialHost); setEditingHost(null); setSelected(row.id); selection.current = row.id; editorDraft.current = null; setPreview(null); setText(''); setDirty(false); setFilePath(''); setListing(null); setOutput(null); setApproval(null); setNote(c.savedHosts); await refreshHost(row.id);
      })}>{editingHost ? (language === 'ru' ? 'Сохранить изменения' : 'Save changes') : c.add}</Button>
      {editingHost && <Button disabled={operationBusy} onClick={() => { setForm(initialHost); setEditingHost(null); }}>{c.cancel}</Button>}
    </div>
      <div className="nk-remote__host-selection nk-remote__labelled-select"><label htmlFor="nk-remote-selected-host">{c.host}</label><Select id="nk-remote-selected-host" label={c.host} value={selected} disabled={operationBusy} options={[{ value: '', label: '—' }, ...hosts.map(h => ({ value: h.id, label: `${h.label} · ${h.sshAlias ? `${h.sshAlias} → ` : ''}${h.username || 'SSH config'}@${h.hostname}:${h.port ?? 'SSH config'}` }))]} onChange={value => void choose(value)} /></div>
      {host && <div className="nk-remote__host-status">
        <p className="nk-remote__identity"><code>{host.sshAlias ? `${host.sshAlias} → ` : ''}{host.username || 'SSH config'}@{host.hostname}:{host.port ?? 'SSH config'}</code> <code>{host.canonicalRoot ?? host.root}</code></p>
        {host.sshAlias && !host.aliasResolved && <p>{language === 'ru' ? 'Цель ещё не определена: подключитесь явно' : 'Destination unresolved: connect explicitly'}</p>}
        <div className="nk-remote__status" role="status" aria-live="polite">
          <span>{c.status}</span>
          <BadgeRow>
            <Badge tone={host.connectionState === 'connecting' ? 'warning' : host.connected ? 'success' : 'neutral'} dot={host.connectionState === 'connecting' ? 'busy' : host.connected ? 'ready' : 'idle'}>{host.connectionState === 'connecting' ? c.connecting : host.connected ? c.connected : c.disconnected}</Badge>
            {(busy || host.busy) && <Badge tone="warning" dot="busy">{c.active}</Badge>}
          </BadgeRow>
        </div>
        {(busy || host.busy || host.cancellationRequested) && <Notice tone="warning">{host.cancellationRequested ? c.cancellationPending : c.cancelHint}</Notice>}
        {host.reconnectRequired && !host.connected && <Notice>{c.reconnectHint}</Notice>}
        {unresolved && <Notice tone="warning">{c.unknown}</Notice>}
      </div>}
      <div className="nk-remote__actions nk-remote__host-actions">
        <Button disabled={operationBusy || !host} onClick={() => { if (!host) return; const endpoint = host.configuredEndpoint ?? host; setForm({ label: host.label, hostname: endpoint.hostname, username: endpoint.username, port: endpoint.port, connectionMode: endpoint.connectionMode, root: host.root }); setEditingHost(host.id); }}>{language === 'ru' ? 'Изменить сервер / название' : 'Edit host / rename'}</Button>
        <Button disabled={operationBusy || !host || connected} onClick={() => void act(async () => { await api.remoteWorkspaceConnect(selected); await refreshHosts(); await loadDirectory(selected, ''); await refreshHost(selected); })}>{c.connect}</Button>
        <Button disabled={operationBusy || !connected} onClick={() => void act(async () => { await keepCurrent(); await api.remoteWorkspaceDisconnect(selected); setListing(null); setApproval(null); })}>{c.disconnect}</Button>
        <Button disabled={!host || cancelling || !(busy || host.busy) || Boolean(host.cancellationRequested) || !api.remoteWorkspaceCancelOperation} onClick={() => void cancelTransport()}>{cancelling ? c.cancelling : c.cancelOperation}</Button>
        <Button disabled={cancelling || !host} onClick={() => { const id = selected; void Promise.all([refreshHosts(), refreshHost(id)]).catch(failure => { if (alive.current && selection.current === id) setError(message(failure)); }); }}>{c.statusRefresh}</Button>
        <Button disabled={operationBusy || !host || drafts.length > 0} onClick={() => void act(async () => { await keepCurrent(); await api.remoteWorkspaceForgetHost(selected); setSelected(''); selection.current = ''; setPreview(null); editorDraft.current = null; setListing(null); setReceipts([]); })}>{c.forget}</Button>
      </div>
      {!host && <p>{c.empty}</p>}
    </Panel>
    {host && <><div className="nk-remote__columns"><Panel title={c.files} className="nk-remote__panel">
      <div className="nk-remote__actions"><Button size="sm" disabled={operationBusy || !connected} onClick={() => void act(() => loadDirectory(selected, listing?.path ?? ''))}>{c.refresh}</Button>
        <Button size="sm" disabled={operationBusy || !connected || !listing?.path} onClick={() => void act(() => loadDirectory(selected, listing!.path.split('/').slice(0, -1).join('/')))}>{c.up}</Button></div>
      <p><code>{listing?.path || '/'}</code></p>
      <div className="nk-remote__files">{listing?.entries.map(e => <button type="button" key={e.path} disabled={operationBusy || e.kind === 'blocked'} onClick={() => e.kind === 'directory' ? void act(() => loadDirectory(selected, e.path)) : void openFile(e.path)}><span aria-hidden="true">{e.kind === 'directory' ? '▸ ' : e.kind === 'file' ? '· ' : '↗ '}</span>{e.name}</button>)}</div>
      {!listing && <p role="status">{connected ? c.filesNotLoaded : c.filesConnect}</p>}
      {listing && !listing.entries.length && <p role="status">{listing.previousCursor || listing.nextCursor || listing.scanLimited || listing.truncated ? c.emptyPage : c.emptyFolder}</p>}
      {listing && <div className="nk-remote__actions">
        <Button size="sm" disabled={operationBusy || !connected || !listing.previousCursor} onClick={() => void act(() => loadDirectory(selected, listing.path, listing.previousCursor!))}>{c.previousPage}</Button>
        <Button size="sm" disabled={operationBusy || !connected || !listing.nextCursor} onClick={() => void act(() => loadDirectory(selected, listing.path, listing.nextCursor!))}>{c.nextPage}</Button>
      </div>}
      {listing?.scanLimited && <p>{c.pageLimit}</p>}
      <div className="nk-remote__actions nk-remote__path-actions"><Button size="sm" disabled={operationBusy || !connected} onClick={() => { setCreateMode(true); setFilePath(''); }}>{language === 'ru' ? 'Новый файл' : 'New file'}</Button>
      {createMode && <p>{language === 'ru' ? 'Укажите путь внутри папки. Новый файл появится после сохранения.' : 'Enter a path inside this folder. The new file is created when you Save.'}</p>}
      <TextField label={c.path} value={filePath} disabled={operationBusy} onChange={e => setFilePath(e.target.value)} /><Button disabled={operationBusy || !connected || !filePath} onClick={() => void openFile(filePath, createMode)}>{createMode ? (language === 'ru' ? 'Подготовить новый файл' : 'Prepare new file') : c.open}</Button>{createMode && <Button disabled={operationBusy} onClick={() => setCreateMode(false)}>{c.cancel}</Button>}</div>
    </Panel><Panel title={preview?.path ?? c.files} className="nk-remote__panel">
      <p>{c.limit}</p>{dirty && <BadgeRow role="status"><Badge tone="warning">{c.changed}</Badge></BadgeRow>}
      {preview?.state === 'binary' && <Notice>{c.binary}</Notice>}{preview?.state === 'missing' && <p>{c.missing}</p>}
      {preview && <textarea className="nk-remote__editor" aria-label={preview.path} spellCheck={false} value={text} readOnly={operationBusy || preview.state === 'binary'} onChange={e => edit(e.target.value)} />}
      <div className="nk-remote__actions"><Button disabled={operationBusy || !dirty} onClick={() => void act(async () => { await keepCurrent(); await refreshHost(selected); })}>{c.draft}</Button>
      <Button variant="primary" disabled={operationBusy || !connected || !dirty || preview?.state === 'binary' || unresolved || Boolean(latest)} onClick={() => void act(async () => {
        const d = editorDraft.current; if (!d) return; await draftQueue.current.catch(() => {}); const result = await api.remoteWorkspaceSave(d.hostId, { path: d.path, text: d.text, expectedRevision: d.expectedRevision });
        if (selection.current !== d.hostId || !alive.current) return;
        if (result.state === 'saved') { setDirty(false); setPreview(p => p && { ...p, state: 'text', revision: result.revision }); editorDraft.current = { ...d, expectedRevision: result.revision, dirty: false }; setNote(c.saved); }
        else { setError(result.state === 'conflict' ? c.conflict : result.receipt.message ?? c.unknown); if (result.state === 'conflict') setLatest(await api.remoteWorkspacePreview(d.hostId, d.path)); }
        await refreshHost(d.hostId);
      })}>{c.save}</Button>
      <Button disabled={operationBusy || !connected || !preview} onClick={() => void act(async () => { const current = await api.remoteWorkspacePreview(selected, preview!.path); setLatest(current); })}>{c.review}</Button></div>
      {latest && <div className="nk-remote__latest"><h3>{c.latest}</h3><pre className="nk-remote__output">{latest.text ?? c.binary}</pre><Button disabled={operationBusy || latest.state === 'binary'} onClick={() => {
        setPreview(latest); if (editorDraft.current) editorDraft.current = { ...editorDraft.current, expectedRevision: latest.revision }; setLatest(null);
      }}>{c.baseline}</Button></div>}
    </Panel></div>
    {drafts.length > 0 && <Panel title={c.drafts} className="nk-remote__panel">{drafts.map(d => <div key={d.id} className="nk-remote__draft"><code>{d.path}</code><Button size="sm" disabled={operationBusy || !connected} onClick={() => void openFile(d.path)}>{c.recover}</Button><Button size="sm" disabled={operationBusy} onClick={() => setDiscarding(d)}>{c.discard}</Button></div>)}</Panel>}
    <RemoteWorktreeControls key={host.id} host={host} api={api} language={language} disabled={operationBusy} mutationBlocked={unresolved} onChanged={() => refreshHost(host.id)} onOpen={async opened => { await refreshHosts(); await choose(opened.id); }} />
    <RemoteGitReview host={host} api={api} language={language} disabled={operationBusy} mutationBlocked={unresolved} onOpenFile={openFile} />
    <Panel title={c.command} className="nk-remote__panel"><p>{c.commandHint}</p>
      <textarea className="nk-remote__command" aria-label={c.command} value={command} readOnly={operationBusy} spellCheck={false} onChange={e => { setCommand(e.target.value); setApproval(null); }} />
      <div className="nk-remote__actions"><TextField label={c.timeout} type="number" min={1} max={3600} value={timeoutSeconds} disabled={operationBusy} onChange={e => { setTimeoutSeconds(Number(e.target.value)); setApproval(null); }} />
      <Button disabled={operationBusy || !connected || !command.trim() || unresolved} onClick={() => void act(async () => { setApproval(await api.remoteWorkspaceApproveCommand(selected, { command, timeoutSeconds })); })}>{c.reviewCommand}</Button></div>
      {output && <><h3>{c.output} · {output.exitCode ?? '?'}</h3><pre className="nk-remote__output">{output.stdout}{output.stderr}</pre>{output.truncated && <p>{c.truncated}</p>}{output.stopped && <Notice tone="warning">{output.stopped}</Notice>}{output.receipt.state === 'unknown' && <Notice tone="warning">{c.unknown}</Notice>}</>}
    </Panel>
    <Panel title={c.history} className="nk-remote__panel">{receipts.slice().reverse().map(r => <div key={r.id} className="nk-remote__receipt"><p><time>{new Date(r.time).toLocaleString(language)}</time> · {r.kind} · {r.state}</p><code>{r.path ?? r.command ?? r.root}</code>{r.message && <p>{r.message}</p>}
      {r.temporaryPath && <p><code>{r.temporaryPath}</code></p>}{r.state === 'unknown' && <><Notice tone="warning">{c.unknown}</Notice>{r.kind.startsWith('git-') ? <p>{language === 'ru' ? 'Для Git используйте проверку точного действия в Git Review выше. Текстовое подтверждение не устанавливает результат Git.' : 'Use exact action inspection in Git Review above. A text acknowledgement cannot establish the Git outcome.'}</p> : <><TextField label={c.reconciliation} value={reconcileNotes[r.id] ?? ''} disabled={operationBusy} onChange={e => setReconcileNotes({ ...reconcileNotes, [r.id]: e.target.value })} /><Button disabled={operationBusy || (reconcileNotes[r.id]?.trim().length ?? 0) < 8} onClick={() => void act(async () => { await api.remoteWorkspaceReconcile(selected, r.id, reconcileNotes[r.id]); await refreshHost(selected); })}>{c.reconcile}</Button></>}</>}
    </div>)}</Panel></>}
    </PanelStack><Dialog className="nk-remote__dialog" open={Boolean(approval)} title={c.confirm} onClose={() => { if (!operationBusy) setApproval(null); }} actions={<><Button disabled={operationBusy} onClick={() => setApproval(null)}>{c.cancel}</Button><Button variant="primary" disabled={operationBusy} busy={busy} onClick={() => { const value = approval; if (!value) return; void act(async () => {
      setApproval(null); const result = await api.remoteWorkspaceExecuteCommand(value.hostId, value.token); if (alive.current && selection.current === value.hostId) setOutput(result); await refreshHost(value.hostId);
    }); }}>{c.execute}</Button></>}>
      {approval && <><p><strong>{approval.username}@{approval.hostname}:{approval.port}</strong></p><p><code>{approval.root}</code></p><pre className="nk-remote__output">{approval.command}</pre><p>{c.timeout}: {approval.timeoutSeconds}</p></>}
    </Dialog>
    <Dialog className="nk-remote__dialog" open={Boolean(discarding)} title={c.discardTitle} onClose={() => { if (!operationBusy) setDiscarding(null); }} actions={<><Button disabled={operationBusy} onClick={() => setDiscarding(null)}>{c.cancel}</Button><Button disabled={operationBusy} onClick={() => { const d = discarding; if (!d) return; void act(async () => {
      await api.remoteWorkspaceDiscardDraft(d.hostId, d.id); if (editorDraft.current?.hostId === d.hostId && editorDraft.current.path === d.path) { editorDraft.current = null; setPreview(null); setDirty(false); } setDiscarding(null); await refreshHost(d.hostId);
    }); }}>{c.discard}</Button></>}><p>{c.discardBody}</p><p><code>{discarding?.path}</code></p></Dialog>
  </Page>;
}
