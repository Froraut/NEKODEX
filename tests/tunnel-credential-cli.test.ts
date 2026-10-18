import { afterEach, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createCredentialProvider } from "../launcher/electron/tunnel-credentials.cjs";
import { defaultConfig, loadConfig, saveConfig, getConfigPath, type AppConfig, type TunnelCredentialReference } from "../src/config";
import { createTunnelConfig, connectTunnel } from "../src/tunnel";
import { prepareSetupTunnelCredential } from "../src/setup";
import { finalizeTunnelCredentialMigration, tunnelServiceDefinition } from "../src/tunnel-service";
import { readRuntimeKeyInput, prepareProtectedTunnelCredential, importSavedTunnelCredential, discardUncommittedTunnelCredential, tunnelCredentialScope, tunnelLaunchEnvironment, TUNNEL_RUNTIME_KEY_ENV,
  type TunnelCredentialProvider } from "../src/tunnel-credential";
const dirs: string[] = [];
const originalHome = process.env.CODEX_CHATGPT_WEB_HOME;
afterEach(() => { if (originalHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME; else process.env.CODEX_CHATGPT_WEB_HOME = originalHome;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() { const root = mkdtempSync(join(tmpdir(), "nekodex-cli-credential-")); dirs.push(root); process.env.CODEX_CHATGPT_WEB_HOME = root; return root; }
function providerAt(root: string) {
  const records = new Map<string, any>(); let locked = false;
  const provider = createCredentialProvider({ coreHome: root, backend: { request: (request: any) => {
    if (locked) return { version: 1, status: "locked" };
    if (request.operation === "prepare") { records.set(request.record.reference.id, structuredClone(request.record)); return { version: 1, status: "ok" }; }
    if (request.operation === "resolve") return records.has(request.reference.id)
      ? { version: 1, status: "ok", record: structuredClone(records.get(request.reference.id)) } : { version: 1, status: "not-found" };
    if (request.operation === "remove") { records.delete(request.reference.id); return { version: 1, status: "ok", removed: true }; }
    return { version: 1, status: "ok" };
  } } }) as TunnelCredentialProvider;
  return { provider, records, lock: () => { locked = true; } };
}
function full(root: string, reference: TunnelCredentialReference, binaryPath = process.execPath): AppConfig {
  const config = defaultConfig("full"); config.browserHost = "launcher"; config.browserHostDescriptorPath = join(root, "browser.json");
  config.tunnel = createTunnelConfig({ binaryPath, tunnelId: `tunnel_${"a".repeat(32)}`, credential: reference });
  config.automaticTunnel = config.tunnel; return config;
}
test("setup protects a supplied key without a plaintext mirror; config commit/rollback retains referenced vault entries", () => {
  const root = fixture(); const { provider, records, lock } = providerAt(root);
  const prepared = prepareSetupTunnelCredential(undefined, `tunnel_${"a".repeat(32)}`, "automatic", { runtimeKeyValue: "synthetic-setup-key" }, undefined, provider);
  expect(records.size).toBe(1); expect(existsSync(join(root, "secrets"))).toBe(false);
  expect(JSON.stringify(prepared)).not.toContain("synthetic-setup-key");
  const config = full(root, prepared.reference); saveConfig(config);
  expect(loadConfig().tunnel?.credential).toEqual(prepared.reference);
  expect(readFileSync(getConfigPath(), "utf8")).not.toContain("synthetic-setup-key");
  discardUncommittedTunnelCredential(prepared.prepared!, provider); expect(records.size).toBe(1);
  const second = prepareSetupTunnelCredential(config.tunnel, config.tunnel!.tunnelId, "automatic", { runtimeKeyValue: "synthetic-uncommitted-key" }, undefined, provider);
  discardUncommittedTunnelCredential(second.prepared!, provider); expect(records.size).toBe(1);
  const saved = readFileSync(getConfigPath(), "utf8"); lock();
  expect(() => tunnelLaunchEnvironment(config, provider)).toThrow();
  expect(readFileSync(getConfigPath(), "utf8")).toBe(saved);
  expect(loadConfig().tunnel?.credential).toEqual(prepared.reference);
});
test("legacy config stays readable, mixed credential sources fail closed, and account scopes stay distinct", () => {
  const root = fixture(); const { provider } = providerAt(root);
  const key = join(root, "old.key"); writeFileSync(key, "synthetic-old-key", { mode: 0o600 });
  const ref = provider.prepare({ accountId: "legacy", interactionMode: "automatic", tunnelId: `tunnel_${"a".repeat(32)}` }, "synthetic-key").reference;
  const config = full(root, ref); config.tunnel = { ...config.tunnel!, runtimeKeyFile: key } as any; delete config.tunnel!.credential;
  config.automaticTunnel = config.tunnel; saveConfig(config); expect(loadConfig().tunnel?.runtimeKeyFile).toBe(key);
  (config.tunnel as any).credential = ref; saveConfig(config); expect(() => loadConfig()).toThrow();
  const scoped = full(root, ref); scoped.accountTunnelMode = true; scoped.accountTunnels = [{ accountId: "default", interactionMode: "automatic", tunnel: scoped.tunnel! }];
  expect(tunnelCredentialScope(scoped).accountId).toBe("default");
  expect(() => tunnelLaunchEnvironment(scoped, provider)).toThrow();
  expect(tunnelCredentialScope(full(root, ref)).accountId).toBe("legacy");
  const plist = tunnelServiceDefinition(full(root, ref));
  expect(plist).toContain("credential-run"); expect(plist).not.toContain(ref.id); expect(plist).not.toContain("synthetic-key");
});
test("explicit legacy-file compatibility is required for new plaintext writes", () => {
  const root = fixture(); let prepares = 0;
  const provider = { prepare() { prepares += 1; throw new Error("unsupported"); } } as unknown as TunnelCredentialProvider;
  expect(() => prepareSetupTunnelCredential(undefined, `tunnel_${"a".repeat(32)}`, "automatic", { runtimeKeyValue: "synthetic-key" }, undefined, provider)).toThrow("unsupported");
  expect(existsSync(join(root, "secrets"))).toBe(false);
  const prepared = prepareSetupTunnelCredential(undefined, `tunnel_${"a".repeat(32)}`, "automatic",
    { runtimeKeyValue: "synthetic-legacy-key", credentialStorage: "legacy-file" }, undefined, provider);
  expect(prepares).toBe(1); expect(readFileSync(prepared.runtimeKeyFile!, "utf8")).toBe("synthetic-legacy-key");
  expect(prepared.reference).toBeUndefined();
});
test("bounded stdin transport and uncertain vault preparation retain only a recoverable owner receipt", async () => {
  const root = fixture();
  async function* input() { yield Buffer.from("  synthetic-stdin-key\n"); }
  expect(await readRuntimeKeyInput(input())).toBe("synthetic-stdin-key");
  async function* tooLarge() { yield Buffer.alloc(65_537, 65); }
  await expect(readRuntimeKeyInput(tooLarge())).rejects.toThrow("64KiB");
  const receipt = { version: 1 as const, reference: { version: 1 as const, provider: "os-vault" as const, id: randomUUID(), revision: randomUUID() },
    scope: { accountId: "legacy", interactionMode: "automatic" as const, tunnelId: `tunnel_${"a".repeat(32)}` }, scopeHash: "a".repeat(64), owner: randomUUID() };
  let calls = 0;
  const uncertain = { prepare() { calls++; throw Object.assign(new Error("unavailable"), { preparedReceipt: receipt }); } } as unknown as TunnelCredentialProvider;
  const config = full(root, receipt.reference); saveConfig(config);
  expect(() => importSavedTunnelCredential("PRIVATE_UNCERTAIN_KEY", uncertain)).toThrow("unavailable");
  const recovery = readFileSync(join(root, "runtime", "credential-recovery", `${receipt.reference.id}.json`), "utf8");
  expect(recovery).toContain(receipt.owner); expect(recovery).not.toContain("PRIVATE_UNCERTAIN_KEY");
  expect(() => prepareProtectedTunnelCredential(receipt.scope, "another-key", uncertain)).toThrow("requires recovery");
  expect(calls).toBe(1); expect(loadConfig().tunnel?.credential).toEqual(receipt.reference);
  rmSync(join(root, "runtime", "credential-recovery", `${receipt.reference.id}.json`));
  writeFileSync(join(root, "runtime", "credential-recovery", `rollback-${receipt.reference.id}.json`),
    JSON.stringify({ reference: receipt.reference, scope: receipt.scope, settlement: "unverified" }));
  expect(() => prepareProtectedTunnelCredential(receipt.scope, "retry-after-outer-rollback", uncertain)).toThrow("requires recovery");
  expect(calls).toBe(1);
});
test.skipIf(process.platform === "win32")("global finalization retires captured plaintext only after a stopped and newly ready protected SDK generation", async () => {
  const root = fixture(); const { provider } = providerAt(root); const oldKey = join(root, "secrets", "old.key");
  const { mkdirSync } = await import("node:fs"); mkdirSync(join(root, "secrets")); writeFileSync(oldKey, "PRIVATE_OLD_KEY", { mode: 0o600 });
  const binary = join(root, "sdk-finalize-fixture"); const calls = join(root, "calls.txt");
  const old = { ...full(root, { version: 1, provider: "os-vault", id: randomUUID(), revision: randomUUID() }).tunnel!, runtimeKeyFile: oldKey } as any; delete old.credential;
  const prepared = prepareSetupTunnelCredential(old, old.tunnelId, "automatic", { runtimeKeyValue: "synthetic-new-key" }, undefined, provider);
  expect(prepared.legacyCredentialRetirement?.path).toBe(oldKey);
  const config = full(root, prepared.reference!, binary); config.tunnel!.profileDir = root; config.tunnel!.legacyCredentialRetirement = prepared.legacyCredentialRetirement;
  config.automaticTunnel = config.tunnel; saveConfig(config);
  writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs');const a=process.argv.slice(2);fs.appendFileSync(${JSON.stringify(calls)},a.slice(0,2).join(' ')+'\\n');if(a[1]==='status')console.log(JSON.stringify({process_running:false,runtime_state:'stopped'}));else if(a[1]==='cleanup')console.log(JSON.stringify({entries:[{alias:${JSON.stringify(config.tunnel!.alias)},runtime_state:'ready'}]}));else if(a[1]==='connect'){const p=a[a.indexOf('--profile-dir')+1]+'/'+a[a.indexOf('--profile')+1]+'.yaml';fs.writeFileSync(p,JSON.stringify({control_plane:{api_key:a[a.indexOf('--runtime-api-key')+1],tunnel_id:a[a.indexOf('--tunnel-id')+1]}}));console.log(JSON.stringify({running:true,healthy:true,ready:true}))}else console.log('{}');\n`, { mode: 0o700 });
  const service = { status: () => ({ supported: true, installed: false, loaded: false, running: false, label: "fixture" }), stop: async () => {}, install: () => {} };
  expect(existsSync(oldKey)).toBe(true);
  let untouched = true;
  await expect(finalizeTunnelCredentialMigration({ credentialProvider: { resolve() { throw new Error("locked"); } },
    service: { ...service, status() { untouched = false; return service.status(); } }, idle: async () => {} })).rejects.toThrow("locked");
  expect(untouched).toBe(true); expect(existsSync(calls)).toBe(false); expect(existsSync(oldKey)).toBe(true);
  expect(await finalizeTunnelCredentialMigration({ credentialProvider: provider, service, idle: async () => {} })).toEqual({ retired: true, ready: true });
  expect(existsSync(oldKey)).toBe(false);
  const steps = readFileSync(calls, "utf8"); expect(steps.indexOf("runtimes stop")).toBeLessThan(steps.indexOf("runtimes status"));
  expect(steps.indexOf("runtimes status")).toBeLessThan(steps.indexOf("runtimes connect"));
  expect(loadConfig().tunnel?.legacyCredentialRetirement).toEqual(prepared.legacyCredentialRetirement);
});
test.skipIf(process.platform === "win32")("managed connect supplies the exact scoped key only in child environment and selector argv", () => {
  const root = fixture(); const { provider } = providerAt(root); const secret = "synthetic-connect-key";
  const reference = provider.prepare({ accountId: "legacy", interactionMode: "automatic", tunnelId: `tunnel_${"a".repeat(32)}` }, secret).reference;
  const binary = join(root, "sdk-fixture"); const receipt = join(root, "receipt.json");
  writeFileSync(binary, `#!${process.execPath}\nconst fs=require('node:fs');fs.writeFileSync(${JSON.stringify(receipt)},JSON.stringify({argv:process.argv.slice(2),keyMatches:process.env.NEKODEX_TUNNEL_RUNTIME_KEY===${JSON.stringify(secret)}}));console.log(JSON.stringify({running:true,healthy:true}));\n`, { mode: 0o700 });
  const old = process.env[TUNNEL_RUNTIME_KEY_ENV]; process.env[TUNNEL_RUNTIME_KEY_ENV] = "unrelated-ambient-key";
  try { connectTunnel(full(root, reference, binary), undefined, provider);
    const seen = JSON.parse(readFileSync(receipt, "utf8")); expect(seen.keyMatches).toBe(true);
    expect(seen.argv).toContain("env:NEKODEX_TUNNEL_RUNTIME_KEY"); expect(JSON.stringify(seen.argv)).not.toContain(secret);
    expect(process.env[TUNNEL_RUNTIME_KEY_ENV]).toBe("unrelated-ambient-key");
  } finally { if (old === undefined) delete process.env[TUNNEL_RUNTIME_KEY_ENV]; else process.env[TUNNEL_RUNTIME_KEY_ENV] = old; }
});
test.skipIf(process.platform === "win32")("headless wrapper resolves on each start, redacts output, preserves exit status and forwards termination", async () => {
  const root = fixture(); const binary = join(root, "sdk-run-fixture"); const secret = "synthetic-headless-key";
  const reference = { version: 1 as const, provider: "os-vault" as const, id: randomUUID(), revision: randomUUID() };
  const config = full(root, reference, binary); config.tunnel!.profileDir = root;
  writeFileSync(join(root, `${config.tunnel!.profileName}.yaml`), JSON.stringify({ control_plane: { api_key: "env:NEKODEX_TUNNEL_RUNTIME_KEY", tunnel_id: config.tunnel!.tunnelId } }));
  writeFileSync(binary, `#!${process.execPath}\nif(process.env.NEKODEX_TUNNEL_RUNTIME_KEY!==${JSON.stringify(secret)})process.exit(19); if(process.env.FIXTURE_SIGNAL){console.log('SDK_READY\\n'+'x'.repeat(128));setInterval(()=>{},1000)}else {process.stdout.write(${JSON.stringify(secret.slice(0, 10))});setTimeout(()=>{process.stdout.write(${JSON.stringify(secret.slice(10))});process.exit(7)},10)}\n`, { mode: 0o700 });
  const runner = join(root, "runner.ts"); const receipt = join(root, "resolves.txt");
  writeFileSync(runner, `import {runTunnelCredentialProcess} from ${JSON.stringify(join(import.meta.dir, "../src/tunnel.ts"))};import {appendFileSync} from 'node:fs';const outcome=await runTunnelCredentialProcess(${JSON.stringify(config)},{resolve(){appendFileSync(${JSON.stringify(receipt)},'resolved\\n');return ${JSON.stringify(secret)}}});if(outcome.signal)process.kill(process.pid,outcome.signal);else process.exitCode=outcome.code??1;`);
  const run = (signal = false) => new Promise<{ code: number | null; signal: string | null; output: string }>((resolveRun, reject) => {
    const child = spawn(process.execPath, [runner], { env: { ...process.env, ...(signal ? { FIXTURE_SIGNAL: "1" } : {}) }, stdio: ["ignore", "pipe", "pipe"] });
    let output = ""; let terminated = false;
    child.stdout.on("data", chunk => { output += chunk; if (signal && !terminated && output.includes("SDK_READY")) { terminated = true; child.kill("SIGTERM"); } });
    child.stderr.on("data", chunk => { output += chunk; }); child.once("error", reject);
    child.once("close", (code, received) => resolveRun({ code, signal: received, output }));
  });
  const first = await run(); const second = await run();
  expect(first.code).toBe(7); expect(second.code).toBe(7); expect(first.output).not.toContain(secret); expect(first.output).toContain("[redacted]");
  expect(readFileSync(receipt, "utf8").trim().split("\n")).toHaveLength(2);
  const terminated = await run(true); expect(terminated.signal).toBe("SIGTERM");
}, 8000);

test.skipIf(process.platform !== "darwin")("running cli.js locates only its relocated sibling helper, without a source-checkout fallback", () => {
  const root = fixture(); const app = join(root, "relocated", "app");
  const directory = join(app, "credential-helper", `${process.platform}-${process.arch}`); mkdirSync(directory, { recursive: true });
  const helper = join(directory, "nekodex-credential-helper"); const marker = join(root, "helper-called.json");
  writeFileSync(helper, `#!${process.execPath}\nconst fs=require('node:fs');const request=JSON.parse(fs.readFileSync(0,'utf8'));fs.writeFileSync(${JSON.stringify(marker)},JSON.stringify({operation:request.operation,argv:process.argv.slice(2)}));console.log(JSON.stringify({version:1,status:'ok'}));\n`, { mode: 0o700 });
  const entry = join(app, "cli.js");
  writeFileSync(entry, `import {tunnelCredentialProvider} from ${JSON.stringify(join(import.meta.dir, "../src/tunnel-credential.ts"))};console.log(JSON.stringify(tunnelCredentialProvider().capabilities()));`);
  const run = () => Bun.spawnSync([process.execPath, entry], { env: { ...process.env, CODEX_CHATGPT_WEB_HOME: root } });
  const first = run(); expect(first.exitCode).toBe(0);
  expect(JSON.parse(first.stdout.toString()).available).toBe(true);
  expect(JSON.parse(readFileSync(marker, "utf8"))).toEqual({ operation: "capabilities", argv: [] });
  rmSync(helper); rmSync(marker);
  const absent = run(); expect(absent.exitCode).toBe(0);
  expect(JSON.parse(absent.stdout.toString()).available).toBe(false);
  expect(existsSync(marker)).toBe(false);
});
