import { homedir, userInfo } from "node:os";
import { join } from "node:path";
import { isMissingLaunchdService, type CommandResult } from "./process";

/** Escape a value for a LaunchAgent property list string element. */
export function xmlEscape(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function launchAgentPlistPath(label: string): string {
  return join(homedir(), "Library", "LaunchAgents", `${label}.plist`);
}

export function launchDomain(): string {
  return `gui/${userInfo().uid}`;
}

export function launchServiceTarget(label: string): string {
  return `${launchDomain()}/${label}`;
}

/** A `launchctl print` failure other than an absent service leaves the status unknown. */
export function assertLaunchdPrintResult(label: string, result: CommandResult): void {
  if (result.status !== 0 && !isMissingLaunchdService(result)) {
    const detail = result.stderr.trim() || result.stdout.trim() || `exit status ${result.status}`;
    throw new Error(`Unable to determine launchd service status for ${label}: ${detail}`);
  }
}
