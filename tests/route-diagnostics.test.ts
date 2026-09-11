import { test, expect } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { diagnoseCodexConfiguration, readCodexRouteDiagnostics } from "../src/route-diagnostics";
import { readBoundedUtf8File } from "../src/read-bounded-file";
import { CODEX_REALTIME_WEBRTC_CALL_BASE_URL } from "../src/codex-integration-shared";

const integration = { installed: true, active: true, routeUrl: "http://127.0.0.1:17841/v1", errors: [] };
const inspect = (text: string | null, profile?: string, profileText?: string) => diagnoseCodexConfiguration(text, { codexHome: "/fixture/codex", integration, profile, profileText });

test("route diagnostics distinguish configured provider overrides from observed integration", () => {
  const result = inspect('model_provider = "custom"\nopenai_base_url = "http://127.0.0.1:17841/v1"');
  expect(result.installed).toBe(true);
  expect(result.routeMatches).toBe(true);
  expect(result.provider).toBe("custom");
  expect(result.providerSource).toBe("root");
  expect(result.issueCodes).toEqual(["custom-provider"]);
});

test("selected profile routing is diagnosed without removing custom configuration", () => {
  const result = inspect('openai_base_url = "http://127.0.0.1:17841/v1"', "work", 'model_provider = "work_provider"\nmodel_catalog_json = "/secret/catalog.json"');
  expect(result.profile).toBe("work");
  expect(result.providerSource).toBe("profile");
  expect(result.issueCodes).toEqual(["custom-provider", "catalog-override"]);
  expect(JSON.stringify(result)).not.toContain("/secret/catalog.json");
  expect(inspect('[profiles.work]\nmodel_provider="work_provider"').provider).toBe("openai");
  expect(result.profilePath).toMatch(/work\.config\.toml$/);
});

test("missing and invalid profiles never claim the default provider is effective", () => {
  expect(inspect('[profiles.work]\nmodel_provider="custom"', "missing").provider).toBeNull();
  expect(inspect('profile="missing"').profile).toBeNull();
  expect(inspect('', "work", 'model_provider="unterminated').issueCodes).toContain("profile-unavailable");
});

test("display restrictions do not reject ordinary Unicode names or hide custom routing", () => {
  expect(inspect('', "Work Team", 'model_provider="工作配置"')).toMatchObject({ profile: "Work Team", provider: "工作配置", providerSource: "profile", customProvider: true });
  const restricted = inspect('model_provider="custom/credential-shaped-label"');
  expect(restricted.customProvider).toBe(true);
  expect(restricted.issueCodes).toContain("custom-provider");
  expect(JSON.stringify(restricted)).not.toContain("credential-shaped-label");
});

test("passive journal inspection never repairs absent, divergent or corrupt copies or hooks", () => {
  const home = mkdtempSync(join(tmpdir(), "route-passive-"));
  try {
    const configPath = join(home, "config.toml");
    const journalPaths = { primaryPath: join(home, "primary.json"), recoveryPath: join(home, "recovery.json") };
    const hooksPath = join(home, "hooks.json");
    const originalConfig = `openai_base_url="${integration.routeUrl}"\n`;
    const originalHooks = '{"hooks":{}}\n';
    writeFileSync(configPath, originalConfig);
    writeFileSync(hooksPath, originalHooks);
    const journal = { version: 11, active: true, configPath, installed: {
      openai_base_url: integration.routeUrl, experimental_realtime_webrtc_call_base_url: CODEX_REALTIME_WEBRTC_CALL_BASE_URL, subagent_protocol: "native",
    }, previous: {}, previousRealtimeWebrtcCallBaseUrl: { present: false }, interruptHook: {
      storage: "json", command: "fixture-interrupt", hooksPath, groupIndex: 0, hookIndex: 0,
      entryHash: `sha256:${"a".repeat(64)}`, stateKey: "fixture", trustedHash: `sha256:${"b".repeat(64)}`, trustFragment: "fixture",
    } };
    // v7 is also accepted as a passive legacy state and has no hook migration side effects.
    const legacy = { version: 7, active: true, configPath, installed: { openai_base_url: integration.routeUrl }, previous: {} };
    const inspectFiles = () => readCodexRouteDiagnostics({ codexHome: home, journalPaths });
    expect(inspectFiles().installed).toBe(false);
    expect(readdirSync(home).sort()).toEqual(["config.toml", "hooks.json"]);
    // Simulate interruption after only the recovery copy was saved.
    const recoveryBytes = JSON.stringify(legacy);
    writeFileSync(journalPaths.recoveryPath, recoveryBytes);
    expect(inspectFiles().issueCodes).toContain("integration-recovery-pending");
    expect(inspectFiles().active).toBeNull();
    expect(existsSync(journalPaths.primaryPath)).toBe(false);
    writeFileSync(journalPaths.primaryPath, JSON.stringify({ ...legacy, active: false }));
    expect(inspectFiles().issueCodes).toContain("integration-recovery-pending");
    expect(readFileSync(journalPaths.recoveryPath, "utf8")).toBe(recoveryBytes);
    // Matching copies authorize diagnosis, never migration or hook creation.
    writeFileSync(journalPaths.primaryPath, recoveryBytes);
    expect(inspectFiles().routeMatches).toBe(true);
    expect(inspectFiles().active).toBe(true);
    writeFileSync(journalPaths.recoveryPath, JSON.stringify(journal));
    rmSync(journalPaths.primaryPath);
    expect(inspectFiles().issueCodes).toContain("integration-recovery-pending");
    expect(existsSync(journalPaths.primaryPath)).toBe(false);
    expect(readFileSync(hooksPath, "utf8")).toBe(originalHooks);
    writeFileSync(journalPaths.primaryPath, '{"secret":"private-journal');
    const corrupt = inspectFiles();
    expect(corrupt.issueCodes).toContain("integration-unreadable");
    expect(JSON.stringify(corrupt)).not.toContain("private-journal");
    expect(readFileSync(journalPaths.primaryPath, "utf8")).toBe('{"secret":"private-journal');
    expect(readFileSync(configPath, "utf8")).toBe(originalConfig);
    expect(readFileSync(hooksPath, "utf8")).toBe(originalHooks);
    // Different homes must not claim an installed or active route for this home.
    const foreign = JSON.stringify({ ...legacy, configPath: join(home, "other", "config.toml") });
    writeFileSync(journalPaths.primaryPath, foreign);
    writeFileSync(journalPaths.recoveryPath, foreign);
    expect(inspectFiles()).toMatchObject({ installed: false, active: null, routeMatches: null });
    expect(inspectFiles().issueCodes).toContain("integration-drift");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("sidecar profiles layer top-level routing and unsafe names never resolve files", () => {
  const home = mkdtempSync(join(tmpdir(), "route-profile-"));
  try {
    writeFileSync(join(home, "config.toml"), `model_provider="custom"\nopenai_base_url="${integration.routeUrl}"\n`);
    const profilePath = join(home, "work.config.toml");
    const contents = 'model_provider="openai"\nopenai_base_url="https://private-route.example"\n';
    writeFileSync(profilePath, contents);
    const result = readCodexRouteDiagnostics({ codexHome: home, profile: "work", inspect: () => integration });
    expect(result).toMatchObject({ provider: "openai", providerSource: "profile", profilePath, routeMatches: false });
    expect(JSON.stringify(result)).not.toContain("private-route.example");
    expect(readFileSync(profilePath, "utf8")).toBe(contents);
    expect(readCodexRouteDiagnostics({ codexHome: home, profile: "../work", inspect: () => integration })).toMatchObject({ provider: null, profilePath: null });
    rmSync(join(home, "config.toml"));
    expect(readCodexRouteDiagnostics({ codexHome: home, profile: "work", inspect: () => integration }).provider).toBe("openai");
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("bounded file inspection rejects oversized and invalid UTF-8 inputs", () => {
  const home = mkdtempSync(join(tmpdir(), "route-bound-"));
  try {
    const path = join(home, "config.toml");
    writeFileSync(path, "abcd");
    expect(readBoundedUtf8File(path, 4)).toBe("abcd");
    expect(() => readBoundedUtf8File(path, 3)).toThrow(/byte limit/);
    writeFileSync(path, Buffer.from([0xff]));
    expect(() => readBoundedUtf8File(path)).toThrow();
    expect(() => readBoundedUtf8File(home)).toThrow();
    const result = readCodexRouteDiagnostics({ codexHome: home, inspect: () => integration });
    expect(result.configStatus).toBe("unreadable");
    expect(result.provider).toBeNull();
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test("diagnostics do not leak malformed TOML, secret URLs or private journal errors", () => {
  const secret = "secret-credential-value";
  const invalid = inspect(`api_key="${secret}`);
  expect(invalid.configStatus).toBe("invalid");
  expect(JSON.stringify(invalid)).not.toContain(secret);
  const result = diagnoseCodexConfiguration(`openai_base_url="https://user:${secret}@example.com/?key=${secret}"`, {
    codexHome: "/fixture/codex", integration: { ...integration, errors: [secret] },
  });
  expect(result.issueCodes).toEqual(["integration-drift", "route-mismatch"]);
  expect(JSON.stringify(result)).not.toContain(secret);
});

test("read-only diagnostics inspect the chosen home and preserve config bytes", () => {
  const home = mkdtempSync(join(tmpdir(), "route-diagnostics-"));
  try {
    const config = join(home, "config.toml");
    expect(readCodexRouteDiagnostics({ codexHome: home, inspect: () => integration }).configStatus).toBe("missing");
    const contents = '# preserved\r\nmodel_provider="custom"\r\n';
    writeFileSync(config, contents);
    const result = readCodexRouteDiagnostics({ codexHome: home, inspect: () => integration });
    expect(result.codexHome).toBe(home);
    expect(result.configPath).toBe(config);
    expect(result.provider).toBe("custom");
    expect(readFileSync(config, "utf8")).toBe(contents);
  } finally { rmSync(home, { recursive: true, force: true }); }
});
