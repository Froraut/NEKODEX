import { useEffect, useId, useRef, useState } from "react";
import type { AccountProxy, Language } from "./types";
import type { Copy } from "./i18n";
import { normalizeAccountProxy } from "./account-proxy-validation";
import "./account-forms.css";

const restoreSavedProxyCopy: Record<Language, string> = {
  en: "Restore saved proxy",
  ru: "Восстановить сохранённый прокси",
  "zh-CN": "恢复已保存的代理",
  "zh-TW": "還原已儲存的代理",
  ja: "保存済みのプロキシに戻す",
  ko: "저장된 프록시 복원",
};

export function AccountProxySettings({ proxy, language, disabled, blockedReason, copy, save }: {
  proxy: AccountProxy; language: Language; disabled: boolean; blockedReason?: string; copy: Copy;
  save: (value: AccountProxy) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState(proxy);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const statusId = useId();
  const saved = JSON.stringify(proxy);
  useEffect(() => { setDraft(JSON.parse(saved)); setTouched(false); setFailed(false); }, [saved]);
  const normalized = normalizeAccountProxy(draft);
  const changed = JSON.stringify(normalized.value) !== JSON.stringify(normalizeAccountProxy(proxy).value);
  const draftChanged = draft.mode !== proxy.mode || (draft.url ?? "") !== (proxy.url ?? "");
  const needsUrl = !["system", "direct"].includes(draft.mode);
  const invalid = normalized.error && (touched || Boolean(draft.url));
  const errorText = normalized.error === "pac" ? copy.accountProxyPacInvalid
    : normalized.error === "socks-port" ? copy.accountProxySocksPort : copy.accountProxyInvalid;
  const submit = async () => {
    if (disabled || inFlight.current || !changed || !normalized.value) return;
    inFlight.current = true; setSaving(true); setFailed(false);
    try { if (!await save(normalized.value)) { setFailed(true); } }
    finally { inFlight.current = false; setSaving(false); }
  };
  const restoreSaved = () => {
    if (disabled || inFlight.current || !draftChanged) return;
    setDraft({ ...proxy }); setTouched(false); setFailed(false);
  };
  return <details className="account-form-panel account-proxy">
    <summary>{copy.accountProxy}</summary>
    <p>{copy.accountProxyBody}</p>
    <form onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={disabled || saving} aria-describedby={statusId}>
        <select className="settings-select" aria-label={copy.accountProxy} value={draft.mode}
          onChange={event => { setTouched(false); setFailed(false); setDraft({ mode: event.target.value as AccountProxy["mode"], url: "" }); }}>
          <option value="system">{copy.proxySystem}</option><option value="direct">{copy.proxyDirect}</option>
          <option value="http">HTTP</option><option value="https">HTTPS</option>
          <option value="socks5">SOCKS5</option><option value="pac">PAC (HTTPS)</option>
        </select>
        {needsUrl ? <label>{copy.proxyUrl}<input ref={input} type="url" required maxLength={2048}
          aria-invalid={Boolean(invalid)} aria-describedby={statusId}
          value={draft.url ?? ""} placeholder={draft.mode === "pac" ? "https://example.com/proxy.pac" : `${draft.mode}://127.0.0.1:8080`}
          autoComplete="off" spellCheck={false} onBlur={() => setTouched(true)}
          onChange={event => { setFailed(false); setDraft({ ...draft, url: event.target.value }); }} /></label> : null}
        <button type="submit" className="button-secondary" disabled={!changed || !normalized.value || saving}>
          {saving ? copy.accountFormSaving : copy.proxySave}
        </button>
        <button type="button" className="button-secondary" disabled={!draftChanged || saving}
          onClick={restoreSaved}>{restoreSavedProxyCopy[language]}</button>
      </fieldset>
      <p id={statusId} className={invalid || failed ? "field-error" : "field-hint"} role={invalid || failed ? "alert" : "status"}>
        {blockedReason || (invalid ? errorText : failed ? copy.accountFormFailed : saving ? copy.accountFormSaving
          : changed ? copy.accountFormUnsaved : copy.accountFormSaved)}
      </p>
    </form>
  </details>;
}
