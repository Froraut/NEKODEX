const fs = require("node:fs");
const manifest = require("../package.json");
function releasePlan({ event, refType, tag, version, scope = "all" }) {
  if (refType !== "tag" || tag !== `v${version}` || !/^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/.test(version || "")) {
    throw new Error("Release requires an existing tag exactly matching package.json; select that tag when dispatching the workflow");
  }
  if (event !== "workflow_dispatch") scope = "all";
  if (!["all", "macos"].includes(scope)) throw new Error("Unsupported release platform scope");
  if (scope !== "all" && !version.includes("-")) throw new Error("A stable release requires every supported platform; select a prerelease tag for macOS-only publication");
  const include = [
    { runner: "macos-15", runtime_asset: "codex-chatgpt-web-darwin-arm64.tar.gz", notices: scope === "macos" },
    { runner: "macos-15-intel", runtime_asset: "codex-chatgpt-web-darwin-amd64.tar.gz", notices: false },
  ];
  if (scope === "all") include.push(
    { runner: "ubuntu-latest", runtime_asset: "codex-chatgpt-web-linux-amd64.tar.gz", notices: true },
    { runner: "windows-latest", runtime_asset: "codex-chatgpt-web-windows-amd64.zip", notices: false },
  );
  return { include };
}
if (require.main === module) {
  const matrix = releasePlan({ event: process.env.GITHUB_EVENT_NAME, refType: process.env.GITHUB_REF_TYPE,
    tag: process.env.GITHUB_REF_NAME, version: manifest.version, scope: process.env.RELEASE_PLATFORM_SCOPE || "all" });
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `matrix=${JSON.stringify(matrix)}\n`);
}
module.exports = { releasePlan };
