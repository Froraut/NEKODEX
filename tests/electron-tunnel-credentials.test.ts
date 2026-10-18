import { expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const store = require("../launcher/electron/account-tunnels.cjs");
const { createCredentialProvider } = require("../launcher/electron/tunnel-credentials.cjs");
const { RuntimeHost } = require("../launcher/electron/runtime.cjs");
const { RuntimeSupervisor } = require("../launcher/electron/runtime-supervisor.cjs");
const { processIdentity } = require("../launcher/electron/update-recovery.cjs");
const { managedTunnelConnectArgs, tunnelCredentialScope } = require("../launcher/electron/runtime-tunnel-policy.cjs");
const keyName = "NEKODEX_TUNNEL_RUNTIME_KEY";
const secret = "synthetic-private-value-without-conventional-key-prefix";
const tunnelId = `tunnel_${"a".repeat(32)}`;

test("outer setup rollback preserves a candidate reference before restoration and refuses to orphan on journal failure", () => {
  const f = fixture();
  try {
    const before = fs.readFileSync(f.configPath);
    const checkpoint = [{ path: f.configPath, exists: true, data: before, mode: 0o600 }];
    const candidate = f.prepare(); store.commitAccountTunnel(candidate);
    f.host.restoreSetupCheckpoint(checkpoint);
    expect(fs.readFileSync(f.configPath)).toEqual(before);
    const journal = path.join(f.root, "runtime", "credential-recovery", `rollback-${candidate.binding.tunnel.credential.id}.json`);
    const receipt = JSON.parse(fs.readFileSync(journal, "utf8"));
    expect(receipt.reference).toEqual(candidate.binding.tunnel.credential);
    expect(receipt.scope).toEqual({ accountId: "default", interactionMode: "automatic", tunnelId });
    expect(receipt.settlement).toBe("unverified");
    expect(JSON.stringify(receipt)).not.toContain(secret);
    expect(f.records.size).toBe(1);
    const puts = f.requests.filter(item => item === "prepare").length;
    expect(() => f.prepare()).toThrow("requires recovery");
    expect(f.requests.filter(item => item === "prepare").length).toBe(puts);
    store.commitAccountTunnel(candidate);
    const published = fs.readFileSync(f.configPath);
    fs.unlinkSync(journal); fs.mkdirSync(journal);
    expect(() => f.host.restoreSetupCheckpoint(checkpoint)).toThrow();
    expect(fs.readFileSync(f.configPath)).toEqual(published);
  } finally { f.cleanup(); }
});

test("private setup stdin reaches the actual child without staging files or output disclosure", async () => {
  const f = fixture();
  try {
    const marker = path.join(f.root, "delivered.json"), logs: unknown[] = [];
    const hash = createHash("sha256").update(secret).digest("hex");
    f.host.command = () => ({ executable: process.execPath, cwd: f.root, args: ["-e",
      `let value='';process.stdin.on('data',c=>value+=c);process.stdin.on('end',()=>{` +
      `require('fs').writeFileSync(${JSON.stringify(marker)},JSON.stringify({matches:require('crypto').createHash('sha256').update(value).digest('hex')===${JSON.stringify(hash)},argvSafe:!process.argv.join(' ').includes(value)}));` +
      `process.stdout.write(value.slice(0,6));process.stdout.write(value.slice(6));process.stderr.write(value);});`] });
    f.host.logger = { info: (...v: unknown[]) => logs.push(v), warn: (...v: unknown[]) => logs.push(v), error: (...v: unknown[]) => logs.push(v) };
    f.host.publishOperation = (v: unknown) => logs.push(v);
    const result = await f.host.run("private-key-setup", [], { secretInput: secret, privateOutput: true, timeoutMs: 2_000 });
    expect(result.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(marker, "utf8"))).toEqual({ matches: true, argvSafe: true });
    expect(JSON.stringify({ result, logs })).not.toContain(secret);
    expect(fs.existsSync(path.join(f.root, "secrets"))).toBe(false);
  } finally { f.cleanup(); }
}, 4_000);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-electron-vault-"));
  const configPath = path.join(root, "config.json");
  const records = new Map<string, any>();
  const requests: any[] = [];
  let locked = false;
  const provider = createCredentialProvider({ coreHome: root, backend: { request(input: any) {
    requests.push(input.operation);
    if (input.operation === "prepare") { records.set(input.record.reference.id, input.record); return { version: 1, status: "ok" }; }
    if (locked) return { version: 1, status: "locked" };
    const record = records.get(input.reference?.id);
    if (input.operation === "resolve") return record ? { version: 1, status: "ok", record } : { version: 1, status: "not-found" };
    if (input.operation === "remove") { records.delete(input.reference.id); return { version: 1, status: "ok", removed: true }; }
    return { version: 1, status: "ok" };
  } } });
  const binaryPath = path.join(root, "sdk-fixture");
  fs.writeFileSync(binaryPath, "inert SDK fixture");
  fs.writeFileSync(configPath, JSON.stringify({ version: 3, releaseVersion: "6.1.32-nekodex.7", mode: "full",
    browserHost: "launcher", accountTunnelMode: true, browserInteractionMode: "automatic", tunnel: { binaryPath }, accountTunnels: [] }));
  const prepare = (extra: any = {}) => store.prepareAccountTunnel({ coreHome: root, configPath, accountId: "default",
    tunnelId, runtimeKey: secret, credentialProvider: provider, ...extra });
  const read = () => JSON.parse(fs.readFileSync(configPath, "utf8"));
  let ready = true, proof = true;
  const events: string[] = [];
  const supervisor: any = { configPath, coreHome: root, credentialProvider: provider,
    readConfig: read, readSetupConfig: read,
    prepareAccountTunnelChange: async () => { events.push("stop"); },
    syncAccountTunnels: async () => { events.push("start"); },
    getAccountTunnelStatus: () => ({ ready }),
    hasVerifiedAccountCredentialLaunch: () => proof,
  };
  const host = new RuntimeHost({ app: { getVersion: () => "6.1.32-nekodex.7", getPath: () => root },
    logger: { info() {}, warn() {}, error() {} }, coreHome: root, codexHome: path.join(root, "codex"),
    supervisor, credentialProvider: provider });
  host.runtimeConfigSnapshot = () => ({ configured: true, owner: "launcher", config: read() });
  return { root, configPath, provider, records, requests, prepare, read, host, supervisor, events,
    lock: () => { locked = true; }, setReady: (value: boolean) => { ready = value; },
    setProof: (value: boolean) => { proof = value; },
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("new account credentials use scoped vault references; legacy files require an explicit choice", () => {
  const f = fixture();
  try {
    const change = f.prepare();
    store.commitAccountTunnel(change);
    const tunnel = f.read().accountTunnels[0].tunnel;
    expect(tunnel.runtimeKeyFile).toBeUndefined();
    expect(f.provider.resolve(tunnel.credential, { accountId: "default", interactionMode: "automatic", tunnelId })).toBe(secret);
    expect(fs.readFileSync(f.configPath, "utf8")).not.toContain(secret);
    expect(() => store.validateAccountTunnelBindings([{ accountId: "default", interactionMode: "automatic",
      tunnel: { ...tunnel, runtimeKeyFile: path.join(f.root, "legacy.key") } }])).toThrow("conflicts");
    const legacy = f.prepare({ accountId: "00000000-0000-4000-8000-000000000002", tunnelId: `tunnel_${"b".repeat(32)}`,
      credentialStorage: "legacy-file" });
    expect(legacy.binding.tunnel.credential).toBeUndefined();
    expect(fs.readFileSync(legacy.binding.tunnel.runtimeKeyFile, "utf8")).toBe(secret);
    store.discardAccountTunnel(legacy);
    f.lock();
    expect(f.host.mcpCredentialsConfigured("automatic", "default")).toBe(true);
    const before = fs.readFileSync(f.configPath);
    expect(() => f.prepare({ runtimeKey: undefined, reuseSavedCredentials: true, credentialStorage: "legacy-file" })).toThrow("locked");
    expect(fs.readFileSync(f.configPath)).toEqual(before);
  } finally { f.cleanup(); }
});

test("managed SDK child receives only scoped secret environment; all returned output is scrubbed and local probes never unlock", async () => {
  const f = fixture();
  try {
    const change = f.prepare(); store.commitAccountTunnel(change);
    const config = f.read();
    fs.mkdirSync(config.tunnel.profileDir, { recursive: true });
    // This native command fixture runs only in its temp directory. It proves
    // actual child env delivery and intentionally echoes the synthetic key.
    fs.writeFileSync(config.tunnel.binaryPath, `#!${process.execPath}\nconst value=process.env.${keyName}||'';\n` +
      `process.stdout.write(JSON.stringify({args:process.argv.slice(2),delivered:value===${JSON.stringify(secret)}})+'\\n');\n` +
      `process.stdout.write(value.slice(0,7));process.stdout.write(value.slice(7));process.stderr.write(value);\n`, { mode: 0o700 });
    fs.chmodSync(config.tunnel.binaryPath, 0o700);
    const supervisor = new RuntimeSupervisor({ coreHome: f.root, app: {}, logger: {}, credentialProvider: f.provider,
      tunnelProxyEnvironmentProvider: async () => ({ [keyName]: "unrelated-inherited-key" }) });
    supervisor.binding = change.binding;
    const args = managedTunnelConnectArgs(config, { executable: "/fixture/bun", args: ["mcp"] });
    expect(args).toContain(`env:${keyName}`);
    expect(args.join(" ")).not.toContain(secret);
    const inherited = process.env[keyName];
    const connected = await supervisor.runTunnelCommand(config, args, 2_000, "Synthetic connect");
    expect(connected.stdout).toContain('"delivered":true');
    expect(JSON.stringify(connected)).not.toContain(secret);
    expect(connected.stderr).toBe("[redacted]");
    expect(process.env[keyName]).toBe(inherited);
    const beforeProbe = f.requests.filter(item => item === "resolve").length;
    const local = await supervisor.runTunnelCommand(config, ["runtimes", "cleanup", "--json"], 2_000, "Synthetic local probe");
    expect(local.stdout).toContain('"delivered":false');
    expect(f.requests.filter(item => item === "resolve").length).toBe(beforeProbe);
    const remote = await supervisor.runTunnelCommand(config, ["runtimes", "status", config.tunnel.alias, "--json"], 2_000, "Synthetic remote status");
    expect(remote.stdout).toContain('"delivered":true');
    expect(f.requests.filter(item => item === "resolve").length).toBe(beforeProbe + 1);
  } finally { f.cleanup(); }
}, 5_000);

test("migration stops exact peer before committed vault startup and retires only after new-owner proof", async () => {
  const f = fixture();
  try {
    const old = f.prepare({ credentialStorage: "legacy-file" }); store.commitAccountTunnel(old);
    const key = old.binding.tunnel.runtimeKeyFile;
    f.supervisor.prepareAccountTunnelChange = async () => {
      expect(f.read().accountTunnels[0].tunnel.runtimeKeyFile).toBe(key);
      expect(fs.existsSync(key)).toBe(true); f.events.push("stop");
    };
    f.supervisor.syncAccountTunnels = async () => {
      expect(f.read().accountTunnels[0].tunnel.credential.provider).toBe("os-vault");
      expect(fs.existsSync(key)).toBe(true); f.events.push("start");
    };
    expect(await f.host.migrateAccountTunnelCredential("default")).toEqual({ ok: true, saved: true,
      ready: true, migrated: true, legacyRetired: true });
    expect(f.events).toEqual(["stop", "start"]);
    expect(fs.existsSync(key)).toBe(false);
    expect(f.read().accountTunnels[0].tunnel.alias).toBe(old.binding.tunnel.alias);
    expect(store.accountTunnelView(f.read(), "default", "automatic").credentialStorage).toBe("protected");
  } finally { f.cleanup(); }
});

test("saved-not-ready migration keeps the legacy file and resumes exact reference without preparing another key", async () => {
  const f = fixture();
  try {
    const old = f.prepare({ credentialStorage: "legacy-file" }); store.commitAccountTunnel(old);
    f.setReady(false); f.setProof(false);
    expect(await f.host.migrateAccountTunnelCredential("default")).toMatchObject({ saved: true, ready: false,
      migrated: true, legacyRetired: false, recoveryRequired: true });
    const reference = f.read().accountTunnels[0].tunnel.credential;
    expect(fs.existsSync(old.binding.tunnel.runtimeKeyFile)).toBe(true);
    f.setReady(true); f.setProof(true);
    f.supervisor.prepareAccountTunnelChange = async () => {};
    expect(await f.host.migrateAccountTunnelCredential("default")).toMatchObject({ ready: true, legacyRetired: true });
    expect(f.read().accountTunnels[0].tunnel.credential).toEqual(reference);
    expect(f.requests.filter(item => item === "prepare").length).toBe(1);
  } finally { f.cleanup(); }
});

test("concurrent config and legacy-key changes preserve the newer writer and prevent unsafe retirement", async () => {
  const f = fixture();
  try {
    const old = f.prepare({ credentialStorage: "legacy-file" }); store.commitAccountTunnel(old);
    f.supervisor.prepareAccountTunnelChange = async () => {
      fs.writeFileSync(f.configPath, JSON.stringify({ ...f.read(), externalWriter: true }));
    };
    await expect(f.host.migrateAccountTunnelCredential("default")).rejects.toThrow("configuration changed");
    expect(f.read().externalWriter).toBe(true);
    expect(f.read().accountTunnels[0].tunnel.runtimeKeyFile).toBe(old.binding.tunnel.runtimeKeyFile);
    expect(f.records.size).toBe(0);
    f.supervisor.prepareAccountTunnelChange = async () => {};
    f.supervisor.syncAccountTunnels = async () => { fs.writeFileSync(old.binding.tunnel.runtimeKeyFile, "replacement-private-value"); };
    expect(await f.host.migrateAccountTunnelCredential("default")).toMatchObject({ saved: true, legacyRetired: false });
    expect(fs.readFileSync(old.binding.tunnel.runtimeKeyFile, "utf8")).toBe("replacement-private-value");
  } finally { f.cleanup(); }
});

test("uncertain vault prepare persists its owner receipt without raw material and stops no peer", async () => {
  const f = fixture();
  try {
    const old = f.prepare({ credentialStorage: "legacy-file" }); store.commitAccountTunnel(old);
    f.lock();
    await expect(f.host.migrateAccountTunnelCredential("default")).rejects.toThrow("locked");
    const directory = path.join(f.root, "runtime", "credential-recovery");
    const receipts = fs.readdirSync(directory);
    expect(receipts).toHaveLength(1);
    const recovery = fs.readFileSync(path.join(directory, receipts[0]), "utf8");
    expect(recovery).not.toContain(secret);
    expect(JSON.parse(recovery).receipt.reference.provider).toBe("os-vault");
    expect(f.events).toEqual([]);
    expect(f.read().accountTunnels[0].tunnel.runtimeKeyFile).toBe(old.binding.tunnel.runtimeKeyFile);
    expect(fs.existsSync(old.binding.tunnel.runtimeKeyFile)).toBe(true);
    const puts = f.requests.filter(item => item === 'prepare').length;
    await expect(f.host.migrateAccountTunnelCredential("default")).rejects.toThrow('requires recovery');
    expect(f.requests.filter(item => item === 'prepare').length).toBe(puts);
  } finally { f.cleanup(); }
});

test("retirement proof requires exact live process, reference, scope and SDK env selector", () => {
  const f = fixture();
  try {
    const change = f.prepare(); store.commitAccountTunnel(change);
    const config = f.read();
    const supervisor = new RuntimeSupervisor({ coreHome: f.root, app: {}, logger: {}, credentialProvider: f.provider });
    supervisor.binding = change.binding;
    supervisor.readConfig = () => config;
    supervisor.tunnel = { pid: process.pid, exitCode: null, signalCode: null };
    supervisor.lastCredentialLaunch = { reference: config.tunnel.credential,
      scope: tunnelCredentialScope(config, change.binding), pid: process.pid, identity: processIdentity(process.pid) };
    fs.mkdirSync(config.tunnel.profileDir, { recursive: true });
    const profile = path.join(config.tunnel.profileDir, `${config.tunnel.profileName}.yaml`);
    fs.writeFileSync(profile, JSON.stringify({ control_plane: { api_key: `env:${keyName}`, tunnel_id: tunnelId } }));
    expect(supervisor.hasVerifiedCredentialLaunch(config.tunnel.credential)).toBe(true);
    fs.writeFileSync(profile, JSON.stringify({ control_plane: { api_key: "file:/old/key", tunnel_id: tunnelId } }));
    expect(supervisor.hasVerifiedCredentialLaunch(config.tunnel.credential)).toBe(false);
    fs.writeFileSync(profile, JSON.stringify({ control_plane: { api_key: `env:${keyName}`, tunnel_id: tunnelId } }));
    supervisor.lastCredentialLaunch.identity = "different-process-start";
    expect(supervisor.hasVerifiedCredentialLaunch(config.tunnel.credential)).toBe(false);
  } finally { f.cleanup(); }
});
