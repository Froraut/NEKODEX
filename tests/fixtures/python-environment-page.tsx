// Actual production component with an inert action owner. No files, accounts, interpreters or models.
import { createElement, useState } from '../../launcher/node_modules/react';
import { createRoot } from '../../launcher/node_modules/react-dom/client';
import { AgentPythonEnvironments } from '../../launcher/src/AgentPythonEnvironments';
import type { AgentToolsApi, AgentToolsStatus, SkillPythonEnvironmentAction, SkillPythonEnvironmentDescriptor } from '../../launcher/src/agent-tools-types';

const environment: SkillPythonEnvironmentDescriptor = { environmentId: 'a'.repeat(64), runtimeClosureDigest: 'b'.repeat(64), lockDigest: 'c'.repeat(64), policyVersion: 1,
  packages: [{ name: 'first-dependency', version: '1.0', artifactSha256: 'd'.repeat(64) }, { name: 'second-dependency', version: '2.0', artifactSha256: 'e'.repeat(64) }], fileCount: 8, bytes: 900, state: 'ready' };
const persisted: SkillPythonEnvironmentAction = { actionId: '11111111-1111-4111-8111-111111111111', reviewDigest: 'f'.repeat(64), state: 'ready', ownerHeld: false, terminal: true, environment: { ...environment, environmentId: '9'.repeat(64) } };
const state = { requests: [] as any[], pickerCalls: 0, parentActCalls: 0, blockedParentActs: 0, errors: [] as string[], locked: false, generation: 1,
  actions: [persisted] as SkillPythonEnvironmentAction[], environments: [persisted.environment!] as SkillPythonEnvironmentDescriptor[], bindings: [] as NonNullable<AgentToolsStatus['scriptTools']>['environmentBindings'],
  lostPrepare: true, nextGeneration: () => {}, lockParent: () => {} };
(window as any).fixture = state;
const status = (): AgentToolsStatus => ({ config: { version: 1, enabled: false, servers: [] }, runtime: { enabled: false, servers: [], sandbox: 'inert' }, activeCount: 0,
  descriptors: [], skillRoots: [], selections: [], installCatalog: [], installations: { rows: [], truncated: false }, serverConfigDigests: {},
  capabilities: { stdio: false, install: false, oauth: false, secrets: false, nativeSandbox: false, skillWrites: false, skillScripts: true, pendingToolCalls: true },
  scriptTools: { closed: false, grants: [], activeOperations: [], capabilities: { supported: true, runtimes: { javascript: { supported: true }, python: { supported: true } } }, environmentBindings: structuredClone(state.bindings) },
  pythonEnvironments: { supported: true, environments: structuredClone(state.environments), actions: structuredClone(state.actions) } });
const api: AgentToolsApi = {
  pickSkillRoot: async () => ({ cancelled: true }), listTasks: async () => ({ tasks: [] }), getTask: async () => { throw new Error('No model/task provider in fixture'); },
  async pickPythonWheels() { state.pickerCalls++; return { cancelled: false, wheelPaths: ['/inert/first_dependency-1.0-py3-none-any.whl', '/inert/second_dependency-2.0-py3-none-any.whl'] }; },
  async request(body) {
    state.requests.push(structuredClone(body));
    if (body.action === 'reviewPythonEnvironment') {
      const action: SkillPythonEnvironmentAction = { actionId: String(body.actionId), reviewDigest: '8'.repeat(64), state: 'reviewed', terminal: false, ownerHeld: false, environment };
      state.actions.push(action); return structuredClone(action);
    }
    if (body.action === 'preparePythonEnvironment') {
      const action = state.actions.find(row => row.actionId === body.actionId)!;
      Object.assign(action, { state: 'ready', terminal: true }); state.environments.push(environment);
      if (state.lostPrepare) { state.lostPrepare = false; throw new Error('Synthetic lost preparation response'); }
      return structuredClone(action);
    }
    if (body.action === 'pythonEnvironmentAction') return structuredClone(state.actions.find(row => row.actionId === body.actionId) ?? null);
    if (body.action === 'bindPythonEnvironment') {
      const scope = body.scope as { taskId: string; generation: number };
      state.bindings = [{ id: 'binding-current', taskId: scope.taskId, generation: scope.generation, environmentId: String(body.environmentId), closureDigest: 'a'.repeat(64) }];
      return structuredClone(state.bindings[0]);
    }
    if (body.action === 'revokePythonEnvironment') { state.bindings = []; return { revoked: true }; }
    throw new Error('Unexpected fixture authority request');
  },
};
function Fixture() {
  const [snapshot, setSnapshot] = useState(status), [generation, setGeneration] = useState(1), [locked, setLocked] = useState(false);
  state.nextGeneration = () => { state.generation++; setGeneration(state.generation); };
  state.lockParent = () => { state.locked = true; setLocked(true); };
  const act = async (work: () => Promise<void>) => {
    state.parentActCalls++;
    if (state.locked) { state.blockedParentActs++; throw new Error('Locked parent action must not own privacy revocation'); }
    try { await work(); } catch (error) { state.errors.push(error instanceof Error ? error.message : String(error)); }
  };
  return createElement(AgentPythonEnvironments, { api, status: snapshot, scope: { taskId: 'fixture-task', generation, toolCallId: 'fixture-selection' }, locked,
    choose: (en: string) => en, act, onChanged: async () => { setSnapshot(status()); } });
}
createRoot(document.getElementById('root')!).render(createElement(Fixture));
