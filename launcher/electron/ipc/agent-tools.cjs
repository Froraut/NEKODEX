const ACTIONS = new Set(['status', 'reviewServer', 'saveServer', 'setEnabled', 'removeServer', 'setServerEnabled', 'prepareInstall', 'installReviewed', 'installReceipt', 'cancelInstall', 'uninstallManaged', 'reviewInstalled', 'discover', 'approveInvoke', 'receipt', 'terminalReference', 'skillRoot', 'skillsDiscover', 'skillsSelect', 'removeSkillRoot']);
for (const action of ['reviewSkillImport', 'commitSkillImport', 'managedSkillAction', 'attachManagedSkill', 'detachManagedSkill', 'revokeManagedSkill']) ACTIONS.add(action);
/** Existing IPC sender guard and owned supervisor remain the sole authority. */
function registerAgentTools({ handle, runtimeHost, dialog, getWindow }) {
  const request = async body => {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !ACTIONS.has(body.action) || Buffer.byteLength(JSON.stringify(body), 'utf8') > 131072) throw new Error('Invalid Agent tools request');
    const supervisor = runtimeHost.supervisor;
    const config = supervisor.readConfig();
    if (!await supervisor.ownedRuntimeReady(config)) throw new Error('Start the current NEKODEX runtime to use Agent tools');
    const receipt = await supervisor.control(config, 'agent-tools', { body });
    if (!receipt || receipt.ok !== true) throw new Error(receipt?.message || receipt?.error || 'Agent tools operation failed');
    return receipt.value;
  };
  handle('launcher:agent-tools', async (_event, body) => request(body));
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
}
module.exports = { registerAgentTools };
