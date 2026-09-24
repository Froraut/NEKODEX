class BrowserWorkspaceDirectory {
  constructor({ platform = process.platform, maximum = 16 } = {}) {
    this.platform = platform;
    this.maximum = maximum;
    this.accounts = new Map();
  }

  register(accountId, label, manager) {
    this.accounts.set(accountId, { accountId, label, manager });
    return () => {
      if (this.accounts.get(accountId)?.manager === manager) this.accounts.delete(accountId);
    };
  }

  snapshot(knownAccounts = []) {
    const requested = new Map(knownAccounts.map(account => [account.id, account.label]));
    for (const { accountId, label } of this.accounts.values()) {
      if (!requested.has(accountId)) requested.set(accountId, label);
    }
    const accounts = [...requested].map(([accountId, label]) => {
      const registered = this.accounts.get(accountId);
      return registered ? { accountId, label, ...registered.manager.snapshot() } : {
        accountId, label, nativeTabs: this.platform === "darwin", items: [], restoreAttempted: false,
        restoreResult: null, manifestStatus: "uninitialized", persistenceFailed: false,
      };
    });
    return {
      platform: this.platform,
      nativeTabs: this.platform === "darwin",
      maximum: this.maximum,
      total: accounts.reduce((sum, account) => sum + account.items.filter(item => item.state === "open").length, 0),
      accounts,
    };
  }

  account(accountId) {
    const entry = this.accounts.get(accountId);
    if (!entry) throw new Error("That ChatGPT account is not available");
    return entry.manager;
  }

  open(accountId, options) { return this.account(accountId).open(options); }
  restore(accountId) { return this.account(accountId).restore(); }
  focus(accountId, workspaceId) { return this.account(accountId).focus(workspaceId); }
  close(accountId, workspaceId) { return this.account(accountId).close(workspaceId); }
}

module.exports = { BrowserWorkspaceDirectory };
