// Isolated component host. The picker returns only an inert temporary path.
import { createElement, useEffect, useState } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { AgentManagedSkills } from '../../launcher/src/AgentManagedSkills';
import { AgentSkillScripts } from '../../launcher/src/AgentSkillScripts';
import type { AgentToolsApi, AgentToolsStatus, SkillIdentity, ToolScope } from '../../launcher/src/agent-tools-types';

const request: AgentToolsApi['request'] = async body => {
  const response = await fetch('/admin/agent-tools', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'inert-script-preview-fixture' }, body: JSON.stringify(body) });
  const packet = await response.json();
  if (!response.ok || !packet.ok) throw new Error(packet.message || packet.error || 'Fixture request failed');
  return packet.value;
};
const api: AgentToolsApi = {
  request,
  pickSkillRoot: async () => ({ cancelled: true }),
  pickScriptWorkspace: async () => (await fetch('/fixture-picker')).json(),
  listTasks: async () => ({ tasks: [] }),
  getTask: async () => { throw new Error('No model runtime exists in this fixture'); },
};
function Fixture() {
  const [status, setStatus] = useState<AgentToolsStatus | null>(null);
  const [sources, setSources] = useState<SkillIdentity[]>([]);
  const [scope, setScope] = useState<ToolScope>();
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState('');
  const refresh = async () => { setStatus(await request({ action: 'status' }) as AgentToolsStatus); };
  useEffect(() => { void fetch('/fixture-bootstrap').then(response => response.json()).then(packet => {
    setSources(packet.sources); setStatus(packet.status);
  }).catch(error => setError(String(error))); }, []);
  const act = async (operation: () => Promise<void>) => {
    setLocked(true); setError('');
    try { await operation(); } catch (error) { setError(String(error)); } finally { setLocked(false); }
  };
  const choose = (en: string) => en;
  return createElement('main', null,
    createElement('h1', null, 'Isolated reviewed script and workspace fixture'),
    createElement('p', null, 'Actual components and local actor. Temporary data; no model, account or script execution.'),
    createElement('nav', { 'aria-label': 'Fixture task selection' },
      createElement('button', { disabled: locked || Boolean(scope), onClick: () => void act(async () => {
        setScope(await (await fetch('/fixture-scope')).json());
      }) }, 'Select fixture task'),
      createElement('button', { disabled: locked || !scope, onClick: () => void act(async () => {
        setScope(await (await fetch('/fixture-scope', { method: 'POST' })).json()); await refresh();
      }) }, 'Advance fixture task generation'),
    ),
    error ? createElement('p', { role: 'alert' }, error) : null,
    createElement(AgentManagedSkills, { api, status, sources, scope, locked, choose, act, refresh }),
    createElement(AgentSkillScripts, { api, status, scope, locked, choose, act, onChanged: refresh }),
  );
}
createRoot(document.getElementById('root')!).render(createElement(Fixture));
