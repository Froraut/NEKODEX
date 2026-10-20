/** Listener admission: draining is reversible, but committed shutdown never is. */
export class ServerAdmission {
  private state: "running" | "draining" | "shutting-down" = "running";

  get accepting(): boolean { return this.state === "running"; }
  get draining(): boolean { return !this.accepting; }

  drain(): void {
    if (this.state === "running") this.state = "draining";
  }

  resume(): boolean {
    if (this.state === "shutting-down") return false;
    this.state = "running";
    return true;
  }

  beginShutdown(): void { this.state = "shutting-down"; }
}

/** Machine-readable tunnel causes the launcher may report with a not-ready status. */
export const TUNNEL_UNAVAILABLE_REASON_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/** Why Web admission is refused; Native admission is independent of every cause here. */
export function webAdmissionFailureMessage(state: {
  draining: boolean;
  launcherDetached: boolean;
  brokerReady: boolean;
  tunnelUnavailableReason?: string | null;
}): string {
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
