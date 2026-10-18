import { useEffect, useRef, useState } from 'react';
import { Button, Dialog, Notice, Panel, TextField } from './design';
import type { Language } from './types';
import type { RemoteHost, RemoteWorkspaceApi } from './remote-workspace-types';
import type { RemoteGitSnapshot, RemoteManagedWorktree, RemoteWorktreePlan, RemoteWorktreeArchivePlan } from '../electron/remote-worktrees.cjs';

export default function RemoteWorktreeControls({ host, api, language, disabled = false, mutationBlocked = false, onChanged, onOpen }: {
  host: RemoteHost; api: RemoteWorkspaceApi; language: Language; disabled?: boolean; mutationBlocked?: boolean; onChanged: () => Promise<void>; onOpen: (host: RemoteHost) => Promise<void>;
}) {
  const ru = language === 'ru';
  const c = ru ? {
    title: 'Управляемые рабочие деревья SSH', inspect: 'Получить HEAD и рабочие деревья', name: 'Имя новой ветки codex/', review: 'Просмотреть создание', create: 'Создать на сервере',
    createTitle: 'Создать это рабочее дерево на сервере?', parent: 'Разрешаемая родительская папка', head: 'Зафиксированный HEAD', branch: 'Новая ветка', target: 'Точная папка',
    cancel: 'Отмена', refresh: 'Обновить список', inspectOwned: 'Проверить владение и изменения', archive: 'Просмотреть архивирование', archiveTitle: 'Архивировать с сохранением всей папки?', confirmArchive: 'Архивировать и сохранить папку',
    open: 'Открыть как удалённую рабочую область', keep: 'Архивирование сохраняет рабочую папку, ветку и все изменённые, неотслеживаемые и игнорируемые файлы. Создаётся ссылка восстановления HEAD; файлы не удаляются.',
    scope: 'Создание разрешает только показанную соседнюю папку .nekodex-worktrees в выбранной родительской папке. Нужны POSIX, python3 и Git на сервере.',
    dirty: 'Есть изменённые, неотслеживаемые или игнорируемые файлы', clean: 'Рабочая папка чистая', unknown: 'Результат неизвестен. Проверьте владение и запишите наблюдаемый результат в истории операций перед новым изменением.',
    connect: 'Подключитесь к выбранному серверу для просмотра и управления его рабочими деревьями.', empty: 'Приложение ещё не создавало рабочие деревья для этого сервера и корня.',
  } : {
    title: 'Managed SSH worktrees', inspect: 'Capture HEAD and worktrees', name: 'New branch name after codex/', review: 'Review creation', create: 'Create on remote host',
    createTitle: 'Create this worktree on the remote host?', parent: 'Authorized parent folder', head: 'Captured HEAD', branch: 'New branch', target: 'Exact checkout folder',
    cancel: 'Cancel', refresh: 'Refresh list', inspectOwned: 'Inspect ownership and changes', archive: 'Review archive', archiveTitle: 'Archive and retain the entire checkout?', confirmArchive: 'Archive and retain checkout',
    open: 'Open as remote workspace', keep: 'Archiving retains the checkout, branch and all modified, untracked and ignored files. It creates a recovery reference to HEAD; files are not deleted.',
    scope: 'Creation authorizes only the displayed sibling .nekodex-worktrees folder under the selected parent. Requires POSIX, python3 and Git on the remote host.',
    dirty: 'Includes modified, untracked or ignored files', clean: 'Checkout is clean', unknown: 'Outcome unknown. Inspect ownership and record the observed outcome in transaction history before another mutation.',
    connect: 'Connect to the selected host to inspect and manage its worktrees.', empty: 'The application has not created worktrees for this exact host and source root.',
  };
  const [snapshot, setSnapshot] = useState<RemoteGitSnapshot | null>(null);
  const [name, setName] = useState('');
  const [rows, setRows] = useState<RemoteManagedWorktree[]>([]);
  const [plan, setPlan] = useState<RemoteWorktreePlan | null>(null);
  const [archivePlan, setArchivePlan] = useState<RemoteWorktreeArchivePlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; if (host.connected) void api.remoteWorktreeList(host.id).then(value => { if (alive.current) setRows(value); }).catch(reason => { if (alive.current) setError(String(reason)); }); return () => { alive.current = false; }; }, [host.id, host.connected, api]);
  async function act(action: () => Promise<void>) {
    setBusy(true); setError(''); try { await action(); if (alive.current) { setRows(await api.remoteWorktreeList(host.id)); await onChanged(); } }
    catch (reason) { if (alive.current) setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { if (alive.current) setBusy(false); }
  }
  const locked = disabled || busy || !host.connected;
  return <Panel title={c.title}>
    <p>{c.scope}</p>{error && <Notice tone="error">{error}</Notice>}
    {!host.connected && <p>{c.connect}</p>}
    <div className="nk-remote__actions"><Button disabled={locked} onClick={() => void act(async () => { const value = await api.remoteWorktreeInspect(host.id); if (alive.current) { setSnapshot(value); setPlan(null); } })}>{c.inspect}</Button>
      <Button disabled={locked} onClick={() => void act(async () => {})}>{c.refresh}</Button></div>
    {snapshot && <><p>{c.head}: <code>{snapshot.headOid}</code></p><p>{c.parent}: <code>{snapshot.parent}</code></p>
      <div className="nk-remote__actions"><TextField label={c.name} value={name} disabled={locked} placeholder="feature-name" onChange={e => { setName(e.target.value); setPlan(null); }} />
      <Button disabled={locked || mutationBlocked || !/^[a-z][a-z0-9-]{0,47}$/.test(name)} onClick={() => void act(async () => { const value = await api.remoteWorktreePrepare(host.id, { name, captureId: snapshot.captureId }); if (alive.current) setPlan(value); })}>{c.review}</Button></div></>}
    {host.connected && !rows.length && <p>{c.empty}</p>}
    {rows.map(row => <div key={row.id} className="nk-remote__receipt"><p><strong>{row.branch}</strong> · {row.state}</p><p><code>{row.path}</code></p>
      <p>HEAD: <code>{row.currentHeadOid ?? row.headOid}</code></p>{row.dirty !== undefined && <p>{row.dirty ? c.dirty : c.clean}</p>}
      {row.state === 'needs-inspection' && <Notice tone="warning">{c.unknown}</Notice>}{row.message && <p>{row.message}</p>}
      {row.archiveRef && <p><code>{row.archiveRef}</code></p>}
      <div className="nk-remote__actions"><Button disabled={locked || !['ready', 'archived'].includes(row.state)} onClick={() => void act(async () => {
        const verified = await api.remoteWorktreeInspectOwned(host.id, row.id); const known = await api.remoteWorkspaceHosts();
        const existing = known.find(item => item.hostname === host.hostname && item.username === host.username && item.port === host.port && item.root === verified.path);
        const opened = existing ?? await api.remoteWorkspaceAddHost({ label: `${host.label} · ${verified.branch}`.slice(0, 100), hostname: host.hostname, username: host.username, port: host.port, root: verified.path });
        if (alive.current) await onOpen(opened);
      })}>{c.open}</Button><Button disabled={locked} onClick={() => void act(async () => { await api.remoteWorktreeInspectOwned(host.id, row.id); })}>{c.inspectOwned}</Button>
      <Button disabled={locked || mutationBlocked || row.state !== 'ready'} onClick={() => void act(async () => { const value = await api.remoteWorktreePrepareArchive(host.id, row.id); if (alive.current) setArchivePlan(value); })}>{c.archive}</Button></div>
    </div>)}
    <Dialog open={Boolean(plan)} title={c.createTitle} onClose={() => { if (!busy) setPlan(null); }} actions={<><Button disabled={busy} onClick={() => setPlan(null)}>{c.cancel}</Button><Button variant="primary" busy={busy} onClick={() => { const value = plan; if (!value) return; void act(async () => { setPlan(null); const result = await api.remoteWorktreeCreate(host.id, value.token); if (alive.current) { setSnapshot(null); if (result.receipt.state !== 'completed') setError(result.receipt.message ?? c.unknown); } }); }}>{c.create}</Button></>}>
      {plan && <><p><strong>{plan.username}@{plan.hostname}:{plan.port}</strong></p><p>{c.parent}: <code>{plan.record.parent}</code></p><p>{c.target}: <code>{plan.record.path}</code></p><p>{c.branch}: <code>{plan.record.branch}</code></p><p>{c.head}: <code>{plan.record.headOid}</code></p><p>{c.scope}</p></>}
    </Dialog>
    <Dialog open={Boolean(archivePlan)} title={c.archiveTitle} onClose={() => { if (!busy) setArchivePlan(null); }} actions={<><Button disabled={busy} onClick={() => setArchivePlan(null)}>{c.cancel}</Button><Button variant="primary" busy={busy} onClick={() => { const value = archivePlan; if (!value) return; void act(async () => { setArchivePlan(null); const result = await api.remoteWorktreeArchive(host.id, value.token); if (alive.current && result.receipt.state !== 'completed') setError(result.receipt.message ?? c.unknown); }); }}>{c.confirmArchive}</Button></>}>
      {archivePlan && <><p><strong>{archivePlan.username}@{archivePlan.hostname}:{archivePlan.port}</strong></p><p><code>{archivePlan.record.path}</code></p><p>{c.branch}: <code>{archivePlan.record.branch}</code></p><p>HEAD: <code>{archivePlan.expected.headOid}</code></p><p>{archivePlan.expected.dirty ? c.dirty : c.clean}</p><p>{c.keep}</p></>}
    </Dialog>
  </Panel>;
}
