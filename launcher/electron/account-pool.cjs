const fs = require('node:fs');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { BrowserHost } = require('./browser-host.cjs');
const { AccountSafety } = require('./account-safety.cjs');
const { AccountNetwork, validateProxy } = require('./account-network.cjs');
const { UsageStore } = require('./usage-store.cjs');
const { createAccountRegistry, validateAccountId } = require('./account-registry.cjs');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { BrowserTaskLedger, taskModelForRequirement } = require('./browser-task-ledger.cjs');
const { BrowserAdmissionQueue } = require('./browser-admission-queue.cjs');
const { BrowserWorkspaceDirectory } = require('./browser-workspace-directory.cjs');
const { AccountSessionMutationCoordinator } = require('./browser-workspace-session-mutations.cjs');

const ACCOUNT_READ_SETTLEMENT_TIMEOUT_MS = 10_000;

function validateWorkspaceId(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 128
    || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Browser workspace identity is invalid');
  return value;
}

function newWebSessionReservationId(accountId, traceId, nonce = randomUUID()) {
  validateAccountId(accountId);
  if (typeof traceId !== 'string' || !/^[A-Za-z0-9_-]{6,128}$/.test(traceId)) {
    throw new Error('New Web session trace identity is invalid');
  }
  if (typeof nonce !== 'string' || !nonce || nonce.length > 128) {
    throw new Error('New Web session reservation nonce is invalid');
  }
  return createHash('sha256')
    .update(`nekodex-new-web-session\0${accountId}\0${traceId}\0${nonce}`)
    .digest('hex');
}

/** One browser session per account; shared global capacity and sticky conversation routing. */
class AccountBrowserPool {
  constructor(options) {
    this.options = options;
    this.logger = options.logger;
    this.registry = createAccountRegistry(options.coreHome);
    this.taskLedgers = new Map(this.registry.snapshot().accounts.map(account => [account.id,
      new BrowserTaskLedger(path.join(options.coreHome, 'runtime', `tasks-${account.id}.json`))]));
    this.safety = new AccountSafety(options.coreHome);
    this.network = new AccountNetwork(options.coreHome);
    this.usage = new UsageStore(options.coreHome);
    this.networkOperation = null;
    this.accountOperations = new Map();
    this.accountReadOperations = new Map();
    this.authenticationRefreshOperations = new Map();
    this.existingChromeImportLease = null;
    this.hosts = new Map();
    this.creatingHosts = new Set();
    this.reservations = new Map();
    this.pendingAffinity = new Map();
    this.unsentAdmissions = new Map();
    this.workspaceSessionMutations = new Map();
    this.workspaceRegistrations = new Map();
    this.traceOwners = new Map();
    this.capabilities = new Map();
    this.connectors = new Map();
    this.evidenceEpochs = new Map();
    this.publishedAuthentication = new Map();
    this.lastAssigned = new Map();
    this.sequence = 0;
    this.selectionRevision = 0;
    this.loginOperation = null;
    this.surfaceActive = true;
    this.destroyed = false;
    this.turnAdmission = { open: true, reason: null };
    this.turnAdmissionRevision = 0;
    this.inspectionsPaused = false;
    this.addingAccount = false;
    this.initializingHosts = true;
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
    this.admissionQueue = new BrowserAdmissionQueue({
      file: path.join(options.coreHome, 'runtime', 'admission-queue.json'),
      inspect: request => this.previewAdmission(request),
      dispatch: (request, signal) => this.beginTurn(request.traceId, request.reveal, request.helperPid,
        request.key ?? undefined, request.connector ?? undefined, request.retained, {
          requestedModel: request.requestedModel ?? undefined,
          effort: request.effort ?? undefined, routingKey: request.routingKey ?? undefined,
          requestedAccountId: request.requestedAccountId ?? undefined,
          taskProgressVersion: 1, admissionSignal: signal, deferAffinity: true,
        }),
      releaseUnsent: request => this.releaseUnsentAdmission(request),
      leaseCurrent: (request, lease) => this.admissionLeaseCurrent(request, lease),
      changed: () => this.publish(),
    });
    this.workspaceDirectory = new BrowserWorkspaceDirectory({ platform: process.platform });
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
  workspaceCoordinator(id) {
    validateAccountId(id);
    let coordinator = this.workspaceSessionMutations.get(id);
    if (coordinator) return coordinator;
    coordinator = new AccountSessionMutationCoordinator({
      accountId: id,
      canMutateAccountSession: request => this.canMutateAccountSession(request),
      verify: request => this.hosts.get(id)?.observeWorkspaceSessionMutation(request),
      applyVerification: (evidence, context) => {
        const host = this.hosts.get(id);
        if (!host) throw new Error('ChatGPT account closed during workspace session verification');
        return host.applyWorkspaceSessionMutationEvidence(evidence, context);
      },
      onStateChange: () => this.publish(),
    });
    this.workspaceSessionMutations.set(id, coordinator);
    return coordinator;
  }
  canMutateAccountSession({ accountId }) {
    validateAccountId(accountId);
    const blockers = [];
    const host = this.hosts.get(accountId);
    for (const tab of host?.turnTabs.values() ?? []) {
      if (['loading', 'testing', 'running'].includes(tab.status)) {
        blockers.push({ kind: 'turn', id: tab.traceId ?? tab.id });
      }
    }
    for (const [traceId, owner] of this.reservations) {
      if (owner === accountId) blockers.push({ kind: 'reservation', id: traceId });
    }
    for (const [traceId, pending] of this.pendingAffinity) {
      if (pending.id === accountId) blockers.push({ kind: 'pending-affinity', id: traceId });
    }
    for (const [traceId, admission] of this.unsentAdmissions) {
      if (admission.id === accountId) blockers.push({ kind: 'unsent-admission', id: traceId });
    }
    const operation = this.accountOperations.get(accountId);
    if (operation) blockers.push({ kind: 'account-operation', id: operation.label });
    const read = this.accountReadOperations?.get(accountId)?.values().next().value;
    if (read) blockers.push({ kind: 'inspection', id: read.label });
    if (this.authenticationRefreshOperations.get(accountId)) {
      blockers.push({ kind: 'inspection', id: 'session verification' });
    }
    if (this.loginOperation?.id === accountId) blockers.push({ kind: 'login', id: 'embedded login' });
    if (this.passkeyImportLease?.id === accountId) blockers.push({ kind: 'import', id: 'passkey login' });
    if (accountId === 'default' && this.existingChromeImportLease) {
      blockers.push({ kind: 'import', id: 'existing Chrome login' });
    }
    if (this.networkOperation === accountId) blockers.push({ kind: 'account-operation', id: 'network configuration' });
    if (this.addingAccount && this.registry.snapshot().selectedId === accountId) {
      blockers.push({ kind: 'account-operation', id: 'account addition' });
    }
    return blockers.length === 0 ? { allowed: true } : {
      allowed: false,
      reason: "Finish this account's active or acquiring task and account operation before signing in or out",
      blockers,
    };
  }
  getHost(id) {
    validateAccountId(id);
    if (!this.registry.snapshot().accounts.some(account => account.id === id)) throw new Error('Unknown ChatGPT account');
    if (this.hosts.has(id)) return this.hosts.get(id);
    const basePartition = this.options.partition;
    this.creatingHosts.add(id);
    let host;
    if (!this.taskLedgers.has(id)) this.taskLedgers.set(id,
      new BrowserTaskLedger(path.join(this.options.coreHome, 'runtime', `tasks-${id}.json`)));
    try { host = new BrowserHost({ ...this.options,
      taskLedger: this.taskLedgers.get(id),
      accountId: id,
      configureAccountSession: (session, accountId) => this.network.apply(session, this.network.get(accountId)),
      partition: id === 'default' ? basePartition : `${basePartition}-account-${id}`,
      coreHome: this.options.coreHome,
      descriptorPath: path.join(this.options.coreHome, 'runtime', `browser-account-${id}.json`),
      isAccountVisible: () => this.registry.snapshot().selectedId === id,
      workspaceSessionMutation: this.workspaceCoordinator(id),
      workspaceManifestPath: path.join(this.options.coreHome, 'runtime', `browser-workspaces-${id}.json`),
      workspaceChanged: () => this.publish(),
      onAuthIdentityChanged: (accountId) => {
        if (accountId !== id) throw new Error('Browser host reported an unexpected account identity');
        this.invalidateEvidence(id);
      },
      publishState: () => this.publish(),
    }); } finally { this.creatingHosts.delete(id); }
    const write = host.writeDescriptor.bind(host);
    host.writeDescriptor = () => { write(); this.writeDescriptor(); };
    this.hosts.set(id, host);
    if (typeof host.workspaceManager === 'function') {
      const account = this.registry.snapshot().accounts.find(candidate => candidate.id === id);
      this.workspaceRegistrations.set(id,
        this.workspaceDirectory.register(id, account?.label ?? id, host.workspaceManager(account?.label ?? id)));
    }
    if (this.bounds) host.setBounds(this.bounds, this.rendererZoomFactor);
    host.surfaceActive = this.surfaceActive;
    return host;
  }
  async ready() {
    await Promise.all([...this.hosts.values()].map(host => host.ready()));
    this.initializingHosts = false;
    this.writeDescriptor();
  }
  get turnTabs() { return new Map([...this.hosts.values()].flatMap(host => [...host.turnTabs])); }
  get activeTraceId() {
    return [...this.hosts.values()].map(host => host.activeTraceId).find(Boolean) || null;
  }
  currentOperation() {
    if (this.passkeyImportLease) return 'ChatGPT passkey login';
    if (this.networkOperation) return 'Account network configuration';
    if (this.addingAccount) return 'ChatGPT account addition';
    if (this.loginOperation) return 'ChatGPT account login';
    const reserved = this.accountOperations.values().next().value;
    if (reserved) return reserved.label;
    return [...this.hosts.values()].map(host => host.currentOperation()).find(Boolean) || null;
  }
  accountOperationLabel(id) {
    validateAccountId(id);
    const mutation = this.accountMutationOperationLabel(id);
    if (mutation) return mutation;
    return this.hosts.get(id)?.currentOperation() || null;
  }
  accountMutationOperationLabel(id) {
    validateAccountId(id);
    if (this.passkeyImportLease?.id === id) return 'ChatGPT passkey login';
    const reserved = this.accountOperations.get(id);
    if (reserved) return reserved.label;
    if (this.networkOperation === id) return 'Account network configuration';
    if (this.loginOperation?.id === id) return 'ChatGPT account login';
    if (this.workspaceSessionMutations?.get(id)?.snapshot().admissionBlocked) return 'browser workspace sign-in';
    return null;
  }
  accountOperationError(id) {
    const label = this.accountOperationLabel(id);
    return label ? new Error(`This ChatGPT account is busy with ${label}; retry after it finishes`) : null;
  }
  assertAccountOperationAvailable(id) {
    const error = this.accountOperationError(id);
    if (error) throw error;
  }
  accountReadOperationLabel(id) {
    validateAccountId(id);
    return this.accountReadOperations?.get(id)?.values().next().value?.label ?? null;
  }
  acquireAccountReadOperation(id, label, cancel) {
    if (this.destroyed) throw new Error('ChatGPT account pool is closed');
    if (this.inspectionsPaused) throw new Error('Account reads are paused for launcher restart');
    validateAccountId(id);
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 80
      || /[\u0000-\u001f\u007f]/.test(label) || typeof cancel !== 'function') {
      throw new Error('Account read operation requires a printable label and cancellation callback');
    }
    this.getHost(id);
    const mutation = this.accountMutationOperationLabel(id);
    if (mutation) {
      throw new Error(`This ChatGPT account is busy with ${mutation}; retry after it finishes`);
    }
    const token = Symbol('account-read-operation');
    let resolveSettled;
    const settled = new Promise(resolve => { resolveSettled = resolve; });
    const operation = Object.freeze({ label: label.trim(), token, cancel, settled });
    this.accountReadOperations ??= new Map();
    const operations = this.accountReadOperations.get(id) ?? new Map();
    operations.set(token, operation);
    this.accountReadOperations.set(id, operations);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const current = this.accountReadOperations.get(id);
      if (current?.get(token) === operation) {
        current.delete(token);
        if (current.size === 0) this.accountReadOperations.delete(id);
      }
      resolveSettled();
    };
  }
  acquireAccountOperation(id, label) {
    if (this.destroyed) throw new Error('ChatGPT account pool is closed');
    validateAccountId(id);
    if (typeof label !== 'string' || !label.trim() || label.trim().length > 80
      || /[\u0000-\u001f\u007f]/.test(label)) {
      throw new Error('Account operation label must contain 1 to 80 printable characters');
    }
    const host = this.getHost(id);
    const normalizedLabel = label.trim();
    const conflict = this.accountOperationError(id);
    if (conflict) throw conflict;
    const readLabel = this.accountReadOperationLabel(id);
    if (readLabel) {
      throw new Error(`This ChatGPT account is busy with ${readLabel}; retry after it finishes`);
    }
    if (this.canMutateAccountSession({ accountId: id }).allowed !== true) {
      throw new Error('Finish this account’s active or acquiring tasks before starting the account operation');
    }
    const token = Symbol('account-operation');
    const reservation = Object.freeze({ label: normalizedLabel, token });
    this.accountOperations.set(id, reservation);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.accountOperations.get(id)?.token === token) this.accountOperations.delete(id);
    };
  }
  closeTurnAdmission(reason = 'launcher shutdown') {
    if (typeof reason !== 'string' || !reason || reason.length > 80) throw new Error('Turn admission reason is invalid');
    this.turnAdmission = { open: false, reason };
    this.turnAdmissionRevision++;
    return this.turnAdmission;
  }
  openTurnAdmission() {
    this.inspectionsPaused = false;
    this.turnAdmission = { open: true, reason: null };
    this.turnAdmissionRevision++;
    return this.turnAdmission;
  }
  assertTurnAdmission() {
    if (!this.turnAdmission.open) throw new Error(`NEKODEX is preparing ${this.turnAdmission.reason}; retry after it finishes`);
    return this.turnAdmissionRevision;
  }
  hasActiveTurns() {
    return this.reservations.size > 0
      || [...this.turnTabs.values()].some(tab => tab.status === 'running');
  }
  accountSnapshot() {
    const config = this.registry.snapshot();
    return { ...config, accounts: config.accounts.map(account => {
      const host = this.hosts.get(account.id);
      const capabilities = this.capabilities.get(account.id);
      const activeTurns = host ? [...host.turnTabs.values()].filter(tab => tab.status === 'running').length : 0;
      const reserved = [...this.reservations.values()].filter(id => id === account.id).length;
      return { ...account, proxy: this.network.get(account.id), safety: this.safety.snapshot(account.id), authenticated: host?.state.authenticated === true,
        authenticationStatus: host?.state.authenticationStatus,
        authenticationIssue: host?.state.authenticationIssue ?? null,
        authenticationCheckedAt: host?.state.authenticationCheckedAt ?? null,
        lastVerifiedAt: host?.state.lastVerifiedAt ?? null,
        accountLabel: host?.state.accountLabel ?? null,
        evidenceEpoch: this.evidenceEpoch(account.id),
        activeTurns,
        availability: this.safety.availability(account.id, activeTurns + reserved, { createsNewSession: true }),
        capabilities: capabilities ? {
          solAvailable: typeof capabilities.solAvailable === 'boolean' ? capabilities.solAvailable : null,
          extraHighAvailable: typeof capabilities.extraHighAvailable === 'boolean' ? capabilities.extraHighAvailable : null,
          proAvailable: typeof capabilities.proAvailable === 'boolean' ? capabilities.proAvailable : null,
        } : null,
        checked: this.capabilities.has(account.id),
        connectorReady: Boolean(host && this.connectors.get(account.id) === host.connectorName()) };
    }) };
  }
  accountIdentityLease(id) {
    const host = this.getHost(id);
    return Object.freeze({
      accountId: id,
      identityEpoch: host.authIdentityEpoch,
      principalFingerprint: host.authPrincipalFingerprint,
    });
  }
  recordUsage(action) {
    try { action(); }
    catch { this.usage.error = 'Usage recording failed; stored history was preserved and totals may be incomplete.'; }
  }
  usageObservation(traceId, helperPid, receipt, effort, modelVersion, outcome, modelVersionSource, messageKind) {
    const host = this.ownerForTrace(traceId);
    const tab = [...host.turnTabs.values()].find(tab => tab.traceId === traceId && tab.helperPid === helperPid);
    if (!tab || tab.status !== 'running') throw new Error('Usage observation has no active owner');
    if (typeof receipt !== 'string' || !/^[a-f0-9-]{36}$/.test(receipt)) throw new Error('Invalid usage receipt');
    this.recordUsage(() => {
      this.usage.accept(traceId, helperPid, receipt, effort, modelVersion, 'automatic', host.accountId,
        { modelVersionSource, messageKind });
      if (outcome === 'completed') this.usage.finish(traceId, helperPid, outcome, receipt);
    });
  }
  usageSnapshot(query) {
    const accounts = this.registry.snapshot().accounts.map(({ id, label }) => ({ id, label }));
    return this.usage.snapshot(query, accounts);
  }
  recordNativeUsage(value) { return this.usage.recordNative(value); }
  async setAccountProxy(id, value) {
    const proxy = validateProxy(value);
    const host = this.getHost(id);
    const previous = this.network.get(id);
    if (proxy.mode === previous.mode && (proxy.url ?? null) === (previous.url ?? null)) {
      return this.accountSnapshot();
    }
    const releaseOperation = this.acquireAccountOperation(id, 'Account proxy change');
    this.networkOperation = id;
    try {
      await host.ready();
      await this.network.apply(host.view.webContents.session, proxy);
      this.network.save(id, proxy);
      this.invalidateEvidence(id);
      return this.accountSnapshot();
    } catch (error) {
      try { await this.network.apply(host.view.webContents.session, previous); }
      catch (restoreError) { throw new AggregateError([error, restoreError], 'Account proxy change and restoration failed'); }
      throw error;
    } finally {
      this.networkOperation = null;
      releaseOperation();
      this.publish();
    }
  }
  setAccountSafety(id, policy) {
    const host = this.getHost(id);
    this.assertAccountOperationAvailable(id);
    if (host.activeTraceId || host.currentOperation()) throw new Error('Wait for account activity before changing pacing');
    this.safety.setPolicy(id, policy); this.publish(); return this.accountSnapshot();
  }
  resumeAccount(id) {
    const host = this.getHost(id);
    this.assertAccountOperationAvailable(id);
    if (host.activeTraceId || host.currentOperation()) throw new Error('Wait for account activity before resuming');
    this.safety.resume(id); this.publish(); return this.accountSnapshot();
  }
  evidenceEpoch(id) { return this.evidenceEpochs.get(id) ?? 0; }
  invalidateEvidence(id) {
    this.capabilities.delete(id);
    this.connectors.delete(id);
    const epoch = this.evidenceEpoch(id) + 1;
    this.evidenceEpochs.set(id, epoch);
    return epoch;
  }
  invalidateAllEvidence() {
    for (const account of this.registry.snapshot().accounts) this.invalidateEvidence(account.id);
    this.publish();
    return this.accountSnapshot();
  }
  evidenceIsCurrent(id, epoch) {
    return this.evidenceEpoch(id) === epoch;
  }
  snapshot() {
    const selected = this.registry.snapshot().selectedId;
    const state = this.selectedHost().snapshot();
    const labels = new Map(this.registry.snapshot().accounts.map(account => [account.id, account.label]));
    return { ...state, accountId: selected, accountName: labels.get(selected),
      ...(this.workspaceDirectory ? { workspaces: this.workspaceSnapshot() } : {}),
      queue: this.admissionQueue ? { ...this.admissionQueue.snapshot(),
        accounts: [...labels].map(([id, label]) => ({ id, label })) } : undefined,
      taskHistoryHealth: [...labels].flatMap(([accountId, accountName]) =>
        this.taskLedgers?.get(accountId)?.storageIssue === 'task-history-unavailable'
          ? [{ accountId, accountName, issue: 'task-history-unavailable' }] : []),
      tasks: [...(this.taskLedgers ?? [])].flatMap(([id, ledger]) => {
        const host = this.hosts.get(id);
        return (host?.taskSnapshot?.() ?? ledger.snapshot().map(row => ({ ...row,
          canOpen: false, canCancel: false, canDismiss: row.terminal,
          retrySafe: row.terminal && row.submission === 'not-sent',
        }))).map(task => ({ ...task, accountId: id, accountName: labels.get(id) }));
      }).sort((a, b) => b.createdAt - a.createdAt),
      maxTabs: this.options.maxTabs,
      tabs: [...state.tabs.filter(tab => tab.id === 'home'), ...[...this.hosts].flatMap(([id, host]) =>
        host.snapshot().tabs.filter(tab => tab.id !== 'home').map(tab => ({ ...tab,
          active: id === selected && tab.active, accountId: id,
          title: `${labels.get(id)} · ${tab.title}` }))) ] };
  }
  publish() {
    if (this.destroyed || this.creatingHosts.size) return;
    for (const [id, host] of this.hosts) {
      const authenticated = host.state.authenticated === true;
      const previous = this.publishedAuthentication.get(id);
      if (!authenticated && previous !== false) this.invalidateEvidence(id);
      this.publishedAuthentication.set(id, authenticated);
    }
    if (this.hosts.size) this.options.publishState?.(this.snapshot());
  }
  writeDescriptor() {
    if (this.destroyed) return;
    const descriptors = [...this.hosts.values()].flatMap(host => {
      try { return [JSON.parse(fs.readFileSync(host.descriptorPath, 'utf8'))]; }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    });
    const selectedId = this.registry.snapshot().selectedId;
    let selected = descriptors.find(descriptor => descriptor.accountId === selectedId);
    if (!selected) {
      if (this.initializingHosts) return; // Wait for the saved selected host, never publish default as home.
      const pendingHost = this.hosts.get(selectedId);
      const primary = descriptors.find(descriptor => descriptor.accountId === 'default');
      if (!this.addingAccount || !pendingHost || !primary) {
        throw new Error(`Selected ChatGPT account ${selectedId} has no browser descriptor`);
      }
      // During account creation, publish the new home identity before its target exists. Setup
      // cannot inspect another account, while existing turn targets remain in the union below.
      selected = { ...primary, accountId: pendingHost.accountId,
        partition: pendingHost.partition, surfaceId: pendingHost.surfaceId };
    }
    const targets = Object.assign({}, ...descriptors.map(descriptor => descriptor.surfaceTargets));
    // The home session belongs to the selected account; active turn leases still address their
    // exact surface IDs through the union of every account's target map.
    writePrivateFileAtomic(this.options.descriptorPath, JSON.stringify({ ...selected, surfaceTargets: targets }) + '\n');
  }
  async addAccount(label) {
    if (this.addingAccount || this.currentOperation()) throw new Error('Finish the current browser operation before adding an account');
    this.addingAccount = true;
    const previous = this.registry.snapshot().selectedId;
    let id;
    try {
      id = this.registry.add(label).selectedId;
      const host = this.getHost(id);
      this.writeDescriptor();
      await host.ready();
    } catch (error) {
      if (id) {
        let rolledBack = false;
        const liveOwner = (this.hosts.get(id)?.turnTabs.size ?? 0) > 0
          || [...this.reservations.values()].some(owner => owner === id);
        try { if (!liveOwner) rolledBack = this.registry.removeFailedAdd(id, previous); }
        catch (rollbackError) {
          this.logger.warn('browser.account_add_rollback_failed', { accountId: id, message: rollbackError.message });
        }
        if (rolledBack) {
          const host = this.hosts.get(id);
          if (host && host.turnTabs.size === 0) {
            host.destroy(); this.hosts.delete(id);
            this.workspaceRegistrations.get(id)?.(); this.workspaceRegistrations.delete(id);
            this.workspaceSessionMutations.get(id)?.invalidate('ChatGPT account addition rolled back');
            this.workspaceSessionMutations.delete(id);
            try { this.writeDescriptor(); }
            catch (descriptorError) {
              this.logger.warn('browser.account_descriptor_refresh_failed', { accountId: id, message: descriptorError.message });
            }
          }
        } else {
          this.syncVisibility(); this.publish();
          throw new Error(`Account ${id} was saved, but browser readiness failed; review the saved account in Settings`, { cause: error });
        }
        this.syncVisibility(); this.publish();
      }
      throw error;
    } finally { this.addingAccount = false; }
    this.writeDescriptor();
    this.selectionRevision++;
    this.syncVisibility(); this.publish();
    return this.accountSnapshot();
  }
  async selectAccount(id) {
    if (this.passkeyImportLease && this.passkeyImportLease.id !== id) throw new Error('Finish or cancel passkey sign-in before switching accounts');
    if (this.addingAccount) throw new Error('Finish adding the ChatGPT account before switching accounts');
    const host = this.getHost(id);
    this.assertAccountOperationAvailable(id);
    const revision = ++this.selectionRevision;
    await host.ready();
    if (this.selectionRevision !== revision) throw new Error('Account selection changed while opening the browser account');
    if (this.addingAccount) throw new Error('Finish adding the ChatGPT account before switching accounts');
    this.assertAccountOperationAvailable(id);
    const previous = this.registry.snapshot().selectedId;
    this.registry.select(id);
    try { this.writeDescriptor(); }
    catch (error) {
      this.registry.select(previous);
      this.writeDescriptor();
      throw error;
    }
    this.selectionRevision++;
    this.syncVisibility(); this.publish();
    return this.accountSnapshot();
  }
  setAccountEnabled(id, enabled) {
    const account = this.registry.snapshot().accounts.find(candidate => candidate.id === id);
    if (!account) throw new Error('Account does not exist');
    if (account.enabled === enabled) return this.accountSnapshot();
    this.assertAccountOperationAvailable(id);
    this.registry.setEnabled(id, enabled);
    // Enabled controls only fresh unbound admission. Authentication/capability proof and exact
    // running or retained ownership belong to separate lifecycles and are preserved.
    this.publish();
    return this.accountSnapshot();
  }
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
    if (this.inspectionsPaused) throw new Error('Browser checks are paused for launcher restart');
    const host = this.getHost(id);
    this.assertAccountOperationAvailable(id);
    const epoch = this.invalidateEvidence(id);
    try {
      await host.ready();
      if (host.activeTraceId || host.currentOperation()) {
        throw new Error('Finish this account’s active tasks and browser operation before checking it');
      }
      const evidence = await host.inspectSession(true);
      if (!this.evidenceIsCurrent(id, epoch)) {
        throw new Error('ChatGPT account readiness changed while checking it');
      }
      this.capabilities.set(id, evidence);
      if (connector) {
        await host.verifyConnector(host.connectorName());
        if (!this.evidenceIsCurrent(id, epoch)) {
          throw new Error('ChatGPT account readiness changed while checking its connector');
        }
        this.connectors.set(id, host.connectorName());
      }
      return this.accountSnapshot();
    } catch (error) {
      // Failed inspection cannot keep an older connector claim for this session.
      if (this.evidenceEpoch(id) === epoch) this.connectors.delete(id);
      throw error;
    } finally { this.publish(); }
  }
  refreshAccountAuthentication(id) {
    validateAccountId(id);
    if (this.destroyed) return Promise.reject(new Error('ChatGPT account pool is closed'));
    const existing = this.authenticationRefreshOperations.get(id);
    if (existing) return existing;
    if (this.inspectionsPaused) return Promise.reject(new Error('Browser checks are paused for launcher restart'));
    const host = this.getHost(id);
    const conflict = this.accountOperationError(id);
    if (conflict) return Promise.reject(conflict);
    if (host.activeTraceId || [...this.reservations.values()].includes(id)) {
      return Promise.reject(new Error('Finish this account’s active or acquiring tasks before retrying session verification'));
    }
    if (host.browserInteractionMode() !== 'automatic') {
      return Promise.reject(new Error('ChatGPT session verification retry is unavailable in Manual mode'));
    }
    const releaseRead = this.acquireAccountReadOperation(id, 'ChatGPT session verification retry',
      () => { void host.cancelReadOnlyInspection(); });
    const epoch = this.invalidateEvidence(id);
    const identityEpoch = host.authIdentityEpoch;
    let retry;
    try { retry = host.retryAuthenticationCheck(); }
    catch (error) {
      releaseRead();
      this.publish();
      return Promise.reject(error);
    }
    let tracked;
    tracked = retry.then(() => {
      if (this.destroyed || this.hosts.get(id) !== host
        || !this.registry.snapshot().accounts.some(account => account.id === id)) {
        throw new Error('ChatGPT account changed while retrying session verification');
      }
      const currentEpoch = this.evidenceEpoch(id);
      const identityDelta = host.authIdentityEpoch - identityEpoch;
      const expectedIdentityInvalidation = identityDelta === 1 && currentEpoch === epoch + 1;
      if (currentEpoch !== epoch && !expectedIdentityInvalidation) {
        throw new Error('ChatGPT account readiness changed while retrying session verification');
      }
      return this.accountSnapshot();
    }).finally(() => {
      releaseRead();
      if (this.authenticationRefreshOperations.get(id) === tracked) {
        this.authenticationRefreshOperations.delete(id);
      }
      this.publish();
    });
    this.authenticationRefreshOperations.set(id, tracked);
    return tracked;
  }
  async verifyConnector(appName) {
    if (this.inspectionsPaused) throw new Error('Browser checks are paused for launcher restart');
    const id = this.registry.snapshot().selectedId;
    const host = this.getHost(id);
    this.assertAccountOperationAvailable(id);
    const epoch = this.evidenceEpoch(id);
    const result = await host.verifyConnector(appName);
    if (!this.evidenceIsCurrent(id, epoch) || this.registry.snapshot().selectedId !== id) {
      throw new Error('ChatGPT account readiness changed while verifying its connector');
    }
    this.connectors.set(id, host.connectorName());
    this.publish();
    return result;
  }
  async refreshAuthentication() {
    // Authenticate enabled saved sessions, without treating persisted metadata as proof.
    for (const account of this.registry.snapshot().accounts.filter(account => account.enabled)) {
      if (this.inspectionsPaused || this.destroyed) break;
      const reserved = this.accountOperations.get(account.id);
      if (reserved) {
        this.logger.info('browser.account_refresh_deferred', { accountId: account.id, operation: reserved.label });
        continue;
      }
      const host = this.getHost(account.id);
      const epoch = this.invalidateEvidence(account.id);
      try {
        await host.refreshAuthentication();
        if (!this.inspectionsPaused && host.state.authenticated && this.evidenceIsCurrent(account.id, epoch)) {
          const evidence = await host.inspectSession(true);
          if (this.evidenceIsCurrent(account.id, epoch)) {
            this.capabilities.set(account.id, evidence);
            if (!this.inspectionsPaused && account.id === 'default' && this.options.bootstrapPrimaryConnector?.() === true) {
              await host.verifyConnector(host.connectorName());
              if (!this.evidenceIsCurrent(account.id, epoch)) {
                throw new Error('Primary account readiness changed while bootstrapping its connector');
              }
              this.connectors.set(account.id, host.connectorName());
            }
          }
        }
      }
      catch (error) { this.logger.warn('browser.account_refresh_failed', { accountId: account.id, message: error.message }); }
    }
    this.publish();
    return this.snapshot();
  }
  async inspectSession(detectCapabilities, accountId) {
    if (this.inspectionsPaused) throw new Error('Browser checks are paused for launcher restart');
    const id = accountId ?? this.registry.snapshot().selectedId;
    this.assertAccountOperationAvailable(id);
    const epoch = detectCapabilities ? this.invalidateEvidence(id) : null;
    try {
      const evidence = await this.getHost(id).inspectSession(detectCapabilities);
      if (detectCapabilities) {
        if (!this.evidenceIsCurrent(id, epoch)) {
          throw new Error('ChatGPT account readiness changed while inspecting it');
        }
        this.capabilities.set(id, evidence);
      }
      return evidence;
    } catch (error) {
      if (detectCapabilities && this.evidenceEpoch(id) === epoch) this.invalidateEvidence(id);
      throw error;
    } finally { if (detectCapabilities) this.publish(); }
  }
  async openAccountLogin(id) {
    this.assertAccountOperationAvailable(id);
    await this.selectAccount(id);
    const releaseOperation = this.acquireAccountOperation(id, 'ChatGPT account login');
    const host = this.getHost(id);
    const revision = this.selectionRevision;
    const operation = { id, revision };
    this.loginOperation = operation;
    this.embeddedLoginLeases ??= new Map();
    this.embeddedLoginLeases.set(id, releaseOperation);
    try {
      if (this.selectionRevision !== revision || this.registry.snapshot().selectedId !== id) {
        throw new Error('Account selection changed before login started');
      }
      if (host.browserInteractionMode() === "manual") {
        host.activateHomeSurface();
        await host.reveal(false);
      } else await host.openLogin();
      return this.snapshot();
    } finally {
      if (this.loginOperation === operation) this.loginOperation = null;
      if (this.embeddedLoginLeases?.get(id) === releaseOperation) this.embeddedLoginLeases.delete(id);
      releaseOperation();
    }
  }
  ensurePrimaryImport() {
    if (this.registry.snapshot().selectedId !== 'default') throw new Error('Use Sign in for additional accounts; Chrome session import is reserved for the primary profile');
  }
  async openLogin(...args) {
    const id = this.registry.snapshot().selectedId;
    const releaseOperation = this.acquireAccountOperation(id, 'ChatGPT account login');
    this.embeddedLoginLeases ??= new Map();
    this.embeddedLoginLeases.set(id, releaseOperation);
    try { return await this.getHost(id).openLogin(...args); }
    finally {
      if (this.embeddedLoginLeases.get(id) === releaseOperation) this.embeddedLoginLeases.delete(id);
      releaseOperation();
    }
  }
  async openWorkspaceWindow(asTab = false) {
    const account = this.registry.snapshot().accounts.find(account => account.id === this.registry.snapshot().selectedId);
    if (!account || this.destroyed) throw new Error('ChatGPT account is unavailable');
    return this.getHost(account.id).openWorkspaceWindow(asTab, account.label);
  }
  workspaceSnapshot() {
    const snapshot = this.workspaceDirectory.snapshot(this.registry.snapshot().accounts);
    return { ...snapshot, accounts: snapshot.accounts.map(account => ({ ...account,
      sessionMutation: this.workspaceSessionMutations.get(account.accountId)?.snapshot().mutation ?? null,
    })) };
  }
  async openWorkspace(accountId, options = {}) {
    validateAccountId(accountId);
    if (!options || typeof options !== 'object' || typeof options.asTab !== 'boolean') {
      throw new Error('Browser workspace options are invalid');
    }
    const account = this.registry.snapshot().accounts.find(candidate => candidate.id === accountId);
    if (!account || this.destroyed) throw new Error('ChatGPT account is unavailable');
    const host = this.getHost(accountId);
    await host.ready();
    const manager = host.workspaceManager();
    manager.open({ asTab: options.asTab }); this.publish(); return this.snapshot();
  }
  async restoreWorkspaces(accountId) {
    validateAccountId(accountId);
    const account = this.registry.snapshot().accounts.find(candidate => candidate.id === accountId);
    if (!account || this.destroyed) throw new Error('ChatGPT account is unavailable');
    const host = this.getHost(accountId);
    await host.ready();
    const manager = host.workspaceManager();
    manager.restore(); this.publish(); return this.snapshot();
  }
  focusWorkspace(accountId, workspaceId) {
    validateAccountId(accountId); validateWorkspaceId(workspaceId);
    if (!this.workspaceDirectory.focus(accountId, workspaceId)) throw new Error('Browser workspace is not open');
    return this.snapshot();
  }
  async closeWorkspace(accountId, workspaceId) {
    validateAccountId(accountId); validateWorkspaceId(workspaceId);
    if (!await this.workspaceDirectory.close(accountId, workspaceId)) throw new Error('Browser workspace is not open');
    this.publish(); return this.snapshot();
  }
  async closeWorkspaceWindows() {
    for (const host of this.hosts.values()) await host.closeWorkspaceWindows();
  }
  async openPasskeyLogin(...args) {
    if (this.destroyed) throw new Error('ChatGPT account pool is closed');
    const id = this.registry.snapshot().selectedId;
    const host = this.getHost(id);
    if (this.passkeyImportLease) {
      if (this.passkeyImportLease.id !== id) throw new Error('Another account owns passkey sign-in');
      return await host.openPasskeyLogin(...args);
    }
    if (this.existingChromeImportLease) throw new Error('Finish the existing Chrome import before passkey sign-in');
    // Only a pool-owned embedded login can hand off its lease. The host cancels and joins
    // that exact operation before starting the dedicated browser; foreign leases still veto.
    const handoff = this.embeddedLoginLeases?.has(id) && host.embeddedLoginController && host.loginOperation;
    const releaseOperation = handoff ? () => {} : this.acquireAccountOperation(id, 'ChatGPT passkey login');
    const lease = Object.freeze({ id });
    this.passkeyImportLease = lease;
    try { return await host.openPasskeyLogin(...args); }
    finally {
      if (this.passkeyImportLease === lease) this.passkeyImportLease = null;
      releaseOperation();
    }
  }
  async openExistingChromeLogin(...args) {
    if (this.passkeyImportLease) throw new Error('Finish or cancel passkey sign-in before Chrome import');
    this.ensurePrimaryImport();
    if (this.existingChromeImportLease) {
      return await this.getHost('default').openExistingChromeLogin(...args);
    }
    const releaseOperation = this.acquireAccountOperation('default', 'Existing Chrome session import');
    const ownedLease = Object.freeze({ release: releaseOperation });
    this.existingChromeImportLease = ownedLease;
    try { return await this.getHost('default').openExistingChromeLogin(...args); }
    finally {
      if (this.existingChromeImportLease === ownedLease) this.existingChromeImportLease = null;
      releaseOperation();
    }
  }
  async allowExistingChromeFileAccess(...args) {
    this.ensurePrimaryImport();
    // Continue an in-flight pool-owned import under its exact lease. An external account lease
    // has no owned marker here and is rejected by acquireAccountOperation below.
    if (this.existingChromeImportLease) {
      return await this.getHost('default').allowExistingChromeFileAccess(...args);
    }
    const releaseOperation = this.acquireAccountOperation('default', 'Existing Chrome session import');
    try { return await this.getHost('default').allowExistingChromeFileAccess(...args); }
    finally { releaseOperation(); }
  }
  async logout() {
    const id = this.registry.snapshot().selectedId;
    const host = this.selectedHost();
    const releaseOperation = this.acquireAccountOperation(id, 'ChatGPT logout');
    try {
      this.invalidateEvidence(id);
      for (const tab of [...host.turnTabs.values()]) host.removeTurnTab(tab, false);
      await host.logout(); return this.snapshot();
    } finally { releaseOperation(); }
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
    if (this.passkeyImportLease && this.passkeyImportLease.id !== host.accountId) throw new Error('Finish or cancel passkey sign-in before switching accounts');
    if (this.addingAccount) throw new Error('Finish adding the ChatGPT account before switching accounts');
    this.assertAccountOperationAvailable(host.accountId);
    const tab = tabId === 'home' ? null : host.turnTabs.get(tabId);
    const revision = ++this.selectionRevision;
    await host.ready();
    if (this.addingAccount) throw new Error('Finish adding the ChatGPT account before switching accounts');
    this.assertAccountOperationAvailable(host.accountId);
    if (tab && host.turnTabs.get(tabId) !== tab) throw new Error('Browser tab does not exist');
    if (this.selectionRevision !== revision) throw new Error('Account selection changed while opening the browser tab');
    const previous = this.registry.snapshot().selectedId;
    const previousTabId = host.selectedTabId;
    let ownedRevision = revision;
    let selected = false;
    try {
      this.registry.select(host.accountId);
      selected = true;
      ownedRevision = ++this.selectionRevision;
      this.writeDescriptor();
      host.selectTab(tabId);
      this.syncVisibility(); this.publish();
      return this.snapshot();
    } catch (error) {
      // A later user choice owns the selection; compensate only our own publication.
      if (selected && this.selectionRevision === ownedRevision && this.registry.snapshot().selectedId === host.accountId) {
        if (host.selectedTabId !== previousTabId) {
          try { host.selectTab(previousTabId === 'home' || host.turnTabs.has(previousTabId) ? previousTabId : 'home'); }
          catch (rollbackError) { this.logger.warn('browser.tab_activation_rollback_failed', { message: rollbackError.message }); }
        }
        if (this.selectionRevision === ownedRevision && this.registry.snapshot().selectedId === host.accountId) {
          try {
            this.registry.select(previous);
            this.selectionRevision++;
            this.writeDescriptor(); this.syncVisibility(); this.publish();
          }
          catch (rollbackError) { this.logger.warn('browser.tab_selection_rollback_failed', { message: rollbackError.message }); }
        }
      }
      throw error;
    }
  }
  closeTab(tabId, expectedTraceId) { const result = this.ownerForTab(tabId).closeTab(tabId, expectedTraceId); this.publish(); return result; }
  removeTurnTab(tab, abortRunning) { this.ownerForTab(tab.id).removeTurnTab(tab, abortRunning); }
  copyManualPrompt(tabId) { return this.ownerForTab(tabId).copyManualPrompt(tabId); }
  confirmManualSent(tabId) {
    const host = this.ownerForTab(tabId), tab = host.turnTabs.get(tabId);
    const result = host.confirmManualSent(tabId);
    if (tab) this.recordUsage(() => this.usage.accept(tab.traceId, tab.helperPid, 'manual', 'unknown', 'unknown',
      'manual', host.accountId, { modelVersionSource: 'unknown', messageKind: 'task' }));
    return result;
  }
  async withInteractionModeChange(mode, action) {
    if (this.addingAccount || this.activeTraceId || this.currentOperation()) throw new Error('Finish active tasks and account operations before changing interaction mode');
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
    const pinned = existingTrace ?? threadOwner ?? conversationOwner ?? existingTab?.[0] ?? requirement?.requestedAccountId;
    if (pinned && ((threadOwner && threadOwner !== pinned) || (conversationOwner && conversationOwner !== pinned))) {
      throw new Error('Conversation and task account ownership conflict');
    }
    if (retained && !pinned) { const error = new Error('Retained conversation has no account owner'); error.code = 'retained_conversation_unavailable'; throw error; }
    const eligible = account => {
      const host = this.hosts.get(account.id);
      if (!account.enabled || this.accountOperationLabel(account.id) || this.admissionQueue?.accountPaused(account.id)) return false;
      if (host?.state.authenticated !== true) return false;
      const caps = this.capabilities.get(account.id);
      if (config.mode === 'balanced' && account.id !== 'default' && !caps) return false;
      if (requirement?.effort === 'luna' && caps?.solAvailable !== false) return false;
      if (requirement?.effort === 'max' && caps?.proAvailable !== true) return false;
      if (requirement?.effort === 'xhigh' && caps?.extraHighAvailable !== true) return false;
      if (requirement?.effort && requirement.effort !== 'max' && requirement.effort !== 'luna' && caps?.solAvailable !== true) return false;
      if (requirement?.connector && this.connectors.get(account.id) !== requirement.connector) return false;
      return true;
    };
    // Exact retained/running continuations can finish on a disabled account.
    // A fresh pinned turn must pass the same readiness filter without moving affinity.
    if (pinned) {
      const host = this.getHost(pinned);
      const pinnedAccount = config.accounts.find(account => account.id === pinned);
      const runningTrace = [...host.turnTabs.values()].some(tab => tab.traceId === traceId
        && tab.status === 'running' && tab.interactionMode === 'automatic'
        && tab.conversationKey === key && tab.connectorIdentity === requirement?.connector);
      const exactTab = host.exactRetainedTurnTab(key, requirement?.connector);
      const operation = this.accountOperationLabel(pinned);
      if (operation && !runningTrace) {
        throw new Error(`This task remains pinned to its original ChatGPT account, which is busy with ${operation}; retry after it finishes. NEKODEX will not reroute it.`);
      }
      if (!retained && !runningTrace && !exactTab
        && !eligible(pinnedAccount)) {
        if (pinnedAccount?.enabled === false) {
          throw new Error('This task remains pinned to its original ChatGPT account, which is disabled for new tasks. Re-enable that account to continue; NEKODEX will not reroute it.');
        }
        throw new Error('Pinned ChatGPT account is not ready for this model and connector. Sign in and check the account in Settings.');
      }
      return pinned;
    }
    let candidates = config.mode === 'selected'
      ? config.accounts.filter(account => account.id === config.selectedId && eligible(account))
      : config.accounts.filter(eligible);
    const load = id => [...(this.hosts.get(id)?.turnTabs.values() ?? [])].filter(tab => tab.status === 'running').length
      + [...this.reservations.values()].filter(value => value === id).length;
    if (config.mode === 'balanced') {
      const blocked = [];
      candidates = candidates.filter(account => {
        const availability = this.safety.availability(account.id, load(account.id), { createsNewSession: true });
        if (!availability.eligible) blocked.push({ accountId: account.id, ...availability });
        return availability.eligible;
      });
      if (!candidates.length && blocked.length) {
        const retries = blocked.map(item => item.retryAt).filter(Number.isFinite);
        throw Object.assign(new Error('Matching accounts are waiting for local pacing or resume. No request was sent.'), {
          code: 'account_cooldown', workStarted: false,
          retryAt: retries.length ? Math.min(...retries) : undefined,
          blockers: blocked.map(({ accountId, reason, retryAt }) => ({ accountId, reason, retryAt })),
        });
      }
    }
    candidates.sort((a, b) => load(a.id) - load(b.id) || (this.lastAssigned.get(a.id) ?? 0) - (this.lastAssigned.get(b.id) ?? 0));
    if (!candidates.length) {
      const blocked = config.mode === 'selected'
        ? config.accounts.find(account => account.id === config.selectedId)
        : config.accounts.find(account => this.accountOperationLabel(account.id));
      const operation = blocked && this.accountOperationLabel(blocked.id);
      if (operation) {
        throw new Error(`${blocked.label} is busy with ${operation}; retry after it finishes`);
      }
      throw new Error('No enabled ChatGPT account is ready for this model and connector. Sign in and check the account in Settings.');
    }
    return candidates[0].id;
  }
  ensureTabCapacity(host, traceId, key, connector, manual = false) {
    const tabs = [...this.turnTabs.values()];
    const sameTrace = [...host.turnTabs.values()].find(tab => tab.traceId === traceId);
    if (sameTrace?.status === 'running' && sameTrace.interactionMode === (manual ? 'manual' : 'automatic')
      && (manual || (sameTrace.conversationKey === key && sameTrace.connectorIdentity === connector))) return;
    const reusable = manual
      ? [...host.turnTabs.values()].filter(tab => key && tab.interactionMode === 'manual'
        && tab.status === 'ready' && tab.conversationKey === key)
      : [host.exactRetainedTurnTab(key, connector)].filter(Boolean);
    if (reusable.length === 1) return;
    const represented = new Set(tabs.map(tab => tab.traceId));
    const pending = [...this.reservations.keys()].filter(trace => trace !== traceId && !represented.has(trace)).length;
    let occupied = tabs.length + pending;
    while (occupied >= this.options.maxTabs) {
      if (![...this.hosts.values()].some(candidate => candidate.evictOldestReclaimableTurnTab())) {
        throw new Error('Global browser tab capacity is full');
      }
      occupied--;
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
    writePrivateFileAtomic(this.affinityPath, JSON.stringify(Object.fromEntries(next)) + '\n', { durable: true });
    this.affinity = next;
  }
  releaseRetainedConversation(conversationKey) {
    if (typeof conversationKey !== 'string' || !/^[a-f0-9]{64}$/.test(conversationKey)) {
      throw new Error('Conversation key is invalid');
    }
    const owners = [...this.hosts.values()].map(host => ({
      host,
      tabs: [...host.turnTabs.values()].filter(tab => tab.status === 'ready'
        && tab.conversationKey === conversationKey),
    })).filter(entry => entry.tabs.length > 0);
    if (owners.length > 1) {
      throw new Error('Retained conversation has multiple account owners');
    }
    const owner = owners[0];
    if (!owner) return 0;
    let released = 0;
    for (const tab of owner.tabs) {
      owner.host.removeTurnTab(tab, false);
      if (!owner.host.turnTabs.has(tab.id)) {
        released += 1;
        this.logger.info('browser.tab_released', {
          tabId: tab.id,
          traceId: tab.traceId,
          status: tab.status,
          reason: 'retained_conversation_superseded',
        });
      }
    }
    this.publish();
    return released;
  }
  async beginTurn(traceId, reveal, helperPid, key, connector, retained, requirement) {
    requirement?.admissionSignal?.throwIfAborted();
    if (this.destroyed) throw new Error('Browser account pool is closed');
    const admissionRevision = this.assertTurnAdmission();
    if (this.reservations.has(traceId)) throw new Error('Browser turn is already acquiring its account');
    const active = [...this.turnTabs.values()].filter(tab => tab.status === 'running');
    const activeTraces = new Set([...active.map(tab => tab.traceId), ...this.reservations.keys()]);
    if (!activeTraces.has(traceId) && activeTraces.size >= this.options.maxTabs) throw Object.assign(new Error('Global browser capacity is full'), { code: 'browser_capacity_full' });
    if (!activeTraces.has(traceId) && this.admissionQueue?.paused) throw Object.assign(new Error('New browser tasks are paused'), { code: 'account_cooldown' });
    const id = this.chooseAccount(traceId, key, retained, { ...requirement, connector });
    const assertHistoryAvailable = () => {
      if (this.taskLedgers?.get(id)?.storageIssue) {
        throw Object.assign(new Error('Task history is unavailable for this account. Repair its journal before starting a task. No request was sent.'), {
          code: 'task-history-unavailable', workStarted: false,
        });
      }
    };
    // Legacy starts bypass queue preview. Refuse before reserving an owner or
    // consuming pacing, and recheck after readiness yields to other operations.
    assertHistoryAvailable();
    const admissionEpoch = this.evidenceEpoch(id);
    const revealRevision = this.selectionRevision;
    const keys = [key, requirement?.routingKey].filter(Boolean);
    this.reservations.set(traceId, id);
    this.pendingAffinity.set(traceId, { id, keys });
    this.traceOwners.set(traceId, id);
    this.lastAssigned.set(id, ++this.sequence);
    let newSessionReservation;
    let newSessionRecorded = false;
    let safetyBefore, safetyAfter;
    try {
      const host = this.getHost(id);
      if (keys.some(binding => this.affinity.has(binding) && this.affinity.get(binding) !== id)) {
        throw new Error('Conversation and task account ownership conflict');
      }
      const newKeys = [...new Set(keys)].filter(binding => !this.affinity.has(binding));
      if (this.affinity.size + newKeys.length > 100000) throw new Error('Account affinity registry is full');
      await host.ready();
      requirement?.admissionSignal?.throwIfAborted();
      assertHistoryAvailable();
      if (this.destroyed) throw new Error('Browser account pool is closed');
      if (this.workspaceSessionMutations?.get(id)?.snapshot().admissionBlocked) {
        throw Object.assign(new Error('This ChatGPT account is changing its browser identity. No request was sent.'), {
          code: 'account_cooldown', workStarted: false,
        });
      }
      if (!this.turnAdmission.open || this.turnAdmissionRevision !== admissionRevision) {
        throw new Error('NEKODEX turn admission changed while acquiring this task; retry after launcher activity finishes');
      }
      const account = this.registry.snapshot().accounts.find(candidate => candidate.id === id);
      const runningSession = [...host.turnTabs.values()].find(tab => tab.traceId === traceId
        && tab.status === 'running' && tab.interactionMode === 'automatic'
        && tab.conversationKey === key && tab.connectorIdentity === connector);
      const retainedSession = host.exactRetainedTurnTab(key, connector);
      if (!runningSession && (this.admissionQueue?.paused || this.admissionQueue?.accountPaused(id))) {
        throw Object.assign(new Error('New browser tasks are paused. No request was sent.'), { code: 'account_cooldown' });
      }
      const reusesWebSession = Boolean(runningSession || retainedSession);
      const exactContinuation = retained || reusesWebSession;
      if (!exactContinuation) {
        if (!account || !account.enabled) throw new Error('ChatGPT account is no longer enabled for this turn');
        if (this.evidenceEpoch(id) !== admissionEpoch) {
          throw new Error('ChatGPT account readiness changed while acquiring this turn');
        }
        if (this.chooseAccount(traceId, key, retained, { ...requirement, connector }) !== id) {
          throw new Error('ChatGPT account selection changed while acquiring this turn');
        }
      }
      if (retained) host.precheckRetainedTurn(traceId, key, connector);
      if (!activeTraces.has(traceId)) {
        const accountActive = [...this.turnTabs.values()].filter(tab => tab.status === 'running'
          && this.traceOwners.get(tab.traceId) === id).length
          + [...this.reservations].filter(([reservedTrace, owner]) => reservedTrace !== traceId && owner === id).length;
        const createsNewSession = !reusesWebSession;
        newSessionReservation = createsNewSession ? newWebSessionReservationId(id, traceId) : undefined;
        if (requirement?.deferAffinity) safetyBefore = this.safety.entry(id);
        const admission = this.safety.admit(id, accountActive, {
          createsNewSession,
          ...(newSessionReservation ? { sessionId: newSessionReservation } : {}),
        });
        newSessionRecorded = admission.newSessionRecorded;
        if (requirement?.deferAffinity) safetyAfter = this.safety.entry(id);
        if (requirement?.deferAffinity) {
          this.unsentAdmissions.set(traceId, { helperPid, id, keys, newSessionReservation, newSessionRecorded, safetyBefore, safetyAfter });
        }
      }
      host.assertLiveConversationOwner(traceId, key);
      this.ensureTabCapacity(host, traceId, key, connector);
      requirement?.admissionSignal?.throwIfAborted();
      // Keep the turn owner and its tab independent from visible selection. The
      // automatic reveal owns the selection only while its revision is current.
      const lease = await host.beginTurn(traceId, false, helperPid, key, connector, retained, requirement?.taskProgressVersion, taskModelForRequirement(requirement));
      if (newSessionRecorded && lease.reused) {
        const clocksStillOwned = this.safety.entry(id) === safetyAfter;
        this.safety.rollbackNewSession(id, newSessionReservation);
        newSessionRecorded = false;
        const pending = this.unsentAdmissions.get(traceId);
        if (pending) {
          pending.newSessionRecorded = false;
          if (clocksStillOwned) pending.safetyAfter = this.safety.entry(id);
        }
      }
      if (reveal && !this.accountOperationLabel(id) && this.selectionRevision === revealRevision) {
        this.registry.select(id);
        this.selectionRevision++;
        this.syncVisibility();
        host.selectTab(lease.tabId);
        host.show();
      }
      if (!requirement?.deferAffinity) this.persistAffinity(keys, id);
      this.writeDescriptor(); this.publish();
      return { ...lease, accountId: id };
    } catch (error) {
      // No other account is tried here: even a failed acquisition can own a live tab.
      const ownsTab = [...this.getHost(id).turnTabs.values()].some(tab => tab.traceId === traceId);
      let rollbackFailed = false;
      if (!ownsTab && (newSessionRecorded || this.unsentAdmissions?.has(traceId))) {
        try {
          if (requirement?.deferAffinity) this.rollbackUnsentAdmission(traceId, helperPid);
          else this.safety.rollbackNewSession(id, newSessionReservation);
        }
        catch (rollbackError) {
          rollbackFailed = true;
          this.logger.warn('browser.account_new_session_rollback_failed', {
            accountId: id,
            message: rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
          });
        }
      }
      if (ownsTab && !requirement?.deferAffinity) {
        try { this.persistAffinity(keys, id); }
        catch (affinityError) { this.logger.warn('browser.account_affinity_write_failed', { accountId: id, message: affinityError.message }); }
      } else if (!ownsTab) { this.traceOwners.delete(traceId); if (!rollbackFailed) this.unsentAdmissions?.delete(traceId); }
      throw error;
    } finally { this.reservations.delete(traceId); if (!this.unsentAdmissions?.has(traceId)) this.pendingAffinity.delete(traceId); }
  }
  heartbeatTurn(...args) { return this.ownerForTrace(args[0]).heartbeatTurn(...args); }
  registerArtifactDownload(...args) { return this.ownerForTrace(args[0]).registerArtifactDownload(...args); }
  waitArtifactDownload(...args) { return this.ownerForTrace(args[0]).waitArtifactDownload(...args); }
  cancelArtifactDownload(...args) { return this.ownerForTrace(args[0]).cancelArtifactDownload(...args); }
  queueTurn(body, reveal) {
    const existing = this.admissionQueue.entries.find(row => row.request.traceId === body.traceId);
    const config = this.registry.snapshot();
    return this.admissionQueue.request({ traceId: body.traceId, helperPid: body.helperPid,
      reveal: existing ? existing.request.reveal : reveal,
      key: body.conversationKey ?? null, connector: body.connectorIdentity ?? null,
      requestedModel: body.requestedModel ?? null,
      retained: body.requireRetainedConversation === true, effort: body.requestedEffort ?? null,
      routingKey: body.accountRoutingKey ?? null, taskProgressVersion: 1,
      requestedAccountId: existing ? existing.request.requestedAccountId : config.mode === 'selected' ? config.selectedId : null,
    });
  }
  previewAdmission(request) {
    if (!this.turnAdmission.open || this.destroyed) return { reason: 'runtime-transition' };
    if ([...this.taskLedgers.values()].some(ledger => ledger.snapshot().some(row => row.traceId === request.traceId
      && row.terminal && row.submission !== 'not-sent'))) return { reason: 'previous-submission-needs-review' };
    const active = new Set([...this.turnTabs.values()].filter(tab => tab.status === 'running').map(tab => tab.traceId));
    for (const trace of this.reservations.keys()) active.add(trace);
    if (!active.has(request.traceId) && active.size >= this.options.maxTabs) return { reason: 'capacity' };
    try {
      const id = this.chooseAccount(request.traceId, request.key ?? undefined, request.retained, {
        effort: request.effort, connector: request.connector, routingKey: request.routingKey,
        requestedAccountId: request.requestedAccountId ?? undefined,
      });
      const host = this.getHost(id);
      if (this.taskLedgers.get(id)?.storageIssue === 'task-history-unavailable') return { reason: 'task-history-unavailable' };
      if (this.admissionQueue.accountPaused(id)) return { reason: 'paused-account' };
      const activeCount = [...host.turnTabs.values()].filter(tab => tab.status === 'running').length
        + [...this.reservations.values()].filter(owner => owner === id).length;
      const reuses = [...host.turnTabs.values()].some(tab => tab.traceId === request.traceId && tab.status === 'running')
        || host.exactRetainedTurnTab(request.key, request.connector ?? undefined);
      if (!reuses && this.turnTabs.size >= this.options.maxTabs
        && ![...this.turnTabs.values()].some(tab => tab.status === 'ready')) return { reason: 'inspection-tabs' };
      const availability = this.safety.availability(id, activeCount, { createsNewSession: !reuses });
      return availability.eligible ? null : { reason: availability.reason, retryAt: availability.retryAt };
    } catch (error) {
      return { reason: error?.code === 'account_cooldown' ? 'local-admission' : 'account-not-ready', retryAt: error.retryAt };
    }
  }
  releaseUnsentAdmission(request) {
    const host = [...this.hosts.values()].find(candidate => [...candidate.turnTabs.values()].some(tab => tab.traceId === request.traceId));
    if (!host) {
      if ([...this.taskLedgers.values()].some(ledger => ledger.snapshot().some(row => row.traceId === request.traceId && row.submission !== 'not-sent'))) return false;
      this.rollbackUnsentAdmission(request.traceId, request.helperPid); return true;
    }
    const tab = [...host.turnTabs.values()].find(candidate => candidate.traceId === request.traceId);
    const record = host.taskLedger.get(tab.taskRecordId);
    if (tab.helperPid !== request.helperPid || !record || record.submission !== 'not-sent') return false;
    this.rollbackUnsentAdmission(request.traceId, request.helperPid);
    host.removeTurnTab(tab, true); this.traceOwners.delete(request.traceId); this.publish(); return true;
  }
  rollbackUnsentAdmission(traceId, helperPid) {
    const admission = this.unsentAdmissions?.get(traceId);
    if (!admission) return;
    if (admission.helperPid !== helperPid) throw new Error('Unsent admission owner mismatch');
    this.safety.rollbackUnsentAdmission(admission.id, admission.newSessionRecorded ? admission.newSessionReservation : undefined,
      admission.safetyBefore, admission.safetyAfter);
    this.unsentAdmissions.delete(traceId); this.pendingAffinity.delete(traceId);
  }
  admissionLeaseCurrent(request, lease) {
    const host = [...this.hosts.values()].find(candidate => [...candidate.turnTabs.values()].some(tab => tab.traceId === request.traceId));
    const tab = host && [...host.turnTabs.values()].find(candidate => candidate.traceId === request.traceId);
    return Boolean(tab && tab.status === 'running' && tab.helperPid === request.helperPid && tab.surfaceId === lease?.surfaceId);
  }
  acknowledgeQueuedOwner(traceId, helperPid, surfaceId) { return this.admissionQueue.acknowledge(traceId, helperPid, surfaceId); }
  cancelQueuedOwner(traceId, helperPid) { return this.admissionQueue.cancelOwner(traceId, helperPid); }
  async queueAction(id, action) { await this.admissionQueue.action(id, action); return this.snapshot(); }
  pauseQueue(accountId, paused) {
    if (accountId !== null && !this.registry.snapshot().accounts.some(account => account.id === accountId)) throw new Error('Unknown account');
    this.admissionQueue.pause(accountId, paused); return this.snapshot();
  }
  taskProgress(...args) {
    const [traceId, helperPid, , phase] = args;
    const result = this.ownerForTrace(traceId).taskProgress(...args);
    const admission = this.unsentAdmissions?.get(traceId);
    if (admission && phase !== 'preparing') {
      if (admission.helperPid !== helperPid) throw new Error('Admission progress owner mismatch');
      this.persistAffinity(admission.keys, admission.id);
      this.unsentAdmissions.delete(traceId); this.pendingAffinity.delete(traceId);
    }
    return result;
  }
  dismissTask(accountId, id) {
    const host = this.getHost(accountId);
    const record = host.taskLedger.get(id);
    if (!record?.terminal) throw new Error('Only a finished task can be dismissed');
    const tab = host.turnTabs.get(record.tabId);
    if (tab?.taskRecordId === id) {
      if (tab.status === 'running') throw new Error('Task is still running');
      // Dismissing a completed history row must not destroy its usable continuation.
      if (record.phase !== 'completed') host.removeTurnTab(tab, false);
    }
    host.taskLedger.dismiss(id); this.publish(); return this.snapshot();
  }
  async endTurn(traceId, helperPid, status, reveal, message, retain, connectorBound, failureCode) {
    const owner = this.ownerForTrace(traceId);
    const id = this.traceOwners.get(traceId) ?? owner.accountId;
    // Host validates trace/helper ownership before account-wide state can change.
    const tab = [...owner.turnTabs.values()].find(candidate => candidate.traceId === traceId && candidate.helperPid === helperPid);
    if (tab && owner.taskLedger?.get(tab.taskRecordId)?.submission === 'not-sent') this.rollbackUnsentAdmission(traceId, helperPid);
    const result = await owner.endTurn(traceId, helperPid, status, reveal, message, retain, connectorBound);
    this.admissionQueue?.retire(traceId, helperPid);
    this.recordUsage(() => this.usage.finish(traceId, helperPid, status, undefined, failureCode));
    try { if (id && status === 'failed') this.safety.fail(id, failureCode); }
    catch (error) {
      this.logger.warn('browser.account_safety_failure_record_failed', {
        accountId: id,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally { this.traceOwners.delete(traceId); this.publish(); }
    return result;
  }
  beginManualTurn(...args) {
    this.assertTurnAdmission();
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
    const host = this.getHost(id);
    const runningTrace = [...host.turnTabs.values()].some(tab => tab.traceId === traceId && tab.status === 'running');
    const operation = this.accountOperationLabel(id);
    if (!runningTrace && operation) {
      throw new Error(`${this.registry.snapshot().accounts.find(account => account.id === id)?.label ?? 'Selected account'} is busy with ${operation}; new Manual turns are unavailable until it finishes`);
    }
    host.assertLiveConversationOwner(traceId, key);
    this.ensureTabCapacity(host, traceId, key, null, true);
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
  endManualTurn(...args) {
    const result = this.ownerForTrace(args[0]).endManualTurn(...args);
    this.recordUsage(() => this.usage.finish(args[0], args[1], args[2]));
    this.traceOwners.delete(args[0]); this.publish(); return result;
  }
  async persistSession() { await Promise.all([...this.hosts.values()].map(host => host.persistSession())); }
  async cancelReadOnlyInspections() {
    this.inspectionsPaused = true;
    const reads = [...(this.accountReadOperations?.values() ?? [])]
      .flatMap(operations => [...operations.values()]);
    for (const read of reads) {
      try { read.cancel(); } catch {}
    }
    let settlementTimer;
    const readSettlement = Promise.race([
      Promise.allSettled(reads.map(read => read.settled)),
      new Promise((_, reject) => {
        settlementTimer = setTimeout(() => reject(new Error('Account read cancellation timed out')),
          ACCOUNT_READ_SETTLEMENT_TIMEOUT_MS);
        settlementTimer.unref?.();
      }),
    ]).finally(() => clearTimeout(settlementTimer));
    const results = await Promise.allSettled([
      ...[...this.hosts.values()].map(host => host.cancelReadOnlyInspection()),
      readSettlement,
    ]);
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
  destroy() {
    this.destroyed = true;
    this.admissionQueue?.close();
    for (const coordinator of this.workspaceSessionMutations?.values() ?? []) {
      coordinator.invalidate('Browser account pool closed');
    }
    this.existingChromeImportLease = null;
    this.accountOperations.clear();
    for (const operations of this.accountReadOperations?.values() ?? []) {
      for (const read of operations.values()) {
        try { read.cancel(); } catch {}
      }
    }
    this.accountReadOperations?.clear();
    for (const unregister of this.workspaceRegistrations.values()) unregister();
    this.workspaceRegistrations.clear();
    for (const host of this.hosts.values()) host.destroy();
    try { if (JSON.parse(fs.readFileSync(this.options.descriptorPath, 'utf8')).pid === process.pid) fs.rmSync(this.options.descriptorPath); } catch {}
  }
}
module.exports = { AccountBrowserPool, newWebSessionReservationId };
