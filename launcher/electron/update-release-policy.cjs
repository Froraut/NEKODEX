// Release selection is pinned to packaged identity; it has no download/install authority.
const REPOSITORY = validateRepository(require("../package.json").updateRepository);

function validateRepository(value) {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-][A-Za-z0-9_.-]*\/[A-Za-z0-9_-][A-Za-z0-9_.-]*$/.test(value)) {
    throw new Error("The packaged update repository must be a GitHub owner/repository");
  }
  return value;
}

function releaseApiUrl(repository = REPOSITORY) {
  // Fork versions use an explicit prerelease suffix. GitHub's /latest silently
  // excludes them, so resolve the newest compatible channel from published releases.
  return `https://api.github.com/repos/${validateRepository(repository)}/releases?per_page=20`;
}

function releaseFeedEntries(xml, repository = REPOSITORY) {
  const prefix = `https://github.com/${validateRepository(repository)}/releases/tag/v`;
  const versions = new Set();
  for (const match of String(xml).matchAll(/<link\b[^>]*\bhref="([^"]+)"[^>]*>/g)) {
    if (!match[1].startsWith(prefix)) continue;
    const version = match[1].slice(prefix.length);
    if (parseVersion(version)) versions.add(version);
  }
  return [...versions].map(version => ({ tag_name: `v${version}` }));
}

function selectRelease(releases, currentVersion, { platform, arch } = {}) {
  const current = parseVersion(currentVersion);
  const channel = current?.prerelease?.split(".")[0];
  return (Array.isArray(releases) ? releases : releases ? [releases] : [])
    .filter(release => {
      if (release?.draft) return false;
      const version = parseVersion(String(release?.tag_name || "").replace(/^v/, ""));
      if (!version) return false;
      // A GitHub prerelease with a stable-looking tag must not promote stable users.
      // Named fork prereleases still follow the explicit installed channel below.
      if (release.prerelease === true && !version.prerelease) return false;
      if (platform && Array.isArray(release.assets)) {
        const assetName = releaseAssetName(releaseVersion(release.tag_name), platform, arch);
        // A platform-scoped release can intentionally omit other platforms. Once
        // this archive is present, keep the candidate: missing/bad trust metadata,
        // URLs, sizes or signatures must fail closed instead of falling back.
        if (assetName && !release.assets.some(asset => asset?.name === assetName)) return false;
      }
      return !version.prerelease || (channel && version.prerelease.split(".")[0] === channel);
    })
    .sort((a, b) => compareVersions(releaseVersion(b.tag_name), releaseVersion(a.tag_name)))[0];
}

function parseVersion(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(value || "").trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || null,
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Invalid release version comparison: ${left} / ${right}`);
  for (const key of ["major", "minor", "patch"]) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease.localeCompare(b.prerelease, "en", { numeric: true });
}

function releaseVersion(tagName) {
  const version = String(tagName || "").replace(/^v/, "");
  if (!parseVersion(version)) throw new Error(`GitHub returned an invalid release tag: ${tagName}`);
  return version;
}

function releaseAssetName(version, platform = process.platform, arch = process.arch) {
  if (platform === "darwin" && ["arm64", "x64"].includes(arch)) {
    return `codex-web-gpt-${version}-mac-${arch}.zip`;
  }
  if (platform === "win32" && arch === "x64") {
    return `codex-web-gpt-${version}-win-x64.zip`;
  }
  if (platform === "linux" && arch === "x64") {
    return `codex-web-gpt-${version}-linux-x64.AppImage`;
  }
  return null;
}

function expectedChecksum(contents, assetName) {
  for (const line of String(contents || "").split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+(.+)$/.exec(line.trim());
    if (match && match[2] === assetName) return match[1].toLowerCase();
  }
  throw new Error(`checksums.txt has no entry for ${assetName}`);
}

function validateReleaseAssetUrl(raw, version, assetName, repository = REPOSITORY) {
  const url = new URL(raw);
  const expectedPath = `/${validateRepository(repository)}/releases/download/v${version}/${assetName}`;
  if (url.protocol !== "https:" || url.hostname !== "github.com" || url.pathname !== expectedPath
    || url.username || url.password || url.port || url.search || url.hash) {
    throw new Error(`GitHub returned an unexpected release asset URL for ${assetName}`);
  }
  return url.toString();
}

module.exports = { REPOSITORY, validateRepository, releaseApiUrl, releaseFeedEntries, selectRelease, parseVersion, compareVersions, releaseVersion, releaseAssetName, expectedChecksum, validateReleaseAssetUrl };
