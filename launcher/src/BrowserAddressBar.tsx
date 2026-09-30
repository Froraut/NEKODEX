import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Icon, cx } from "./design";
import { messageOf } from "./launcher-ui";
import { browserAddressCopy } from "./browser-address-copy";
import type { Copy } from "./i18n";
import type { Language } from "./types";

const api = window.codexWebLauncher;

// Main-process refusals (electron/browser-navigation-policy.cjs, external-links.cjs) shown in the user's language.
const INVALID_ADDRESS = /^(?:Enter a ChatGPT page or a web address|Invalid browser address)$/;
const BLOCKED_EXTERNAL = /(?:Local|Private) external links are blocked|resolved to a local or private address/i;

/**
 * The toolbar address. At rest it shows the readable location; focused, it holds the full URL, all selected.
 * Enter opens a ChatGPT page in the ChatGPT tab (other web addresses open in the system browser),
 * Escape restores the current address and a second Escape leaves the field. ⌘L / Ctrl+L focuses it from the page.
 */
export function BrowserAddressBar({ url, copy, language, platform, locked, setError }: {
  url: string | undefined;
  copy: Copy;
  language: Language;
  platform: string;
  locked: boolean;
  setError: (error: string | null) => void;
}) {
  const text = browserAddressCopy(language);
  const field = useRef<HTMLInputElement>(null);
  // null while not editing: the field follows the page's location.
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const selectAll = useRef(false);
  const pointerFocus = useRef(false);
  const current = editableBrowserAddress(url);
  const shortcut = platform === "darwin" ? "⌘L" : "Ctrl+L";

  useLayoutEffect(() => {
    if (!selectAll.current) return;
    selectAll.current = false;
    field.current?.select();
  });
  useEffect(() => api?.onBrowserFocusAddress?.(() => {
    const input = field.current;
    if (!input) return;
    if (document.activeElement === input) input.select();
    else input.focus();
  }), []);

  const submit = async () => {
    const address = draft?.trim() ?? "";
    if (!address || pending || locked) return;
    setPending(true);
    setError(null);
    try {
      await api!.openBrowserAddress(address);
      setInvalid(false);
      setDraft(null);
      field.current?.blur();
    } catch (cause) {
      const detail = messageOf(cause);
      const rejected = INVALID_ADDRESS.test(detail);
      setInvalid(rejected);
      setError(rejected ? text.invalid : BLOCKED_EXTERNAL.test(detail) ? text.externalBlocked : detail);
      if (document.activeElement === field.current) selectAll.current = true;
      else setDraft(null);
    } finally {
      setPending(false);
    }
  };

  return (
    <label className={cx("browser-nav__location", invalid && "is-invalid")}
      title={locked ? copy.browserNavigationBusy : current ? `${current}\n${text.hint(shortcut)}` : text.hint(shortcut)}>
      <Icon className="nk-icon" name="globe" />
      <input
        ref={field}
        className="browser-nav__address"
        type="text"
        value={draft ?? readableBrowserAddress(url, copy)}
        placeholder={text.placeholder}
        aria-label={text.label}
        aria-invalid={invalid || undefined}
        readOnly={locked || pending}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        autoComplete="off"
        enterKeyHint="go"
        onFocus={() => {
          setDraft(value => value ?? current);
          selectAll.current = true;
        }}
        onMouseDown={() => { pointerFocus.current = document.activeElement !== field.current; }}
        onMouseUp={(event) => {
          // The first click selects the whole address, as in a desktop browser; a drag keeps its own selection.
          if (!pointerFocus.current) return;
          pointerFocus.current = false;
          const input = event.currentTarget;
          if (input.selectionStart !== input.selectionEnd) return;
          event.preventDefault();
          input.select();
        }}
        onBlur={() => {
          if (pending) return;
          setDraft(null);
          setInvalid(false);
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
        }}
        onKeyDown={(event) => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Enter") {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            if (draft !== current) {
              setDraft(current);
              setInvalid(false);
              selectAll.current = true;
            } else {
              event.currentTarget.blur();
            }
          }
        }}
      />
    </label>
  );
}

/** The full address a user edits or copies; empty for the launcher's own placeholder documents. */
export function editableBrowserAddress(url: string | undefined): string {
  if (!url) return "";
  try {
    return ["http:", "https:"].includes(new URL(url).protocol) ? url : "";
  } catch {
    return "";
  }
}

/** The location at rest: host and path, Temporary Chat by name. */
export function readableBrowserAddress(url: string | undefined, copy: Copy): string {
  const address = editableBrowserAddress(url);
  if (!address) return "";
  const parsed = new URL(address);
  if (parsed.hostname === "chatgpt.com" && parsed.searchParams.get("temporary-chat") === "true") {
    return `chatgpt.com  /  ${copy.temporaryChat}`;
  }
  return `${parsed.hostname}${parsed.pathname === "/" ? "" : parsed.pathname}`;
}
