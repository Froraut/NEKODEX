const fs = require('node:fs');
const path = require('node:path');
const { BrowserHost } = require('./browser-host.cjs');
const { createAccountRegistry, validateAccountId } = require('./account-registry.cjs');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');

/** One browser session per account; shared global capacity and sticky conversation routing. */
class AccountBrowserPool {
  constructor(options) {
    this.options = options;
    this.logger = options.logger;
    this.registry = createAccountRegistry(options.coreHome);
    this.hosts = new Map();
    this.creatingHosts = new Set();
    this.reservations = new Map();
    this.pendingAffinity = new Map();
    this.traceOwners = new Map();
    this.capabilities = new Map();
    this.connectors = new Map();
    this.lastAssigned = new Map();
    this.sequence = 0;
    this.surfaceActive = true;
    this.destroyed = false;
    this.affinityPath = path.join(options.coreHome, 'account-affinity.json');
    this.affinity = new Map();
    try {
      const saved = JSON.parse(fs.readFileSync(this.affinityPath, 'utf8'));
      if (!saved || typeof saved !== 'object' || Array.isArray(saved)) throw new Error('Invalid account affinity');
      for (const [key, id] of Object.entries(saved)) {
        if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid account conversation key');
        validateAccountId(id);
        if (!this.registry.snapshot().accounts.some(account => account.id === id)) throw new Error('Account affinity references an unknown account');
        this.affinity.set(key, id);
      }
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    this.getHost('default');
    this.getHost(this.registry.snapshot().selectedId);
    // UI methods keep operating on the selected profile. Turn methods below
    // always resolve their owner and never depend on UI selection.
    return new Proxy(this, { get: (target, key) => {
      if (key in target) {
        const value = Reflect.get(target, key, target);
        return typeof value === 'function' ? value.bind(target) : value;
      }
      const host = target.selectedHost();
      const value = host[key];
      return typeof value === 'function' ? value.bind(host) : value;
    } });
  }
  selectedHost() { return this.getHost(this.registry.snapshot().selectedId); }
  getHost(id) {
    validateAccountId(id);
    if (!this.registry.snapshot().accounts.some(account => account.id === id)) throw new Error('Unknown ChatGPT account');
    if (this.hosts.has(id)) return this.hosts.get(id);
    const basePartition = this.options.partition;
    this.creatingHosts.add(id);
    let host;
    try { host = new BrowserHost({ ...this.options,
      accountId: id,
      partition: id === 'default' ? basePartition : `${basePartition}-account-${id}`,
      descriptorPath: path.join(this.options.coreHome, 'runtime', `browser-account-${id}.json`),
      isAccountVisible: () => this.registry.snapshot().selectedId === id,
      publishState: () => this.publish(),
    }); } finally { this.creatingHosts.delete(id); }
    const write = host.writeDescriptor.bind(host);
    host.writeDescriptor = () => { write(); this.writeDescriptor(); };
    this.hosts.set(id, host);
    if (this.bounds) host.setBounds(this.bounds, this.rendererZoomFactor);
    host.surfaceActive = this.surfaceActive;
    return host;
  }
  async ready() {
    await Promise.all([...this.hosts.values()].map(host => host.ready()));
    this.writeDescriptor();
  }
  get turnTabs() { return new Map([...this.hosts.values()].flatMap(host => [...host.turnTabs])); }
  get activeTraceId() {
    return [...this.hosts.values()].map(host => host.activeTraceId).find(Boolean) || null;
  }
  currentOperation() {
    return [...this.hosts.values()].map(host => host.currentOperation()).find(Boolean) || null;
  }
  accountSnapshot() {
    const config = this.registry.snapshot();
    return { ...config, accounts: config.accounts.map(account => {
      const host = this.hosts.get(account.id);
      return { ...account, authenticated: host?.state.authenticated === true,
        accountLabel: host?.state.accountLabel ?? null,
        activeTurns: host ? [...host.turnTabs.values()].filter(tab => tab.status === 'running').length : 0,
        checked: this.capabilities.has(account.id), connectorReady: this.connectors.has(account.id) };
    }) };
  }
  snapshot() {
    const selected = this.registry.snapshot().selectedId;
    const state = this.selectedHost().snapshot();
    const labels = new Map(this.registry.snapshot().accounts.map(account => [account.id, account.label]));
    return { ...state, accountId: selected, accountName: labels.get(selected),
      maxTabs: this.options.maxTabs,
      tabs: [...state.tabs.filter(tab => tab.id === 'home'), ...[...this.hosts].flatMap(([id, host]) =>
        host.snapshot().tabs.filter(tab => tab.id !== 'home').map(tab => ({ ...tab,
          active: id === selected && tab.active, accountId: id,
          title: `${labels.get(id)} · ${tab.title}` }))) ] };
  }
  publish() {
    if (this.destroyed || this.creatingHosts.size) return;
    for (const [id, host] of this.hosts) if (host.state.authenticated === false) {
      this.capabilities.delete(id); this.connectors.delete(id);
    }
    if (this.hosts.size) this.options.publishState?.(this.snapshot());
  }
  writeDescriptor() {
    if (this.destroyed) return;
    const descriptors = [...this.hosts.values()].flatMap(host => {
      try { return [JSON.parse(fs.readFileSync(host.descriptorPath, 'utf8'))]; }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    });
    const primary = descriptors.find(descriptor => descriptor.accountId === 'default');
    if (!primary) return;
    const targets = Object.assign({}, ...descriptors.map(descriptor => descriptor.surfaceTargets));
    writePrivateFileAtomic(this.options.descriptorPath, JSON.stringify({ ...primary, surfaceTargets: targets }) + '\n');
  }
  async addAccount(label) {
    if (this.currentOperation()) throw new Error('Finish the current browser operation before adding an account');
    const previous = this.registry.snapshot().selectedId;
    this.registry.add(label);
    try { await this.selectedHost().ready(); }
    catch (error) { this.registry.select(previous); throw error; }
    this.syncVisibility(); this.publish();
    return this.accountSnapshot();
  }
  async selectAccount(id) {
    if (this.currentOperation()) throw new Error('Finish the current browser operation before switching accounts');
    const host = this.getHost(id);
    await host.ready();
    this.registry.select(id);
    this.syncVisibility(); this.publish();
    return this.accountSnapshot();
  }
  setAccountEnabled(id, enabled) { this.registry.setEnabled(id, enabled); return this.accountSnapshot(); }
  setAccountMode(mode) { this.registry.setMode(mode); return this.accountSnapshot(); }
  syncVisibility() { for (const host of this.hosts.values()) host.syncViewVisibility(); }
  setBounds(bounds, zoom = 1) {
    this.bounds = bounds; this.rendererZoomFactor = zoom;
    for (const host of this.hosts.values()) host.setBounds(bounds, zoom);
  }
  setSurfaceActive(active) {
    this.surfaceActive = active === true;
    for (const host of this.hosts.values()) host.setSurfaceActive(this.surfaceActive);
    return this.snapshot();
  }
  hide() { for (const host of this.hosts.values()) host.hide(); return this.snapshot(); }
  async checkAccount(id, connector = false) {
    const host = this.getHost(id);
    this.capabilities.delete(id);
    if (connector) this.connectors.delete(id);
    const evidence = await host.inspectSession(true);
    this.capabilities.set(id, evidence);
    if (connector) { await host.verifyConnector(host.connectorName()); this.connectors.set(id, host.connectorName()); }
    this.publish(); return this.accountSnapshot();
  }
  async refreshAuthentication() {
    // Authenticate enabled saved sessions, without treating persisted metadata as proof.
    for (const account of this.registry.snapshot().accounts.filter(account => account.enabled)) {
      const host = this.getHost(account.id);
      try {
        await host.refreshAuthentication();
        if (host.state.authenticated) this.capabilities.set(account.id, await host.inspectSession(true));
      }
      catch (error) { this.logger.warn('browser.account_refresh_failed', { accountId: account.id, message: error.message }); }
    }
    return this.snapshot();
  }
  async inspectSession(detectCapabilities, accountId) {
    const id = accountId ?? this.registry.snapshot().selectedId;
    const evidence = await this.getHost(id).inspectSession(detectCapabilities);
    if (detectCapabilities) this.capabilities.set(id, evidence);
    return evidence;
  }
  async openAccountLogin(id) {
    await this.selectAccount(id);
    const host = this.getHost(id);
    if (host.browserInteractionMode() === "manual") {
      host.activateHomeSurface();
      await host.reveal(false);
    } else await host.openLogin();
    return this.snapshot();
  }
  ensurePrimaryImport() {
    if (this.registry.snapshot().selectedId !== 'default') throw new Error('Use Sign in for additional accounts; Chrome session import is reserved for the primary profile');
  }
  openPasskeyLogin(...args) { this.ensurePrimaryImport(); return this.selectedHost().openPasskeyLogin(...args); }
  openExistingChromeLogin(...args) { this.ensurePrimaryImport(); return this.selectedHost().openExistingChromeLogin(...args); }
  async logout() {
    const id = this.registry.snapshot().selectedId;
    const host = this.selectedHost();
    if (host.activeTraceId) throw new Error('Finish this account’s active tasks before signing out');
    this.capabilities.delete(id); this.connectors.delete(id);
    for (const tab of [...host.turnTabs.values()]) host.removeTurnTab(tab, false);
    await host.logout(); return this.snapshot();
  }
  ownerForTrace(traceId) {
    const id = this.traceOwners.get(traceId);
    if (id) return this.getHost(id);
    const host = [...this.hosts.values()].find(candidate => [...candidate.turnTabs.values()].some(tab => tab.traceId === traceId)
      || candidate.closedTurnOwners.has(traceId) || candidate.userCancelledTurnOwners.has(traceId)
      || candidate.manualCompletionSignals.has(traceId) || candidate.manualTerminalSignals.has(traceId));
    if (!host) throw new Error('Browser turn has no account owner');
    return host;
  }
  ownerForTab(tabId) {
    if (tabId === 'home') return this.selectedHost();
    const host = [...this.hosts.values()].find(candidate => candidate.turnTabs.has(tabId));
    if (!host) throw new Error('Browser tab has no account owner');
    return host;
  }
  async selectTab(tabId) {
    const host = this.ownerForTab(tabId);
    await this.selectAccount(host.accountId);
    host.selectTab(tabId); return this.snapshot();
  }
  closeTab(tabId) { const result = this.ownerForTab(tabId).closeTab(tabId); this.publish(); return result; }
  removeTurnTab(tab, abortRunning) { this.ownerForTab(tab.id).removeTurnTab(tab, abortRunning); }
  copyManualPrompt(tabId) { return this.ownerForTab(tabId).copyManualPrompt(tabId); }
  confirmManualSent(tabId) { return this.ownerForTab(tabId).confirmManualSent(tabId); }
  async withInteractionModeChange(mode, action) {
    if (this.activeTraceId || this.currentOperation()) throw new Error('Finish active tasks and account operations before changing interaction mode');
    return this.selectedHost().withInteractionModeChange(mode, action);
  }
  chooseAccount(traceId, key, retained, requirement) {
    const config = this.registry.snapshot();
    const existingTrace = this.traceOwners.get(traceId);
    const existingTab = [...this.hosts].find(([, host]) => [...host.turnTabs.values()].some(tab => tab.traceId === traceId || (key && tab.conversationKey === key)));
    const ownerForBinding = binding => this.affinity.get(binding)
      ?? [...this.pendingAffinity.values()].find(pending => pending.keys.includes(binding))?.id;
    const threadOwner = requirement?.routingKey ? ownerForBinding(requirement.routingKey) : undefined;
    const conversationOwner = key ? ownerForBinding(key) : undefined;
    if (threadOwner && conversationOwner && threadOwner !== conversationOwner) throw new Error('Conversation and task account ownership conflict');
    const pinned = existingTrace ?? threadOwner ?? conversationOwner ?? existingTab?.[0];
    if (pinned && ((threadOwner && threadOwner !== pinned) || (conversationOwner && conversationOwner !== pinned))) {
      throw new Error('Conversation and task account ownership conflict');
    }
    if (retained && !pinned) { const error = new Error('Retained conversation has no account owner'); error.code = 'retained_conversation_unavailable'; throw error; }
    const eligible = account => {
      const host = this.hosts.get(account.id);
      if (!account.enabled || host?.currentOperation()) return false;
      if (config.mode === 'selected' && account.id === 'default') return true;
      if (host?.state.authenticated !== true) return false;
      const caps = this.capabilities.get(account.id);
      if (requirement?.effort === 'luna' && caps?.solAvailable !== false) return false;
      if (requirement?.effort === 'max' && caps?.proAvailable !== true) return false;
      if (requirement?.effort === 'xhigh' && caps?.extraHighAvailable !== true) return false;
      if (requirement?.effort && requirement.effort !== 'max' && requirement.effort !== 'luna' && caps?.solAvailable !== true) return false;
      if (requirement?.connector && account.id !== 'default' && this.connectors.get(account.id) !== requirement.connector) return false;
      return true;
    };
    // Pinned continuations may finish on a disabled account, but never migrate.
    if (pinned) return pinned;
    const candidates = config.mode === 'selected'
      ? config.accounts.filter(account => account.id === config.selectedId && eligible(account))
      : config.accounts.filter(eligible);
    const load = id => [...(this.hosts.get(id)?.turnTabs.values() ?? [])].filter(tab => tab.status === 'running').length
      + [...this.reservations.values()].filter(value => value === id).length;
    candidates.sort((a, b) => load(a.id) - load(b.id) || (this.lastAssigned.get(a.id) ?? 0) - (this.lastAssigned.get(b.id) ?? 0));
    if (!candidates.length) throw new Error('No enabled ChatGPT account is ready for this model and connector. Sign in and check the account in Settings.');
    return candidates[0].id;
  }
  ensureTabCapacity(traceId, key) {
    const tabs = [...this.turnTabs.values()];
    if (tabs.some(tab => tab.traceId === traceId || (key && tab.conversationKey === key))) return;
    const represented = new Set(tabs.map(tab => tab.traceId));
    const pending = [...this.reservations.keys()].filter(trace => trace !== traceId && !represented.has(trace)).length;
    if (tabs.length + pending < this.options.maxTabs) return;
    if (![...this.hosts.values()].some(host => host.evictOldestReclaimableTurnTab())) {
      throw new Error('Global browser tab capacity is full');
    }
  }
  persistAffinity(keys, id) {
    if (keys.some(binding => this.affinity.has(binding) && this.affinity.get(binding) !== id)) {
      throw new Error('Conversation and task account ownership conflict');
    }
    const newKeys = [...new Set(keys)].filter(binding => !this.affinity.has(binding));
    if (!newKeys.length) return;
    if (this.affinity.size + newKeys.length > 100000) throw new Error('Account affinity registry is full');
    const next = new Map(this.affinity);
    for (const binding of newKeys) next.set(binding, id);
    writePrivateFileAtomic(this.affinityPath, JSON.stringify(Object.fromEntries(next)) + '\n');
    this.affinity = next;
  }
  async beginTurn(traceId, reveal, helperPid, key, connector, retained, requirement) {
    if (this.reservations.has(traceId)) throw new Error('Browser turn is already acquiring its account');
    const active = [...this.turnTabs.values()].filter(tab => tab.status === 'running');
    const activeTraces = new Set([...active.map(tab => tab.traceId), ...this.reservations.keys()]);
    if (!activeTraces.has(traceId) && activeTraces.size >= this.options.maxTabs) throw new Error('Global browser capacity is full');
    const id = this.chooseAccount(traceId, key, retained, { ...requirement, connector });
    const keys = [key, requirement?.routingKey].filter(Boolean);
    this.reservations.set(traceId, id);
    this.pendingAffinity.set(traceId, { id, keys });
    this.traceOwners.set(traceId, id);
    this.lastAssigned.set(id, ++this.sequence);
    try {
      const host = this.getHost(id);
      if (keys.some(binding => this.affinity.has(binding) && this.affinity.get(binding) !== id)) {
        throw new Error('Conversation and task account ownership conflict');
      }
      const newKeys = [...new Set(keys)].filter(binding => !this.affinity.has(binding));
      if (this.affinity.size + newKeys.length > 100000) throw new Error('Account affinity registry is full');
      await host.ready();
      this.ensureTabCapacity(traceId, key);
      if (reveal && !this.currentOperation()) { this.registry.select(id); this.syncVisibility(); }
      const lease = await host.beginTurn(traceId, reveal, helperPid, key, connector, retained);
      this.persistAffinity(keys, id);
      this.writeDescriptor(); this.publish();
      return { ...lease, accountId: id };
    } catch (error) {
      // No other account is tried here: even a failed acquisition can own a live tab.
      if ([...this.getHost(id).turnTabs.values()].some(tab => tab.traceId === traceId)) {
        try { this.persistAffinity(keys, id); }
        catch (affinityError) { this.logger.warn('browser.account_affinity_write_failed', { accountId: id, message: affinityError.message }); }
      } else this.traceOwners.delete(traceId);
      throw error;
    } finally { this.reservations.delete(traceId); this.pendingAffinity.delete(traceId); }
  }
  heartbeatTurn(...args) { return this.ownerForTrace(args[0]).heartbeatTurn(...args); }
  async endTurn(...args) {
    try { return await this.ownerForTrace(args[0]).endTurn(...args); }
    finally { this.traceOwners.delete(args[0]); this.publish(); }
  }
  beginManualTurn(...args) {
    // Manual submission is deliberately tied to the profile visible to the user.
    const [traceId, , , key] = args;
    const traceOwner = this.traceOwners.get(traceId) ?? [...this.hosts].find(([, host]) =>
      [...host.turnTabs.values()].some(tab => tab.traceId === traceId)
      || host.manualCompletionSignals.has(traceId) || host.manualTerminalSignals.has(traceId))?.[0];
    const retainedOwner = [...this.hosts].find(([, host]) => [...host.turnTabs.values()].some(tab => key && tab.conversationKey === key))?.[0];
    const pendingOwner = key && [...this.pendingAffinity.values()].find(pending => pending.keys.includes(key))?.id;
    const id = traceOwner || (key && this.affinity.get(key)) || pendingOwner || retainedOwner || this.registry.snapshot().selectedId;
    const activeTraces = new Set([...this.turnTabs.values()].filter(tab => tab.status === 'running').map(tab => tab.traceId));
    for (const trace of this.reservations.keys()) activeTraces.add(trace);
    if (!activeTraces.has(traceId) && activeTraces.size >= this.options.maxTabs) throw new Error('Global browser capacity is full');
    if (!traceOwner && id !== this.registry.snapshot().selectedId) throw new Error('Select the account that owns this conversation before continuing in Manual mode');
    if (!this.registry.snapshot().accounts.find(account => account.id === id)?.enabled && !retainedOwner && !traceOwner) throw new Error('Selected account is disabled for new tasks');
    if (pendingOwner && pendingOwner !== id) throw new Error('Conversation and task account ownership conflict');
    if (key && this.affinity.has(key) && this.affinity.get(key) !== id) throw new Error('Conversation and task account ownership conflict');
    if (key && !this.affinity.has(key) && this.affinity.size >= 100000) throw new Error('Account affinity registry is full');
    this.ensureTabCapacity(traceId, key);
    let lease;
    try {
      lease = this.getHost(id).beginManualTurn(...args);
      if (key) this.persistAffinity([key], id);
    } catch (error) {
      if (key && [...this.getHost(id).turnTabs.values()].some(tab => tab.traceId === traceId)) {
        try { this.persistAffinity([key], id); }
        catch (affinityError) { this.logger.warn('browser.account_affinity_write_failed', { accountId: id, message: affinityError.message }); }
      }
      throw error;
    }
    this.traceOwners.set(traceId, id); this.writeDescriptor(); this.publish(); return lease;
  }
  waitManualSent(...args) { return this.ownerForTrace(args[0]).waitManualSent(...args); }
  waitManualTerminal(...args) { return this.ownerForTrace(args[0]).waitManualTerminal(...args); }
  markManualTurnStarted(...args) { return this.ownerForTrace(args[0]).markManualTurnStarted(...args); }
  cancelManualTurn(...args) { return this.ownerForTrace(args[0]).cancelManualTurn(...args); }
  endManualTurn(...args) { try { return this.ownerForTrace(args[0]).endManualTurn(...args); } finally { this.traceOwners.delete(args[0]); this.publish(); } }
  async persistSession() { await Promise.all([...this.hosts.values()].map(host => host.persistSession())); }
  destroy() {
    this.destroyed = true;
    for (const host of this.hosts.values()) host.destroy();
    try { if (JSON.parse(fs.readFileSync(this.options.descriptorPath, 'utf8')).pid === process.pid) fs.rmSync(this.options.descriptorPath); } catch {}
  }
}
module.exports = { AccountBrowserPool };
