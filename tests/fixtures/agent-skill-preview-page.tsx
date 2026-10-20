// An inert isolated host for the production component; no Electron or model provider.
import { createElement, useEffect, useState } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { AgentManagedSkills } from '../../launcher/src/AgentManagedSkills';
import type { AgentToolsApi, AgentToolsStatus, SkillIdentity } from '../../launcher/src/agent-tools-types';

const request: AgentToolsApi['request'] = async body => {
  const response = await fetch('/admin/agent-tools', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'inert-preview-fixture' },
    body: JSON.stringify(body),
  });
  const packet = await response.json();
  if (!response.ok || !packet.ok) throw new Error(packet.message || packet.error || 'Fixture request failed');
  return packet.value;
};
const api: AgentToolsApi = {
  request,
  pickSkillRoot: async () => ({ cancelled: true }),
  listTasks: async () => ({ tasks: [] }),
  getTask: async () => { throw new Error('No task exists in this isolated fixture'); },
};
function Fixture() {
  const [status, setStatus] = useState<AgentToolsStatus | null>(null);
  const [sources, setSources] = useState<SkillIdentity[]>([]);
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
  return createElement('main', null,
    createElement('h1', null, 'Isolated local skill preview fixture'),
    createElement('p', null, 'Actual component and local import actor. Temporary files; no model or account.'),
    error ? createElement('p', { role: 'alert' }, error) : null,
    createElement(AgentManagedSkills, { api, status, sources, locked, choose: (en: string) => en, act, refresh }),
  );
}
createRoot(document.getElementById('root')!).render(createElement(Fixture));
