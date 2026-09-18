import { useEffect, useState } from "react";
import type { AccountProxy } from "./types";
import type { Copy } from "./i18n";

export function AccountProxySettings({ proxy, disabled, copy, save }: {
  proxy: AccountProxy; disabled: boolean; copy: Copy; save: (value: AccountProxy) => void;
}) {
  const [draft, setDraft] = useState(proxy);
  const saved = JSON.stringify(proxy);
  useEffect(() => { setDraft(JSON.parse(saved)); }, [saved]);
  const needsUrl = !['system', 'direct'].includes(draft.mode);
  return <details>
    <summary>{copy.accountProxy}</summary>
    <p>{copy.accountProxyBody}</p>
    <form onSubmit={event => { event.preventDefault(); if (!disabled) save(draft); }}>
      <fieldset disabled={disabled}>
        <select aria-label={copy.accountProxy} value={draft.mode}
          onChange={event => setDraft({ mode: event.target.value as AccountProxy['mode'], url: '' })}>
          <option value="system">{copy.proxySystem}</option><option value="direct">{copy.proxyDirect}</option>
          <option value="http">HTTP</option><option value="https">HTTPS</option>
          <option value="socks5">SOCKS5</option><option value="pac">PAC (HTTPS)</option>
        </select>
        {needsUrl ? <label>{copy.proxyUrl}<input type="url" required maxLength={2048}
          value={draft.url ?? ''} placeholder={draft.mode === 'pac' ? 'https://example.com/proxy.pac' : `${draft.mode}://127.0.0.1:8080`}
          autoComplete="off" spellCheck={false} onChange={event => setDraft({ ...draft, url: event.target.value })} /></label> : null}
        <button type="submit" className="button-secondary">{copy.proxySave}</button>
      </fieldset>
    </form>
  </details>;
}
