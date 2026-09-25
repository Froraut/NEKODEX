/** Plain-object guards shared by request, continuation and environment readers. Arrays and null are excluded. */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** The value as a plain object, or undefined when it is not one. */
export function jsonRecord(value: unknown): Record<string, unknown> | undefined {
  return isJsonRecord(value) ? value : undefined;
}
