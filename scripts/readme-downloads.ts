/**
 * Check only links advertised by the documentation; do not imply unpublished platforms exist.
 * Releases are built for macOS Apple Silicon only, so the current release (`version`) offers
 * arm64 packages alone. Other platforms may link only the last release that actually carries
 * their files: `intelVersion` for Intel Macs, `linuxVersion` for Linux. Without one, that
 * platform has no download to advertise.
 */
export function assertReadmeDownloads(
  name: string,
  readme: string,
  options: { version: string; intelVersion?: string; linuxVersion?: string; repository: string; dmgName: string; archiveName: string },
): void {
  const { version, repository } = options;
  const assetName = (template: string, release: string, os: string, arch: string, ext: string) => template
    .replaceAll("${version}", release).replaceAll("${os}", os)
    .replaceAll("${arch}", arch).replaceAll("${ext}", ext);
  const releaseFiles = ["checksums.txt", "checksums.txt.sig", "install-launcher.sh", "install-launcher.ps1"];
  const allowedAssets = new Map<string, Set<string>>();
  const allow = (release: string, ...assets: string[]) => {
    const allowed = allowedAssets.get(release) ?? new Set(releaseFiles);
    for (const asset of assets) allowed.add(asset);
    allowedAssets.set(release, allowed);
  };
  const macDownload = assetName(options.dmgName, version, "mac", "arm64", "dmg");
  allow(version, macDownload, assetName(options.archiveName, version, "mac", "arm64", "zip"));
  if (options.intelVersion) {
    allow(options.intelVersion, assetName(options.dmgName, options.intelVersion, "mac", "x64", "dmg"),
      assetName(options.archiveName, options.intelVersion, "mac", "x64", "zip"));
  }
  if (options.linuxVersion) allow(options.linuxVersion, assetName(options.archiveName, options.linuxVersion, "linux", "x64", "AppImage"));
  const advertised = new Set<string>();
  for (const match of readme.matchAll(/https:\/\/github\.com\/[^\s<>"')]+\/releases\/(?:download|latest\/download)\/[^\s<>"')]+/g)) {
    const url = match[0];
    const download = /^https:\/\/github\.com\/(.+?)\/releases\/download\/v([^/]+)\/(.+)$/.exec(url);
    if (!download || download[1] !== repository || !allowedAssets.get(download[2])?.has(download[3])) {
      throw new Error(`${name} has an outdated or unsupported release download: ${url}`);
    }
    advertised.add(download[3]);
  }
  if (!advertised.has(macDownload)) throw new Error(`${name} is missing the current macOS download: ${macDownload}`);
  for (const match of readme.matchAll(/https:\/\/github\.com\/[^\s<>"')]+\/releases\/tag\/[^\s<>"')]+/g)) {
    if (![...allowedAssets.keys()].some(release => match[0] === `https://github.com/${repository}/releases/tag/v${release}`)) {
      throw new Error(`${name} has an outdated release page: ${match[0]}`);
    }
  }
}
