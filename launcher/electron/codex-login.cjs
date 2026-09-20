const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { validateAccountId } = require("./account-registry.cjs");
const {
  DETACH_OWNED_CHILD,
  terminateOwnedProcessTree,
} = require("./process-tree.cjs");

const OFFICIAL_DEVICE_VERIFICATION_URL = "https://auth.openai.com/codex/device";
const DEFAULT_LOGIN_TIMEOUT_MS = 10 * 60_000;
const STARTUP_TIMEOUT_MS = 15_000;
const RPC_TIMEOUT_MS = 15_000;
const STOP_GRACE_MS = 1_000;
const KILL_GRACE_MS = 2_000;
const MAX_RPC_LINE_CHARS = 1024 * 1024;
const USER_CODE_PATTERN = /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){1,2}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const ACTIVE_PHASES = new Set(["starting", "waiting", "cancelling", "confirming"]);
const PLAN_TYPES = new Set([
  "free", "go", "plus", "pro", "prolite", "team",
  "self_serve_business_prolite", "self_serve_business_usage_based", "business",
  "ent26", "enterprise_cbp_automation", "enterprise_cbp_usage_based", "enterprise",
  "edu", "edu_plus", "edu_pro", "unknown",
]);
const MAX_ACCOUNT_EMAIL_LENGTH = 320;

function executableFile(filename) {
  try {
    const real = fs.realpathSync(filename);
    const stat = fs.statSync(real);
    fs.accessSync(real, fs.constants.X_OK);
    return stat.isFile();
  } catch {
    return false;
  }
}

function codexExecutableCandidates({
  explicitPath,
  environment = process.env,
  homeDir = os.homedir(),
  platform = process.platform,
} = {}) {
  const executableName = platform === "win32" ? "codex.exe" : "codex";
  const delimiter = platform === "win32" ? ";" : ":";
  const candidates = [];
  if (explicitPath?.trim()) candidates.push(explicitPath.trim());
  if (platform === "darwin") {
    // The desktop bundle is preferred because this controller implements the
    // same public account/login app-server protocol used by Codex Desktop.
    candidates.push(
      "/Applications/ChatGPT.app/Contents/Resources/codex",
      path.join(homeDir, "Applications", "ChatGPT.app", "Contents", "Resources", "codex"),
      "/Applications/Codex.app/Contents/Resources/codex",
      path.join(homeDir, "Applications", "Codex.app", "Contents", "Resources", "codex"),
    );
  }
  for (const entry of String(environment.PATH || environment.Path || "").split(delimiter)) {
    const directory = entry.trim().replace(/^"(.*)"$/, "$1");
    if (directory) candidates.push(path.join(directory, executableName));
  }
  candidates.push(
    path.join(homeDir, ".local", "bin", executableName),
    path.join(homeDir, ".codex", "packages", "standalone", "current", "bin", executableName),
  );
  if (platform === "darwin") candidates.push(
    path.join("/opt/homebrew/bin", executableName),
    path.join("/usr/local/bin", executableName),
  );
  return [...new Set(candidates.map(candidate => path.resolve(candidate)))];
}

function resolveCodexExecutable(options = {}) {
  const candidates = codexExecutableCandidates(options);
  const executable = candidates.find(executableFile);
  if (executable) return executable;
  const error = new Error("Official Codex executable was not found");
  error.code = "codex_not_found";
  error.checked = candidates;
  throw error;
}

function validateDeviceLoginResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || value.type !== "chatgptDeviceCode"
    || typeof value.loginId !== "string" || !UUID_PATTERN.test(value.loginId)
    || value.verificationUrl !== OFFICIAL_DEVICE_VERIFICATION_URL
    || typeof value.userCode !== "string" || !USER_CODE_PATTERN.test(value.userCode)) {
    const error = new Error("Codex returned an invalid device authorization response");
    error.code = "invalid_device_response";
    throw error;
  }
  return {
    loginId: value.loginId,
    verificationUrl: value.verificationUrl,
    userCode: value.userCode,
  };
}

function validateCancelLoginResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || !["canceled", "notFound"].includes(value.status)) {
    const error = new Error("Official Codex returned an invalid login cancellation response");
    error.code = "invalid_cancel_response";
    throw error;
  }
  return { status: value.status };
}

function validateAccountReadResponse(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)
    || typeof value.requiresOpenaiAuth !== "boolean") {
    const error = new Error("Official Codex returned an invalid account response");
    error.code = "invalid_account_response";
    throw error;
  }
  const account = value.account;
  if (account === null) {
    return { account: null, requiresOpenaiAuth: value.requiresOpenaiAuth };
  }
  if (!account || typeof account !== "object" || Array.isArray(account)
    || account.type !== "chatgpt"
    || (account.email !== null && (typeof account.email !== "string"
      || !account.email || account.email.length > MAX_ACCOUNT_EMAIL_LENGTH
      || /[\u0000-\u001f\u007f]/.test(account.email)))
    || !PLAN_TYPES.has(account.planType)) {
    const error = new Error("Official Codex did not confirm a ChatGPT account");
    error.code = "account_confirmation_failed";
    throw error;
  }
  return {
    account: { type: "chatgpt", email: account.email, planType: account.planType },
    requiresOpenaiAuth: value.requiresOpenaiAuth,
  };
}

function waitForChildClose(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("close", closed);
      resolve(value);
    };
    const closed = () => finish(true);
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("close", closed);
  });
}

async function stopOwnedChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (child.stdin && !child.stdin.destroyed && !child.stdin.writableEnded) child.stdin.end();
  if (await waitForChildClose(child, STOP_GRACE_MS)) return;
  try { terminateOwnedProcessTree(child, "SIGTERM"); } catch { /* Retry below with the exact owned tree. */ }
  if (await waitForChildClose(child, KILL_GRACE_MS)) return;
  terminateOwnedProcessTree(child, "SIGKILL");
  await waitForChildClose(child, KILL_GRACE_MS);
}

function childEnvironment(codexHome, environment = process.env) {
  const result = { ...environment, CODEX_HOME: codexHome };
  // The requested operation is a user-confirmed managed ChatGPT login. Do not
  // let inherited automation credentials silently select another auth method.
  for (const key of Object.keys(result)) {
    if (["OPENAI_API_KEY", "CODEX_API_KEY", "CODEX_ACCESS_TOKEN"]
      .includes(key.toUpperCase())) delete result[key];
  }
  return result;
}

function publicError(code) {
  const messages = {
    cancelled: "Codex login was cancelled",
    cancel_outcome_uncertain: "Codex could not prove whether login completed before cancellation; confirm the current CLI account",
    login_timed_out: "Codex login timed out",
    official_login_failed: "Official Codex login did not complete",
    codex_process_failed: "Official Codex account service stopped unexpectedly",
    account_confirmation_failed: "Codex login completed, but the current CLI account could not be confirmed",
    invalid_device_response: "Official Codex returned an invalid device login response",
    account_ownership_changed: "The bound NEKODEX account changed during device login; confirm the current CLI account before using it",
    startup_failed: "Official Codex account service could not start",
  };
  return { code, message: messages[code] || messages.official_login_failed };
}

function createCodexLoginController({
  codexHome,
  codexPath,
  isAccountCurrent,
  getSelectedAccountId,
  logger,
  environment = process.env,
  homeDir = os.homedir(),
  platform = process.platform,
  spawnProcess = spawn,
  loginTimeoutMs = DEFAULT_LOGIN_TIMEOUT_MS,
} = {}) {
  if (typeof codexHome !== "string" || !path.isAbsolute(codexHome)) {
    throw new TypeError("Codex login requires an absolute trusted codexHome");
  }
  if (typeof isAccountCurrent !== "function" && typeof getSelectedAccountId !== "function") {
    throw new TypeError("Codex login requires an account-currentness lease");
  }
  if (!Number.isInteger(loginTimeoutMs) || loginTimeoutMs < 60_000
    || loginTimeoutMs > DEFAULT_LOGIN_TIMEOUT_MS) {
    throw new TypeError("Codex login timeout must be between one and ten minutes");
  }

  let flow = null;

  function ownershipCurrent(accountId) {
    validateAccountId(accountId);
    if (typeof isAccountCurrent === "function") {
      const current = isAccountCurrent(accountId);
      if (typeof current !== "boolean") {
        throw new TypeError("isAccountCurrent must return a boolean");
      }
      return current;
    }
    return validateAccountId(getSelectedAccountId()) === accountId;
  }

  function requireFlow(flowId, accountId) {
    validateAccountId(accountId);
    if (!flow || flow.flowId !== flowId || flow.accountId !== accountId) {
      const error = new Error("Codex login flow does not belong to this account");
      error.code = "login_owner_mismatch";
      throw error;
    }
    return flow;
  }

  function snapshot(current, { revealDeviceCode = true } = {}) {
    if (!current) return null;
    const ownerCurrent = ownershipCurrent(current.accountId);
    const reveal = revealDeviceCode && ownerCurrent && current.phase === "waiting";
    const active = ACTIVE_PHASES.has(current.phase);
    return {
      flowId: current.flowId,
      accountId: current.accountId,
      phase: current.phase,
      active,
      startedAt: current.startedAt,
      deadlineAt: current.deadlineAt,
      completedAt: current.completedAt,
      ownershipCurrent: ownerCurrent,
      canOpen: reveal,
      canCancel: current.phase === "starting" || current.phase === "waiting",
      verificationUrl: reveal ? current.verificationUrl : null,
      userCode: reveal ? current.userCode : null,
      error: current.error,
      scope: "shared-codex-auth-store",
      authOutcome: current.authOutcome,
      cancelStatus: current.cancelStatus,
      actualAccount: current.actualAccount ? { ...current.actualAccount } : null,
      requiresOpenaiAuth: current.requiresOpenaiAuth,
      requiresIdentityConfirmation: current.requiresIdentityConfirmation,
      desktopAccountChange: "not_performed",
      selectionLock: active ? { flowId: current.flowId, accountId: current.accountId } : null,
    };
  }

  function selectionLock() {
    if (!flow || !ACTIVE_PHASES.has(flow.phase)) return null;
    return Object.freeze({ flowId: flow.flowId, accountId: flow.accountId, phase: flow.phase });
  }

  function setPhase(current, phase, patch = {}) {
    if (flow !== current) return;
    Object.assign(current, patch, { phase });
    if (!ACTIVE_PHASES.has(phase)) clearTimeout(current.timer);
    logger?.info?.("codex.login_phase", { phase, accountId: current.accountId });
  }

  function fail(current, code) {
    if (flow !== current || !ACTIVE_PHASES.has(current.phase)) return;
    setPhase(current, "failed", {
      completedAt: new Date().toISOString(),
      error: publicError(code),
      authOutcome: "not_completed",
      verificationUrl: null,
      userCode: null,
    });
    void stopOwnedChild(current.child).catch(() => {});
  }

  function send(current, method, params = {}, timeoutMs = RPC_TIMEOUT_MS) {
    if (current.child.exitCode !== null || current.child.signalCode !== null
      || current.child.stdin.destroyed || current.child.stdin.writableEnded) {
      return Promise.reject(Object.assign(new Error("Codex account service is closed"), {
        code: "codex_process_failed",
      }));
    }
    const id = current.nextRpcId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        current.pending.delete(id);
        const error = new Error("Codex account request timed out");
        error.code = "rpc_timeout";
        reject(error);
      }, timeoutMs);
      current.pending.set(id, {
        resolve: value => { clearTimeout(timer); resolve(value); },
        reject: error => { clearTimeout(timer); reject(error); },
      });
      current.child.stdin.write(`${JSON.stringify({ id, method, params })}\n`, error => {
        if (!error) return;
        const pending = current.pending.get(id);
        if (!pending) return;
        current.pending.delete(id);
        pending.reject(Object.assign(new Error("Codex account request could not be sent"), {
          code: "codex_process_failed",
        }));
      });
    });
  }

  function notify(current, method, params = {}) {
    if (current.child.exitCode !== null || current.child.signalCode !== null
      || current.child.stdin.destroyed || current.child.stdin.writableEnded) return;
    current.child.stdin.write(`${JSON.stringify({ method, params })}\n`, () => {});
  }

  async function reconcileAccount(current, { committed, reasonCode = null } = {}) {
    if (committed) {
      current.committedObserved = true;
      current.authOutcome = "committed_identity_pending";
    }
    if (reasonCode === "account_ownership_changed" || !current.reconcileReason) {
      current.reconcileReason = reasonCode;
    }
    if (current.reconcilePromise) return current.reconcilePromise;
    clearTimeout(current.timer);
    setPhase(current, "confirming", {
      error: null,
      authOutcome: committed ? "committed_identity_pending" : "uncertain",
      verificationUrl: null,
      userCode: null,
      requiresIdentityConfirmation: true,
    });
    let reconciliation;
    reconciliation = (async () => {
      try {
        const result = validateAccountReadResponse(await send(current, "account/read", {
          refreshToken: false,
        }));
        if (flow !== current) return null;
        const completionCommitted = current.committedObserved === true;
        const effectiveReason = current.reconcileReason;
        const ownershipChanged = !ownershipCurrent(current.accountId);
        const finalReason = ownershipChanged ? "account_ownership_changed" : effectiveReason;
        if (result.account === null) {
          setPhase(current, "needs-confirmation", {
            completedAt: new Date().toISOString(),
            error: publicError(current.cancellationRequested || finalReason
              ? (finalReason || "cancel_outcome_uncertain") : "account_confirmation_failed"),
            authOutcome: current.cancellationRequested ? "uncertain" : "committed_identity_unverified",
            actualAccount: null,
            requiresOpenaiAuth: result.requiresOpenaiAuth,
            requiresIdentityConfirmation: true,
          });
          return snapshot(current, { revealDeviceCode: false });
        }
        const needsConfirmation = !completionCommitted || finalReason !== null;
        setPhase(current, needsConfirmation ? "needs-confirmation" : "completed", {
          completedAt: new Date().toISOString(),
          error: needsConfirmation ? publicError(finalReason || "cancel_outcome_uncertain") : null,
          authOutcome: completionCommitted ? "committed" : "uncertain",
          actualAccount: result.account,
          requiresOpenaiAuth: result.requiresOpenaiAuth,
          requiresIdentityConfirmation: true,
        });
      } catch {
        if (flow === current) {
          const completionCommitted = current.committedObserved === true;
          const effectiveReason = !ownershipCurrent(current.accountId)
            ? "account_ownership_changed" : current.reconcileReason;
          setPhase(current, "needs-confirmation", {
            completedAt: new Date().toISOString(),
            error: publicError(effectiveReason || (completionCommitted
              ? "account_confirmation_failed" : "cancel_outcome_uncertain")),
            authOutcome: completionCommitted && !current.cancellationRequested
              ? "committed_identity_unverified" : "uncertain",
            actualAccount: null,
            requiresOpenaiAuth: null,
            requiresIdentityConfirmation: true,
          });
        }
      } finally {
        await stopOwnedChild(current.child).catch(() => {});
      }
      return snapshot(current, { revealDeviceCode: false });
    })().finally(() => {
      if (current.reconcilePromise === reconciliation) current.reconcilePromise = null;
    });
    current.reconcilePromise = reconciliation;
    return reconciliation;
  }

  async function cancelFlow(current, reasonCode = "cancelled") {
    if (flow !== current) return null;
    if (!ACTIVE_PHASES.has(current.phase)) {
      return snapshot(current, { revealDeviceCode: false });
    }
    current.cancellationRequested = true;
    if (current.phase === "confirming") {
      return reconcileAccount(current, {
        committed: current.committedObserved === true,
        reasonCode: reasonCode === "cancelled" ? null : reasonCode,
      });
    }
    clearTimeout(current.timer);
    setPhase(current, "cancelling", {
      error: null,
      verificationUrl: null,
      userCode: null,
    });
    if (!current.loginId) {
      setPhase(current, "cancelled", {
        completedAt: new Date().toISOString(),
        error: reasonCode === "cancelled" ? null : publicError(reasonCode),
        authOutcome: "not_completed",
        cancelStatus: null,
        requiresIdentityConfirmation: false,
      });
      await stopOwnedChild(current.child);
      return snapshot(current, { revealDeviceCode: false });
    }

    let response;
    try {
      response = validateCancelLoginResponse(await send(current, "account/login/cancel", {
        loginId: current.loginId,
      }));
    } catch {
      return reconcileAccount(current, { committed: false, reasonCode: reasonCode === "cancelled"
        ? "cancel_outcome_uncertain" : reasonCode });
    }
    if (current.reconcilePromise) return current.reconcilePromise;
    if (current.phase !== "cancelling") {
      return snapshot(current, { revealDeviceCode: false });
    }
    current.cancelStatus = response.status;
    if (response.status === "notFound") {
      return reconcileAccount(current, { committed: false, reasonCode: reasonCode === "cancelled"
        ? "cancel_outcome_uncertain" : reasonCode });
    }
    setPhase(current, "cancelled", {
      completedAt: new Date().toISOString(),
      error: reasonCode === "cancelled" ? null : publicError(reasonCode),
      authOutcome: "cancelled",
      requiresIdentityConfirmation: false,
    });
    await stopOwnedChild(current.child);
    return snapshot(current, { revealDeviceCode: false });
  }

  function handleMessage(current, line) {
    if (!line || flow !== current) return;
    if (line.length > MAX_RPC_LINE_CHARS) {
      fail(current, "codex_process_failed");
      return;
    }
    let message;
    try { message = JSON.parse(line); }
    catch { fail(current, "codex_process_failed"); return; }
    if (!message || typeof message !== "object" || Array.isArray(message)) {
      fail(current, "codex_process_failed");
      return;
    }
    if (Number.isInteger(message.id)) {
      const pending = current.pending.get(message.id);
      if (!pending) return;
      current.pending.delete(message.id);
      if (message.error) {
        const error = new Error("Official Codex account request failed");
        error.code = "codex_rpc_error";
        pending.reject(error);
      } else pending.resolve(message.result);
      return;
    }
    if (message.method !== "account/login/completed" || message.params?.loginId !== current.loginId) return;
    if (message.params.success === true
      && ["waiting", "cancelling", "confirming"].includes(current.phase)) {
      const reasonCode = !ownershipCurrent(current.accountId)
        ? "account_ownership_changed"
        : current.phase === "cancelling" ? "cancel_outcome_uncertain" : null;
      void reconcileAccount(current, { committed: true, reasonCode });
    } else if (message.params.success !== true && current.phase === "cancelling") {
      void reconcileAccount(current, { committed: false, reasonCode: "cancel_outcome_uncertain" });
    } else fail(current, "official_login_failed");
  }

  function consumeOutput(current, chunk) {
    if (flow !== current) return;
    current.rpcBuffer += chunk;
    if (current.rpcBuffer.length > MAX_RPC_LINE_CHARS
      && !current.rpcBuffer.includes("\n")) {
      current.rpcBuffer = "";
      fail(current, "codex_process_failed");
      return;
    }
    for (;;) {
      const newline = current.rpcBuffer.indexOf("\n");
      if (newline < 0) return;
      const line = current.rpcBuffer.slice(0, newline).trim();
      current.rpcBuffer = current.rpcBuffer.slice(newline + 1);
      handleMessage(current, line);
      if (flow !== current || current.rpcBuffer.length > MAX_RPC_LINE_CHARS) {
        current.rpcBuffer = "";
        if (flow === current) fail(current, "codex_process_failed");
        return;
      }
    }
  }

  async function start({ accountId, confirmed } = {}) {
    validateAccountId(accountId);
    if (confirmed !== true) {
      const error = new Error("User confirmation is required before starting Codex device login");
      error.code = "confirmation_required";
      throw error;
    }
    if (!ownershipCurrent(accountId)) {
      const error = new Error("Codex login requires a current lease for the requested NEKODEX account");
      error.code = "account_ownership_changed";
      throw error;
    }
    if (flow && ACTIVE_PHASES.has(flow.phase)) {
      const error = new Error("Another Codex login is already active");
      error.code = "login_in_progress";
      throw error;
    }
    if (flow?.child) await stopOwnedChild(flow.child);

    const executable = resolveCodexExecutable({
      explicitPath: codexPath, environment, homeDir, platform,
    });
    const now = Date.now();
    const current = {
      flowId: randomUUID(), accountId, executable,
      phase: "starting", startedAt: new Date(now).toISOString(),
      deadlineAt: new Date(now + loginTimeoutMs).toISOString(), completedAt: null,
      verificationUrl: null, userCode: null, loginId: null, error: null,
      authOutcome: "pending", cancelStatus: null, actualAccount: null,
      requiresOpenaiAuth: null, requiresIdentityConfirmation: false,
      committedObserved: false, reconcileReason: null, cancellationRequested: false,
      child: null, pending: new Map(), nextRpcId: 1, timer: null, rpcBuffer: "",
      reconcilePromise: null,
    };
    flow = current;
    logger?.info?.("codex.login_phase", { phase: "starting", accountId });

    try {
      fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
      const child = spawnProcess(executable, ["app-server", "--stdio"], {
        cwd: codexHome,
        env: childEnvironment(codexHome, environment),
        detached: DETACH_OWNED_CHILD,
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true,
      });
      current.child = child;
      child.stderr.on("data", () => {}); // Drain and discard; login output may contain private data.
      child.stderr.on("error", () => {});
      child.stdin.on("error", () => fail(current, "codex_process_failed"));
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", chunk => consumeOutput(current, chunk));
      child.stdout.on("error", () => fail(current, "codex_process_failed"));
      child.once("close", () => {
        current.rpcBuffer = "";
        for (const pending of current.pending.values()) {
          pending.reject(Object.assign(new Error("Codex account service stopped"), {
            code: "codex_process_failed",
          }));
        }
        current.pending.clear();
        if (flow === current && ACTIVE_PHASES.has(current.phase)) fail(current, "codex_process_failed");
      });
      child.once("error", () => fail(current, "startup_failed"));
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(Object.assign(new Error("Codex account service did not start"), {
          code: "startup_failed",
        })), STARTUP_TIMEOUT_MS);
        child.once("spawn", () => { clearTimeout(timer); resolve(); });
        child.once("error", () => { clearTimeout(timer); reject(Object.assign(new Error("Codex account service did not start"), {
          code: "startup_failed",
        })); });
      });
      if (flow !== current || current.phase !== "starting") {
        return snapshot(current, { revealDeviceCode: false });
      }
      await send(current, "initialize", {
        clientInfo: { name: "nekodex", title: "NEKODEX", version: "1" },
        capabilities: { experimentalApi: true },
      });
      if (flow !== current || current.phase !== "starting") {
        return snapshot(current, { revealDeviceCode: false });
      }
      notify(current, "initialized");
      const loginResult = await send(
        current,
        "account/login/start",
        { type: "chatgptDeviceCode" },
      );
      if (flow !== current || current.phase !== "starting") {
        return snapshot(current, { revealDeviceCode: false });
      }
      const response = validateDeviceLoginResponse(loginResult);
      Object.assign(current, response);
      if (!ownershipCurrent(accountId)) {
        return await cancelFlow(current, "account_ownership_changed");
      }
      setPhase(current, "waiting");
      current.timer = setTimeout(() => {
        if (flow !== current || !ACTIVE_PHASES.has(current.phase)) return;
        void cancelFlow(current, "login_timed_out");
      }, loginTimeoutMs);
      return snapshot(current);
    } catch (error) {
      if (flow !== current || ["cancelled", "completed", "needs-confirmation"].includes(current.phase)) {
        return snapshot(current, { revealDeviceCode: false });
      }
      const code = ["invalid_device_response", "account_ownership_changed", "startup_failed"]
        .includes(error?.code) ? error.code
        : ["codex_rpc_error", "rpc_timeout"].includes(error?.code) ? "official_login_failed"
        : "startup_failed";
      fail(current, code);
      throw Object.assign(new Error(publicError(code).message), { code });
    }
  }

  function status({ flowId, accountId } = {}) {
    const current = requireFlow(flowId, accountId);
    if (ACTIVE_PHASES.has(current.phase) && !ownershipCurrent(current.accountId)) {
      void cancelFlow(current, "account_ownership_changed");
    }
    return snapshot(current);
  }

  async function reconcileOwnership() {
    if (!flow || !ACTIVE_PHASES.has(flow.phase) || ownershipCurrent(flow.accountId)) {
      return snapshot(flow, { revealDeviceCode: false });
    }
    return cancelFlow(flow, "account_ownership_changed");
  }

  async function cancel({ flowId, accountId } = {}) {
    return cancelFlow(requireFlow(flowId, accountId));
  }

  async function destroy() {
    if (!flow) return;
    if (ACTIVE_PHASES.has(flow.phase)) await cancelFlow(flow);
    await stopOwnedChild(flow.child);
  }

  return Object.freeze({ start, status, cancel, destroy, selectionLock, reconcileOwnership });
}

module.exports = {
  DEFAULT_LOGIN_TIMEOUT_MS,
  OFFICIAL_DEVICE_VERIFICATION_URL,
  codexExecutableCandidates,
  createCodexLoginController,
  resolveCodexExecutable,
  validateAccountReadResponse,
  validateCancelLoginResponse,
  validateDeviceLoginResponse,
};
