const { spawn } = require("node:child_process");
const { randomBytes } = require("node:crypto");
const { createInterface } = require("node:readline");
const {
  isLegacyConnectorName,
  requireCurrentRuntimeConnectorName,
} = require("./connector-identity.cjs");

const BROWSER_HELPER_OPERATION_TIMEOUT_MS = 90_000;
const helperScopes = new Map();
const childLifecycles = new WeakMap();

function trackChildLifecycle(child) {
  const lifecycle = { exited: child.exitCode !== null || child.signalCode !== null, closed: false };
  childLifecycles.set(child, lifecycle);
  child.once("exit", () => { lifecycle.exited = true; });
  child.once("close", () => { lifecycle.closed = true; });
  return lifecycle;
}

function childIsSettled(child) {
  const lifecycle = childLifecycles.get(child);
  return Boolean(lifecycle?.exited && lifecycle.closed);
}

function helperScopeFor(descriptorPath) {
  let scope = helperScopes.get(descriptorPath);
  if (!scope) {
    scope = { unsettledChildren: new Set(), tail: Promise.resolve(), pendingOperations: 0 };
    helperScopes.set(descriptorPath, scope);
  }
  return scope;
}

function releaseHelperScope(descriptorPath, scope) {
  if (scope.pendingOperations === 0
    && scope.unsettledChildren.size === 0
    && helperScopes.get(descriptorPath) === scope) {
    helperScopes.delete(descriptorPath);
  }
}

function reconcileUnsettledHelperChildren(scope) {
  for (const child of scope.unsettledChildren) {
    if (childIsSettled(child)) {
      scope.unsettledChildren.delete(child);
    }
  }
  if (scope.unsettledChildren.size > 0) {
    throw new Error("Browser helper verification cannot start while a previous helper process is still active");
  }
}

function waitForExit(child, timeoutMs) {
  const lifecycle = childLifecycles.get(child) ?? trackChildLifecycle(child);
  if (lifecycle.exited && lifecycle.closed) return Promise.resolve(true);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.off("exit", checkSettled);
      child.off("close", checkSettled);
      resolve(exited);
    };
    const checkSettled = () => {
      if (lifecycle.exited && lifecycle.closed) finish(true);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", checkSettled);
    child.once("close", checkSettled);
  });
}

function writeMessage(child, message) {
  if (child.exitCode !== null
    || child.signalCode !== null
    || child.stdin.destroyed
    || child.stdin.writableEnded) {
    return Promise.reject(new Error("Browser helper verification input is closed"));
  }
  return new Promise((resolve, reject) => {
    child.stdin.write(`${JSON.stringify(message)}\n`, (error) => error ? reject(error) : resolve());
  });
}

async function stopChild(child, unsettledChildren, scope) {
  if (childIsSettled(child)) return;
  // The input write itself may remain pending; the grace period starts when shutdown is requested.
  void writeMessage(child, { type: "shutdown" }).catch(() => {});
  if (await waitForExit(child, 5_000)) return;
  let signalError;
  try {
    if (!child.kill("SIGTERM")) signalError = new Error("Browser helper verification process refused SIGTERM");
  } catch (error) { signalError = error; }
  if (await waitForExit(child, 2_000)) return;
  try {
    if (!child.kill("SIGKILL")) signalError = new Error("Browser helper verification process refused SIGKILL");
  } catch (error) { signalError = error; }
  if (await waitForExit(child, 2_000)) return;
  // Keep the exact spawned handle reachable until its eventual exit; never target a PID by name.
  unsettledChildren.add(child);
  const release = () => {
    if (!childIsSettled(child)) return;
    unsettledChildren.delete(child);
    releaseHelperScope(scope.descriptorPath, scope);
  };
  child.once("exit", release);
  child.once("close", release);
  if (childIsSettled(child)) release();
  const error = new Error("Browser helper verification process exit was not observed after SIGKILL");
  if (signalError) error.cause = signalError;
  throw error;
}

async function runBrowserHelperOperationOnce({ helper, descriptorPath, appName, operation, payload = {}, logger }, scope) {
  if (!helper || typeof helper.executable !== "string" || typeof helper.script !== "string") {
    throw new Error("Browser helper verification command is invalid");
  }
  if (typeof descriptorPath !== "string" || !descriptorPath || typeof appName !== "string" || !appName) {
    throw new Error("Browser helper verification config is invalid");
  }
  if (!["verify", "inspect", "smoke"].includes(operation)) {
    throw new Error(`Unsupported browser helper operation: ${String(operation)}`);
  }
  // The helper proves the connector requested by the caller. A stale caller must not turn
  // a successful proof of a retired connector into acceptance of the current MCP schema.
  if (operation === "verify") requireCurrentRuntimeConnectorName(appName);
  const id = `${operation}-${randomBytes(12).toString("hex")}`;
  const child = spawn(helper.executable, [helper.script], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      CODEX_CHATGPT_WEB_BROWSER_HELPER_PROCESS: "1",
    },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
  trackChildLifecycle(child);
  let completed = false;
  let sent = false;
  let timer;
  const output = createInterface({ input: child.stdout });
  const errors = createInterface({ input: child.stderr });
  errors.on("line", (line) => logger?.info("browser.connector_helper", { message: line.slice(0, 2_000) }));

  const result = new Promise((resolve, reject) => {
    const finish = (error, value) => {
      if (completed) return;
      completed = true;
      if (timer) clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    };
    // A callback on write() does not consume the stream's separate `error` event. On Windows,
    // closing the helper's read side can therefore surface ERROR_BROKEN_PIPE/EOF as an uncaught
    // exception in Electron's main process even when the write promise is already handled.
    child.stdin.on("error", (error) => finish(
      error instanceof Error ? error : new Error(String(error)),
    ));
    child.stdout.on("error", (error) => finish(
      error instanceof Error ? error : new Error(String(error)),
    ));
    child.stderr.on("error", (error) => finish(
      error instanceof Error ? error : new Error(String(error)),
    ));
    output.on("line", (line) => {
      let message;
      try { message = JSON.parse(line); }
      catch {
        finish(new Error("Browser helper verification emitted invalid JSON"));
        return;
      }
      if (message?.type === "ready") {
        if (sent) {
          finish(new Error("Browser helper verification emitted duplicate readiness"));
          return;
        }
        sent = true;
        void writeMessage(child, {
          ...payload,
          type: operation,
          id,
          config: { appName, browserHostDescriptorPath: descriptorPath },
        }).catch(error => finish(error instanceof Error ? error : new Error(String(error))));
        return;
      }
      if (message?.id !== id) {
        finish(new Error("Browser helper verification response identity is invalid"));
        return;
      }
      if (message.type === "result") {
        finish(null, message);
        return;
      }
      if (message.type === "error" && typeof message.message === "string") {
        const helperError = new Error(message.message);
        if (typeof message.name === "string" && /^[A-Za-z][A-Za-z0-9]{0,79}$/.test(message.name)) {
          helperError.name = message.name;
        }
        finish(helperError);
        return;
      }
      finish(new Error("Browser helper verification emitted an unexpected message"));
    });
    child.once("error", (error) => finish(error));
    let exitError;
    child.once("exit", (code, signal) => {
      exitError = new Error(
        `Browser helper verification exited ${signal ? `from signal ${signal}` : `with status ${code ?? 1}`}`,
      );
    });
    // A final stdout line can be buffered between process exit and readline delivery.
    // Let the close boundary consume that line before treating exit as a failure.
    child.once("close", () => {
      if (!completed) finish(exitError ?? new Error("Browser helper verification exited unexpectedly"));
    });
    timer = setTimeout(
      () => finish(new Error(`Browser helper ${operation} timed out`)),
      BROWSER_HELPER_OPERATION_TIMEOUT_MS,
    );
  });

  let value;
  let primaryError;
  try {
    value = await result;
  } catch (error) {
    primaryError = error instanceof Error ? error : new Error(String(error));
  }
  try {
    await stopChild(child, scope.unsettledChildren, scope);
  } catch (cleanupError) {
    if (primaryError) {
      primaryError.cleanupError = cleanupError;
      primaryError.operationId = id;
      throw primaryError;
    }
    if (cleanupError instanceof Error) cleanupError.operationId = id;
    throw cleanupError;
  } finally {
    output.close();
    errors.close();
  }
  if (primaryError) {
    primaryError.operationId = id;
    throw primaryError;
  }
  return value;
}

async function runBrowserHelperOperation(options) {
  const descriptorPath = options?.descriptorPath;
  const scope = helperScopeFor(descriptorPath);
  scope.descriptorPath = descriptorPath;
  scope.pendingOperations += 1;
  const previousOperation = scope.tail;
  let releaseOperation;
  const operation = new Promise((resolve) => { releaseOperation = resolve; });
  scope.tail = operation;
  await previousOperation;
  try {
    reconcileUnsettledHelperChildren(scope);
    return await runBrowserHelperOperationOnce(options, scope);
  } finally {
    releaseOperation();
    scope.pendingOperations -= 1;
    releaseHelperScope(descriptorPath, scope);
  }
}

async function verifyConnectorWithBrowserHelper(options) {
  const message = await runBrowserHelperOperation({ ...options, operation: "verify" });
  if (message.text !== options.appName) {
    let error;
    if (isLegacyConnectorName(message.text)) {
      error = new Error(
        `Browser helper verified legacy ChatGPT connector ${JSON.stringify(message.text)};`
        + ` this verification requires ${JSON.stringify(options.appName)}. Create the new connector`
        + ` against the current tunnel and leave the legacy connector unchanged.`,
      );
    } else {
      error = new Error(`Browser helper did not verify required ChatGPT connector ${JSON.stringify(options.appName)}`);
    }
    error.operationId = message.id;
    throw error;
  }
  return { ok: true, appName: options.appName };
}

module.exports = { runBrowserHelperOperation, verifyConnectorWithBrowserHelper };
