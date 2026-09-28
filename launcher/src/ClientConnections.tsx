import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { ClientConnectionAction, ClientConnectionsSnapshot, Language } from "./types";
import { Badge, Button, Checkbox, Disclosure, Notice, Select } from "./design";
import "./surfaces/connections.css";

const words = {
  en: {
    title: "Other clients", body: "Use this workspace's ChatGPT models in Claude Code or a local API client.",
    loading: "Checking connections…", retry: "Refresh", api: "Local API", enabled: "Enabled", disabled: "Disabled",
    apiBody: "Chat Completions and Messages on this computer. Requests use your ChatGPT session and its limits.",
    enable: "Enable API", disable: "Disable API", copy: "Copy API key", copied: "API key copied", rotate: "Replace API key",
    rotateBody: "Replacing the key disconnects clients using the old one. Reconnect Claude Code and update other clients.",
    claude: "Claude Code", claudeBody: "Claude Code runs the tools and keeps its permissions. ChatGPT supplies the model responses.",
    connect: "Connect Claude Code", reconnect: "Refresh Claude settings", disconnect: "Disconnect", configured: "Configured", missing: "Not configured",
    claudeRestart: "Settings saved. Restart Claude Code to load this connection.",
    provider: "Codex provider", mixed: "Native and Web models", web: "Web models only", apply: "Apply provider mode",
    providerBody: "Web-only uses a separate provider when native Codex account limits prevent Web tasks from starting. ChatGPT limits still apply; native models are unavailable in this mode.",
    codexRestart: "Provider saved. Fully quit and reopen Codex, then start a new task.",
    picker: "Show Web models in the Codex app model picker",
    pickerBody: "The Codex app lists only models OpenAI allows for your account. NEKODEX gives Codex its own model list with your native and Web models and keeps it up to date. Codex reads the list when it starts; restart it after model changes.",
    pickerRestart: "Model list saved. Fully quit and reopen Codex to see it.",
    setup: "Connect your models first to configure other clients.", dev: "Use the main NEKODEX app to configure your installed clients.",
  },
  ru: {
    title: "Другие клиенты", body: "Используйте модели ChatGPT этого приложения в Claude Code и клиентах локального API.",
    loading: "Проверяем подключения…", retry: "Обновить", api: "Локальный API", enabled: "Включён", disabled: "Выключен",
    apiBody: "Chat Completions и Messages на этом компьютере. Запросы используют вашу сессию ChatGPT и её лимиты.",
    enable: "Включить API", disable: "Выключить API", copy: "Скопировать API-ключ", copied: "API-ключ скопирован", rotate: "Заменить API-ключ",
    rotateBody: "После замены ключа старый перестанет работать. Обновите подключение Claude Code и ключ в других клиентах.",
    claude: "Claude Code", claudeBody: "Claude Code выполняет инструменты со своими разрешениями. Ответы модели поступают из ChatGPT.",
    connect: "Подключить Claude Code", reconnect: "Обновить настройки Claude", disconnect: "Отключить", configured: "Настроен", missing: "Не настроен",
    claudeRestart: "Настройки сохранены. Перезапустите Claude Code, чтобы применить подключение.",
    provider: "Провайдер Codex", mixed: "Native и Web модели", web: "Только Web модели", apply: "Применить режим провайдера",
    providerBody: "Режим Web-only использует отдельного провайдера, если лимит Native-аккаунта Codex мешает запуску Web-задач. Лимиты ChatGPT сохраняются; Native-модели в этом режиме недоступны.",
    codexRestart: "Провайдер сохранён. Полностью закройте и откройте Codex, затем начните новую задачу.",
    picker: "Показывать Web-модели в выборе моделей Codex",
    pickerBody: "Приложение Codex показывает только модели, разрешённые OpenAI для вашего аккаунта. NEKODEX передаёт Codex собственный список с Native- и Web-моделями и поддерживает его актуальным. Codex читает список при запуске — после изменения моделей перезапустите его.",
    pickerRestart: "Список моделей сохранён. Полностью закройте и откройте Codex, чтобы его увидеть.",
    setup: "Сначала подключите модели, затем настройте другие клиенты.", dev: "Настраивайте установленные клиенты в основном приложении NEKODEX.",
  },
};

export function ClientConnections({ language, busy, configured, devProfile }: {
  language: Language; busy: boolean; configured: boolean; devProfile: boolean;
}) {
  const copy = language === "ru" ? words.ru : words.en;
  const [status, setStatus] = useState<ClientConnectionsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"mixed" | "web-only" | null>(null);
  const inFlight = useRef(false), mounted = useRef(true);
  const modeId = useId();
  const load = async () => {
    if (inFlight.current) return;
    inFlight.current = true; setPending(true); setError(null);
    try {
      const next = await window.codexWebLauncher!.getClientConnections();
      if (mounted.current) setStatus(next);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : copy.loading); }
    finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  useEffect(() => {
    mounted.current = true;
    if (configured && !devProfile) void load();
    return () => { mounted.current = false; };
  }, [configured, devProfile]);
  const act = async (action: ClientConnectionAction) => {
    if (busy || inFlight.current || devProfile) return;
    inFlight.current = true; setPending(true); setError(null); setNotice(null);
    try {
      const next = await window.codexWebLauncher!.changeClientConnection(action);
      if (!mounted.current) return;
      setStatus(next);
      if (action.startsWith("provider-picker-")) setNotice(copy.pickerRestart);
      else if (action.startsWith("provider-")) { setMode(null); setNotice(copy.codexRestart); }
      if (action === "claude-connect") setNotice(copy.claudeRestart);
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : copy.loading); }
    finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  const copyKey = async () => {
    if (busy || inFlight.current || devProfile) return;
    inFlight.current = true; setPending(true); setError(null);
    try { await window.codexWebLauncher!.copyClientApiKey(); if (mounted.current) setNotice(copy.copied); }
    catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : copy.loading); }
    finally { inFlight.current = false; if (mounted.current) setPending(false); }
  };
  const locked = busy || pending || devProfile;
  return <Disclosure className="nk-clients" hint={`${copy.claude}, ${copy.api}`} title={copy.title}>
    <div className="nk-connections__stack">
    <div className="nk-clients__intro">
      <p>{copy.body}</p>
      {configured && !devProfile ? <Button busy={pending} disabled={locked} icon="reload" onClick={() => void load()} size="sm" variant="ghost">
        {copy.retry}
      </Button> : null}
    </div>
    {!configured || devProfile ? <Notice>{devProfile ? copy.dev : copy.setup}</Notice> : <>
      {pending && !status ? <p className="nk-connections__status" role="status">{copy.loading}</p> : null}
      {error ? <Notice tone="error">{error}</Notice> : null}
      {status ? <>
        <ClientRow
          actions={<>
            <Button disabled={locked} onClick={() => void act(status.api.enabled ? "api-disable" : "api-enable")} size="sm">
              {status.api.enabled ? copy.disable : copy.enable}
            </Button>
            {status.api.enabled ? <Button disabled={locked} onClick={() => void copyKey()} size="sm">{copy.copy}</Button> : null}
          </>}
          body={copy.apiBody}
          label={copy.api}
          ready={status.api.enabled}
          status={status.api.enabled ? copy.enabled : copy.disabled}
        >
          {status.api.enabled ? <p><code className="nk-clients__code">{status.api.baseUrl}</code></p> : null}
          {status.api.enabled ? <details className="nk-connections__nested"><summary>{copy.rotate}</summary><p>{copy.rotateBody}</p>
            <Button disabled={locked} onClick={() => void act("api-rotate")} size="sm" variant="danger">{copy.rotate}</Button></details> : null}
        </ClientRow>
        <ClientRow
          actions={<>
            <Button disabled={locked} onClick={() => void act("claude-connect")} size="sm">{status.claude.installed ? copy.reconnect : copy.connect}</Button>
            {status.claude.installed ? <Button disabled={locked} onClick={() => void act("claude-disconnect")} size="sm" variant="ghost">{copy.disconnect}</Button> : null}
          </>}
          body={copy.claudeBody}
          label={copy.claude}
          ready={status.claude.installed}
          status={status.claude.installed ? copy.configured : copy.missing}
        >
          {status.claude.issue ? <p className="nk-clients__issue" role="status">{status.claude.issue}</p> : null}
        </ClientRow>
        {status.provider.issue && (!status.provider.installed || !status.provider.active) ? <Notice tone="error">{status.provider.issue}</Notice> : null}
        {status.provider.installed && status.provider.active ? <section aria-label={copy.provider} className="nk-clients__row">
          <div className="nk-clients__copy">
            <label className="nk-clients__label" htmlFor={modeId}>{copy.provider}</label>
            <p>{copy.providerBody}</p>
            {status.provider.issue ? <p className="nk-clients__issue" role="alert">{status.provider.issue}</p> : null}
          </div>
          <div className="nk-clients__actions">
            <Select disabled={locked} id={modeId} onChange={value => setMode(value as "mixed" | "web-only")}
              options={[{ value: "mixed", label: copy.mixed }, { value: "web-only", label: copy.web }]}
              value={mode ?? status.provider.mode} />
            <Button disabled={locked || !mode || mode === status.provider.mode} size="sm"
              onClick={() => void act(mode === "web-only" ? "provider-web-only" : "provider-mixed")}>{copy.apply}</Button>
          </div>
          {status.provider.mode === "mixed" && status.provider.picker ? <div className="nk-clients__picker">
            <Checkbox checked={status.provider.picker === "on"} disabled={locked} label={copy.picker}
              onChange={checked => void act(checked ? "provider-picker-on" : "provider-picker-off")} />
            <p>{copy.pickerBody}</p>
          </div> : null}
        </section> : null}
      </> : null}
    </>}
    {notice ? <Notice tone="success">{notice}</Notice> : null}
    </div>
  </Disclosure>;
}

/** One client: name with its status badge and explanation on the left, its actions right-aligned. */
function ClientRow({ actions, body, children, label, ready, status }: {
  actions: ReactNode; body: string; children?: ReactNode; label: string; ready: boolean; status: string;
}) {
  return <section aria-label={label} className="nk-clients__row">
    <div className="nk-clients__copy">
      <strong className="nk-clients__label">{label}<Badge dot={ready ? "ready" : "idle"} tone={ready ? "success" : undefined}>{status}</Badge></strong>
      <p>{body}</p>
      {children}
    </div>
    <div className="nk-clients__actions">{actions}</div>
  </section>;
}
