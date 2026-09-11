import { expect, test } from "bun:test";
import { PassThrough } from "node:stream";
import type { ChildProcess, execFile } from "node:child_process";
import { createPasskeyLoginControl, revealOwnedLoginBrowser } from "../src/passkey-login-control";

test("passkey control permits reveal before Import and cancellation after Import", async () => {
  const input = new PassThrough();
  const control = createPasskeyLoginControl(input as unknown as NodeJS.ReadStream);
  let reveals = 0;
  control.onBrowserReady(async () => { reveals += 1; }, new Date().toISOString());
  input.write('{"version":1,"type":"passkey-login-reveal"}\n');
  await Promise.resolve();
  expect(reveals).toBe(1);
  input.write('{"version":1,"type":"passkey-login-continue"}\n');
  await control.continuation;
  expect(control.signal.aborted).toBe(false);
  input.write('{"version":1,"type":"passkey-login-cancel"}\n');
  expect(control.signal.aborted).toBe(true);
  control.close();
  expect(input.listenerCount("data")).toBe(0);
});

test("unexpected control, duplicate Import and lost parent channel abort the dedicated attempt", async () => {
  for (const scenario of ["duplicate", "invalid", "closed"]) {
    const input = new PassThrough();
    const control = createPasskeyLoginControl(input as unknown as NodeJS.ReadStream);
    if (scenario === "duplicate") input.write('{"version":1,"type":"passkey-login-continue"}\n{"version":1,"type":"passkey-login-continue"}\n');
    if (scenario === "invalid") input.write('{"version":1,"type":"arbitrary-command","pid":1}\n');
    if (scenario === "closed") input.emit("end");
    expect(control.signal.aborted).toBe(true);
    control.close();
  }
});

test("native reveal uses only the exact live child and its dedicated profile", async () => {
  if (process.platform !== "darwin") return;
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const profile = "/tmp/owned/login-profile-test";
  const owned = { pid: 12345, exitCode: null, signalCode: null, spawnfile: chrome,
    spawnargs: [chrome, `--user-data-dir=${profile}`, "--new-window"] } as ChildProcess;
  let called = false;
  const run = ((file: string, args: string[], _options: unknown, callback: (error: Error | null) => void) => {
    called = true;
    expect(file).toBe("/usr/bin/osascript");
    expect(args.join(" ")).toContain("runningApplicationWithProcessIdentifier(12345)");
    expect(args.join(" ")).toContain("executableURL.path");
    expect(args.join(" ")).not.toContain("System Events");
    callback(null);
  }) as unknown as typeof execFile;
  await revealOwnedLoginBrowser(owned, chrome, profile, run);
  expect(called).toBe(true);
  for (const patch of [{ exitCode: 0 }, { signalCode: "SIGTERM" }, { pid: 0 }, { spawnfile: "/bin/sh" }, { spawnargs: [chrome] }]) {
    called = false;
    await expect(revealOwnedLoginBrowser({ ...owned, ...patch } as ChildProcess, chrome, profile, run)).rejects.toThrow("no longer owned");
    expect(called).toBe(false);
  }
});
