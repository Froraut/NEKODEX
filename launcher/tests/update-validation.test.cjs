const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { validateStagedApplication } = require("../electron/update-validation.cjs");

const expected = {
  version: "5.0.8-froraut.1",
  platform: "darwin",
  arch: "arm64",
  identity: "dev.codexwebgpt.launcher",
  productName: "Codex Web GPT",
  repository: "Froraut/NEKODEX",
};

function binary(platform, arch) {
  if (platform === "darwin") {
    const result = Buffer.alloc(128);
    result.writeUInt32LE(0xfeedfacf, 0);
    result.writeUInt32LE(arch === "arm64" ? 0x0100000c : 0x01000007, 4);
    result.writeUInt32LE(2, 12);
    result.writeUInt32LE(1, 16);
    result.writeUInt32LE(72, 20);
    result.writeUInt32LE(0x19, 32);
    result.writeUInt32LE(72, 36);
    result.writeBigUInt64LE(128n, 80);
    return result;
  }
  if (platform === "win32") {
    const result = Buffer.alloc(288);
    result.write("MZ");
    result.writeUInt32LE(64, 60);
    result.write("PE\0\0", 64);
    result.writeUInt16LE(arch === "arm64" ? 0xaa64 : 0x8664, 68);
    result.writeUInt16LE(1, 70);
    result.writeUInt16LE(112, 84);
    result.writeUInt16LE(2, 86);
    result.writeUInt16LE(0x20b, 88);
    result.writeUInt32LE(48, 216);
    result.writeUInt32LE(240, 220);
    return result;
  }
  const result = Buffer.alloc(128);
  result.write("\x7fELF");
  result[4] = 2;
  result[5] = 1;
  result[6] = 1;
  result.writeUInt16LE(3, 16);
  result.writeUInt16LE(arch === "arm64" ? 183 : 62, 18);
  result.writeUInt16LE(64, 52);
  result.writeBigUInt64LE(64n, 32);
  result.writeUInt16LE(56, 54);
  result.writeUInt16LE(1, 56);
  result.writeUInt32LE(1, 64);
  result.writeBigUInt64LE(128n, 96);
  result.writeBigUInt64LE(128n, 104);
  return result;
}

function write(file, contents) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, contents, { mode: 0o755 });
  return file;
}

function asarBuffer(header, data) {
  const json = Buffer.from(JSON.stringify(header));
  const headerSize = 8 + Math.ceil(json.length / 4) * 4;
  const result = Buffer.alloc(8 + headerSize);
  result.writeUInt32LE(4, 0);
  result.writeUInt32LE(headerSize, 4);
  result.writeUInt32LE(headerSize - 4, 8);
  result.writeUInt32LE(json.length, 12);
  json.copy(result, 16);
  return Buffer.concat([result, data]);
}

function fixture(t, options = {}) {
  const identity = { ...expected, ...options };
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-staged-validation-"));
  t.after(() => fs.rmSync(temporary, { recursive: true, force: true }));
  const root = path.join(temporary, identity.platform === "darwin" ? `${identity.productName}.app` : "staged");
  const resources = path.join(root, identity.platform === "darwin" ? "Contents/Resources" : "resources");
  const executable = path.join(root, identity.platform === "darwin" ? `Contents/MacOS/${identity.productName}`
    : identity.platform === "win32" ? `${identity.productName}.exe` : "codex-web-gpt-launcher");
  write(executable, binary(identity.platform, identity.arch));
  const plist = path.join(root, "Contents/Info.plist");
  if (identity.platform === "darwin") {
    write(plist, `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleIdentifier</key><string>${identity.identity}</string>
<key>CFBundleExecutable</key><string>${identity.productName}</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleVersion</key><string>5.0.8</string>
<key>ExampleNested</key><dict><key>Value</key><array><true/><integer>1</integer></array></dict>
</dict></plist>`);
  }
  const manifest = {
    name: "codex-web-gpt-launcher", version: identity.version, updateRepository: identity.repository,
    main: "electron/main.cjs",
  };
  const app = path.join(resources, "app");
  const manifestPath = write(path.join(app, "package.json"), JSON.stringify(manifest));
  write(path.join(app, "electron/main.cjs"), "throw new Error('Downloaded code must never execute');");
  write(path.join(app, "dist/index.html"), "<html>Launcher</html>");
  const runtime = path.join(resources, "runtime");
  const runtimeLauncher = `bin/codex-chatgpt-web${identity.platform === "win32" ? ".cmd" : ""}`;
  const runtimeManifest = {
    schemaVersion: 2, appVersion: identity.version, platform: identity.platform, arch: identity.arch,
    entrypoint: "app/cli.js", launcher: runtimeLauncher,
  };
  const runtimeManifestPath = write(path.join(runtime, "manifest.json"), JSON.stringify(runtimeManifest));
  for (const file of ["app/cli.js", "app/browser-helper.cjs", runtimeLauncher]) write(path.join(runtime, file), "required");
  const runtimeExecutable = write(path.join(runtime, `runtime/bun${identity.platform === "win32" ? ".exe" : ""}`), binary(identity.platform, identity.arch));
  const pack = (edit = () => {}) => {
    const contents = [Buffer.from(JSON.stringify(manifest)), Buffer.from("main"), Buffer.from("html")];
    const header = { files: {
      "package.json": { size: contents[0].length, offset: "0" },
      electron: { files: { "main.cjs": { size: contents[1].length, offset: String(contents[0].length) } } },
      dist: { files: { "index.html": { size: contents[2].length, offset: String(contents[0].length + contents[1].length) } } },
    } };
    edit(header);
    return write(path.join(resources, "app.asar"), asarBuffer(header, Buffer.concat(contents)));
  };
  return { temporary, root, resources, executable, plist, identity, manifest, manifestPath, app,
    runtime, runtimeExecutable, runtimeManifest, runtimeManifestPath, pack };
}

for (const platform of ["darwin", "win32", "linux"]) {
  for (const arch of ["arm64", "x64"]) {
    test(`validates ${platform}/${arch} without executing staged code`, t => {
      const app = fixture(t, { platform, arch });
      const result = validateStagedApplication(app.root, app.identity);
      assert.equal(result.executable, fs.realpathSync(app.executable));
      assert.equal(result.runtimeExecutable, fs.realpathSync(app.runtimeExecutable));
      assert.equal(result.version, app.identity.version);
      app.pack();
      fs.rmSync(app.app, { recursive: true });
      assert.equal(validateStagedApplication(app.root, app.identity).platform, platform);
    });
  }
}

test("rejects application version, name, repository and main mismatches", t => {
  const app = fixture(t);
  for (const [field, value] of Object.entries({ version: "5.0.7", name: "another-launcher", updateRepository: "upstream/repo", main: "electron/other.cjs" })) {
    const changed = { ...app.manifest, [field]: value };
    if (field === "main") write(path.join(app.app, value), "other");
    fs.writeFileSync(app.manifestPath, JSON.stringify(changed));
    assert.throws(() => validateStagedApplication(app.root, app.identity), /package identity mismatch/);
  }
  fs.writeFileSync(app.manifestPath, JSON.stringify(app.manifest));
  app.manifest.version = "5.0.1";
  app.pack();
  assert.throws(() => validateStagedApplication(app.root, app.identity), /package identity mismatch/);
});

test("rejects mismatched macOS top-level identity, duplicate keys and entity declarations", t => {
  const app = fixture(t);
  const original = fs.readFileSync(app.plist, "utf8");
  const variants = [
    original.replace(app.identity.identity, "dev.other.launcher"),
    original.replace(`<string>${app.identity.productName}</string>`, "<string>Other App</string>"),
    original.replace("<string>APPL</string>", "<string>BNDL</string>"),
    original.replace("</dict></plist>", `<key>CFBundleIdentifier</key><string>${app.identity.identity}</string></dict></plist>`),
    original.replace(`<key>CFBundleIdentifier</key><string>${app.identity.identity}</string>`, `<key>Nested</key><dict><key>CFBundleIdentifier</key><string>${app.identity.identity}</string></dict>`),
    original.replace("<!DOCTYPE plist", "<!DOCTYPE plist [<!ENTITY injected 'other'>] "),
    original.replace("dev.codexwebgpt.launcher", "dev.&injected;.launcher"),
  ];
  for (const content of variants) {
    fs.writeFileSync(app.plist, content);
    assert.throws(() => validateStagedApplication(app.root, app.identity), /bundle identity mismatch|Info.plist/);
  }
  fs.writeFileSync(app.plist, original.replace("Codex Web GPT", "Codex&#32;Web GPT"));
  assert.equal(validateStagedApplication(app.root, app.identity).identity, expected.identity);
});

test("rejects wrong platform and architecture in both launcher and Bun", t => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const app = fixture(t, { platform, arch: "x64" });
    for (const file of [app.executable, app.runtimeExecutable]) {
      fs.writeFileSync(file, binary(platform, "arm64"));
      assert.throws(() => validateStagedApplication(app.root, app.identity), /platform\/architecture mismatch/);
      fs.writeFileSync(file, binary(platform === "darwin" ? "linux" : "darwin", "x64"));
      assert.throws(() => validateStagedApplication(app.root, app.identity), /platform\/architecture mismatch/);
      fs.writeFileSync(file, binary(platform, "x64"));
    }
  }
});

test("rejects truncated and malformed native executable headers", t => {
  const app = fixture(t);
  const peOffset = binary("win32", "x64");
  peOffset.writeUInt32LE(0xffffffff, 60);
  const peSize = binary("win32", "x64");
  peSize.writeUInt16LE(4000, 84);
  const machCommands = binary("darwin", "arm64");
  machCommands.writeUInt32LE(0xffffffff, 20);
  const elfClass = binary("linux", "x64");
  elfClass[4] = 1;
  for (const content of [Buffer.from("#! /bin/sh\necho fake"), Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), peOffset, peSize, machCommands, elfClass]) {
    fs.writeFileSync(app.executable, content);
    assert.throws(() => validateStagedApplication(app.root, app.identity), /unrecognized platform|bounds|header/);
  }
});

test("rejects native program tables and loadable ranges extending past EOF", t => {
  const app = fixture(t);
  const malformed = [];
  const machTable = binary("darwin", "arm64");
  machTable.writeUInt32LE(0, 20);
  malformed.push(machTable);
  const machSegment = binary("darwin", "arm64");
  machSegment.writeBigUInt64LE(4096n, 72);
  malformed.push(machSegment);
  const peSegment = binary("win32", "x64");
  peSegment.writeUInt32LE(8192, 216);
  peSegment.writeUInt32LE(4096, 220);
  malformed.push(peSegment);
  const elfTable = binary("linux", "x64");
  elfTable.writeBigUInt64LE(4096n, 32);
  malformed.push(elfTable);
  const elfSegment = binary("linux", "x64");
  elfSegment.writeBigUInt64LE(8192n, 96);
  malformed.push(elfSegment);
  for (const contents of malformed) {
    fs.writeFileSync(app.executable, contents);
    assert.throws(() => validateStagedApplication(app.root, app.identity), /bounds/);
  }
});

test("validates universal Mach-O slices and rejects forged or overlapping slice tables", t => {
  const app = fixture(t);
  const fat = Buffer.alloc(320);
  fat.writeUInt32BE(0xcafebabe, 0);
  fat.writeUInt32BE(2, 4);
  for (const [index, arch] of ["x64", "arm64"].entries()) {
    const offset = 64 + 128 * index;
    fat.writeUInt32BE(arch === "x64" ? 0x01000007 : 0x0100000c, 8 + index * 20);
    fat.writeUInt32BE(offset, 16 + index * 20);
    fat.writeUInt32BE(128, 20 + index * 20);
    binary("darwin", arch).copy(fat, offset);
  }
  fs.writeFileSync(app.executable, fat);
  assert.equal(validateStagedApplication(app.root, app.identity).arch, "arm64");
  const forged = Buffer.from(fat);
  forged.writeUInt32BE(0x01000007, 28);
  fs.writeFileSync(app.executable, forged);
  assert.throws(() => validateStagedApplication(app.root, app.identity), /architecture table/);
  const overlap = Buffer.from(fat);
  overlap.writeUInt32BE(64, 36);
  fs.writeFileSync(app.executable, overlap);
  assert.throws(() => validateStagedApplication(app.root, app.identity), /slice bounds/);
});

test("requires runtime identity and essential resources", t => {
  const app = fixture(t);
  for (const [key, value] of Object.entries({ appVersion: "1.0.0", platform: "linux", arch: "x64", launcher: "../bun", entrypoint: "other.js" })) {
    fs.writeFileSync(app.runtimeManifestPath, JSON.stringify({ ...app.runtimeManifest, [key]: value }));
    assert.throws(() => validateStagedApplication(app.root, app.identity), /runtime manifest identity mismatch/);
  }
  fs.writeFileSync(app.runtimeManifestPath, JSON.stringify(app.runtimeManifest));
  for (const file of ["app/cli.js", "app/browser-helper.cjs", "bin/codex-chatgpt-web", "runtime/bun", "manifest.json"]) {
    const location = path.join(app.runtime, file);
    fs.renameSync(location, `${location}.saved`);
    assert.throws(() => validateStagedApplication(app.root, app.identity), /missing required/);
    fs.renameSync(`${location}.saved`, location);
  }
  fs.renameSync(app.resources, `${app.resources}.saved`);
  assert.throws(() => validateStagedApplication(app.root, app.identity), /missing required directory/);
});

test("rejects escaped symlinks for essential files, directories and archive entries", { skip: process.platform === "win32" }, t => {
  const app = fixture(t);
  const outside = write(path.join(app.temporary, "outside.json"), JSON.stringify(app.manifest));
  fs.rmSync(app.manifestPath);
  fs.symlinkSync(outside, app.manifestPath);
  assert.throws(() => validateStagedApplication(app.root, app.identity), /symlink escapes/);
  fs.rmSync(app.manifestPath);
  write(app.manifestPath, JSON.stringify(app.manifest));
  fs.renameSync(app.runtime, `${app.temporary}/outside-runtime`);
  fs.symlinkSync(`${app.temporary}/outside-runtime`, app.runtime, "dir");
  assert.throws(() => validateStagedApplication(app.root, app.identity), /symlink escapes/);
  fs.rmSync(app.runtime);
  fs.renameSync(`${app.temporary}/outside-runtime`, app.runtime);
  const archive = app.pack(header => { header.files["package.json"].unpacked = true; });
  write(`${archive}.unpacked/package.json`, JSON.stringify(app.manifest));
  assert.equal(validateStagedApplication(app.root, app.identity).version, expected.version);
  fs.rmSync(`${archive}.unpacked/package.json`);
  fs.symlinkSync(outside, `${archive}.unpacked/package.json`);
  assert.throws(() => validateStagedApplication(app.root, app.identity), /symlink escapes/);
  const alias = path.join(app.temporary, "alias.app");
  fs.symlinkSync(app.root, alias, "dir");
  assert.throws(() => validateStagedApplication(alias, app.identity), /real directory/);
});

test("rejects malicious ASAR paths, links, offsets, sizes and truncation", t => {
  const app = fixture(t);
  const mutate = [
    header => { header.files["../package.json"] = header.files["package.json"]; },
    header => { header.files["/escape"] = { size: 1, offset: "0" }; },
    header => { header.files["C:\\escape"] = { size: 1, offset: "0" }; },
    header => { header.files["package.json"] = { link: "../../outside.json" }; },
    header => { header.files["package.json"].offset = "-1"; },
    header => { header.files["package.json"].offset = "0trailing"; },
    header => { header.files["package.json"].offset = "9007199254740993"; },
    header => { header.files["package.json"].offset = "999999"; },
    header => { header.files["package.json"].size = -1; },
    header => { header.files["package.json"].size = 999999; },
    header => { header.files["package.json"].unpacked = "false"; },
    header => { delete header.files.electron; },
    header => { header.files = []; },
  ];
  for (const edit of mutate) {
    app.pack(edit);
    assert.throws(() => validateStagedApplication(app.root, app.identity), /ASAR|unsafe package path/);
  }
  const archive = app.pack();
  const original = fs.readFileSync(archive);
  for (const [offset, value] of [[0, 8], [4, 0xffffffff], [8, 1], [12, 0xffffffff]]) {
    const malformed = Buffer.from(original);
    malformed.writeUInt32LE(value, offset);
    fs.writeFileSync(archive, malformed);
    assert.throws(() => validateStagedApplication(app.root, app.identity), /ASAR header bounds/);
  }
  for (const size of [1, 15, original.length - 1]) {
    fs.writeFileSync(archive, original.subarray(0, size));
    assert.throws(() => validateStagedApplication(app.root, app.identity), /bounds/);
  }
});

test("ignores inherited-looking ASAR names and bounds deeply nested directories", t => {
  const app = fixture(t);
  app.pack(header => {
    header.files.constructor = { size: 1, offset: "0" };
    header.files.toString = { size: 1, offset: "0" };
  });
  assert.equal(validateStagedApplication(app.root, app.identity).version, expected.version);
  app.pack(header => {
    let files = header.files;
    for (let index = 0; index < 66; index += 1) {
      files.nested = { files: {} };
      files = files.nested.files;
    }
  });
  assert.throws(() => validateStagedApplication(app.root, app.identity), /too deep/);
});

test("fails closed on malformed expected identity and oversized metadata", t => {
  const app = fixture(t);
  for (const change of [{ version: "latest" }, { platform: "freebsd" }, { arch: "ia32" }, { identity: "" }, { repository: "../other" }, { productName: "../other" }]) {
    assert.throws(() => validateStagedApplication(app.root, { ...app.identity, ...change }), /validation failed/);
  }
  fs.writeFileSync(app.manifestPath, " ".repeat(1024 * 1024 + 1));
  assert.throws(() => validateStagedApplication(app.root, app.identity), /size limit/);
});

test("requires packaged main and renderer files and rejects traversing entrypoints", t => {
  const app = fixture(t);
  for (const relative of ["electron/main.cjs", "dist/index.html"]) {
    const file = path.join(app.app, relative);
    fs.renameSync(file, `${file}.saved`);
    assert.throws(() => validateStagedApplication(app.root, app.identity), /missing required/);
    fs.renameSync(`${file}.saved`, file);
  }
  fs.writeFileSync(app.manifestPath, JSON.stringify({ ...app.manifest, main: "../outside.cjs" }));
  assert.throws(() => validateStagedApplication(app.root, app.identity), /unsafe package path/);
  fs.writeFileSync(app.manifestPath, JSON.stringify(app.manifest));
  app.pack(header => { header.files.dist.files["index.html"].size = 0; });
  assert.throws(() => validateStagedApplication(app.root, app.identity), /ASAR is missing required file/);
});

test("copied validation helper works without the original application or node_modules", t => {
  const app = fixture(t, { platform: "linux", arch: "x64" });
  const helper = path.join(app.temporary, "worker", "update-validation.cjs");
  write(helper, fs.readFileSync(path.join(__dirname, "../electron/update-validation.cjs")));
  const script = 'const helper=require(process.argv[1]); const result=helper.validateStagedApplication(process.argv[2], JSON.parse(process.argv[3])); console.log(result.version);';
  const result = spawnSync(process.execPath, ["-e", script, helper, app.root, JSON.stringify(app.identity)], {
    cwd: app.temporary, encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), expected.version);
});

test("reads raw ASAR bytes inside Electron with ASAR virtualization enabled", t => {
  let electron;
  try { electron = require("electron"); } catch { t.skip("Electron development dependency is not installed"); return; }
  const app = fixture(t, { platform: "linux", arch: "x64" });
  app.pack();
  fs.rmSync(app.app, { recursive: true });
  const helper = path.join(__dirname, "../electron/update-validation.cjs");
  const script = [
    'if (!process.versions.electron || process.noAsar) throw new Error("Test requires Electron ASAR virtualization");',
    'const helper=require(process.argv[1]);',
    'const result=helper.validateStagedApplication(process.argv[2], JSON.parse(process.argv[3]));',
    'console.log(result.version);',
  ].join("\n");
  const result = spawnSync(electron, ["-e", script, helper, app.root, JSON.stringify(app.identity)], {
    cwd: app.temporary, encoding: "utf8", timeout: 10_000,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), expected.version);
});
