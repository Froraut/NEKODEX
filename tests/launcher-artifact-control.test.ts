import { expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  cancelLauncherArtifactDownload,
  registerLauncherArtifactDownload,
  waitForLauncherArtifactDownload,
} from "../src/launcher-browser-host";

const { BrowserControlServer } = require("../launcher/electron/control-server.cjs") as {
  BrowserControlServer: new (options: unknown) => {
    start(): Promise<unknown>;
    descriptor(): { endpoint: string; token: string };
    close(): Promise<void>;
  };
};

test("launcher artifact client round-trips an owner-bound host-generated receipt", async () => {
  const coreHome = await mkdtemp(`${tmpdir()}/nekodex-artifact-control-`);
  const runtime = join(coreHome, "runtime");
  await mkdir(runtime);
  const helper = join(runtime, "browser-helper.cjs");
  await writeFile(helper, "", { mode: 0o700 });
  const surfaceId = "U".repeat(32);
  const leaseId = `artifact_${"d".repeat(32)}`;
  const traceId = "trace_client_123";
  const partialPath = join(coreHome, "artifacts", traceId, ".network-owned.partial");
  const host = {
    browserInteractionMode: () => "automatic",
    registerArtifactDownload: () => ({ leaseId }),
    waitArtifactDownload: async () => ({
      leaseId,
      traceId,
      helperPid: 991,
      surfaceId,
      assistantTurnId: "assistant-turn-1",
      filename: "result.csv",
      partialPath,
      receivedBytes: 17,
      downloadAuthority: "chatgpt.com",
    }),
    cancelArtifactDownload: () => ({ cancelled: true }),
  };
  const server = await new BrowserControlServer({
    logger: { info() {}, debug() {}, warn() {}, error() {} },
    getBrowserHost: () => host,
    getPreferences: () => ({}),
  }).start() as InstanceType<typeof BrowserControlServer>;
  const control = server.descriptor();
  const descriptorPath = join(runtime, "browser-account-default.json");
  await writeFile(descriptorPath, `${JSON.stringify({
    version: 3,
    kind: "codex-web-gpt-launcher",
    profile: "development",
    pid: process.pid,
    endpoint: "http://127.0.0.1:39001",
    control,
    helper: { executable: process.execPath, script: helper },
    partition: "persist:codex-web-gpt-dev-chatgpt",
    accountId: "default",
    idleUrl: "data:text/html;charset=utf-8,%3C!doctype%20html%3E%3Chtml%3E%3Chead%3E%3Cmeta%20charset%3D%22utf-8%22%3E%3Ctitle%3ENEKODEX%3C%2Ftitle%3E%3C%2Fhead%3E%3Cbody%3E%3C%2Fbody%3E%3C%2Fhtml%3E#codex-web-gpt-browser-host",
    surfaceId,
    surfaceTargets: { [surfaceId]: "target-1" },
    features: ["task-artifact-download-v1"],
    createdAt: new Date().toISOString(),
  }, null, 2)}\n`, { mode: 0o600 });
  try {
    expect(await registerLauncherArtifactDownload(descriptorPath, {
      traceId,
      helperPid: 991,
      surfaceId,
      assistantTurnId: "assistant-turn-1",
      expectedFilename: "result.csv",
      maxBytes: 50_000_000,
      deadlineMs: 60_000,
    })).toEqual({ leaseId });
    expect(await waitForLauncherArtifactDownload(
      descriptorPath,
      { traceId, helperPid: 991, surfaceId, leaseId },
      60_000,
    )).toMatchObject({ partialPath, receivedBytes: 17, downloadAuthority: "chatgpt.com" });
    await expect(cancelLauncherArtifactDownload(
      descriptorPath,
      { traceId, helperPid: 991, surfaceId, leaseId, reason: "test cleanup" },
    )).resolves.toBeUndefined();
  } finally {
    await server.close();
    await rm(coreHome, { recursive: true, force: true });
  }
});
