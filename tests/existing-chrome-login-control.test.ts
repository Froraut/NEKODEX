import { test, expect } from "bun:test";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { createExistingChromeLoginControl } from "../src/existing-chrome-login-control";

test("private importer control only accepts cancellation and aborts on EOF", async () => {
  for (const inputText of ['{"version":1,"type":"existing-chrome-login-cancel"}\n', '{"version":1,"type":"passkey-login-reveal"}\n', 'not json\n', 'x'.repeat(4097)]) {
    const input = new PassThrough();
    const control = createExistingChromeLoginControl(input as unknown as NodeJS.ReadStream);
    input.write(inputText);
    expect(control.signal.aborted).toBe(true);
    control.close();
    expect(input.listenerCount("data")).toBe(0);
    expect(input.listenerCount("error")).toBe(0);
  }
  const input = new PassThrough();
  const control = createExistingChromeLoginControl(input as unknown as NodeJS.ReadStream);
  input.emit("end");
  expect(control.signal.aborted).toBe(true);
  control.close();
});

test("closing a completed importer removes listeners without aborting successful capture", () => {
  const input = new PassThrough();
  const control = createExistingChromeLoginControl(input as unknown as NodeJS.ReadStream);
  control.close();
  input.emit("end");
  expect(control.signal.aborted).toBe(false);
  expect(input.listenerCount("data")).toBe(0);
});

test("CLI cannot opt into ordinary Chrome access without the owned launcher consent route", async () => {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  for (const [args, expected] of [
    [["login", "--existing-chrome"], "Existing Chrome import requires explicit consent in the launcher"],
    [["login", "--consent-user-profile"], "Existing Chrome import requires explicit consent in the launcher"],
    [["login", "--selected-chrome-profile-claim"], "Selected Chrome profile claim requires the owned launcher consent route"],
  ] as const) {
    const child = Bun.spawn([process.execPath, cli, ...args], { stdout: "pipe", stderr: "pipe" });
    const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect(code).not.toBe(0);
    expect(stdout).not.toContain("@codex-chrome-import:");
    expect(stderr).toContain(expected);
  }
});

test("invalid launcher authorization emits only a fixed diagnostic envelope before any Chrome progress", async () => {
  const cli = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
  const child = Bun.spawn([process.execPath, cli, "login", "--existing-chrome", "--launcher-control", "--consent-user-profile"], {
    stdout: "pipe", stderr: "pipe",
    env: { ...process.env, CODEX_CHATGPT_WEB_BROWSER_HOST_DESCRIPTOR: "SECRET-missing-descriptor", CODEX_WEB_GPT_LAUNCHER_CONTROL_TOKEN: "SECRET-token" },
  });
  const [code, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect(code).not.toBe(0);
  expect(stdout.trim()).toBe('@codex-chrome-import-error:{"version":1,"code":"launcher-authorization-failed"}');
  expect(stdout + stderr).not.toContain("SECRET");
  expect(stdout).not.toContain('@codex-chrome-import:');
});

test("selected discovery accepts exactly one bounded private frame and keeps cancellation active", async () => {
  const input = new PassThrough();
  const control = createExistingChromeLoginControl(input as unknown as NodeJS.ReadStream, { selectedDiscovery: true });
  const contents = "9222\n/devtools/browser/11111111-2222-3333-4444-555555555555\n";
  const message = JSON.stringify({ version: 1, type: "existing-chrome-discovery", contents }) + "\n";
  input.write(message);
  expect(await control.discoveryData).toBe(contents);
  expect(control.signal.aborted).toBe(false);
  input.write(message);
  expect(control.signal.aborted).toBe(true);
  control.close();
});

test("discovery frames are unavailable without selected mode and cannot carry extra fields or oversized data", async () => {
  for (const [selectedDiscovery, message] of [
    [false, { version: 1, type: "existing-chrome-discovery", contents: "test" }],
    [true, { version: 1, type: "existing-chrome-discovery", contents: "x".repeat(2049) }],
    [true, { version: 1, type: "existing-chrome-discovery", contents: "test", endpoint: "https://untrusted.test" }],
  ] as const) {
    const input = new PassThrough();
    const control = createExistingChromeLoginControl(input as unknown as NodeJS.ReadStream, { selectedDiscovery });
    input.write(JSON.stringify(message) + "\n");
    expect(control.signal.aborted).toBe(true);
    if (control.discoveryData) await expect(control.discoveryData).rejects.toThrow();
    control.close();
  }
  const input = new PassThrough();
  const control = createExistingChromeLoginControl(input as unknown as NodeJS.ReadStream, { selectedDiscovery: true });
  input.emit("end");
  await expect(control.discoveryData!).rejects.toThrow();
  control.close();
});

test("selected profile claim is a separate bounded one-use control value", async () => {
  const input = new PassThrough();
  const control = createExistingChromeLoginControl(input as unknown as NodeJS.ReadStream, { selectedProfileClaim: true });
  const nonce = "C".repeat(32);
  const claim = { version: 1 as const, nonce, url: `http://127.0.0.1:43210/nekodex-profile-claim-v1/${nonce}`,
    openedAt: new Date().toISOString() };
  input.write(JSON.stringify({ version: 1, type: "existing-chrome-profile-claim", claim }) + "\n");
  expect(await control.profileClaim).toEqual(claim);
  expect(control.signal.aborted).toBe(false);
  input.write(JSON.stringify({ version: 1, type: "existing-chrome-profile-claim", claim }) + "\n");
  expect(control.signal.aborted).toBe(true);
  control.close();
});

test("profile claims are rejected unless the launcher selected that private control mode", async () => {
  const input = new PassThrough();
  const control = createExistingChromeLoginControl(input as unknown as NodeJS.ReadStream);
  input.write(JSON.stringify({ version: 1, type: "existing-chrome-profile-claim", claim: {} }) + "\n");
  expect(control.signal.aborted).toBe(true);
  control.close();
});
