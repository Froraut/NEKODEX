export class LauncherAccountCooldownError extends Error {
  constructor(message: string) { super(message); this.name = "LauncherAccountCooldownError"; }
}
export type LauncherBrowserHostUnavailableReason = "descriptor-missing" | "process-not-running";

/** A verified launcher-absence condition that background native networking may recover from. */
export class LauncherBrowserHostUnavailableError extends Error {
  readonly code = "LauncherBrowserHostUnavailable";

  constructor(
    message: string,
    readonly reason: LauncherBrowserHostUnavailableReason,
  ) {
    super(message);
    this.name = "LauncherBrowserHostUnavailableError";
  }
}

export class LauncherBrowserTurnCancelledError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LauncherBrowserTurnCancelledError";
  }
}

export class LauncherRetainedConversationUnavailableError extends Error {
  constructor(message: string, readonly workStarted?: false) {
    super(message);
    this.name = "LauncherRetainedConversationUnavailableError";
  }
}

export class LauncherManualTurnTimedOutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LauncherManualTurnTimedOutError";
  }
}

export class LauncherManualTurnFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LauncherManualTurnFailedError";
  }
}
