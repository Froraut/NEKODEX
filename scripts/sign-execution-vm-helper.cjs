'use strict';
const { spawnSync } = require('node:child_process');
const { signingConfiguration, assertMacPublisher } = require('../launcher/scripts/release-signing.cjs');
const TEAM = 'CNMWGJF2CG';
const IDENTIFIER = 'com.nekodex.execution-vm-helper';

/** Uses the existing release/local publisher settings. Trust is fixed to the
 * installer publisher; configuration chooses a key, never a new trust anchor. */
function executionVmSigningConfiguration(env = process.env) {
  const release = signingConfiguration('darwin', env).release;
  const identity = release ? env.CSC_NAME : env.NEKODEX_LOCAL_APP_SIGNING_IDENTITY;
  const keychain = release ? env.CODEX_WEB_GPT_SIGNING_KEYCHAIN : env.NEKODEX_LOCAL_APP_SIGNING_KEYCHAIN;
  if (typeof identity !== 'string' || !/^Developer ID Application: .+ \(CNMWGJF2CG\)$/.test(identity)
    || (release && env.APPLE_TEAM_ID !== TEAM)) throw new Error('Execution VM production helper requires the configured NEKODEX Developer ID publisher');
  return { identity, keychain, teamId: TEAM, identifier: IDENTIFIER };
}
function signExecutionVmHelper(target, entitlements, env = process.env) {
  const config = executionVmSigningConfiguration(env);
  const run = args => {
    const result = spawnSync('/usr/bin/codesign', args, { env, shell: false, encoding: 'utf8', stdio: 'pipe', timeout: 30000, maxBuffer: 128 * 1024 });
    if (result.error || result.status !== 0) throw new Error('Execution VM publisher signing or verification failed');
    return `${result.stdout || ''}\n${result.stderr || ''}`;
  };
  run(['--force', '--options', 'runtime', '--timestamp', '--identifier', IDENTIFIER, '--entitlements', entitlements,
    ...(config.keychain ? ['--keychain', config.keychain] : []), '--sign', config.identity, target]);
  run(['--verify', '--strict', target]);
  const details = run(['--display', '--verbose=4', target]);
  assertMacPublisher(details, TEAM);
  if (!details.split('\n').includes(`Identifier=${IDENTIFIER}`)) throw new Error('Execution VM helper publisher identifier changed');
}
module.exports = { executionVmSigningConfiguration, signExecutionVmHelper };
