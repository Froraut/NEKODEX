const path = require("node:path");
const { spawn } = require("node:child_process");
const { DETACH_OWNED_CHILD } = require("./process-tree.cjs");
const { processIdentity } = require("./update-recovery.cjs");
const { abortReason, throwIfAborted } = require("./update-abort.cjs");

const EXTRACTION_STDERR_LIMIT = 1024 * 1024;
const EXTRACTION_FORCE_KILL_MS = 3_000;
const EXTRACTION_EXIT_PROOF_MS = 15_000;

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

function processGroupAlive(pid) {
  try { process.kill(-pid, 0); return true; }
  catch (error) { return error?.code !== "ESRCH"; }
}

function unprovenExtractionExit(reason, detail) {
  return Object.assign(new Error(`Extractor cancellation could not prove that its process tree exited: ${detail}`), {
    code: "UPDATE_EXTRACTION_EXIT_UNPROVEN",
    cause: reason,
    preserveStaging: true,
  });
}

function taskkillPath(env = process.env) {
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || "C:\\Windows";
  if (typeof systemRoot !== "string" || !path.win32.isAbsolute(systemRoot)
    || /[\x00-\x1f\x7f]/.test(systemRoot)) {
    throw new Error("Windows SystemRoot is invalid for updater process-tree termination");
  }
  return path.win32.join(systemRoot, "System32", "taskkill.exe");
}

function runOwnedCommand(command, args, {
  cwd,
  env,
  signal,
  timeoutMs,
  failureMessage,
  windowsHide = true,
} = {}) {
  throwIfAborted(signal);
  return new Promise((resolve, reject) => {
    let child;
    let stderr = "";
    let settled = false;
    let spawned = false;
    let childIdentity = null;
    let closeObserved = false;
    let runtimeError = null;
    let termination = null;
    let timeout;
    let resolveSpawn;
    let rejectSpawn;
    const spawnReady = new Promise((resolveSpawnPromise, rejectSpawnPromise) => {
      resolveSpawn = resolveSpawnPromise;
      rejectSpawn = rejectSpawnPromise;
    });
    void spawnReady.catch(() => {});
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", cancel);
      if (error) reject(error);
      else resolve();
    };
    const exactChildAlive = () => Boolean(
      childIdentity && processIdentity(child.pid) === childIdentity,
    );
    const taskkillTree = () => new Promise(resolveTaskkill => {
      const killer = spawn(taskkillPath(), ["/PID", String(child.pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
      let done = false;
      let spawned = false;
      let killerIdentity = null;
      let runtimeError = null;
      let timeoutError = null;
      let killerTimeout;
      const complete = error => {
        if (done) return;
        done = true;
        clearTimeout(killerTimeout);
        resolveTaskkill(error || null);
      };
      killer.once("spawn", () => {
        spawned = true;
        killerIdentity = processIdentity(killer.pid);
      });
      killer.once("error", error => {
        if (!spawned) { complete(error); return; }
        // A post-spawn error does not prove that the taskkill helper exited.
        runtimeError = error;
      });
      killer.once("close", code => complete(
        timeoutError || runtimeError || (code === 0 ? null : new Error(`taskkill exited with status ${code}`)),
      ));
      killerTimeout = setTimeout(async () => {
        timeoutError = new Error("taskkill exceeded its time limit");
        try {
          if (killerIdentity && processIdentity(killer.pid) === killerIdentity) killer.kill("SIGKILL");
        } catch (error) {
          runtimeError = error;
        }
        // Do not start another taskkill while this helper may still be alive. Prefer
        // close; if it is lost, accept only exact PID/start-identity disappearance.
        await delay(5_000);
        if (done) return;
        const observedIdentity = processIdentity(killer.pid);
        // A failed identity probe returns null too; it is not evidence of exit.
        let absent = false;
        try { process.kill(killer.pid, 0); } catch (error) { absent = error?.code === "ESRCH"; }
        const helperExited = absent || Boolean(killerIdentity && observedIdentity
          && observedIdentity !== killerIdentity);
        if (helperExited) {
          complete(timeoutError);
          return;
        }
        complete(Object.assign(new Error("taskkill helper exit could not be proven after timeout"), {
          code: "UPDATE_TASKKILL_EXIT_UNPROVEN",
          cause: runtimeError || timeoutError,
          taskkillExitUnproven: true,
          preserveStaging: true,
        }));
      }, 5_000);
      killerTimeout.unref?.();
    });
    const terminateTree = async (reason) => {
      try { await spawnReady; }
      catch {
        // Spawn failure proves that no extractor process was created.
        return reason;
      }
      const identityDeadline = Date.now() + 1_000;
      while (!childIdentity && !closeObserved && Date.now() < identityDeadline) {
        childIdentity = processIdentity(child.pid);
        if (!childIdentity) await delay(50);
      }
      if (!childIdentity && !closeObserved) {
        return unprovenExtractionExit(reason, "the exact child identity was unavailable");
      }
      if (!closeObserved && !exactChildAlive()) {
        return unprovenExtractionExit(reason, "the extractor process identity changed before termination");
      }

      const startedAt = Date.now();
      let lastTerminationError = null;
      let windowsTreeProven = false;
      if (process.platform === "win32") {
        if (exactChildAlive()) {
          lastTerminationError = await taskkillTree();
          if (lastTerminationError?.taskkillExitUnproven) {
            return unprovenExtractionExit(reason, lastTerminationError.message);
          }
          windowsTreeProven = lastTerminationError === null;
        }
      } else if (processGroupAlive(child.pid)) {
        try { process.kill(-child.pid, "SIGTERM"); }
        catch (error) { if (error?.code !== "ESRCH") lastTerminationError = error; }
      }

      let forced = false;
      while (Date.now() - startedAt < EXTRACTION_EXIT_PROOF_MS) {
        const treeAlive = process.platform === "win32" ? !closeObserved : processGroupAlive(child.pid);
        const treeExitProven = process.platform === "win32"
          ? windowsTreeProven
          : !treeAlive;
        if (closeObserved && treeExitProven) return reason;
        if (!forced && Date.now() - startedAt >= EXTRACTION_FORCE_KILL_MS) {
          forced = true;
          if (process.platform === "win32") {
            if (!windowsTreeProven && exactChildAlive()) {
              lastTerminationError = await taskkillTree();
              if (lastTerminationError?.taskkillExitUnproven) {
                return unprovenExtractionExit(reason, lastTerminationError.message);
              }
              windowsTreeProven = lastTerminationError === null;
            }
          } else if (processGroupAlive(child.pid)) {
            try { process.kill(-child.pid, "SIGKILL"); }
            catch (error) { if (error?.code !== "ESRCH") lastTerminationError = error; }
          }
        }
        await delay(100);
      }
      const detail = lastTerminationError instanceof Error
        ? lastTerminationError.message
        : closeObserved ? "a descendant process remains" : "the extractor close event was not observed";
      return unprovenExtractionExit(reason, detail);
    };
    const beginTermination = reason => {
      if (termination || settled) return;
      termination = terminateTree(reason).then(finish, error => finish(
        unprovenExtractionExit(reason, error instanceof Error ? error.message : String(error)),
      ));
    };
    const cancel = () => beginTermination(abortReason(signal));
    try {
      child = spawn(command, args, {
        cwd,
        env,
        windowsHide,
        // A dedicated POSIX process group lets cancellation own every extractor
        // descendant without touching the launcher or unrelated applications.
        detached: DETACH_OWNED_CHILD,
        stdio: ["ignore", "ignore", "pipe"],
      });
    } catch (error) {
      rejectSpawn(error);
      finish(error);
      return;
    }
    child.stderr?.on("data", chunk => {
      if (stderr.length < EXTRACTION_STDERR_LIMIT) {
        stderr += String(chunk).slice(0, EXTRACTION_STDERR_LIMIT - stderr.length);
      }
    });
    child.once("spawn", () => {
      spawned = true;
      childIdentity = processIdentity(child.pid);
      resolveSpawn();
      if (signal?.aborted) cancel();
    });
    child.once("error", error => {
      if (!spawned) {
        rejectSpawn(error);
        if (!termination) finish(error);
        return;
      }
      // A post-spawn error (including a failed kill request) does not prove exit.
      // Preserve it for the close/ownership result below.
      runtimeError = error;
    });
    child.once("close", (code, childSignal) => {
      closeObserved = true;
      if (termination) return;
      if (process.platform !== "win32" && processGroupAlive(child.pid)) {
        beginTermination(new Error("Extractor exited while an owned descendant process remained"));
        return;
      }
      if (runtimeError) { finish(runtimeError); return; }
      if (code !== 0) {
        const detail = stderr.trim();
        finish(new Error(`${failureMessage} (${childSignal || `status ${code}`})${detail ? `: ${detail}` : ""}`));
        return;
      }
      finish();
    });
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    timeout = setTimeout(() => beginTermination(new Error(`${failureMessage}: extraction exceeded its time limit`)), timeoutMs);
    timeout.unref?.();
  });
}

module.exports = { runOwnedCommand };
