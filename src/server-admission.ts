/** A drain nobody renews (its owner crashed or was killed) ends on its own after this long. */
export const DEFAULT_DRAIN_LEASE_MS = 5 * 60_000;
export const MIN_DRAIN_LEASE_MS = 1_000;
export const MAX_DRAIN_LEASE_MS = 15 * 60_000;
/** The only drain reason whose new requests wait briefly instead of failing at once. */
export const RUNTIME_SWITCH_DRAIN_REASON = "runtime-switch";
export const DRAIN_REASON_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export interface DrainOptions { leaseMs?: number; reason?: string }

export interface AdmissionTimers {
  now: () => number;
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
}

const systemTimers: AdmissionTimers = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => {
    const handle = setTimeout(callback, ms);
    (handle as { unref?: () => void }).unref?.();
    return handle;
  },
  clearTimeout: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

/**
 * Listener admission: draining is reversible, but committed shutdown never is.
 * Every drain is a lease. Its owner renews it by draining again; a drain whose owner disappeared
 * (a killed launcher, an aborted runtime switch, a manual request) resumes admission when the
 * lease expires instead of refusing every request until someone notices.
 */
export class ServerAdmission {
  private state: "running" | "draining" | "shutting-down" = "running";
  private leaseHandle: unknown = null;
  private lease: { expiresAt: number; reason: string | null } | null = null;

  constructor(
    private readonly onLeaseExpired: (reason: string | null) => void = () => {},
    private readonly timers: AdmissionTimers = systemTimers,
  ) {}

  get accepting(): boolean { return this.state === "running"; }
  get draining(): boolean { return !this.accepting; }
  /** The current drain lease, for health and diagnostics. */
  get drainLease(): { expiresAt: number; reason: string | null } | null {
    return this.state === "draining" && this.lease ? { ...this.lease } : null;
  }
  /** A runtime switch is in progress: new requests may wait for it instead of failing at once. */
  get switching(): boolean {
    return this.state === "draining" && this.lease?.reason === RUNTIME_SWITCH_DRAIN_REASON;
  }

  drain(options: DrainOptions = {}): void {
    if (this.state === "shutting-down") return;
    this.state = "draining";
    const requested = Number.isFinite(options.leaseMs) ? Math.trunc(options.leaseMs!) : DEFAULT_DRAIN_LEASE_MS;
    const leaseMs = Math.min(MAX_DRAIN_LEASE_MS, Math.max(MIN_DRAIN_LEASE_MS, requested));
    const reason = typeof options.reason === "string" && DRAIN_REASON_PATTERN.test(options.reason) ? options.reason : null;
    this.clearLease();
    this.lease = { expiresAt: this.timers.now() + leaseMs, reason };
    this.leaseHandle = this.timers.setTimeout(() => {
      this.leaseHandle = null;
      if (this.state !== "draining") return;
      const expired = this.lease?.reason ?? null;
      this.lease = null;
      this.state = "running";
      this.onLeaseExpired(expired);
    }, leaseMs);
  }

  resume(): boolean {
    if (this.state === "shutting-down") return false;
    this.clearLease();
    this.state = "running";
    return true;
  }

  beginShutdown(): void {
    this.clearLease();
    this.state = "shutting-down";
  }

  private clearLease(): void {
    if (this.leaseHandle !== null) this.timers.clearTimeout(this.leaseHandle);
    this.leaseHandle = null;
    this.lease = null;
  }
}

/** Seconds a client should wait before retrying a request refused while NEKODEX restarts. */
export const RESTART_RETRY_AFTER_SECONDS = 3;

/** Machine-readable tunnel causes the launcher may report with a not-ready status. */
export const TUNNEL_UNAVAILABLE_REASON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Why Web admission is refused; Native admission is independent of every cause here. */
export function webAdmissionFailureMessage(state: {
  draining: boolean;
  /** The drain belongs to a runtime switch, which ends in seconds. */
  switching?: boolean;
  launcherDetached: boolean;
  brokerReady: boolean;
  tunnelUnavailableReason?: string | null;
}): string {
  if (state.draining && state.switching) {
    return "NEKODEX is switching to its updated local runtime; retry in a few seconds.";
  }
  if (state.draining) return "NEKODEX is restarting; retry after it is ready.";
  if (state.launcherDetached) {
    return "Open NEKODEX to use ChatGPT Web. Native Codex models remain available in the background.";
  }
  if (!state.brokerReady) {
    return "NEKODEX local-tool broker is not ready; native models remain available. Repair the tool connection before retrying this Web request.";
  }
  if (state.tunnelUnavailableReason === "openai_unreachable") {
    return "NEKODEX tool tunnel is running but cannot reach OpenAI; check your VPN or network connection. Native models remain available, and the tunnel reconnects automatically.";
  }
  return "NEKODEX tool tunnel is not ready; native models remain available. Reconnect the tunnel before retrying this Web request.";
}

/**
 * Waits while Web admission is closed for a recoverable reason (only the tool tunnel is missing).
 * Resolves true once admission opens, false at the deadline, on a non-recoverable state or when
 * the client goes away, so the caller can answer with the real reason.
 */
export async function waitForWebAdmission(options: {
  accepting: () => boolean;
  recoverable: () => boolean;
  holdMs: number;
  pollMs: number;
  signal?: AbortSignal;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<boolean> {
  const now = options.now ?? Date.now;
  const sleep = options.sleep ?? (ms => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const deadline = now() + options.holdMs;
  while (!options.accepting()) {
    if (!options.recoverable() || now() >= deadline || options.signal?.aborted) return false;
    await sleep(options.pollMs);
  }
  return true;
}
