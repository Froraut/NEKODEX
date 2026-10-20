import { useEffect, useRef, useState } from "react";
import type { WorkspacePreview } from "../electron/local-workspace.cjs";
import type { LauncherApi } from "./types";
import { Badge, Button, Dialog, Notice, Panel } from "./design";

type WorkspaceEditorCopy = Record<"binary" | "cancel" | "close" | "conflict" | "dirty" | "discard" | "discardBody" | "discardTitle" | "disk" | "editor" | "kept" | "loading" | "missing" | "recovering" | "resolve" | "retained" | "review" | "save" | "saved" | "truncated", string>;
type WorkspaceEditorApi = Pick<LauncherApi, "workspaceDiscardDraft" | "workspaceDrafts" | "workspacePreview" | "workspaceRetainDraft" | "workspaceSave">;
const message = (error: unknown) => error instanceof Error ? error.message : String(error);
// Serialize draft/save mutations for a file even when its editor unmounts and remounts.
const mutationQueues = new Map<string, Promise<unknown>>();
function enqueue<T>(key: string, action: () => Promise<T>): Promise<T> {
  const next = (mutationQueues.get(key) || Promise.resolve()).catch(() => {}).then(action);
  mutationQueues.set(key, next);
  void next.finally(() => { if (mutationQueues.get(key) === next) mutationQueues.delete(key); }).catch(() => {});
  return next;
}

/** Join the same editor-owned queue before revoking a workspace grant. */
export async function waitForWorkspaceDraftMutations(workspaceId: string): Promise<void> {
  await Promise.all([...mutationQueues.entries()].filter(([key]) => key.startsWith(`${workspaceId}:`))
    .map(([, promise]) => promise.catch(() => {})));
}

type EditorModel = { preview: WorkspacePreview; text: string; draftId?: string; dirty: boolean; version: number };
export function WorkspaceEditor({ workspaceId, path, c, onChanged, onClose, onDirty, editorPort, host }: {
  workspaceId: string; path: string; c: WorkspaceEditorCopy; onChanged: () => void; onClose: () => void;
  host: () => WorkspaceEditorApi;
  onDirty: (path: string, dirty: boolean) => void; editorPort: { current: (() => Promise<void>) | null };
}) {
  const [model, setModel] = useState<EditorModel | null>(null);
  const current = useRef<EditorModel | null>(null);
  const active = useRef(true);
  const flushing = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<WorkspacePreview | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const key = `${workspaceId}:${path}`;
  const update = (value: EditorModel) => { current.current = value; if (active.current) { setModel(value); onDirty(path, value.dirty); } };
  const clearTimer = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  const input = (value: EditorModel) => ({ path, text: value.text, expectedRevision: value.preview.revision,
    ...(value.draftId ? { draftId: value.draftId } : {}) });
  const retain = (value: EditorModel) => enqueue(key, async () => {
    const draft = await host().workspaceRetainDraft(workspaceId, input(value));
    if (active.current && current.current?.version === value.version) {
      update({ ...current.current, draftId: draft.id }); setNote(c.retained); onChanged();
    }
    return draft;
  });
  useEffect(() => {
    active.current = true;
    const flush = async () => {
      clearTimer(); flushing.current = true; setBusy(true);
      try {
        await enqueue(key, async () => {
          const value = current.current;
          if (value?.dirty) await host().workspaceRetainDraft(workspaceId, input(value));
        });
      } finally { flushing.current = false; if (active.current) setBusy(false); }
    };
    editorPort.current = flush;
    let loadingCurrent = true;
    void (async () => {
      await mutationQueues.get(key)?.catch(() => {});
      const [fileResult, draftResult] = await Promise.allSettled([
        host().workspacePreview(workspaceId, path), host().workspaceDrafts(workspaceId),
      ]);
      if (!active.current || !loadingCurrent) return;
      const draft = draftResult.status === "fulfilled" ? draftResult.value.find((item) => item.path === path) : null;
      if (fileResult.status === "rejected") setError(message(fileResult.reason));
      if (draftResult.status === "rejected") setError(message(draftResult.reason));
      const preview = fileResult.status === "fulfilled" ? fileResult.value : draft
        ? { path, state: "text" as const, text: draft.text, revision: draft.expectedRevision, size: new TextEncoder().encode(draft.text).length }
        : null;
      if (preview) {
        update({ preview, text: draft?.text ?? preview.text ?? "", draftId: draft?.id, dirty: Boolean(draft), version: 0 });
        if (draft) { setNote(c.recovering); setConflict(preview.revision !== draft.expectedRevision); }
        // A recovered candidate always keeps its original baseline until explicit conflict resolution.
        if (draft) update({ ...current.current!, preview: { ...preview, revision: draft.expectedRevision } });
      }
    })().catch((reason) => { if (active.current && loadingCurrent) setError(message(reason)); });
    return () => {
      loadingCurrent = false; active.current = false; clearTimer();
      if (editorPort.current === flush) editorPort.current = null;
      void enqueue(key, async () => {
        const value = current.current;
        if (value?.dirty) await host().workspaceRetainDraft(workspaceId, input(value));
      }).catch(() => {});
    };
    // A parent key remounts the editor for every workspace/file identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  function edit(text: string) {
    if (!current.current || flushing.current) return;
    const value = { ...current.current, text, dirty: true, version: current.current.version + 1 };
    update(value); setNote(c.dirty); clearTimer();
    timer.current = setTimeout(() => { timer.current = null; void retain(value).catch((reason) => {
      if (active.current) setError(message(reason));
    }); }, 600);
  }
  async function save(expected?: WorkspacePreview) {
    const value = current.current; if (!value?.dirty || flushing.current) return;
    clearTimer(); setBusy(true); setError("");
    try {
      const result = await enqueue(key, () => host().workspaceSave(workspaceId,
        { ...input(value), ...(expected ? { expectedRevision: expected.revision } : {}) }));
      if (result.state === "saved") {
        const latestModel = current.current!;
        const unchangedText = latestModel.version === value.version;
        update({ ...latestModel, preview: { ...latestModel.preview, revision: result.revision, state: "text" },
          dirty: !unchangedText, draftId: result.draftRetained ? result.draftId : undefined });
        if (!active.current) return;
        setNote(unchangedText ? result.draftRetained ? c.kept : c.saved : c.dirty); setConflict(false); setLatest(null);
        if (!unchangedText) void retain(current.current!).catch((reason) => { if (active.current) setError(message(reason)); });
      } else { if (!active.current) return; setConflict(result.state === "conflict"); setError(result.state === "conflict" ? c.conflict : result.message);
        update({ ...current.current!, draftId: result.draftId }); }
      onChanged();
    } catch (reason) { if (active.current) setError(message(reason)); }
    finally { if (active.current) setBusy(false); }
  }
  async function review() {
    setBusy(true); setError("");
    try { const value = await host().workspacePreview(workspaceId, path); if (active.current) setLatest(value); }
    catch (reason) { if (active.current) setError(message(reason)); }
    finally { if (active.current) setBusy(false); }
  }
  async function closeEditor() {
    if (flushing.current) return;
    clearTimer(); setBusy(true); setError("");
    try {
      if (current.current?.dirty) await retain(current.current);
      if (active.current) onClose();
    } catch (reason) { if (active.current) setError(message(reason)); }
    finally { if (active.current) setBusy(false); }
  }
  async function discard() {
    if (flushing.current) return;
    clearTimer(); setBusy(true); setError("");
    try {
      await enqueue(key, async () => {
        // Keep the recoverable text if the disk read fails (unavailable root, changed path, permission).
        const preview = await host().workspacePreview(workspaceId, path);
        const stored = (await host().workspaceDrafts(workspaceId)).find((draft) => draft.path === path);
        if (stored) await host().workspaceDiscardDraft(workspaceId, stored.id);
        update({ preview, text: preview.text ?? "", dirty: false, version: (current.current?.version || 0) + 1 });
      });
      if (active.current) {
        setConflict(false); setLatest(null); setNote(""); setDiscarding(false); onChanged(); }
    } catch (reason) { if (active.current) setError(message(reason)); }
    finally { if (active.current) setBusy(false); }
  }
  const editable = model && ["text", "missing"].includes(model.preview.state);
  return <Panel title={path} className="nk-workspace__editor" actions={<div className="nk-workspace__actions">
    {model?.dirty && <Badge tone="warning">{c.dirty}</Badge>}
    <Button size="sm" disabled={!model?.dirty || busy} onClick={() => setDiscarding(true)}>{c.discard}</Button>
    <Button variant="primary" size="sm" busy={busy} disabled={!editable || !model?.dirty || conflict} onClick={() => void save()}>{c.save}</Button>
    <Button size="sm" disabled={busy} onClick={() => void closeEditor()}>{c.close}</Button>
  </div>}>
    {error && <Notice tone="error">{error}</Notice>}
    {note && <p className="nk-workspace__note" role="status">{note}</p>}
    {!model && !error && <p role="status">{c.loading}</p>}
    {model?.preview.state === "binary" && <Notice>{c.binary}</Notice>}
    {model?.preview.state === "truncated" && <Notice tone="warning">{c.truncated}</Notice>}
    {model?.preview.state === "missing" && <p>{c.missing}</p>}
    {model && <textarea aria-label={`${c.editor}: ${path}`} className="nk-workspace__text" spellCheck={false}
      value={model.text} readOnly={!editable || busy || flushing.current} onChange={(event) => edit(event.target.value)}
      onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === "s") { event.preventDefault(); if (!busy && editable && !conflict) void save(); } }} />}
    {conflict && <div className="nk-workspace__conflict">
      <Notice tone="warning" action={<Button size="sm" disabled={busy} onClick={() => void review()}>{c.review}</Button>}>{c.conflict}</Notice>
      {latest && <><h3>{c.disk}</h3><pre className="nk-workspace__diff" tabIndex={0} aria-label={`${c.disk}: ${path}`}>{latest.text ?? c.binary}</pre>
        <Button busy={busy} disabled={!["text", "missing"].includes(latest.state)} onClick={() => void save(latest)}>{c.resolve}</Button></>}
    </div>}
    <Dialog open={discarding} title={c.discardTitle} onClose={() => { if (!busy) setDiscarding(false); }}
      actions={<><Button disabled={busy} onClick={() => setDiscarding(false)}>{c.cancel}</Button>
        <Button variant="danger" busy={busy} onClick={() => void discard()}>{c.discard}</Button></>}>
      <p>{c.discardBody}</p>
    </Dialog>
  </Panel>;
}
