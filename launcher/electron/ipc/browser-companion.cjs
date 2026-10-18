const ACTIONS = new Set(['status', 'enable', 'disable', 'create-pairing', 'revoke']);
/** Existing guarded IPC + owned daemon control are the only transports. Secrets returned by
 * create-pairing stay in this response; never log or persist the request/response. */
function registerBrowserCompanion({ handle, runtimeHost, clipboard }) {
  handle('launcher:browser-companion', async (_event, body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !ACTIONS.has(body.action)
      || Object.keys(body).some(key => !['action', 'extensionId'].includes(key))
      || Buffer.byteLength(JSON.stringify(body), 'utf8') > 4096
      || (body.action === 'enable' && (typeof body.extensionId !== 'string' || !/^[a-p]{32}$/.test(body.extensionId)))) throw new Error('Invalid browser companion request');
    const supervisor = runtimeHost.supervisor;
    const config = supervisor.readConfig();
    if (!await supervisor.ownedRuntimeReady(config)) throw new Error('Start the current NEKODEX runtime to configure the browser companion');
    const receipt = await supervisor.control(config, 'browser-companion', { body });
    if (!receipt || receipt.ok !== true) throw new Error(receipt?.message || receipt?.error || 'Browser companion operation failed');
    return receipt.value;
  });
  if (clipboard) handle('launcher:browser-companion-copy', async (_event, text) => {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 2048) throw new Error('Invalid pairing text');
    let pairing;
    try { pairing = JSON.parse(text); } catch { throw new Error('Invalid pairing text'); }
    if (pairing?.version !== 1 || pairing?.origin !== 'http://127.0.0.1:17843' || !/^[a-p]{32}$/.test(pairing?.extensionId)
      || typeof pairing?.hostId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairing?.pairingCode)) throw new Error('Invalid pairing text');
    clipboard.writeText(text); return { copied: true };
  });
}
module.exports = { registerBrowserCompanion };
