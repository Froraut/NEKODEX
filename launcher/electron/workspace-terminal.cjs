"use strict";

const { randomUUID } = require("node:crypto");
const os = require("node:os");
const path = require("node:path");

const LIMITS = Object.freeze({ sessions: 4, outputBytes: 512 * 1024, pauseBytes: 256 * 1024,
  resumeBytes: 64 * 1024, readBytes: 64 * 1024, inputBytes: 16 * 1024, chunkChars: 4096,
  minCols: 20, maxCols: 300, minRows: 5, maxRows: 120 });
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function size(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value)) fail("INVALID_SIZE", "Terminal dimensions must be integers.");
  return Math.max(min, Math.min(max, value));
}
function dimensions(input = {}) {
  return { cols: size(input.cols, 80, LIMITS.minCols, LIMITS.maxCols),
    rows: size(input.rows, 24, LIMITS.minRows, LIMITS.maxRows) };
}
function terminalEnvironment() {
  // The terminal is human-owned. Do not inject the launcher's bridge tokens or
  // provider credentials into a workspace shell through its inherited environment.
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (/^(PATH|HOME|USER|LOGNAME|LANG|LC_\w+|SHELL|TMPDIR|TMP|TEMP|SystemRoot|SYSTEMROOT|WINDIR|COMSPEC|PATHEXT|APPDATA|LOCALAPPDATA|USERPROFILE)$/i.test(key)
        && typeof value === "string") env[key] = value;
  }
  return { ...env, TERM: "xterm-256color", COLORTERM: "truecolor" };
}

/** One main-process owner for real PTYs. No command/path arrives from a model,
 * prompt, task worker or renderer. The registrar resolves the native-picker grant. */
function createWorkspaceTerminalService({ loadProvider = () => require("node-pty"),
  shell = process.platform === "win32" ? (process.env.COMSPEC || "cmd.exe")
    : (os.userInfo().shell || "/bin/sh"), environment = terminalEnvironment } = {}) {
  const sessions = new Map();
  let provider;
  let disposed = false;
  function availability() {
    try {
      provider ||= loadProvider(); // node-pty eagerly loads its native binding for this ABI.
      if (typeof provider?.spawn !== "function") throw new Error("Missing native PTY spawn implementation");
      return { available: true, provider: "node-pty", runtime: process.versions.electron ? "electron" : "node",
        abi: process.versions.modules || null };
    } catch {
      return { available: false, provider: "node-pty", code: "PTY_PROVIDER_UNAVAILABLE",
        message: "The native terminal provider is unavailable for this runtime. Rebuild node-pty for this Electron version and platform, then restart NEKODEX." };
    }
  }
  const view = (session) => ({ id: session.id, generation: session.generation, workspaceId: session.workspaceId,
    cwd: session.cwd, shell: session.shell, state: session.state, cols: session.cols, rows: session.rows,
    exitCode: session.exitCode, signal: session.signal, error: session.error, paused: session.paused,
    cursor: session.next - 1 });
  function sessionFor(reference, live = false) {
    const session = sessions.get(reference?.id);
    if (!session || reference?.generation !== session.generation) fail("STALE_TERMINAL", "This terminal session is no longer current.");
    if (live && session.state !== "running") fail("TERMINAL_ENDED", "This terminal has ended. Open a new terminal to continue.");
    return session;
  }
  function append(session, text) {
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + LIMITS.chunkChars, text.length);
      if (end < text.length && /[\uD800-\uDBFF]/.test(text[end - 1])) end--;
      const data = text.slice(offset, end); const bytes = Buffer.byteLength(data);
      session.chunks.push({ cursor: session.next++, data, bytes }); session.bytes += bytes; offset = end;
    }
    while (session.bytes > LIMITS.outputBytes && session.chunks.length) session.bytes -= session.chunks.shift().bytes;
    const pendingBytes = session.chunks.reduce((sum, chunk) => sum + (chunk.cursor > session.acknowledged ? chunk.bytes : 0), 0);
    if (pendingBytes >= LIMITS.pauseBytes && !session.paused && session.state === "running") {
      try { session.pty.pause(); session.paused = true; }
      catch { session.error = "Terminal flow control failed; output retention is bounded."; }
    }
  }
  function open(grant, input = {}) {
    if (disposed) fail("TERMINAL_DISPOSED", "The terminal host has closed.");
    if (!grant || typeof grant.id !== "string" || !path.isAbsolute(grant.path)) fail("WORKSPACE_REQUIRED", "Select a workspace with the folder picker first.");
    if (sessions.size >= LIMITS.sessions) fail("TERMINAL_LIMIT", "Close an existing terminal before opening another.");
    const status = availability(); if (!status.available) fail(status.code, status.message);
    const geometry = dimensions(input);
    const session = { id: randomUUID(), generation: randomUUID(), workspaceId: grant.id, cwd: grant.path, shell,
      state: "running", ...geometry, exitCode: null, signal: null, error: null,
      chunks: [], bytes: 0, next: 1, acknowledged: 0, paused: false, pty: null, listeners: [], exitWaiters: [], exited: false };
    // No startup command, environment, shell, or arbitrary cwd can be supplied over IPC.
    try {
      session.pty = provider.spawn(shell, process.platform === "win32" ? [] : ["-i"], {
        name: "xterm-256color", cwd: grant.path, env: environment(), ...geometry,
      });
    } catch { fail("PTY_START_FAILED", "The native PTY could not start the selected user's shell."); }
    sessions.set(session.id, session);
    session.listeners.push(session.pty.onData((data) => { if (sessions.get(session.id) === session) append(session, data); }));
    session.listeners.push(session.pty.onExit(({ exitCode, signal }) => {
      if (sessions.get(session.id) !== session) return;
      session.state = session.state === "closing" ? "closed" : "exited";
      session.exitCode = Number.isInteger(exitCode) ? exitCode : null;
      session.signal = Number.isInteger(signal) ? signal : null; session.paused = false;
      session.exited = true; session.exitWaiters.splice(0).forEach((resolve) => resolve(true));
      if (session.removeOnExit) release(session);
    }));
    // node-pty is an EventEmitter as well as exposing onData/onExit.
    session.onError = () => { session.error = "The PTY reported an I/O error."; session.state = "error"; };
    session.pty.on?.("error", session.onError);
    return view(session);
  }
  function verifyGrant(session, grant) {
    if (!grant || grant.id !== session.workspaceId || grant.path !== session.cwd) fail("WORKSPACE_REVOKED", "The terminal's workspace grant is no longer current.");
  }
  function read(reference, cursor = 0) {
    const session = sessionFor(reference);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor >= session.next) fail("INVALID_CURSOR", "Invalid terminal output cursor.");
    session.acknowledged = Math.max(session.acknowledged, cursor);
    const pendingBytes = session.chunks.reduce((sum, chunk) => sum + (chunk.cursor > session.acknowledged ? chunk.bytes : 0), 0);
    if (session.paused && pendingBytes <= LIMITS.resumeBytes && session.state === "running") {
      try { session.pty.resume(); session.paused = false; }
      catch { session.error = "Terminal output could not resume."; session.state = "error"; }
    }
    const first = session.chunks[0]?.cursor ?? session.next;
    let bytes = 0; const chunks = [];
    for (const chunk of session.chunks) {
      if (chunk.cursor <= cursor) continue;
      if (bytes + chunk.bytes > LIMITS.readBytes && chunks.length) break;
      bytes += chunk.bytes; chunks.push({ cursor: chunk.cursor, data: chunk.data });
    }
    return { session: view(session), chunks, cursor: chunks.at(-1)?.cursor ?? cursor,
      dropped: first > cursor + 1, eof: ["exited", "closed", "error"].includes(session.state)
        && (!chunks.length || chunks.at(-1).cursor === session.next - 1) };
  }
  function write(reference, data, grant) {
    const session = sessionFor(reference, true); verifyGrant(session, grant);
    if (typeof data !== "string" || !data || Buffer.byteLength(data) > LIMITS.inputBytes) fail("INVALID_INPUT", "Terminal input is empty or too large.");
    try { session.pty.write(data); } catch { session.state = "error"; session.error = "Terminal input failed."; fail("PTY_WRITE_FAILED", session.error); }
    return view(session);
  }
  function resize(reference, input, grant) {
    const session = sessionFor(reference, true); verifyGrant(session, grant); const next = dimensions(input);
    session.pty.resize(next.cols, next.rows); Object.assign(session, next); return view(session);
  }
  function release(session) {
    session.listeners.forEach((listener) => listener?.dispose()); session.pty.removeListener?.("error", session.onError);
    sessions.delete(session.id);
  }
  function close(reference) {
    const session = sessionFor(reference);
    if (["closed", "exited"].includes(session.state)) { const result = view(session); release(session); return result; }
    if (session.state === "closing") return view(session);
    session.removeOnExit = true; session.state = "closing";
    try {
      // node-pty owns its PTY/ConPTY and shell. Never signal a discovered/user terminal or broad process name.
      session.pty.kill();
      // Closing this owned master also hangs up its foreground terminal job.
      // node-pty's destroy keeps the exit observer alive until the shell settles.
      session.pty.destroy?.();
    } catch { session.state = "error"; session.error = "Terminal close failed; the owned PTY is retained for retry."; session.removeOnExit = false; }
    return view(session);
  }
  function closeAll() { disposed = true; return [...sessions.values()].map((session) => close(session)); }
  function waitForExit(session, milliseconds) {
    if (session.exited) return Promise.resolve(true);
    return new Promise((resolve) => {
      const settled = (value) => { clearTimeout(timer); const index = session.exitWaiters.indexOf(settled);
        if (index >= 0) session.exitWaiters.splice(index, 1); resolve(value); };
      const timer = setTimeout(() => settled(false), milliseconds); session.exitWaiters.push(settled);
    });
  }
  async function destroy() {
    const owned = [...sessions.values()]; closeAll();
    const outcomes = await Promise.all(owned.map(async (session) => {
      if (await waitForExit(session, 1500)) return true;
      // Escalation addresses only the still-owned PTY instance, never a name,
      // PID discovered in another terminal, or an unrelated launcher process.
      try { session.pty.kill("SIGKILL"); } catch { /* Exit observation below is authoritative. */ }
      return waitForExit(session, 1500);
    }));
    if (outcomes.some((exited) => !exited)) fail("PTY_CLEANUP_INCOMPLETE", "An owned terminal did not report exit; terminal cleanup is incomplete.");
  }
  function currentOperation() {
    const active = [...sessions.values()].filter((session) => !session.exited).length;
    return active ? `${active} human terminal session${active === 1 ? "" : "s"} still running` : null;
  }
  return { availability, open, get: (reference) => view(sessionFor(reference)), list: (workspaceId) => [...sessions.values()].filter((session) => session.workspaceId === workspaceId).map(view),
    read, write, resize, close, closeAll, destroy, currentOperation };
}

module.exports = { createWorkspaceTerminalService, LIMITS };
