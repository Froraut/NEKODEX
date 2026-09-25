/** A non-empty string no longer than maxLength, as required of stored response and owner identities. */
export function boundedIdentity(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}
