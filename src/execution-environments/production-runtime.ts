import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { VmRuntimeSelection } from './executor';
import { isSha256, keys, record, sha256, VM_PROTOCOL, vmAssert } from './protocol';

/** Same publisher pinned by the macOS installer. Never derive trust from a
 * renderer, environment variable, downloaded manifest or the selected helper. */
export const VM_PUBLISHER_TEAM_ID = 'CNMWGJF2CG';
export const VM_HELPER_IDENTIFIER = 'com.nekodex.execution-vm-helper';
export const VM_HELPER_SOURCE_SHA256 = '19458105ceaa89cdafbf6f62d33d424a76e2401f55e4af8395cc8388c1616936';
export const VM_APP_IDENTIFIER = 'dev.codexwebgpt.launcher';
export const VM_BUNDLE_FILES = Object.freeze({ helper: 'nekodex-execution-vm-helper', helperManifest: 'helper-manifest.json',
  guestManifest: 'guest-manifest.json', kernel: 'Image', initrd: 'initrd.gz', manifest: 'runtime-manifest.json' });

export interface ProductionVmOriginPins {
  runtimeEntryPath: string; runtimeExecutablePath: string; runtimeManifestPath: string;
  bundledEntryPath: string; bundledExecutablePath: string; bundledManifestPath: string;
  entrySha256: string; executableSha256: string; manifestSha256: string;
}

export interface ProductionVmRuntimePins {
  appBundlePath: string;
  runtimeManifestPath: string;
  runtimeManifestSha256: string;
  origin?: ProductionVmOriginPins;
}

/** Pure layout mapping: no source/PATH/cache lookup and no process launch. */
export function productionVmRuntimePaths(entryPath: string): { appBundlePath: string; directory: string } | undefined {
  if (basename(entryPath) !== 'cli.js' || basename(dirname(entryPath)) !== 'app') return;
  const runtime = dirname(dirname(entryPath));
  if (basename(runtime) !== 'runtime' || basename(dirname(runtime)) !== 'Resources' || basename(dirname(dirname(runtime))) !== 'Contents') return;
  const appBundlePath = dirname(dirname(dirname(runtime)));
  if (!basename(appBundlePath).endsWith('.app') || !appBundlePath.startsWith('/')) return;
  return { appBundlePath, directory: join(dirname(entryPath), 'execution-vm', 'darwin-arm64') };
}

function read(path: string, max = 2 * 1024 * 1024): Buffer {
  const before = lstatSync(path, { bigint: true });
  vmAssert(realpathSync(path) === path && before.isFile() && before.nlink === 1n && !(before.mode & 0o022n)
    && before.size > 0n && before.size <= BigInt(max), 'vm-production-metadata-invalid');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const opened = fstatSync(fd, { bigint: true }); vmAssert(opened.dev === before.dev && opened.ino === before.ino);
    const bytes = readFileSync(fd), after = lstatSync(path, { bigint: true });
    vmAssert(['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].every(k => before[k as keyof typeof before] === after[k as keyof typeof after]), 'vm-production-metadata-changed');
    return bytes;
  } finally { closeSync(fd); }
}

/** Resolve launcher claims against the actual running CLI location. Claims only
 * choose fixed paths; their expected bytes gain authority from the app seal at
 * admission. Copies must retain the exact sealed manifest and CLI/Bun identity. */
export function resolveProductionVmOrigin(entryPath: string, executablePath: string, binding?: string): {
  appBundlePath: string; directory: string; origin: ProductionVmOriginPins;
} | undefined {
  let bundledEntryPath = entryPath;
  let claimedManifestSha256: string | undefined;
  if (binding) {
    vmAssert(Buffer.byteLength(binding) <= 16384, 'vm-production-origin-invalid');
    const claim = record(JSON.parse(binding));
    keys(claim, ['version', 'bundledEntryPath', 'runtimeEntryPath', 'runtimeExecutablePath', 'runtimeManifestSha256']);
    vmAssert(claim.version === 1 && claim.runtimeEntryPath === entryPath && claim.runtimeExecutablePath === executablePath
      && typeof claim.bundledEntryPath === 'string' && isSha256(claim.runtimeManifestSha256), 'vm-production-origin-mismatch');
    bundledEntryPath = claim.bundledEntryPath; claimedManifestSha256 = claim.runtimeManifestSha256;
  }
  const paths = productionVmRuntimePaths(bundledEntryPath); if (!paths) return;
  const bundledRoot = dirname(dirname(bundledEntryPath)), runtimeRoot = dirname(dirname(entryPath));
  vmAssert(basename(entryPath) === 'cli.js' && basename(dirname(entryPath)) === 'app'
    && executablePath === join(runtimeRoot, 'runtime/bun'), 'vm-production-origin-layout-invalid');
  const runtimeManifestPath = join(runtimeRoot, 'manifest.json'), bundledManifestPath = join(bundledRoot, 'manifest.json');
  const sealedManifest = read(bundledManifestPath, 16 * 1024 * 1024), manifestSha256 = sha256(sealedManifest);
  vmAssert((!claimedManifestSha256 || claimedManifestSha256 === manifestSha256)
    && sha256(read(runtimeManifestPath, 16 * 1024 * 1024)) === manifestSha256, 'vm-production-origin-manifest-mismatch');
  const manifest = record(JSON.parse(sealedManifest.toString('utf8')));
  vmAssert(manifest.schemaVersion === 2 && manifest.platform === 'darwin' && manifest.arch === 'arm64'
    && manifest.entrypoint === 'app/cli.js' && Array.isArray(manifest.files), 'vm-production-origin-manifest-invalid');
  const files = manifest.files.map(record);
  const pin = (path: string, max: number): string => {
    const matches = files.filter(file => file.path === path);
    vmAssert(matches.length === 1 && isSha256(matches[0]!.sha256) && Number.isSafeInteger(matches[0]!.size)
      && Number(matches[0]!.size) > 0 && Number(matches[0]!.size) <= max, 'vm-production-origin-file-pin-invalid');
    return String(matches[0]!.sha256);
  };
  for (const path of [entryPath, executablePath, bundledEntryPath, join(bundledRoot, 'runtime/bun')]) {
    vmAssert(realpathSync(path) === path, 'vm-production-origin-path-invalid');
  }
  return { ...paths, origin: Object.freeze({ runtimeEntryPath: entryPath, runtimeExecutablePath: executablePath, runtimeManifestPath,
    bundledEntryPath, bundledExecutablePath: join(bundledRoot, 'runtime/bun'), bundledManifestPath,
    entrySha256: pin('app/cli.js', 64 * 1024 * 1024), executableSha256: pin('runtime/bun', 256 * 1024 * 1024), manifestSha256 }) };
}

/** Validate the manifest's complete execution/provenance closure. Authenticity
 * comes from the enclosing publisher app seal at admission, never these claims. */
export function validateProductionVmRuntimeManifest(manifest: unknown, helperBytes: Buffer, guestBytes: Buffer): void {
  const m = record(manifest); keys(m, ['version', 'protocol', 'target', 'production', 'publisherTeamId', 'helper', 'guest']);
  vmAssert(m.version === 1 && m.protocol === VM_PROTOCOL && m.target === 'darwin-arm64' && m.production === true
    && m.publisherTeamId === VM_PUBLISHER_TEAM_ID, 'vm-production-manifest-invalid');
  const helper = record(JSON.parse(helperBytes.toString('utf8'))), guest = record(JSON.parse(guestBytes.toString('utf8')));
  const h = record(m.helper), g = record(m.guest);
  keys(h, ['path', 'sha256', 'manifestPath', 'manifestSha256', 'sourceSha256', 'entitlementsSha256', 'identifier']);
  keys(g, ['manifestPath', 'manifestSha256', 'kernelPath', 'kernelSha256', 'initrdPath', 'initrdSha256', 'sourceSha256', 'toolchainSha256']);
  vmAssert(h.path === VM_BUNDLE_FILES.helper && h.manifestPath === VM_BUNDLE_FILES.helperManifest && h.identifier === VM_HELPER_IDENTIFIER
    && h.manifestSha256 === sha256(helperBytes) && h.sourceSha256 === VM_HELPER_SOURCE_SHA256 && isSha256(h.entitlementsSha256)
    && helper.development === false && helper.identifier === h.identifier && helper.publisherTeamId === VM_PUBLISHER_TEAM_ID
    && helper.sourceSha256 === h.sourceSha256 && helper.entitlementsSha256 === h.entitlementsSha256 && helper.executableSha256 === h.sha256
    && isSha256(h.sha256), 'vm-production-helper-pins-invalid');
  vmAssert(g.manifestPath === VM_BUNDLE_FILES.guestManifest && g.manifestSha256 === sha256(guestBytes)
    && g.kernelPath === VM_BUNDLE_FILES.kernel && g.initrdPath === VM_BUNDLE_FILES.initrd
    && g.kernelSha256 === record(guest.kernel).sha256 && g.initrdSha256 === record(guest.initrd).sha256
    && isSha256(g.kernelSha256) && isSha256(g.initrdSha256), 'vm-production-image-pins-invalid');
  const source = record(guest.sourceSha256);
  keys(source, ['agent.go', 'go.mod', 'init', 'platform_linux.go', 'platform_other.go']);
  vmAssert(Object.values(source).every(isSha256) && isSha256(guest.agentSha256), 'vm-production-guest-source-invalid');
  const build = record(guest.build), profile = record(guest.developmentProfile);
  vmAssert(build.GOOS === 'linux' && build.GOARCH === 'arm64' && build.CGO_ENABLED === '0' && build.trimpath === true
    && typeof build.go === 'string' && build.go.length > 0 && Array.isArray(guest.provenance) && guest.provenance.length > 0
    && profile.hooksExecuted === false && typeof profile.name === 'string' && Object.keys(record(profile.versions)).length > 0,
  'vm-production-toolchain-proof-invalid');
  vmAssert(g.sourceSha256 === sha256(JSON.stringify(source)) && g.toolchainSha256 === sha256(JSON.stringify({
    agentSha256: guest.agentSha256, build, developmentProfile: profile, provenance: guest.provenance,
  })), 'vm-production-provenance-pins-invalid');
}

/** Read fixed bundled metadata only. Preparation later authenticates publisher
 * signatures and every executed artifact. An installed layout never falls back
 * to source-development artifacts when its bundle is absent or invalid. */
export function resolveProductionVmRuntimeSelection(entryUrl: string, originBinding?: string): VmRuntimeSelection | undefined {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') return;
  const paths = resolveProductionVmOrigin(fileURLToPath(entryUrl), process.execPath, originBinding); if (!paths) return;
  const { directory, appBundlePath } = paths;
  try {
    vmAssert(realpathSync(appBundlePath) === appBundlePath && realpathSync(directory) === directory, 'vm-production-layout-invalid');
    const runtimeManifestPath = join(directory, VM_BUNDLE_FILES.manifest), bytes = read(runtimeManifestPath);
    const helperManifestPath = join(directory, VM_BUNDLE_FILES.helperManifest), guestManifestPath = join(directory, VM_BUNDLE_FILES.guestManifest);
    const helperBytes = read(helperManifestPath), guestBytes = read(guestManifestPath), manifest = record(JSON.parse(bytes.toString('utf8')));
    validateProductionVmRuntimeManifest(manifest, helperBytes, guestBytes);
    const helper = record(manifest.helper), guest = record(manifest.guest);
    return Object.freeze({ helperPath: join(directory, VM_BUNDLE_FILES.helper), helperSha256: String(helper.sha256), helperManifestPath,
      helperManifestSha256: String(helper.manifestSha256), kernelPath: join(directory, VM_BUNDLE_FILES.kernel), kernelSha256: String(guest.kernelSha256),
      initrdPath: join(directory, VM_BUNDLE_FILES.initrd), initrdSha256: String(guest.initrdSha256), guestManifestPath, guestManifestSha256: String(guest.manifestSha256),
      production: Object.freeze({ appBundlePath, runtimeManifestPath, runtimeManifestSha256: sha256(bytes), origin: paths.origin }) });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw new Error('The bundled production VM runtime metadata is invalid; install a complete publisher-signed application');
  }
}
