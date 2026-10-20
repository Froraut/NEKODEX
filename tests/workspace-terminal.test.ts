import { expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import type { WorkspaceTerminalService } from "../launcher/electron/workspace-terminal.cjs";
const require = createRequire(import.meta.url);
const { createWorkspaceTerminalService, LIMITS } = require("../launcher/electron/workspace-terminal.cjs");
const { registerWorkspaceTerminalIpc } = require("../launcher/electron/ipc/workspace-terminal.cjs");
const grant = { id: "12345678-1234-1234-1234-123456789012", path: "/tmp" };

function fixture() {
  const children: (EventEmitter & Record<string, any>)[] = [];
  const spawn = (shell: string, args: string[], options: unknown) => {
    const child = Object.assign(new EventEmitter(), { shell, args, options, writes: [] as string[], paused: false, killed: false,
      onData(callback: (data: string) => void) { this.on("data", callback); return { dispose: () => this.off("data", callback) }; },
      onExit(callback: (data: unknown) => void) { this.on("exit", callback); return { dispose: () => this.off("exit", callback) }; },
      write(data: string) { this.writes.push(data); }, pause() { this.paused = true; }, resume() { this.paused = false; },
      resize(cols: number, rows: number) { this.geometry = { cols, rows }; },
      kill() { this.killed = true; this.emit("exit", { exitCode: 0, signal: 1 }); },
    });
    children.push(child); return child;
  };
  return { children, service: createWorkspaceTerminalService({ loadProvider: () => ({ spawn }), shell: "/bin/sh" }) as WorkspaceTerminalService };
}

test("owned terminals require the same generation and live workspace grant; close cannot touch a replacement", () => {
  const { service, children } = fixture();
  const first = service.open(grant, { cols: 999, rows: -2 });
  expect(first).toMatchObject({ cols: 300, rows: 5, state: "running" });
  expect(children[0].options.cwd).toBe(grant.path);
  expect(() => service.write(first, "echo hello\r", { ...grant, path: "/elsewhere" })).toThrow("grant");
  service.write(first, "echo hello\r", grant);
  expect(children[0].writes).toEqual(["echo hello\r"]);
  service.close(first); expect(children[0].killed).toBe(true);
  const second = service.open(grant);
  expect(() => service.write(first, "stale\r", grant)).toThrow("no longer current");
  expect(() => service.write({ id: second.id, generation: first.generation }, "stale\r", grant)).toThrow("no longer current");
  expect(children[1].writes).toEqual([]);
  service.closeAll(); expect(children[1].killed).toBe(true);
  expect(() => service.open(grant)).toThrow("closed");
});

test("unread output pauses the actual provider and resumes after cursor acknowledgements; retention and reads stay bounded", () => {
  const { service, children } = fixture(); const session = service.open(grant);
  children[0].emit("data", "a".repeat(LIMITS.outputBytes * 3));
  expect(children[0].paused).toBe(true);
  let read = service.read(session, 0);
  expect(read.dropped).toBe(true);
  expect(Buffer.byteLength(read.chunks.map((chunk) => chunk.data).join(""))).toBeLessThanOrEqual(LIMITS.readBytes);
  let bytes = 0;
  for (let i = 0; i < 12; i++) {
    bytes += Buffer.byteLength(read.chunks.map((chunk) => chunk.data).join(""));
    read = service.read(session, read.cursor);
    if (read.chunks.length === 0) break;
  }
  expect(bytes).toBeLessThanOrEqual(LIMITS.outputBytes);
  expect(children[0].paused).toBe(false);
  children[0].emit("exit", { exitCode: 7, signal: 0 });
  expect(service.read(session, read.cursor)).toMatchObject({ eof: true, session: { state: "exited", exitCode: 7 } });
  expect(() => service.write(session, "no\r", grant)).toThrow("ended");
  service.closeAll();
});

test("missing native binding is explicit and session creation stays capped", () => {
  const unavailable = createWorkspaceTerminalService({ loadProvider: () => { throw new Error("ABI mismatch"); } });
  expect(unavailable.availability()).toMatchObject({ available: false, code: "PTY_PROVIDER_UNAVAILABLE" });
  expect(() => unavailable.open(grant)).toThrow("Rebuild node-pty");
  const { service } = fixture();
  for (let i = 0; i < LIMITS.sessions; i++) service.open(grant);
  expect(() => service.open(grant)).toThrow("Close an existing");
  service.closeAll();
});

test("app teardown waits for the owned PTY exit receipt and clears active work", async () => {
  const { service, children } = fixture(); service.open(grant);
  expect(service.currentOperation()).toContain("human terminal");
  children[0].kill = function () { setTimeout(() => this.emit("exit", { exitCode: 0, signal: 1 }), 20); };
  let settled = false; const closing = service.destroy().then(() => { settled = true; });
  expect(settled).toBe(false); expect(service.currentOperation()).toContain("human terminal");
  await closing; expect(service.currentOperation()).toBeNull();
});

test("IPC accepts only picker-granted IDs and rejects startup commands/paths before spawning", () => {
  const { service, children } = fixture(); const handlers = new Map<string, (...args: any[]) => any>();
  let revoked = false;
  registerWorkspaceTerminalIpc({ service,
    registerIpcHandler: (channel: string, action: (...args: any[]) => any) => handlers.set(channel, action),
    resolveGrant: (id: string) => { if (id !== grant.id || revoked) throw new Error("Grant revoked"); return grant; } });
  const call = (name: string, ...args: any[]) => handlers.get(`launcher:terminal-${name}`)!({}, ...args);
  expect(() => call("open", "/tmp")).toThrow("identifier");
  expect(() => call("open", grant.id, { command: "echo injected" })).toThrow("request");
  expect(children).toHaveLength(0);
  const session = call("open", grant.id);
  expect(() => call("write", { ...session, command: "injected" }, "hello\r")).toThrow("request");
  revoked = true;
  expect(() => call("write", { id: session.id, generation: session.generation }, "hello\r")).toThrow("revoked");
  call("close", { id: session.id, generation: session.generation });
  expect(children[0].killed).toBe(true);
});
