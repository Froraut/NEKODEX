import { useEffect, useRef, useState } from "react";
import { WorkspaceTerminal } from './WorkspaceTerminal';
import { WorkspaceEditor, waitForWorkspaceDraftMutations } from './WorkspaceEditor';
import { WorktreeControls } from './WorktreeControls';
import LocalGitReviewPanel from './LocalGitReviewPanel';
import type { LocalWorkspaceRoot, WorkspaceDraft, WorkspaceGitBases, WorkspaceGitDiff, WorkspaceGitStatus,
  WorkspaceListing } from "../electron/local-workspace.cjs";
import type { Language } from "./types";
import { Button, Notice, Page, Panel, Select, SurfaceHeader, TextField } from "./design";
import "./surfaces/workspace.css";

const copy = {
  en: {
    title: "Workspace", subtitle: "Open a local folder, edit files and review its Git changes.", pick: "Choose folder",
    folder: "Folder", remove: "Remove from list", files: "Files", empty: "Choose a folder to open its files.",
    loadingFolders: "Loading saved folders…", foldersFailed: "Saved folders could not be loaded", retryFolders: "Retry loading folders",
    selectFile: "Select a file from the tree or open a relative path.", open: "Open file", path: "File path within this folder",
    editor: "Editor", close: "Close file", save: "Save file", dirty: "Unsaved changes", saved: "Saved", retained: "Draft saved locally",
    drafts: "Recoverable drafts", discard: "Discard draft", discardTitle: "Discard this draft?",
    discardBody: "This removes the saved draft and reopens the file from disk. The file itself is not deleted.", cancel: "Cancel",
    conflict: "The file changed on disk. Your draft is retained.", review: "Review latest file", disk: "Latest file on disk",
    resolve: "Save my draft against this version", binary: "Binary file. Text editing is unavailable.",
    truncated: "The preview is truncated. Open this file in an editor that supports its full size.",
    missing: "This file does not exist yet. Saving will create it in this folder.", blocked: "Symbolic links and special files are not opened.",
    refresh: "Refresh", loading: "Loading…", unavailable: "Unavailable", git: "Git review", gitRefresh: "Capture changes",
    gitBase: "Compare working files against", gitHead: "Current HEAD", gitBranch: "Current branch", detached: "Detached HEAD",
    gitLocal: "Local branch", gitRemote: "Remote-tracking branch", gitRefsLimited: "Only the first 128 branch references are listed.",
    gitReadOnly: "Uses local branches and saved remote-tracking references. Selecting a base reads changes; it does not fetch or switch branches.",
    gitBaseMissing: "The selected base branch is no longer available. Choose a base and capture changes again.",
    gitCheck: "Check snapshot freshness", current: "Current snapshot", stale: "Snapshot is stale — capture changes again",
    noChanges: "No tracked changes in this captured diff.", noStatus: "The working tree is clean.",
    previousPage: "Previous", nextPage: "Next", startPage: "Start / Refresh", pageLimit: "Directory scan limit reached. Use the relative file path or open this folder in the file manager.",
    noGit: "Capture the folder's Git status to review changes.", limited: "Output is truncated.", gitBinary: "Includes binary changes.",
    recovering: "Recovered draft; the file remains unchanged.", kept: "The file was saved. The recovery draft is still retained.",
  },
  ru: {
    title: "Рабочая область", subtitle: "Откройте локальную папку, изменяйте файлы и просматривайте изменения Git.", pick: "Выбрать папку",
    folder: "Папка", remove: "Убрать из списка", files: "Файлы", empty: "Выберите папку, чтобы открыть её файлы.",
    loadingFolders: "Загрузка сохранённых папок…", foldersFailed: "Не удалось загрузить сохранённые папки", retryFolders: "Повторить загрузку папок",
    selectFile: "Выберите файл в дереве или откройте относительный путь.", open: "Открыть файл", path: "Путь к файлу внутри папки",
    editor: "Редактор", close: "Закрыть файл", save: "Сохранить файл", dirty: "Есть изменения", saved: "Сохранено", retained: "Черновик сохранён локально",
    drafts: "Сохранённые черновики", discard: "Удалить черновик", discardTitle: "Удалить этот черновик?",
    discardBody: "Сохранённый черновик будет удалён, а файл открыт с диска. Сам файл не удаляется.", cancel: "Отмена",
    conflict: "Файл изменился на диске. Ваш черновик сохранён.", review: "Посмотреть актуальный файл", disk: "Актуальный файл на диске",
    resolve: "Сохранить мой черновик поверх этой версии", binary: "Двоичный файл. Редактирование текста недоступно.",
    truncated: "Предпросмотр сокращён. Откройте файл в редакторе с поддержкой полного размера.",
    missing: "Такого файла ещё нет. Сохранение создаст его внутри этой папки.", blocked: "Ссылки и специальные файлы не открываются.",
    refresh: "Обновить", loading: "Загрузка…", unavailable: "Недоступно", git: "Изменения Git", gitRefresh: "Получить снимок изменений",
    gitBase: "Сравнить рабочие файлы с", gitHead: "Текущий HEAD", gitBranch: "Текущая ветка", detached: "Отсоединённый HEAD",
    gitLocal: "Локальная ветка", gitRemote: "Сохранённая удалённая ветка", gitRefsLimited: "Показаны первые 128 ссылок на ветки.",
    gitReadOnly: "Используются локальные и сохранённые удалённые ветки. Выбор базы читает изменения без загрузки данных и переключения ветки.",
    gitBaseMissing: "Выбранная базовая ветка больше недоступна. Выберите базу и получите изменения заново.",
    gitCheck: "Проверить актуальность снимка", current: "Актуальный снимок", stale: "Снимок устарел — получите изменения заново",
    noChanges: "В этом снимке нет изменений отслеживаемых файлов.", noStatus: "Рабочее дерево чистое.",
    previousPage: "Назад", nextPage: "Далее", startPage: "Сначала / Обновить", pageLimit: "Достигнут предел просмотра папки. Введите относительный путь файла или откройте папку в файловом менеджере.",
    noGit: "Получите состояние Git этой папки для просмотра изменений.", limited: "Результат сокращён.", gitBinary: "Есть двоичные изменения.",
    recovering: "Черновик восстановлен; файл на диске не изменён.", kept: "Файл сохранён. Резервный черновик пока остаётся доступным.",
  },
};
type Copy = typeof copy.en;
const api = () => {
  if (!window.codexWebLauncher) throw new Error("Workspace host is unavailable");
  return window.codexWebLauncher;
};
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

function DirectoryBranch({ workspaceId, directory, label, onOpen, c, initialOpen = false }: {
  workspaceId: string; directory: string; label: string; onOpen: (path: string) => void; c: Copy; initialOpen?: boolean;
}) {
  const [expanded, setExpanded] = useState(initialOpen);
  const [listing, setListing] = useState<WorkspaceListing | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const navigate = (next: string | null) => { setCursor(next); setListing(null); setRetry(value => value + 1); };
  useEffect(() => {
    if (!expanded || listing) return;
    let current = true; setLoading(true); setError("");
    api().workspaceListPage(workspaceId, directory, cursor).then((value) => {
      if (current) { setLoading(false); setListing(value); }
    }).catch((reason) => {
      if (current) { setLoading(false); setError(message(reason)); }
    });
    return () => { current = false; };
  }, [workspaceId, directory, expanded, listing, retry, cursor]);
  return <div className="nk-workspace__branch">
    <button type="button" className="nk-workspace__tree-row" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>
      <span aria-hidden="true">{expanded ? "▾" : "▸"}</span><span>{label}</span>
    </button>
    {expanded && <div className="nk-workspace__children">
      {loading && <p role="status">{c.loading}</p>}
      {error && <Notice tone="error" action={<Button size="sm" onClick={() => navigate(null)}>{c.refresh}</Button>}>{error}</Notice>}
      {listing?.entries.map((entry) => entry.kind === "directory"
        ? <DirectoryBranch key={entry.path} workspaceId={workspaceId} directory={entry.path} label={entry.name} onOpen={onOpen} c={c} />
        : <button type="button" key={entry.path} className="nk-workspace__tree-row" onClick={() => onOpen(entry.path)}
          disabled={entry.kind !== "file"} title={entry.kind !== "file" ? c.blocked : entry.path}>
          <span aria-hidden="true">{entry.kind === "file" ? "·" : "↗"}</span><span>{entry.name}</span>
        </button>)}
      {listing && <div className="nk-workspace__actions">
        <Button size="sm" disabled={loading || !listing.previousCursor} onClick={() => navigate(listing.previousCursor!)}>{c.previousPage}</Button>
        <Button size="sm" disabled={loading || !listing.nextCursor} onClick={() => navigate(listing.nextCursor!)}>{c.nextPage}</Button>
        <Button size="sm" disabled={loading} onClick={() => navigate(null)}>{c.startPage}</Button>
      </div>}
      {listing?.scanLimited && <p>{c.pageLimit}</p>}
    </div>}
  </div>;
}


function GitReview({ workspaceId, c, language, dirtyPaths, onChanged, onOpenFile, onOpenWorktree }: {
  workspaceId: string; c: Copy; language: Language; dirtyPaths: string[]; onChanged: (paths?: string[]) => void;
  onOpenFile: (path: string) => void; onOpenWorktree: (root: LocalWorkspaceRoot) => void;
}) {
  const [bases, setBases] = useState<WorkspaceGitBases | null>(null);
  const [selectedBase, setSelectedBase] = useState("HEAD");
  const [snapshot, setSnapshot] = useState<WorkspaceGitStatus | null>(null);
  const [diff, setDiff] = useState<WorkspaceGitDiff | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  useEffect(() => {
    const request = ++sequence.current; setBusy(true);
    api().workspaceGitBases(workspaceId).then((value) => { if (request === sequence.current) setBases(value); })
      .catch((reason) => { if (request === sequence.current) setError(message(reason)); })
      .finally(() => { if (request === sequence.current) setBusy(false); });
    return () => { sequence.current++; };
  }, [workspaceId]);
  async function read(refresh: boolean, requestedBase = selectedBase) {
    const request = ++sequence.current; setBusy(true); setError("");
    if (refresh) { setSnapshot(null); setDiff(null); }
    try {
      let captured = snapshot;
      if (refresh) {
        const available = await api().workspaceGitBases(workspaceId);
        if (request !== sequence.current) return;
        setBases(available);
        if (available.state !== "ready") { setSnapshot(available); return; }
        const choice = available.choices.find((entry) => (entry.ref || "HEAD") === requestedBase);
        if (!choice) { setSelectedBase("HEAD"); setError(c.gitBaseMissing); return; }
        captured = await api().workspaceGitStatus(workspaceId, { baseId: choice.baseId });
      }
      if (request !== sequence.current) return;
      setSnapshot(captured);
      if (captured?.state === "ready") {
        const value = await api().workspaceGitDiff(workspaceId, captured.snapshotId);
        if (request === sequence.current) setDiff(value);
      } else setDiff(null);
    } catch (reason) { if (request === sequence.current) setError(message(reason)); }
    finally { if (request === sequence.current) setBusy(false); }
  }
  const choices = bases?.state === "ready" ? bases.choices : [];
  const headRef = snapshot?.state === "ready" ? snapshot.headRef : bases?.state === "ready" ? bases.headRef : null;
  return <><Panel className="nk-workspace__panel" title={c.git} actions={<div className="nk-workspace__actions">
    <Button size="sm" busy={busy} onClick={() => void read(true)}>{c.gitRefresh}</Button>
    {snapshot?.state === "ready" && <Button size="sm" disabled={busy} onClick={() => void read(false)}>{c.gitCheck}</Button>}
  </div>}>
    {error && <Notice tone="error">{error}</Notice>}
    <p>{c.gitBranch}: <strong>{headRef ? headRef.replace(/^refs\/heads\//, "") : bases?.state === "ready" ? c.detached : "—"}</strong></p>
    <Select label={c.gitBase} value={selectedBase} disabled={busy || !choices.length} options={choices.length ? choices.map((entry) => ({
      value: entry.ref || "HEAD", label: `${entry.kind === "head" ? c.gitHead : `${entry.kind === "local" ? c.gitLocal : c.gitRemote}: ${entry.ref!.replace(/^refs\/(heads|remotes)\//, "")}`} · ${entry.oid.slice(0, 12)}`,
    })) : [{ value: "HEAD", label: c.gitHead }]} onChange={(value) => {
      setSelectedBase(value); setSnapshot(null); setDiff(null); void read(true, value);
    }} />
    <p className="nk-workspace__note">{c.gitReadOnly}</p>
    {bases?.state === "unavailable" && <Notice tone="warning">{bases.reason}</Notice>}
    {bases?.state === "ready" && bases.truncated && <Notice tone="warning">{c.gitRefsLimited}</Notice>}
    {!snapshot && <p>{c.noGit}</p>}
    {snapshot?.state === "unavailable" && (bases?.state !== "unavailable" || bases.reason !== snapshot.reason)
      && <Notice tone="warning">{snapshot.reason}</Notice>}
    {snapshot?.state === "ready" && <>
      <p className="nk-workspace__oids"><span>HEAD <code>{snapshot.headOid}</code></span><span>BASE {snapshot.baseRef && <strong>{snapshot.baseRef.replace(/^refs\/(heads|remotes)\//, "")}</strong>} <code>{snapshot.baseOid}</code></span></p>
      <pre className="nk-workspace__status">{snapshot.status.join("\n") || c.noStatus}</pre>
      {snapshot.statusTruncated && <Notice tone="warning">{c.limited}</Notice>}
    </>}
    {diff && <>
      <Notice tone={diff.state === "current" ? "success" : "warning"}>
        {diff.state === "current" ? c.current : diff.state === "stale" ? c.stale : diff.reason || c.unavailable}
      </Notice>
      {diff.reason && diff.state === "stale" && <p>{diff.reason}</p>}
      {(diff.truncated || diff.binary) && <p>{diff.truncated ? c.limited : ""} {diff.binary ? c.gitBinary : ""}</p>}
      <pre className="nk-workspace__diff" tabIndex={0} aria-label={c.git}>{diff.text || c.noChanges}</pre>
    </>}
  </Panel><LocalGitReviewPanel workspaceId={workspaceId} api={api()} language={language}
    dirtyPaths={dirtyPaths} onChanged={onChanged} onOpenFile={onOpenFile} />
    <WorktreeControls workspaceId={workspaceId} headOid={snapshot?.state === 'ready' ? snapshot.headOid : null} language={language} api={api()} onOpenWorktree={onOpenWorktree} dirtyPaths={dirtyPaths} onFilesChanged={onChanged} /></>;
}

export function WorkspaceSurface({ language }: { language: Language }) {
  const c = language === "ru" ? copy.ru : copy.en;
  const [roots, setRoots] = useState<LocalWorkspaceRoot[]>([]);
  const [rootsKnown, setRootsKnown] = useState(false);
  const [rootsLoading, setRootsLoading] = useState(true);
  const [rootsError, setRootsError] = useState("");
  const rootsRequest = useRef(0);
  const folderButton = useRef<HTMLButtonElement>(null);
  const retryFoldersButton = useRef<HTMLButtonElement>(null);
  const [selected, setSelected] = useState("");
  const [opened, setOpened] = useState("");
  const [createMode, setCreateMode] = useState(false);
  const [createIntent, setCreateIntent] = useState(false);
  const [pathInput, setPathInput] = useState("");
  const [drafts, setDrafts] = useState<WorkspaceDraft[]>([]);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState(false);
  const [version, setVersion] = useState(0);
  const [editorVersion, setEditorVersion] = useState(0);
  const [dirtyPaths, setDirtyPaths] = useState<string[]>([]);
  const editorPort = useRef<(() => Promise<void>) | null>(null);
  const navigation = useRef(false);
  async function navigate(action: () => void) {
    if (navigation.current) return;
    navigation.current = true; setError("");
    try { await editorPort.current?.(); await refreshDrafts(); if (mounted.current) action(); }
    catch (reason) { if (mounted.current) setError(message(reason)); }
    finally { navigation.current = false; }
  }
  const mounted = useRef(true);
  const selectedRef = useRef(selected); selectedRef.current = selected;
  async function loadRoots(returnFocus = false) {
    const request = ++rootsRequest.current;
    setRootsLoading(true); setRootsError("");
    try {
      const value = await api().workspaceRoots();
      if (!mounted.current || request !== rootsRequest.current) return;
      setRoots(value); setRootsKnown(true);
      setSelected(previous => previous || value[0]?.id || "");
    } catch (reason) {
      // A failed refresh does not discard already known folders, the selected file or its draft.
      if (mounted.current && request === rootsRequest.current) setRootsError(message(reason));
    } finally {
      if (mounted.current && request === rootsRequest.current) {
        setRootsLoading(false);
        if (returnFocus) requestAnimationFrame(() => {
          if (mounted.current && document.activeElement === document.body) {
            (retryFoldersButton.current ?? folderButton.current)?.focus();
          }
        });
      }
    }
  }
  useEffect(() => {
    mounted.current = true;
    void loadRoots();
    return () => { mounted.current = false; rootsRequest.current++; };
  }, []);
  async function refreshDrafts() {
    const id = selectedRef.current; if (!id) return;
    try { const value = await api().workspaceDrafts(id); if (mounted.current && selectedRef.current === id) setDrafts(value); }
    catch (reason) { if (mounted.current && selectedRef.current === id) setError(message(reason)); }
  }
  useEffect(() => { setOpened(""); setPathInput(""); setDrafts([]); setDirtyPaths([]); setError(""); void refreshDrafts(); }, [selected]);
  async function pick() {
    setPicking(true); setError("");
    try { const root = await api().workspacePick(); if (mounted.current && root) {
      await navigate(() => { setRoots((previous) => previous.some((item) => item.id === root.id) ? previous : [...previous, root]); setRootsKnown(true); setOpened(""); setSelected(root.id); });
    } } catch (reason) { if (mounted.current) setError(message(reason)); }
    finally { if (mounted.current) setPicking(false); }
  }
  async function forget() {
    const id = selected;
    try {
      // Flush the editor's most recent queued recovery write before removing its grant.
      await waitForWorkspaceDraftMutations(id);
      await api().workspaceForget(id);
      if (mounted.current) { setRoots((previous) => previous.filter((root) => root.id !== id)); setSelected(""); setOpened(""); }
    } catch (reason) { if (mounted.current) setError(message(reason)); }
  }
  const root = roots.find((item) => item.id === selected);
  const retainedPaths = [...new Set([...drafts.map(draft => draft.path), ...dirtyPaths])];
  const changed = (paths?: string[]) => {
    setVersion(previous => previous + 1);
    if (paths?.includes(opened) && !retainedPaths.includes(opened)) setEditorVersion(previous => previous + 1);
    void refreshDrafts();
  };
  const open = (path: string, creating = false) => { void navigate(() => { setDirtyPaths([]); setOpened(path); setPathInput(path); setCreateIntent(creating); setCreateMode(false); setEditorVersion(value => value + 1); }); };
  return <Page width="wide" className="nk-workspace" >
    <SurfaceHeader title={c.title} subtitle={c.subtitle} actions={<Button ref={folderButton} variant="primary" busy={picking} disabled={rootsLoading} onClick={() => void pick()}>{c.pick}</Button>} />
    {error && <Notice tone="error">{error}</Notice>}
    {rootsLoading && <p role="status">{c.loadingFolders}</p>}
    {rootsError && <Notice tone="error" title={c.foldersFailed}
      action={<Button ref={retryFoldersButton} size="sm" busy={rootsLoading} disabled={picking} onClick={() => void loadRoots(true)}>{c.retryFolders}</Button>}>{rootsError}</Notice>}
    {roots.length > 0 && <div className="nk-workspace__root-bar">
      <Select label={c.folder} value={selected} onChange={(id) => { void navigate(() => { setOpened(""); setSelected(id); }); }} options={[{ value: "", label: c.folder }, ...roots.map((item) => ({ value: item.id, label: item.name }))]} />
      {root && <><code className="nk-workspace__root-path">{root.path}</code>
        <Button size="sm" onClick={() => void api().workspaceManageRoot(root.id).catch(reason => setError(message(reason)))}>{language === "ru" ? "Управлять папкой в файловом менеджере" : "Manage folder in file manager"}</Button>
        <Button size="sm" onClick={() => void forget()} disabled={Boolean(opened)} title={opened ? c.close : undefined}>{c.remove}</Button></>}
    </div>}
    {rootsKnown && !root && <Panel><p>{c.empty}</p></Panel>}
    {root && <>
      <p>{language === "ru" ? "Создавайте папки, переименовывайте и перемещайте файлы в корзину через файловый менеджер. Затем обновите список файлов здесь." : "Create folders, rename files or move them to Trash in the system file manager. Then refresh the file list here."}</p>
      {drafts.length > 0 && <Panel title={c.drafts} padding="compact"><div className="nk-workspace__drafts">
        {drafts.map((draft) => <Button size="sm" key={draft.id} onClick={() => open(draft.path)}>{draft.path}</Button>)}
      </div></Panel>}
      <div className="nk-workspace__layout">
        <Panel title={c.files} className="nk-workspace__files" padding="compact" actions={<Button size="sm" onClick={() => { setVersion(version + 1); void refreshDrafts(); }}>{c.refresh}</Button>}>
          <DirectoryBranch key={`${root.id}:${version}`} workspaceId={root.id} directory="" label={root.name} onOpen={open} c={c} initialOpen />
          <Button size="sm" onClick={() => { setCreateMode(true); setPathInput(""); }}>{language === "ru" ? "Новый файл" : "New file"}</Button>
          {createMode && <p>{language === "ru" ? "Укажите путь внутри папки. Файл появится после сохранения." : "Enter a path inside this folder. The file is created when you Save."}</p>}
          <form onSubmit={(event) => { event.preventDefault(); if (pathInput) open(pathInput, createMode); }}>
            <TextField label={c.path} value={pathInput} onChange={(event) => setPathInput(event.target.value)} />
            <Button size="sm" type="submit" disabled={!pathInput}>{createMode ? (language === "ru" ? "Подготовить новый файл" : "Prepare new file") : c.open}</Button>
            {createMode && <Button size="sm" onClick={() => setCreateMode(false)}>{c.cancel}</Button>}
          </form>
        </Panel>
        {opened ? <WorkspaceEditor key={`${root.id}:${opened}:${editorVersion}`} workspaceId={root.id} path={opened} language={language} createIntent={createIntent} c={c} host={api} onChanged={() => void refreshDrafts()} editorPort={editorPort}
          onDirty={(path, dirty) => setDirtyPaths(previous => dirty ? previous.includes(path) ? previous : [...previous, path] : previous.filter(item => item !== path))}
          onClose={() => { setOpened(""); setDirtyPaths([]); void refreshDrafts(); }} />
          : <Panel title={c.editor}><p>{c.selectFile}</p></Panel>}
      </div>
      <GitReview key={root.id} workspaceId={root.id} c={c} language={language} dirtyPaths={retainedPaths}
        onChanged={changed} onOpenFile={open} onOpenWorktree={openedRoot => {
        if (!mounted.current) return;
        void navigate(() => {
          setRoots(previous => previous.some(item => item.id === openedRoot.id) ? previous : [...previous, openedRoot]);
          setOpened(''); setSelected(openedRoot.id);
        });
      }} />
      <WorkspaceTerminal key={`terminal:${root.id}`} api={api()} workspaceId={root.id} language={language} />
    </>}
  </Page>;
}
