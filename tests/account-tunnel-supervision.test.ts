import { expect, test } from "bun:test";
import { join } from "node:path";

// The launcher smoke drives real ownership markers and a live stand-in tunnel
// process, including the orphan left after a failed probe and an update relaunch.
test("account tunnel supervision keeps orphan proof and stops a dead launcher's tunnel", () => {
  const result = Bun.spawnSync([process.execPath,
    join(import.meta.dir, "../launcher/scripts/smoke-account-tunnel-supervision.cjs")],
  { stdout: "pipe", stderr: "pipe" });
  const output = `${result.stdout}${result.stderr}`;
  expect(output).toContain("account tunnel supervision smoke passed");
  expect(result.exitCode).toBe(0);
}, 60_000);
