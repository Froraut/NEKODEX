import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { WorkspaceSurface } from '../src/WorkspaceSurface';
import RemoteWorkspaceSurface from '../src/RemoteWorkspaceSurface';
import { ExternalUsageSurface } from '../src/ExternalUsageSurface';
import '../src/tokens.css';
import '../src/styles.css';
import '../src/design/components.css';
import '../src/surfaces/workspace.css';
import type { LauncherApi } from '../src/types';

declare global { interface Window { __basicFixtureToken: string; basicFixture: { snapshot(): Promise<unknown> } } }
async function invoke(method: string, ...args: unknown[]) {
  const response = await fetch('/__basic-fixture', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Basic-Fixture-Token': window.__basicFixtureToken }, body: JSON.stringify({ method, args }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error); return body.result;
}
const api = new Proxy({}, { get: (_target, method: string) => (...args: unknown[]) => invoke(method, ...args) }) as LauncherApi;
window.codexWebLauncher = api;
window.basicFixture = { snapshot: () => invoke('fixtureSnapshot') };
const usage = { request: (input: unknown) => invoke('usageRequest', input), selectRoot: (input: unknown) => invoke('usageSelectRoot', input) };
function Fixture() {
  const [screen, setScreen] = useState('workspace');
  return <main style={{ padding: 20 }}><p>Disposable fixture: real temp files and metadata services. SSH and terminals are disabled. File manager requests are recorded.</p>
    <nav style={{ display: 'flex', gap: 12, marginBottom: 20 }}>
      {['workspace', 'remote', 'usage'].map(name => <button key={name} type="button" onClick={() => setScreen(name)}>{name}</button>)}
    </nav>
    {screen === 'workspace' ? <WorkspaceSurface language="en" /> : screen === 'remote' ? <RemoteWorkspaceSurface language="en" api={api} /> : <ExternalUsageSurface language="en" api={usage} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
