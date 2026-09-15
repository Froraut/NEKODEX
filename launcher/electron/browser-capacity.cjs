const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

const DEFAULT_BROWSER_CAPACITY = 16;
// Configurable ceiling, not a verified simultaneous-session capacity.
const MAX_BROWSER_CAPACITY = 1000;
const CAPACITY_ENV = "CODEX_CHATGPT_WEB_BROWSER_CAPACITY";

function validateBrowserCapacity(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_BROWSER_CAPACITY) {
    throw new Error(`Browser capacity must be an integer from 1 to ${MAX_BROWSER_CAPACITY}`);
  }
  return value;
}

function readBrowserCapacity(coreHome) {
  try {
    const saved = JSON.parse(fs.readFileSync(path.join(coreHome, "browser-capacity.json"), "utf8"));
    return validateBrowserCapacity(saved?.maxParallelTurns);
  } catch (error) {
    if (error.code === "ENOENT") return DEFAULT_BROWSER_CAPACITY;
    throw error;
  }
}

function saveBrowserCapacity(coreHome, value) {
  const capacity = validateBrowserCapacity(value);
  fs.mkdirSync(coreHome, { recursive: true, mode: 0o700 });
  const filename = path.join(coreHome, "browser-capacity.json");
  const temporary = `${filename}.${randomUUID()}.tmp`;
  try {
    fs.writeFileSync(temporary, JSON.stringify({ maxParallelTurns: capacity }, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    fs.renameSync(temporary, filename);
  } finally { fs.rmSync(temporary, { force: true }); }
  return capacity;
}

// The launcher pins this override at startup, so a later daemon restart cannot
// apply a saved limit while Electron's tab allocator still uses the old one.
function runtimeBrowserCapacity(coreHome, env = process.env) {
  const pinned = env[CAPACITY_ENV];
  if (pinned === undefined) return readBrowserCapacity(coreHome);
  if (!/^[1-9][0-9]*$/.test(pinned)) throw new Error("Invalid pinned browser capacity");
  return validateBrowserCapacity(Number(pinned));
}

module.exports = { DEFAULT_BROWSER_CAPACITY, MAX_BROWSER_CAPACITY, CAPACITY_ENV,
  validateBrowserCapacity, readBrowserCapacity, saveBrowserCapacity, runtimeBrowserCapacity };
