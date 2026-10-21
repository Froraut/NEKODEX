import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { validateProductionVmRuntimeManifest, VM_HELPER_SOURCE_SHA256 } from "../src/execution-environments/production-runtime";
import { BROWSER_COMPANION_FILES } from "../scripts/build-browser-companion";

const require = createRequire(import.meta.url);
const { BROWSER_COMPANION_RESOURCES, validatePackagedRuntimeAssets } = require("../launcher/scripts/release-signing.cjs");
const { assertIdentity, assertVmEntitlements, assertVaultEntitlements } = require("../launcher/scripts/verify-macos-install.cjs");
const { createProductionVmRuntimeManifest } = require("../scripts/build-execution-vm-helper.cjs");
const { DESKTOP_HELPER_EXECUTABLE_PATH, DESKTOP_HELPER_INFO_PLIST_PATH } = require("../scripts/build-desktop-helper.cjs");
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

function assetsFixture(root: string) {
  const write = (relative: string, value: string | Buffer = "fixture") => {
    const target = join(root, "app", relative);
    mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value);
    return target;
  };
  write("cli.js"); write("browser-helper.cjs");
  for (const prefix of ["browser-companion", "browser-companion/firefox"]) {
    for (const name of ["manifest.json", ...BROWSER_COMPANION_FILES]) write(`${prefix}/${name}`);
  }
  // The real reviewed Chrome manifest: its key must produce the pinned extension ID.
  write("browser-companion/manifest.json", readFileSync(new URL("../browser-companion/manifest.json", import.meta.url)));
  write("browser-companion/manifest.firefox.json");
  for (const [folder, binary] of [["credential-helper", "nekodex-credential-helper"], ["desktop-helper", DESKTOP_HELPER_EXECUTABLE_PATH], ["desktop-helper", DESKTOP_HELPER_INFO_PLIST_PATH], ["skill-pdf-helper", "nekodex-skill-pdf-helper"], ["oauth-vault-helper", "nekodex-oauth-vault-helper"]]) write(`${folder}/darwin-arm64/${binary}`);
  write("skill-pdf-helper/darwin-arm64/manifest.json", "{}");
  const directory = "execution-vm/darwin-arm64";
  const executable = write(`${directory}/nekodex-execution-vm-helper`, "signed-helper-fixture");
  chmodSync(executable, 0o755);
  const image = write(`${directory}/Image`, "kernel-fixture"), initrd = write(`${directory}/initrd.gz`, "initrd-fixture");
  const helper = Buffer.from(JSON.stringify({ version: 1, provider: "macos-virtualization", protocol: "neko-vm-v1",
    target: "darwin-arm64", cpuCount: 2, memoryBytes: 2147483648, guestPort: 4041,
    development: false, identifier: "com.nekodex.execution-vm-helper",
    publisherTeamId: "CNMWGJF2CG", sourceSha256: VM_HELPER_SOURCE_SHA256,
    executableSha256: sha(readFileSync(executable)), entitlementsSha256: "a".repeat(64) }));
  const guest = Buffer.from(JSON.stringify({ version: 1, protocol: "neko-vm-v1", architecture: "arm64",
    kernel: { sha256: sha(readFileSync(image)) }, initrd: { sha256: sha(readFileSync(initrd)) },
    sourceSha256: { "agent.go": "a".repeat(64), "go.mod": "a".repeat(64), init: "a".repeat(64),
      "platform_linux.go": "a".repeat(64), "platform_other.go": "a".repeat(64) }, agentSha256: "a".repeat(64),
    build: { GOOS: "linux", GOARCH: "arm64", CGO_ENABLED: "0", trimpath: true, go: "1.26.3" },
    developmentProfile: { name: "fixed-guest", hooksExecuted: false, versions: { gcc: "15.2.0-r5", python3: "3.14.8-r0" } },
    provenance: [{ component: "kernel", sha256: sha(readFileSync(image)) }] }));
  write(`${directory}/helper-manifest.json`, helper); write(`${directory}/guest-manifest.json`, guest);
  const manifest = createProductionVmRuntimeManifest(helper, guest);
  // Reach real production metadata admission before exercising packaging faults.
  validateProductionVmRuntimeManifest(manifest, helper, guest);
  write(`${directory}/runtime-manifest.json`, JSON.stringify(manifest));
  return { write, directory };
}

test("delivery closure requires companion resources and rejects altered VM bytes, metadata or executable mode", () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-delivery-contract-"));
  try {
    const f = assetsFixture(root);
    expect(validatePackagedRuntimeAssets(root, { platform: "darwin", arch: "arm64" })).toMatchObject({ executionVm: true, browserCompanion: ["chrome", "firefox"] });
    const kernel = join(root, "app", f.directory, "Image"), bytes = readFileSync(kernel);
    writeFileSync(kernel, "changed kernel");
    expect(() => validatePackagedRuntimeAssets(root, { platform: "darwin", arch: "arm64" })).toThrow("checksum mismatch");
    writeFileSync(kernel, bytes);
    const record = join(root, "app", f.directory, "runtime-manifest.json"), original = readFileSync(record);
    const changed = JSON.parse(original.toString()); changed.guest.kernelPath = "../other";
    writeFileSync(record, JSON.stringify(changed));
    expect(() => validatePackagedRuntimeAssets(root, { platform: "darwin", arch: "arm64" })).toThrow("metadata closure");
    writeFileSync(record, original);
    const executable = join(root, "app", f.directory, "nekodex-execution-vm-helper");
    chmodSync(executable, 0o644);
    expect(() => validatePackagedRuntimeAssets(root, { platform: "darwin", arch: "arm64" })).toThrow("not executable");
    chmodSync(executable, 0o755);
    rmSync(join(root, "app/browser-companion/firefox/session.js"));
    expect(() => validatePackagedRuntimeAssets(root, { platform: "darwin", arch: "arm64" })).toThrow();
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("delivery closure requires the desktop helper as its fixed bundle, not a bare executable", () => {
  const root = mkdtempSync(join(tmpdir(), "nekodex-delivery-desktop-"));
  try {
    assetsFixture(root);
    expect(DESKTOP_HELPER_EXECUTABLE_PATH).toBe("NEKODEX Desktop Helper.app/Contents/MacOS/nekodex-desktop-helper");
    for (const relative of [DESKTOP_HELPER_INFO_PLIST_PATH, DESKTOP_HELPER_EXECUTABLE_PATH]) {
      const target = join(root, "app/desktop-helper/darwin-arm64", relative), bytes = readFileSync(target);
      rmSync(target);
      expect(() => validatePackagedRuntimeAssets(root, { platform: "darwin", arch: "arm64" })).toThrow(relative.split("/").at(-1));
      writeFileSync(target, bytes);
    }
    writeFileSync(join(root, "app/desktop-helper/darwin-arm64/nekodex-desktop-helper"), "legacy bare layout");
    rmSync(join(root, "app/desktop-helper/darwin-arm64/NEKODEX Desktop Helper.app"), { recursive: true });
    expect(() => validatePackagedRuntimeAssets(root, { platform: "darwin", arch: "arm64" })).toThrow("NEKODEX Desktop Helper.app");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("delivery closure requires the ChatGPT page function, icons and the pinned Chrome manifest key", () => {
  // The gate and the store/runtime artifact list cannot drift apart.
  expect([...BROWSER_COMPANION_RESOURCES].sort()).toEqual([...BROWSER_COMPANION_FILES].sort());
  for (const missing of ["browser-companion/chatgpt.js", "browser-companion/firefox/chatgpt.js", "browser-companion/icons/icon-16.png", "browser-companion/firefox/icons/icon-128.png"]) {
    const root = mkdtempSync(join(tmpdir(), "nekodex-delivery-companion-"));
    try {
      assetsFixture(root);
      expect(validatePackagedRuntimeAssets(root, { platform: "darwin", arch: "arm64" })).toMatchObject({ browserCompanion: ["chrome", "firefox"] });
      rmSync(join(root, "app", missing));
      expect(() => validatePackagedRuntimeAssets(root, { platform: "darwin", arch: "arm64" })).toThrow(missing.split("/").at(-1));
    } finally { rmSync(root, { recursive: true, force: true }); }
  }
  const root = mkdtempSync(join(tmpdir(), "nekodex-delivery-companion-key-"));
  try {
    const f = assetsFixture(root);
    const manifest = JSON.parse(readFileSync(new URL("../browser-companion/manifest.json", import.meta.url), "utf8"));
    for (const changed of [{ ...manifest, key: undefined }, { ...manifest, key: Buffer.from("a".repeat(294)).toString("base64") }]) {
      f.write("browser-companion/manifest.json", JSON.stringify(changed));
      expect(() => validatePackagedRuntimeAssets(root, { platform: "darwin", arch: "arm64" })).toThrow("pinned extension ID");
    }
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("installed signature policy binds exact publisher and helper identity with no extra VM rights", () => {
  const identifier = "com.nekodex.execution-vm-helper";
  const signature = `Identifier=${identifier}\nCodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=1+1\nAuthority=Developer ID Application: NEKODEX (CNMWGJF2CG)\nTeamIdentifier=CNMWGJF2CG\nTimestamp=Oct 19, 2026\n`;
  expect(() => assertIdentity(signature, identifier)).not.toThrow();
  expect(() => assertIdentity(signature.replace("Identifier=com.nekodex.execution-vm-helper", "Identifier=other"), identifier)).toThrow("identifier mismatch");
  expect(() => assertIdentity(signature.replace("TeamIdentifier=CNMWGJF2CG", "TeamIdentifier=OTHERTEAM0"), identifier)).toThrow();
  expect(() => assertIdentity(signature + "Signature=adhoc\n", identifier)).toThrow();
  expect(() => assertIdentity(signature.replace("flags=0x10000(runtime)", "flags=0x0(none)"), identifier)).toThrow("hardened runtime");
  expect(() => assertVmEntitlements({ "com.apple.security.virtualization": true })).not.toThrow();
  expect(() => assertVmEntitlements({ "com.apple.security.virtualization": true, "com.apple.security.get-task-allow": true })).toThrow();
  expect(() => assertVmEntitlements({ "com.apple.security.virtualization": "true" })).toThrow();
  expect(() => assertVaultEntitlements({})).not.toThrow();
  expect(() => assertVaultEntitlements({ "com.apple.security.cs.allow-jit": true })).toThrow();
});
