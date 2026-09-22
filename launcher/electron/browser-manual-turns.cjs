const { createHash } = require("node:crypto");
const { processRunning } = require("./process-tree.cjs");

const MANUAL_SUBMIT_TIMEOUT_MS = 30_000;
const MANUAL_COMPACTION_SUBMIT_TIMEOUT_MS = 120_000;
const MAX_MANUAL_TERMINAL_SIGNALS = 256;
const MAX_MANUAL_PROMPT_CHARS = 1_000_000;

function manualPromptDigest(prompt) {
  return createHash("sha256").update(prompt, "utf8").digest("hex");
}

/** Manual handoff policy. The shared lifecycle owns tab membership and Electron owns views. */
class BrowserManualTurns {
  constructor({ tabs, terminals, completions, context, lifecycle, presentation, logger }) {
    this.tabs = tabs;
    this.terminals = terminals;
    this.completions = completions;
    this.context = context;
    this.lifecycle = lifecycle;
    this.presentation = presentation;
    this.logger = logger;
  }

  disposeManualTurn(tab, shutdown = false) {
    if (tab.interactionMode === "manual") {
      if (tab.manualDeadlineTimer) clearTimeout(tab.manualDeadlineTimer);
      tab.manualDeadlineTimer = null;
      tab.manualDeadlineAt = null;
      tab.prompt = null;
      tab.promptDigest = null;
      for (const resolve of tab.manualWaiters || []) resolve({ status: "cancelled" });
      tab.manualWaiters?.clear();
      if (shutdown || !tab.manualTerminalResolutionSuppressed) {
        for (const resolve of tab.manualTerminalWaiters || []) resolve({ status: "cancelled" });
      }
      tab.manualTerminalWaiters?.clear();
    }
  }

  rememberManualTerminal(traceId, helperPid, status) {
    this.terminals.delete(traceId);
    this.terminals.set(traceId, { helperPid, status });
    while (this.terminals.size > MAX_MANUAL_TERMINAL_SIGNALS) {
      const oldest = this.terminals.keys().next();
      if (oldest.done) break;
      this.terminals.delete(oldest.value);
    }
  }

  rememberManualCompletion(traceId, helperPid) {
    this.completions.delete(traceId);
    this.completions.set(traceId, { helperPid });
    while (this.completions.size > MAX_MANUAL_TERMINAL_SIGNALS) {
      const oldest = this.completions.keys().next();
      if (oldest.done) break;
      this.completions.delete(oldest.value);
    }
  }

  signalManualTerminal(tab, status) {
    if (tab.interactionMode !== "manual") return;
    if (tab.manualDeadlineTimer) clearTimeout(tab.manualDeadlineTimer);
    tab.manualDeadlineTimer = null;
    tab.manualDeadlineAt = null;
    tab.manualState = status === "timeout" ? "timed-out" : status;
    tab.lastHeartbeatAt = Date.now();
    tab.prompt = null;
    tab.promptDigest = null;
    this.rememberManualTerminal(tab.traceId, tab.helperPid, status);
    for (const resolve of tab.manualWaiters || []) resolve({ status });
    tab.manualWaiters?.clear();
    for (const resolve of tab.manualTerminalWaiters || []) resolve({ status });
    tab.manualTerminalWaiters?.clear();
  }

  armManualTurnDeadline(tab) {
    if (tab.interactionMode !== "manual"
      || tab.manualState !== "awaiting-user"
      || !tab.manualDeadlineAt) return;
    if (tab.manualDeadlineTimer) clearTimeout(tab.manualDeadlineTimer);
    const delay = Math.max(0, tab.manualDeadlineAt - Date.now());
    tab.manualDeadlineTimer = setTimeout(() => {
      if (this.tabs.get(tab.id) !== tab
        || tab.manualState !== "awaiting-user") return;
      const timeoutSeconds = Math.round(tab.manualSubmitTimeoutMs / 1_000);
      tab.status = "error";
      tab.message = `Prompt submission was not confirmed within ${timeoutSeconds} seconds`;
      this.signalManualTerminal(tab, "timeout");
      this.presentation.publish();
      this.logger.warn("browser.manual_turn_timed_out", {
        tabId: tab.id,
        traceId: tab.traceId,
        phase: "sent-confirmation",
      });
    }, delay);
    tab.manualDeadlineTimer.unref?.();
  }

  writeManualPrompt(prompt) {
    if (!this.context.clipboard || typeof this.context.clipboard.writeText !== "function") {
      throw new Error("Electron clipboard is unavailable");
    }
    this.context.clipboard.writeText(prompt);
  }

  beginManualTurn(traceId, helperPid, prompt, conversationKey, resumePrompt, compaction = false) {
    if (this.context.manualOperation) {
      throw new Error(`ChatGPT browser is busy with ${this.context.manualOperation}`);
    }
    if (typeof prompt !== "string" || prompt.length < 1 || prompt.length > MAX_MANUAL_PROMPT_CHARS) {
      throw new Error(`Manual prompt must contain between 1 and ${MAX_MANUAL_PROMPT_CHARS} characters`);
    }
    if (resumePrompt !== undefined
      && (typeof resumePrompt !== "string"
        || resumePrompt.length < 1
        || resumePrompt.length > MAX_MANUAL_PROMPT_CHARS)) {
      throw new Error(`Manual resume prompt must contain between 1 and ${MAX_MANUAL_PROMPT_CHARS} characters`);
    }
    if (typeof compaction !== "boolean") throw new Error("Manual compaction flag must be boolean");
    const configuredSubmitSec = this.context.submitTimeoutSec();
    const submitMs = Number.isInteger(configuredSubmitSec) && configuredSubmitSec >= 30 && configuredSubmitSec <= 600
      ? configuredSubmitSec * 1000 : 120_000;
    const manualSubmitTimeoutMs = compaction
      ? Math.max(MANUAL_COMPACTION_SUBMIT_TIMEOUT_MS, submitMs) : submitMs;
    const completion = this.completions.get(traceId);
    if (completion) {
      throw new Error(completion.helperPid === helperPid
        ? `Manual mode turn ${traceId} is already completed`
        : `Manual mode turn ${traceId} is owned by another process`);
    }
    const terminal = this.terminals.get(traceId);
    if (terminal?.helperPid === helperPid) {
      const error = new Error(terminal.status === "timeout"
        ? `Manual mode turn ${traceId} timed out before Sent confirmation`
        : `Manual mode turn ${traceId} is already ${terminal.status}`);
      error.code = terminal.status === "timeout" ? "manual_turn_timed_out" : "turn_cancelled";
      throw error;
    }
    const sameTrace = [...this.tabs.values()].find(tab => tab.traceId === traceId);
    this.lifecycle.assertLiveConversationOwner(traceId, conversationKey);
    if (sameTrace) {
      if (sameTrace.interactionMode !== "manual") {
        throw new Error(`Browser turn ${traceId} already belongs to automatic interaction`);
      }
      if (sameTrace.helperPid !== helperPid) {
        if (processRunning(sameTrace.helperPid)) {
          throw new Error(`Manual mode turn ${traceId} is owned by another process`);
        }
        this.signalManualTerminal(sameTrace, "failed");
        this.lifecycle.removeTurnTab(sameTrace, true);
        this.rememberManualTerminal(traceId, helperPid, "failed");
        const error = new Error(
          `Manual mode turn ${traceId} lost its original runtime owner and cannot be resumed; start a new Codex turn`,
        );
        error.code = "manual_turn_owner_lost";
        throw error;
      }
      if (sameTrace.manualSubmitTimeoutMs !== manualSubmitTimeoutMs) {
        throw new Error(`Manual mode turn ${traceId} was retried with a different compaction mode`);
      }
      const retryPrompt = sameTrace.manualConversationReused ? resumePrompt : prompt;
      if (typeof retryPrompt !== "string"
        || sameTrace.promptDigest !== manualPromptDigest(retryPrompt)) {
        throw new Error(`Manual mode turn ${traceId} was retried with a different prompt`);
      }
      sameTrace.helperPid = helperPid;
      this.presentation.activate(sameTrace);
      this.presentation.publish();
      return {
        tabId: sameTrace.id,
        reused: true,
        deadlineAt: sameTrace.manualDeadlineAt ? new Date(sameTrace.manualDeadlineAt).toISOString() : null,
        state: sameTrace.manualState,
      };
    }
    const retained = conversationKey
      ? [...this.tabs.values()].filter(tab => (
          tab.interactionMode === "manual"
          && tab.status === "ready"
          && tab.conversationKey === conversationKey
        ))
      : [];
    if (retained.length > 1) {
      throw new Error(`Manual ChatGPT conversation ${conversationKey} owns multiple browser tabs`);
    }
    let tab = retained[0];
    if (tab) {
      if (typeof resumePrompt !== "string" || !resumePrompt) {
        throw new Error("A retained Manual mode conversation requires an incremental resume prompt");
      }
      this.writeManualPrompt(resumePrompt);
      tab.traceId = traceId;
      tab.helperPid = helperPid;
      tab.status = "running";
      tab.loading = false;
      tab.message = "Paste the copied prompt, add any images yourself because Manual mode cannot transfer them, choose a model and effort, then press Sent";
      tab.manualState = "awaiting-user";
      tab.manualSubmitTimeoutMs = manualSubmitTimeoutMs;
      tab.manualDeadlineAt = Date.now() + manualSubmitTimeoutMs;
      tab.prompt = resumePrompt;
      tab.promptDigest = manualPromptDigest(resumePrompt);
      tab.manualConversationReused = true;
      tab.sentAt = null;
      tab.manualTerminalResolutionSuppressed = false;
    } else {
      tab = this.lifecycle.createManualTurnTab(
        traceId,
        helperPid,
        conversationKey,
        prompt,
        manualSubmitTimeoutMs,
      );
      try {
        this.writeManualPrompt(prompt);
      } catch (error) {
        this.signalManualTerminal(tab, "failed");
        this.lifecycle.removeTurnTab(tab, true);
        throw error;
      }
    }
    this.armManualTurnDeadline(tab);
    this.presentation.activate(tab);
    this.presentation.publish();
    this.presentation.writeDescriptor();
    this.logger.info("browser.manual_turn_started", {
      tabId: tab.id,
      traceId,
      reused: retained.length === 1,
    });
    return {
      tabId: tab.id,
      reused: retained.length === 1,
      deadlineAt: new Date(tab.manualDeadlineAt).toISOString(),
      state: tab.manualState,
    };
  }

  async waitManualSent(traceId, helperPid, observerTimeoutMs = 35_000) {
    const tab = [...this.tabs.values()].find(candidate => candidate.traceId === traceId);
    if (!tab) {
      const terminal = this.terminals.get(traceId);
      if (terminal?.helperPid === helperPid) return { status: terminal.status };
      throw new Error(`Manual mode turn ownership mismatch: no browser tab owns ${traceId}`);
    }
    if (tab.interactionMode !== "manual" || tab.helperPid !== helperPid) {
      throw new Error(`Manual mode turn ${traceId} ownership is invalid`);
    }
    if (["sent", "running", "completed"].includes(tab.manualState)) {
      return { status: "sent", sentAt: tab.sentAt };
    }
    if (tab.manualState !== "awaiting-user") {
      return { status: tab.manualState === "timed-out" ? "timeout" : tab.manualState };
    }
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(observerTimer);
        tab.manualWaiters.delete(finish);
        resolve(result);
      };
      const observerTimer = setTimeout(() => finish({ status: "pending" }), observerTimeoutMs);
      observerTimer.unref?.();
      tab.manualWaiters.add(finish);
    });
  }

  async waitManualTerminal(traceId, helperPid, observerTimeoutMs = 35_000) {
    const terminal = this.terminals.get(traceId);
    if (terminal?.helperPid === helperPid) return { status: terminal.status };
    const tab = [...this.tabs.values()].find(candidate => candidate.traceId === traceId);
    if (!tab || tab.interactionMode !== "manual" || tab.helperPid !== helperPid) {
      throw new Error(`Manual mode turn ownership mismatch: no browser tab owns ${traceId}`);
    }
    return await new Promise((resolve) => {
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        clearTimeout(observerTimer);
        tab.manualTerminalWaiters.delete(finish);
        resolve(result);
      };
      const observerTimer = setTimeout(() => finish({ status: "pending" }), observerTimeoutMs);
      observerTimer.unref?.();
      tab.manualTerminalWaiters.add(finish);
    });
  }

  copyManualPrompt(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.interactionMode !== "manual" || typeof tab.prompt !== "string") {
      throw new Error("Manual prompt is no longer available");
    }
    this.writeManualPrompt(tab.prompt);
    this.logger.info("browser.manual_prompt_copied", { tabId: tab.id, traceId: tab.traceId });
    return this.presentation.snapshot();
  }

  confirmManualSent(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.interactionMode !== "manual") throw new Error("Manual mode tab does not exist");
    if (tab.manualState !== "awaiting-user") {
      if (["sent", "running", "completed"].includes(tab.manualState)) return this.presentation.snapshot();
      throw new Error("Manual mode turn can no longer be marked as sent");
    }
    if (tab.manualDeadlineTimer) clearTimeout(tab.manualDeadlineTimer);
    tab.manualDeadlineTimer = null;
    tab.manualState = "sent";
    // Sent ends the human handoff deadline. Model thinking is owned by the live turn and
    // remains cancellable through its helper or tab, including before the first MCP bind.
    tab.manualDeadlineAt = null;
    tab.sentAt = new Date().toISOString();
    tab.prompt = null;
    tab.message = "Prompt sent; waiting for ChatGPT to start through the Codex harness";
    for (const resolve of tab.manualWaiters) resolve({ status: "sent", sentAt: tab.sentAt });
    tab.manualWaiters.clear();
    this.presentation.publish();
    this.logger.info("browser.manual_prompt_confirmed", { tabId: tab.id, traceId: tab.traceId });
    return this.presentation.snapshot();
  }

  markManualTurnStarted(traceId, helperPid) {
    const tab = [...this.tabs.values()].find(candidate => candidate.traceId === traceId);
    if (!tab || tab.interactionMode !== "manual" || tab.helperPid !== helperPid) {
      throw new Error(`Manual mode turn ownership mismatch: no browser tab owns ${traceId}`);
    }
    if (tab.manualState !== "sent" && tab.manualState !== "running") {
      throw new Error(`Manual mode turn ${traceId} was not confirmed as sent`);
    }
    if (tab.manualDeadlineTimer) clearTimeout(tab.manualDeadlineTimer);
    tab.manualDeadlineTimer = null;
    tab.manualDeadlineAt = null;
    tab.manualState = "running";
    tab.message = "ChatGPT is working through the Codex harness";
    tab.lastHeartbeatAt = Date.now();
    this.presentation.publish();
    return this.presentation.snapshot();
  }

  endManualTurn(traceId, helperPid, status, retain = false) {
    const completion = this.completions.get(traceId);
    if (completion?.helperPid === helperPid) return { cancelledByUser: false };
    const tab = [...this.tabs.values()].find(candidate => candidate.traceId === traceId);
    if (!tab || tab.interactionMode !== "manual" || tab.helperPid !== helperPid) {
      const terminal = this.terminals.get(traceId);
      if (terminal?.helperPid === helperPid) return { cancelledByUser: terminal.status === "cancelled" };
      throw new Error(`Manual mode turn ownership mismatch: no browser tab owns ${traceId}`);
    }
    if (tab.manualState === "completed") {
      this.rememberManualCompletion(traceId, helperPid);
      return { cancelledByUser: false };
    }
    if (tab.manualCancellation?.status === "pending") {
      const error = new Error(`Manual mode turn ${traceId} cancellation is still pending`);
      error.code = "manual_cancel_pending";
      throw error;
    }
    if (tab.manualCancellation?.status === "failed") {
      const error = new Error(`Manual mode turn ${traceId} cancellation was not acknowledged`);
      error.code = "manual_cancel_failed";
      throw error;
    }
    if (status === "completed" && tab.manualState !== "sent" && tab.manualState !== "running") {
      throw new Error(`Manual mode turn ${traceId} cannot complete before Sent confirmation`);
    }
    if (status === "completed" && retain && tab.conversationKey) {
      if (tab.manualDeadlineTimer) clearTimeout(tab.manualDeadlineTimer);
      tab.manualDeadlineTimer = null;
      tab.manualDeadlineAt = null;
      tab.prompt = null;
      tab.promptDigest = null;
      tab.manualState = "completed";
      tab.status = "ready";
      tab.message = "Task completed";
      tab.loading = false;
      tab.lastHeartbeatAt = Date.now();
      this.rememberManualCompletion(traceId, helperPid);
      this.presentation.publish();
      return { cancelledByUser: false };
    }
    const cancelledByUser = this.terminals.get(traceId)?.status === "cancelled";
    if (status === "completed") {
      if (tab.manualDeadlineTimer) clearTimeout(tab.manualDeadlineTimer);
      tab.manualDeadlineTimer = null;
      tab.manualDeadlineAt = null;
      tab.prompt = null;
      tab.promptDigest = null;
      tab.manualState = "completed";
      tab.manualTerminalResolutionSuppressed = true;
      this.rememberManualCompletion(traceId, helperPid);
    } else {
      this.signalManualTerminal(tab, status === "aborted" ? "cancelled" : status);
    }
    this.lifecycle.removeTurnTab(tab, false);
    return { cancelledByUser };
  }

  cancelManualTurn(traceId, helperPid) {
    const tab = [...this.tabs.values()].find(candidate => candidate.traceId === traceId);
    if (!tab) {
      const terminal = this.terminals.get(traceId);
      if (terminal?.helperPid === helperPid && terminal.status === "cancelled") {
        return { cancelledByUser: true, status: "cancelled" };
      }
    }
    if (!tab || tab.interactionMode !== "manual" || tab.helperPid !== helperPid) {
      throw new Error(`Manual mode turn ownership mismatch: no browser tab owns ${traceId}`);
    }
    if (tab.status === "running") return this.startManualCancellation(tab, "control");
    this.signalManualTerminal(tab, "cancelled");
    this.lifecycle.removeTurnTab(tab, true);
    return { cancelledByUser: true, status: "cancelled" };
  }

  startManualCancellation(tab, source) {
    if (tab.manualCancellation?.status === "pending") {
      return { cancelledByUser: true, status: "pending" };
    }
    if (typeof this.context.cancelTurn !== "function") {
      tab.manualCancellation = { status: "failed", source };
      tab.message = "Cancellation could not reach the launcher-owned runtime; the browser tab remains open";
      this.presentation.publish();
      const error = new Error(`Manual mode turn ${tab.traceId} has no launcher cancellation handler`);
      error.code = "manual_cancel_unavailable";
      throw error;
    }
    tab.manualCancellation = { status: "pending", source };
    const cancellation = Promise.resolve()
      .then(() => this.context.cancelTurn(tab.traceId))
      .then(() => {
        if (this.tabs.get(tab.id) !== tab) return;
        tab.manualCancellation = { status: "acknowledged", source };
        this.signalManualTerminal(tab, "cancelled");
        this.lifecycle.removeTurnTab(tab, true);
      })
      .catch((error) => {
        if (this.tabs.get(tab.id) === tab) {
          tab.manualCancellation = { status: "failed", source };
          tab.message = "Runtime cancellation was not acknowledged; the browser tab remains open";
          this.presentation.publish();
        }
        this.logger.warn("browser.manual_turn_cancel_failed", {
          tabId: tab.id,
          traceId: tab.traceId,
          errorType: error?.name || "Error",
        });
        throw error;
      });
    tab.manualCancellation.promise = cancellation;
    // The synchronous control endpoint returns a recoverable pending result. Keep the rejection
    // observed here so a failed runtime cancellation cannot become an unhandled rejection.
    cancellation.catch(() => {});
    return { cancelledByUser: true, status: "pending" };
  }

  async cancelManualTab(tab, source) {
    const result = this.startManualCancellation(tab, source);
    if (result.status !== "pending") return result;
    await tab.manualCancellation.promise;
    return { cancelledByUser: true, status: "cancelled" };
  }

}

module.exports = { BrowserManualTurns, manualPromptDigest, MANUAL_SUBMIT_TIMEOUT_MS, MANUAL_COMPACTION_SUBMIT_TIMEOUT_MS };
