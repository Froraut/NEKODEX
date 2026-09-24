class WorkspaceSessionMutationError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "WorkspaceSessionMutationError";
    this.code = code;
  }
}

// One coordinator belongs to one persistent account partition. It never cancels work.
// The account pool uses snapshot().admissionBlocked to keep a task from being assigned
// while an interactive identity change is being settled and verified.
class AccountSessionMutationCoordinator {
  constructor({ accountId, canMutateAccountSession, canBegin, verify, applyVerification, onStateChange } = {}) {
    this.accountId = accountId;
    // canMutateAccountSession is a synchronous ownership snapshot. It must include active
    // and acquiring turn tabs, queue reservations/pending affinity, login/import and read
    // operations for this account. A denial is informational; the coordinator cancels none.
    this.canMutateAccountSession = canMutateAccountSession ?? canBegin;
    this.verify = verify;
    this.applyVerification = applyVerification;
    this.onStateChange = onStateChange;
    this.generation = 0;
    this.current = null;
  }

  snapshot() {
    return {
      accountId: this.accountId,
      generation: this.generation,
      admissionBlocked: this.current !== null,
      mutation: this.current ? {
        generation: this.current.generation,
        sourceId: this.current.sourceId,
        reason: this.current.reason,
        startedAt: this.current.startedAt,
      } : null,
    };
  }

  publish() {
    this.onStateChange?.(this.snapshot());
  }

  begin({ sourceId, reason, url }) {
    if (this.current) {
      throw new WorkspaceSessionMutationError(
        "Finish the account sign-in or sign-out already in progress before changing it again",
        "workspace-session-mutation-busy",
      );
    }
    const availability = this.canMutateAccountSession?.({
      accountId: this.accountId,
      sourceId,
      reason,
      url,
    }) ?? { allowed: true };
    if (availability !== true && availability?.allowed !== true) {
      throw new WorkspaceSessionMutationError(
        availability?.reason || "Finish this account's active task before signing in or out",
        "workspace-session-in-use",
      );
    }
    const generation = ++this.generation;
    const controller = new AbortController();
    const state = {
      generation,
      sourceId,
      reason,
      url,
      startedAt: Date.now(),
      controller,
      finishing: null,
    };
    this.current = state;
    this.publish();
    return Object.freeze({
      accountId: this.accountId,
      generation,
      signal: controller.signal,
      finish: context => this.finish(state, context),
      fail: error => this.fail(state, error),
    });
  }

  async finish(state, context) {
    if (state.finishing) return state.finishing;
    state.finishing = (async () => {
      try {
        const evidence = await this.verify?.({
          accountId: this.accountId,
          generation: state.generation,
          signal: state.controller.signal,
          context,
        });
        if (this.current !== state || this.generation !== state.generation || state.controller.signal.aborted) {
          return { status: "stale", generation: state.generation };
        }
        await this.applyVerification?.(evidence, {
          accountId: this.accountId,
          generation: state.generation,
          context,
        });
        return { status: "applied", generation: state.generation, evidence };
      } finally {
        if (this.current === state) {
          this.current = null;
          this.publish();
        }
      }
    })();
    return state.finishing;
  }

  fail(state, error) {
    if (this.current === state) {
      state.controller.abort(error instanceof Error ? error : new Error("Browser workspace session mutation failed"));
      this.current = null;
      this.publish();
    }
    return { status: "failed", generation: state.generation, error };
  }

  invalidate(reason = "superseded") {
    const state = this.current;
    this.generation += 1;
    if (state) {
      state.controller.abort(new WorkspaceSessionMutationError(reason, "workspace-session-mutation-superseded"));
      this.current = null;
    }
    this.publish();
  }

  owns({ sourceId, generation } = {}) {
    return this.current !== null
      && (sourceId === undefined || this.current.sourceId === sourceId)
      && (generation === undefined || this.current.generation === generation);
  }
}

module.exports = { AccountSessionMutationCoordinator, WorkspaceSessionMutationError };
