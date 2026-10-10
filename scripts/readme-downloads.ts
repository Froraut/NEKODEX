/**
 * Check only links advertised by the documentation; do not imply unpublished platforms exist.
 * Releases may cover only some platforms, so each platform's links must name the last release
 * that actually carries that platform's files (`linuxVersion` defaults to the macOS `version`).
 */
export function assertReadmeDownloads(
  name: string,
  readme: string,
  options: { version: string; linuxVersion?: string; repository: string; dmgName: string; archiveName: string },
): void {
  const { version, repository } = options;
  const linuxVersion = options.linuxVersion ?? version;
  const assetName = (template: string, release: string, os: string, arch: string, ext: string) => template
    .replaceAll("${version}", release).replaceAll("${os}", os)
    .replaceAll("${arch}", arch).replaceAll("${ext}", ext);
  const macDownloads = ["arm64", "x64"].map(arch => assetName(options.dmgName, version, "mac", arch, "dmg"));
  const releaseFiles = ["checksums.txt", "checksums.txt.sig", "install-launcher.sh", "install-launcher.ps1"];
  const allowedAssets = new Map<string, Set<string>>([[version, new Set([
    ...macDownloads,
    ...["arm64", "x64"].map(arch => assetName(options.archiveName, version, "mac", arch, "zip")),
    assetName(options.archiveName, version, "win", "x64", "exe"),
    assetName(options.archiveName, version, "win", "x64", "zip"),
    ...releaseFiles,
  ])]]);
  const linuxAssets = allowedAssets.get(linuxVersion) ?? new Set(releaseFiles);
  linuxAssets.add(assetName(options.archiveName, linuxVersion, "linux", "x64", "AppImage"));
  allowedAssets.set(linuxVersion, linuxAssets);
  const advertised = new Set<string>();
  for (const match of readme.matchAll(/https:\/\/github\.com\/[^\s<>"')]+\/releases\/(?:download|latest\/download)\/[^\s<>"')]+/g)) {
    const url = match[0];
    const download = /^https:\/\/github\.com\/(.+?)\/releases\/download\/v([^/]+)\/(.+)$/.exec(url);
    if (!download || download[1] !== repository || !allowedAssets.get(download[2])?.has(download[3])) {
      throw new Error(`${name} has an outdated or unsupported release download: ${url}`);
    }
    advertised.add(download[3]);
  }
  for (const asset of macDownloads) {
    if (!advertised.has(asset)) throw new Error(`${name} is missing the current macOS download: ${asset}`);
  }
  for (const match of readme.matchAll(/https:\/\/github\.com\/[^\s<>"')]+\/releases\/tag\/[^\s<>"')]+/g)) {
    if (![version, linuxVersion].some(release => match[0] === `https://github.com/${repository}/releases/tag/v${release}`)) {
      throw new Error(`${name} has an outdated release page: ${match[0]}`);
    }
  }
}
