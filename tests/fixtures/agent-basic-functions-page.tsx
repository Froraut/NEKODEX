/** Inert renderer-only review: no preload, filesystem, provider, network or process tools. */
import { createElement, useState } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { AgentModeSurface } from '../../launcher/src/AgentModeSurface';
import { AgentToolsInstaller } from '../../launcher/src/AgentToolsInstaller';
import { OFFICIAL_MCP_CATALOG } from '../../src/agent-tools/installer';
import { AgentToolsSurface } from '../../launcher/src/AgentToolsSurface';
import type { AgentTask } from '../../src/agent-mode/types';
import type { AgentModeApi } from '../../launcher/src/agent-mode-types';
import type { AgentToolsApi, AgentToolsStatus } from '../../launcher/src/agent-tools-types';
import '../../launcher/src/tokens.css';
import '../../launcher/src/design/components.css';
const requests: Record<string, unknown>[] = [];
const params = new URLSearchParams(location.search), taskId = 'task-0';
const task = (index: number): AgentTask => ({ schemaVersion: 1, id: `task-${index}`, familyId: `family-${index}`, ownerMode: 'agent', mode: 'manual', status: 'stopped', generation: 1, revision: 1, originalRequest: `Inert fixture task ${index}`, corrections: [], requirements: [{ id: 'r', text: 'Inert evidence' }], stages: [], bounds: { maxConcurrent: 1, maxTurns: 1, maxSpend: null }, turns: 0, spent: 0, reserved: 0, unpricedTurns: 0, evidenceRevision: 1, evidence: [], cycle: 1, createdAt: index, updatedAt: index, ...(index === 0 ? { archivedAt: 100 } : {}) });
const tasks = Array.from({ length: 57 }, (_, index) => task(index));
const modeApi: AgentModeApi = { async request(body) {
  requests.push(body);
  if (body.action === 'status') {
    if (params.get('state') === 'unavailable') throw new Error('Inert task inventory unavailable');
    const list = body.listing as { view?: string; query?: string; offset?: number } | undefined;
    const matches = tasks.filter(row => Boolean(row.archivedAt) === (list?.view === 'archived') && (!list?.query || `${row.id} ${row.originalRequest}`.toLowerCase().includes(list.query.toLowerCase()))).reverse();
    const offset = list?.offset ?? 0;
    return { configured: false, models: [], capabilities: { tools: false, workspace: false, autoSchedule: false }, tasks: matches.slice(offset, offset + 25), total: matches.length, archived: 1, offset, nextOffset: offset + 25 < matches.length ? offset + 25 : null, truncated: matches.length > 25 };
  }
  if (body.action === 'get') return { task: tasks.find(row => row.id === body.taskId), workers: [], dispatches: [], messages: [], receipts: [{ id: 'archive-proof', kind: 'fixture-retained', body: { note: 'Retained inert result; no live provider proof' } }], toolOutcomes: [], workPackets: [] };
  throw new Error(`Unexpected task mutation in readonly fixture: ${body.action}`);
} };
const skill = { id: 'skill-a', grantId: 'root-a', relativePath: 'SKILL.md', source: 'user' as const, digest: 'a'.repeat(64), bytes: 30 };
const grant = { id: 'grant-a', taskId, generation: 1, root: '/inert/workspace', dev: 1, ino: 1, access: 'read-only' };
let approved = false, release: (() => void) | undefined;
const tools = {
  config: { version: 1, enabled: true, servers: [{ id: 'inert', enabled: false, transport: 'stdio', source: { kind: 'user-installed', label: 'Inert saved server', version: '1' }, command: '/inert/node', commandSha256: 'b'.repeat(64), args: ['/inert/server.js', '--local'], pinnedFiles: [{ path: '/inert/server.js', sha256: 'c'.repeat(64) }], cwd: '/inert', envSecretRefs: {} }] },
  runtime: { enabled: true, servers: [], sandbox: 'inert' }, activeCount: 0, descriptors: [],
  skillRoots: [{ id: skill.grantId, root: '/inert/skills', source: 'user', label: 'Inert instructions' }], selections: [{ scope: { taskId, generation: 1, toolCallId: 'selection' }, skills: [skill] }],
  installCatalog: [], installations: { rows: [], truncated: false }, serverConfigDigests: { inert: 'd'.repeat(64) },
  capabilities: { stdio: false, install: false, oauth: false, secrets: false, nativeSandbox: false, skillWrites: false, pendingToolCalls: true, skillScripts: true },
  scriptTools: { capabilities: { supported: true, runtimes: { javascript: { supported: true }, python: { supported: false, reason: 'Inert fixture' } } }, closed: false, grants: [grant], activeOperations: [] },
} as unknown as AgentToolsStatus;
const toolsApi: AgentToolsApi = { async request(body) {
  requests.push(body);
  if (body.action === 'status') return structuredClone(tools);
  if (body.action === 'remoteStatus') return null;
  if (body.action === 'skillsDeselect') { tools.selections = tools.selections.map(row => row.scope.taskId === (body.scope as any).taskId ? { ...row, skills: [] } : row); return tools; }
  if (body.action === 'skillsDiscover') return { skills: [], truncated: false };
  if (body.action === 'vmNetworkStatus') return { mode: 'separately-approved-host-broker', guestNic: false, available: false, grants: [] };
  if (body.action === 'approveInvoke') { tools.scriptTools!.activeOperations = [{ operationId: 'inert-running-script', workspaceGrantId: grant.id, taskId, generation: 1 }]; await new Promise<void>(resolve => { release = resolve; }); approved = true; return { scope: body.scope, tool: 'skill-script/run', idempotencyKey: 'inert-call', state: 'failed', reason: 'Inert request cancelled; no script executed' }; }
  if (body.action === 'revokeScriptWorkspace') { tools.scriptTools!.grants = []; tools.scriptTools!.activeOperations = []; release?.(); return { revoked: true }; }
  if (body.action === 'reviewServer') return { reviewId: 'inert-review', recipe: { ...tools.config.servers[0], source: { kind: 'user-installed', label: (body.input as any).label, version: (body.input as any).version }, args: (body.input as any).args, cwd: (body.input as any).cwd }, trust: 'Inert preview only; no files observed' };
  if (body.action === 'saveServer') return tools; // recorded only, never config write
  throw new Error(`Unexpected inert action: ${body.action}`);
}, pickSkillRoot: async () => ({ cancelled: true }), listTasks: async () => ({ tasks: [{ id: taskId, generation: 1, status: 'awaiting_input' }] }), getTask: async id => ({ task: { id, familyId: 'family-inert', generation: 1, revision: 1, status: id === taskId ? 'awaiting_input' : 'stopped' }, dispatches: [], pendingToolCalls: approved || id !== taskId ? [] : [{ toolCallId: 'call-a', tool: 'skill-script/run', arguments: { workspaceGrantId: grant.id, versionId: 'e'.repeat(64), relativePath: 'run.mjs', argv: [] } }] }) };
function InstallerFixture() {
  const [locked, setLocked] = useState(false), [error, setError] = useState('');
  const receipt = { actionId: 'retained-installation', catalogId: 'official-filesystem', allowedRoot: '/inert/old-root', state: params.get('state') === 'unknown' ? 'outcome_unknown' : params.get('state') === 'held' ? 'failed' : 'installed', ...(params.get('state') === 'held' ? { childPid: 44 } : {}) };
  const status = { ...tools, capabilities: { ...tools.capabilities, install: true }, installCatalog: OFFICIAL_MCP_CATALOG, installations: { rows: [receipt], truncated: false } } as AgentToolsStatus;
  const api = { ...toolsApi, async request(body: Record<string, unknown>) {
    requests.push(body);
    if (body.action === 'installReceipt') return body.actionId === receipt.actionId ? receipt : null;
    if (body.action === 'prepareInstall') return { actionId: body.actionId, catalogId: body.catalogId, allowedRoot: body.allowedRoot, state: 'prepared' };
    throw new Error(`Unexpected installer fixture action: ${body.action}`);
  } };
  return createElement('div', null,
    createElement('p', null, 'Inert installer fixture: no packages, files, network or processes.'),
    error ? createElement('p', { role: 'alert' }, error) : null,
    createElement(AgentToolsInstaller, { api, status, locked, choose: en => en, refresh: async () => {}, onReview: () => {}, act: async operation => { if (locked) return; setLocked(true); try { await operation(); } catch (cause) { setError(String(cause)); } finally { setLocked(false); } } }));
}
(window as any).basicFunctionsFixture = { requests, tools };
createRoot(document.getElementById('root')!).render(params.get('surface') === 'installer' ? createElement(InstallerFixture) : params.get('surface') === 'tasks' ? createElement(AgentModeSurface, { api: modeApi, language: 'en' }) : createElement(AgentToolsSurface, { api: toolsApi, language: 'en' }));
