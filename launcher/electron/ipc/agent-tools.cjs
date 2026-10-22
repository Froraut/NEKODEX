const ACTIONS = new Set(['status', 'reviewServer', 'saveServer', 'setEnabled', 'removeServer', 'setServerEnabled', 'prepareInstall', 'installReviewed', 'installReceipt', 'cancelInstall', 'uninstallManaged', 'reviewInstalled', 'discover', 'approveInvoke', 'receipt', 'terminalReference', 'skillRoot', 'skillsDiscover', 'skillsSelect', 'skillsDeselect', 'removeSkillRoot']);
const { createPythonBuildPicker } = require('../python-build-picker.cjs');
for (const action of ['reviewSkillImport', 'reviewSkillPackageImport', 'commitSkillImport', 'managedSkillAction', 'attachManagedSkill', 'detachManagedSkill', 'revokeManagedSkill']) ACTIONS.add(action);
for (const action of ['browserStatus', 'bindBrowserTools', 'revokeBrowserTools']) ACTIONS.add(action);
for (const action of ['inspectDesktopPermissions', 'openDesktopPermissionSettings', 'listDesktopWindows', 'setDesktopEnabled', 'selectDesktopWindow', 'revokeDesktopTools']) ACTIONS.add(action);
for (const action of ['remoteStatus', 'bindRemoteTools', 'revokeRemoteTools']) ACTIONS.add(action);
for (const action of ['scriptStatus', 'grantScriptWorkspace', 'revokeScriptWorkspace']) ACTIONS.add(action);
for (const action of ['vmStatus', 'reviewVmEnvironment', 'prepareVmEnvironment', 'attachVmWorkspace', 'revokeVmWorkspace', 'cancelVmOperation', 'reconcileVmOperation']) ACTIONS.add(action);
for (const action of ['pythonEnvironmentStatus', 'reviewPythonEnvironment', 'preparePythonEnvironment', 'pythonEnvironmentAction', 'reconcilePythonEnvironment', 'bindPythonEnvironment', 'revokePythonEnvironment']) ACTIONS.add(action);
for (const action of ['pythonBuildStatus', 'reviewPythonBuild', 'preparePythonBuild', 'attachPythonBuild', 'revokePythonBuild', 'cancelPythonBuild', 'reconcilePythonBuild', 'vmNetworkStatus', 'grantVmNetwork', 'revokeVmNetwork']) ACTIONS.add(action);
/** Existing IPC sender guard and owned supervisor remain the sole authority. */
function registerAgentTools({ handle, runtimeHost, dialog, getWindow, remoteService, workspaceService, vmExportService, pythonBuildSelectionService, oauthIpc, getApplicationVersion }) {
  const request = async body => {
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid Agent tools request');
    if (oauthIpc?.handles(body.action)) return oauthIpc.request(body);
    if (body && ['vmExportWorkspaces', 'vmExportStatus', 'prepareVmExport', 'reconcileVmExport'].includes(body.action)) {
      if (!vmExportService || !workspaceService || Buffer.byteLength(JSON.stringify(body)) > 16384) throw new Error('VM export service is unavailable');
      if (body.action === 'vmExportWorkspaces') {
        if (Object.keys(body).length !== 1) throw new Error('Invalid VM workspace request');
        return { roots: workspaceService.listRoots().map(row => ({ id: row.id, label: row.name })) };
      }
      const allowed = body.action === 'vmExportStatus' ? ['action', 'scope'] : body.action === 'prepareVmExport'
        ? ['action', 'scope', 'workspaceId', 'destinationPath', 'operationId', 'candidatePath', 'candidateSha256', 'explicitUserAction'] : ['action', 'request', 'explicitUserAction'];
      if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error('Invalid VM export control');
      if (body.action === 'reconcileVmExport') {
        if (body.explicitUserAction !== true) throw new Error('Explicit VM export reconciliation required');
        return vmExportService.reconcile(body.request);
      }
      if (!body.scope || typeof body.scope !== 'object' || Array.isArray(body.scope) || Object.keys(body.scope).some(key => !['taskId', 'generation', 'toolCallId'].includes(key))) throw new Error('Invalid VM export scope');
      const scope = { taskId: body.scope.taskId, generation: body.scope.generation };
      if (body.action === 'vmExportStatus') return vmExportService.list(scope);
      if (body.explicitUserAction !== true) throw new Error('Explicit VM export review required');
      return vmExportService.prepare({ scope, workspaceId: body.workspaceId, destinationPath: body.destinationPath, operationId: body.operationId,
        candidatePath: body.candidatePath, candidateSha256: body.candidateSha256, explicitUserAction: true });
    }
    if (!body || typeof body !== 'object' || Array.isArray(body) || !ACTIONS.has(body.action) || Buffer.byteLength(JSON.stringify(body), 'utf8') > 131072) throw new Error('Invalid Agent tools request');
    if (remoteService && ['remoteStatus', 'revokeRemoteTools'].includes(body.action)) {
      const allowed = body.action === 'remoteStatus' ? ['action', 'scope'] : ['action', 'scope', 'explicitUserAction'];
      if (Object.keys(body).some(key => !allowed.includes(key))) throw new Error('Invalid remote tools control');
      if (body.scope && (typeof body.scope !== 'object' || Array.isArray(body.scope)
        || Object.keys(body.scope).some(key => !['taskId', 'generation', 'toolCallId'].includes(key)))) throw new Error('Invalid remote tools scope');
      const scope = body.scope ? { taskId: body.scope.taskId, generation: body.scope.generation } : undefined;
      if (body.action === 'revokeRemoteTools') {
        if (body.explicitUserAction !== true || !scope) throw new Error('Explicit remote revocation required');
        // Main owns the grant. Privacy revocation cannot depend on an absent core.
        return remoteService.revokeAgent(scope);
      }
      return remoteService.agentStatus(scope);
    }
    const supervisor = runtimeHost.supervisor;
    const config = supervisor.readConfig();
    const applicationVersion = getApplicationVersion?.();
    // Main-owned privacy, OAuth and retained export controls above do not depend
    // on the core API. New core controls wait for the existing safe upgrade owner.
    const pendingVersion = supervisor.launcherProfile === 'production'
      && typeof applicationVersion === 'string' && applicationVersion.length > 0
      && typeof config?.releaseVersion === 'string' && config.releaseVersion.length > 0
      && config.releaseVersion !== applicationVersion;
    const pendingMessage = `Application ${applicationVersion} is installed; runtime ${config?.releaseVersion} is still active. This Agent tools action requires the automatic safe runtime switch. Existing work continues.`;
    const allowDraining = ['status', 'receipt', 'installReceipt', 'managedSkillAction', 'browserStatus', 'remoteStatus', 'scriptStatus', 'vmStatus', 'cancelVmOperation', 'reconcileVmOperation', 'revokeVmWorkspace', 'pythonEnvironmentStatus', 'pythonEnvironmentAction', 'reconcilePythonEnvironment', 'revokePythonEnvironment', 'pythonBuildStatus', 'revokePythonBuild', 'cancelPythonBuild', 'reconcilePythonBuild', 'vmNetworkStatus', 'revokeVmNetwork', 'revokeBrowserTools', 'revokeDesktopTools', 'revokeRemoteTools', 'revokeScriptWorkspace'].includes(body.action)
      || ['setDesktopEnabled', 'setEnabled', 'setServerEnabled'].includes(body.action) && body.enabled === false
      || ['removeServer', 'removeSkillRoot', 'detachManagedSkill', 'revokeManagedSkill'].includes(body.action);
    // These two "Action" endpoints only inspect a saved action ID. Do not
    // accidentally admit an extended mutation payload under their read names.
    const savedActionLookup = !['managedSkillAction', 'pythonEnvironmentAction'].includes(body.action)
      || Object.keys(body).sort().join(',') === 'action,actionId'
        && typeof body.actionId === 'string'
        && (body.action === 'pythonEnvironmentAction' ? /^[a-f0-9-]{36}$/i : /^[a-zA-Z0-9_-]{1,128}$/).test(body.actionId);
    if (pendingVersion && (!allowDraining || !savedActionLookup)) throw new Error(pendingMessage);
    if (!config || !await supervisor.ownedAgentRuntimeReady(config, { allowDraining })) throw new Error('Start the current NEKODEX runtime to use Agent tools');
    // Observation can end while the exact approved tool remains owned by core.
    // VM stop/revoke travels through its separate control path; timeout never
    // authorizes a second invoke or declares physical completion.
    let receipt;
    try {
      // The helper owns its Allow/Don't Allow alert. Do not abort its IPC after
      // five seconds while the human is still reading; no second enable is offered.
      const humanEnable = body.action === 'setDesktopEnabled' && body.enabled === true && body.explicitUserAction === true;
      // Core still bounds ordinary tool calls. An exact approved desktop
      // foreground handoff, like initial enable, may wait for the user indefinitely.
      receipt = await supervisor.control(config, 'agent-tools', { body, timeoutMs: humanEnable || body.action === 'approveInvoke' ? null : 5000 });
    } catch (error) {
      if (pendingVersion && /\bHTTP 404\b/.test(error instanceof Error ? error.message : String(error))) throw new Error(pendingMessage);
      throw error;
    }
    if (!receipt || receipt.ok !== true) throw new Error(receipt?.message || receipt?.error || 'Agent tools operation failed');
    return body.action === 'status' && oauthIpc ? oauthIpc.decorateStatus(receipt.value) : receipt.value;
  };
  handle('launcher:agent-tools', async (_event, body) => request(body));
  handle('launcher:agent-tools-observe', async (_event, body) => {
    if (!body || !['remoteStatus', 'scriptStatus', 'vmStatus', 'reconcileVmOperation', 'vmExportWorkspaces', 'vmExportStatus', 'reconcileVmExport', 'pythonEnvironmentStatus', 'pythonEnvironmentAction', 'pythonBuildStatus', 'vmNetworkStatus', 'oauthList'].includes(body.action)) throw new Error('This tools action only observes retained state or reconciles its exact metadata');
    return request(body);
  });
  handle('launcher:agent-tools-revoke', async (_event, body) => {
    if (!body || !['revokeBrowserTools', 'revokeDesktopTools', 'revokeRemoteTools', 'revokeScriptWorkspace', 'revokePythonEnvironment', 'revokeVmWorkspace', 'cancelVmOperation', 'revokeVmNetwork'].includes(body.action)
      || body.explicitUserAction !== true) throw new Error('This tools action only revokes task authority');
    return request(body);
  });
  handle('launcher:agent-tools-pick-skill-root', async () => {
    if (!dialog) throw new Error('Native skill root picker is unavailable');
    const options = { title: 'Select a read-only skill library root', properties: ['openDirectory'] };
    const window = getWindow?.();
    const selection = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (selection.canceled || selection.filePaths.length !== 1) return { cancelled: true };
    const path = selection.filePaths[0];
    return { cancelled: false, grant: await request({ action: 'skillRoot', input: { root: path, label: require('node:path').basename(path) || path }, explicitUserAction: true }) };
  });
  const pickPythonBuild = createPythonBuildPicker({ dialog, getWindow, service: pythonBuildSelectionService });
  handle('launcher:agent-tools-pick-python-build-selection', (_event, scope, config) => pickPythonBuild(scope, config));
  handle('launcher:agent-tools-pick-install-root', async () => {
    if (!dialog) throw new Error('Native MCP allowed-root picker is unavailable');
    const options = { title: 'Select the directory for official MCP filesystem read/write tools', properties: ['openDirectory'] };
    const window = getWindow?.();
    const selection = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    return selection.canceled || selection.filePaths.length !== 1 ? { cancelled: true } : { cancelled: false, root: selection.filePaths[0] };
  });
  handle('launcher:agent-tools-pick-script-workspace', async () => {
    if (!dialog) throw new Error('Native script workspace picker is unavailable');
    const options = { title: 'Select the workspace for separately approved restricted skill scripts', properties: ['openDirectory'] };
    const window = getWindow?.();
    const selection = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    // Choosing a path is not a workspace grant or an execution approval.
    return selection.canceled || selection.filePaths.length !== 1 ? { cancelled: true } : { cancelled: false, root: selection.filePaths[0] };
  });
  handle('launcher:agent-tools-pick-python-wheels', async () => {
    if (!dialog) throw new Error('Native Python wheel picker is unavailable');
    const options = { title: 'Select the complete wheel dependency set for a separate review',
      properties: ['openFile', 'multiSelections'], filters: [{ name: 'Python wheels', extensions: ['whl'] }] };
    const window = getWindow?.();
    const selection = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    // Selection supplies paths only; the core owner snapshots and reviews bounded artifacts.
    if (selection.canceled) return { cancelled: true };
    if (!selection.filePaths.length || selection.filePaths.length > 16) throw new Error('Select between one and sixteen wheel files');
    return { cancelled: false, wheelPaths: selection.filePaths };
  });
}
module.exports = { registerAgentTools };
