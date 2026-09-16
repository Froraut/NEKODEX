/** Check only links advertised by the documentation; do not imply unpublished platforms exist. */
export function assertReadmeDownloads(
  name: string,
  readme: string,
  options: { version: string; repository: string; dmgName: string; archiveName: string },
): void {
  const { version, repository } = options;
  const assetName = (template: string, os: string, arch: string, ext: string) => template
    .replaceAll("${version}", version).replaceAll("${os}", os)
    .replaceAll("${arch}", arch).replaceAll("${ext}", ext);
  const macDownloads = ["arm64", "x64"].map(arch => assetName(options.dmgName, "mac", arch, "dmg"));
  const allowedAssets = new Set([
    ...macDownloads,
    ...["arm64", "x64"].map(arch => assetName(options.archiveName, "mac", arch, "zip")),
    assetName(options.archiveName, "win", "x64", "exe"),
    assetName(options.archiveName, "win", "x64", "zip"),
    assetName(options.archiveName, "linux", "x64", "AppImage"),
    "checksums.txt", "checksums.txt.sig", "install-launcher.sh", "install-launcher.ps1",
  ]);
  const prefix = `https://github.com/${repository}/releases/download/v${version}/`;
  const advertised = new Set<string>();
  for (const match of readme.matchAll(/https:\/\/github\.com\/[^\s<>"')]+\/releases\/(?:download|latest\/download)\/[^\s<>"')]+/g)) {
    const url = match[0];
    if (!url.startsWith(prefix) || !allowedAssets.has(url.slice(prefix.length))) {
      throw new Error(`${name} has an outdated or unsupported release download: ${url}`);
    }
    advertised.add(url.slice(prefix.length));
  }
  for (const asset of macDownloads) {
    if (!advertised.has(asset)) throw new Error(`${name} is missing the current macOS download: ${asset}`);
  }
  for (const match of readme.matchAll(/https:\/\/github\.com\/[^\s<>"')]+\/releases\/tag\/[^\s<>"')]+/g)) {
    if (match[0] !== `https://github.com/${repository}/releases/tag/v${version}`) {
      throw new Error(`${name} has an outdated release page: ${match[0]}`);
    }
  }
}
