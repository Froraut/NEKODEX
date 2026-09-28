import { useEffect, useId, useRef, useState } from "react";
import type { AccountProxy, Language } from "./types";
import type { Copy } from "./i18n";
import { normalizeAccountProxy } from "./account-proxy-validation";
import { Button, Select, TextField, cx } from "./design";

const restoreSavedProxyCopy: Record<Language, string> = {
  en: "Restore saved proxy",
  ru: "Восстановить сохранённый прокси",
  "zh-CN": "恢复已保存的代理",
  "zh-TW": "還原已儲存的代理",
  ja: "保存済みのプロキシに戻す",
  ko: "저장된 프록시 복원",
};

export function proxyModeOptions(copy: Copy) {
  return [
    { value: "system", label: copy.proxySystem }, { value: "direct", label: copy.proxyDirect },
    { value: "http", label: "HTTP" }, { value: "https", label: "HTTPS" },
    { value: "socks5", label: "SOCKS5" }, { value: "pac", label: "PAC (HTTPS)" },
  ];
}

export function AccountProxySettings({ proxy, language, disabled, blockedReason, copy, save, onStateChange }: {
  proxy: AccountProxy; language: Language; disabled: boolean; blockedReason?: string; copy: Copy;
  save: (value: AccountProxy) => Promise<boolean>;
  /** Reports "Saving…" / "Could not save…" / "Unsaved changes" (or null) for the enclosing disclosure summary. */
  onStateChange?: (state: string | null) => void;
}) {
  const [draft, setDraft] = useState(proxy);
  const [touched, setTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  const statusId = useId();
  const saved = JSON.stringify(proxy);
  const previousSaved = useRef(saved);
  useEffect(() => {
    const previous = JSON.parse(previousSaved.current) as AccountProxy;
    const next = JSON.parse(saved) as AccountProxy;
    previousSaved.current = saved;
    // Host refreshes may bring another saved value while this form has a draft.
    // Only replace a clean draft or acknowledge the value that was just saved.
    const dirty = draft.mode !== previous.mode || (draft.url ?? "") !== (previous.url ?? "");
    const acknowledged = JSON.stringify(normalizeAccountProxy(draft).value)
      === JSON.stringify(normalizeAccountProxy(next).value);
    if (!dirty || acknowledged) {
      setDraft(next); setTouched(false); setFailed(false);
    }
  }, [saved]);
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
  const modeOptions = proxyModeOptions(copy);
  const formState = saving ? copy.accountFormSaving : failed ? copy.accountFormFailed : draftChanged ? copy.accountFormUnsaved : null;
  useEffect(() => { onStateChange?.(formState); }, [formState, onStateChange]);
  return <section className="accounts-controls__section" aria-labelledby={`${statusId}-title`}>
    <header className="accounts-controls__head">
      <h3 id={`${statusId}-title`} className="nk-type-label">{copy.accountProxy}</h3>
      {formState ? <span className="accounts-hint is-attention nk-type-caption">{formState}</span> : null}
    </header>
    <p>{copy.accountProxyBody}</p>
    <form className="accounts-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
      <fieldset disabled={disabled || saving} aria-describedby={statusId}>
        <div className="accounts-proxy__fields">
          <Select label={copy.accountProxy} value={draft.mode} options={modeOptions}
            onChange={value => { setTouched(false); setFailed(false); setDraft({ mode: value as AccountProxy["mode"], url: "" }); }} />
          {needsUrl ? <TextField ref={input} label={copy.proxyUrl} type="url" required maxLength={2048}
            aria-invalid={Boolean(invalid)} aria-describedby={statusId}
            value={draft.url ?? ""} placeholder={draft.mode === "pac" ? "https://example.com/proxy.pac" : `${draft.mode}://127.0.0.1:8080`}
            autoComplete="off" spellCheck={false} onBlur={() => setTouched(true)}
            onChange={event => { setFailed(false); setDraft({ ...draft, url: event.target.value }); }} /> : null}
        </div>
        <div className="accounts-inline-actions">
          <Button type="submit" size="sm" busy={saving} disabled={!changed || !normalized.value}>
            {saving ? copy.accountFormSaving : copy.proxySave}
          </Button>
          <Button size="sm" variant="ghost" disabled={!draftChanged || saving}
            onClick={restoreSaved}>{restoreSavedProxyCopy[language]}</Button>
        </div>
      </fieldset>
      <p id={statusId} className={cx("accounts-form__status nk-type-caption", (invalid || failed) && "is-error")} role={invalid || failed ? "alert" : "status"}>
        {blockedReason || (invalid ? errorText : failed ? copy.accountFormFailed : saving ? copy.accountFormSaving
          : changed ? copy.accountFormUnsaved : copy.accountFormSaved)}
      </p>
    </form>
  </section>;
}
