const path = require('node:path');
const ACTIONS = new Set(['status', 'list', 'get', 'create', 'control', 'step', 'run', 'review', 'verify', 'evidence', 'workspace-grant', 'resume-continuation', 'enqueue-work', 'cycle', 'workspace-evidence', 'reconcile-tool', 'refresh-execution', 'archive', 'reconcile-dispatch', 'semantic-review']);
const UUID = /^[a-f0-9-]{36}$/;
const record = value => Boolean(value && typeof value === 'object' && !Array.isArray(value));
const owns = (value, name) => Object.prototype.hasOwnProperty.call(value, name);
function selection(value) {
  if (!record(value) || Object.keys(value).sort().join(',') !== 'paths,rootId' || !UUID.test(value.rootId)
      || !Array.isArray(value.paths) || !value.paths.length || value.paths.length > 64 || new Set(value.paths).size !== value.paths.length
      || value.paths.some(file => typeof file !== 'string' || !file || file.length > 4096 || file.includes('\\') || file.includes('\0') || file.startsWith('/') || /^[A-Za-z]:/.test(file)
        || file.split('/').some(part => !part || part === '.' || part === '..' || part.toLowerCase() === '.git'))) throw new Error('Select 1–64 exact relative workspace files');
  return value;
}
/** The existing guarded handle and owned supervisor are the only transport.
 * Main alone derives/signs snapshot authority from a previously picked root. */
function registerAgentMode({ handle, runtimeHost, workspaceService, workspaceEvidenceService, getApplicationVersion, beforeTaskAuthorityChange = () => {} }) {
  handle('launcher:agent-mode', async (_event, body) => {
    if (!record(body) || !ACTIONS.has(body.action) || Buffer.byteLength(JSON.stringify(body), 'utf8') > 600000) throw new Error('Invalid Agent mode request');
    if (owns(body, 'grant') || owns(body, 'workspaceSnapshotGrant') || (record(body.input) && owns(body.input, 'workspaceSnapshotGrant'))) {
      throw new Error('Workspace snapshot authority must be prepared by the main process');
    }
    if (owns(body, 'proof') || owns(body, 'observation') || owns(body, 'outcome')) throw new Error(body.action === 'reconcile-tool' ? 'Retained tool outcomes must come from the owned tool journal' : 'Artifact evidence must be observed by the main process');
    if (body.action === 'reconcile-tool' && (Object.keys(body).some(key => !['action', 'taskId', 'actionId', 'scope', 'idempotencyKey'].includes(key))
        || typeof body.idempotencyKey !== 'string' || !body.idempotencyKey.trim() || body.idempotencyKey.length > 128)) throw new Error('Invalid retained tool outcome lookup');
    // A user-recorded outcome for an unknown send: exact keys only, and nothing in it can carry a receipt or resend.
    if (owns(body, 'disposition') !== (body.action === 'reconcile-dispatch')
        || body.action === 'reconcile-dispatch' && (Object.keys(body).some(key => !['action', 'taskId', 'actionId', 'scope', 'dispatchId', 'disposition'].includes(key))
          || typeof body.dispatchId !== 'string' || !body.dispatchId.trim() || body.dispatchId.length > 128 || !record(body.scope)
          || !record(body.disposition) || Object.keys(body.disposition).some(key => !['kind', 'note'].includes(key))
          || !['abandoned', 'confirmed_delivered'].includes(body.disposition.kind)
          || (owns(body.disposition, 'note') && (typeof body.disposition.note !== 'string' || !body.disposition.note.trim() || body.disposition.note.length > 2000)))) throw new Error('Invalid unknown send reconciliation');
    if (owns(body, 'workspaceSelection') && !['create', 'workspace-grant'].includes(body.action)) throw new Error('Invalid Agent workspace action');
    if (owns(body, 'evidenceSelection') && body.action !== 'workspace-evidence') throw new Error('Invalid Agent evidence action');
    const supervisor = runtimeHost.supervisor;
    const config = supervisor.readConfig();
    const applicationVersion = getApplicationVersion?.();
    // Native account inventory and closure use separate main-owned IPC. Only
    // core-backed task requests wait for the safe runtime generation switch.
    const pendingVersion = supervisor.launcherProfile === 'production'
      && typeof applicationVersion === 'string' && applicationVersion.length > 0
      && typeof config?.releaseVersion === 'string' && config.releaseVersion.length > 0
      && config.releaseVersion !== applicationVersion;
    const pendingMessage = `Application ${applicationVersion} is installed; runtime ${config?.releaseVersion} is still active. This Agent mode action requires the automatic safe runtime switch. Existing work continues.`;
    const allowDraining = ['status', 'list', 'get', 'reconcile-tool'].includes(body.action)
      || body.action === 'control' && record(body.control)
        && Object.keys(body.control).join(',') === 'action' && ['pause', 'stop'].includes(body.control.action);
    if (pendingVersion && !allowDraining) throw new Error(pendingMessage);
    beforeTaskAuthorityChange(body);
    if (!config || !await supervisor.ownedAgentRuntimeReady(config, { allowDraining })) throw new Error('Start the current NEKODEX runtime to use Agent mode');
    const send = async payload => {
      let receipt;
      try {
        // One independent reviewer model turn can outlast the ordinary short control wait.
        receipt = await supervisor.control(config, 'agent-mode', { body: payload, returnErrorReceipt: true, ...(payload.action === 'semantic-review' ? { timeoutMs: 300_000 } : {}) });
      } catch (error) {
        if (pendingVersion && /\bHTTP 404\b/.test(error instanceof Error ? error.message : String(error))) throw new Error(pendingMessage);
        throw error;
      }
      if (!receipt || receipt.ok !== true) throw new Error(receipt?.message || receipt?.error || 'Agent mode operation failed');
      return receipt.value;
    };
    const { workspaceSelection, evidenceSelection, ...payload } = body;
    if (body.action === 'workspace-evidence') {
      if (!workspaceEvidenceService) throw new Error('Trusted workspace artifact observation is unavailable');
      if (Object.keys(body).some(key => !['action', 'taskId', 'actionId', 'scope', 'evidenceSelection'].includes(key))
          || !record(evidenceSelection) || Object.keys(evidenceSelection).some(key => !['workspaceId', 'relativePath', 'requirementId', 'property', 'expectedSha256'].includes(key))
          || !UUID.test(body.actionId) || typeof evidenceSelection.requirementId !== 'string' || !evidenceSelection.requirementId
          || !['file-exists', 'file-sha256'].includes(evidenceSelection.property)
          || (evidenceSelection.property === 'file-sha256' && (typeof evidenceSelection.expectedSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(evidenceSelection.expectedSha256)))
          || (evidenceSelection.property !== 'file-sha256' && evidenceSelection.expectedSha256 !== undefined)) throw new Error('Invalid workspace artifact observation');
      selection({ rootId: evidenceSelection.workspaceId, paths: [evidenceSelection.relativePath] });
      const current = await send({ action: 'get', taskId: body.taskId });
      const task = current?.task;
      if (!task || !record(body.scope) || body.scope.familyId !== task.familyId || body.scope.generation !== task.generation || body.scope.revision !== task.revision) throw new Error('Task generation changed; refresh before observing evidence');
      if (!Array.isArray(task.requirements) || !task.requirements.some(row => row.id === evidenceSelection.requirementId)) throw new Error('Select a requirement from the current task');
      const scope = { familyId: task.familyId, generation: task.generation, revision: task.revision };
      const proof = await workspaceEvidenceService.observe({ task, observationId: body.actionId, ...evidenceSelection });
      return send({ ...payload, scope, proof });
    }
    if (workspaceSelection !== undefined || body.action === 'workspace-grant') {
      if (!workspaceService) throw new Error('Agent workspace snapshots are unavailable');
      const selected = selection(workspaceSelection);
      if (body.action === 'create') {
        if (!record(body.input) || !UUID.test(body.input.id) || (body.input.familyId !== undefined && !UUID.test(body.input.familyId))) throw new Error('A stable task and family identity is required');
        const familyId = body.input.familyId ?? body.input.id;
        const grant = workspaceService.prepareAgentWorkspaceGrant(selected.rootId, selected.paths,
          { taskId: body.input.id, familyId, generation: 1 });
        return send({ ...payload, input: { ...body.input, familyId, workspaceSnapshotGrant: grant } });
      }
      // Never sign a caller-asserted family/generation. Read the owned task, then
      // compare the visible captured scope before preparing a renewal.
      const current = await send({ action: 'get', taskId: body.taskId });
      const task = current?.task;
      if (!task || !record(body.scope) || body.scope.familyId !== task.familyId || body.scope.generation !== task.generation || body.scope.revision !== task.revision) throw new Error('Task generation changed; refresh before renewing workspace snapshots');
      const scope = { familyId: task.familyId, generation: task.generation, revision: task.revision };
      const grant = workspaceService.prepareAgentWorkspaceGrant(selected.rootId, selected.paths,
        { taskId: task.id, familyId: task.familyId, generation: task.generation });
      return send({ ...payload, scope, grant });
    }
    return send(payload);
  });
  if (workspaceService) {
    const noArgs = action => (_event, ...args) => { if (args.length) throw new Error('This workspace action takes no incoming path'); return action(); };
    handle('launcher:agent-workspace-roots', noArgs(() => {
      const roots = workspaceService.listRoots();
      return roots.map(({ id, name, path: rootPath }) => ({ id,
        name: roots.filter(root => root.name === name).length > 1
          ? `${name} — ${typeof rootPath === 'string' ? path.basename(path.dirname(rootPath)) + ' ' : ''}(${id.slice(0, 8)})`
          : name }));
    }));
    handle('launcher:agent-workspace-grants', noArgs(() => workspaceService.listAgentWorkspaceGrants()));
    handle('launcher:agent-workspace-revoke', (_event, grantId) => {
      if (typeof grantId !== 'string' || !UUID.test(grantId)) throw new Error('Invalid workspace grant identity');
      return workspaceService.revokeAgentWorkspaceGrant(grantId);
    });
  }
}
module.exports = { registerAgentMode };
