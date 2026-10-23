// Inert production Accounts presentation: no real profiles, cookies, process or config access.
import { createElement, useState } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { AccountSettings } from '../../launcher/src/AccountSettings';
import { copyFor } from '../../launcher/src/i18n';
import type { AccountPoolSnapshot, Language } from '../../launcher/src/types';
import '../../launcher/src/tokens.css';
import '../../launcher/src/styles.css';
import '../../launcher/src/design/components.css';
import '../../launcher/src/surfaces/accounts.css';

const language = (new URL(location.href).searchParams.get('language') ?? 'en') as Language;
let sequence = 1;
const listeners = new Set<(value: any) => void>();
const make = (id: string, label: string, authenticated: boolean) => ({ id, label, enabled: true,
  authenticated, authenticationStatus: authenticated ? 'verified' : 'signed-out', activeTurns: 0,
  checked: authenticated, connectorReady: false, evidenceEpoch: 1, accountLabel: null,
  authenticationCheckedAt: '2026-10-23T00:00:00Z', capabilities: { solAvailable: true, extraHighAvailable: false, proAvailable: false },
});
let snapshot = { selectedId: '11111111-1111-4111-8111-111111111111', mode: 'selected',
  accounts: [make('default', 'Primary fixture', true), make('11111111-1111-4111-8111-111111111111', 'Work fixture', true),
    make('22222222-2222-4222-8222-222222222222', 'Signed-out fixture', false)] } as unknown as AccountPoolSnapshot;
const fixture = { requests: [] as any[], failNext: false, holdNext: false, manual: false, release: () => {},
  setActive(id: string, active: boolean) { snapshot.accounts.find(row => row.id === id)!.activeTurns = active ? 1 : 0; publish(); },
  setUnavailable(id: string) { snapshot.accounts.find(row => row.id === id)!.authenticationStatus = 'unavailable'; publish(); },
};
(window as any).accountCardFixture = fixture;
const read = () => structuredClone({ ...snapshot, observation: { sourceId: 'accounts-fixture', revision: sequence } });
function publish() { sequence++; listeners.forEach(listener => listener({ observation: { sourceId: 'accounts-fixture', revision: sequence } })); }
async function mutate(action: string, id: string, payload?: any) {
  fixture.requests.push({ action, id, payload });
  if (fixture.holdNext) { fixture.holdNext = false; await new Promise<void>(resolve => { fixture.release = resolve; }); }
  if (fixture.failNext) { fixture.failNext = false; throw new Error('Inert fixture: action refused; original account retained.'); }
  if (action === 'rename') snapshot.accounts.find(row => row.id === id)!.label = payload;
  if (action === 'remove') { snapshot.accounts = snapshot.accounts.filter(row => row.id !== id); if (snapshot.selectedId === id) snapshot.selectedId = snapshot.accounts.find(row => row.enabled)!.id; }
  if (action === 'select' || action === 'reauthenticate' || action === 'login') snapshot.selectedId = id;
  if (action === 'enabled') snapshot.accounts.find(row => row.id === id)!.enabled = payload;
  publish(); return read();
}
(window as any).codexWebLauncher = {
  accounts: async () => read(), onBrowserState(listener: any) { listeners.add(listener); return () => listeners.delete(listener); }, onOperation: () => () => {},
  codexLoginSnapshot: async () => null, accountCodexQuotaSnapshot: async () => null,
  refreshAccountCodexQuota: async (id: string) => ({ accountId: id, status: 'unavailable', windows: [] }),
  renameAccount: (id: string, label: string) => mutate('rename', id, label),
  removeAccount: (id: string, confirmed: boolean) => mutate('remove', id, confirmed),
  reauthenticateAccount: (id: string, confirmed: boolean) => mutate('reauthenticate', id, confirmed),
  selectAccount: (id: string) => mutate('select', id), openAccountLogin: (id: string) => mutate('login', id),
  setAccountEnabled: (id: string, enabled: boolean) => mutate('enabled', id, enabled),
  checkAccount: (id: string) => mutate('check', id), setAccountMode: async (mode: any) => { snapshot.mode = mode; publish(); return read(); },
};
function Page() {
  const [error, setError] = useState<string | null>(null);
  return createElement('main', { style: { height: '100vh', overflow: 'auto', padding: '24px' } },
    createElement('p', { role: 'note' }, 'Inert Accounts fixture · no real account operations'),
    error ? createElement('p', { role: 'alert' }, error) : null,
    createElement(AccountSettings, { copy: copyFor(language), language, openBrowser: () => fixture.requests.push({ action: 'open-browser' }),
      setError, manual: fixture.manual, focusAccountId: null, toolsSetup: { runtimeConfigured: false, connectorName: '', urls: {} as any }, onSetupTools() {} }));
}
createRoot(document.getElementById('root')!).render(createElement(Page));
