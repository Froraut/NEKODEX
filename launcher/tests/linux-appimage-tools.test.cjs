const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { requireLibnotifySymbol } = require("../scripts/prepare-linux-appimage-tools.cjs");

test("AppImage tool preparation rejects a libnotify built for another CPU", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-linux-libnotify-"));
  try {
    const source = path.join(root, "libnotify.so.4");
    const header = Buffer.alloc(20);
    Buffer.from("7f454c460201", "hex").copy(header);
    header.writeUInt16LE(3, 16);
    header.writeUInt16LE(183, 18); // AArch64, while this installer publishes x64.
    fs.writeFileSync(source, header);
    assert.throws(() => requireLibnotifySymbol(source), /Linux x64 ELF shared library/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
