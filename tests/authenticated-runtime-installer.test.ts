import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const version = JSON.parse(readFileSync(resolve("package.json"), "utf8")).version as string;
const documents = ["LICENSE", "Bun-1.4.0.md", "THIRD_PARTY_NOTICES.txt"];
const testOnUnix = test.skipIf(process.platform === "win32");

function snapshot(path: string): unknown {
  const info = lstatSync(path);
  if (info.isSymbolicLink()) return { link: readlinkSync(path) };
  if (info.isDirectory()) return Object.fromEntries(readdirSync(path).sort().map(name => [name, snapshot(join(path, name))]));
  return readFileSync(path).toString("base64");
}

function fixture(machine = "arm64", withNode = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "authenticated-installer-")));
  const commands = join(root, "commands");
  const assets = join(root, "release");
  const installation = join(root, "existing install");
  const bin = join(installation, "bin");
  const library = join(installation, "library");
  const docs = join(installation, "docs");
  const temporary = join(root, "temporary");
  const runtime = join(root, "archive");
  const target = join(library, version);
  for (const path of [commands, assets, bin, docs, target, temporary, join(runtime, "bin"), join(runtime, "runtime")]) mkdirSync(path, { recursive: true });
  const executable = (path: string, contents: string) => writeFileSync(path, contents, { mode: 0o755 });
  const realTar = Bun.which("tar")!;
  const realMv = Bun.which("mv")!;
  // The installer gets an isolated PATH: missing-node fixtures cannot accidentally
  // discover another system Node. Every download is handled by the local curl stub.
  for (const name of ["grep", "mktemp", "rm", "mkdir", "ln", "install", "touch", "cp", ...(withNode ? ["node"] : [])]) {
    const path = Bun.which(name);
    if (!path) throw new Error(`Installer fixture requires the preinstalled ${name}`);
    symlinkSync(path, join(commands, name));
  }
  executable(join(commands, "uname"), '#!/bin/sh\nif [ "$1" = "-s" ]; then printf "Darwin\\n"; else printf "%s\\n" "$INSTALLER_MACHINE"; fi\n');
  executable(join(commands, "curl"), `#!/bin/sh
set -eu
url=""; destination=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -o) shift; destination="$1" ;;
    https://*) url="$1" ;;
  esac
  shift
done
case "$url" in
  "https://github.com/Froraut/NEKODEX/releases/download/v$INSTALLER_VERSION/"*) ;;
  *) echo "Unexpected fixture download URL" >&2; exit 98 ;;
esac
name="\${url##*/}"
printf '%s\\n' "$name" >> "$INSTALLER_DOWNLOAD_LOG"
cp "$INSTALLER_ASSETS/$name" "$destination"
`);
  executable(join(commands, "tar"), '#!/bin/sh\nprintf "extract\\n" >> "$INSTALLER_TAR_LOG"\nexec "$INSTALLER_REAL_TAR" "$@"\n');
  executable(join(commands, "mv"), `#!/bin/sh
case "$1" in
  *.next) if [ "$2" = "\${INSTALLER_FAIL_MOVE:-}" ]; then exit 78; fi ;;
esac
exec "$INSTALLER_REAL_MV" "$@"
`);
  executable(join(runtime, "bin/codex-chatgpt-web"), `#!/bin/sh
printf '%s\\n' "$1" >> "$INSTALLER_EXECUTION_LOG"
if [ "$1" = "--version" ]; then printf '%s\\n' "\${INSTALLER_RUNTIME_VERSION:-$INSTALLER_VERSION}"; exit 0; fi
printf '%s\\n' "$@" > "$INSTALLER_SETUP_LOG"
`);
  executable(join(runtime, "runtime/bun"), "#!/bin/sh\nexit 0\n");
  const asset = `codex-chatgpt-web-darwin-${machine === "arm64" ? "arm64" : "amd64"}.tar.gz`;
  const packed = spawnSync(realTar, ["-czf", join(assets, asset), "-C", runtime, "."], { encoding: "utf8", timeout: 3_000 });
  if (packed.status !== 0) throw new Error(`Could not create local installer fixture: ${packed.stderr}`);
  for (const name of documents) {
    writeFileSync(join(assets, name), `Authenticated ${name}\n`);
    writeFileSync(join(docs, name), `Previous ${name}\n`);
  }
  writeFileSync(join(target, "existing-runtime"), "preserve existing runtime");
  writeFileSync(join(library, "another-version"), "preserve another version");
  writeFileSync(join(docs, "user-notes"), "preserve unrelated notes");
  writeFileSync(join(bin, "another-command"), "preserve unrelated command");
  symlinkSync(join(target, "existing-runtime"), join(bin, "codex-chatgpt-web"));

  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = createHash("sha256").update(publicKey.export({ type: "spki", format: "der" })).digest("hex");
  const now = Date.now();
  const payload = Buffer.from(JSON.stringify({ schemaVersion: 1, repository: "Froraut/NEKODEX", tag: `v${version}`, version,
    issuedAt: new Date(now - 60_000).toISOString(), expiresAt: new Date(now + 86_400_000).toISOString(),
    source: { commit: "a".repeat(40), workflow: ".github/workflows/release.yml", runId: "123", buildType: "github-actions" },
    assets: [asset, ...documents].map(name => { const bytes = readFileSync(join(assets, name)); return { name, size: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex") }; }),
  }));
  const envelope = { schemaVersion: 1, payload: payload.toString("base64"), signatures: [{ keyId,
    signature: sign(null, Buffer.concat([Buffer.from("codex-web-gpt.release.v1\0"), payload]), privateKey).toString("base64") }] };
  writeFileSync(join(assets, "release-metadata.json"), JSON.stringify(envelope));
  // Only a temporary, trusted fixture copy gets the test public key. The shipped
  // installer has no environment switch or download path that replaces its trust.
  const script = readFileSync(resolve("scripts/install.sh"), "utf8")
    .replace(/const keyId = "[a-f0-9]{64}";/, `const keyId = "${keyId}";`)
    .replace(/const publicKey = `-----BEGIN PUBLIC KEY-----[\s\S]*?-----END PUBLIC KEY-----\n`;/,
      `const publicKey = \`${publicKey.export({ type: "spki", format: "pem" })}\`;`)
    .replace(/const keyNotBefore = Date.parse\("[^"]+"\);/, `const keyNotBefore = Date.parse("${new Date(now - 86_400_000).toISOString()}");`)
    .replace(/const keyNotAfter = Date.parse\("[^"]+"\);/, `const keyNotAfter = Date.parse("${new Date(now + 2 * 86_400_000).toISOString()}");`);
  const installer = join(root, "install.sh");
  writeFileSync(installer, script);
  const downloadLog = join(root, "downloads");
  const tarLog = join(root, "extractions");
  const executionLog = join(root, "executions");
  const setupLog = join(root, "setup");
  const before = snapshot(installation);
  return { root, assets, asset, target, bin, docs, temporary, downloadLog, tarLog, executionLog, setupLog, envelope,
    run(extraEnv: Record<string, string> = {}, args: string[] = []) {
      return spawnSync("/bin/sh", [installer, ...args], { encoding: "utf8", timeout: 10_000, env: { ...process.env,
        PATH: commands, TMPDIR: temporary, CODEX_CHATGPT_WEB_VERSION: version, CODEX_CHATGPT_WEB_REPOSITORY: "Froraut/NEKODEX",
        CODEX_CHATGPT_WEB_LIB_DIR: library, CODEX_CHATGPT_WEB_BIN_DIR: bin, CODEX_CHATGPT_WEB_DOC_DIR: docs,
        INSTALLER_VERSION: version, INSTALLER_MACHINE: machine, INSTALLER_ASSETS: assets, INSTALLER_DOWNLOAD_LOG: downloadLog,
        INSTALLER_REAL_TAR: realTar, INSTALLER_REAL_MV: realMv, INSTALLER_TAR_LOG: tarLog,
        INSTALLER_EXECUTION_LOG: executionLog, INSTALLER_SETUP_LOG: setupLog,
        INSTALLER_RUNTIME_VERSION: version, INSTALLER_FAIL_MOVE: "", ...extraEnv,
      } });
    },
    assertPreserved() { expect(snapshot(installation)).toEqual(before); expect(readdirSync(temporary)).toEqual([]); },
    dispose() { rmSync(root, { recursive: true, force: true }); },
  };
}

for (const machine of ["arm64", "x86_64"]) {
  testOnUnix(`authenticated ${machine} runtime installs notices and forwards setup arguments`, () => {
    const f = fixture(machine);
    try {
      const result = f.run({}, ["--browser-only", "--acknowledge-unofficial", "--label", "with spaces"]);
      expect(result.status, result.stderr).toBe(0);
      expect(readlinkSync(join(f.bin, "codex-chatgpt-web"))).toBe(join(f.target, "bin/codex-chatgpt-web"));
      expect(readFileSync(f.setupLog, "utf8")).toBe("setup\n--browser-only\n--acknowledge-unofficial\n--label\nwith spaces\n");
      expect(readFileSync(f.executionLog, "utf8")).toBe("--version\nsetup\n");
      expect(readFileSync(f.tarLog, "utf8")).toBe("extract\n");
      expect(readFileSync(f.downloadLog, "utf8").trim().split("\n")).toEqual(["release-metadata.json", f.asset, ...documents]);
      for (const name of documents) expect(readFileSync(join(f.docs, name), "utf8")).toBe(`Authenticated ${name}\n`);
      expect(readFileSync(join(f.docs, "user-notes"), "utf8")).toBe("preserve unrelated notes");
      expect(readdirSync(f.temporary)).toEqual([]);
      expect(existsSync(join(f.target, "existing-runtime"))).toBe(false);
    } finally { f.dispose(); }
  });
}

for (const tampered of ["signature", "archive", ...documents]) {
  testOnUnix(`rejects tampered ${tampered} before extraction or execution and preserves the installation`, () => {
    const f = fixture();
    try {
      if (tampered === "signature") {
        const bytes = Buffer.from(f.envelope.signatures[0]!.signature, "base64"); bytes[0] = bytes[0]! ^ 1;
        f.envelope.signatures[0]!.signature = bytes.toString("base64");
        writeFileSync(join(f.assets, "release-metadata.json"), JSON.stringify(f.envelope));
      } else {
        const path = join(f.assets, tampered === "archive" ? f.asset : tampered);
        const bytes = readFileSync(path); bytes[0] = bytes[0]! ^ 1; writeFileSync(path, bytes);
      }
      const result = f.run();
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stderr).toContain(tampered === "signature" ? "signature does not match" : "checksum mismatch");
      expect(existsSync(f.tarLog)).toBe(false); expect(existsSync(f.executionLog)).toBe(false);
      f.assertPreserved();
    } finally { f.dispose(); }
  });
}

for (const invalid of ["repository override", "missing Node"]) {
  testOnUnix(`rejects ${invalid} before downloading and preserves the installation`, () => {
    const f = fixture("arm64", invalid !== "missing Node");
    try {
      const result = f.run(invalid === "repository override" ? { CODEX_CHATGPT_WEB_REPOSITORY: "attacker/NEKODEX" } : {});
      expect(result.status, result.stderr).not.toBe(0);
      expect(result.stderr).toContain(invalid === "repository override" ? "trusts releases from Froraut/NEKODEX only" : "preinstalled Node.js");
      expect(existsSync(f.downloadLog)).toBe(false); expect(existsSync(f.tarLog)).toBe(false); expect(existsSync(f.executionLog)).toBe(false);
      f.assertPreserved();
    } finally { f.dispose(); }
  });
}

testOnUnix("an authenticated runtime with the wrong version leaves the current installation intact", () => {
  const f = fixture();
  try {
    const result = f.run({ INSTALLER_RUNTIME_VERSION: "0.0.0" });
    expect(result.status, result.stderr).not.toBe(0);
    expect(result.stderr).toContain("Runtime archive version does not match");
    expect(readFileSync(f.executionLog, "utf8")).toBe("--version\n");
    f.assertPreserved();
  } finally { f.dispose(); }
});

testOnUnix("a failed notice replacement rolls back runtime, command and already replaced notices", () => {
  const f = fixture();
  try {
    const result = f.run({ INSTALLER_FAIL_MOVE: join(f.docs, "THIRD_PARTY_NOTICES.txt") });
    expect(result.status, result.stderr).toBe(78);
    f.assertPreserved();
  } finally { f.dispose(); }
});
