const fs = require('node:fs');
const path = require('node:path');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { validateAccountId } = require('./account-registry.cjs');

function validateProxy(value) {
  if (!value || !['system', 'direct', 'http', 'https', 'socks5', 'pac'].includes(value.mode)) throw new Error('Invalid account proxy mode');
  if (value.mode === 'system' || value.mode === 'direct') return { mode: value.mode };
  if (typeof value.url !== 'string' || value.url.length > 2048) throw new Error('Invalid account proxy URL');
  let url;
  try { url = new URL(value.url); } catch { throw new Error('Enter a complete proxy URL'); }
  if (url.username || url.password || url.hash) throw new Error('Proxy URLs must not include credentials or fragments');
  if (value.mode === 'pac') {
    if (url.protocol !== 'https:') throw new Error('PAC URLs must use HTTPS');
    return { mode: value.mode, url: url.href };
  }
  if (url.protocol !== `${value.mode}:` || !url.hostname || url.pathname && url.pathname !== '/' || url.search) {
    throw new Error('Proxy URL must match the selected protocol and contain only host and port');
  }
  if (value.mode === 'socks5' && !url.port) throw new Error('SOCKS proxy requires a port');
  return { mode: value.mode, url: `${value.mode}://${url.host}` };
}
function electronProxy(value) {
  const proxy = validateProxy(value);
  if (proxy.mode === 'system' || proxy.mode === 'direct') return { mode: proxy.mode };
  if (proxy.mode === 'pac') return { mode: 'pac_script', pacScript: proxy.url };
  return { mode: 'fixed_servers', proxyRules: proxy.url, proxyBypassRules: '<local>;localhost;127.0.0.1;[::1]' };
}
class AccountNetwork {
  constructor(coreHome) {
    this.path = path.join(coreHome, 'account-network.json');
    this.state = {};
    try {
      const data = JSON.parse(fs.readFileSync(this.path, 'utf8'));
      if (data.version !== 1 || !data.accounts || typeof data.accounts !== 'object' || Array.isArray(data.accounts)) throw new Error('Invalid account network state');
      for (const [id, proxy] of Object.entries(data.accounts)) { validateAccountId(id); this.state[id] = validateProxy(proxy); }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  get(id) { validateAccountId(id); return { ...(this.state[id] ?? { mode: 'system' }) }; }
  save(id, value) {
    validateAccountId(id);
    const next = { ...this.state, [id]: validateProxy(value) };
    writePrivateFileAtomic(this.path, JSON.stringify({ version: 1, accounts: next }) + '\n');
    this.state = next;
  }
  async apply(session, value) {
    await session.setProxy(electronProxy(value));
    await session.closeAllConnections();
  }
}
module.exports = { AccountNetwork, validateProxy, electronProxy };
