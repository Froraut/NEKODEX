'use strict';
/** Known credential paths only. This does not inspect source file contents. */
const PYTHON_BUILD_CREDENTIAL_POLICY = Object.freeze({
  names: Object.freeze(['.ssh','.aws','.codex','.claude','.gemini','.npmrc','.pypirc','.netrc','credentials.json','auth.json','storage-state.json']),
  patterns: Object.freeze(['^\\.env(?:\\.|$)','^(?:id_rsa|id_ed25519|client_secret)','\\.(?:pem|key|p12|pfx)$']),
});
const credentialNames = new Set(PYTHON_BUILD_CREDENTIAL_POLICY.names);
const patterns = PYTHON_BUILD_CREDENTIAL_POLICY.patterns.map(pattern => new RegExp(pattern,'i'));
function isKnownPythonBuildCredentialName(name) { return credentialNames.has(name.toLowerCase()) || patterns.some(pattern => pattern.test(name)); }
function excludedPythonBuildSourceName(name) { return ['.git','node_modules','.venv','venv','__pycache__','.DS_Store'].includes(name) || isKnownPythonBuildCredentialName(name); }
module.exports={PYTHON_BUILD_CREDENTIAL_POLICY,isKnownPythonBuildCredentialName,excludedPythonBuildSourceName};
