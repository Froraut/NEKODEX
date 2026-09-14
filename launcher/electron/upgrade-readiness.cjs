const { createHash } = require('node:crypto');

// Increment when a release changes the connector/setup contract. Missing or older
// epochs require verification once; a version number alone never proves compatibility.
const SETUP_CONTRACT = 1;
function setupIdentity(config, account) {
  if (!config || typeof account !== 'string' || !account) return null;
  const keys = ['mode', 'browserInteractionMode', 'appName', 'port', 'solAvailable',
    'extraHighAvailable', 'proAvailable', 'experimentalBiggerContext', 'zeroRiskProEnabled',
    'subagentProtocol', 'tunnel', 'automaticTunnel', 'manualTunnel'];
  return createHash('sha256').update(JSON.stringify({ account,
    config: Object.fromEntries(keys.map(key => [key, config[key] ?? null])) })).digest('hex');
}
function preserveSetup(previous, current, state, migration) {
  return !migration && state.setupContract === SETUP_CONTRACT && previous !== null
    && previous === current && state.coreSetupComplete === true;
}
module.exports = { SETUP_CONTRACT, setupIdentity, preserveSetup };
