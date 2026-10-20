import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync, existsSync, chmodSync, lstatSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SkillScriptExecutor } from "../src/agent-tools/skill-script-executor";
import { admitApplePythonRuntime, assertAdmittedPythonRuntime, pythonRuntimeStatus, SKILL_PYTHON_BOOTSTRAP_SHA256 } from "../src/agent-tools/skill-python-runtime";
import { reviewTrustedSandboxConfig } from "../src/agent-tools/sandbox";
const sha = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const scope = { taskId: "python-fixture", generation: 1, toolCallId: "call" };
let admitted: ReturnType<typeof admitApplePythonRuntime> | undefined;
const runtime = () => admitted ??= admitApplePythonRuntime();
function fixture(python = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "neko-python-boundary-"))), home = join(root, "executor"), workspace = join(root, "workspace");
  mkdirSync(home, { mode: 0o700 }); mkdirSync(workspace, { mode: 0o700 });
  const bunPath = realpathSync(process.execPath), executor = new SkillScriptExecutor({ bunPath, bunSha256: sha(readFileSync(bunPath)), home, ...(python ? { pythonRuntime: runtime() } : {}) });
  const grants = reviewTrustedSandboxConfig({ codeRoots: [], readRoots: [workspace], writeRoots: [workspace] });
  const execute = (operationId: string, code: string, options: Record<string, unknown> = {}) => executor.execute({ runtime: "python", scope, operationId,
    entryRelativePath: "scripts/run.py", resources: [{ relativePath: "scripts/run.py", bytes: Buffer.from(code) }], argv: [], readRoots: grants.readRoots, writeRoots: grants.writeRoots, cwd: workspace, ...options });
  return { root, home, workspace, executor, execute, async close() {
    await executor.close();
    const unseal = (path: string) => { if (lstatSync(path).isDirectory()) { chmodSync(path, 0o700); for (const name of readdirSync(path)) unseal(join(path, name)); } };
    unseal(root); rmSync(root, { recursive: true, force: true });
  } };
}

test.skipIf(process.platform !== "darwin")("Python admission is fixed, passive and branded; JS default never dispatches a Python entry", async () => {
  const selected = runtime();
  expect(selected.executable).toEndWith("Python3.framework/Versions/3.9/bin/python3.9");
  expect(selected.closureFiles).toBeLessThanOrEqual(2048); expect(selected.closureBytes).toBeLessThanOrEqual(64 * 1024 * 1024);
  expect(pythonRuntimeStatus(selected)).toMatchObject({ supported: true, closureDigest: selected.closureDigest });
  expect(() => assertAdmittedPythonRuntime({ ...selected })).toThrow("owner-created");
  const f = fixture(false);
  try {
    expect(f.executor.capabilities().runtimes.python.supported).toBe(false);
    const unavailable = await f.execute("no-runtime", "print('MUST NOT RUN')");
    expect(unavailable.state).toBe("failed"); expect(unavailable.owner).toBeUndefined();
    const wrong = await f.execute("wrong-runtime", "print('MUST NOT RUN')", { runtime: undefined });
    expect(wrong.state).toBe("failed"); expect(wrong.owner).toBeUndefined();
  } finally { await f.close(); }
});

test.skipIf(process.platform !== "darwin")("selected Python applies the real kernel boundary before user code and preserves exact supervised ownership", async () => {
  const f = fixture(), outside = join(f.root, "ungranted.txt"), output = join(f.workspace, "allowed.txt");
  writeFileSync(outside, "preserved-fixture");
  const old = process.env.NEKODEX_PYTHON_TEST_SECRET, oldPath = process.env.PYTHONPATH;
  process.env.NEKODEX_PYTHON_TEST_SECRET = "synthetic-secret-not-inherited"; process.env.PYTHONPATH = f.workspace;
  try {
    const source = `import os, sys, json, ctypes, socket\nfacts = {"env": os.environ.get("NEKODEX_PYTHON_TEST_SECRET"), "isolated": sys.flags.isolated, "noSite": sys.flags.no_site, "noBytecode": sys.flags.dont_write_bytecode}\ntry:\n os.fstat(3); facts["controlClosed"] = False\nexcept OSError:\n facts["controlClosed"] = True\nwith open(${JSON.stringify(output)}, "w") as out: out.write("python-approved\\n")\nfor key, path, mode in [("outsideRead", ${JSON.stringify(outside)}, "r"), ("outsideWrite", ${JSON.stringify(outside)}, "w"), ("codeWrite", __file__, "w")]:\n try:\n  with open(path, mode) as file: file.read() if mode == "r" else file.write("changed")\n  facts[key] = False\n except OSError: facts[key] = True\nlib = ctypes.CDLL("/usr/lib/libSystem.B.dylib", use_errno=True)\nlib.fork.restype = ctypes.c_int\npid = lib.fork()\nif pid == 0: os._exit(0)\nif pid > 0: os.waitpid(pid, 0)\nfacts["forkDenied"] = pid == -1\nlib.execve.argtypes = [ctypes.c_char_p, ctypes.c_void_p, ctypes.c_void_p]\nlib.execve.restype = ctypes.c_int\nfacts["execDenied"] = lib.execve(b"/usr/bin/true", None, None) == -1\nconnection = None\ntry:\n connection = socket.socket()\n connection.connect(("127.0.0.1", 9)); facts["networkDenied"] = False\nexcept OSError as error: facts["networkDenied"] = error.errno in (1, 13)\nfinally:\n if connection is not None: connection.close()\nprint(json.dumps(facts))\n`;
    const result = await f.execute("kernel", source);
    if (result.state !== "completed") throw new Error(JSON.stringify(result));
    expect(result.owner).toMatchObject({ sealed: true, reaped: true });
    expect(result.boundary).toMatchObject({ runtime: "python", closureDigest: runtime().closureDigest, processExec: "deny", processFork: "deny", network: "deny-network-operations" });
    expect(JSON.parse(result.stdout)).toEqual({ env: null, isolated: 1, noSite: 1, noBytecode: 1, controlClosed: true, outsideRead: true, outsideWrite: true, codeWrite: true, forkDenied: true, execDenied: true, networkDenied: true });
    expect(readFileSync(outside, "utf8")).toBe("preserved-fixture"); expect(readFileSync(output, "utf8")).toBe("python-approved\n");
    const config = JSON.parse(readFileSync(join(f.home, "skill-script-runs", sha("kernel"), "code", "__trusted", "supervisor.json"), "utf8"));
    expect(config.bootstrapSha256).toBe(SKILL_PYTHON_BOOTSTRAP_SHA256); expect(config.pythonClosureDigest).toBe(runtime().closureDigest);
    expect(config.pythonExecutable).toBe(runtime().executable);
    const duplicate = await f.execute("kernel", "raise RuntimeError('must not replay')");
    expect(duplicate.stdout).toBe(result.stdout); expect(readFileSync(output, "utf8")).toBe("python-approved\n");
    const legacy = await f.execute("legacy-js", "console.log('legacy-js-ok')", { runtime: undefined, entryRelativePath: "scripts/run.mjs", resources: [{ relativePath: "scripts/run.mjs", bytes: Buffer.from("console.log('legacy-js-ok')") }] });
    expect(legacy.state).toBe("completed"); expect(legacy.stdout.trim()).toBe("legacy-js-ok"); expect(legacy.boundary?.runtime).toBeUndefined();
    expect(existsSync(join(f.workspace, "__pycache__"))).toBe(false);
  } finally {
    if (old === undefined) delete process.env.NEKODEX_PYTHON_TEST_SECRET; else process.env.NEKODEX_PYTHON_TEST_SECRET = old;
    if (oldPath === undefined) delete process.env.PYTHONPATH; else process.env.PYTHONPATH = oldPath;
    await f.close();
  }
}, 15000);

test.skipIf(process.platform !== "darwin")("Python timeout, bounded output and cancellation reap the same owned child", async () => {
  const f = fixture();
  try {
    const timeout = await f.execute("timeout", "while True: pass", { timeoutMs: 300 });
    expect(timeout.state).toBe("failed"); expect(timeout.owner).toMatchObject({ reason: "timeout", reaped: true });
    const capped = await f.execute("output", "print('x' * 20000, flush=True)\nwhile True: pass", { maxOutputBytes: 1024 });
    expect(capped.truncated).toBe(true); expect(Buffer.byteLength(capped.stdout)).toBeLessThanOrEqual(1024); expect(capped.owner?.reaped).toBe(true);
    const controller = new AbortController();
    const pending = f.execute("cancel", "while True: pass", { signal: controller.signal });
    // A bounded single event wait reaches the already-owned supervisor before cancellation.
    await new Promise(resolve => setTimeout(resolve, 150)); controller.abort();
    const cancelled = await pending; expect(cancelled.state).toBe("failed"); expect(cancelled.owner?.reaped).toBe(true);
  } finally { await f.close(); }
}, 15000);
