// Adapted from miuuyy/codex-chatgpt-web PR #560: never execute NSIS on the live host.
const fs = require("node:fs");
const path = require("node:path");

function stageWindowsSmoke({ installer, scratch, productName, run }) {
  if (typeof productName !== "string" || !productName || /[\\/:]/.test(productName)) {
    throw new Error("Windows package product name is invalid");
  }
  const extractor = path.join(
    path.dirname(require.resolve("electron-winstaller/package.json")), "vendor", "7z.exe",
  );
  const payloadDirectory = path.join(scratch, "windows-payload");
  const applicationDirectory = path.join(scratch, "windows-app");
  fs.mkdirSync(payloadDirectory);
  fs.mkdirSync(applicationDirectory);
  run(extractor, ["e", installer, "$PLUGINSDIR/app-64.7z", `-o${payloadDirectory}`, "-y", "-bd"], {
    timeout: 300_000,
  });
  const payload = path.join(payloadDirectory, "app-64.7z");
  if (!fs.statSync(payload, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("Windows installer has no x64 application payload");
  }
  run(extractor, ["x", payload, `-o${applicationDirectory}`, "-y", "-bd"], { timeout: 300_000 });
  const executable = path.join(applicationDirectory, `${productName}.exe`);
  if (!fs.statSync(executable, { throwIfNoEntry: false })?.isFile()) {
    throw new Error("Extracted Windows package has no launcher executable");
  }
  return executable;
}

module.exports = { stageWindowsSmoke };
