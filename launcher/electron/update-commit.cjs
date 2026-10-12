const fs = require("node:fs");
const path = require("node:path");

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function fileIdentity(filename) {
  try {
    const stat = fs.statSync(filename);
    return { dev: stat.dev, ino: stat.ino };
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") return null;
    throw error;
  }
}

// The replacement launcher proves readiness before the update worker commits.
// Runtime changes must wait for that commit: a worker rollback restores the
// previous application, which must still find its own runtime generation.
//
// The worker that runs this transaction is copied from the application being
// replaced, so only journal facts every worker writes are trusted here:
// - phase "committed" is the durable commit record;
// - a rollback phase means the previous application is being restored;
// - after a commit the worker removes the transaction directory. A rollback
//   replaces this launcher's executable, so a vanished journal proves the
//   commit only while the executable is still the same file.
async function waitForUpdateCommit(handoff, {
  executablePath = process.execPath,
  timeoutMs = 150_000,
  intervalMs = 250,
  isCancelled = () => false,
} = {}) {
  if (!handoff?.filename || !path.isAbsolute(handoff.filename)) throw new Error("Update readiness handoff is required");
  const journalPath = path.join(path.dirname(handoff.filename), "transaction.json");
  const executable = fileIdentity(executablePath);
  if (!executable) throw new Error("Cannot identify the replacement launcher executable");
  const deadline = Date.now() + timeoutMs;
  let lastPhase = null;
  for (;;) {
    if (isCancelled()) return { status: "cancelled", phase: lastPhase };
    let journal;
    try {
      journal = JSON.parse(fs.readFileSync(journalPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT" && error?.code !== "ENOTDIR" && !(error instanceof SyntaxError)) throw error;
      if (error instanceof SyntaxError) journal = undefined;
      else {
        const current = fileIdentity(executablePath);
        const sameExecutable = current !== null && current.dev === executable.dev && current.ino === executable.ino;
        return sameExecutable
          ? { status: "committed", phase: lastPhase, evidence: "journal-removed" }
          : { status: "rolled-back", phase: lastPhase, evidence: "executable-replaced" };
      }
    }
    if (journal) {
      lastPhase = typeof journal.phase === "string" ? journal.phase : null;
      if (lastPhase === "committed") return { status: "committed", phase: lastPhase, evidence: "journal" };
      if (lastPhase && /^roll/.test(lastPhase)) return { status: "rolled-back", phase: lastPhase, evidence: "journal" };
    }
    if (Date.now() >= deadline) return { status: "unknown", phase: lastPhase };
    await sleep(intervalMs);
  }
}

module.exports = { waitForUpdateCommit };
