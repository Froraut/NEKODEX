import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtempSync, realpathSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, watch } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { SkillPdfExtractor, buildSkillPdfSandbox } from "../src/agent-tools/skill-pdf-extractor";
import { resolveDevelopmentSkillPdfHelper, resolveSkillPdfHelper, assertPinnedSkillPdfHelper, SKILL_PDF_HELPER_SOURCE_SHA256 } from "../src/agent-tools/skill-pdf-helper-path";
import { createTextPdf } from "./fixtures/skill-pdf-fixture";
const sha = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
const selectedHelper = () => { const helper = resolveDevelopmentSkillPdfHelper(new URL("../src/cli.ts", import.meta.url).href); if (!helper) throw new Error("Build the fixed PDF helper development target before this focused check"); return helper; };
function fixture(helper = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "neko-pdf-parser-"))), home = join(root, "owner"); mkdirSync(home, { mode: 0o700 });
  const bunPath = realpathSync(process.execPath), options = { home, bunPath, bunSha256: sha(readFileSync(bunPath)), ...(helper ? { helper: selectedHelper() } : {}) };
  const extractor = new SkillPdfExtractor(options);
  return { root, home, options, extractor, async close() { await extractor.close(); rmSync(root, { recursive: true, force: true }); } };
}
function processIdentity(pid: number) {
  const { dlopen, ptr } = require("bun:ffi") as typeof import("bun:ffi");
  const lib = dlopen("/usr/lib/libproc.dylib", { proc_pidinfo: { args: ["i32", "i32", "u64", "ptr", "i32"], returns: "i32" } });
  try { const bytes = Buffer.alloc(136); if (lib.symbols.proc_pidinfo(pid, 3, 0, ptr(bytes), bytes.length) !== bytes.length) throw new Error("Exact fixture process identity unavailable"); return { pid, start: `${bytes.readBigUInt64LE(120)}:${bytes.readBigUInt64LE(128)}` }; } finally { lib.close(); }
}
function encryptedFixture(): Buffer {
  // One tiny deterministic R2/40-bit encrypted PDF, only to prove rejection.
  const padding = Buffer.from("28bf4e5e4e758a4164004e56fffa01082e2e00b6d0683e802f0ca9fe6453697a", "hex");
  const md5 = (bytes: Uint8Array) => createHash("md5").update(bytes).digest();
  const pad = (text: string) => Buffer.concat([Buffer.from(text), padding]).subarray(0, 32);
  const rc4 = (key: Buffer, bytes: Buffer) => { const s = Array.from({ length: 256 }, (_, i) => i); let j = 0; for (let i = 0; i < 256; i++) { j = (j + s[i] + key[i % key.length]) & 255; [s[i], s[j]] = [s[j], s[i]]; } let i = 0; j = 0; return Buffer.from(bytes.map(byte => { i = (i + 1) & 255; j = (j + s[i]) & 255; [s[i], s[j]] = [s[j], s[i]]; return byte ^ s[(s[i] + s[j]) & 255]; })); };
  const id = Buffer.from("0123456789abcdef"), permissions = Buffer.alloc(4); permissions.writeInt32LE(-4);
  const owner = rc4(md5(pad("owner-fixture")).subarray(0, 5), pad("password-fixture"));
  const key = md5(Buffer.concat([pad("password-fixture"), owner, permissions, id])).subarray(0, 5), user = rc4(key, padding);
  const original = createTextPdf([["Encrypted fixture"]]).toString("latin1"), objects = [...original.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj\n/g)].map(match => ({ n: Number(match[1]), value: match[2] }));
  for (const object of objects) object.value = object.value.replace(/stream\n([\s\S]*?)endstream/, (_all, stream: string) => {
    const suffix = Buffer.from([object.n & 255, (object.n >> 8) & 255, (object.n >> 16) & 255, 0, 0]);
    return "stream\n" + rc4(md5(Buffer.concat([key, suffix])).subarray(0, 10), Buffer.from(stream, "latin1")).toString("latin1") + "endstream";
  });
  const encryptionId = objects.length + 1; objects.push({ n: encryptionId, value: `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${owner.toString("hex")}> /U <${user.toString("hex")}> /P -4 >>` });
  const chunks = [Buffer.from("%PDF-1.7\n")], offsets = [0]; let length = chunks[0].length;
  for (const object of objects) { offsets.push(length); const bytes = Buffer.from(`${object.n} 0 obj\n${object.value}\nendobj\n`, "latin1"); chunks.push(bytes); length += bytes.length; }
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Encrypt ${encryptionId} 0 R /ID [<${id.toString("hex")}> <${id.toString("hex")}>] >>\nstartxref\n${length}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

test.skipIf(process.platform !== "darwin")("fixed helper admission and real PDFKit text extraction retain provenance, counts, no replay and remove only staged input", async () => {
  const helper = selectedHelper(); expect(helper.sourceSha256).toBe(SKILL_PDF_HELPER_SOURCE_SHA256); expect(helper.development).toBe(true);
  expect(() => assertPinnedSkillPdfHelper({ ...helper })).toThrow("owner-resolved");
  expect(resolveSkillPdfHelper({ runtimeEntry: "/nonexistent/cli.js" })).toBeUndefined();
  const f = fixture(); const bytes = createTextPdf([["P16 PDF TEXT OK", "TOTAL 52.00"], []]);
  try {
    expect(f.extractor.capabilities()).toMatchObject({ supported: true, activeCount: 0 });
    const result = await f.extractor.extract({ operationId: "text", bytes, sha256: sha(bytes) });
    if (result.state !== "completed") throw new Error(JSON.stringify(result));
    expect(result).toMatchObject({ state: "completed", sourceSha256: sha(bytes), sourceBytes: bytes.length, pageCount: 2, pagesWithText: 1, pagesWithoutText: 1, coverage: "text-layer-only", owner: { sealed: true, reaped: true } });
    expect(result.text).toContain("P16 PDF TEXT OK"); expect(result.text).toContain("TOTAL 52.00");
    expect(result.extractor).toMatchObject({ executableSha256: helper.executableSha256, sourceSha256: helper.sourceSha256 });
    expect(existsSync(join(f.home, "skill-pdf-runs", sha("text"), "input.pdf"))).toBe(false);
    const duplicate = await f.extractor.extract({ operationId: "text", bytes, sha256: sha(bytes) });
    expect(duplicate.owner).toEqual(result.owner); expect(duplicate.text).toBe(result.text);
    const changed = createTextPdf([["changed"]]);
    expect(await f.extractor.extract({ operationId: "text", bytes: changed, sha256: sha(changed) })).toMatchObject({ state: "failed", reason: "operation_identity_conflict" });
  } finally { await f.close(); }
}, 20000);

test.skipIf(process.platform !== "darwin")("scanned, malformed, encrypted and page/text/source limits never return empty successful extraction", async () => {
  const f = fixture();
  try {
    for (const [id, bytes, reason] of [
      ["scanned", createTextPdf([[]]), "no_extractable_text_layer"], ["malformed", Buffer.from("%PDF-1.7\ninvalid"), "malformed_pdf"],
      ["encrypted", encryptedFixture(), "encrypted_pdf"], ["pages", createTextPdf(Array.from({ length: 33 }, () => ["small"])), "page_limit_exceeded"],
      ["text-cap", createTextPdf(Array.from({ length: 20 }, () => Array.from({ length: 25 }, () => "Bounded PDF text ".repeat(4)))), "text_limit_exceeded"],
    ] as const) {
      const result = await f.extractor.extract({ operationId: id, bytes, sha256: sha(bytes) });
      expect(result).toMatchObject({ state: "unavailable", reason, owner: { sealed: true, reaped: true } }); expect(result.text).toBeUndefined();
    }
    const bytes = Buffer.alloc(2 * 1024 * 1024 + 1);
    expect(await f.extractor.extract({ operationId: "raw-cap", bytes, sha256: sha(bytes) })).toMatchObject({ state: "unavailable", reason: "source_size_limit" });
    expect(await f.extractor.extract({ operationId: "wrong-sha", bytes: Buffer.from("small"), sha256: "a".repeat(64) })).toMatchObject({ state: "failed", reason: "source_identity_mismatch" });
  } finally { await f.close(); }
}, 20000);

test.skipIf(process.platform !== "darwin")("the same development helper kernel boundary denies outside data, network, fork and further exec before parsing", async () => {
  const f = fixture(), helper = selectedHelper();
  const input = join(f.root, "input.pdf"), scratch = join(f.root, "scratch"), outside = join(f.root, "outside.txt"), profile = join(f.root, "profile.sb"), permit = join(f.root, "permit");
  const bytes = createTextPdf([["probe"]]); mkdirSync(scratch, { mode: 0o700 }); writeFileSync(input, bytes, { mode: 0o400 }); writeFileSync(outside, "preserved");
  const boundary = buildSkillPdfSandbox({ helper, input, scratch }); writeFileSync(profile, boundary.profile, { mode: 0o400 });
  const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const args = ["boundary-proof", profile, input, permit, sha(bytes), String(bytes.length), outside, String(listener.port)];
    child = spawn(helper.executable, args, { cwd: scratch, env: { HOME: scratch, TMPDIR: scratch, PATH: "/usr/bin:/bin" }, stdio: ["ignore", "pipe", "pipe", "pipe"] });
    let output = "", seal = ""; child.stdout!.on("data", bytes => { output += bytes.toString(); }); child.stderr!.resume(); (child.stdio[3] as any).on("data", (bytes: Buffer) => { seal += bytes.toString(); });
    const done = new Promise<number | null>((resolve, reject) => { child!.once("error", reject); child!.once("close", resolve); });
    child.once("spawn", () => { const owner = processIdentity(child!.pid!); writeFileSync(join(f.root, "probe-owner.json"), JSON.stringify(owner), { mode: 0o600 }); writeFileSync(permit, "owned", { mode: 0o400 }); });
    expect(await done).toBe(0); expect(seal).toBe("sealed\n"); expect(JSON.parse(output)).toEqual({ probe: true, readDenied: true, writeOpenDenied: true, networkDenied: true, forkDenied: true, execDenied: true });
    expect(readFileSync(outside, "utf8")).toBe("preserved");
  } finally { listener.stop(true); if (child && child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await new Promise(resolve => child!.once("close", resolve)); } await f.close(); }
}, 10000);

test.skipIf(process.platform !== "darwin")("cancellation physically reaps the one parser, and fresh owner recovery still holds when helper is missing", async () => {
  const f = fixture();
  try {
    const bytes = createTextPdf([["cancel"]]), id = "cancel", root = join(f.home, "skill-pdf-runs", sha(id));
    const pending = f.extractor.extract({ operationId: id, bytes, sha256: sha(bytes) });
    const observed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => { observer.close(); reject(new Error("Parser ownership phase was not observed")); }, 3000);
      const observer = watch(root, () => {
        try { const receipt = JSON.parse(readFileSync(join(root, "receipt.json"), "utf8")); if (receipt.owner.child) { f.extractor.cancel(id); clearTimeout(timer); observer.close(); resolve(); } } catch {}
      });
    });
    await observed; const result = await pending;
    expect(result).toMatchObject({ state: "failed", owner: { reaped: true, reason: "cancelled" } });
    expect(existsSync(join(root, "input.pdf"))).toBe(false);
    const other = new SkillPdfExtractor({ ...f.options, helper: undefined });
    expect(other.capabilities().supported).toBe(false); await other.close();
  } finally { await f.close(); }
}, 10000);

test.skipIf(process.platform !== "darwin")("retained exact live parser identity blocks fresh-instance close even without the helper, and unknown never replays", async () => {
  const f = fixture(false), helper = selectedHelper();
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", "setInterval(()=>{},1000)"], { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const bytes = createTextPdf([["retained"]]), id = "retained", root = join(f.home, "skill-pdf-runs", sha(id));
  try {
    const owner = processIdentity(child.pid); mkdirSync(root, { recursive: true, mode: 0o700 });
    writeFileSync(join(root, "receipt.json"), JSON.stringify({ operationId: id, sourceSha256: sha(bytes), sourceBytes: bytes.length,
      extractor: { provider: "macos-pdfkit", version: 1, executableSha256: helper.executableSha256, sourceSha256: helper.sourceSha256 },
      state: "unknown", owner: { supervisor: owner, child: owner, sealed: true, reaped: false, reason: null } }), { mode: 0o600 });
    expect(f.extractor.capabilities()).toMatchObject({ supported: false, recoveryRequired: true });
    await expect(f.extractor.close()).rejects.toThrow("physical owner");
    child.kill("SIGKILL"); await child.exited;
    expect(f.extractor.capabilities().recoveryRequired).toBe(false);
    expect(await f.extractor.extract({ operationId: id, bytes, sha256: sha(bytes) })).toMatchObject({ state: "unknown", owner: { reaped: false } });
    await f.extractor.close();
  } finally { if (child.exitCode === null) { child.kill("SIGKILL"); await child.exited; } await f.close(); }
});

test.skipIf(process.platform !== "darwin")("loss of the actual host owner closes supervisor stdin and physically reaps its exact parser", async () => {
  const f = fixture(), id = "owner-eof", receiptFile = join(f.home, "skill-pdf-runs", sha(id), "receipt.json");
  const hostScript = join(f.root, "host.ts"), bunfig = join(f.root, "bunfig.toml");
  const bytes = createTextPdf([["EOF containment"]]);
  writeFileSync(bunfig, '[install]\nauto = "disable"\n');
  writeFileSync(hostScript, `import { SkillPdfExtractor } from ${JSON.stringify(new URL("../src/agent-tools/skill-pdf-extractor.ts", import.meta.url).pathname)};
import { resolveDevelopmentSkillPdfHelper } from ${JSON.stringify(new URL("../src/agent-tools/skill-pdf-helper-path.ts", import.meta.url).pathname)};
const helper=resolveDevelopmentSkillPdfHelper(${JSON.stringify(new URL("../src/cli.ts", import.meta.url).href)});
const owner=new SkillPdfExtractor({...${JSON.stringify({ home: f.home, bunPath: f.options.bunPath, bunSha256: f.options.bunSha256 })},helper});
await owner.extract({operationId:${JSON.stringify(id)},bytes:Buffer.from(${JSON.stringify(bytes.toString("base64"))},"base64"),sha256:${JSON.stringify(sha(bytes))}});
`);
  const waitReceipt = (accept: (value: any) => boolean) => new Promise<any>((resolve, reject) => {
    const observer = watch(f.home, { recursive: true }, inspect);
    const timer = setTimeout(() => { observer.close(); reject(new Error("Owned EOF receipt phase was not observed")); }, 8000);
    function inspect() { try { const value = JSON.parse(readFileSync(receiptFile, "utf8")); if (accept(value)) { clearTimeout(timer); observer.close(); resolve(value); } } catch {} }
    inspect();
  });
  const started = waitReceipt(value => value.owner?.child && !value.owner.reaped);
  const host = Bun.spawn([process.execPath, "--no-install", "--no-env-file", `--config=${bunfig}`, hostScript], { cwd: f.root, env: { HOME: f.root, PATH: "/usr/bin:/bin", TMPDIR: f.root }, stdin: "ignore", stdout: "ignore", stderr: "ignore" });
  const hostIdentity = processIdentity(host.pid);
  try {
    const before = await started, terminal = waitReceipt(value => value.owner?.reaped);
    expect(processIdentity(host.pid)).toEqual(hostIdentity); host.kill("SIGKILL"); await host.exited;
    const after = await terminal;
    expect(after.owner).toMatchObject({ supervisor: before.owner.supervisor, child: before.owner.child, reaped: true, reason: "core-owner-eof" });
    expect(f.extractor.reconcile(id)).toMatchObject({ state: "failed", owner: { reaped: true, reason: "core-owner-eof" } });
    expect(existsSync(join(f.home, "skill-pdf-runs", sha(id), "input.pdf"))).toBe(false);
  } finally { if (host.exitCode === null) { host.kill("SIGKILL"); await host.exited; } await f.close(); }
}, 12000);
