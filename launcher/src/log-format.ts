/** Turns a dotted log event id such as "browser.turn_ended" into readable text. */
export function humanEvent(value: string): string {
  return value.split(".").map((part) => part.replaceAll("_", " ")).join(" · ");
}
