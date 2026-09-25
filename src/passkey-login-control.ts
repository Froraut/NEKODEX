import { execFile } from "node:child_process";
import type { ChildProcess } from "node:child_process";

/** Native activation is restricted to the exact live browser child created for this attempt. */
export async function revealOwnedLoginBrowser(
  child: ChildProcess,
  executable: string,
  profileDir: string,
): Promise<void> {
  if (process.platform !== "darwin"
    || !Number.isSafeInteger(child.pid) || child.pid! < 1
    || child.exitCode !== null || child.signalCode !== null
    || child.spawnfile !== executable
    || !((child.spawnargs.includes(`--user-data-dir=${profileDir}`) && child.spawnargs.includes("--new-window"))
      || (child.spawnargs.includes("-no-remote") && child.spawnargs.includes("-new-window")
        && child.spawnargs[child.spawnargs.indexOf("-profile") + 1] === profileDir))) {
    throw new Error("The dedicated browser login window is no longer owned by this attempt");
  }
  // AppKit targets a PID without asking System Events for access to other applications.
  // Both PID and executable are checked; no app name, browser profile or arbitrary PID is accepted.
  const script = `ObjC.import('AppKit');
const app = $.NSRunningApplication.runningApplicationWithProcessIdentifier(${child.pid});
if (!app || app.isTerminated || ObjC.unwrap(app.executableURL.path) !== ${JSON.stringify(executable)}) throw Error('Dedicated browser ownership changed');
if (!app.activateWithOptions(3)) throw Error('Could not reveal the dedicated browser login window');`;
  await new Promise<void>((resolve, reject) => {
    execFile("/usr/bin/osascript", ["-l", "JavaScript", "-e", script], { timeout: 5_000 }, error => {
      if (error) reject(new Error("Could not reveal the dedicated browser login window. Use Mission Control or retry sign-in."));
      else resolve();
    });
  });
}

export function createPasskeyLoginControl(input: NodeJS.ReadStream = process.stdin) {
  const controller = new AbortController();
  let resolveContinue!: () => void;
  let continued = false;
  let reveal: (() => Promise<void>) | undefined;
  let pending = "";
  let closed = false;
  const continuation = new Promise<void>(resolve => { resolveContinue = resolve; });
  const status = (value: Record<string, unknown>) => process.stdout.write(
    `@codex-passkey:${JSON.stringify({ version: 1, ...value })}\n`,
  );
  const fail = (message: string) => controller.abort(new Error(message));
  const onData = (chunk: Buffer | string) => {
    pending += chunk.toString();
    if (Buffer.byteLength(pending) > 4096) return fail("Launcher passkey control message is too large");
    while (pending.includes("\n")) {
      const end = pending.indexOf("\n");
      const line = pending.slice(0, end);
      pending = pending.slice(end + 1);
      let message;
      try { message = JSON.parse(line); } catch { return fail("Launcher passkey control sent invalid JSON"); }
      if (message?.version !== 1) return fail("Launcher passkey control sent an invalid message");
      if (message.type === "passkey-login-continue" && !continued) {
        continued = true;
        reveal = undefined;
        resolveContinue();
      } else if (message.type === "passkey-login-cancel") {
        fail("Passkey sign-in cancelled");
      } else if (message.type === "passkey-login-reveal" && !continued && reveal) {
        void reveal().then(() => status({ event: "revealed" }), error => status({
          event: "reveal-failed", message: error instanceof Error ? error.message : String(error),
        }));
      } else {
        fail("Launcher passkey control command is unavailable in this phase");
      }
    }
  };
  const onEnd = () => { if (!closed) fail("Launcher closed the passkey control channel"); };
  const onError = () => fail("Launcher passkey control channel failed");
  input.on("data", onData);
  input.once("end", onEnd);
  input.once("error", onError);
  input.resume();
  return {
    continuation,
    signal: controller.signal,
    onBrowserReady(action: () => Promise<void>, deadlineAt: string) {
      reveal = action;
      status({ phase: "waiting", deadlineAt });
    },
    close() {
      closed = true;
      reveal = undefined;
      input.off("data", onData);
      input.off("end", onEnd);
      input.off("error", onError);
      input.pause();
    },
  };
}
