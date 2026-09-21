const ACTIVE_PHASES = new Set(["starting", "waiting", "importing", "verifying", "cancelling"]);
const PUBLIC_ERROR_CODES = new Set([
  "passkey-timeout",
  "passkey-handoff-timeout",
  "passkey-capture-failed",
  "passkey-validation-failed",
  "passkey-cleanup-failed",
  "passkey-verification-failed",
  "passkey-import-failed",
]);

function initialPasskeyProgress(now = Date.now()) {
  return {
    phase: "starting",
    startedAt: new Date(now).toISOString(),
    deadlineAt: new Date(now + 10 * 60_000).toISOString(),
    error: null,
    revealError: null,
  };
}

function publicPasskeyProgress(progress) {
  if (!progress) return null;
  return {
    phase: progress.phase,
    startedAt: progress.startedAt,
    deadlineAt: progress.deadlineAt,
    error: PUBLIC_ERROR_CODES.has(progress.error) ? progress.error : progress.error ? "passkey-import-failed" : null,
    revealError: progress.revealError === "passkey-reveal-failed" ? progress.revealError : null,
    active: ACTIVE_PHASES.has(progress.phase),
    canImport: progress.phase === "waiting",
    canReveal: progress.phase === "waiting",
    canCancel: ACTIVE_PHASES.has(progress.phase) && progress.phase !== "cancelling",
  };
}

function parsePasskeyProgress(line) {
  if (!line.startsWith("@codex-passkey:")) return null;
  let message;
  try { message = JSON.parse(line.slice("@codex-passkey:".length)); } catch { return null; }
  if (message?.version !== 1) return null;
  if (message.phase === "waiting" && Number.isFinite(Date.parse(message.deadlineAt))) {
    return { phase: "waiting", deadlineAt: message.deadlineAt };
  }
  if (message.event === "revealed") return { revealError: null };
  if (message.event === "reveal-failed") return { revealError: "passkey-reveal-failed" };
  return null;
}

module.exports = { initialPasskeyProgress, publicPasskeyProgress, parsePasskeyProgress };
