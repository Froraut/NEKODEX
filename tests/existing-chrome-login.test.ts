import { expect, test } from "bun:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureExistingChromeLogin, captureExistingChromeLoginToFile, existingChromePortFile,
  parseExistingChromeEndpoint, sanitizeExistingChromeCookies,
} from "../src/existing-chrome-login";

const { wsServer: WebSocketServer } = createRequire(import.meta.url)("playwright-core/lib/utilsBundle");
const browserPath = "/devtools/browser/12345678-1234-1234-1234-123456789abc";
const cookie = (domain = ".chatgpt.com", extra = {}) => ({ name: "session", value: "PRIVATE-SESSION-VALUE", domain,
  path: "/", expires: -1, session: true, httpOnly: true, secure: true, sameSite: "Lax", ...extra });
type Rpc = { id: number; method: string; params: Record<string, unknown>; sessionId?: string };
type Scenario = { version?: string; cookies?: unknown; deny?: boolean; redirect?: string; holdApproval?: boolean;
  onRequest?: (call: Rpc, reply: (result: unknown) => void, socket: any) => boolean | void };

async function fixture(scenario: Scenario = {}) {
  const root = mkdtempSync(join(tmpdir(), "codex-existing-chrome-test-"));
  const calls: Rpc[] = [];
  const upgrades: { url?: string; origin?: string; host?: string }[] = [];
  const connections = new Set<any>();
  const pendingUpgrades = new Set<any>();
  const http = createServer((_req, res) => { res.writeHead(404); res.end(); });
  const server = new WebSocketServer({ noServer: true });
  http.on("upgrade", (req, socket, head) => {
    upgrades.push({ url: req.url, origin: req.headers.origin, host: req.headers.host });
    pendingUpgrades.add(socket);
    socket.on("close", () => pendingUpgrades.delete(socket));
    if (scenario.holdApproval) return;
    if (scenario.deny || scenario.redirect) {
      socket.end(scenario.redirect
        ? `HTTP/1.1 302 Found\r\nLocation: ${scenario.redirect}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n`
        : "HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
      return;
    }
    server.handleUpgrade(req, socket, head, (ws: any) => server.emit("connection", ws));
  });
  server.on("connection", (socket: any) => {
    connections.add(socket);
    socket.on("close", () => connections.delete(socket));
    socket.on("message", (raw: Buffer) => {
      const call = JSON.parse(raw.toString()) as Rpc;
      calls.push(call);
      const reply = (result: unknown) => socket.send(JSON.stringify({ id: call.id, result }));
      if (scenario.onRequest?.(call, reply, socket)) return;
      switch (call.method) {
        case "Browser.getVersion": reply({ product: scenario.version ?? "Chrome/144.0.7559.0" }); break;
        case "Target.createTarget": reply({ targetId: "OWN-TARGET" }); break;
        case "Target.attachToTarget": reply({ sessionId: "OWN-SESSION" }); break;
        case "Network.getCookies": reply({ cookies: scenario.cookies ?? [cookie()] }); break;
        case "Target.closeTarget": reply({ success: true }); break;
        default: socket.send(JSON.stringify({ id: call.id, error: { message: "UNEXPECTED-SECRET-ERROR" } }));
      }
    });
  });
  await new Promise<void>(resolve => http.listen(0, "127.0.0.1", resolve));
  const address = http.address();
  if (!address || typeof address === "string") throw new Error("Missing fixture port");
  const portFile = join(root, "DevToolsActivePort");
  writeFileSync(portFile, `${address.port}\n${browserPath}\n`);
  return { root, portFile, calls, upgrades, connections,
    dependencies: { portFile: () => portFile },
    async close() {
      for (const socket of connections) socket.terminate();
      for (const socket of pendingUpgrades) socket.destroy();
      await new Promise<void>(resolve => http.close(() => resolve()));
      server.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("existing Chrome endpoint uses exact decimal port and UUID path on IPv4 loopback", () => {
  expect(parseExistingChromeEndpoint(`9222\n${browserPath}\n`)).toBe(`ws://127.0.0.1:9222${browserPath}`);
  expect(parseExistingChromeEndpoint(`65535\r\n${browserPath}\r\n`)).toContain("127.0.0.1:65535");
  for (const value of ["", `1\n${browserPath}`, `65536\n${browserPath}`, `9222junk\n${browserPath}`,
    `09222\n${browserPath}`, `9222\nws://attacker.example/`, `9222\n${browserPath}?secret=value`,
    `9222\n${browserPath}\nextra`, `9222\n/devtools/browser/../../private`, "x".repeat(2049)]) {
    expect(() => parseExistingChromeEndpoint(value)).toThrow("connection information");
  }
});

test("discovery supports stable Chrome OS defaults without profile traversal", () => {
  const home = join(tmpdir(), "fixture-home");
  const base = join(tmpdir(), "fixture-config");
  expect(existingChromePortFile({ platform: "darwin", home })).toBe(join(home, "Library", "Application Support", "Google", "Chrome", "DevToolsActivePort"));
  expect(existingChromePortFile({ platform: "linux", home, xdgConfigHome: base })).toBe(join(base, "google-chrome", "DevToolsActivePort"));
  expect(existingChromePortFile({ platform: "win32", home, localAppData: base })).toBe(join(base, "Google", "Chrome", "User Data", "DevToolsActivePort"));
  expect(() => existingChromePortFile({ platform: "linux", home, xdgConfigHome: "relative" })).toThrow("connection information");
  expect(() => existingChromePortFile({ platform: "unsupported", home })).toThrow("operating system");
});

test("explicit local consent is required before discovery or a native Chrome prompt", async () => {
  let discovery = false;
  await expect(captureExistingChromeLogin({ consent: false }, { portFile: () => { discovery = true; return "unused"; } })).rejects.toThrow("Confirm access");
  expect(discovery).toBe(false);
});

test("only owned blank target and explicit ChatGPT cookie URLs are accessed", async () => {
  const f = await fixture({ cookies: [cookie(), cookie("auth.openai.com", { name: "auth" }), cookie("accounts.google.com", { value: "OTHER-ACCOUNT-SECRET" })] });
  try {
    const progress: unknown[] = [];
    const result = await captureExistingChromeLogin({ consent: true, onProgress: p => progress.push(p) }, f.dependencies);
    expect(f.calls.map(call => call.method)).toEqual(["Browser.getVersion", "Target.createTarget", "Target.attachToTarget", "Network.getCookies", "Target.closeTarget"]);
    expect(f.calls[1]!.params).toEqual({ url: "about:blank", background: true, hidden: true });
    expect(f.calls[2]!.params).toEqual({ targetId: "OWN-TARGET", flatten: true });
    expect(f.calls[3]).toMatchObject({ sessionId: "OWN-SESSION", params: { urls: ["https://chatgpt.com/", "https://auth.openai.com/"] } });
    expect(f.calls[4]!.params).toEqual({ targetId: "OWN-TARGET" });
    expect(f.upgrades).toHaveLength(1);
    expect(f.upgrades[0]!.url).toBe(browserPath);
    expect(f.upgrades[0]!.origin).toBeUndefined();
    expect(result.storageState.origins).toEqual([]);
    expect(result.storageState.cookies.map(c => c.domain)).toEqual([".chatgpt.com", "auth.openai.com"]);
    expect(JSON.stringify(result)).not.toContain("OTHER-ACCOUNT-SECRET");
    expect(result.marker.source).toBe("existing-chrome-profile");
    expect(JSON.stringify(progress)).not.toContain("PRIVATE-SESSION-VALUE");
    expect(JSON.stringify(progress)).not.toContain(browserPath);
  } finally { await f.close(); }
});

test("Chrome native denial is recoverable and makes no CDP requests", async () => {
  const f = await fixture({ deny: true });
  try {
    await expect(captureExistingChromeLogin({ consent: true }, f.dependencies)).rejects.toMatchObject({ code: "chrome-permission-denied" });
    expect(f.calls).toEqual([]);
  } finally { await f.close(); }
});

test("a pending native approval is bounded and cancellation does not send browser commands", async () => {
  for (const cancel of [false, true]) {
    const f = await fixture({ holdApproval: true });
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (cancel) timer = setTimeout(() => controller.abort(), 20);
      await expect(captureExistingChromeLogin({ consent: true, timeoutMs: 80, signal: controller.signal }, f.dependencies))
        .rejects.toMatchObject({ code: cancel ? "cancelled" : "chrome-permission-timeout" });
      expect(f.calls).toEqual([]);
    } finally { if (timer) clearTimeout(timer); await f.close(); }
  }
});

test("the approval connection never follows redirects, even to another loopback server", async () => {
  const other = await fixture();
  const port = /^(\d+)/.exec(readFileSync(other.portFile, "utf8"))![1];
  const f = await fixture({ redirect: `ws://127.0.0.1:${port}${browserPath}` });
  try {
    await expect(captureExistingChromeLogin({ consent: true }, f.dependencies)).rejects.toMatchObject({ code: "invalid-endpoint" });
    expect(other.upgrades).toEqual([]);
    expect(other.calls).toEqual([]);
  } finally { await f.close(); await other.close(); }
});

test("older Chrome is rejected before creating a target or reading cookies", async () => {
  for (const version of ["Chrome/143.0.0.0", "HeadlessChrome/145.0.0.0", "Firefox/145.0"]) {
    const f = await fixture({ version });
    try {
      await expect(captureExistingChromeLogin({ consent: true }, f.dependencies)).rejects.toMatchObject({ code: "chrome-too-old" });
      expect(f.calls.map(call => call.method)).toEqual(["Browser.getVersion"]);
    } finally { await f.close(); }
  }
});

test("empty or invalid session closes the owned target and exposes no peer error text", async () => {
  for (const cookies of [[], [cookie("chatgpt.com.evil.example")], [cookie(".chatgpt.com", { expires: "PRIVATE-BAD-VALUE" })]]) {
    const f = await fixture({ cookies });
    try {
      const error = await captureExistingChromeLogin({ consent: true }, f.dependencies).catch(error => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message).not.toContain("PRIVATE");
      expect(f.calls.at(-1)).toMatchObject({ method: "Target.closeTarget", params: { targetId: "OWN-TARGET" } });
    } finally { await f.close(); }
  }
});

test("cookie sanitizer discards cross-origin, partitioned and unknown fields without reading local storage", () => {
  const result = sanitizeExistingChromeCookies([
    cookie(), cookie(".openai.com", { name: "shared", unknown: "DISCARD-ME" }),
    cookie(".chatgpt.com", { partitionKey: "https://other.example" }),
    cookie(".chatgpt.com", { partitionKeyOpaque: true }), cookie("evilchatgpt.com"),
    cookie(".chatgpt.com.")
  ]);
  expect(result.cookies).toHaveLength(2);
  expect(result.origins).toEqual([]);
  expect(JSON.stringify(result)).not.toContain("DISCARD-ME");
  expect(() => sanitizeExistingChromeCookies([cookie(".chatgpt.com", { value: "x".repeat(16385) })])).toThrow("oversized");
  expect(() => sanitizeExistingChromeCookies(Array(1001).fill(cookie()))).toThrow("oversized");
});

test("cancellation during cookie capture closes only the created target and disconnects promptly", async () => {
  const controller = new AbortController();
  const f = await fixture({ onRequest(call) {
    if (call.method === "Network.getCookies") { controller.abort(new Error("PRIVATE-CANCEL-REASON")); return true; }
  } });
  try {
    const start = Date.now();
    await expect(captureExistingChromeLogin({ consent: true, signal: controller.signal }, f.dependencies)).rejects.toMatchObject({ code: "cancelled" });
    expect(Date.now() - start).toBeLessThan(1500);
    expect(f.calls.at(-1)).toMatchObject({ method: "Target.closeTarget", params: { targetId: "OWN-TARGET" } });
    expect(f.calls.some(call => call.method === "Browser.close")).toBe(false);
  } finally { await f.close(); }
});

test("cancellation drains a late createTarget response and closes exactly that target", async () => {
  const controller = new AbortController();
  const f = await fixture({ onRequest(call, reply) {
    if (call.method === "Target.createTarget") {
      controller.abort();
      setTimeout(() => reply({ targetId: "LATE-OWN-TARGET" }), 30);
      return true;
    }
  } });
  try {
    await expect(captureExistingChromeLogin({ consent: true, signal: controller.signal }, f.dependencies)).rejects.toMatchObject({ code: "cancelled" });
    expect(f.calls.map(call => call.method)).toEqual(["Browser.getVersion", "Target.createTarget", "Target.closeTarget"]);
    expect(f.calls.at(-1)!.params).toEqual({ targetId: "LATE-OWN-TARGET" });
  } finally { await f.close(); }
});

test("a timed-out createTarget still drains its late result before disconnecting", async () => {
  const f = await fixture({ onRequest(call, reply) {
    if (call.method === "Target.createTarget") {
      setTimeout(() => reply({ targetId: "TIMED-OUT-OWN-TARGET" }), 90);
      return true;
    }
  } });
  try {
    await expect(captureExistingChromeLogin({ consent: true, timeoutMs: 60 }, f.dependencies)).rejects.toBeInstanceOf(Error);
    expect(f.calls.map(call => call.method)).toEqual(["Browser.getVersion", "Target.createTarget", "Target.closeTarget"]);
    expect(f.calls.at(-1)!.params).toEqual({ targetId: "TIMED-OUT-OWN-TARGET" });
    expect(f.calls[1]!.params.hidden).toBe(true);
  } finally { await f.close(); }
});

test("oversized and malformed CDP frames fail closed with bounded response errors", async () => {
  for (const payload of ["not-json-PRIVATE", JSON.stringify({ id: 1, result: { private: "x".repeat(600_000) } })]) {
    const f = await fixture({ onRequest(_call, _reply, socket) { socket.send(payload); return true; } });
    try {
      const error = await captureExistingChromeLogin({ consent: true, timeoutMs: 1000 }, f.dependencies).catch(error => error);
      expect(error).toBeInstanceOf(Error);
      expect(error.message.length).toBeLessThan(250);
      expect(error.message).not.toContain("PRIVATE");
    } finally { await f.close(); }
  }
});

test("unsolicited CDP event streams have both count and cumulative byte limits", async () => {
  for (const [count, bytes] of [[65, 1], [5, 450_000]]) {
    const f = await fixture({ onRequest(_call, _reply, socket) {
      for (let i = 0; i < count!; i++) socket.send(JSON.stringify({ method: "Unused.event", params: { ignored: "x".repeat(bytes!) } }));
      return true;
    } });
    try {
      await expect(captureExistingChromeLogin({ consent: true, timeoutMs: 1000 }, f.dependencies))
        .rejects.toMatchObject({ code: "invalid-response" });
      expect(f.calls.map(call => call.method)).toEqual(["Browser.getVersion"]);
    } finally { await f.close(); }
  }
});

test("discovery reads only a bounded regular file, and missing or stale endpoints are recoverable", async () => {
  const root = mkdtempSync(join(tmpdir(), "codex-chrome-marker-test-"));
  const marker = join(root, "marker");
  try {
    await expect(captureExistingChromeLogin({ consent: true }, { portFile: () => marker })).rejects.toMatchObject({ code: "chrome-unavailable" });
    writeFileSync(marker, "x".repeat(2049));
    await expect(captureExistingChromeLogin({ consent: true }, { portFile: () => marker })).rejects.toMatchObject({ code: "invalid-endpoint" });
    if (process.platform !== "win32") {
      const link = join(root, "link"); symlinkSync(marker, link);
      await expect(captureExistingChromeLogin({ consent: true }, { portFile: () => link })).rejects.toMatchObject({ code: "invalid-endpoint" });
    }
    writeFileSync(marker, `65534\n${browserPath}`);
    await expect(captureExistingChromeLogin({ consent: true, timeoutMs: 100 }, { portFile: () => marker })).rejects.toBeInstanceOf(Error);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("OS-denied marker access reports a distinct safe code before connecting to Chrome", async () => {
  // Windows ACLs do not follow POSIX chmod, and root may legitimately bypass these mode bits.
  if (process.platform === "win32" || process.getuid?.() === 0) return;
  const f = await fixture();
  const phases: string[] = [];
  try {
    chmodSync(f.portFile, 0o000);
    const error = await captureExistingChromeLogin({ consent: true, onProgress: p => phases.push(p.phase) }, f.dependencies)
      .catch(error => error);
    expect(error).toMatchObject({ code: "chrome-profile-access-denied" });
    expect(error.message).not.toContain(f.portFile);
    expect(error.message).not.toContain(browserPath);
    expect(phases).toEqual(["discovering"]);
    expect(f.upgrades).toEqual([]);
    expect(f.calls).toEqual([]);
  } finally { chmodSync(f.portFile, 0o600); await f.close(); }
});

test("private file capture remains unverified until the launcher's isolated verifier succeeds", async () => {
  const f = await fixture();
  const storageStatePath = join(f.root, "capture", "state.json");
  try {
    const phases: string[] = [];
    await captureExistingChromeLoginToFile({ storageStatePath }, { consent: true, onProgress: p => phases.push(p.phase) }, f.dependencies);
    const marker = JSON.parse(readFileSync(`${storageStatePath}.verified.json`, "utf8"));
    expect(marker).toMatchObject({ version: 1, source: "existing-chrome-profile", captureComplete: true });
    expect(marker.authenticated).toBeUndefined();
    expect(JSON.parse(readFileSync(storageStatePath, "utf8")).origins).toEqual([]);
    expect(phases).toEqual(["discovering", "waiting-for-chrome", "reading-session", "complete"]);
  } finally { await f.close(); }
});

test("denied capture writes no private state or completion marker", async () => {
  const f = await fixture({ deny: true });
  const storageStatePath = join(f.root, "state.json");
  try {
    await expect(captureExistingChromeLoginToFile({ storageStatePath }, { consent: true }, f.dependencies)).rejects.toMatchObject({ code: "chrome-permission-denied" });
    expect(existsSync(storageStatePath)).toBe(false);
    expect(existsSync(`${storageStatePath}.verified.json`)).toBe(false);
  } finally { await f.close(); }
});
