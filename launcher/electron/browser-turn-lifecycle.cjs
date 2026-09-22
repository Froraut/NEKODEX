const { publishBrowserSnapshot } = require("./browser-state-publication.cjs");
const { randomBytes } = require("node:crypto");
const { processRunning } = require("./process-tree.cjs");
const { refreshTurnLeasesAfterSuspension, sweepGapIndicatesSuspension } = require("./turn-suspension.cjs");

const MAX_CANCELLED_TURN_TRACES = 256;
// Lease guards reclaim lost helpers, never a live heartbeating ChatGPT turn.
const TURN_HEARTBEAT_SWEEP_MS = 5_000;
const TURN_HEARTBEAT_TIMEOUT_MS = 60_000;
const TURN_TAB_BOOTSTRAP_TIMEOUT_MS = 120_000;
const RETAINED_TURN_TAB_TTL_MS = 30 * 60 * 1000;

// Owns membership and turn transitions. Ports deliberately expose only the host operations
// needed by those transitions; Electron, authentication and Manual prompt/waiter logic stay
// in the host. The supplied Map is never replaced (the account pool observes its identity).
class BrowserTurnLifecycle {
  constructor({ tabs, closedOwners, cancelledOwners, context, views, presentation, manual,
    artifacts, events, logger, lastSweepAt = Date.now() }) {
    Object.assign(this, { tabs, closedOwners, cancelledOwners, context, views, presentation,
      manual, artifacts, events, logger, lastSweepAt });
  }

  register(tab) {
    this.tabs.set(tab.id, tab);
  }

  // Shutdown is not normal removal: it grants no settlement/refund receipt and does not
  // rewrite durable task outcomes. Manual waiters must all settle, even when suppressed.
  disposeForShutdown() {
    for (const tab of this.tabs.values()) {
      this.manual.dispose(tab, true);
      this.views.dispose(tab);
    }
    this.tabs.clear();
  }

  taskSnapshot() {
    return (this.context.ledger?.snapshot() ?? []).map(record => {
      const tab = this.tabs.get(record.tabId);
      const live = tab?.taskRecordId === record.id && !tab.view.webContents.isDestroyed();
      return { ...record, canOpen: live, canCancel: live && tab.status === 'running',
        canDismiss: record.terminal && (!live || tab.status !== 'running'),
        retrySafe: record.terminal && record.submission === 'not-sent' };
    });
  }

  taskProgress(traceId, helperPid, surfaceId, phase, sequence) {
    const tab = [...this.tabs.values()].find(candidate => candidate.traceId === traceId);
    if (!tab || tab.helperPid !== helperPid || tab.surfaceId !== surfaceId || tab.status !== 'running' || !tab.taskRecordId) {
      throw new Error('Task progress does not match a live browser owner');
    }
    this.context.ledger.progress(tab.taskRecordId, phase, sequence);
    publishBrowserSnapshot(this.presentation);
  }

  async createTurnTab(traceId, helperPid, conversationKey, connectorIdentity, taskProgressVersion, taskModel) {
    if (this.tabs.size >= this.context.maxTabs
      && !this.evictOldestReclaimableTurnTab()) {
      throw new Error(
        `ChatGPT Web already has ${this.context.maxTabs} browser tabs; close one before starting another turn to avoid excessive parallel traffic on the ChatGPT account`,
      );
    }
    const id = randomBytes(12).toString("base64url");
    const taskRecordId = this.context.ledger?.start(traceId, id, taskProgressVersion, taskModel);
    const surfaceId = randomBytes(24).toString("base64url");
    const ordinal = Array.from({ length: this.context.maxTabs }, (_unused, index) => index + 1)
      .find(candidate => ![...this.tabs.values()].some(tab => tab.ordinal === candidate));
    if (!ordinal) throw new Error("ChatGPT Web browser tab allocation is inconsistent");
    const view = this.views.create();
    const tab = {
      id,
      taskRecordId,
      surfaceId,
      traceId,
      conversationKey,
      connectorIdentity,
      connectorBound: false,
      authIdentityEpoch: this.context.authIdentityEpoch,
      authPrincipalFingerprint: this.context.authPrincipalFingerprint,
      helperPid,
      view,
      status: "running",
      ordinal,
      label: `ChatGPT ${ordinal}`,
      pageTitle: "ChatGPT",
      url: this.views.idleUrl,
      loading: true,
      message: "ChatGPT is working",
      interactionMode: "automatic",
      initializingSurface: true,
      bootstrapReady: false,
      rendererReady: false,
      deviceEmulationViewport: null,
      deviceEmulationDirty: true,
      bootstrapDeadlineAt: Date.now() + TURN_TAB_BOOTSTRAP_TIMEOUT_MS,
      lastHeartbeatAt: Date.now(),
    };
    this.register(tab);
    this.events.owned?.({ accountId: this.context.accountId, traceId, helperPid, tabId: id, surfaceId, taskRecordId });
    this.presentation.syncPowerSaveBlocker();
    this.views.attach(tab);
    try {
      await this.views.initialize(tab);
      tab.initializingSurface = false;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error("browser.tab_initialization_failed", {
        tabId: tab.id,
        traceId: tab.traceId,
        message,
      });
      this.removeTurnTab(tab, true);
      throw error;
    }
    return tab;
  }

  evictOldestRetainedTurnTab() {
    const retained = [...this.tabs.values()]
      .filter(tab => tab.status === "ready")
      .sort((left, right) => (left.lastHeartbeatAt ?? 0) - (right.lastHeartbeatAt ?? 0))[0];
    if (!retained) return false;
    this.removeTurnTab(retained, false);
    return true;
  }

  evictOldestReclaimableTurnTab() {
    const terminalManual = [...this.tabs.values()]
      .filter(tab => tab.interactionMode === "manual"
        && tab.status === "error"
        && ["timed-out", "failed", "cancelled"].includes(tab.manualState))
      .sort((left, right) => (left.lastHeartbeatAt ?? 0) - (right.lastHeartbeatAt ?? 0))[0];
    if (terminalManual) {
      this.removeTurnTab(terminalManual, false);
      return true;
    }
    return this.evictOldestRetainedTurnTab();
  }

  heartbeatTurn(traceId, helperPid, refreshViewport = false, expectedSurfaceId) {
    if (typeof refreshViewport !== "boolean") throw new Error("refreshViewport is invalid");
    if (expectedSurfaceId !== undefined
      && (typeof expectedSurfaceId !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(expectedSurfaceId))) {
      throw new Error("Browser turn surface identity is invalid");
    }
    const tab = [...this.tabs.values()].find(candidate => candidate.traceId === traceId);
    if (!tab) {
      const closedOwner = this.closedOwners.get(traceId);
      if (closedOwner === helperPid) throw new Error(`Browser turn ${traceId} was already released`);
      throw new Error(`Browser turn ownership mismatch: no browser tab owns ${traceId}`);
    }
    if (tab.helperPid !== helperPid) {
      throw new Error(`Browser helper ownership mismatch: expected ${tab.helperPid}, received ${helperPid}`);
    }
    if (expectedSurfaceId !== undefined && tab.surfaceId !== expectedSurfaceId) {
      throw new Error(`Browser surface ownership mismatch for turn ${traceId}`);
    }
    if (tab.status !== "running") throw new Error(`Browser turn ${traceId} is no longer running`);
    tab.lastHeartbeatAt = Date.now();
    if (refreshViewport) {
      // Closing an external Playwright CDP session can clear Chromium's effective emulation while
      // Electron still remembers the old dimensions. Mark the exact owned tab dirty and reapply
      // the existing hidden-surface contract before a replacement CDP session is allowed to open.
      tab.deviceEmulationDirty = true;
      this.presentation.syncViewVisibility();
    }
    return this.presentation.snapshot();
  }

  refreshTurnLeases(reason, now = Date.now()) {
    const refreshed = refreshTurnLeasesAfterSuspension(
      [...this.tabs.values()],
      now,
      TURN_TAB_BOOTSTRAP_TIMEOUT_MS,
    );
    if (refreshed.length > 0) {
      this.logger.warn("browser.turn_leases_refreshed_after_suspension", { reason, traceIds: refreshed });
    }
  }

  reapExpiredTurnTabs(now = Date.now()) {
    const cancellations = [];
    const lastSweepAt = this.lastSweepAt;
    this.lastSweepAt = now;
    if (sweepGapIndicatesSuspension(lastSweepAt, now, TURN_HEARTBEAT_SWEEP_MS)) {
      // The launcher itself was frozen, so missing heartbeats prove suspension rather than a dead
      // helper. Re-baseline every active lease before ordinary reaping resumes.
      this.refreshTurnLeases("sweep_gap", now);
      return;
    }
    for (const tab of [...this.tabs.values()]) {
      if (tab.interactionMode === "manual") {
        if (tab.status === "ready") {
          if (now - (tab.lastHeartbeatAt ?? 0) < RETAINED_TURN_TAB_TTL_MS) continue;
          this.logger.info("browser.retained_tab_expired", { tabId: tab.id, traceId: tab.traceId });
          this.removeTurnTab(tab, false);
          continue;
        }
        // A runtime cancellation owns this exact tab until it settles. The helper may exit while
        // the launcher control request is still pending (or after a failed request); reaping here
        // would discard the recovery surface and let the runtime outlive its browser owner.
        if (["pending", "failed"].includes(tab.manualCancellation?.status)) continue;
        if (tab.status === "running" && !processRunning(tab.helperPid)) {
          this.logger.warn("browser.manual_orphan_turn_reaped", {
            tabId: tab.id,
            traceId: tab.traceId,
            helperPid: tab.helperPid,
            evidence: "owner_process_exited",
          });
          this.manual.signalTerminal(tab, "failed");
          this.removeTurnTab(tab, true);
        }
        continue;
      }
      if (tab.status === "ready") {
        if (now - (tab.lastHeartbeatAt ?? 0) < RETAINED_TURN_TAB_TTL_MS) continue;
        this.logger.info("browser.retained_tab_expired", { tabId: tab.id, traceId: tab.traceId });
        this.removeTurnTab(tab, false);
        continue;
      }
      if (tab.status !== "running") continue;
      const bootstrapExpired = tab.bootstrapReady !== true
        && now >= (tab.bootstrapDeadlineAt ?? Number.POSITIVE_INFINITY);
      const heartbeatExpired = tab.bootstrapReady === true
        && now - (tab.lastHeartbeatAt ?? 0) >= TURN_HEARTBEAT_TIMEOUT_MS;
      if (!bootstrapExpired && !heartbeatExpired) continue;
      if (tab.expiryCancellation) {
        cancellations.push(tab.expiryCancellation);
        continue;
      }
      const evidence = bootstrapExpired ? "browser_surface_bootstrap_timeout" : "helper_heartbeat_expired";
      const expiredOwner = {
        tabId: tab.id,
        traceId: tab.traceId,
        helperPid: tab.helperPid,
        evidence,
      };
      this.logger.warn("browser.orphan_turn_expired", expiredOwner);
      if (!this.context.cancelTurn) {
        // The DEV profile has no launcher-owned runtime control callback.
        this.removeTurnTab(tab, true);
        this.logger.warn("browser.orphan_turn_reaped", expiredOwner);
        continue;
      }
      const { traceId, helperPid } = tab;
      tab.expiryCancellation = Promise.resolve().then(async () => {
        try {
          await this.context.cancelTurn(traceId, evidence);
          if (this.tabs.get(tab.id) === tab && tab.traceId === traceId
            && tab.helperPid === helperPid && tab.status === "running") {
            this.removeTurnTab(tab, true);
            this.logger.warn("browser.orphan_turn_reaped", expiredOwner);
          }
        } catch (error) {
          this.logger.warn("browser.orphan_turn_cancel_failed", {
            tabId: tab.id, traceId, evidence, errorType: error?.name || "Error",
          });
        } finally {
          delete tab.expiryCancellation;
        }
      });
      cancellations.push(tab.expiryCancellation);
    }
    return Promise.all(cancellations);
  }

  removeTurnTab(tab, abortRunning) {
    if (this.tabs.get(tab.id) !== tab) return;
    const removedOwner = { accountId: this.context.accountId, traceId: tab.traceId, helperPid: tab.helperPid,
      tabId: tab.id, surfaceId: tab.surfaceId, taskRecordId: tab.taskRecordId };
    if (tab.taskRecordId && this.context.ledger?.get(tab.taskRecordId)?.terminal === false) {
      this.context.ledger.end(tab.taskRecordId, 'aborted');
    }
    this.artifacts.release(tab.traceId, tab.helperPid, new Error("Browser turn surface closed"));
    this.tabs.delete(tab.id);
    this.manual.dispose(tab, false);
    this.presentation.syncPowerSaveBlocker();
    if (abortRunning && tab.status === "running") {
      this.closedOwners.set(tab.traceId, tab.helperPid);
      tab.status = "aborted";
    }
    this.views.dispose(tab);
    // Only the actual removal owner can authorize settlement; a missing tab is not evidence.
    try { this.events.removed?.(removedOwner); }
    catch (error) {
      this.logger.warn('browser.removed_turn_settlement_failed', {
        traceId: removedOwner.traceId, errorType: error?.name || 'Error',
      });
    }
    this.presentation.afterRemoval(tab);
    this.presentation.syncViewVisibility();
    publishBrowserSnapshot(this.presentation);
    this.presentation.writeDescriptor();
  }

  rememberUserCancelledTurn(traceId, helperPid) {
    this.cancelledOwners.delete(traceId);
    this.cancelledOwners.set(traceId, helperPid);
    while (this.cancelledOwners.size > MAX_CANCELLED_TURN_TRACES) {
      const oldest = this.cancelledOwners.keys().next();
      if (oldest.done) break;
      this.cancelledOwners.delete(oldest.value);
    }
  }

  async closeTab(tabId, expectedTraceId) {
    const tab = this.tabs.get(tabId);
    if (!tab) throw new Error("Browser tab does not exist");
    if (expectedTraceId !== undefined && ((expectedTraceId !== null && typeof expectedTraceId !== "string")
      || (typeof expectedTraceId === "string" && expectedTraceId.length > 128) || expectedTraceId !== tab.traceId)) {
      throw new Error("The task in this tab changed; review the current task before closing it");
    }
    const running = tab.status === "running";
    if (tab.interactionMode === "manual") {
      if (running) await this.manual.cancel(tab, "tab-close");
      else {
        this.manual.signalTerminal(tab, "cancelled");
        if (this.tabs.get(tabId) === tab) this.removeTurnTab(tab, true);
      }
      this.logger.info("browser.tab_closed", { tabId, traceId: tab.traceId, status: tab.status });
      return this.presentation.snapshot();
    }
    if (running) {
      this.rememberUserCancelledTurn(tab.traceId, tab.helperPid);
      // A running tab is the browser document for one exact Codex turn. Keep that document alive
      // until the runtime acknowledges cancellation; otherwise a failed control request would
      // destroy the only DOM source while leaving an orphaned Codex turn running.
      if (this.context.cancelTurn) await this.context.cancelTurn(tab.traceId);
    }
    // The helper can deliver /v1/turn/end while targeted cancellation is in flight. In that case
    // endTurn already released this exact tab and there is nothing left to destroy here.
    if (this.tabs.get(tabId) === tab) this.removeTurnTab(tab, true);
    this.logger.info("browser.tab_closed", { tabId, traceId: tab.traceId, status: tab.status });
    return this.presentation.snapshot();
  }

  exactRetainedTurnTab(conversationKey, connectorIdentity) {
    const matches = conversationKey ? [...this.tabs.values()].filter((tab) => (
      tab.interactionMode === "automatic"
      && tab.status === "ready"
      && tab.conversationKey === conversationKey
      && tab.connectorIdentity === connectorIdentity
      && (!connectorIdentity || tab.connectorBound === true)
      && this.views.isTrusted(tab)
    )) : [];
    if (matches.length > 1) {
      throw new Error(`ChatGPT retained conversation ${conversationKey} owns multiple browser tabs`);
    }
    return matches[0] ?? null;
  }

  precheckRetainedTurn(traceId, conversationKey, connectorIdentity) {
    // An already running turn with this trace owns a tab, so the pool will not
    // reclaim capacity for it. beginTurn still validates its final metadata.
    if ([...this.tabs.values()].some(tab => tab.traceId === traceId && tab.status === "running")) return;
    if (this.exactRetainedTurnTab(conversationKey, connectorIdentity)) return;
    const error = new Error("The retained ChatGPT conversation is no longer available");
    error.code = "retained_conversation_unavailable";
    throw error;
  }

  assertLiveConversationOwner(traceId, conversationKey) {
    if (conversationKey && [...this.tabs.values()].some(tab =>
      tab.traceId !== traceId && tab.status === "running" && tab.conversationKey === conversationKey)) {
      throw new Error(`ChatGPT conversation ${conversationKey} is already running under another browser turn`);
    }
  }

  async beginTurn(
    traceId,
    reveal,
    helperPid,
    conversationKey,
    connectorIdentity,
    requireRetainedConversation = false,
    taskProgressVersion,
    taskModel = null,
  ) {
    if (this.context.manualOperation) {
      throw new Error(`ChatGPT browser is busy with ${this.context.manualOperation}`);
    }
    if (this.cancelledOwners.has(traceId)) {
      throw this.context.cancelledError(traceId);
    }
    const sameTrace = [...this.tabs.values()].find((tab) => tab.traceId === traceId);
    if (sameTrace && ['error', 'aborted'].includes(sameTrace.status) && sameTrace.taskRecordId) {
      throw new Error('Review the previous task outcome before starting another attempt. The existing tab was preserved.');
    }
    if (sameTrace && sameTrace.interactionMode !== "automatic") {
      throw new Error(`Browser turn ${traceId} already belongs to Manual mode interaction`);
    }
    if (sameTrace && (sameTrace.conversationKey !== conversationKey
      || sameTrace.connectorIdentity !== connectorIdentity)) {
      throw new Error(`ChatGPT browser turn ${traceId} conversation metadata does not match its owned tab`);
    }
    this.assertLiveConversationOwner(traceId, conversationKey);
    const exactRetained = this.exactRetainedTurnTab(conversationKey, connectorIdentity);
    if (sameTrace?.status === "ready" && sameTrace !== exactRetained) {
      throw new Error(`ChatGPT browser turn ${traceId} is retained under different conversation metadata`);
    }
    const existing = sameTrace?.status === "running" ? sameTrace : exactRetained;
    if (existing) {
      const reused = existing.status === "ready";
      if (reused) existing.taskRecordId = this.context.ledger?.start(traceId, existing.id, taskProgressVersion, taskModel);
      if (existing.status === "running" && existing.helperPid !== helperPid) {
        if (processRunning(existing.helperPid)) {
          throw new Error(`ChatGPT browser turn ${traceId} is owned by another helper process`);
        }
        this.logger.warn("browser.stale_turn_owner_replaced", {
          tabId: existing.id,
          traceId,
          previousHelperPid: existing.helperPid,
          helperPid,
          evidence: "previous helper exited",
        });
      }
      // A departing CDP helper can clear Chromium's emulation while Electron
      // still caches its dimensions. Restore it for the new owner before use.
      existing.deviceEmulationDirty ||= reused || existing.helperPid !== helperPid;
      existing.helperPid = helperPid;
      existing.traceId = traceId;
      this.events.owned?.({ accountId: this.context.accountId, traceId, helperPid, tabId: existing.id,
        surfaceId: existing.surfaceId, taskRecordId: existing.taskRecordId });
      existing.status = "running";
      existing.loading = true;
      existing.message = "ChatGPT is working";
      if (!reused) {
        existing.bootstrapReady = false;
        existing.bootstrapDeadlineAt = Date.now() + TURN_TAB_BOOTSTRAP_TIMEOUT_MS;
      }
      existing.lastHeartbeatAt = Date.now();
      if (!existing.view.webContents.isDestroyed()) {
        existing.view.webContents.setBackgroundThrottling(false);
      }
      if (reveal) this.presentation.selectedTabId = existing.id;
      if (reveal) this.presentation.show();
      else this.presentation.syncViewVisibility();
      publishBrowserSnapshot(this.presentation);
      this.presentation.writeDescriptor();
      this.logger.info("browser.tab_reused", { tabId: existing.id, traceId });
      return {
        surfaceId: existing.surfaceId,
        taskProgressVersion: 1,
        taskProgressSequence: this.context.ledger?.get(existing.taskRecordId)?.sequence ?? 0,
        tabId: existing.id,
        reused,
        connectorBound: existing.connectorBound === true,
      };
    }
    if (requireRetainedConversation) {
      const error = new Error("The retained ChatGPT conversation is no longer available");
      error.code = "retained_conversation_unavailable";
      throw error;
    }
    const tab = await this.createTurnTab(traceId, helperPid, conversationKey, connectorIdentity, taskProgressVersion, taskModel);
    if (reveal) this.presentation.selectedTabId = tab.id;
    if (reveal) this.presentation.show();
    else this.presentation.syncViewVisibility();
    publishBrowserSnapshot(this.presentation);
    this.logger.info("browser.tab_created", { tabId: tab.id, traceId, tabCount: this.tabs.size });
    this.presentation.writeDescriptor();
    return { surfaceId: tab.surfaceId, tabId: tab.id, reused: false, connectorBound: false,
      taskProgressVersion: 1, taskProgressSequence: 0 };
  }

  async endTurn(
    traceId,
    helperPid,
    status,
    hideAfterTurn,
    message,
    retain = false,
    connectorBound = false,
  ) {
    const tab = [...this.tabs.values()].find((candidate) => candidate.traceId === traceId);
    if (!tab) {
      const closedOwner = this.closedOwners.get(traceId);
      if (closedOwner === helperPid) {
        const cancelledByUser = this.cancelledOwners.get(traceId) === helperPid;
        this.closedOwners.delete(traceId);
        return { cancelledByUser };
      }
      throw new Error(`Browser turn ownership mismatch: no browser tab owns ${traceId}`);
    }
    if (tab.helperPid !== helperPid) {
      throw new Error(
        `Browser helper ownership mismatch: expected ${tab.helperPid}, received ${helperPid}`,
      );
    }
    this.artifacts.release(traceId, helperPid, new Error(`Browser turn ${status}`));
    const cancelledByUser = this.cancelledOwners.get(traceId) === helperPid;
    if (tab.taskRecordId) this.context.ledger.end(tab.taskRecordId, status);
    tab.status = status === "completed" ? "ready" : status === "aborted" ? "aborted" : "error";
    this.presentation.syncPowerSaveBlocker();
    tab.message = status === "completed" ? "Task completed" : message || `ChatGPT turn ${status}`;
    tab.loading = false;
    if (!tab.view.webContents.isDestroyed()) tab.view.webContents.setBackgroundThrottling(true);
    if (status === "completed") {
      this.logger.info("browser.tab_completed", { tabId: tab.id, traceId });
    }
    if (status !== 'completed' && !cancelledByUser && tab.taskRecordId) {
      // Preserve the exact document for inspection. It is not a reusable continuation and
      // cannot be silently reclaimed as an ordinary completed tab.
      publishBrowserSnapshot(this.presentation); this.presentation.writeDescriptor();
      return { cancelledByUser };
    }
    if (status === "completed"
      && retain
      && tab.conversationKey
      && (!tab.connectorIdentity || connectorBound)
      && this.views.isTrusted(tab)) {
      tab.connectorBound = connectorBound === true;
      tab.lastHeartbeatAt = Date.now();
      if (hideAfterTurn && !this.context.activeTraceId) this.presentation.hide();
      this.logger.info("browser.tab_retained", { tabId: tab.id, traceId });
      publishBrowserSnapshot(this.presentation);
      this.presentation.writeDescriptor();
      return { cancelledByUser };
    }
    // A browser tab represents an active Codex turn, not durable task history. The result already
    // lives in Codex, so release the terminal browser document without touching concurrent turns.
    this.removeTurnTab(tab, false);
    if (hideAfterTurn && !this.context.activeTraceId) this.presentation.hide();
    this.logger.info("browser.tab_released", { tabId: tab.id, traceId, status: tab.status });
    return { cancelledByUser };
  }
}

module.exports = { BrowserTurnLifecycle, TURN_HEARTBEAT_SWEEP_MS };
