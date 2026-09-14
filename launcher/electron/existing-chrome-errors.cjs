// Only these fixed codes can cross the private helper boundary. Never accept its error text.
const MESSAGES = Object.freeze({
  "consent-required": "Confirm existing Chrome profile access before importing its sign-in",
  "unsupported-platform": "Existing Chrome sign-in is unavailable on this platform",
  "chrome-unavailable": "Chrome remote debugging is not available; open its settings and enable it",
  "chrome-profile-access-denied": "macOS or the operating system denied access to Chrome connection information",
  "chrome-file-selection-invalid": "Choose only the Chrome DevToolsActivePort connection file shown in the file picker",
  "invalid-endpoint": "Chrome connection information is invalid; reopen its remote debugging settings",
  "chrome-permission-denied": "Chrome did not approve the connection",
  "chrome-permission-timeout": "Chrome permission timed out",
  "chrome-too-old": "Existing Chrome import requires Google Chrome 144 or later",
  "chrome-disconnected": "Chrome disconnected before the sign-in could be imported",
  "invalid-response": "Chrome returned an unsupported session response",
  "session-missing": "The current Chrome profile has no usable ChatGPT sign-in",
  "session-verification-failed": "Chrome connected, but ChatGPT did not accept the imported session. Open sign in in this app to complete verification, or select the intended signed-in Chrome profile and retry.",
  "cancelled": "Existing Chrome sign-in cancelled",
  "capture-write-failed": "The private Chrome sign-in capture could not be saved",
  "launcher-authorization-failed": "The launcher could not authorize its private import helper; restart the launcher and retry",
  "import-failed": "Existing Chrome sign-in could not be imported",
});
const PREFIX = "@codex-chrome-import-error:";
function isExistingChromeErrorCode(code) {
  return typeof code === "string" && Object.hasOwn(MESSAGES, code);
}
function parseExistingChromeError(line) {
  if (typeof line !== "string" || line.length > 256 || !line.startsWith(PREFIX)) return null;
  let value;
  try { value = JSON.parse(line.slice(PREFIX.length)); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value) || value.version !== 1
    || Object.keys(value).length !== 2 || !isExistingChromeErrorCode(value.code)) return null;
  return value.code;
}
function existingChromeError(code) {
  const safeCode = isExistingChromeErrorCode(code) ? code : "import-failed";
  const error = new Error(MESSAGES[safeCode]);
  error.code = safeCode;
  return error;
}
module.exports = { isExistingChromeErrorCode, parseExistingChromeError, existingChromeError };
