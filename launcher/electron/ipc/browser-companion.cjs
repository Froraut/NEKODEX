const ACTIONS = new Set(['status', 'enable', 'disable', 'create-pairing', 'revoke']);
/** Main-process projection of src/browser-companion/firefox-identity.ts. These inputs
 * come from the explicit local-user pin, never a request's network Origin header. */
function companionExtensionOrigin(extensionId, pinnedOrigin) {
  if (typeof extensionId !== 'string') throw new Error('Invalid companion extension identity');
  if (/^[a-p]{32}$/.test(extensionId)) {
    const origin = `chrome-extension://${extensionId}`;
    if (pinnedOrigin !== undefined && pinnedOrigin !== origin) throw new Error('Invalid companion extension identity');
    return origin;
  }
  if (extensionId !== 'browser-companion@nekodex.local' || typeof pinnedOrigin !== 'string'
    || !/^moz-extension:\/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(pinnedOrigin)) throw new Error('Invalid companion extension identity');
  return pinnedOrigin;
}
/** Existing guarded IPC + owned daemon control are the only transports. Secrets returned by
 * create-pairing stay in this response; never log or persist the request/response. */
function registerBrowserCompanion({ handle, runtimeHost, clipboard }) {
  handle('launcher:browser-companion', async (_event, body) => {
    if (!body || typeof body !== 'object' || Array.isArray(body) || !ACTIONS.has(body.action)
      || Object.keys(body).some(key => !['action', 'extensionId', 'extensionOrigin'].includes(key))
      || Buffer.byteLength(JSON.stringify(body), 'utf8') > 4096) throw new Error('Invalid browser companion request');
    if (body.action === 'enable') {
      try { companionExtensionOrigin(body.extensionId, body.extensionOrigin); } catch { throw new Error('Invalid browser companion request'); }
    }
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
    if (!pairing || typeof pairing !== 'object' || Array.isArray(pairing)
      || Object.keys(pairing).some(key => !['version', 'origin', 'hostId', 'pairingCode', 'extensionId', 'extensionOrigin'].includes(key))
      || pairing.version !== 1 || pairing.origin !== 'http://127.0.0.1:17843'
      || typeof pairing.hostId !== 'string' || !pairing.hostId.length || pairing.hostId.length > 160
      || typeof pairing.pairingCode !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(pairing.pairingCode)) throw new Error('Invalid pairing text');
    try { companionExtensionOrigin(pairing.extensionId, pairing.extensionOrigin); } catch { throw new Error('Invalid pairing text'); }
    clipboard.writeText(text); return { copied: true };
  });
}
module.exports = { registerBrowserCompanion, companionExtensionOrigin };
