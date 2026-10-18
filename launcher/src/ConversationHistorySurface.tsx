import { CanonicalHistoryPanel } from "./CanonicalHistoryPanel";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Button, Checkbox, Notice, Panel, Select, TextField } from "./design";
import type { Language } from "./types";
import type { ConversationHistoryApi, HistoryMarkdownExport, HistoryMessage, HistoryPage, HistoryStatus, HistoryThread, ThreadIdentity } from "./conversation-history-types";
import "./surfaces/conversation-history.css";

const PAGE = 30;
const COPY = {
  en: { title: "Conversation text history", consent: "I want selected user/assistant text stored privately on this device. I understand text can be sensitive and is not automatically redacted.", boundary: "Save checked manual selections, or explicitly opt in one native thread and retain a canonical page after refreshing it. There is no background watcher. Do not include credentials, system/developer instructions, tool calls or tool output. Disabling recording preserves saved text; deletion is always explicit.", enable: "Enable selected-text history", disable: "Disable recording", refresh: "Refresh", search: "Search saved text", open: "Open", previous: "Previous", next: "Next", empty: "No saved text in this selection.", import: "Save selected text", task: "Task / thread label", text: "Selected text", checked: "I checked this selection: it contains only conversation text and excludes credentials, instructions and tool payloads.", save: "Save selection", copy: "Copy Markdown", export: "Save Markdown", remove: "Delete thread", confirm: "Permanently delete this thread and all its revisions?", yes: "Delete permanently", cancel: "Cancel", selected: "selected", all: "Export current thread", incomplete: "Incomplete text", coverage: "Only recorded text is searchable; full transcript coverage is unknown.", stopped: "Storage quota reached. Recording has stopped. Saved text is preserved. Explicitly delete unwanted history to release space.", saved: "Selection saved.", copied: "Markdown copied.", exported: "Markdown saved.", exact: "Exact revision", role: "Message role", author: "Actual author", total: "Messages", indexed: "Indexed", partial: "Incomplete", content: "Saved text", back: "Back to thread", link: "Copy exact revision link", invalidLink: "This is not an exact NEKODEX history link.", openLink: "Open saved revision link", linkLabel: "Exact revision link", selection: "Select message" },
  ru: { title: "История текста разговоров", consent: "Я хочу сохранять выбранный текст сообщений пользователя и ассистента приватно на этом устройстве. Текст может быть чувствительным; автоматического удаления секретов нет.", boundary: "Сохраняйте проверенный текст вручную либо явно разрешите запись одной переписки Native Threads после обновления её канонической страницы. Фонового наблюдения нет. Не включайте пароли, ключи, инструкции system/developer, вызовы и результаты инструментов. Отключение записи сохраняет историю; удаление выполняется явно.", enable: "Включить сохранение выбранного текста", disable: "Отключить запись", refresh: "Обновить", search: "Поиск по сохранённому тексту", open: "Открыть", previous: "Назад", next: "Далее", empty: "В этой выборке нет сохранённого текста.", import: "Сохранить выбранный текст", task: "Название задачи / переписки", text: "Выбранный текст", checked: "Я проверил выборку: в ней только текст разговора, без секретов, инструкций и данных инструментов.", save: "Сохранить выборку", copy: "Копировать Markdown", export: "Сохранить Markdown", remove: "Удалить переписку", confirm: "Удалить переписку и все её редакции безвозвратно?", yes: "Удалить безвозвратно", cancel: "Отмена", selected: "выбрано", all: "Экспорт текущей переписки", incomplete: "Неполный текст", coverage: "Поиск охватывает только сохранённый текст; полнота исходной переписки неизвестна.", stopped: "Достигнут лимит хранения. Запись остановлена, сохранённый текст не удалён. Явно удалите ненужные записи, чтобы освободить место.", saved: "Выборка сохранена.", copied: "Markdown скопирован.", exported: "Markdown сохранён.", exact: "Точная редакция", role: "Роль сообщения", author: "Фактический автор", total: "Сообщений", indexed: "В индексе", partial: "Неполных", content: "Сохранённый текст", back: "К переписке", link: "Копировать ссылку на редакцию", invalidLink: "Это не ссылка на точную редакцию истории NEKODEX.", openLink: "Открыть сохранённую редакцию", linkLabel: "Ссылка на точную редакцию", selection: "Выбрать сообщение" },
};

export function ConversationHistorySurface({ api, language = "en" }: { api: ConversationHistoryApi; language?: Language }) {
  const copy = language === "ru" ? COPY.ru : COPY.en;
  const [status, setStatus] = useState<HistoryStatus | null>(null);
  const [consent, setConsent] = useState(false);
  const [threads, setThreads] = useState<HistoryPage<HistoryThread> | null>(null);
  const [messages, setMessages] = useState<HistoryPage<HistoryMessage> | null>(null);
  const [searchResults, setSearchResults] = useState<HistoryPage<HistoryMessage> | null>(null);
  const [thread, setThread] = useState<ThreadIdentity | null>(null);
  const [exact, setExact] = useState<HistoryMessage | null>(null);
  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deletingMessage, setDeletingMessage] = useState<string | null>(null);
  const [draftThread, setDraftThread] = useState("");
  const [draftText, setDraftText] = useState("");
  const [draftRole, setDraftRole] = useState("user");
  const [draftAuthor, setDraftAuthor] = useState("unknown");
  const [checked, setChecked] = useState(false);
  const [exactLink, setExactLink] = useState("");
  const importIdentity = useRef({ messageId: crypto.randomUUID(), revisionId: crypto.randomUUID(), timestamp: Date.now() });
  const renewDraft = () => { importIdentity.current = { messageId: crypto.randomUUID(), revisionId: crypto.randomUUID(), timestamp: Date.now() }; };
  const generation = useRef(0);
  const ask = <T,>(body: { action: string; [key: string]: unknown }) => api.request(body) as Promise<T>;
  const failure = (reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason));
  const refresh = async (offset = 0) => {
    const token = ++generation.current; setLoading(true); setError("");
    try {
      const [nextStatus, nextThreads] = await Promise.all([ask<HistoryStatus>({ action: "status" }), ask<HistoryPage<HistoryThread>>({ action: "threads", limit: PAGE, offset })]);
      if (token === generation.current) { setStatus(nextStatus); setThreads(nextThreads); }
    } catch (reason) { if (token === generation.current) failure(reason); }
    finally { if (token === generation.current) setLoading(false); }
  };
  useEffect(() => { void refresh(); return () => { generation.current++; }; }, [api]);
  const openThread = async (identity: ThreadIdentity, offset = 0) => {
    const token = ++generation.current; setLoading(true); setError(""); setThread(identity); setExact(null); setSearchResults(null); setSelected([]); setDeleting(false); setDeletingMessage(null);
    try { const page = await ask<HistoryPage<HistoryMessage>>({ action: "thread", ...identity, limit: PAGE, offset }); if (token === generation.current) setMessages(page); }
    catch (reason) { if (token === generation.current) failure(reason); }
    finally { if (token === generation.current) setLoading(false); }
  };
  const search = async (value: string, offset = 0) => {
    const token = ++generation.current; setLoading(true); setError(""); setActiveQuery(value); setThread(null); setExact(null); setMessages(null); setSelected([]); setDeleting(false); setDeletingMessage(null);
    try { const page = await ask<HistoryPage<HistoryMessage>>({ action: "search", query: value, limit: PAGE, offset }); if (token === generation.current) setSearchResults(page); }
    catch (reason) { if (token === generation.current) failure(reason); }
    finally { if (token === generation.current) setLoading(false); }
  };
  const action = async (work: () => Promise<void>) => {
    if (busy) return; setBusy(true); setError(""); setNotice("");
    try { await work(); } catch (reason) { failure(reason); } finally { setBusy(false); }
  };
  const openExact = async (row: Pick<HistoryMessage, "clientId" | "threadId" | "messageId" | "revisionId">) => {
    const token = ++generation.current; setLoading(true); setError("");
    try {
      const result = await ask<HistoryMessage | null>({ action: "message", ...row });
      if (token === generation.current) { if (!result) throw new Error(copy.empty); setExact(result); }
    } catch (reason) { if (token === generation.current) failure(reason); }
    finally { if (token === generation.current) setLoading(false); }
  };
  const exportText = (save: boolean) => action(async () => {
    const identity = exact ?? thread; if (!identity) return;
    const messageIds = selected.length ? selected : undefined;
    const messageRevisions = exact ? [{messageId:exact.messageId,revisionId:exact.revisionId}] : undefined;
    const result = await ask<HistoryMarkdownExport>({ action: "export", clientId: identity.clientId, threadId: identity.threadId, ...(messageRevisions ? {messageRevisions} : messageIds ? { messageIds } : {}) });
    if (save) { if ((await api.saveMarkdown(result.markdown)).saved) setNotice(copy.exported); }
    else { await api.copyText(result.markdown); setNotice(copy.copied); }
  });
  const saveSelection = (event: FormEvent) => {
    event.preventDefault(); void action(async () => {
      const identity = importIdentity.current;
      const result = await ask<{outcome:string}>({ action: "import-selected", clientId: "manual-selection", threadId: draftThread.trim(), ...identity,
        revisionNumber: 1, role: draftRole, author: draftAuthor, text: draftText, sensitivityConfirmed: checked });
      if (result.outcome !== "recorded" && result.outcome !== "duplicate") throw new Error(result.outcome === "quota-reached" ? copy.stopped : result.outcome);
      setDraftText(""); setChecked(false); renewDraft(); setNotice(copy.saved);
      await refresh(); await openThread({ clientId: "manual-selection", threadId: draftThread.trim() });
    });
  };
  const draftBytes = new TextEncoder().encode(draftText).byteLength;
  const draftTooLarge = status !== null && draftBytes > status.maxMessageBytes;
  const page = searchResults ?? messages;
  const rows = exact ? [exact] : page?.items ?? [];
  return <section className="conversation-history" aria-label={copy.title}>
    <Panel title={copy.title} actions={<Button disabled={busy || loading} onClick={() => { setThread(null); setMessages(null); setSearchResults(null); setExact(null); void refresh(); }}>{copy.refresh}</Button>}>
      <p>{copy.boundary}</p>
      <p className="conversation-history__muted">{copy.coverage}</p>
      {error ? <Notice tone="error" title={error} role="alert" /> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {!status?.recordingEnabled ? <Checkbox label={copy.consent} checked={consent} onChange={setConsent} disabled={busy} /> : null}
      <Button disabled={busy || !status || (!status.recordingEnabled && !consent)} onClick={() => void action(async () => {
        const next = await ask<HistoryStatus>({ action: "set-recording", enabled: !status!.recordingEnabled, consent }); setStatus(next);
      })}>{status?.recordingEnabled ? copy.disable : copy.enable}</Button>
      {status ? <p role="status">{copy.total}: {status.totalMessages} · {copy.indexed}: {status.indexedMessages} · {copy.partial}: {status.incompleteMessages} · {status.storedBytes.toLocaleString()} / {status.maxStoredBytes.toLocaleString()} bytes</p> : null}
      {status?.quotaReached ? <Notice tone="warning" title={copy.stopped} /> : null}
    </Panel>
    <CanonicalHistoryPanel api={api} language={language} globallyEnabled={status?.recordingEnabled===true} onCaptured={()=>{void refresh();}}/>
    <Panel title={copy.search}>
      <form className="conversation-history__actions" onSubmit={event => { event.preventDefault(); void search(query); }}>
        <TextField label={copy.search} value={query} onChange={event => setQuery(event.target.value)} maxLength={256} type="search" />
        <Button type="submit" disabled={busy || loading || !query.trim()}>{copy.search}</Button>
      </form>
      <details><summary>{copy.openLink}</summary><div className="conversation-history__actions"><TextField label={copy.linkLabel} value={exactLink} onChange={event => setExactLink(event.target.value)} /><Button disabled={busy || loading} onClick={() => {
        try {
          const url = new URL(exactLink); if (url.protocol !== "nekodex:" || url.hostname !== "history") throw new Error(copy.invalidLink);
          const clientId = url.searchParams.get("client"), threadId = url.searchParams.get("thread"), messageId = url.searchParams.get("message"), revisionId = url.searchParams.get("revision");
          if (!clientId || !threadId || !messageId || !revisionId) throw new Error(copy.invalidLink);
          void openExact({clientId,threadId,messageId,revisionId});
        } catch { setError(copy.invalidLink); }
      }}>{copy.open}</Button></div></details>
    </Panel>
    <div className="conversation-history__columns">
      <Panel title={copy.title}>
        <ul className="conversation-history__threads">{threads?.items.map(row => <li key={JSON.stringify([row.clientId,row.threadId])}><Button disabled={busy || loading} variant="ghost" onClick={() => void openThread(row)}><strong>{row.threadId}</strong><span>{row.clientId} · {row.messages} · {row.incompleteMessages} {copy.partial.toLowerCase()}</span></Button></li>)}</ul>
        {!threads?.items.length && !loading ? <p>{copy.empty}</p> : null}
        <div className="conversation-history__actions"><Button disabled={busy || loading || !threads || !threads.offset} onClick={() => void refresh(Math.max(0, threads!.offset - PAGE))}>{copy.previous}</Button><Button disabled={busy || loading || !threads?.hasMore} onClick={() => void refresh(threads!.offset + PAGE)}>{copy.next}</Button></div>
      </Panel>
      <Panel title={exact ? copy.exact : thread?.threadId ?? copy.content}>
        {exact ? <Button onClick={() => { setExact(null); if (!messages && !searchResults) void openThread(exact); }}>{copy.back}</Button> : null}
        {(thread || exact) ? <div className="conversation-history__actions"><span>{selected.length} {copy.selected}</span><Button disabled={busy || loading} onClick={() => void exportText(false)}>{copy.copy}</Button><Button disabled={busy || loading} onClick={() => void exportText(true)}>{copy.export}</Button>{thread && !exact ? <Button variant="danger" disabled={busy || loading} onClick={() => setDeleting(true)}>{copy.remove}</Button> : null}</div> : null}
        {deleting && thread ? <div role="group" aria-label={copy.confirm}><p>{copy.confirm}</p><Button variant="danger" disabled={busy} onClick={() => void action(async () => {
          await ask({action:"delete-thread",...thread}); setDeleting(false); setThread(null); setMessages(null); setSelected([]); await refresh();
        })}>{copy.yes}</Button><Button disabled={busy} onClick={() => setDeleting(false)}>{copy.cancel}</Button></div> : null}
        {loading ? <p role="status" aria-live="polite">…</p> : rows.map(row => <article className="conversation-history__message" key={JSON.stringify([row.clientId,row.threadId,row.messageId,row.revisionId])}>
          <div className="conversation-history__actions">{thread && !exact ? <Checkbox label={`${copy.selection}: ${row.messageId}`} checked={selected.includes(row.messageId)} onChange={value => setSelected(ids => value ? [...ids,row.messageId] : ids.filter(id => id !== row.messageId))} /> : null}<strong>{row.role} · {row.author}</strong><Button size="sm" disabled={busy || loading} onClick={() => void openExact(row)}>{copy.exact}</Button><Button size="sm" disabled={busy} onClick={() => void action(async () => { await api.copyText(row.link); setNotice(copy.copied); })}>{copy.link}</Button></div>
          <div className="conversation-history__actions"><Button size="sm" variant="danger" disabled={busy || loading} onClick={() => setDeletingMessage(row.link)}>{language === "ru" ? "Удалить сообщение" : "Delete message"}</Button>
          {deletingMessage === row.link ? <span role="group" aria-label={language === "ru" ? "Удалить все редакции сообщения?" : "Delete every revision of this message?"}>{language === "ru" ? "Удалить все редакции сообщения?" : "Delete every revision of this message?"}<Button size="sm" variant="danger" disabled={busy} onClick={() => void action(async () => {
            const currentThread = thread; const currentSearch = searchResults ? activeQuery : null;
            await ask({action:"delete-message",clientId:row.clientId,threadId:row.threadId,messageId:row.messageId});
            setDeletingMessage(null); setExact(null); await refresh();
            if (currentSearch !== null) await search(currentSearch); else await openThread(currentThread ?? row);
          })}>{copy.yes}</Button><Button size="sm" disabled={busy} onClick={() => setDeletingMessage(null)}>{copy.cancel}</Button></span> : null}</div>
          <p className="conversation-history__muted">{row.source} · {row.messageId} · {row.revisionId} · {row.coverage}{row.coverageReason ? ` (${row.coverageReason})` : ""}</p>
          <pre>{row.text ?? `${copy.incomplete}: ${row.originalBytes} bytes`}</pre>
        </article>)}
        {!loading && !rows.length ? <p>{copy.empty}</p> : null}
        {!exact && page ? <div className="conversation-history__actions"><Button disabled={busy || loading || !page.offset} onClick={() => searchResults ? void search(activeQuery, Math.max(0,page.offset-PAGE)) : thread ? void openThread(thread,Math.max(0,page.offset-PAGE)) : undefined}>{copy.previous}</Button><span>{page.total ? page.offset+1 : 0}–{page.offset+page.items.length} / {page.total}</span><Button disabled={busy || loading || !page.hasMore} onClick={() => searchResults ? void search(activeQuery,page.offset+PAGE) : thread ? void openThread(thread,page.offset+PAGE) : undefined}>{copy.next}</Button></div> : null}
      </Panel>
    </div>
    <Panel title={copy.import}>
      <form onSubmit={saveSelection} className="conversation-history__import">
        <TextField label={copy.task} value={draftThread} onChange={event => { setDraftThread(event.target.value); setChecked(false); renewDraft(); }} maxLength={120} required />
        <div className="conversation-history__actions"><Select label={copy.role} value={draftRole} onChange={value => { setDraftRole(value); setChecked(false); renewDraft(); }} options={[{value:"user",label:"user"},{value:"assistant",label:"assistant"}]} /><Select label={copy.author} value={draftAuthor} onChange={value => { setDraftAuthor(value); setChecked(false); renewDraft(); }} options={[{value:"unknown",label:"unknown"},{value:"human",label:"human"},{value:"assistant",label:"assistant"},{value:"agent",label:"agent"}]} /></div>
        <label>{copy.text}<textarea value={draftText} onChange={event => { setDraftText(event.target.value); setChecked(false); renewDraft(); }} rows={7} required aria-invalid={draftTooLarge || undefined} aria-describedby="history-draft-size" /></label>
        <p id="history-draft-size" role={draftTooLarge ? "alert" : undefined}>{draftBytes.toLocaleString()} / {(status?.maxMessageBytes ?? 524288).toLocaleString()} bytes{draftTooLarge ? (language === "ru" ? " — превышен лимит сообщения; выберите меньший текст. Текст не обрезан." : " — message limit exceeded; select less text. Text has not been truncated.") : ""}</p>
        <Checkbox checked={checked} onChange={setChecked} label={copy.checked} />
        <Button type="submit" disabled={busy || !status?.recordingEnabled || status.quotaReached || draftTooLarge || !checked || !draftThread.trim() || !draftText.trim()}>{copy.save}</Button>
      </form>
    </Panel>
  </section>;
}
