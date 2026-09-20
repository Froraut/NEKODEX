import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, defaultBrokerEndpoint } from "../src/config";

test("background runtime: native stream survives owner exit and reattaches without replacement", async () => {
  const root = mkdtempSync(join(tmpdir(), "nk-background-"));
  const portProbe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = portProbe.port!;
  await portProbe.stop(true);
  const config = { ...defaultConfig("browser-only"), port, browserHost: "launcher",
    browserHostDescriptorPath: join(root, "host.json"), brokerSocketPath: defaultBrokerEndpoint(root) };
  writeFileSync(join(root, "config.json"), JSON.stringify(config), { mode: 0o600 });
  const owners: ReturnType<typeof Bun.spawn>[] = [];
  const launch = () => {
    const child = Bun.spawn([process.execPath, join(import.meta.dir, "fixtures/background-runtime-owner.ts"), root],
      { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, CODEX_CHATGPT_WEB_HOME: root } });
    owners.push(child);
    const reader = child.stdout.getReader();
    return { child, line: async () => JSON.parse(new TextDecoder().decode((await reader.read()).value).trim()) };
  };
  let daemonPid: number | undefined;
  try {
    const first = launch();
    const ready = await first.line();
    expect(ready.status).toBe("ready");
    daemonPid = ready.daemonPid;
    const request = (model: string) => fetch(`http://127.0.0.1:${port}/v1/responses`, {
      method: "POST", headers: { authorization: "Bearer synthetic-test-credential", "content-type": "application/json" },
      body: JSON.stringify({ model, input: "synthetic", stream: true }), signal: AbortSignal.timeout(4000),
    });
    const response = await request("gpt-5.6-sol");
    expect(response.status).toBe(200);
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("response.created");
    first.child.stdin.write("detach\n");
    expect(await first.line()).toMatchObject({ status: "background", daemonPid });
    expect(await first.child.exited).toBe(0);
    let remaining = "";
    for (;;) { const part = await reader.read(); if (part.done) break; remaining += new TextDecoder().decode(part.value); }
    expect(remaining).toContain("response.completed");
    expect((await request("chatgpt-web/gpt-5.6-sol")).status).toBe(503);
    const second = launch();
    expect(await second.line()).toMatchObject({ status: "ready", daemonPid });
    const health = await fetch(`http://127.0.0.1:${port}/healthz`).then(r => r.json());
    expect(health).toMatchObject({ pid: daemonPid, launcher_detached: false, native_accepting_turns: true });
    second.child.stdin.write("stop\n");
    expect(await second.line()).toMatchObject({ status: "stopped" });
    expect(await second.child.exited).toBe(0);
  } finally {
    for (const child of owners) { if (child.exitCode === null) child.kill(); }
    // Only this fixture's recorded PID; never discover or stop a production process.
    try { daemonPid ??= JSON.parse(readFileSync(join(root, "runtime/launcher-supervisor.json"), "utf8")).daemonPid; } catch {}
    if (daemonPid) { try { process.kill(daemonPid, "SIGTERM"); } catch {} }
    await Promise.all(owners.map(owner => owner.exited));
    rmSync(root, { recursive: true, force: true });
  }
}, 10000);
