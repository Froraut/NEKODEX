import { useEffect, useRef, useState } from 'react';
import type { Language } from './types';
import type { RemoteWorkspaceApi, RemoteHost, RemoteHostInput, RemoteListing, RemotePreview, RemoteDraft, RemoteReceipt, RemoteCommandApproval, RemoteCommandResult } from './remote-workspace-types';
import { Button, Dialog, Notice, Page, Panel, Select, SurfaceHeader, TextField } from './design';
import './surfaces/remote-workspace.css';
import RemoteWorktreeControls from './RemoteWorktreeControls';

const copy = {
  en: { title: 'Remote workspace', subtitle: 'Browse and edit a selected SSH folder with SFTP, then explicitly review any remote command.',
    hosts: 'SSH hosts', add: 'Add host', label: 'Name', hostname: 'Hostname or IP', user: 'SSH user', port: 'Port', root: 'Absolute POSIX folder',
    host: 'Selected host', connect: 'Connect', disconnect: 'Disconnect', forget: 'Remove host', security: 'Uses system OpenSSH, an existing SSH agent/key and known_hosts. Unknown or changed host keys are rejected. No password is saved. SSH config aliases and proxy commands are not loaded.',
    files: 'Files', refresh: 'Refresh', up: 'Parent folder', path: 'Relative file path', open: 'Open file', save: 'Save remote file', draft: 'Retain draft locally',
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
    host: 'Выбранный сервер', connect: 'Подключиться', disconnect: 'Отключиться', forget: 'Убрать сервер', security: 'Используются системный OpenSSH, существующий агент/ключ SSH и known_hosts. Неизвестные и изменившиеся ключи отклоняются. Пароль не сохраняется. Псевдонимы и прокси-команды SSH config не загружаются.',
    files: 'Файлы', refresh: 'Обновить', up: 'Родительская папка', path: 'Относительный путь файла', open: 'Открыть файл', save: 'Сохранить на сервере', draft: 'Сохранить черновик локально',
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
  const [busy, setBusy] = useState(false);
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
  const [preview, setPreview] = useState<RemotePreview | null>(null);
  const [latest, setLatest] = useState<RemotePreview | null>(null);
  const [text, setText] = useState('');
  const [dirty, setDirty] = useState(false);
  const [command, setCommand] = useState('');
  const [timeoutSeconds, setTimeoutSeconds] = useState(60);
  const [approval, setApproval] = useState<RemoteCommandApproval | null>(null);
  const [output, setOutput] = useState<RemoteCommandResult | null>(null);

  async function refreshHosts() { const rows = await api.remoteWorkspaceHosts(); if (alive.current) setHosts(rows); return rows; }
  async function refreshHost(id: string) {
    const [ds, rs] = await Promise.all([api.remoteWorkspaceDrafts(id), api.remoteWorkspaceReceipts(id)]);
    if (alive.current && selection.current === id) { setDrafts(ds); setReceipts(rs); }
  }
  useEffect(() => { alive.current = true; void refreshHosts().catch(e => { if (alive.current) setError(message(e)); }); return () => { alive.current = false;
    const draft = editorDraft.current; if (draft?.dirty) void retain(draft).catch(() => {});
  }; }, [api]);
  function retain(draft: NonNullable<typeof editorDraft.current>) {
    const work = draftQueue.current.catch(() => {}).then(() => api.remoteWorkspaceRetainDraft(draft.hostId, { path: draft.path, text: draft.text, expectedRevision: draft.expectedRevision }));
    draftQueue.current = work; return work;
  }
  async function act(action: () => Promise<void>) { setBusy(true); setError(''); setNote(''); try { await action(); } catch (e) { if (alive.current) setError(message(e)); }
    finally { if (alive.current) { setBusy(false); void refreshHosts().catch(() => {}); } } }
  async function keepCurrent() { const d = editorDraft.current; if (d?.dirty) { await retain(d); if (alive.current && selection.current === d.hostId) setNote(c.retained); } }
  async function choose(id: string) { await act(async () => { await keepCurrent(); setSelected(id); selection.current = id; editorDraft.current = null;
    setPreview(null); setLatest(null); setListing(null); setText(''); setDirty(false); setFilePath(''); setOutput(null); setApproval(null); setReceipts([]); setDrafts([]); if (id) await refreshHost(id); }); }
  async function loadDirectory(id: string, directory: string) { const rows = await api.remoteWorkspaceList(id, directory); if (selection.current === id && alive.current) setListing(rows); }
  async function openFile(file: string) { const id = selected; await act(async () => { await keepCurrent(); const p = await api.remoteWorkspacePreview(id, file); const ds = await api.remoteWorkspaceDrafts(id);
    if (selection.current !== id || !alive.current) return; const draft = ds.find(d => d.path === file); const value = draft?.text ?? p.text ?? '';
    const baseline = draft ? { ...p, revision: draft.expectedRevision } : p;
    setPreview(baseline); setLatest(draft && draft.expectedRevision !== p.revision ? p : null); setText(value); setDirty(Boolean(draft)); setFilePath(file);
    editorDraft.current = { hostId: id, path: file, text: value, expectedRevision: baseline.revision, dirty: Boolean(draft) }; await refreshHost(id);
  }); }
  function edit(value: string) { setText(value); setDirty(true); if (editorDraft.current) editorDraft.current = { ...editorDraft.current, text: value, dirty: true }; }
  const connected = Boolean(host?.connected);
  const unresolved = receipts.some(r => r.state === 'unknown');
  return <Page><SurfaceHeader title={c.title} subtitle={c.subtitle} />
    {error && <Notice tone="error">{error}</Notice>}{note && <p role="status">{note}</p>}
    <Panel title={c.hosts}><p>{c.security}</p><div className="nk-remote__host-form">
      <TextField label={c.label} value={form.label} disabled={busy} onChange={e => setForm({ ...form, label: e.target.value })} />
      <TextField label={c.hostname} value={form.hostname} disabled={busy} onChange={e => setForm({ ...form, hostname: e.target.value })} />
      <TextField label={c.user} value={form.username} disabled={busy} onChange={e => setForm({ ...form, username: e.target.value })} />
      <TextField label={c.port} type="number" min={1} max={65535} value={form.port} disabled={busy} onChange={e => setForm({ ...form, port: Number(e.target.value) })} />
      <TextField label={c.root} value={form.root} placeholder="/home/user/project" disabled={busy} onChange={e => setForm({ ...form, root: e.target.value })} />
      <Button disabled={busy || !form.label || !form.hostname || !form.username || !form.root} onClick={() => void act(async () => {
        await keepCurrent(); const row = await api.remoteWorkspaceAddHost(form); await refreshHosts(); setForm(initialHost); setSelected(row.id); selection.current = row.id; editorDraft.current = null; setPreview(null); setText(''); setDirty(false); setFilePath(''); setListing(null); setOutput(null); setApproval(null); setNote(c.savedHosts); await refreshHost(row.id);
      })}>{c.add}</Button>
    </div>
      <div className="nk-remote__actions"><Select label={c.host} value={selected} disabled={busy} options={[{ value: '', label: '—' }, ...hosts.map(h => ({ value: h.id, label: `${h.label} · ${h.username}@${h.hostname}:${h.port}` }))]} onChange={value => void choose(value)} />
        <Button disabled={busy || !host || connected} onClick={() => void act(async () => { await api.remoteWorkspaceConnect(selected); await refreshHosts(); await loadDirectory(selected, ''); await refreshHost(selected); })}>{c.connect}</Button>
        <Button disabled={busy || !connected} onClick={() => void act(async () => { await keepCurrent(); await api.remoteWorkspaceDisconnect(selected); setListing(null); setApproval(null); })}>{c.disconnect}</Button>
        <Button disabled={busy || !host || drafts.length > 0} onClick={() => void act(async () => { await keepCurrent(); await api.remoteWorkspaceForgetHost(selected); setSelected(''); selection.current = ''; setPreview(null); editorDraft.current = null; setListing(null); setReceipts([]); })}>{c.forget}</Button>
      </div>{host && <p><code>{host.username}@{host.hostname}:{host.port}{host.canonicalRoot ?? host.root}</code></p>}
      {!host && <p>{c.empty}</p>}
    </Panel>
    {host && <><div className="nk-remote__columns"><Panel title={c.files}>
      <div className="nk-remote__actions"><Button size="sm" disabled={busy || !connected} onClick={() => void act(() => loadDirectory(selected, listing?.path ?? ''))}>{c.refresh}</Button>
        <Button size="sm" disabled={busy || !connected || !listing?.path} onClick={() => void act(() => loadDirectory(selected, listing!.path.split('/').slice(0, -1).join('/')))}>{c.up}</Button></div>
      <p><code>{listing?.path || '/'}</code></p>
      <div className="nk-remote__files">{listing?.entries.map(e => <button type="button" key={e.path} disabled={busy || e.kind === 'blocked'} onClick={() => e.kind === 'directory' ? void act(() => loadDirectory(selected, e.path)) : void openFile(e.path)}><span aria-hidden="true">{e.kind === 'directory' ? '▸ ' : e.kind === 'file' ? '· ' : '↗ '}</span>{e.name}</button>)}</div>
      {listing?.truncated && <p>300 {c.files.toLowerCase()}…</p>}
      <div className="nk-remote__actions"><TextField label={c.path} value={filePath} disabled={busy} onChange={e => setFilePath(e.target.value)} /><Button disabled={busy || !connected || !filePath} onClick={() => void openFile(filePath)}>{c.open}</Button></div>
    </Panel><Panel title={preview?.path ?? c.files}>
      <p>{c.limit}</p>{dirty && <p role="status">{c.changed}</p>}
      {preview?.state === 'binary' && <Notice>{c.binary}</Notice>}{preview?.state === 'missing' && <p>{c.missing}</p>}
      {preview && <textarea className="nk-remote__editor" aria-label={preview.path} spellCheck={false} value={text} readOnly={busy || preview.state === 'binary'} onChange={e => edit(e.target.value)} />}
      <div className="nk-remote__actions"><Button disabled={busy || !dirty} onClick={() => void act(async () => { await keepCurrent(); await refreshHost(selected); })}>{c.draft}</Button>
      <Button variant="primary" disabled={busy || !connected || !dirty || preview?.state === 'binary' || unresolved || Boolean(latest)} onClick={() => void act(async () => {
        const d = editorDraft.current; if (!d) return; await draftQueue.current.catch(() => {}); const result = await api.remoteWorkspaceSave(d.hostId, { path: d.path, text: d.text, expectedRevision: d.expectedRevision });
        if (selection.current !== d.hostId || !alive.current) return;
        if (result.state === 'saved') { setDirty(false); setPreview(p => p && { ...p, state: 'text', revision: result.revision }); editorDraft.current = { ...d, expectedRevision: result.revision, dirty: false }; setNote(c.saved); }
        else { setError(result.state === 'conflict' ? c.conflict : result.receipt.message ?? c.unknown); if (result.state === 'conflict') setLatest(await api.remoteWorkspacePreview(d.hostId, d.path)); }
        await refreshHost(d.hostId);
      })}>{c.save}</Button>
      <Button disabled={busy || !connected || !preview} onClick={() => void act(async () => { const current = await api.remoteWorkspacePreview(selected, preview!.path); setLatest(current); })}>{c.review}</Button></div>
      {latest && <div><h3>{c.latest}</h3><pre className="nk-remote__output">{latest.text ?? c.binary}</pre><Button disabled={busy || latest.state === 'binary'} onClick={() => {
        setPreview(latest); if (editorDraft.current) editorDraft.current = { ...editorDraft.current, expectedRevision: latest.revision }; setLatest(null);
      }}>{c.baseline}</Button></div>}
    </Panel></div>
    {drafts.length > 0 && <Panel title={c.drafts}>{drafts.map(d => <div key={d.id} className="nk-remote__actions"><code>{d.path}</code><Button size="sm" disabled={busy || !connected} onClick={() => void openFile(d.path)}>{c.recover}</Button><Button size="sm" disabled={busy} onClick={() => setDiscarding(d)}>{c.discard}</Button></div>)}</Panel>}
    <RemoteWorktreeControls key={host.id} host={host} api={api} language={language} disabled={busy} mutationBlocked={unresolved} onChanged={() => refreshHost(host.id)} onOpen={async opened => { await refreshHosts(); await choose(opened.id); }} />
    <Panel title={c.command}><p>{c.commandHint}</p>
      <textarea className="nk-remote__command" aria-label={c.command} value={command} readOnly={busy} spellCheck={false} onChange={e => { setCommand(e.target.value); setApproval(null); }} />
      <div className="nk-remote__actions"><TextField label={c.timeout} type="number" min={1} max={3600} value={timeoutSeconds} disabled={busy} onChange={e => { setTimeoutSeconds(Number(e.target.value)); setApproval(null); }} />
      <Button disabled={busy || !connected || !command.trim() || unresolved} onClick={() => void act(async () => { setApproval(await api.remoteWorkspaceApproveCommand(selected, { command, timeoutSeconds })); })}>{c.reviewCommand}</Button></div>
      {output && <><h3>{c.output} · {output.exitCode ?? '?'}</h3><pre className="nk-remote__output">{output.stdout}{output.stderr}</pre>{output.truncated && <p>{c.truncated}</p>}{output.stopped && <Notice tone="warning">{output.stopped}</Notice>}{output.receipt.state === 'unknown' && <Notice tone="warning">{c.unknown}</Notice>}</>}
    </Panel>
    <Panel title={c.history}>{receipts.slice().reverse().map(r => <div key={r.id} className="nk-remote__receipt"><p><time>{new Date(r.time).toLocaleString(language)}</time> · {r.kind} · {r.state}</p><code>{r.path ?? r.command ?? r.root}</code>{r.message && <p>{r.message}</p>}
      {r.temporaryPath && <p><code>{r.temporaryPath}</code></p>}{r.state === 'unknown' && <><Notice tone="warning">{c.unknown}</Notice><TextField label={c.reconciliation} value={reconcileNotes[r.id] ?? ''} disabled={busy} onChange={e => setReconcileNotes({ ...reconcileNotes, [r.id]: e.target.value })} /><Button disabled={busy || (reconcileNotes[r.id]?.trim().length ?? 0) < 8} onClick={() => void act(async () => { await api.remoteWorkspaceReconcile(selected, r.id, reconcileNotes[r.id]); await refreshHost(selected); })}>{c.reconcile}</Button></>}
    </div>)}</Panel></>}
    <Dialog open={Boolean(approval)} title={c.confirm} onClose={() => { if (!busy) setApproval(null); }} actions={<><Button disabled={busy} onClick={() => setApproval(null)}>{c.cancel}</Button><Button variant="primary" busy={busy} onClick={() => { const value = approval; if (!value) return; void act(async () => {
      setApproval(null); const result = await api.remoteWorkspaceExecuteCommand(value.hostId, value.token); if (alive.current && selection.current === value.hostId) setOutput(result); await refreshHost(value.hostId);
    }); }}>{c.execute}</Button></>}>
      {approval && <><p><strong>{approval.username}@{approval.hostname}:{approval.port}</strong></p><p><code>{approval.root}</code></p><pre className="nk-remote__output">{approval.command}</pre><p>{c.timeout}: {approval.timeoutSeconds}</p></>}
    </Dialog>
    <Dialog open={Boolean(discarding)} title={c.discardTitle} onClose={() => { if (!busy) setDiscarding(null); }} actions={<><Button disabled={busy} onClick={() => setDiscarding(null)}>{c.cancel}</Button><Button disabled={busy} onClick={() => { const d = discarding; if (!d) return; void act(async () => {
      await api.remoteWorkspaceDiscardDraft(d.hostId, d.id); if (editorDraft.current?.hostId === d.hostId && editorDraft.current.path === d.path) { editorDraft.current = null; setPreview(null); setDirty(false); } setDiscarding(null); await refreshHost(d.hostId);
    }); }}>{c.discard}</Button></>}><p>{c.discardBody}</p><code>{discarding?.path}</code></Dialog>
  </Page>;
}
