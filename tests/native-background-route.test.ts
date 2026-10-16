import { afterEach, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:net";
import { join } from "node:path";

const MODULE = join(import.meta.dir, "..", "src", "native-network.ts");
// Each case cold-starts Bun; the shared laptop can take several seconds per child.
const CHILD_TIMEOUT = 30_000;
const ROUTE_KEYS = [
  "CODEX_CHATGPT_WEB_NATIVE_BACKGROUND_ROUTE",
  "CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY",
  "CODEX_CHATGPT_WEB_NATIVE_PROXY",
  "CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy",
];

/** The module reads its launcher evidence at import, so every case gets a fresh process. */
async function run(script: string, env: Record<string, string>): Promise<unknown> {
  const base = { ...process.env };
  for (const key of ROUTE_KEYS) delete base[key];
  const child = Bun.spawn([process.execPath, "-e", `const m = await import(${JSON.stringify(MODULE)});\n${script}`], {
    env: { ...base, ...env }, stdout: "pipe", stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  if (code !== 0) throw new Error(`child exited ${code}: ${stderr}`);
  return JSON.parse(stdout.trim().split("\n").at(-1)!);
}

const ready = (env: Record<string, string>) => run("console.log(JSON.stringify(m.nativeNetworkBackgroundReady()));", env);

describe("native background route readiness", () => {
  test("launcher PAC evidence alone never authorizes detachment", async () => {
    expect(await Promise.all([
      ready({}),
      ready({ CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY: "DIRECT" }),
      ready({ CODEX_CHATGPT_WEB_NATIVE_FALLBACK_PROXY: "http://127.0.0.1:7890" }),
    ])).toEqual([false, false, false]);
  }, CHILD_TIMEOUT);

  test("an explicit DIRECT or exact proxy origin is durable readiness", async () => {
    expect(await Promise.all([
      ready({ CODEX_CHATGPT_WEB_NATIVE_BACKGROUND_ROUTE: "DIRECT" }),
      ready({ CODEX_CHATGPT_WEB_NATIVE_BACKGROUND_ROUTE: "http://127.0.0.1:7890" }),
    ])).toEqual([true, true]);
  }, CHILD_TIMEOUT);

  test("an invalid declaration fails closed", async () => {
    const values = ["", "direct", " DIRECT", "socks5://127.0.0.1:1080", "http://127.0.0.1:7890/",
      "http://user:pass@127.0.0.1:7890", "http://127.0.0.1:7890/path"];
    expect(await Promise.all(values.map(value => ready({ CODEX_CHATGPT_WEB_NATIVE_BACKGROUND_ROUTE: value }))))
      .toEqual(values.map(() => false));
  }, CHILD_TIMEOUT);
});

describe("native background route use", () => {
  let proxy: Server | undefined;
  afterEach(() => { proxy?.close(); proxy = undefined; });

  /** Records the first request line, then closes so the client fails without leaving the machine. */
  async function recordingProxy(): Promise<{ origin: string; firstLine: Promise<string> }> {
    let resolveLine!: (line: string) => void;
    const firstLine = new Promise<string>(resolve => { resolveLine = resolve; });
    proxy = createServer(socket => socket.once("data", data => {
      resolveLine(data.toString("latin1").split("\r\n")[0]);
      socket.destroy();
    }));
    await new Promise<void>(resolve => proxy!.listen(0, "127.0.0.1", resolve));
    const address = proxy.address();
    if (!address || typeof address === "string") throw new Error("proxy address unavailable");
    return { origin: `http://127.0.0.1:${address.port}`, firstLine };
  }

  const fetchScript = `
    try {
      await m.fetchNativeCodex(new Request("https://chatgpt.com/backend-api/codex/responses", { signal: AbortSignal.timeout(5000) }));
      console.log(JSON.stringify("ok"));
    } catch (error) { console.log(JSON.stringify(error?.code ?? error?.name ?? "error")); }`;

  test("a detached daemon without a declaration refuses to guess a route", async () => {
    const result = await run(fetchScript, { CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR: "/nonexistent/nekodex-descriptor.json" });
    expect(result).toBe("NativeProxyConfigurationError");
  }, CHILD_TIMEOUT);

  test("a detached daemon routes through the declared proxy origin", async () => {
    const { origin, firstLine } = await recordingProxy();
    const result = run(fetchScript, {
      CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR: "/nonexistent/nekodex-descriptor.json",
      CODEX_CHATGPT_WEB_NATIVE_BACKGROUND_ROUTE: origin,
    });
    expect(await firstLine).toBe("CONNECT chatgpt.com:443 HTTP/1.1");
    expect(await result).not.toBe("NativeProxyConfigurationError");
  }, CHILD_TIMEOUT);
});
