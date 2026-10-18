/** Search reads only explicitly marked rows in the mounted Settings surface, including closed disclosures.
 * Localized text remains owned by the controls; this index holds no settings values or persistent state. */
export type SettingsSearchEntry = {
  row: HTMLElement;
  control: HTMLElement;
  title: string;
  description: string;
  section: string;
  unavailable: boolean;
};

const text = (node: Element | null | undefined) => node?.textContent?.replace(/\s+/g, " ").trim() ?? "";
const normalize = (value: string) => value.normalize("NFKC").toLocaleLowerCase().replace(/ё/g, "е").trim();

export function collectSettingsSearchEntries(surface: HTMLElement): SettingsSearchEntry[] {
  const entries: SettingsSearchEntry[] = [];
  for (const row of surface.querySelectorAll<HTMLElement>("[data-settings-search], .nk-route-check > .nk-setting-row")) {
    if (row.closest("[hidden], [inert]")) continue;
    const section = row.closest(".nk-settings-group");
    const sectionTitle = text(section?.querySelector(":scope > header h2"));
    const disclosureTitle = text(row.closest("details")?.querySelector(":scope > summary > span:first-child"));
    const title = text(row.querySelector(":scope > div:first-child > strong, :scope > strong"));
    const description = text(row.querySelector(":scope > div:first-child > p"));
    // The mode picker has a separate destination for each option. All ordinary rows lead to the primary control,
    // with the Bigger Context switch preferred over its explanatory Details link.
    const choices = row.querySelectorAll<HTMLElement>('[role="radiogroup"] button');
    const primary = row.querySelector<HTMLElement>('input:not([type="hidden"]), select, [role="switch"]')
      ?? row.querySelector<HTMLElement>(".nk-setting-row__control button");
    for (const control of choices.length ? choices : primary ? [primary] : []) {
      const actionTitle = choices.length ? text(control.querySelector("strong")) || text(control)
        : control.tagName === "BUTTON" && !control.hasAttribute("role") ? text(control) : "";
      entries.push({ row, control, title: actionTitle && actionTitle !== title ? `${title} · ${actionTitle}` : title,
        description: choices.length ? text(control.querySelector("small")) : description,
        section: [sectionTitle, disclosureTitle].filter(Boolean).join(" · "),
        unavailable: control.hasAttribute("disabled") || control.getAttribute("aria-disabled") === "true" });
    }
  }
  return entries;
}

export function filterSettingsSearchEntries(entries: SettingsSearchEntry[], query: string): SettingsSearchEntry[] {
  const words = normalize(query).split(/\s+/).filter(Boolean);
  if (!words.length) return [];
  return entries.filter(entry => {
    const value = normalize(`${entry.title} ${entry.section} ${entry.description}`);
    return words.every(word => value.includes(word));
  });
}

/** Navigation never clicks, saves, toggles a setting, or rewrites a draft. */
export function navigateToSetting(entry: SettingsSearchEntry, reveal: (row: HTMLElement) => void): boolean {
  if (!entry.row.isConnected || !entry.control.isConnected) return false;
  reveal(entry.row);
  // Native disabled controls cannot receive focus. Keep their real disabled state and focus the labelled row
  // instead, where the user can read why the setting is unavailable.
  const unavailable = entry.control.hasAttribute("disabled") || entry.control.getAttribute("aria-disabled") === "true";
  const target = unavailable ? entry.row : entry.control;
  if (unavailable) target.tabIndex = -1;
  entry.row.scrollIntoView({ block: "center", behavior: "auto" });
  target.focus({ preventScroll: true });
  return true;
}
