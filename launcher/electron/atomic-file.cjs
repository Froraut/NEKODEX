const fs = require("node:fs");
const path = require("node:path");

let sequence = 0;
let durabilityWarningEmitted = false;
const waitCell = new Int32Array(new SharedArrayBuffer(4));
const WINDOWS_RENAME_RETRY_DELAYS_MS = [25, 50, 100, 150, 250, 350, 500];
const DURABILITY_WARNING_CODE = "NEKODEX_ATOMIC_DURABILITY_UNCERTAIN";

function waitSync(milliseconds) {
  Atomics.wait(waitCell, 0, 0, milliseconds);
}

function renameAtomicFile(
  source,
  destination,
  {
    platform = process.platform,
    rename = fs.renameSync,
    wait = waitSync,
  } = {},
) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      rename(source, destination);
      return;
    } catch (error) {
      const transientWindowsError = platform === "win32"
        && ["EBUSY", "EPERM", "EACCES"].includes(error?.code);
      const delay = WINDOWS_RENAME_RETRY_DELAYS_MS[attempt];
      if (!transientWindowsError || delay === undefined) throw error;
      wait(delay);
    }
  }
}

function syncFile(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function syncDirectory(directory) {
  const descriptor = fs.openSync(directory, "r");
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function warnDurabilityUncertain() {
  if (durabilityWarningEmitted) return;
  durabilityWarningEmitted = true;
  process.emitWarning(
    "A private-file update was committed, but directory durability could not be confirmed. "
      + "The saved value is active; a sudden power loss may still revert it.",
    { type: "NEKODEX durability warning", code: DURABILITY_WARNING_CODE },
  );
}

function writePrivateFileAtomic(
  filePath,
  content,
  {
    mode = 0o600,
    protectDirectory = true,
    durable = false,
    platform = process.platform,
    directorySync = syncDirectory,
    warningSink = warnDurabilityUncertain,
  } = {},
) {
  const directory = path.dirname(filePath);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (protectDirectory) {
    try { fs.chmodSync(directory, 0o700); } catch {}
  }
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}-${++sequence}`;
  try {
    fs.writeFileSync(temporary, content, { flag: "wx", mode });
    if (durable) syncFile(temporary);
    renameAtomicFile(temporary, filePath);
    try { fs.chmodSync(filePath, mode); } catch {}
    if (!durable) return Object.freeze({ committed: true, durability: "not-requested" });
    if (platform === "win32") {
      return Object.freeze({ committed: true, durability: "file-synced" });
    }
    try {
      directorySync(directory);
      return Object.freeze({ committed: true, durability: "confirmed" });
    } catch {
      const receipt = Object.freeze({
        committed: true,
        durability: "uncertain",
        warningCode: DURABILITY_WARNING_CODE,
      });
      try { warningSink(receipt); } catch {}
      return receipt;
    }
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

module.exports = {
  WINDOWS_RENAME_RETRY_DELAYS_MS,
  DURABILITY_WARNING_CODE,
  renameAtomicFile,
  writePrivateFileAtomic,
};
