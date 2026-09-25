/** Removes Electron's "Error invoking remote method" wrapper so users see only the launcher's message. */
export function stripIpcErrorPrefix(message: string): string {
  return message.replace(/^Error invoking remote method 'launcher:[^']+':\s*(?:Error:\s*)?/, "");
}
