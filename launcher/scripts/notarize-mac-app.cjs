const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { notarizeAndStaple } = require("./release-signing.cjs");

// electron-builder `afterSign` hook for publisher macOS releases. package.cjs disables the
// builder's own notarization so stapling goes through the shared retry in release-signing.cjs;
// the DMG and ZIP targets are still built from the stapled app after this hook returns.
function checked(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) throw new Error(`${command} failed while notarizing the macOS app`);
}
async function afterSign(context) {
  if (context.electronPlatformName !== "darwin") return;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  checked("codesign", ["--verify", "--deep", "--strict", app]);
  const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nekodex-notarize-app-")));
  try {
    const upload = path.join(scratch, `${path.basename(app, ".app")}.zip`);
    checked("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, upload]);
    notarizeAndStaple(app, process.env, { upload, label: "App" });
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}
module.exports = { afterSign };
