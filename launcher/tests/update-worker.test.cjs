const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { spawn } = require("node:child_process");
const { operation, writeJournal, replace, rollback, commit, recover, runTransaction, waitForReadiness,
  prepareTransaction, launch } = require("../electron/update-worker.cjs");
const { captureUpdateReadiness, proveUpdateReadiness } = require("../electron/update-readiness.cjs");
const { processIdentity, recoveryRegistration, registerRecovery, unregisterRecovery } = require("../electron/update-recovery.cjs");

function snapshot(root) {
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink()) return { link: fs.readlinkSync(root) };
  if (stat.isDirectory()) return Object.fromEntries(fs.readdirSync(root).sort().map(name => [name, snapshot(path.join(root, name))]));
  return { mode: stat.mode, mtime: stat.mtimeMs, sha256: crypto.createHash("sha256").update(fs.readFileSync(root)).digest("hex") };
}
function fixture(platform) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "update-transaction-test-"));
  const transactionRoot = path.join(root, "recovery");
  fs.mkdirSync(transactionRoot);
  const target = path.join(root, platform === "linux" ? "wrapper" : "Application");
  const next = path.join(root, "next");
  if (platform === "linux") {
    fs.writeFileSync(target, "original wrapper\n", { mode: 0o751 });
    fs.writeFileSync(next, "new wrapper\n", { mode: 0o755 });
    fs.mkdirSync(path.join(root, "old-version"));
    fs.writeFileSync(path.join(root, "old-version", "AppImage"), "original image");
  } else {
    for (const folder of [target, next]) fs.mkdirSync(path.join(folder, "nested"), { recursive: true });
    fs.writeFileSync(path.join(target, "executable"), "exact original executable", { mode: 0o751 });
    fs.writeFileSync(path.join(target, "nested", "preferences"), "original installation data");
    fs.writeFileSync(path.join(next, "executable"), "replacement executable", { mode: 0o755 });
  }
  const original = snapshot(target);
  const transaction = { schemaVersion: 1, root: transactionRoot, phase: "prepared", runtime: process.execPath,
    readyFile: path.join(transactionRoot, "ready.json"), readyToken: "a".repeat(64),
    packageTarget: target, job: { platform, arch: "x64", version: "2.0.0", target, wrapper: target, productName: "Codex Web GPT",
      tempRoot: path.join(root, "download"), logPath: path.join(root, "logs", "update.log") },
    operations: [operation(target, next, transactionRoot, 0)] };
  writeJournal(transaction);
  return { root, target, original, transaction, close: () => fs.rmSync(root, { recursive: true, force: true }) };
}

for (const platform of ["darwin", "win32", "linux"]) {
  for (const point of ["before-backup", "after-backup", "after-replace"]) {
    test(`${platform}: interrupted ${point} restores exact old files, mode and timestamps`, () => {
      const f = fixture(platform);
      try {
        assert.throws(() => replace(f.transaction, phase => { if (phase === point) throw new Error("interrupted"); }), /interrupted/);
        // Recover from persisted state, not the in-memory state at interruption.
        const saved = JSON.parse(fs.readFileSync(path.join(f.transaction.root, "transaction.json")));
        rollback(saved);
        assert.deepEqual(snapshot(f.target), f.original);
        rollback(saved); // Recovery is idempotent.
        assert.deepEqual(snapshot(f.target), f.original);
        assert.equal(fs.existsSync(saved.operations[0].previous), false);
      } finally { f.close(); }
    });
  }
  for (const point of ["before-restore", "after-restore"]) {
    test(`${platform}: recovery interrupted ${point} can resume without losing the old app`, () => {
      const f = fixture(platform);
      try {
        replace(f.transaction);
        assert.deepEqual(snapshot(f.transaction.operations[0].previous), f.original);
        assert.throws(() => rollback(f.transaction, phase => { if (phase === point) throw new Error("interrupted rollback"); }), /interrupted/);
        rollback(JSON.parse(fs.readFileSync(path.join(f.transaction.root, "transaction.json"))));
        assert.deepEqual(snapshot(f.target), f.original);
      } finally { f.close(); }
    });
  }
  for (const failure of ["spawn", "readiness"]) {
    test(`${platform}: ${failure} failure restores the prior installation before relaunch`, async () => {
      const f = fixture(platform);
      const launches = [];
      let stopped = false;
      try {
        await assert.rejects(runTransaction(f.transaction, {
          launch: async (executable, args) => {
            launches.push(executable);
            if (args) {
              assert.deepEqual(snapshot(f.transaction.operations[0].previous), f.original);
              if (failure === "spawn") throw new Error("spawn failed");
              return { pid: process.pid };
            }
            assert.deepEqual(snapshot(f.target), f.original);
            return { pid: 42 };
          },
          waitForReadiness: async () => { assert.deepEqual(snapshot(f.transaction.operations[0].previous), f.original); throw new Error("readiness failed"); },
          stopReplacement: async () => { stopped = true; },
          unregisterRecovery() {},
        }), new RegExp(`${failure} failed`));
        assert.equal(stopped, true);
        assert.equal(launches.length, 2);
        assert.deepEqual(snapshot(f.target), f.original);
      } finally { f.close(); }
    });
  }
  test(`${platform}: old app remains intact throughout readiness, then commit retains the replacement`, async () => {
    const f = fixture(platform);
    try {
      const replacement = snapshot(f.transaction.operations[0].next);
      await runTransaction(f.transaction, {
        launch: async () => ({ pid: process.pid }),
        waitForReadiness: async transaction => {
          assert.deepEqual(snapshot(transaction.operations[0].previous), f.original);
          assert.deepEqual(snapshot(f.target), replacement);
          assert.equal(fs.existsSync(path.join(transaction.root, "launch-authorized.json")), true);
        },
        unregisterRecovery() {},
      });
      assert.deepEqual(snapshot(f.target), replacement);
      assert.equal(fs.existsSync(f.transaction.operations[0].previous), false);
      assert.equal(f.transaction.phase, "committed");
      if (platform === "linux") assert.equal(fs.readFileSync(path.join(f.root, "old-version", "AppImage"), "utf8"), "original image");
    } finally { f.close(); }
  });
}

test("recovery relaunches the prior app and committed recovery never rolls back", async () => {
  for (const phase of ["replacing", "committed"]) {
    const f = fixture("darwin");
    try {
      replace(f.transaction);
      if (phase === "committed") commit(f.transaction);
      const expected = snapshot(f.target);
      let launches = 0;
      await recover(path.join(f.transaction.root, "transaction.json"), { stopReplacement: async () => {},
        launch: async () => { launches++; return {}; }, unregisterRecovery() {} });
      assert.deepEqual(snapshot(f.target), phase === "committed" ? expected : f.original);
      assert.equal(launches, phase === "committed" ? 0 : 1);
    } finally { f.close(); }
  }
});

test("login recovery does not race the original live worker or another recovery owner", async () => {
  const f = fixture("darwin");
  try {
    f.transaction.workerPid = process.pid;
    f.transaction.workerIdentity = processIdentity(process.pid);
    assert.ok(f.transaction.workerIdentity);
    writeJournal(f.transaction);
    let calls = 0;
    await recover(path.join(f.transaction.root, "transaction.json"), { launch: async () => { calls++; } });
    assert.equal(calls, 0);
    delete f.transaction.workerIdentity;
    writeJournal(f.transaction);
    fs.writeFileSync(path.join(f.transaction.root, "recovery.lock"), JSON.stringify({ pid: process.pid, identity: processIdentity(process.pid) }));
    await recover(path.join(f.transaction.root, "transaction.json"), { launch: async () => { calls++; } });
    assert.equal(calls, 0);
    assert.deepEqual(snapshot(f.target), f.original);
  } finally { f.close(); }
});

test("readiness rejects absent, stale, mismatched, dead and oversized proofs", async () => {
  const f = fixture("win32");
  try {
    f.transaction.candidatePid = 10;
    const proof = { token: f.transaction.readyToken, version: "2.0.0", platform: "win32", arch: "x64", pid: 11, packageTarget: f.target };
    fs.writeFileSync(path.join(f.transaction.root, "launched.json"), JSON.stringify({ pid: 11 }));
    const isAlive = pid => [10, 11].includes(pid);
    await assert.rejects(waitForReadiness(f.transaction, { timeoutMs: 1, graceMs: 0, isAlive }), /deadline/);
    for (const patch of [{ token: "b".repeat(64) }, { version: "1.0.0" }, { platform: "linux" }, { arch: "arm64" }, { pid: 12 }, { packageTarget: "/different" }]) {
      fs.writeFileSync(f.transaction.readyFile, JSON.stringify({ ...proof, ...patch }));
      await assert.rejects(waitForReadiness(f.transaction, { timeoutMs: 100, graceMs: 0, isAlive }), /does not match/);
    }
    fs.writeFileSync(f.transaction.readyFile, "x".repeat(4097));
    await assert.rejects(waitForReadiness(f.transaction, { isAlive }), /oversized/);
    fs.writeFileSync(f.transaction.readyFile, JSON.stringify(proof));
    await assert.rejects(waitForReadiness(f.transaction, { isAlive: () => false }), /exited/);
    assert.deepEqual(await waitForReadiness(f.transaction, { timeoutMs: 100, graceMs: 0, isAlive }), proof);
  } finally { f.close(); }
});

test("readiness credentials require executable runtime and usable lifecycle proof", () => {
  const f = fixture("linux");
  try {
    const env = { CODEX_WEB_GPT_UPDATE_READY_FILE: f.transaction.readyFile, CODEX_WEB_GPT_UPDATE_READY_TOKEN: f.transaction.readyToken };
    const handoff = captureUpdateReadiness(env);
    assert.deepEqual(env, {});
    const options = { version: "2.0.0", platform: "linux", arch: "x64", env: { CODEX_WEB_GPT_APPIMAGE: f.target } };
    const invocation = { executable: "/runtime/bun", args: ["cli.js", "--version"], cwd: "/runtime" };
    assert.throws(() => proveUpdateReadiness(handoff, options, invocation, () => ({ status: 1, stdout: "2.0.0" })), /did not report/);
    assert.equal(fs.existsSync(handoff.filename), false);
    assert.throws(() => proveUpdateReadiness(handoff, options, invocation, () => ({ status: 0, stdout: "1.0.0" })), /did not report/);
    assert.throws(() => proveUpdateReadiness(handoff, options, invocation, () => ({ status: 0, stdout: "2.0.0" })), /locally usable/);
    assert.equal(fs.existsSync(handoff.filename), false);
    Object.assign(options, { readinessSchema: 2, lifecycleStatus: "local-usable", nativeAvailability: "ready", configVersion: "2.0.0", lifecycleRevision: 1 });
    proveUpdateReadiness(handoff, options, invocation, () => ({ status: 0, stdout: "2.0.0\n" }));
    assert.equal(JSON.parse(fs.readFileSync(handoff.filename)).token, f.transaction.readyToken);
    assert.equal(proveUpdateReadiness(null, options, null), false);
  } finally { f.close(); }
});

test("recovery registrations use isolated per-update names and preserve normal auto-start entries", () => {
  for (const platform of ["darwin", "win32", "linux"]) {
    const f = fixture(platform);
    try {
      const options = { home: path.join(f.root, "Home with 'quotes' & spaces"), env: {} };
      const registration = recoveryRegistration(f.transaction, options);
      const calls = [];
      options.run = (command, args) => {
        calls.push([command, args]);
        return { status: 0, stdout: args[0] === "QUERY" ? `    ${registration.name}    REG_SZ    ${registration.contents}\r\n` : "" };
      };
      const created = registerRecovery(f.transaction, options);
      assert.deepEqual(created, registration);
      if (platform !== "win32") assert.equal(fs.readFileSync(created.path, "utf8"), created.contents);
      unregisterRecovery(f.transaction, options);
      if (platform !== "win32") assert.equal(fs.existsSync(created.path), false);
      else {
        assert.equal(calls[0][1][0], "ADD");
        assert.equal(calls[2][1][0], "DELETE");
        assert.match(created.name, /^CodexWebGPTUpdateRecovery-/);
      }
    } finally { f.close(); }
  }
});

test("conflicting recovery file is preserved and does not become transaction-owned", () => {
  const f = fixture("linux");
  try {
    const options = { home: path.join(f.root, "home"), env: {} };
    const registration = recoveryRegistration(f.transaction, options);
    fs.mkdirSync(path.dirname(registration.path), { recursive: true });
    fs.writeFileSync(registration.path, "external recovery entry\n");
    assert.throws(() => registerRecovery(f.transaction, options), error => error?.code === "EEXIST");
    assert.equal(fs.readFileSync(registration.path, "utf8"), "external recovery entry\n");
    assert.equal(f.transaction.recovery, undefined);
    assert.equal(fs.existsSync(path.join(f.transaction.root, "registration.json")), false);
    unregisterRecovery(f.transaction, options);
    assert.equal(fs.readFileSync(registration.path, "utf8"), "external recovery entry\n");
  } finally { f.close(); }
});

test("recovery registration conflict leaves preparation retryable without touching the installed app", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "update-registration-conflict-"));
  const target = path.join(root, "Application");
  const transactionRoot = `${target}.update-recovery`;
  const tempRoot = path.join(root, "temporary-download");
  const home = path.join(root, "home");
  fs.mkdirSync(target);
  fs.mkdirSync(tempRoot);
  fs.writeFileSync(path.join(target, "installed"), "original installation");
  const original = snapshot(target);
  const job = { platform: "darwin", arch: "x64", version: "2.0.0", target, productName: "Codex Web GPT",
    tempRoot, logPath: path.join(root, "logs", "update-worker.log"), runtimeExecutable: __filename,
    transactionRoot, stagedApplication: path.join(tempRoot, "staged") };
  const registration = recoveryRegistration({ root: transactionRoot, runtime: path.join(transactionRoot, "bun"), job }, { home, env: {} });
  fs.mkdirSync(path.dirname(registration.path), { recursive: true });
  fs.writeFileSync(registration.path, "external recovery entry\n");
  try {
    assert.throws(() => prepareTransaction(job, {
      validate() {},
      copyTree(_source, destination) { fs.mkdirSync(destination); fs.writeFileSync(path.join(destination, "candidate"), "new"); },
      registerRecovery(transaction) { return registerRecovery(transaction, { home, env: {} }); },
      unregisterRecovery(transaction) { return unregisterRecovery(transaction, { home, env: {} }); },
    }), error => error?.code === "EEXIST");
    assert.deepEqual(snapshot(target), original);
    assert.equal(fs.readFileSync(registration.path, "utf8"), "external recovery entry\n");
    assert.equal(fs.existsSync(transactionRoot), false);
    assert.equal(fs.existsSync(tempRoot), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test("staging validation or copy failure leaves the existing installation exact and never registers recovery", () => {
  for (const failure of ["validation", "copy"]) {
    const f = fixture("win32");
    try {
      fs.rmSync(f.transaction.root, { recursive: true });
      let registrations = 0;
      const job = { ...f.transaction.job, transactionRoot: f.transaction.root, runtimeExecutable: __filename,
        stagedApplication: f.transaction.operations[0].next };
      assert.throws(() => prepareTransaction(job, {
        validate() { if (failure === "validation") throw new Error("validation failed"); },
        copyTree() { throw new Error("copy failed"); },
        registerRecovery() { registrations++; }, unregisterRecovery() {},
      }), new RegExp(`${failure} failed`));
      assert.equal(registrations, 0);
      assert.deepEqual(snapshot(f.target), f.original);
    } finally { f.close(); }
  }
});

test("native spawn errors reject before claiming a successful relaunch", async () => {
  await assert.rejects(launch(path.join(os.tmpdir(), `absent-update-${crypto.randomUUID()}`)), /ENOENT/);
});

async function until(predicate, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("Native update fixture timed out");
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
const posixOnly = { skip: process.platform === "win32" ? "POSIX process termination fixture" : false };
const nativeRuntime = process.env.CODEX_UPDATE_TEST_RUNTIME || process.execPath;
for (const point of ["before-backup", "after-backup", "after-replace"]) {
  test(`native guardian restores the exact wrapper after worker SIGKILL at ${point}`, posixOnly, async () => {
    const f = fixture("linux");
    let worker;
    try {
      const marker = path.join(f.root, "restored-launch");
      fs.writeFileSync(f.target, `#!/bin/sh\nprintf restored > '${marker}'\n`, { mode: 0o751 });
      const original = snapshot(f.target);
      const workerModule = path.resolve(__dirname, "../electron/update-worker.cjs");
      const identityModule = path.resolve(__dirname, "../electron/update-recovery.cjs");
      const code = `
        const fs = require('node:fs');
        const { spawn } = require('node:child_process');
        const { writeJournal, replace } = require(${JSON.stringify(workerModule)});
        const { processIdentity } = require(${JSON.stringify(identityModule)});
        const filename = ${JSON.stringify(path.join(f.transaction.root, "transaction.json"))};
        const tx = JSON.parse(fs.readFileSync(filename));
        tx.workerPid = process.pid; tx.workerIdentity = processIdentity(process.pid);
        writeJournal(tx);
        const guard = spawn(process.execPath, [${JSON.stringify(workerModule)}, filename, '--guard'], {detached:true, stdio:['pipe','ignore','ignore']});
        guard.once('spawn', () => replace(tx, phase => { if (phase === ${JSON.stringify(point)}) process.kill(process.pid, 'SIGKILL'); }));
      `;
      worker = spawn(nativeRuntime, ["-e", code], { stdio: "ignore" });
      await new Promise(resolve => worker.once("exit", resolve));
      await until(() => fs.existsSync(marker));
      assert.deepEqual(snapshot(f.target), original);
      assert.equal(fs.readFileSync(marker, "utf8"), "restored");
      await until(() => !fs.existsSync(f.transaction.root));
    } finally { if (worker?.exitCode === null && worker?.signalCode === null) worker.kill(); f.close(); }
  });
}

test("native launch supervisor cannot execute a replacement before durable authorization", posixOnly, async () => {
  const f = fixture("linux");
  let child;
  try {
    const marker = path.join(f.root, "unexpected-launch");
    fs.writeFileSync(f.target, `#!/bin/sh\nprintf launched > '${marker}'\n`, { mode: 0o755 });
    child = spawn(nativeRuntime, [path.resolve(__dirname, "../electron/update-launcher.cjs"), f.transaction.root], { stdio: "ignore" });
    await new Promise(resolve => child.once("spawn", resolve));
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(fs.existsSync(marker), false);
    child.kill("SIGKILL");
    await new Promise(resolve => child.once("exit", resolve));
    assert.equal(fs.existsSync(marker), false);
  } finally { child?.kill(); f.close(); }
});

for (const successful of [true, false]) {
  test(`native supervised replacement ${successful ? "proves readiness and commits" : "exits early and restores the original"}`, posixOnly, async () => {
    const f = fixture("linux");
    try {
      f.transaction.runtime = nativeRuntime;
      for (const filename of ["update-launcher.cjs", "update-recovery.cjs"]) {
        fs.copyFileSync(path.resolve(__dirname, "../electron", filename), path.join(f.transaction.root, filename));
      }
      const script = path.join(f.root, "replacement.cjs");
      const readinessModule = path.resolve(__dirname, "../electron/update-readiness.cjs");
      fs.writeFileSync(script, successful
        ? `const {captureUpdateReadiness,acknowledgeUpdateReady}=require(${JSON.stringify(readinessModule)});\nacknowledgeUpdateReady(captureUpdateReadiness(), {version:'2.0.0',platform:'linux',arch:'x64',env:{CODEX_WEB_GPT_APPIMAGE:${JSON.stringify(f.target)}}});\nsetInterval(()=>{},1000);\n`
        : "process.exit(3);\n");
      const quote = value => `'${value.replace(/'/g, `'\\''`)}'`;
      fs.writeFileSync(f.transaction.operations[0].next, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)}\n`, { mode: 0o755 });
      const restoredMarker = path.join(f.root, "restored");
      fs.writeFileSync(f.target, `#!/bin/sh\nprintf old > ${quote(restoredMarker)}\n`, { mode: 0o751 });
      const original = snapshot(f.target);
      const action = runTransaction(f.transaction, { unregisterRecovery() {} });
      if (successful) {
        await action;
        assert.equal(f.transaction.phase, "committed");
        assert.equal(fs.existsSync(f.transaction.operations[0].previous), false);
        assert.equal(fs.existsSync(restoredMarker), false);
      } else {
        await assert.rejects(action, /exited before readiness/);
        assert.deepEqual(snapshot(f.target), original);
        await until(() => fs.existsSync(restoredMarker));
      }
    } finally {
      if (f.transaction.candidatePid) {
        try { process.kill(-f.transaction.candidatePid, "SIGKILL"); } catch {}
      }
      f.close();
    }
  });
}

test("native rollback stops a recorded replacement after its launch supervisor dies", posixOnly, async () => {
  const f = fixture("linux");
  let replacementPid;
  try {
    f.transaction.runtime = nativeRuntime;
    for (const filename of ["update-launcher.cjs", "update-recovery.cjs"]) {
      fs.copyFileSync(path.resolve(__dirname, "../electron", filename), path.join(f.transaction.root, filename));
    }
    const script = path.join(f.root, "candidate.cjs");
    const heartbeat = path.join(f.root, "candidate-heartbeat");
    const marker = path.join(f.root, "old-relaunched");
    fs.writeFileSync(script, `setInterval(() => require('node:fs').writeFileSync(${JSON.stringify(heartbeat)}, String(Date.now())), 20);\n`);
    const quote = value => `'${value.replace(/'/g, `'\\''`)}'`;
    fs.writeFileSync(f.transaction.operations[0].next, `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)}\n`, { mode: 0o755 });
    fs.writeFileSync(f.target, `#!/bin/sh\nprintf old > ${quote(marker)}\n`, { mode: 0o751 });
    const original = snapshot(f.target);
    await assert.rejects(runTransaction(f.transaction, {
      unregisterRecovery() {},
      waitForReadiness: async transaction => {
        await until(() => fs.existsSync(path.join(transaction.root, "launched.json")) && fs.existsSync(heartbeat));
        replacementPid = JSON.parse(fs.readFileSync(path.join(transaction.root, "launched.json"))).pid;
        process.kill(transaction.candidatePid, "SIGKILL");
        await until(() => !processIdentity(transaction.candidatePid));
        throw new Error("launch supervisor exited");
      },
    }), /launch supervisor exited/);
    await until(() => fs.existsSync(marker));
    assert.deepEqual(snapshot(f.target), original);
    const previous = fs.readFileSync(heartbeat, "utf8");
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.equal(fs.readFileSync(heartbeat, "utf8"), previous, "replacement must be stopped before restoring and relaunching the previous app");
  } finally {
    if (f.transaction.candidatePid) { try { process.kill(-f.transaction.candidatePid, "SIGKILL"); } catch {} }
    if (replacementPid) { try { process.kill(replacementPid, "SIGKILL"); } catch {} }
    f.close();
  }
});

test("Windows rollback targets the surviving recorded app when the supervisor PID was reused", async () => {
  const { stopReplacement } = require("../electron/update-worker.cjs");
  const f = fixture("win32");
  try {
    f.transaction.candidatePid = 10;
    f.transaction.candidateIdentity = "original-supervisor";
    fs.writeFileSync(path.join(f.transaction.root, "launched.json"), JSON.stringify({
      pid: 11, identity: "original-child", token: f.transaction.readyToken,
    }));
    let childAlive = true;
    const killed = [];
    await stopReplacement(f.transaction, {
      processAlive: pid => pid === 10 || (pid === 11 && childAlive),
      processIdentity: pid => pid === 10 ? "unrelated-reused-pid" : "original-child",
      spawnSync: (command, args) => {
        assert.equal(command, "taskkill.exe");
        assert.deepEqual(args, ["/PID", "11", "/T", "/F"]);
        killed.push(11); childAlive = false; return { status: 0 };
      },
    });
    assert.deepEqual(killed, [11]);
  } finally { f.close(); }
});

test("rollback cannot kill a reused POSIX process group without a matching recorded process", async () => {
  const { stopReplacement } = require("../electron/update-worker.cjs");
  const f = fixture("linux");
  try {
    f.transaction.candidatePid = 10;
    f.transaction.candidateIdentity = "original-supervisor";
    fs.writeFileSync(path.join(f.transaction.root, "launched.json"), JSON.stringify({
      pid: 11, identity: "original-child", token: f.transaction.readyToken,
    }));
    let kills = 0;
    await assert.rejects(stopReplacement(f.transaction, {
      processAlive: () => true,
      processIdentity: () => "reused-identity",
      groupAlive: () => true,
      kill: () => { kills++; },
    }), /process-group identity/);
    assert.equal(kills, 0);
    assert.deepEqual(snapshot(f.target), f.original);
  } finally { f.close(); }
});

test("Windows rollback preserves recovery when authorization preceded an unrecorded child launch", async () => {
  const { stopReplacement } = require("../electron/update-worker.cjs");
  const f = fixture("win32");
  try {
    f.transaction.candidatePid = 10;
    f.transaction.candidateIdentity = "original-supervisor";
    fs.writeFileSync(path.join(f.transaction.root, "launch-authorized.json"), "{}");
    await assert.rejects(stopReplacement(f.transaction, { processAlive: () => false }), /child identity after launch authorization/);
    assert.deepEqual(snapshot(f.target), f.original);
  } finally { f.close(); }
});
