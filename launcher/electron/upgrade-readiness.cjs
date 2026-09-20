const { createHash } = require('node:crypto');

// Increment when a release changes the connector/setup contract. Missing or older
// epochs require verification once; a version number alone never proves compatibility.
const SETUP_CONTRACT = 1;
function setupIdentity(config, account) {
  if (!config || typeof account !== 'string' || !account) return null;
  const keys = ['mode', 'browserInteractionMode', 'appName', 'port', 'solAvailable',
    'extraHighAvailable', 'proAvailable', 'experimentalBiggerContext', 'zeroRiskProEnabled',
    'experimentalAsyncToolOperations', 'subagentProtocol', 'tunnel', 'automaticTunnel', 'manualTunnel'];
  return createHash('sha256').update(JSON.stringify({ account,
    config: Object.fromEntries(keys.map(key => [key, config[key] ?? null])) })).digest('hex');
}
function preserveSetup(previous, current, state, migration) {
  return !migration && state.setupContract === SETUP_CONTRACT && previous !== null
    && previous === current && state.coreSetupComplete === true;
}
function setupProofCurrent(state, identity, connectorName) {
  return state?.mcpSetupComplete === true
    && state.setupContract === SETUP_CONTRACT
    && identity !== null
    && state.setupIdentityHash === identity
    && state.setupConnectorName === connectorName
    && typeof state.setupVerifiedAt === "string"
    && Number.isFinite(Date.parse(state.setupVerifiedAt));
}
module.exports = { SETUP_CONTRACT, setupIdentity, preserveSetup, setupProofCurrent };
