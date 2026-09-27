import { expect, test } from "bun:test";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defaultConfig, saveConfig } from "../src/config";
const require = createRequire(import.meta.url);
const { RuntimeHost } = require("../launcher/electron/runtime.cjs");
const { registerClientConnections } = require("../launcher/electron/ipc/client-connections.cjs");

test.serial("client IPC consumes actual private CLI receipts without returning or logging the API key", async () => {
  const directory = mkdtempSync(join(tmpdir(), 'nekodex-client-ipc-'));
  const names = ['CODEX_HOME', 'CODEX_CHATGPT_WEB_HOME', 'CLAUDE_CONFIG_DIR'] as const;
  const previous = names.map(name => process.env[name]);
  for (const name of names) { process.env[name] = join(directory, name); mkdirSync(process.env[name]!); }
  saveConfig(defaultConfig());
  const logs: unknown[] = [], handlers = new Map<string, (...args: any[]) => Promise<any>>();
  let copied = '', idle = 0;
  const runtime: any = { app: { isPackaged: false }, sourceRoot: join(import.meta.dir, '..'),
    browserDescriptorPath: join(directory, 'unused-descriptor'),
    logger: { info: (...args: unknown[]) => logs.push(args), warn: (...args: unknown[]) => logs.push(args), error: (...args: unknown[]) => logs.push(args) } };
  runtime.run = (...args: unknown[]) => RuntimeHost.prototype.run.apply(runtime, args);
  registerClientConnections({ handle: (name: string, handler: any) => handlers.set(name, handler), runtimeHost: runtime,
    clipboard: { writeText: (text: string) => { copied = text; } }, isDevProfile: false,
    assertIdle: () => { idle++; }, providerChanged() {} });
  try {
    expect((await handlers.get('launcher:client-connections')!()).api.enabled).toBe(false);
    const enabled = await handlers.get('launcher:client-connection-action')!({}, 'api-enable');
    expect(enabled.api.enabled).toBe(true);
    expect(JSON.stringify(enabled)).not.toContain('sk-local-');
    expect(await handlers.get('launcher:copy-client-api-key')!()).toEqual({ copied: true });
    expect(copied).toMatch(/^sk-local-[a-f0-9]{64}$/);
    expect(JSON.stringify(logs)).not.toContain(copied);
    expect(idle).toBe(1);
  } finally {
    names.forEach((name, i) => { if (previous[i] === undefined) delete process.env[name]; else process.env[name] = previous[i]; });
    rmSync(directory, { recursive: true, force: true });
  }
}, 10_000);
