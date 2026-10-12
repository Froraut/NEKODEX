// tunnel-client keeps /readyz green while its control-plane poller cannot reach
// OpenAI (DNS, TLS timeouts, connection resets, region 403). Its Prometheus
// /metrics endpoint is the only local evidence of that loss. This leaf module
// parses the poller series and turns them into a degraded-without-restart signal.

const TUNNEL_POLL_STALE_MS = 75_000;
const OPENAI_UNREACHABLE_REASON = "openai_unreachable";
const OPENAI_UNREACHABLE_MESSAGE = "OpenAI unreachable — check VPN or network connection";

const SAMPLE = /^([a-zA-Z_:][a-zA-Z0-9_:]*)(\{[^}]*\})?\s+(\S+)/;

function labelValue(labels, name) {
  const match = new RegExp(`(?:^|[{,])${name}="((?:[^"\\\\]|\\\\.)*)"`).exec(labels || "");
  return match ? match[1] : null;
}

/**
 * Reads only the poller series of tunnel-client's Prometheus text output:
 * commands_poll_last_successful_timestamp_seconds (gauge, absent before the first
 * success), commands_poll_errors_total{error_kind} and commands_poll_cycles_total.
 * Returns null when the output has none of them (an older client or another server).
 */
function parseTunnelPollMetrics(text) {
  if (typeof text !== "string") return null;
  let lastSuccessSeconds = null;
  let errorsTotal = null;
  let cyclesTotal = null;
  const errorKinds = {};
  for (const line of text.split("\n")) {
    if (!line.startsWith("commands_poll_")) continue;
    const match = SAMPLE.exec(line.trim());
    if (!match) continue;
    const value = Number(match[3]);
    if (!Number.isFinite(value)) continue;
    if (match[1] === "commands_poll_last_successful_timestamp_seconds") {
      lastSuccessSeconds = Math.max(lastSuccessSeconds ?? 0, value);
    } else if (match[1] === "commands_poll_errors_total") {
      errorsTotal = (errorsTotal ?? 0) + value;
      const kind = labelValue(match[2], "error_kind") || "unknown";
      errorKinds[kind] = (errorKinds[kind] ?? 0) + value;
    } else if (match[1] === "commands_poll_cycles_total") {
      cyclesTotal = (cyclesTotal ?? 0) + value;
    }
  }
  if (lastSuccessSeconds === null && errorsTotal === null && cyclesTotal === null) return null;
  return {
    lastSuccessAtMs: lastSuccessSeconds !== null && lastSuccessSeconds > 0 ? lastSuccessSeconds * 1_000 : null,
    errorsTotal,
    cyclesTotal,
    errorKinds,
  };
}

/**
 * Tracks one tunnel process. The baseline is the first observation of that PID,
 * so an adopted tunnel with an old failure history still gets the full window.
 */
class TunnelPollHealth {
  constructor({ staleMs = TUNNEL_POLL_STALE_MS } = {}) {
    this.staleMs = staleMs;
    this.pid = null;
    this.baselineAt = 0;
    this.degraded = false;
    this.reason = null;
    this.detail = null;
  }

  reset() {
    this.pid = null;
    this.baselineAt = 0;
    this.degraded = false;
    this.reason = null;
    this.detail = null;
  }

  /** Unobserved metrics keep the previous verdict; they never prove loss or recovery. */
  observe(pid, metrics, now = Date.now()) {
    const before = this.degraded;
    if (pid !== this.pid) {
      this.reset();
      this.pid = pid;
      this.baselineAt = now;
    }
    if (!metrics) return this.verdict(before);
    const reference = Math.max(metrics.lastSuccessAtMs ?? 0, this.baselineAt);
    const silentMs = Math.max(0, now - reference);
    this.degraded = silentMs > this.staleMs;
    if (this.degraded) {
      const kinds = Object.entries(metrics.errorKinds || {})
        .filter(([, count]) => count > 0).map(([kind, count]) => `${kind}=${count}`).join(", ");
      this.reason = OPENAI_UNREACHABLE_REASON;
      // The verdict uses this process's window; the message reports the real age when known.
      const ageMs = metrics.lastSuccessAtMs ? Math.max(silentMs, now - metrics.lastSuccessAtMs) : null;
      this.detail = `${OPENAI_UNREACHABLE_MESSAGE}: the tool tunnel has had no successful OpenAI poll `
        + (ageMs !== null ? `for ${Math.round(ageMs / 1_000)}s` : `since it started (${Math.round(silentMs / 1_000)}s)`)
        + (metrics.errorsTotal !== null ? `; ${metrics.errorsTotal} poll errors${kinds ? ` (${kinds})` : ""}` : "");
    } else {
      this.reason = null;
      this.detail = null;
    }
    return { ...this.verdict(before), silentMs, errorsTotal: metrics.errorsTotal };
  }

  verdict(before) {
    return { degraded: this.degraded, reason: this.reason, detail: this.detail, changed: before !== this.degraded };
  }
}

module.exports = {
  OPENAI_UNREACHABLE_MESSAGE,
  OPENAI_UNREACHABLE_REASON,
  TUNNEL_POLL_STALE_MS,
  TunnelPollHealth,
  parseTunnelPollMetrics,
};
