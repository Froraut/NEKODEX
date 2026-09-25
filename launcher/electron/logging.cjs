const fs = require("node:fs");
const path = require("node:path");
const { renameAtomicFile } = require("./atomic-file.cjs");

const MAX_LOG_BYTES = 4 * 1024 * 1024;
const MAX_STREAM_ERROR_LOG_BYTES = 256 * 1024;
const MAX_MEMORY_RECORDS = 300;
const MAX_READ_BYTES_PER_LOG = MAX_LOG_BYTES;
const MAX_LOG_STRING_CHARS = 16 * 1024;
const SENSITIVE_LOG_KEY_PATTERN = /(?:authorization|cookie|runtimeKey|controlToken)/i;
let exportSequence = 0;

function redactText(value) {
  const redacted = value
    .replace(/tunnel_[a-f0-9]{32}/g, "[tunnel-id]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, "[runtime-key]")
    .replace(/\bBearer\s+[A-Za-z0-9._~-]{20,}\b/gi, "Bearer [redacted]");
  return redacted.length > MAX_LOG_STRING_CHARS
    ? `${redacted.slice(0, MAX_LOG_STRING_CHARS)}…[truncated]`
    : redacted;
}

function redactHttpUrls(value) {
  return value.replace(/https?:\/\/[^\s"'`<>]+/gi, (candidate) => {
    const trailing = candidate.match(/[),.;:!?]+$/)?.[0] || "";
    const url = trailing ? candidate.slice(0, -trailing.length) : candidate;
    try {
      return `${new URL(url).origin}${trailing}`;
    } catch {
      return "[redacted-url]";
    }
  });
}

function redactExportText(value) {
  return redactHttpUrls(redactText(value))
    .replace(/\b[A-Za-z]:\\+Users\\+[^\\/\r\n"'`<>|]+/gi, "[user-home]")
    .replace(/\/(?:Users|home)\/[^/\r\n"'`<>]+/g, "[user-home]")
    .replace(/((?:visible rows|sidebar (?:rows|titles)|conversation titles):)\s*[^\r\n]*/gi, "$1 [redacted]");
}

function sanitizeForExport(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactExportText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitizeForExport(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_LOG_KEY_PATTERN.test(key)
        || /^(?:prompt|response|html|dom|content|visibleRows|sidebarRows|sidebarTitles|conversationTitle|conversationTitles|chatTitle|chatTitles)$/i.test(key)
        ? "[redacted]"
        : sanitizeForExport(item, seen),
    ]),
  );
}

function readLogLines(filePath) {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const size = fs.fstatSync(descriptor).size;
    const length = Math.min(size, MAX_READ_BYTES_PER_LOG);
    const start = size - length;
    const bytes = Buffer.alloc(length);
    let read = 0;
    while (read < length) {
      const count = fs.readSync(descriptor, bytes, read, length - read, start + read);
      if (count === 0) break;
      read += count;
    }
    const lines = bytes.subarray(0, read).toString("utf8").split(/\r?\n/);
    // A bounded tail can start inside a JSON record or a UTF-8 sequence.
    if (start > 0) lines.shift();
    return lines.filter(Boolean);
  } finally {
    fs.closeSync(descriptor);
  }
}

function isSourceLogAlias(sourcePaths, destination) {
  const destinationStat = fs.statSync(destination, { throwIfNoEntry: false });
  for (const sourcePath of sourcePaths) {
    if (path.resolve(sourcePath) === destination) return true;
    if (!destinationStat) continue;
    const sourceStat = fs.statSync(sourcePath, { throwIfNoEntry: false });
    if (sourceStat && sourceStat.dev === destinationStat.dev && sourceStat.ino === destinationStat.ino) return true;
  }
  return false;
}

function writeExportAtomically(destination, content) {
  fs.mkdirSync(path.dirname(destination), { recursive: true, mode: 0o700 });
  const temporary = `${destination}.tmp-${process.pid}-${Date.now()}-${++exportSequence}`;
  try {
    fs.writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
    renameAtomicFile(temporary, destination);
  } finally {
    fs.rmSync(temporary, { force: true });
  }
}

// Any parse, validation or sanitizer failure drops the line (null).
function parseLogRecord(line, sanitizeDetail) {
  try {
    const record = JSON.parse(line);
    if (!record
      || typeof record.at !== "string"
      || !["debug", "info", "warning", "error"].includes(record.level)
      || typeof record.event !== "string") return null;
    return {
      at: record.at,
      level: record.level,
      event: record.event,
      detail: record.detail && typeof record.detail === "object"
        ? sanitizeDetail(record.detail)
        : {},
    };
  } catch {
    return null;
  }
}

function exportSanitizedLogs({ filePath, destinationPath }) {
  const sourcePaths = [`${filePath}.1`, filePath];
  const destination = path.resolve(destinationPath);
  if (isSourceLogAlias(sourcePaths, destination)) {
    throw new Error("Refusing to overwrite a launcher source log with an exported diagnostic");
  }
  const records = [];
  for (const sourcePath of sourcePaths) {
    let lines;
    try {
      lines = readLogLines(sourcePath);
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      throw error;
    }
    for (const line of lines) {
      const record = parseLogRecord(line, sanitizeForExport);
      if (record) records.push(record);
    }
  }
  // Replace the selected directory entry atomically. A link swapped in after
  // the identity check cannot redirect an in-place write into a source log.
  writeExportAtomically(
    destination,
    records.length > 0 ? `${records.map(record => JSON.stringify(record)).join("\n")}\n` : "",
  );
  return records.length;
}

function sanitize(value, seen = new WeakSet()) {
  if (typeof value === "string") return redactText(value);
  if (value === null || typeof value !== "object") return value;
  if (seen.has(value)) return "[circular]";
  seen.add(value);
  if (Array.isArray(value)) return value.map((item) => sanitize(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      SENSITIVE_LOG_KEY_PATTERN.test(key)
        ? "[redacted]"
        : sanitize(item, seen),
    ]),
  );
}

function readRecent(filePath) {
  const records = [];
  // Count valid events, not lines: a partial final write must not evict history.
  for (const sourcePath of [filePath, `${filePath}.1`]) {
    let lines;
    try {
      lines = readLogLines(sourcePath);
    } catch {
      continue;
    }
    for (let index = lines.length - 1; index >= 0; index -= 1) {
      const record = parseLogRecord(lines[index], sanitize);
      if (!record) continue;
      records.push(record);
      if (records.length === MAX_MEMORY_RECORDS) return records.reverse();
    }
  }
  return records.reverse();
}

function createLogger({ filePath, publish }) {
  const records = readRecent(filePath);

  const append = (level, event, detail = {}) => {
    const record = {
      at: new Date().toISOString(),
      level,
      event,
      detail: detail && typeof detail === "object" && !Array.isArray(detail) ? sanitize(detail) : {},
    };
    records.push(record);
    if (records.length > MAX_MEMORY_RECORDS) records.splice(0, records.length - MAX_MEMORY_RECORDS);
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
      const stat = fs.statSync(filePath, { throwIfNoEntry: false });
      if (stat && stat.size >= MAX_LOG_BYTES) {
        fs.rmSync(`${filePath}.1`, { force: true });
        renameAtomicFile(filePath, `${filePath}.1`);
      }
      fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
    } catch {}
    publish?.(record);
    return record;
  };

  return {
    debug: (event, detail) => append("debug", event, detail),
    info: (event, detail) => append("info", event, detail),
    warn: (event, detail) => append("warning", event, detail),
    error: (event, detail) => append("error", event, detail),
    recent: (limit = 150) => records.slice(-Math.max(1, Math.min(300, limit))),
    filePath,
  };
}

function installProcessDiagnosticGuards({ filePath, streams = [process.stdout, process.stderr] }) {
  const guarded = new Set();
  for (const stream of streams) {
    if (!stream || typeof stream.on !== "function" || guarded.has(stream)) continue;
    guarded.add(stream);
    stream.on("error", (error) => {
      try {
        fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
        const detail = error instanceof Error ? error.stack || error.message : String(error);
        const entry = `${new Date().toISOString()} ${redactText(detail)}\n`;
        const stat = fs.statSync(filePath, { throwIfNoEntry: false });
        if (stat && stat.size + Buffer.byteLength(entry) > MAX_STREAM_ERROR_LOG_BYTES) {
          const previousPath = `${filePath}.1`;
          if (stat.size > MAX_STREAM_ERROR_LOG_BYTES) {
            // An older unbounded log may already be large. Keep only its latest bytes.
            const tailBytes = Math.min(stat.size, MAX_STREAM_ERROR_LOG_BYTES);
            const tail = Buffer.alloc(tailBytes);
            const fd = fs.openSync(filePath, "r");
            try {
              fs.readSync(fd, tail, 0, tailBytes, stat.size - tailBytes);
            } finally {
              fs.closeSync(fd);
            }
            fs.writeFileSync(previousPath, tail, { mode: 0o600 });
            fs.rmSync(filePath);
          } else {
            fs.rmSync(previousPath, { force: true });
            renameAtomicFile(filePath, previousPath);
          }
        }
        fs.appendFileSync(
          filePath,
          entry,
          { mode: 0o600 },
        );
      } catch {
        // A lost diagnostic sink must not become a second process error.
      }
    });
  }
}

function createRendererIpcGuard({ getMainWindow, isRendererUrlAllowed }) {
  if (typeof getMainWindow !== "function" || typeof isRendererUrlAllowed !== "function") {
    throw new TypeError("Launcher IPC authorization requires window and URL validators");
  }
  return (event) => {
    let allowed = false;
    try {
      const window = getMainWindow();
      if (window && !window.isDestroyed()) {
        const contents = window.webContents;
        if (contents && !contents.isDestroyed() && event?.sender === contents) {
          const frame = event.senderFrame;
          const mainFrame = contents.mainFrame;
          // Electron can expose distinct wrappers for one frame. Match its current
          // process/routing pair and reject unloading or detached documents.
          allowed = Boolean(frame && mainFrame
            && !frame.isDestroyed() && !mainFrame.isDestroyed()
            && frame.detached === false && mainFrame.detached === false
            && frame.parent === null && mainFrame.parent === null
            && Number.isInteger(frame.processId) && Number.isInteger(frame.routingId)
            && frame.processId === mainFrame.processId
            && frame.routingId === mainFrame.routingId
            && isRendererUrlAllowed(frame.url) === true
            && isRendererUrlAllowed(mainFrame.url) === true);
        }
      }
    } catch {
      // Native frame getters can throw after navigation or renderer teardown.
    }
    if (!allowed) throw new Error("Unauthorized launcher IPC sender");
    return true;
  };
}

function registerLoggedIpc(ipcMain, logger, channel, handler, authorize) {
  if (typeof authorize !== "function") throw new TypeError("Launcher IPC authorization is required");
  ipcMain.handle(channel, async (event, ...args) => {
    try {
      if (authorize(event) !== true) throw new Error("Unauthorized launcher IPC sender");
      return await handler(event, ...args);
    } catch (error) {
      logger.error("launcher.ipc_failed", {
        channel,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  });
}

function registerLoggedIpcEvent(ipcMain, logger, channel, handler, authorize) {
  if (typeof authorize !== "function") throw new TypeError("Launcher IPC authorization is required");
  ipcMain.on(channel, async (event, ...args) => {
    try {
      if (authorize(event) !== true) throw new Error("Unauthorized launcher IPC sender");
      await handler(event, ...args);
    } catch (error) {
      logger.error("launcher.ipc_failed", {
        channel,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

module.exports = {
  createLogger,
  createRendererIpcGuard,
  exportSanitizedLogs,
  installProcessDiagnosticGuards,
  readRecent,
  redactExportText,
  redactText,
  registerLoggedIpc,
  registerLoggedIpcEvent,
  sanitize,
  sanitizeForExport,
};
