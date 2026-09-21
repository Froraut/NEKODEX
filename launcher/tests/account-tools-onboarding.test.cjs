const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const compiled = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src/account-tools-onboarding.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText;
const loaded = { exports: {} };
Function('module', 'exports', compiled)(loaded, loaded.exports);
const { accountToolsStep, accountToolsHandoffAccount } = loaded.exports;
const account = { id: 'a', authenticated: true, authenticationStatus: 'verified', checked: false, connectorReady: false };

test('sign-in and a shared runtime never stand in for this account connector verification', () => {
  assert.equal(accountToolsStep({ ...account, authenticated: false }, true), 'sign-in');
  assert.equal(accountToolsStep({ ...account, authenticationStatus: 'unavailable', checked: true, connectorReady: true }, true), 'sign-in');
  assert.equal(accountToolsStep(account, false), 'runtime');
  assert.equal(accountToolsStep(account, true), 'connector');
  assert.equal(accountToolsStep({ ...account, connectorReady: true }, true), 'connector');
  assert.equal(accountToolsStep({ ...account, checked: true, connectorReady: true }, true), 'verified');
});

test('handoff is owned by the verified browser identity and rejects a stale pool selection', () => {
  const browser = { accountId: 'a', authenticated: true, authenticationStatus: 'verified', loginInProgress: false };
  const pool = { selectedId: 'a', accounts: [account, { ...account, id: 'b', checked: true, connectorReady: true }] };
  assert.equal(accountToolsHandoffAccount(browser, pool)?.id, 'a');
  assert.equal(accountToolsHandoffAccount({ ...browser, accountId: 'b' }, pool), null);
  assert.equal(accountToolsHandoffAccount(browser, { ...pool, selectedId: 'b' }), null);
  assert.equal(accountToolsHandoffAccount({ ...browser, loginInProgress: true }, pool), null);
  assert.equal(accountToolsHandoffAccount({ ...browser, authenticationStatus: 'unavailable' }, pool), null);
  assert.equal(accountToolsHandoffAccount(browser, { ...pool, accounts: [{ ...account, checked: true, connectorReady: true }] }), null);
});
