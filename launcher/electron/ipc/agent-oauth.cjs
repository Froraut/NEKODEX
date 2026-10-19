'use strict';
/** Called only inside the existing sender-guarded launcher:agent-tools boundary.
 * OAuth is owned by main, independently of an absent/stopped tool daemon.
 */
function createAgentOAuthIpc({ service, handle, dialog, getWindow }) {
  if (!service || typeof handle !== 'function') throw new Error('OAuth IPC owner unavailable');
  handle('launcher:agent-tools-pick-oauth-provider', async (_event, body) => {
    if (!body || Object.keys(body).length !== 1 || body.explicitUserAction !== true || !dialog) throw new Error('Explicit OAuth provider selection required');
    const options = { title: 'Review a registered MCP OAuth public client', properties: ['openFile'],
      filters: [{ name: 'Public OAuth registration metadata', extensions: ['json'] }] };
    const window = getWindow?.();
    const result = window ? await dialog.showOpenDialog(window, options) : await dialog.showOpenDialog(options);
    if (result.canceled) return { cancelled: true };
    if (result.filePaths.length !== 1) throw new Error('Select one public provider registration file');
    return { cancelled: false, review: await service.reviewProviderFile(result.filePaths[0]) };
  });
  return {
    handles: action => service.handles(action),
    request: body => service.request(body),
    /** Existing core status still owns stdio/tools; main overlays only protected OAuth service metadata. */
    decorateStatus(value) {
      const status = service.status();
      return { ...value, ...status, capabilities: { ...value.capabilities, ...status.capabilities } };
    },
  };
}
module.exports = { createAgentOAuthIpc };
