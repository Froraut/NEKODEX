import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import type { Language } from "./types";
import type { WorkspaceTerminalApi, WorkspaceTerminalSession } from "./workspace-terminal-types";
import { Badge, Button, Notice, Panel, Select } from "./design";
import "@xterm/xterm/css/xterm.css";
import "./surfaces/workspace-terminal.css";

const copy = {
  en: { title: "Terminal", open: "Open terminal", close: "Close terminal", select: "Terminal session", retry: "Refresh terminals",
    choose: "Choose a workspace folder first.", empty: "Open a terminal to start your shell in this folder.",
    owner: "Commands run as your user. You control this shell; terminal input is never supplied by an agent.",
    running: "Running", closing: "Closing", closed: "Closed", exited: "Exited", error: "Error", loading: "Checking terminal provider…",
    eof: "End of terminal output", dropped: "Some older output was discarded to keep the terminal bounded.",
    paste: "Input is too large or still sending. Paste a smaller selection.", paused: "Output paused while the display catches up", exitCode: "Exit code" },
  ru: { title: "Терминал", open: "Открыть терминал", close: "Закрыть терминал", select: "Сеанс терминала", retry: "Обновить терминалы",
    choose: "Сначала выберите папку рабочей области.", empty: "Откройте терминал, чтобы запустить оболочку в этой папке.",
    owner: "Команды выполняются от вашего имени. Оболочкой управляете вы; агент не передаёт в неё команды.",
    running: "Работает", closing: "Закрывается", closed: "Закрыт", exited: "Завершён", error: "Ошибка", loading: "Проверка терминала…",
    eof: "Конец вывода терминала", dropped: "Часть старого вывода удалена для ограничения объёма терминала.",
    paste: "Слишком большой ввод или предыдущий ввод ещё отправляется. Вставьте меньший фрагмент.",
    paused: "Вывод приостановлен, пока экран его обрабатывает", exitCode: "Код завершения" },
};
const reason = (error: unknown) => error instanceof Error ? error.message : String(error);
const refFor = (session: WorkspaceTerminalSession) => ({ id: session.id, generation: session.generation });

function TerminalView({ api, session, onSession, onError, c }: {
  api: WorkspaceTerminalApi; session: WorkspaceTerminalSession;
  onSession: (session: WorkspaceTerminalSession) => void; onError: (message: string) => void; c: typeof copy.en;
}) {
  const host = useRef<HTMLDivElement>(null);
  // Status updates never recreate the emulator or replay captured keyboard input.
  const callbacks = useRef({ onSession, onError, c }); callbacks.current = { onSession, onError, c };
  useEffect(() => {
    const element = host.current; if (!element) return;
    let active = true; let cursor = 0; let timer: ReturnType<typeof setTimeout> | undefined;
    let inputQueue = Promise.resolve(); let pendingInput = 0;
    const reference = refFor(session);
    const terminal = new Terminal({ cols: session.cols, rows: session.rows, cursorBlink: true,
      scrollback: 3000, fontSize: 13, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      allowProposedApi: false, screenReaderMode: true, convertEol: false });
    terminal.open(element);
    const applyTheme = () => {
      const style = getComputedStyle(element);
      terminal.options.theme = { background: style.getPropertyValue("--terminal-background").trim() || "#14171c",
        foreground: style.getPropertyValue("--terminal-foreground").trim() || "#edf0f5" };
    };
    applyTheme(); const theme = new MutationObserver(applyTheme);
    theme.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    const input = terminal.onData((data) => {
      const bytes = new TextEncoder().encode(data).length;
      if (bytes > 16384 || pendingInput + bytes > 65536) { callbacks.current.onError(callbacks.current.c.paste); return; }
      pendingInput += bytes;
      inputQueue = inputQueue.then(async () => {
        if (active) await api.terminalWrite(reference, data);
      }).catch((error) => { if (active) callbacks.current.onError(reason(error)); })
        .finally(() => { pendingInput -= bytes; });
    });
    const resize = new ResizeObserver(() => {
      if (!active || !element.clientWidth || !element.clientHeight) return;
      // Measure the renderer's actual monospace cell; keep host and PTY geometry in sync.
      const probe = document.createElement("span"); probe.textContent = "W";
      Object.assign(probe.style, { position: "absolute", visibility: "hidden", font: "13px ui-monospace, SFMono-Regular, Menlo, monospace" });
      element.append(probe); const cell = probe.getBoundingClientRect(); probe.remove();
      const cols = Math.max(20, Math.min(300, Math.floor((element.clientWidth - 18) / (cell.width || 8))));
      const rows = Math.max(5, Math.min(120, Math.floor(element.clientHeight / (cell.height || 16))));
      if (cols === terminal.cols && rows === terminal.rows) return;
      terminal.resize(cols, rows);
      void api.terminalResize(reference, { cols, rows }).catch((error) => { if (active) callbacks.current.onError(reason(error)); });
    });
    resize.observe(element);
    const poll = async () => {
      try {
        const result = await api.terminalRead(reference, cursor); if (!active) return;
        if (result.dropped) terminal.writeln(`\r\n[${callbacks.current.c.dropped}]`);
        const text = result.chunks.map((chunk) => chunk.data).join("");
        // Acknowledge only after xterm has rendered the bounded batch. This lets
        // native pause/resume apply backpressure when the renderer is hidden/slow.
        if (text) await new Promise<void>((resolve) => terminal.write(text, resolve));
        if (!active) return;
        cursor = result.cursor; callbacks.current.onSession(result.session);
        terminal.options.disableStdin = result.session.state !== "running";
        if (result.eof) {
          terminal.writeln(`\r\n[${callbacks.current.c.eof}${result.session.exitCode === null ? "" : ` · ${callbacks.current.c.exitCode}: ${result.session.exitCode}`}]`);
          return;
        }
        timer = setTimeout(() => { void poll(); }, result.chunks.length ? 30 : 180);
      } catch (error) { if (active) callbacks.current.onError(reason(error)); }
    };
    void poll();
    return () => {
      active = false; clearTimeout(timer); input.dispose(); resize.disconnect(); theme.disconnect(); terminal.dispose();
      // Navigation never kills a human shell. Main owns it until explicit Close or app Quit.
    };
  // Captured id+generation prevent an old keyboard/read continuation targeting a new shell.
  }, [api, session.id, session.generation]);
  return <div ref={host} className="nk-workspace-terminal__emulator" aria-label={c.title} />;
}

export function WorkspaceTerminal({ api, workspaceId, language }: {
  api: WorkspaceTerminalApi; workspaceId: string | null; language: Language;
}) {
  const c = language === "ru" ? copy.ru : copy.en;
  const [available, setAvailable] = useState<boolean | null>(null);
  const [sessions, setSessions] = useState<WorkspaceTerminalSession[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [observation, setObservation] = useState(0);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const currentRoot = useRef(workspaceId); currentRoot.current = workspaceId;
  const selected = sessions.find((session) => session.id === selectedId) || sessions[0];
  const refresh = async () => {
    const captured = workspaceId; setError("");
    try {
      const status = await api.terminalAvailability(); if (currentRoot.current !== captured) return;
      setAvailable(status.available);
      if (!status.available) { setError(status.message); return; }
      if (captured) { const list = await api.terminalList(captured); if (currentRoot.current === captured) { setSessions(list); setObservation((value) => value + 1); } }
    } catch (error) { if (currentRoot.current === captured) setError(reason(error)); }
  };
  useEffect(() => { setSessions([]); setSelectedId(""); setAvailable(null); void refresh(); }, [api, workspaceId]);
  const act = async (action: "open" | "close") => {
    const captured = workspaceId; if (!captured || busy) return;
    setBusy(true); setError("");
    try {
      if (action === "open") {
        const opened = await api.terminalOpen(captured);
        if (currentRoot.current === captured) { setSessions((old) => [...old, opened]); setSelectedId(opened.id); }
      } else if (selected) {
        const closed = await api.terminalClose(refFor(selected));
        if (currentRoot.current === captured) {
          if (closed.state === "error") { setError(closed.error || c.error); return; }
          setSessions((old) => old.filter((item) => item.id !== closed.id));
        }
      }
    } catch (error) { if (currentRoot.current === captured) setError(reason(error)); }
    finally { setBusy(false); }
  };
  return <Panel title={c.title} className="nk-workspace-terminal">
    <div className="nk-workspace-terminal__toolbar">
      <Button size="sm" onClick={() => { void act("open"); }} disabled={!workspaceId || available !== true || busy}>{c.open}</Button>
      <Button size="sm" onClick={() => { void act("close"); }} disabled={!selected || busy}>{c.close}</Button>
      <Button size="sm" onClick={() => { void refresh(); }} disabled={busy}>{c.retry}</Button>
      {sessions.length > 0 && <Select label={c.select} value={selected?.id || ""} onChange={setSelectedId}
        options={sessions.map((session, index) => ({ value: session.id, label: `${index + 1} · ${c[session.state]}` }))} />}
      {selected && <Badge>{c[selected.state]}{selected.exitCode !== null ? ` · ${selected.exitCode}` : ""}</Badge>}
    </div>
    <p className="nk-workspace-terminal__ownership">{c.owner}</p>
    {error && <Notice tone="error">{error}</Notice>}
    {!workspaceId ? <p>{c.choose}</p> : available === null ? <p role="status">{c.loading}</p> : !selected ? <p>{c.empty}</p> : <>
      <p className="nk-workspace-terminal__cwd">{selected.cwd}</p>
      {selected.paused && <p role="status">{c.paused}</p>}
      {selected.error && <Notice tone="error">{selected.error}</Notice>}
      <TerminalView key={`${selected.id}:${selected.generation}:${observation}`} api={api} session={selected} c={c} onError={setError}
        onSession={(next) => { if (currentRoot.current === next.workspaceId) setSessions((old) => old.map((session) =>
          session.id === next.id && session.generation === next.generation ? next : session)); }} />
    </>}
  </Panel>;
}
