export interface TunnelRuntimeStatus {
  ok: boolean;
  processRunning: boolean;
  healthy: boolean;
  ready: boolean;
  state?: string;
  detail: string;
}

export function tunnelCommandOutput(result: {
  status: number;
  stdout: string;
  stderr: string;
}): string {
  const stdout = result.stdout.trim();
  const stderr = result.stderr.trim();
  return result.status === 0
    ? (stdout || stderr)
    : [stderr, stdout].filter(Boolean).join("\n");
}

export function safeTunnelDetail(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text
    .replace(/tunnel_[a-f0-9]{32}/g, "[tunnel-id]")
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[redacted-key]")
    .slice(0, 2_000);
}

function nestedRecord(value: unknown, key: string): Record<string, unknown> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const nested = (value as Record<string, unknown>)[key];
  return nested && typeof nested === "object" && !Array.isArray(nested)
    ? nested as Record<string, unknown>
    : undefined;
}

function runtimeLogTail(parsed: Record<string, unknown>): string | undefined {
  const launchTail = nestedRecord(parsed, "launch_diagnostics")?.log_tail;
  if (typeof launchTail === "string" && launchTail.trim()) return launchTail.trim();
  const statusTail = nestedRecord(nestedRecord(parsed, "local"), "log")?.tail;
  return typeof statusTail === "string" && statusTail.trim() ? statusTail.trim() : undefined;
}

export function tunnelConnectLaunchError(output: string): string | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(output) as Record<string, unknown>;
  } catch {
    return "tunnel-client returned non-JSON connect output";
  }
  const running = parsed.running === true;
  const healthy = parsed.healthy === true;
  const ready = parsed.ready === true;
  if (running && healthy) return undefined;
  const diagnostics = nestedRecord(parsed, "launch_diagnostics");
  const exitCode = typeof parsed.exit_code === "number" ? parsed.exit_code
    : typeof diagnostics?.exit_code === "number" ? diagnostics.exit_code
      : undefined;
  const remoteError = typeof parsed.remote_error === "string" && parsed.remote_error.trim()
    ? parsed.remote_error.trim()
    : undefined;
  const logTail = runtimeLogTail(parsed);
  return safeTunnelDetail([
    `running=${running}`,
    `healthy=${healthy}`,
    `ready=${ready}`,
    ...(exitCode !== undefined ? [`exit_code=${exitCode}`] : []),
    ...(remoteError ? [`remote_error=${remoteError}`] : []),
    ...(logTail ? [`runtime_log=${logTail}`] : []),
    ...(!remoteError && !logTail ? ["runtime did not complete a healthy launch"] : []),
  ].join("; "));
}

export function parseTunnelStatus(output: string, alias: string, exitStatus = 0): TunnelRuntimeStatus {
  if (exitStatus !== 0) {
    return { ok: false, processRunning: false, healthy: false, ready: false, detail: safeTunnelDetail(output) };
  }
  try {
    const parsed = JSON.parse(output) as Record<string, unknown>;
    if (!Array.isArray(parsed.entries)) throw new Error("local inventory has no entries array");
    const matches = parsed.entries.filter(entry => entry && typeof entry === "object" && entry.alias === alias);
    if (matches.length > 1) throw new Error("local inventory contains duplicate aliases");
    const state = matches.length === 0 ? "stopped" : matches[0].runtime_state;
    if (!["stopped", "starting", "healthy", "ready"].includes(state)) {
      throw new Error("local inventory has an unsupported runtime state");
    }
    // tunnel-client 0.0.12 derives inventory state from the local process and health probes.
    const processRunning = state !== "stopped";
    const healthy = state === "healthy" || state === "ready";
    const ready = state === "ready";
    const ok = processRunning && healthy && ready;
    const detail = ok
      ? "process_running=true healthy=true ready=true"
      : safeTunnelDetail([
        `process_running=${processRunning}`,
        `healthy=${healthy}`,
        `ready=${ready}`,
        `state=${state}`,
        ...(matches.length === 0 ? ["local_inventory=absent"] : []),
      ].join("; "));
    return { ok, processRunning, healthy, ready, state, detail };
  } catch (error) {
    return { ok: false, processRunning: false, healthy: false, ready: false, detail: `tunnel-client returned invalid local inventory: ${safeTunnelDetail(error instanceof Error ? error.message : String(error))}` };
  }
}
