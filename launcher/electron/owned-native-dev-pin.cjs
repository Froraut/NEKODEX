'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { fileDigest, regular, verifyWrapper } = require('./owned-native-admission.cjs');
// Reviewed local development build receipt. Packaging supplies a separate manifest.
// Another file appearing in build/ never acquires execution authority automatically.
const PIN = Object.freeze({ target: 'aarch64-apple-darwin',
  executableSha256: '835674dd9455f7394ee0992596ad39d03d6872a739afec4afedd7c543a039d64',
  metadataSha256: 'c36b1fa061944512c106db652258489f12087c09f4c2fdbecdd49e91f7f3332f',
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
