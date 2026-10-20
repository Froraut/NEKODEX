import { expect, test } from 'bun:test';
import { createRequire } from 'node:module';
import { admitDevelopmentVmRuntime, assertVmPublisherDetails, vmRuntimeProtectedPaths, type AdmittedVmRuntime, type VmRuntimeSelection } from '../src/execution-environments/executor';
import { productionVmRuntimePaths, validateProductionVmRuntimeManifest, VM_HELPER_IDENTIFIER, VM_HELPER_SOURCE_SHA256, VM_PUBLISHER_TEAM_ID } from '../src/execution-environments/production-runtime';
const require = createRequire(import.meta.url);
const { createProductionVmRuntimeManifest } = require('../scripts/build-execution-vm-helper.cjs');
const { executionVmSigningConfiguration } = require('../scripts/sign-execution-vm-helper.cjs');

function fixture() {
  const hash = 'a'.repeat(64);
  const helper = { version: 1, protocol: 'neko-vm-v1', target: 'darwin-arm64', provider: 'macos-virtualization',
    development: false, identifier: VM_HELPER_IDENTIFIER, publisherTeamId: VM_PUBLISHER_TEAM_ID,
    sourceSha256: VM_HELPER_SOURCE_SHA256, entitlementsSha256: hash, executableSha256: hash, cpuCount: 2, memoryBytes: 2147483648, guestPort: 4041 };
  const guest = { version: 1, protocol: 'neko-vm-v1', architecture: 'arm64', kernel: { path: '/build/Image', sha256: hash },
    initrd: { path: '/build/initrd.gz', sha256: hash }, agentSha256: hash,
    sourceSha256: { 'agent.go': hash, 'go.mod': hash, init: hash, 'platform_linux.go': hash, 'platform_other.go': hash },
    build: { GOOS: 'linux', GOARCH: 'arm64', CGO_ENABLED: '0', trimpath: true, go: '1.26.3' },
    developmentProfile: { name: 'fixed-guest', hooksExecuted: false, versions: { gcc: '15.2.0-r5', python3: '3.14.8-r0' } },
    provenance: [{ component: 'kernel', sha256: hash }] };
  const helperBytes = Buffer.from(JSON.stringify(helper)), guestBytes = Buffer.from(JSON.stringify(guest));
  return { helper, guest, helperBytes, guestBytes, manifest: createProductionVmRuntimeManifest(helperBytes, guestBytes) };
}

test('producer and admission bind fixed image, source and toolchain closure; tampering is rejected', () => {
  const f = fixture();
  expect(() => validateProductionVmRuntimeManifest(f.manifest, f.helperBytes, f.guestBytes)).not.toThrow();
  const image = structuredClone(f.manifest); image.guest.kernelSha256 = 'b'.repeat(64);
  expect(() => validateProductionVmRuntimeManifest(image, f.helperBytes, f.guestBytes)).toThrow('vm-production-image-pins-invalid');
  const source = structuredClone(f.manifest); source.guest.sourceSha256 = 'b'.repeat(64);
  expect(() => validateProductionVmRuntimeManifest(source, f.helperBytes, f.guestBytes)).toThrow('vm-production-provenance-pins-invalid');
  const toolchain = structuredClone(f.manifest); toolchain.guest.toolchainSha256 = 'b'.repeat(64);
  expect(() => validateProductionVmRuntimeManifest(toolchain, f.helperBytes, f.guestBytes)).toThrow('vm-production-provenance-pins-invalid');
  const publisher = structuredClone(f.manifest); publisher.publisherTeamId = 'ATTACKER00';
  expect(() => validateProductionVmRuntimeManifest(publisher, f.helperBytes, f.guestBytes)).toThrow('vm-production-manifest-invalid');
  const traversal = structuredClone(f.manifest); traversal.helper.path = '../other-helper';
  expect(() => validateProductionVmRuntimeManifest(traversal, f.helperBytes, f.guestBytes)).toThrow('vm-production-helper-pins-invalid');
  expect(() => createProductionVmRuntimeManifest(Buffer.from(JSON.stringify({ ...f.helper, development: true })), f.guestBytes)).toThrow();
});

test('installed layout and publisher policy have no source, PATH, unsigned or alternate-team fallback', () => {
  const app = '/Applications/NEKODEX.app';
  expect(productionVmRuntimePaths(`${app}/Contents/Resources/runtime/app/cli.js`)).toEqual({ appBundlePath: app,
    directory: `${app}/Contents/Resources/runtime/app/execution-vm/darwin-arm64` });
  expect(productionVmRuntimePaths('/checkout/src/cli.ts')).toBeUndefined();
  expect(productionVmRuntimePaths('/checkout/dist/runtime/app/cli.js')).toBeUndefined();
  const details = `Identifier=${VM_HELPER_IDENTIFIER}\nTeamIdentifier=${VM_PUBLISHER_TEAM_ID}\nAuthority=Developer ID Application: Publisher (${VM_PUBLISHER_TEAM_ID})\nTimestamp=Oct 19, 2026\n`;
  expect(() => assertVmPublisherDetails(details, VM_HELPER_IDENTIFIER)).not.toThrow();
  expect(() => assertVmPublisherDetails(details + 'Signature=adhoc\n', VM_HELPER_IDENTIFIER)).toThrow();
  expect(() => assertVmPublisherDetails(details.replace('TeamIdentifier=CNMWGJF2CG', 'TeamIdentifier=OTHERTEAM0'), VM_HELPER_IDENTIFIER)).toThrow();
  expect(() => executionVmSigningConfiguration({})).toThrow();
  expect(() => executionVmSigningConfiguration({ NEKODEX_LOCAL_APP_SIGNING_IDENTITY: 'Developer ID Application: Other (OTHERTEAM0)' })).toThrow();
  expect(executionVmSigningConfiguration({ NEKODEX_LOCAL_APP_SIGNING_IDENTITY: `Developer ID Application: Publisher (${VM_PUBLISHER_TEAM_ID})` }).teamId).toBe(VM_PUBLISHER_TEAM_ID);
});

test('runtime kind and digest cannot forge admission or enter the development fallback', () => {
  const forged = Object.freeze({ kind: 'production-linux-vm', runtimeDigest: 'a'.repeat(64) }) as AdmittedVmRuntime;
  expect(() => vmRuntimeProtectedPaths(forged)).toThrow('vm-runtime-not-admitted');
  const fakeSelection = { production: { appBundlePath: '/Applications/NEKODEX.app', runtimeManifestPath: '/tmp/manifest', runtimeManifestSha256: 'a'.repeat(64) } } as VmRuntimeSelection;
  expect(() => admitDevelopmentVmRuntime(fakeSelection)).toThrow('vm-development-selection-required');
});
