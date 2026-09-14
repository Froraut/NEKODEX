const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { verifyReleaseMetadata, verifyReleaseAsset } = require("../launcher/electron/release-trust.cjs");
const version = require("../package.json").version;
function gh(args) {
  const result = spawnSync("gh", args, { encoding: "utf8", stdio: "pipe", shell: false });
  if (result.error || result.status !== 0) throw new Error(`GitHub release operation failed: ${args.slice(0, 2).join(" ")}`);
  return result.stdout;
}
async function publish() {
  const directory = path.resolve(process.argv[2] || "release-assets");
  const tag = process.env.GITHUB_REF_NAME;
  const repository = process.env.GITHUB_REPOSITORY;
  const raw = fs.readFileSync(path.join(directory, "release-metadata.json"));
  const metadata = verifyReleaseMetadata(raw, { repository, tag, version });
  if (metadata.source.buildType !== "github-actions" || metadata.source.commit !== process.env.GITHUB_SHA || metadata.source.runId !== process.env.GITHUB_RUN_ID) throw new Error("Release metadata belongs to another workflow run");
  const files = fs.readdirSync(directory);
  if (files.length !== metadata.assets.length + 1) throw new Error("Release contains unsigned/extra assets");
  for (const asset of metadata.assets) await verifyReleaseAsset(path.join(directory, asset.name), { metadata });
  // Published tags are immutable here. A previous failed draft requires explicit maintainer cleanup.
  const existing = spawnSync("gh", ["release", "view", tag, "--repo", repository], { stdio: "pipe" });
  if (existing.status === 0) throw new Error("Release tag already exists; refusing to overwrite release assets");
  const notes = path.resolve(__dirname, "../docs/releases", `${version}.md`);
  gh(["release", "create", tag, ...files.map(file => path.join(directory, file)), "--repo", repository,
    "--verify-tag", "--draft", "--title", `${tag} · FroRaut fork`,
    ...(fs.existsSync(notes) ? ["--notes-file", notes] : ["--generate-notes"])]);
  const remote = JSON.parse(gh(["release", "view", tag, "--repo", repository, "--json", "assets"]));
  if (remote.assets.length !== files.length) throw new Error("Draft release asset count mismatch; draft remains unpublished");
  for (const file of files) {
    const expected = crypto.createHash("sha256");
    for await (const chunk of fs.createReadStream(path.join(directory, file))) expected.update(chunk);
    const asset = remote.assets.find(item => item.name === file);
    if (asset?.digest !== `sha256:${expected.digest("hex")}`) throw new Error(`Draft release digest mismatch for ${file}; draft remains unpublished`);
  }
  gh(["release", "edit", tag, "--repo", repository, "--draft=false", ...(tag.includes("-") ? ["--prerelease", "--latest=false"] : ["--latest"])]);
}
if (require.main === module) publish().catch(error => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
