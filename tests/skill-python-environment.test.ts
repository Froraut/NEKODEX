import { beforeAll, describe, expect, test } from "bun:test";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { chmodSync, closeSync, constants, existsSync, lstatSync, mkdtempSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zipSync, type Zippable } from "fflate";
import { admitApplePythonRuntime, type AdmittedPythonRuntime } from "../src/agent-tools/skill-python-runtime";
import { SkillPythonEnvironmentStore, assertAdmittedPythonEnvironment, pythonEnvironmentStatus, pythonEnvironmentPublicReason } from "../src/agent-tools/skill-python-environment";

let admitted: AdmittedPythonRuntime | undefined;
function runtime() { return admitted ??= admitApplePythonRuntime(); }
function fixture() {
  const base = realpathSync(mkdtempSync(join(tmpdir(), "nekodex-python-environment-"))); chmodSync(base, 0o700);
  const home = join(base, "environments");
  const writable = (dir: string) => { chmodSync(dir, 0o700); for (const name of readdirSync(dir)) { const path = join(dir, name); if (lstatSync(path).isDirectory()) writable(path); } };
  return { base, home, store: new SkillPythonEnvironmentStore({ home, getRuntime: runtime }), close() { writable(base); rmSync(base, { recursive: true }); } };
}
function wheel(base: string, options: { name?: string; version?: string; requires?: string[]; python?: string; files?: Record<string, string | Uint8Array>; badRecord?: boolean; mode?: number } = {}) {
  const name = options.name ?? "qa_fixture", version = options.version ?? "1.0", dist = `${name}-${version}.dist-info`;
  const files: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(options.files ?? { [name + "/__init__.py"]: "MARKER = 'dependency-only-after-explicit-binding'\n" })) files[path] = typeof data === "string" ? Buffer.from(data) : data;
  files[dist + "/METADATA"] = Buffer.from(`Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n${options.python ? `Requires-Python: ${options.python}\n` : ""}${(options.requires ?? []).map(r => `Requires-Dist: ${r}\n`).join("")}\n`);
  files[dist + "/WHEEL"] = Buffer.from("Wheel-Version: 1.0\nRoot-Is-Purelib: true\nTag: py3-none-any\n");
  files[dist + "/RECORD"] = Buffer.from(Object.entries(files).map(([path, data]) => `${path},sha256=${options.badRecord ? "invalid" : createHash("sha256").update(data).digest("base64url")},${data.length}\n`).join("") + `${dist}/RECORD,,\n`);
  const input: Zippable = {}; for (const [path, data] of Object.entries(files)) input[path] = [data, { os: 3, attrs: (options.mode ?? 0o100600) << 16 }];
  const path = join(base, `${name}-${version}-py3-none-any.whl`); writeFileSync(path, zipSync(input)); return path;
}
const mac = process.platform === "darwin" ? describe : describe.skip;

test("passive environment metadata creates no storage and forged runtime/environment authority is refused", () => {
  const f = fixture(); try {
    const store = new SkillPythonEnvironmentStore({ home: f.home }); expect(store.list()).toEqual([]); expect(store.actions()).toEqual([]); expect(store.inspect(randomUUID())).toBeNull(); expect(existsSync(f.home)).toBe(false);
    expect(() => store.review(randomUUID(), { wheelPaths: [] }, true)).toThrow();
    expect(pythonEnvironmentStatus()).toEqual({ supported: false, reason: "No matching admitted Python environment/runtime" });
    expect(() => assertAdmittedPythonEnvironment({} as never, {} as never)).toThrow(); expect(existsSync(f.home)).toBe(false);
    let missing: unknown; try { readFileSync(join(f.home, "private-root-marker")); } catch (error) { missing = error; }
    expect(pythonEnvironmentPublicReason(missing)).toBe("Python environment runtime or storage is unavailable; inspect the exact action receipt");
    expect(pythonEnvironmentPublicReason(missing)).not.toContain(f.base);
  } finally { f.close(); }
});

mac("owner-admitted offline pure-wheel environments", () => {
  // Establish the actual runtime boundary before any negative assertion, so a
  // runtime-admission failure cannot masquerade as successful archive refusal.
  beforeAll(() => { runtime(); });
  test("review snapshots a complete PEP440 dependency closure; explicit preparation is immutable and restart remains passive", () => {
    const f = fixture(); try {
      const dep = wheel(f.base, { name: "qa_dependency", version: "1.2.post1" });
      const app = wheel(f.base, { name: "qa_application", requires: ["qa-dependency (>=1.2,!=1.3.*,<2)"], python: ">=3.9,<3.10" });
      const id = randomUUID(), review = f.store.review(id, { wheelPaths: [app, dep] }, true);
      expect(review.state).toBe("reviewed"); expect(review.environment!.state).toBe("unavailable"); expect(review.environment!.packages.map(p => p.version)).toEqual(["1.0", "1.2.post1"]);
      expect(JSON.stringify(review)).not.toContain(f.base); expect(JSON.stringify(review)).not.toContain("readRoot");
      writeFileSync(app, "changed selected input after snapshot");
      const action = f.store.prepare(id, review.reviewDigest, true); expect(action.state).toBe("ready"); expect(action.ownerHeld).toBe(false);
      const env = f.store.admit(action.environment!.environmentId); assertAdmittedPythonEnvironment(env, runtime()); expect(pythonEnvironmentStatus(env, runtime()).supported).toBe(true);
      expect(readFileSync(join(env.readRoot, "qa_application/__init__.py"), "utf8")).toContain("dependency-only-after-explicit-binding");
      const before = readFileSync(join(f.home, "registry.json")); const restarted = new SkillPythonEnvironmentStore({ home: f.home });
      expect(restarted.inspect(id)!.state).toBe("ready"); expect(restarted.list()[0]!.state).toBe("unavailable"); expect(readFileSync(join(f.home, "registry.json")).equals(before)).toBe(true);
      expect(() => assertAdmittedPythonEnvironment({ ...env }, runtime())).toThrow();
      expect(f.store.prepare(id, review.reviewDigest, true).state).toBe("ready");
    } finally { f.close(); }
  });

  test("archive traversal, case collisions, links, native/startup content, oversized expansion and RECORD corruption never publish an environment", () => {
    const f = fixture(); try {
      const examples: NonNullable<Parameters<typeof wheel>[1]>[] = [
        { name: "bad_path", files: { "../escape.py": "pass" } },
        { name: "bad_case", files: { "a.py": "a", "A.py": "b" } },
        { name: "bad_link", mode: 0o120777 },
        { name: "bad_native", files: { "module.so": "native" } },
        { name: "bad_startup", files: { "inject.pth": "import os" } },
        { name: "bad_record", badRecord: true },
        { name: "bad_expansion", files: { "big.txt": new Uint8Array(2 * 1024 * 1024 + 1) } },
      ];
      for (const input of examples) { const path = wheel(f.base, input); expect(() => f.store.review(randomUUID(), { wheelPaths: [path] }, true)).toThrow(); }
      expect(f.store.list()).toEqual([]); expect(existsSync(join(f.home, "environments"))).toBe(false);
    } finally { f.close(); }
  });

  test("missing or incompatible dependencies, markers, extras, direct URLs and incompatible Python are explicit refusals", () => {
    const f = fixture(); try {
      const dependency = wheel(f.base, { name: "dependency", version: "2.0rc1" });
      for (const requirement of ["missing>=1", "dependency>=3", "dependency; python_version >= '3'", "dependency[extra]>=1", "dependency @ https://example.invalid/dep.whl"]) {
        const app = wheel(f.base, { name: "application", requires: [requirement] }); expect(() => f.store.review(randomUUID(), { wheelPaths: [app, dependency] }, true)).toThrow();
      }
      const newer = wheel(f.base, { name: "newer_python", python: ">=3.10" }); expect(() => f.store.review(randomUUID(), { wheelPaths: [newer] }, true)).toThrow();
      const a = wheel(f.base, { name: "distribution_a", files: { "shared.py": "a" } }), b = wheel(f.base, { name: "distribution_b", files: { "shared.py": "b" } });
      expect(() => f.store.review(randomUUID(), { wheelPaths: [a, b] }, true)).toThrow(); expect(f.store.actions()).toEqual([]);
      const post = wheel(f.base, { name: "post_dependency", version: "1.7.post3" }), postApp = wheel(f.base, { name: "post_application", requires: ["post-dependency>1.7.post2"] });
      expect(f.store.review(randomUUID(), { wheelPaths: [postApp, post] }, true).state).toBe("reviewed");
      const pre = wheel(f.base, { name: "pre_dependency", version: "1.0rc1" }), preApp = wheel(f.base, { name: "pre_application", requires: ["pre-dependency>=1.0rc1,<1.0rc2"] });
      expect(f.store.review(randomUUID(), { wheelPaths: [preApp, pre] }, true).state).toBe("reviewed");
    } finally { f.close(); }
  });

  test("tampered snapshots are refused and post-publication unknown reconciles only the existing exact environment without replay", () => {
    const f = fixture(); try {
      const path = wheel(f.base), id = randomUUID(), review = f.store.review(id, { wheelPaths: [path] }, true);
      const lockPath = join(f.home, ".lock"), lockInode = lstatSync(lockPath).ino;
      const lock = openSync(lockPath, constants.O_RDWR | constants.O_NOFOLLOW | 0x20 | 0x04);
      try { const concurrent = new SkillPythonEnvironmentStore({ home: f.home, runtime: runtime() }); expect(() => concurrent.prepare(id, review.reviewDigest, true)).toThrow(); expect(concurrent.inspect(id)!.state).toBe("reviewed"); } finally { closeSync(lock); }
      expect(lstatSync(lockPath).ino).toBe(lockInode);
      const data = join(f.home, "reviews", id, "data", "qa_fixture", "__init__.py"); chmodSync(data, 0o600); writeFileSync(data, "changed review bytes");
      expect(() => f.store.prepare(id, review.reviewDigest, true)).toThrow(); expect(f.store.inspect(id)!.state).toBe("reviewed");
      // Restore the exact reviewed snapshot, prepare once, then reproduce the
      // crash boundary after directory publication but before the terminal row.
      writeFileSync(data, "MARKER = 'dependency-only-after-explicit-binding'\n"); chmodSync(data, 0o400);
      expect(f.store.prepare(id, review.reviewDigest, true).state).toBe("ready");
      const registryPath = join(f.home, "registry.json"), envelope = JSON.parse(readFileSync(registryPath, "utf8")), state = JSON.parse(envelope.body);
      state.actions[0].state = "prepared"; const body = JSON.stringify(state), key = readFileSync(join(f.home, "integrity.key"));
      chmodSync(registryPath, 0o600); writeFileSync(registryPath, JSON.stringify({ body, signature: createHmac("sha256", key).update(body).digest("hex") })); chmodSync(registryPath, 0o400);
      // A fully fsynced pending terminal publication is retained across restart;
      // passive reads must hold it rather than silently adopt or ignore it.
      writeFileSync(join(f.home, "registry.pending"), JSON.stringify(envelope), { mode: 0o400, flag: "wx" });
      const restarted = new SkillPythonEnvironmentStore({ home: f.home, runtime: runtime() }); const before = readFileSync(registryPath);
      expect(restarted.inspect(id)!.state).toBe("unknown"); expect(restarted.prepare(id, review.reviewDigest, true).state).toBe("unknown"); expect(readFileSync(registryPath).equals(before)).toBe(true);
      expect(() => restarted.review(randomUUID(), { wheelPaths: [path] }, true)).toThrow();
      const treeBefore = lstatSync(join(f.home, "environments", review.environment!.environmentId));
      expect(restarted.reconcile(id, true).state).toBe("ready"); expect(lstatSync(join(f.home, "environments", review.environment!.environmentId)).ino).toBe(treeBefore.ino);
      expect(existsSync(join(f.home, "registry.pending"))).toBe(false); expect(readdirSync(join(f.home, "transactions"))).toHaveLength(1);
      const env = restarted.admit(review.environment!.environmentId), target = join(env.readRoot, "qa_fixture/__init__.py"); chmodSync(target, 0o600); writeFileSync(target, "tampered ready data");
      expect(pythonEnvironmentStatus(env, runtime()).supported).toBe(false); expect(() => assertAdmittedPythonEnvironment(env, runtime())).toThrow(); expect(() => restarted.admit(env.environmentId)).toThrow();
    } finally { f.close(); }
  });
});
