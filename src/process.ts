import { spawnSync, type SpawnSyncOptions } from "node:child_process";

export interface CommandResult {
  status: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_LAUNCHCTL_MUTATION_TIMEOUT_MS = 20_000;

export function isMissingLaunchdService(result: CommandResult): boolean {
  if (result.status !== 113) return false;
  const detail = `${result.stderr}\n${result.stdout}`.trim();
  // launchctl print on macOS returns status 113 with this complete diagnostic.
  // The literal prefix and gui UID are part of its normal absent-service output.
  return /^(?:Bad request\.\r?\n)?Could not find service "[^"\r\n]+" in domain for (?:system|user(?: gui:[ \t]*\d+)?)$/.test(detail);
}

export function processRunning(pid: unknown): boolean {
  const probe = process.kill;
  if (!Number.isInteger(pid) || (pid as number) < 1) return false;
  try {
    probe(pid as number, 0);
    return true;
  } catch (error) {
    // Windows and hardened Unix environments can deny signalling an existing process. EPERM is
    // existence evidence, not proof that the launcher/browser/tunnel owner disappeared.
    return (error as NodeJS.ErrnoException)?.code === "EPERM";
  }
}

export function runCommand(command: string, args: string[], options: SpawnSyncOptions = {}): CommandResult {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "pipe",
    ...options,
  });
  if (result.error) throw result.error;
  return {
    status: result.status ?? 1,
    stdout: typeof result.stdout === "string" ? result.stdout : result.stdout?.toString("utf8") ?? "",
    stderr: typeof result.stderr === "string" ? result.stderr : result.stderr?.toString("utf8") ?? "",
  };
}

export function runChecked(command: string, args: string[], options: SpawnSyncOptions = {}): CommandResult {
  const boundedOptions = command === "launchctl"
    && (args[0] === "bootstrap" || args[0] === "bootout")
    && options.timeout === undefined
    ? { ...options, timeout: DEFAULT_LAUNCHCTL_MUTATION_TIMEOUT_MS }
    : options;
  const result = runCommand(command, args, boundedOptions);
  if (result.status !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit ${result.status}`;
    throw new Error(`${command} ${args.join(" ")} failed: ${detail}`);
  }
  return result;
}
