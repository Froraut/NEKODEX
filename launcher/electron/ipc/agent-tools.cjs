const ACTIONS = new Set(['status', 'reviewServer', 'saveServer', 'setEnabled', 'removeServer', 'setServerEnabled', 'prepareInstall', 'installReviewed', 'installReceipt', 'cancelInstall', 'uninstallManaged', 'reviewInstalled', 'discover', 'approveInvoke', 'receipt', 'terminalReference', 'skillRoot', 'skillsDiscover', 'skillsSelect', 'removeSkillRoot']);
for (const action of ['reviewSkillImport', 'reviewSkillPackageImport', 'commitSkillImport', 'managedSkillAction', 'attachManagedSkill', 'detachManagedSkill', 'revokeManagedSkill']) ACTIONS.add(action);
for (const action of ['browserStatus', 'bindBrowserTools', 'revokeBrowserTools']) ACTIONS.add(action);
for (const action of ['inspectDesktopPermissions', 'listDesktopWindows', 'setDesktopEnabled', 'selectDesktopWindow', 'revokeDesktopTools']) ACTIONS.add(action);
for (const action of ['remoteStatus', 'bindRemoteTools', 'revokeRemoteTools']) ACTIONS.add(action);
for (const action of ['scriptStatus', 'grantScriptWorkspace', 'revokeScriptWorkspace']) ACTIONS.add(action);
for (const action of ['pythonEnvironmentStatus', 'reviewPythonEnvironment', 'preparePythonEnvironment', 'pythonEnvironmentAction', 'reconcilePythonEnvironment', 'bindPythonEnvironment', 'revokePythonEnvironment']) ACTIONS.add(action);
/** Existing IPC sender guard and owned supervisor remain the sole authority. */
function registerAgentTools({ handle, runtimeHost, dialog, getWindow, remoteService }) {
  const request = async body => {
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
    const allowDraining = ['status', 'receipt', 'installReceipt', 'managedSkillAction', 'browserStatus', 'remoteStatus', 'scriptStatus', 'pythonEnvironmentStatus', 'pythonEnvironmentAction', 'reconcilePythonEnvironment', 'revokePythonEnvironment', 'revokeBrowserTools', 'revokeDesktopTools', 'revokeRemoteTools', 'revokeScriptWorkspace'].includes(body.action)
      || body.action === 'setDesktopEnabled' && body.enabled === false;
    if (!config || !await supervisor.ownedAgentRuntimeReady(config, { allowDraining })) throw new Error('Start the current NEKODEX runtime to use Agent tools');
    const receipt = await supervisor.control(config, 'agent-tools', { body });
    if (!receipt || receipt.ok !== true) throw new Error(receipt?.message || receipt?.error || 'Agent tools operation failed');
    return receipt.value;
  };
  handle('launcher:agent-tools', async (_event, body) => request(body));
  handle('launcher:agent-tools-observe', async (_event, body) => {
    if (!body || !['remoteStatus', 'scriptStatus', 'pythonEnvironmentStatus', 'pythonEnvironmentAction'].includes(body.action)) throw new Error('This tools action only reads provider metadata');
    return request(body);
  });
  handle('launcher:agent-tools-revoke', async (_event, body) => {
    if (!body || !['revokeBrowserTools', 'revokeDesktopTools', 'revokeRemoteTools', 'revokeScriptWorkspace', 'revokePythonEnvironment'].includes(body.action)
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
