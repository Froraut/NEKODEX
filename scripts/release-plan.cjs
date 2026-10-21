const fs = require("node:fs");
const manifest = require("../package.json");
// Owner decision (2026-10-21): releases are built and published for macOS Apple Silicon
// (arm64) only. Intel is not built; Windows and Linux come later. This is the only build
// leg, so nothing but the arm64 build can gate publication.
const MACOS_ARM64 = Object.freeze({ runner: "macos-15", runtime_asset: "codex-chatgpt-web-darwin-arm64.tar.gz" });
function releasePlan({ refType, tag, version }) {
  if (refType !== "tag" || tag !== `v${version}` || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version || "")) {
    throw new Error("Release requires an existing tag exactly matching package.json; select that tag when dispatching the workflow");
  }
  return { include: [{ ...MACOS_ARM64 }] };
}
if (require.main === module) {
  const matrix = releasePlan({ refType: process.env.GITHUB_REF_TYPE, tag: process.env.GITHUB_REF_NAME, version: manifest.version });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
}
module.exports = { MACOS_ARM64, releasePlan };
