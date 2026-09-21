import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CompactionCheckpointStore } from "../src/adapters/chatgpt-web/compaction-checkpoint-store";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
async function command(args: string[], existingHome?: string) {
  const home = existingHome ?? mkdtempSync(join(tmpdir(), "checkpoint-cli-"));
  if (!existingHome) roots.push(home);
  const child = Bun.spawn([process.execPath, new URL("../src/cli.ts", import.meta.url).pathname,
    "--home", home, "compaction-checkpoints", ...args], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited,
  ]);
  return { stdout, stderr, exitCode, files: readdirSync(home) };
}

test("checkpoint list is read-only and needs no configured service or browser", async () => {
  const result = await command(["list"]);
  expect(result.exitCode).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({ checkpoints: [], automaticResume: false });
  expect(result.files).toEqual([]);
});

test("checkpoint show validates exact identifiers before touching storage", async () => {
  const result = await command(["show", "../../secret", "--binding", "a".repeat(64)]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("checkpoint id");
  expect(result.files).toEqual([]);
});

test("checkpoint commands never expose a resume or replay operation", async () => {
  const result = await command(["resume"]);
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr).toContain("list or show");
  expect(result.files).toEqual([]);
});

test("CLI lists metadata only and shows an accepted summary solely with the exact binding", async () => {
  const home = mkdtempSync(join(tmpdir(), "checkpoint-cli-")); roots.push(home);
  const store = new CompactionCheckpointStore(join(home, "compaction-checkpoints"));
  const record = store.begin({ owner: "fixture", revision: "one" });
  const summary = "private checkpoint\u001b[31m";
  store.finish(record, "accepted", summary);
  const listed = await command(["list"], home);
  expect(listed.exitCode).toBe(0);
  expect(listed.stdout).not.toContain("private checkpoint");
  expect(JSON.parse(listed.stdout).checkpoints).toEqual([{ ...record, outcome: "accepted" }]);
  const wrong = await command(["show", record.id, "--binding", "0".repeat(64)], home);
  expect(wrong.exitCode).not.toBe(0);
  expect(wrong.stdout).toBe("");
  const shown = await command(["show", record.id, "--binding", record.binding], home);
  expect(shown.exitCode).toBe(0);
  expect(JSON.parse(shown.stdout)).toMatchObject({ summary, automaticResume: false });
  expect(shown.stdout).not.toContain("\u001b");
});
