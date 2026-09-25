import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { assertExpectedLauncherProfile, readLauncherBrowserHostDescriptor, type LauncherBrowserHostDescriptor, type LauncherBrowserHostProfile } from "./launcher-browser-descriptor";

// Compatibility facade: retain one constructor identity and existing consumer imports.
export * from "./launcher-browser-descriptor";
export * from "./launcher-browser-errors";
export * from "./launcher-browser-control";

export interface LauncherBrowserConnection {
  descriptor: LauncherBrowserHostDescriptor;
  browser: Browser;
  context: BrowserContext;
  page: Page;
}

function launcherConnectionAborted(): DOMException {
  return new DOMException("Launcher browser connection aborted", "AbortError");
}

/** CDP methods do not accept AbortSignal and can remain pending after their caller times out. */
function boundedLauncherOperation<T>(
  operation: Promise<T>,
  deadline: number,
  signal?: AbortSignal,
  releaseLateResult?: (value: T) => void,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const abort = () => fail(launcherConnectionAborted());
    const timer = setTimeout(() => fail(new Error("Launcher browser acquisition timed out")),
      Math.max(0, deadline - Date.now()));
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    operation.then(value => {
      if (settled) {
        releaseLateResult?.(value);
        return;
      }
      settled = true;
      cleanup();
      resolve(value);
    }, fail);
  });
}

async function assertCdpReady(
  descriptor: LauncherBrowserHostDescriptor,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  abortSignal?.addEventListener("abort", abort, { once: true });
  if (abortSignal?.aborted) abort();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${descriptor.endpoint}/json/version`, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const body = await response.json() as Record<string, unknown>;
    if (typeof body.webSocketDebuggerUrl !== "string" || !body.webSocketDebuggerUrl.startsWith("ws://127.0.0.1:")) {
      throw new Error("CDP metadata did not expose a loopback WebSocket endpoint");
    }
  } catch (error) {
    if (abortSignal?.aborted) throw launcherConnectionAborted();
    throw new Error(`Launcher browser CDP endpoint is not ready: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener("abort", abort);
  }
}

export async function inspectLauncherBrowserHostLiveness(
  descriptorPath: string,
  options: {
    expectedProfile?: LauncherBrowserHostProfile;
    timeoutMs?: number;
  } = {},
): Promise<LauncherBrowserHostDescriptor> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  assertExpectedLauncherProfile(descriptor, options.expectedProfile);
  await assertCdpReady(descriptor, options.timeoutMs ?? 5_000);
  return descriptor;
}

export async function selectLauncherPage(
  browser: Browser,
  descriptor: LauncherBrowserHostDescriptor,
  timeoutMs: number,
  surfaceId = descriptor.surfaceId,
  abortSignal?: AbortSignal,
): Promise<{ context: BrowserContext; page: Page }> {
  if (abortSignal?.aborted) {
    throw launcherConnectionAborted();
  }
  const targetId = descriptor.surfaceTargets[surfaceId];
  if (!targetId) throw new Error("Launcher browser surface is no longer registered with its native target");
  const deadline = Date.now() + timeoutMs;
  do {
    if (abortSignal?.aborted) {
      throw launcherConnectionAborted();
    }
    const candidates = browser.contexts().flatMap(context => context.pages().map(page => ({ context, page })));
    // Target metadata belongs to the browser process. Evaluating every page here makes an
    // unrelated busy/paused renderer block acquisition of an already-responsive owned page.
    const inspected = await Promise.all(candidates.map(async candidate => {
      // Bound each peer separately. A paused or closing renderer must not pin acquisition,
      // and a session arriving after cancellation still belongs to this attempt for cleanup.
      const peerDeadline = Math.min(deadline, Date.now() + 1_000);
      const detach = (session: Awaited<ReturnType<BrowserContext["newCDPSession"]>>) => {
        void session.detach().catch(() => {});
      };
      let session: Awaited<ReturnType<BrowserContext["newCDPSession"]>> | undefined;
      try {
        session = await boundedLauncherOperation(
          candidate.context.newCDPSession(candidate.page), peerDeadline, abortSignal, detach,
        );
        const { targetInfo } = await boundedLauncherOperation(
          session.send("Target.getTargetInfo"), peerDeadline, abortSignal,
        );
        return { ...candidate, targetId: targetInfo.targetId };
      } catch {
        return { ...candidate, targetId: undefined };
      } finally {
        if (session) detach(session);
      }
    }));
    if (abortSignal?.aborted) throw launcherConnectionAborted();
    const owned = inspected.filter(candidate => candidate.targetId === targetId);
    if (owned.length === 1) {
      return { context: owned[0].context, page: owned[0].page };
    }
    if (owned.length > 1) {
      throw new Error(`Launcher browser host exposed ${owned.length} surfaces with the same ownership id`);
    }
    if (Date.now() < deadline) {
      await boundedLauncherOperation(new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now()))),
        deadline + 1, abortSignal);
    }
  } while (Date.now() < deadline);
  throw new Error("Launcher browser host did not expose its owned browser surface");
}

export async function connectLauncherBrowserHost(
  descriptorPath: string,
  timeoutMs = 20_000,
  surfaceId?: string,
  abortSignal?: AbortSignal,
): Promise<LauncherBrowserConnection> {
  if (abortSignal?.aborted) {
    throw launcherConnectionAborted();
  }
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const deadline = Date.now() + timeoutMs;
  await assertCdpReady(descriptor, Math.min(timeoutMs, 5_000), abortSignal);
  let browser: Browser;
  try {
    browser = await boundedLauncherOperation(
      chromium.connectOverCDP(descriptor.endpoint, { timeout: Math.max(1, deadline - Date.now()) }),
      deadline, abortSignal, lateBrowser => { void lateBrowser.close().catch(() => {}); },
    );
  } catch (error) {
    if (abortSignal?.aborted) throw launcherConnectionAborted();
    throw new Error(`Could not connect Playwright to the launcher browser: ${error instanceof Error ? error.message : String(error)}`);
  }
  let closePromise: Promise<void> | undefined;
  const closeBrowser = () => closePromise ??= browser.close().catch(() => {});
  const closeOnAbort = () => { void closeBrowser(); };
  abortSignal?.addEventListener("abort", closeOnAbort, { once: true });
  try {
    if (abortSignal?.aborted) {
      throw launcherConnectionAborted();
    }
    const { context, page } = await selectLauncherPage(
      browser,
      descriptor,
      Math.max(0, deadline - Date.now()),
      surfaceId,
      abortSignal,
    );
    return { descriptor, browser, context, page };
  } catch (error) {
    void closeBrowser();
    throw error;
  } finally {
    abortSignal?.removeEventListener("abort", closeOnAbort);
  }
}
