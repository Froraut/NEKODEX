const { redactText } = require("./logging.cjs");

function conciseTunnelLog(value) {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const tail = value.trim().split(/\r?\n/).slice(-3).join(" | ");
  const redacted = redactText(tail);
  return redacted.length > 800 ? `…${redacted.slice(-800)}` : redacted;
}

// A successful-looking control response only permits the independent readiness probes.
function tunnelConnectCanContinue(result) {
  try {
    const value = JSON.parse(result.stdout);
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const states = [value.runtime_state, value.state, value.status].filter(state => state != null);
    if (!states.length || states.some(state => state !== states[0])) return false;
    const hasError = [value.error, value.remote_error, value.stop_error].some(error =>
      error != null && error !== false && !(typeof error === "string" && !error.trim()));
    if (hasError || value.process_running !== true) return false;
    return states[0] === "ready" ? value.healthy === true && value.ready === true
      : states[0] === "starting" && value.ready === false;
  } catch { return false; }
}

function tunnelControlDiagnostic(result) {
  const stdout = typeof result?.stdout === "string" ? result.stdout.trim() : "";
  const stderr = typeof result?.stderr === "string" ? result.stderr.trim() : "";
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout);
      const logTail = conciseTunnelLog(
        typeof parsed.launch_diagnostics?.log_tail === "string"
          ? parsed.launch_diagnostics.log_tail
          : typeof parsed.local?.log?.tail === "string"
            ? parsed.local.log.tail
            : undefined,
      );
      const error = [parsed.error, parsed.remote_error, parsed.stop_error]
        .find(value => typeof value === "string" && value.trim());
      const state = parsed.runtime_state ?? parsed.state ?? parsed.status;
      const parts = [
        ...(state !== undefined ? [`state=${String(state)}`] : []),
        ...(parsed.process_running !== undefined ? [`process_running=${String(parsed.process_running)}`] : []),
        ...(parsed.healthy !== undefined ? [`healthy=${String(parsed.healthy)}`] : []),
        ...(parsed.ready !== undefined ? [`ready=${String(parsed.ready)}`] : []),
        ...(typeof error === "string" ? [error.trim()] : []),
        ...(logTail ? [`runtime_log=${logTail}`] : []),
      ];
      if (parts.length > 0) return redactText(parts.join("; ")).slice(0, 1_200);
    } catch {
      // Fall through to bounded plain-text diagnostics.
    }
  }
  return redactText([stderr, stdout].filter(Boolean).join("\n") || result?.output || "[no tunnel diagnostic]")
    .slice(0, 1_200);
}

function tunnelCommandQuoted(value) {
  if (typeof value !== "string" || !value || /[\r\n]/.test(value)) {
    throw new Error("Tunnel MCP command values must be non-empty single-line strings");
  }
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function managedTunnelMcpCommand(invocation) {
  if (!invocation
    || typeof invocation.executable !== "string"
    || !Array.isArray(invocation.args)) {
    throw new Error("Launcher tunnel MCP command requires an explicit runtime invocation");
  }
  return [invocation.executable, ...invocation.args]
    .map(tunnelCommandQuoted)
    .join(" ");
}

function managedTunnelConnectArgs(config, invocation) {
  const tunnel = config.tunnel;
  if (!tunnel) throw new Error("launcher-owned tunnel has no runtime configuration");
  return [
    "runtimes", "connect",
    "--alias", tunnel.alias,
    "--profile", tunnel.profileName,
    "--profile-dir", tunnel.profileDir,
    "--tunnel-client-bin", tunnel.binaryPath,
    "--tunnel-id", tunnel.tunnelId,
    "--runtime-api-key", `file:${tunnel.runtimeKeyFile}`,
    "--mcp-command", managedTunnelMcpCommand(invocation),
    "--json",
  ];
}

module.exports = { conciseTunnelLog, tunnelConnectCanContinue, tunnelControlDiagnostic, managedTunnelConnectArgs };
