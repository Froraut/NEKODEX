'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fileDigest, regular, verifyWrapper } = require('./owned-native-admission.cjs');
// Reviewed local development build receipt. Packaging supplies a separate manifest.
// Another file appearing in build/ never acquires execution authority automatically.
const PIN = Object.freeze({ target: 'aarch64-apple-darwin',
  executableSha256: 'b1ba58f72cd46caa3d69018bbbb68c2b8afb85dfb9167bba69272dde716a30d6',
  metadataSha256: '7ceee884e7992d369105929f646d3e71b01b1b02e5e5d545d0bfdda4e15dccc3',
  sourcePinSha256: '3b5bc45bbbd6c5170c4786b63276837d8fe1eaf4339c1a90aa13d5b2e61c3fcc' });
function reviewedOwnedNativeDevPin(sourceRoot) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('No reviewed Native development build for this target');
  sourceRoot = fs.realpathSync(path.join(sourceRoot, 'launcher', 'native', 'owned-worker'));
  const output = path.join(sourceRoot, 'build', PIN.target), executable = path.join(output, 'nekodex-owned-native-worker');
  const wrapperBuildPin = { sourceRoot, metadataPath: path.join(output, 'build-info.json'),
    metadataSha256: PIN.metadataSha256, sourcePinSha256: PIN.sourcePinSha256 };
  if (fileDigest(executable) !== PIN.executableSha256) throw new Error('Native development executable changed');
  verifyWrapper(executable, PIN.executableSha256, wrapperBuildPin);
  const metadata = JSON.parse(regular(wrapperBuildPin.metadataPath, 16384));
  return { executable, executableSha256: PIN.executableSha256, wrapperBuildPin, target: PIN.target,
    officialBootstrapCatalog: metadata.officialBootstrapCatalog };
}
module.exports = { reviewedOwnedNativeDevPin };
