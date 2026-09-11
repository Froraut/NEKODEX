// Electron virtualizes ASAR paths even in node:fs. Its original-fs built-in
// exposes the archive bytes; standalone recovery under Bun/Node uses native fs.
const fs = process.versions.electron ? require("original-fs") : require("node:fs");
const path = require("node:path");

const MAX_METADATA_BYTES = 1024 * 1024;
const MAX_ASAR_HEADER_BYTES = 16 * 1024 * 1024;
const MAX_ASAR_ENTRIES = 100_000;

function fail(message) {
  throw new Error(`Staged update validation failed: ${message}`);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safePath(value) {
  if (typeof value !== "string" || !value || value.length > 4096
    || /[\\:\x00-\x1f]/.test(value)
    || value.split("/").some(part => !part || part === "." || part === "..")) {
    fail("unsafe package path");
  }
  return value;
}

function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

// Check every ancestor too: an essential directory must not resolve outside the
// staged tree even if a later symlink happens to point back into it.
function containedPath(root, relative, kind = "file") {
  safePath(relative);
  let current = root;
  for (const part of relative.split("/")) {
    current = path.join(current, part);
    let real;
    try { real = fs.realpathSync(current); } catch { fail(`missing required ${kind}: ${relative}`); }
    if (!inside(root, real)) fail(`symlink escapes the application: ${relative}`);
  }
  const metadata = fs.statSync(current);
  if (kind === "directory" ? !metadata.isDirectory() : !metadata.isFile() || metadata.size === 0) {
    fail(`invalid required ${kind}: ${relative}`);
  }
  return current;
}

function readAt(fd, size, offset, total) {
  if (!Number.isSafeInteger(size) || size < 0 || !Number.isSafeInteger(offset) || offset < 0
    || offset > total || size > total - offset) fail("file bounds are invalid");
  const buffer = Buffer.alloc(size);
  let count = 0;
  while (count < size) {
    const received = fs.readSync(fd, buffer, count, size - count, offset + count);
    if (!received) fail("file was truncated while reading");
    count += received;
  }
  return buffer;
}

function readBounded(file, limit = MAX_METADATA_BYTES) {
  const fd = fs.openSync(file, "r");
  try {
    const metadata = fs.fstatSync(fd);
    if (!metadata.isFile() || metadata.size < 1 || metadata.size > limit) fail("metadata exceeds its size limit");
    return readAt(fd, metadata.size, 0, metadata.size);
  } finally { fs.closeSync(fd); }
}

function parseJson(buffer, label) {
  let value;
  try { value = JSON.parse(buffer.toString("utf8")); } catch { fail(`${label} is not valid JSON`); }
  if (!record(value)) fail(`${label} is not an object`);
  return value;
}

function readAsar(root, relative) {
  const file = containedPath(root, relative);
  const fd = fs.openSync(file, "r");
  try {
    const total = fs.fstatSync(fd).size;
    const prefix = readAt(fd, 16, 0, total);
    const headerSize = prefix.readUInt32LE(4);
    const payloadSize = prefix.readUInt32LE(8);
    const jsonSize = prefix.readUInt32LE(12);
    // ASAR uses two Chromium Pickles: a uint32 header size, then a JSON string.
    if (prefix.readUInt32LE(0) !== 4 || headerSize < 8 || headerSize > MAX_ASAR_HEADER_BYTES
      || headerSize % 4 !== 0 || payloadSize !== headerSize - 4 || jsonSize < 2
      || jsonSize > headerSize - 8 || headerSize - 8 - jsonSize > 3
      || headerSize > total - 8) fail("ASAR header bounds are invalid");
    const header = parseJson(readAt(fd, jsonSize, 16, total), "ASAR header");
    const dataStart = 8 + headerSize;
    const files = new Map();
    const stack = [{ node: header, prefix: "", depth: 0 }];
    let count = 0;
    while (stack.length) {
      const item = stack.pop();
      if (!record(item.node.files) || item.depth > 64) fail("ASAR directory is invalid or too deep");
      for (const [name, entry] of Object.entries(item.node.files)) {
        if (++count > MAX_ASAR_ENTRIES) fail("ASAR contains too many entries");
        safePath(name);
        if (name.includes("/") || !record(entry)) fail("ASAR entry is invalid");
        const relativePath = item.prefix ? `${item.prefix}/${name}` : name;
        safePath(relativePath);
        if (Object.hasOwn(entry, "link")) fail("ASAR symbolic links are not permitted");
        if (Object.hasOwn(entry, "files")) {
          stack.push({ node: entry, prefix: relativePath, depth: item.depth + 1 });
          continue;
        }
        if (!Number.isSafeInteger(entry.size) || entry.size < 0) fail("ASAR file size is invalid");
        if (entry.unpacked !== undefined && typeof entry.unpacked !== "boolean") fail("ASAR unpacked flag is invalid");
        if (!entry.unpacked) {
          if (typeof entry.offset !== "string" || !/^(0|[1-9][0-9]*)$/.test(entry.offset)) fail("ASAR file offset is invalid");
          const offset = Number(entry.offset);
          if (!Number.isSafeInteger(offset) || offset > total - dataStart
            || entry.size > total - dataStart - offset) fail("ASAR file bounds are invalid");
        }
        files.set(relativePath, entry);
      }
    }
    const read = (name, limit = MAX_METADATA_BYTES) => {
      safePath(name);
      const entry = files.get(name);
      if (!entry || !entry.size) fail(`ASAR is missing required file: ${name}`);
      if (entry.size > limit) fail(`ASAR required file exceeds its size limit: ${name}`);
      if (entry.unpacked) {
        const unpacked = containedPath(root, `${relative}.unpacked/${name}`);
        if (fs.statSync(unpacked).size !== entry.size) fail(`ASAR unpacked file size mismatch: ${name}`);
        return readBounded(unpacked, limit);
      }
      return readAt(fd, entry.size, dataStart + Number(entry.offset), total);
    };
    const manifest = parseJson(read("package.json"), "application package.json");
    // Only inspect presence/bounds for application code; never load or execute it.
    for (const name of [safePath(manifest.main), "dist/index.html"]) {
      const entry = files.get(name);
      if (!entry || !entry.size) fail(`ASAR is missing required file: ${name}`);
      if (entry.unpacked) {
        const unpacked = containedPath(root, `${relative}.unpacked/${name}`);
        if (fs.statSync(unpacked).size !== entry.size) fail(`ASAR unpacked file size mismatch: ${name}`);
      }
    }
    return manifest;
  } finally { fs.closeSync(fd); }
}

function decodeXml(value) {
  return value.replace(/&([^;]*);/g, (_match, entity) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (Object.hasOwn(named, entity)) return named[entity];
    if (!/^#(?:[0-9]+|x[0-9a-fA-F]+)$/.test(entity)) fail("Info.plist contains an unsupported XML entity");
    const point = entity[1] === "x" ? Number.parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(point) || point < 0x20 || point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff)) {
      fail("Info.plist contains an invalid XML character");
    }
    return String.fromCodePoint(point);
  });
}

// Parse the bounded XML tree, so nested or duplicate dictionary keys cannot
// impersonate the application's top-level bundle identity. No DTD is evaluated.
function readPlist(file) {
  const xml = readBounded(file).toString("utf8");
  const tokens = xml.match(/<!--[\s\S]*?-->|<\?xml[^?]*\?>|<!DOCTYPE[^>]*>|<[^>]*>|[^<]+/g) || [];
  if (tokens.join("") !== xml || tokens.length > 20_000) fail("Info.plist XML is invalid or too large");
  const document = { tag: "document", children: [], text: "" };
  const stack = [document];
  for (const token of tokens) {
    if (token.startsWith("<!--") || token.startsWith("<?xml")) continue;
    if (token.startsWith("<!DOCTYPE")) {
      if (stack.length !== 1 || !/^<!DOCTYPE\s+plist\s+PUBLIC\s+"[^"[<>]*"\s+"[^"[<>]*"\s*>$/.test(token)) {
        fail("Info.plist DTD declarations are not supported");
      }
      continue;
    }
    if (token.startsWith("</")) {
      if (stack.length === 1 || token !== `</${stack.pop().tag}>`) fail("Info.plist XML closing tag is invalid");
    } else if (token.startsWith("<")) {
      const match = /^<(plist|dict|array|key|string|integer|real|data|date|true|false)(?:\s+version="1\.0")?\s*(\/?)>$/.exec(token);
      if (!match || stack.length > 64) fail("Info.plist XML element is invalid");
      const child = { tag: match[1], children: [], text: "" };
      stack[stack.length - 1].children.push(child);
      if (!match[2]) stack.push(child);
    } else {
      if (/&(?!amp;|lt;|gt;|quot;|apos;|#(?:[0-9]+|x[0-9a-fA-F]+);)/.test(token)) fail("Info.plist XML entity is invalid");
      stack[stack.length - 1].text += decodeXml(token);
    }
  }
  const plist = document.children[0];
  const dict = plist?.children[0];
  if (stack.length !== 1 || document.text.trim() || document.children.length !== 1 || plist.tag !== "plist"
    || plist.text.trim() || plist.children.length !== 1 || dict.tag !== "dict" || dict.text.trim()
    || dict.children.length % 2) fail("Info.plist does not contain one application dictionary");
  const result = Object.create(null);
  for (let index = 0; index < dict.children.length; index += 2) {
    const key = dict.children[index];
    const value = dict.children[index + 1];
    if (key.tag !== "key" || key.children.length || Object.hasOwn(result, key.text)) fail("Info.plist contains an invalid or duplicate key");
    result[key.text] = value.tag === "string" && value.children.length === 0 ? value.text : null;
  }
  return result;
}

function nativeIdentity(file) {
  const fd = fs.openSync(file, "r");
  try {
    const total = fs.fstatSync(fd).size;
    const head = readAt(fd, Math.min(total, 64), 0, total);
    if (head.length < 4) fail("native executable header is truncated");
    const mach = (offset, size) => {
      const header = readAt(fd, 32, offset, total);
      const magic = header.readUInt32BE(0);
      if (![0xcffaedfe, 0xfeedfacf].includes(magic) || size < 32) fail("Mach-O executable header is invalid");
      const read = magic === 0xcffaedfe ? at => header.readUInt32LE(at) : at => header.readUInt32BE(at);
      const cpu = read(4);
      const commandCount = read(16);
      const commandBytes = read(20);
      if (read(12) !== 2 || !commandCount || commandCount > 65536 || commandCount * 8 > commandBytes
        || commandBytes > size - 32 || commandBytes > MAX_ASAR_HEADER_BYTES) fail("Mach-O executable bounds or type are invalid");
      const commands = readAt(fd, commandBytes, offset + 32, total);
      const read32 = at => magic === 0xcffaedfe ? commands.readUInt32LE(at) : commands.readUInt32BE(at);
      const read64 = at => Number(magic === 0xcffaedfe ? commands.readBigUInt64LE(at) : commands.readBigUInt64BE(at));
      let cursor = 0;
      let hasSegment = false;
      for (let index = 0; index < commandCount; index += 1) {
        if (cursor + 8 > commandBytes) fail("Mach-O load-command bounds are invalid");
        const command = read32(cursor);
        const length = read32(cursor + 4);
        if (length < 8 || length % 4 || length > commandBytes - cursor) fail("Mach-O load-command bounds are invalid");
        if (command === 0x19) {
          if (length < 72 || read32(cursor + 64) * 80 > length - 72) fail("Mach-O segment header is invalid");
          const fileOffset = read64(cursor + 40);
          const fileSize = read64(cursor + 48);
          if (!Number.isSafeInteger(fileOffset) || !Number.isSafeInteger(fileSize)
            || fileOffset > size || fileSize > size - fileOffset) fail("Mach-O segment file bounds are invalid");
          if (fileSize) hasSegment = true;
        }
        cursor += length;
      }
      if (cursor !== commandBytes || !hasSegment) fail("Mach-O executable has no valid loadable segment");
      return cpu === 0x01000007 ? "x64" : cpu === 0x0100000c ? "arm64" : "unknown";
    };
    const magic = head.readUInt32BE(0);
    if ([0xcffaedfe, 0xfeedfacf].includes(magic)) return { platform: "darwin", arches: [mach(0, total)] };
    if ([0xcafebabe, 0xcafebabf, 0xbebafeca, 0xbfbafeca].includes(magic)) {
      if (head.length < 8) fail("Mach-O universal header is truncated");
      const little = [0xbebafeca, 0xbfbafeca].includes(magic);
      const wide = [0xcafebabf, 0xbfbafeca].includes(magic);
      const count = little ? head.readUInt32LE(4) : head.readUInt32BE(4);
      if (!count || count > 16) fail("Mach-O universal architecture count is invalid");
      const stride = wide ? 32 : 20;
      const table = readAt(fd, count * stride, 8, total);
      const read32 = at => little ? table.readUInt32LE(at) : table.readUInt32BE(at);
      const read64 = at => Number(little ? table.readBigUInt64LE(at) : table.readBigUInt64BE(at));
      const arches = [];
      const spans = [];
      for (let index = 0; index < count; index += 1) {
        const start = index * stride;
        const offset = wide ? read64(start + 8) : read32(start + 8);
        const size = wide ? read64(start + 16) : read32(start + 12);
        if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(size) || offset < 8 + table.length
          || size < 32 || offset > total || size > total - offset
          || spans.some(span => offset < span.end && offset + size > span.start)) fail("Mach-O universal slice bounds are invalid");
        const arch = mach(offset, size);
        const declared = read32(start) === 0x01000007 ? "x64" : read32(start) === 0x0100000c ? "arm64" : "unknown";
        if (arch !== declared || arches.includes(arch)) fail("Mach-O universal architecture table is invalid");
        arches.push(arch);
        spans.push({ start: offset, end: offset + size });
      }
      return { platform: "darwin", arches };
    }
    if (head[0] === 0x4d && head[1] === 0x5a) {
      if (head.length < 64) fail("PE executable header is truncated");
      const offset = head.readUInt32LE(60);
      if (offset < 64 || offset > 1024 * 1024) fail("PE executable header offset is invalid");
      const pe = readAt(fd, 26, offset, total);
      const optionalSize = pe.readUInt16LE(20);
      const sections = pe.readUInt16LE(6);
      const characteristics = pe.readUInt16LE(22);
      if (pe.readUInt32LE(0) !== 0x00004550 || pe.readUInt16LE(24) !== 0x20b
        || optionalSize < 112 || optionalSize > 4096 || !sections || sections > 96
        || offset + 24 + optionalSize + sections * 40 > total
        || !(characteristics & 2) || (characteristics & 0x2000)) fail("PE executable header is invalid");
      const table = readAt(fd, sections * 40, offset + 24 + optionalSize, total);
      for (let index = 0; index < sections; index += 1) {
        const size = table.readUInt32LE(index * 40 + 16);
        const fileOffset = table.readUInt32LE(index * 40 + 20);
        if (size && (fileOffset > total || size > total - fileOffset)) fail("PE section file bounds are invalid");
      }
      const cpu = pe.readUInt16LE(4);
      return { platform: "win32", arches: [cpu === 0x8664 ? "x64" : cpu === 0xaa64 ? "arm64" : "unknown"] };
    }
    if (magic === 0x7f454c46) {
      if (head.length < 64 || head[4] !== 2 || ![1, 2].includes(head[5]) || head[6] !== 1) fail("ELF executable header is invalid");
      const read = head[5] === 1 ? at => head.readUInt16LE(at) : at => head.readUInt16BE(at);
      if (![2, 3].includes(read(16)) || read(52) !== 64) fail("ELF executable type is invalid");
      const offset = Number(head[5] === 1 ? head.readBigUInt64LE(32) : head.readBigUInt64BE(32));
      const count = read(56);
      if (!count || count > 4096 || read(54) !== 56 || offset < 64) fail("ELF program header is invalid");
      const table = readAt(fd, count * 56, offset, total);
      const read32 = at => head[5] === 1 ? table.readUInt32LE(at) : table.readUInt32BE(at);
      const read64 = at => Number(head[5] === 1 ? table.readBigUInt64LE(at) : table.readBigUInt64BE(at));
      let hasSegment = false;
      for (let index = 0; index < count; index += 1) {
        const fileOffset = read64(index * 56 + 8);
        const fileSize = read64(index * 56 + 32);
        if (!Number.isSafeInteger(fileOffset) || !Number.isSafeInteger(fileSize)
          || fileOffset > total || fileSize > total - fileOffset) fail("ELF segment file bounds are invalid");
        if (read32(index * 56) === 1 && fileSize) {
          if (read64(index * 56 + 40) < fileSize) fail("ELF loadable segment size is invalid");
          hasSegment = true;
        }
      }
      if (!hasSegment) fail("ELF executable has no loadable segment");
      const cpu = read(18);
      return { platform: "linux", arches: [cpu === 62 ? "x64" : cpu === 183 ? "arm64" : "unknown"] };
    }
    fail("native executable has an unrecognized platform");
  } finally { fs.closeSync(fd); }
}

function validateExecutable(file, platform, arch) {
  const actual = nativeIdentity(file);
  if (actual.platform !== platform || !actual.arches.includes(arch)) {
    fail(`executable platform/architecture mismatch: expected ${platform}/${arch}, received ${actual.platform}/${actual.arches.join(",")}`);
  }
  if (platform !== "win32" && process.platform !== "win32" && !(fs.statSync(file).mode & 0o111)) {
    fail("native executable is not executable");
  }
}

function validateStagedApplication(root, {
  version, platform, arch, identity, productName, repository, packageName = "codex-web-gpt-launcher",
} = {}) {
  if (!/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version || "")
    || !["darwin", "win32", "linux"].includes(platform) || !["x64", "arm64"].includes(arch)
    || typeof identity !== "string" || !identity || typeof repository !== "string"
    || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(repository)) {
    fail("expected application identity is invalid");
  }
  for (const name of [productName, packageName]) {
    safePath(name);
    if (name.includes("/")) fail("expected application name is invalid");
  }
  if (typeof root !== "string" || !path.isAbsolute(root)) fail("application root must be absolute");
  let canonicalRoot;
  try {
    if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) fail("application root must be a real directory");
    canonicalRoot = fs.realpathSync(root);
  } catch (error) {
    if (error.message.startsWith("Staged update")) throw error;
    fail("application root is missing");
  }
  const resourcesRelative = platform === "darwin" ? "Contents/Resources" : "resources";
  const resources = containedPath(canonicalRoot, resourcesRelative, "directory");
  let executableRelative;
  if (platform === "darwin") {
    const plist = readPlist(containedPath(canonicalRoot, "Contents/Info.plist"));
    if (plist.CFBundleIdentifier !== identity || plist.CFBundleExecutable !== productName
      || plist.CFBundlePackageType !== "APPL") fail("macOS bundle identity mismatch");
    executableRelative = `Contents/MacOS/${productName}`;
  } else {
    executableRelative = platform === "win32" ? `${productName}.exe` : packageName.toLowerCase();
  }
  const executable = containedPath(canonicalRoot, executableRelative);
  validateExecutable(executable, platform, arch);
  const asarRelative = `${resourcesRelative}/app.asar`;
  let hasAsar;
  try { fs.lstatSync(path.join(canonicalRoot, asarRelative)); hasAsar = true; } catch (error) {
    if (error.code !== "ENOENT") throw error;
    hasAsar = false;
  }
  let manifest;
  if (hasAsar) {
    manifest = readAsar(canonicalRoot, asarRelative);
  } else {
    const appRelative = `${resourcesRelative}/app`;
    manifest = parseJson(readBounded(containedPath(canonicalRoot, `${appRelative}/package.json`)), "application package.json");
    containedPath(canonicalRoot, `${appRelative}/${safePath(manifest.main)}`);
    containedPath(canonicalRoot, `${appRelative}/dist/index.html`);
  }
  if (manifest.version !== version || manifest.name !== packageName || manifest.updateRepository !== repository
    || manifest.main !== "electron/main.cjs"
    || (manifest.build?.appId !== undefined && manifest.build.appId !== identity)
    || (manifest.build?.productName !== undefined && manifest.build.productName !== productName)) {
    fail("application package identity mismatch (version, name, repository or entrypoint)");
  }
  const runtimeRelative = `${resourcesRelative}/runtime`;
  containedPath(canonicalRoot, runtimeRelative, "directory");
  const runtimeManifest = parseJson(readBounded(containedPath(canonicalRoot, `${runtimeRelative}/manifest.json`), MAX_ASAR_HEADER_BYTES), "runtime manifest");
  const runtimeLauncher = `bin/codex-chatgpt-web${platform === "win32" ? ".cmd" : ""}`;
  if (runtimeManifest.schemaVersion !== 2 || runtimeManifest.appVersion !== version
    || runtimeManifest.platform !== platform || runtimeManifest.arch !== arch
    || runtimeManifest.entrypoint !== "app/cli.js" || runtimeManifest.launcher !== runtimeLauncher) {
    fail("runtime manifest identity mismatch");
  }
  for (const relative of ["app/cli.js", "app/browser-helper.cjs", runtimeLauncher]) {
    containedPath(canonicalRoot, `${runtimeRelative}/${relative}`);
  }
  const runtimeExecutable = containedPath(canonicalRoot, `${runtimeRelative}/runtime/bun${platform === "win32" ? ".exe" : ""}`);
  validateExecutable(runtimeExecutable, platform, arch);
  return { root: canonicalRoot, executable, resources, runtimeExecutable, version, platform, arch, identity, packageName, repository };
}

module.exports = { validateStagedApplication };
