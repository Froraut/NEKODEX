import { eventTitle } from "./event-copy";
import type { Language } from "./types";

/**
 * The readable title of a dotted log event id such as "browser.turn_ended" ("Turn ended"), in the UI language
 * (event-copy.ts). Pass the surface's language; English is the fallback.
 */
export function humanEvent(value: string, language: Language = "en"): string {
  return eventTitle(value, language);
}
