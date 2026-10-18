import { useEffect, useRef, useState } from "react";
import type { ManagedWorktree, WorkspaceArchivePreview, WorkspaceRestorePreview, WorkspaceRestoreReceipt,
  WorkspaceSourceSnapshot } from "../electron/workspace-git-mutations.cjs";
import type { Language } from "./types";
import type { LocalWorkspaceRoot } from "../electron/local-workspace.cjs";
import { Badge, Button, Checkbox, Dialog, Notice, Panel, Select, TextField } from "./design";

export interface WorkspaceGitControlsApi {
  workspaceOpenWorktree(id: string, worktreeId: string): Promise<LocalWorkspaceRoot>;
  workspaceWorktrees(id: string): Promise<ManagedWorktree[]>;
  workspaceCreateWorktree(id: string, input: { name: string; expectedHeadOid: string }): Promise<ManagedWorktree>;
  workspacePreviewWorktreeArchive(id: string, worktreeId: string): Promise<WorkspaceArchivePreview>;
  workspaceArchiveWorktree(id: string, input: { previewId: string }): Promise<ManagedWorktree>;
  workspaceCreateSnapshot(id: string, input: { paths: string[]; label?: string }): Promise<WorkspaceSourceSnapshot>;
  workspaceSnapshots(id: string): Promise<WorkspaceSourceSnapshot[]>;
  workspaceDeleteSnapshot(id: string, snapshotId: string): Promise<boolean>;
  workspacePreviewRestore(id: string, input: { snapshotId: string; paths: string[] }): Promise<WorkspaceRestorePreview>;
  workspaceRestoreSnapshot(id: string, input: { previewId: string }): Promise<WorkspaceRestoreReceipt>;
}
const strings = {
  en: {
    title: "Worktrees and snapshots", description: "Create an isolated branch or preserve selected source files before editing.",
    refresh: "Refresh", name: "Worktree name", create: "Create worktree", captureHead: "Capture Git status above to select a committed HEAD first.",
    openWorktree: "Open worktree", worktrees: "Managed worktrees", noWorktrees: "No managed worktrees for this folder.", archive: "Archive", archiveTitle: "Archive this worktree?",
    archiveBody: "The checkout moves to private archive storage. Its branch, committed HEAD, staged changes and ignored files are retained. Dirty selected files also receive a recovery snapshot.",
    head: "Captured commit", archiveConfirm: "Archive and preserve work", cancel: "Cancel", dirty: "Has changes", clean: "Clean", archived: "Archived",
    paths: "Snapshot paths, one per line", label: "Snapshot label", snapshotCreate: "Create manual snapshot", snapshots: "Source snapshots", noSnapshots: "No saved source snapshots.",
    select: "Select snapshot", selected: "Files to restore", preview: "Preview selected restore", restoreTitle: "Review selected file restore", current: "Current file", target: "Snapshot file",
    absent: "File absent", binary: "Binary content — compare hashes", unchanged: "Unchanged", restore: "Restore selected files", restoreBody: "Only the selected files will change. Current contents receive a recovery snapshot. A file changed after this preview will block restoration.",
    created: "Worktree is ready.", snapshotSaved: "Source snapshot saved privately.", restored: "Selected files restored. Their previous contents remain in a recovery snapshot.",
    archiveSaved: "Worktree archived; its checkout and recovery data remain private.", remove: "Delete snapshot", deleteTitle: "Delete this snapshot?", deleteBody: "This explicitly removes the selected saved file copies. Current workspace files remain as they are.",
    inspectRestore: "Close this preview, refresh snapshots and inspect current files and the recovery snapshot before preparing another restore.",
    deleted: "Snapshot deleted.", retained: "Recovery checkout", operation: "Working…", missing: "Select at least one file.",
  },
  ru: {
    title: "Рабочие деревья и снимки", description: "Создайте отдельную ветку или сохраните выбранные исходные файлы перед изменением.",
    refresh: "Обновить", name: "Название рабочего дерева", create: "Создать рабочее дерево", captureHead: "Сначала получите состояние Git выше, чтобы выбрать зафиксированный HEAD.",
    openWorktree: "Открыть рабочее дерево", worktrees: "Рабочие деревья приложения", noWorktrees: "Для этой папки нет рабочих деревьев приложения.", archive: "Архивировать", archiveTitle: "Архивировать рабочее дерево?",
    archiveBody: "Рабочая копия переместится в приватный архив. Ветка, HEAD, изменения в индексе и игнорируемые файлы сохранятся. Для изменённых выбранных файлов также создаётся резервный снимок.",
    head: "Зафиксированный коммит", archiveConfirm: "Архивировать с сохранением", cancel: "Отмена", dirty: "Есть изменения", clean: "Без изменений", archived: "В архиве",
    paths: "Пути для снимка, по одному в строке", label: "Название снимка", snapshotCreate: "Создать снимок вручную", snapshots: "Снимки исходных файлов", noSnapshots: "Сохранённых снимков пока нет.",
    select: "Выбрать снимок", selected: "Файлы для восстановления", preview: "Предпросмотр восстановления", restoreTitle: "Проверить восстановление файлов", current: "Текущий файл", target: "Файл из снимка",
    absent: "Файл отсутствует", binary: "Двоичное содержимое — сравните хеши", unchanged: "Без изменений", restore: "Восстановить выбранные файлы", restoreBody: "Изменятся только выбранные файлы. Текущее содержимое сохранится в резервном снимке. Изменение файла после предпросмотра заблокирует восстановление.",
    created: "Рабочее дерево готово.", snapshotSaved: "Снимок исходных файлов сохранён приватно.", restored: "Выбранные файлы восстановлены. Прежнее содержимое доступно в резервном снимке.",
    archiveSaved: "Рабочее дерево в архиве; рабочая копия и резервные данные сохранены приватно.", remove: "Удалить снимок", deleteTitle: "Удалить этот снимок?", deleteBody: "Выбранные сохранённые копии файлов будут удалены. Текущие файлы рабочей области сохранятся.",
    inspectRestore: "Закройте предпросмотр, обновите снимки и проверьте текущие файлы и резервный снимок перед новым восстановлением.",
    deleted: "Снимок удалён.", retained: "Рабочая копия в архиве", operation: "Выполняется…", missing: "Выберите хотя бы один файл.",
  },
};

/** All authority stays with the picked workspace ID and main-process service. */
export function WorktreeControls({ workspaceId, headOid, language, api, onOpenWorktree }: {
  workspaceId: string; headOid: string | null; language: Language; api: WorkspaceGitControlsApi;
  onOpenWorktree?: (root: LocalWorkspaceRoot) => void;
}) {
  const c = language === "ru" ? strings.ru : strings.en;
  const [worktrees, setWorktrees] = useState<ManagedWorktree[]>([]);
  const [snapshots, setSnapshots] = useState<WorkspaceSourceSnapshot[]>([]);
  const [name, setName] = useState(""); const [paths, setPaths] = useState(""); const [label, setLabel] = useState("");
  const [selectedSnapshot, setSelectedSnapshot] = useState(""); const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [archivePreview, setArchivePreview] = useState<WorkspaceArchivePreview | null>(null);
  const [restorePreview, setRestorePreview] = useState<WorkspaceRestorePreview | null>(null);
  const [restoreBlocked, setRestoreBlocked] = useState(false);
  const [deleting, setDeleting] = useState<WorkspaceSourceSnapshot | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [notice, setNotice] = useState("");
  const identity = useRef({ workspaceId, epoch: 0 });
  if (identity.current.workspaceId !== workspaceId) identity.current = { workspaceId, epoch: identity.current.epoch + 1 };
  useEffect(() => () => { identity.current.epoch++; }, []);
  async function run<T>(action: (port: WorkspaceGitControlsApi, id: string) => Promise<T>, apply?: (result: T) => void) {
    const captured = { ...identity.current }; const port = api;
    setBusy(true); setError(""); setNotice("");
    try {
      const value = await action(port, captured.workspaceId);
      if (captured.workspaceId === identity.current.workspaceId && captured.epoch === identity.current.epoch) apply?.(value);
    } catch (reason) {
      if (captured.workspaceId === identity.current.workspaceId && captured.epoch === identity.current.epoch) setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      if (captured.workspaceId === identity.current.workspaceId && captured.epoch === identity.current.epoch) setBusy(false);
    }
  }
  const inventory = async (port: WorkspaceGitControlsApi, id: string) => Promise.all([port.workspaceWorktrees(id), port.workspaceSnapshots(id)]);
  const applyInventory = ([trees, saved]: [ManagedWorktree[], WorkspaceSourceSnapshot[]]) => { setWorktrees(trees); setSnapshots(saved); };
  useEffect(() => {
    setWorktrees([]); setSnapshots([]); setSelectedSnapshot(""); setSelectedPaths([]); setArchivePreview(null); setRestorePreview(null); setRestoreBlocked(false); setDeleting(null);
    setName(""); setPaths(""); setLabel(""); setNotice("");
    void run(inventory, applyInventory);
  }, [workspaceId]);
  const snapshot = snapshots.find((entry) => entry.id === selectedSnapshot);
  return <Panel title={c.title} description={c.description} actions={<Button size="sm" disabled={busy} onClick={() => void run(inventory, applyInventory)}>{c.refresh}</Button>}>
    {error && <Notice tone="error">{error}</Notice>}{notice && <Notice>{notice}</Notice>}
    {busy && <p role="status">{c.operation}</p>}
    <TextField label={c.name} value={name} onChange={(event) => setName(event.target.value)} placeholder="feature-name" disabled={busy} />
    <Button disabled={busy || !headOid || !/^[a-z0-9][a-z0-9-]{0,47}$/.test(name)} onClick={() => void run(async (port, id) => {
      await port.workspaceCreateWorktree(id, { name, expectedHeadOid: headOid! }); return inventory(port, id);
    }, (value) => { applyInventory(value); setNotice(c.created); })}>{c.create}</Button>
    {!headOid && <p>{c.captureHead}</p>}
    <h3>{c.worktrees}</h3>
    {!worktrees.length && <p>{c.noWorktrees}</p>}
    {worktrees.map((tree) => <div key={tree.id} className="nk-workspace__branch">
      <p><strong>{tree.branch}</strong> <Badge>{tree.state === "archived" ? c.archived : tree.state === "ready" ? tree.dirty ? c.dirty : c.clean : tree.state}</Badge></p>
      <p><code>{tree.archivePath || tree.path}</code></p>
      <small>{c.head}: <code>{tree.currentHeadOid || tree.archivedHeadOid || tree.headOid}</code></small>
      {tree.state === "ready" && <>
        <Button size="sm" disabled={busy || !onOpenWorktree} onClick={() => void run((port, id) => port.workspaceOpenWorktree(id, tree.id), (root) => onOpenWorktree?.(root))}>{c.openWorktree}</Button>
        <Button size="sm" disabled={busy} onClick={() => void run((port, id) => port.workspacePreviewWorktreeArchive(id, tree.id), setArchivePreview)}>{c.archive}</Button>
      </>}
    </div>)}
    <h3>{c.snapshots}</h3>
    <label className="nk-field"><span>{c.paths}</span><textarea aria-label={c.paths} rows={3} value={paths} disabled={busy} onChange={(event) => setPaths(event.target.value)} /></label>
    <TextField label={c.label} value={label} disabled={busy} onChange={(event) => setLabel(event.target.value)} />
    <Button disabled={busy || !paths.trim()} onClick={() => void run(async (port, id) => {
      await port.workspaceCreateSnapshot(id, { paths: paths.split(/\r?\n/).map((value) => value.trim()).filter(Boolean), ...(label.trim() ? { label: label.trim() } : {}) });
      return inventory(port, id);
    }, (value) => { applyInventory(value); setNotice(c.snapshotSaved); })}>{c.snapshotCreate}</Button>
    {!snapshots.length && <p>{c.noSnapshots}</p>}
    {!!snapshots.length && <Select label={c.select} value={selectedSnapshot} disabled={busy} onChange={(value) => { setSelectedSnapshot(value); setSelectedPaths([]); setRestorePreview(null); }}
      options={[{ value: "", label: "—" }, ...snapshots.map((entry) => ({ value: entry.id, label: `${entry.label} · ${new Date(entry.createdAt).toLocaleString(language === "ru" ? "ru-RU" : "en-US")}` }))]} />}
    {snapshot && <div>
      <h4>{c.selected}</h4>{snapshot.paths.map((file) => <Checkbox key={file} label={file} checked={selectedPaths.includes(file)} disabled={busy}
        onChange={(checked) => setSelectedPaths((current) => checked ? [...current, file] : current.filter((value) => value !== file))} />)}
      <Button disabled={busy || !selectedPaths.length} onClick={() => void run((port, id) => port.workspacePreviewRestore(id, { snapshotId: snapshot.id, paths: selectedPaths }), (value) => { setRestoreBlocked(false); setRestorePreview(value); })}>{c.preview}</Button>
      <Button disabled={busy} variant="danger" onClick={() => setDeleting(snapshot)}>{c.remove}</Button>
    </div>}
    <Dialog open={!!archivePreview} title={c.archiveTitle} onClose={() => { if (!busy) setArchivePreview(null); }} actions={<>
      <Button disabled={busy} onClick={() => setArchivePreview(null)}>{c.cancel}</Button>
      <Button disabled={busy} onClick={() => void run(async (port, id) => { await port.workspaceArchiveWorktree(id, { previewId: archivePreview!.previewId }); return inventory(port, id); },
        (value) => { applyInventory(value); setArchivePreview(null); setNotice(c.archiveSaved); })}>{c.archiveConfirm}</Button>
    </>}>
      <p>{c.archiveBody}</p><p><strong>{archivePreview?.branch}</strong> <code>{archivePreview?.headOid}</code></p>
      <ul>{archivePreview?.paths.map((file) => <li key={file}><code>{file}</code></li>)}</ul>
    </Dialog>
    <Dialog open={!!restorePreview} title={c.restoreTitle} onClose={() => { if (!busy) setRestorePreview(null); }} actions={<>
      <Button disabled={busy} onClick={() => setRestorePreview(null)}>{c.cancel}</Button>
      <Button disabled={busy || restoreBlocked} onClick={() => { setRestoreBlocked(true); void run(async (port, id) => { await port.workspaceRestoreSnapshot(id, { previewId: restorePreview!.previewId }); return inventory(port, id); },
        (value) => { applyInventory(value); setRestorePreview(null); setRestoreBlocked(false); setNotice(c.restored); }); }}>{c.restore}</Button>
    </>}>
      {error && <Notice tone="error">{error}</Notice>}
      {restoreBlocked && !busy && error && <Notice>{c.inspectRestore}</Notice>}
      <p>{c.restoreBody}</p>{restorePreview?.files.map((file) => <section key={file.path}>
        <h4>{file.path} {!file.changed && <Badge>{c.unchanged}</Badge>}</h4>
        <p>{c.current}: <code>{file.currentHash || c.absent}</code></p><pre>{file.currentText ?? (file.currentHash ? c.binary : c.absent)}</pre>
        <p>{c.target}: <code>{file.targetHash || c.absent}</code></p><pre>{file.targetText ?? (file.targetMissing ? c.absent : c.binary)}</pre>
      </section>)}
    </Dialog>
    <Dialog open={!!deleting} title={c.deleteTitle} onClose={() => { if (!busy) setDeleting(null); }} actions={<>
      <Button disabled={busy} onClick={() => setDeleting(null)}>{c.cancel}</Button><Button disabled={busy} variant="danger" onClick={() => void run(async (port, id) => {
        await port.workspaceDeleteSnapshot(id, deleting!.id); return inventory(port, id);
      }, (value) => { applyInventory(value); setDeleting(null); setSelectedSnapshot(""); setNotice(c.deleted); })}>{c.remove}</Button>
    </>}><p>{c.deleteBody}</p><strong>{deleting?.label}</strong></Dialog>
  </Panel>;
}
