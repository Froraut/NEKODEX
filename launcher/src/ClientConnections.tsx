import { useEffect, useId, useRef, useState } from "react";
import type { ClientConnectionAction, ClientConnectionsSnapshot, Language } from "./types";
import { Icon } from "./icons";

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
  return <details className="setup-troubleshooting client-connections">
    <summary>{copy.title}<Icon name="chevron" /></summary>
    <div className="setup-overview">
      <p>{copy.body}</p>
      {!configured || devProfile ? <p>{devProfile ? copy.dev : copy.setup}</p> : <>
        {pending && !status ? <p role="status">{copy.loading}</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        <button type="button" className="text-button" disabled={locked} onClick={() => void load()}>{copy.retry}</button>
        {status ? <>
          <section aria-label={copy.api}>
            <strong>{copy.api} · {status.api.enabled ? copy.enabled : copy.disabled}</strong>
            <p>{copy.apiBody}</p>
            {status.api.enabled ? <p><code>{status.api.baseUrl}</code></p> : null}
            <div className="browser-empty-actions">
              <button type="button" className="button-secondary" disabled={locked} onClick={() => void act(status.api.enabled ? "api-disable" : "api-enable")}>{status.api.enabled ? copy.disable : copy.enable}</button>
              {status.api.enabled ? <button type="button" className="button-secondary" disabled={locked} onClick={() => void copyKey()}>{copy.copy}</button> : null}
            </div>
            {status.api.enabled ? <details><summary>{copy.rotate}</summary><p>{copy.rotateBody}</p>
              <button type="button" className="button-secondary" disabled={locked} onClick={() => void act("api-rotate")}>{copy.rotate}</button></details> : null}
          </section>
          <section aria-label={copy.claude}>
            <strong>{copy.claude} · {status.claude.installed ? copy.configured : copy.missing}</strong>
            <p>{copy.claudeBody}</p>
            {status.claude.issue ? <p role="status">{status.claude.issue}</p> : null}
            <div className="browser-empty-actions">
              <button type="button" className="button-secondary" disabled={locked} onClick={() => void act("claude-connect")}>{status.claude.installed ? copy.reconnect : copy.connect}</button>
              {status.claude.installed ? <button type="button" className="text-button" disabled={locked} onClick={() => void act("claude-disconnect")}>{copy.disconnect}</button> : null}
            </div>
          </section>
          {status.provider.issue && (!status.provider.installed || !status.provider.active) ? <p role="alert">{status.provider.issue}</p> : null}
          {status.provider.installed && status.provider.active ? <section aria-label={copy.provider}>
            <label htmlFor={modeId}>{copy.provider}</label>
            <p>{copy.providerBody}</p>
            {status.provider.issue ? <p role="alert">{status.provider.issue}</p> : null}
            <div className="browser-empty-actions">
              <select id={modeId} className="settings-select" disabled={locked} value={mode ?? status.provider.mode}
                onChange={event => setMode(event.target.value as "mixed" | "web-only")}>
                <option value="mixed">{copy.mixed}</option><option value="web-only">{copy.web}</option>
              </select>
              <button type="button" className="button-secondary" disabled={locked || !mode || mode === status.provider.mode}
                onClick={() => void act(mode === "web-only" ? "provider-web-only" : "provider-mixed")}>{copy.apply}</button>
            </div>
            {status.provider.mode === "mixed" && status.provider.picker ? <>
              <label className="account-policy-enabled"><span><input type="checkbox" disabled={locked}
                checked={status.provider.picker === "on"}
                onChange={event => void act(event.target.checked ? "provider-picker-on" : "provider-picker-off")} /> {copy.picker}</span></label>
              <p>{copy.pickerBody}</p>
            </> : null}
          </section> : null}
        </> : null}
      </>}
      {notice ? <p role="status">{notice}</p> : null}
    </div>
  </details>;
}
