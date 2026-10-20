import { useEffect, useId, useRef, useState, type KeyboardEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { Button, TextField } from "./design";
import { collectSettingsSearchEntries, filterSettingsSearchEntries, navigateToSetting, type SettingsSearchEntry } from "./settings-search";
import { settingsSearchCopy } from "./settings-search-copy";
import type { Language } from "./types";

export function SettingsSearch({ surface, language, reveal }: {
  surface: RefObject<HTMLElement | null>;
  language: Language;
  reveal: (row: HTMLElement) => void;
}) {
  const copy = settingsSearchCopy(language);
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState(true);
  const [entries, setEntries] = useState<SettingsSearchEntry[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const results = useRef<HTMLUListElement>(null);
  const id = useId();
  useEffect(() => {
    const root = surface.current;
    if (!root) return;
    const refresh = () => setEntries(collectSettingsSearchEntries(root));
    refresh();
    // Observe controls only. Updates to the search's own results must not recursively rebuild its index.
    const observer = new MutationObserver(refresh);
    for (const group of root.querySelectorAll(".nk-settings-group")) {
      observer.observe(group, { childList: true, characterData: true, subtree: true, attributes: true,
        attributeFilter: ["disabled", "aria-disabled", "hidden"] });
    }
    return () => observer.disconnect();
  }, [surface, language]);
  const matches = filterSettingsSearchEntries(entries, query);
  const hasQuery = Boolean(query.trim());
  const clear = () => { setQuery(""); setExpanded(true); input.current?.focus(); };
  const select = (entry: SettingsSearchEntry) => {
    // Remove the result panel before measuring the destination; collapsing it afterwards would move the form
    // above the focused control and could leave that control outside the viewport.
    flushSync(() => setExpanded(false));
    if (!navigateToSetting(entry, reveal)) { setExpanded(true); input.current?.focus(); }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape" && query) { event.preventDefault(); event.stopPropagation(); clear(); return; }
    const buttons = [...(results.current?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
    if (!buttons.length) return;
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = current < 0 ? event.key === "ArrowDown" ? 0 : buttons.length - 1
        : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === "Enter" && event.target === input.current) {
      event.preventDefault();
      if (matches[0]) select(matches[0]);
    } else if (current >= 0 && (event.key === "Home" || event.key === "End")) {
      event.preventDefault(); buttons[event.key === "Home" ? 0 : buttons.length - 1]?.focus();
    }
  };
  return (
    <section className="settings-search" aria-label={copy.label} onKeyDown={onKeyDown}>
      <TextField ref={input} type="search" label={copy.label} placeholder={copy.placeholder}
        value={query} aria-controls={hasQuery && expanded && matches.length ? `${id}-results` : undefined}
        aria-describedby={`${id}-status`} autoComplete="off" spellCheck={false}
        onFocus={() => setExpanded(true)} onChange={event => { setQuery(event.target.value); setExpanded(true); }}
        action={query ? <Button size="sm" onClick={clear}>{copy.clear}</Button> : undefined} />
      <p className="nk-field__hint" role="status" id={`${id}-status`}>
        {!hasQuery ? copy.hint : matches.length ? copy.results.replace("{count}", new Intl.NumberFormat(language).format(matches.length)) : copy.noResults}
      </p>
      {hasQuery && expanded && matches.length > 0 ? (
        <ul className="settings-search__results" id={`${id}-results`} ref={results} aria-label={copy.label}>
          {matches.map((entry, index) => <li key={`${entry.section}-${entry.title}-${index}`}>
            <Button variant="ghost" block className="settings-search__result" onClick={() => select(entry)}>
              <span className="settings-search__section">{entry.section}{entry.unavailable ? ` · ${copy.unavailable}` : ""}</span>
              <strong>{entry.title}</strong>
              <span className="settings-search__description">{entry.description}</span>
            </Button>
          </li>)}
        </ul>
      ) : null}
    </section>
  );
}
