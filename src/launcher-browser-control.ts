import { randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { expandUserPath } from "./config";
import { assertExpectedLauncherProfile, readLauncherBrowserHostDescriptor, type LauncherBrowserHostDescriptor, type LauncherBrowserHostProfile } from "./launcher-browser-descriptor";
import { LauncherAccountCooldownError, LauncherBrowserTurnCancelledError, LauncherRetainedConversationUnavailableError, LauncherManualTurnTimedOutError, LauncherManualTurnFailedError } from "./launcher-browser-errors";

/** One authenticated JSON POST to the launcher control channel; each caller decodes its own response. */
function postLauncherControl(
  descriptor: LauncherBrowserHostDescriptor,
  path: string,
  body: string,
  signal: AbortSignal,
): Promise<Response> {
  return fetch(`${descriptor.control.endpoint}${path}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${descriptor.control.token}`,
      "content-type": "application/json",
    },
    body,
    signal,
  });
}

export async function inspectLauncherBrowserHost(
  descriptorPath: string,
  options: {
    detectCapabilities?: boolean;
    expectedProfile?: LauncherBrowserHostProfile;
    timeoutMs?: number;
  } = {},
): Promise<{ solAvailable?: boolean; extraHighAvailable?: boolean; proAvailable?: boolean; url: string }> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  assertExpectedLauncherProfile(descriptor, options.expectedProfile);
  const timeoutMs = options.timeoutMs ?? (options.detectCapabilities
    ? LAUNCHER_CAPABILITY_INSPECTION_TIMEOUT_MS
    : LAUNCHER_SESSION_INSPECTION_TIMEOUT_MS);
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    const response = await postLauncherControl(
      descriptor,
      "/v1/session/inspect",
      JSON.stringify({ detectCapabilities: options.detectCapabilities === true, accountId: descriptor.accountId }),
      controller.signal,
    );
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
    if (body.authenticated !== true || body.temporary !== true || typeof body.url !== "string") {
      throw new Error("Launcher returned invalid ChatGPT session evidence");
    }
    if (options.detectCapabilities
      && (typeof body.solAvailable !== "boolean" || typeof body.proAvailable !== "boolean")) {
      throw new Error("Launcher did not return complete ChatGPT account capability evidence");
    }
    if (options.detectCapabilities && body.extraHighAvailable !== undefined && typeof body.extraHighAvailable !== "boolean") {
      throw new Error("Launcher returned invalid ChatGPT Extra High capability evidence");
    }
    const extraHighAvailable = body.extraHighAvailable ?? body.proAvailable;
    if (options.detectCapabilities && (((body.proAvailable === true || extraHighAvailable === true) && body.solAvailable !== true)
      || (body.proAvailable === true && extraHighAvailable !== true))) {
      throw new Error("Launcher returned contradictory ChatGPT account capability evidence");
    }
    return {
      url: body.url,
      ...(options.detectCapabilities ? {
        solAvailable: body.solAvailable as boolean,
        extraHighAvailable: extraHighAvailable as boolean,
        proAvailable: body.proAvailable as boolean,
      } : {}),
    };
  } catch (error) {
    const detail = timedOut
      ? `session inspection timed out after ${timeoutMs}ms`
      : error instanceof Error ? error.message : String(error);
    throw new Error(`Launcher ChatGPT session could not be verified: ${detail}`);
  } finally {
    clearTimeout(timer);
  }
}

export const LAUNCHER_SESSION_INSPECTION_TIMEOUT_MS = 30_000;
export const LAUNCHER_CAPABILITY_INSPECTION_TIMEOUT_MS = 120_000;

export type LauncherTurnActivity =
  | { phase: "progress"; traceId: string; helperPid: number; surfaceId: string; sequence: number;
      taskPhase: "preparing" | "sending-context" | "context-accepted" | "sending" | "accepted" | "responding" | "waiting-tools" }
  | { phase: "usage"; traceId: string; helperPid: number; receipt: string;
      effort: string; modelVersion: string;
      modelVersionSource?: "observed" | "pinned" | "unknown";
      messageKind?: "task" | "context_stage" | "compaction";
      outcome?: "completed"; }
  | {
      phase: "start";
      taskProgressVersion?: 1;
      traceId: string;
      helperPid: number;
      conversationKey?: string;
      connectorIdentity?: string;
      requireRetainedConversation?: boolean;
      requestedEffort?: string;
      requestedModel?: string;
      accountRoutingKey?: string;
    }
  | {
      phase: "heartbeat";
      traceId: string;
      helperPid: number;
      /** Confirms that recovery still addresses the exact launcher-owned surface. */
      surfaceId?: string;
      /** Re-establish the launcher's hidden viewport after the caller closes its CDP session. */
      refreshViewport?: boolean;
    }
  | {
      phase: "end";
      traceId: string;
      helperPid: number;
      status: "completed" | "failed" | "aborted";
      message?: string;
      retain?: boolean;
      connectorBound?: boolean;
      failureCode?: "rate_limit_exceeded" | "account_safety_stop" | "context_length_exceeded"
        | "model_unavailable" | "tool_timeout" | "browser_failure" | "other";
    };

// The launcher can spend ten seconds bootstrapping its idle document before ownership marking.
export const LAUNCHER_TURN_START_TIMEOUT_MS = 30_000;
export const LAUNCHER_TURN_HEARTBEAT_INTERVAL_MS = 10_000;
export const LAUNCHER_TURN_HEARTBEAT_TIMEOUT_MS = 5_000;
export const LAUNCHER_TURN_END_TIMEOUT_MS = 15_000;

export interface LauncherManualTurnOwner {
  traceId: string;
  helperPid: number;
}

export interface LauncherManualTurnStart extends LauncherManualTurnOwner {
  prompt: string;
  /** Per-turn history policy; omitted by older clients means Temporary Chat. */
  useSavedChats?: boolean;
  /** Used only when the exact retained ChatGPT conversation already owns the accumulated history. */
  resumePrompt?: string;
  conversationKey?: string;
  /** Gives a manual context handoff enough time without widening ordinary Manual mode turns. */
  compaction?: true;
}

export interface LauncherManualTurnLease {
  tabId: string;
  reused: boolean;
  deadlineAt: string | null;
  state: "awaiting-user" | "sent" | "running" | "completed";
}

export interface LauncherManualTurnEnd extends LauncherManualTurnOwner {
  status: "completed" | "failed" | "aborted";
  retain?: boolean;
}

export interface LauncherManualTurnTerminal {
  status: "cancelled" | "failed";
}

export const LAUNCHER_MANUAL_TURN_START_TIMEOUT_MS = 10_000;
export const LAUNCHER_MANUAL_SENT_REQUEST_TIMEOUT_MS = 40_000;
export const LAUNCHER_MANUAL_TURN_END_TIMEOUT_MS = 15_000;

async function launcherManualRequest(
  descriptor: LauncherBrowserHostDescriptor,
  action: "start" | "wait-sent" | "wait-terminal" | "started" | "end" | "cancel",
  body: LauncherManualTurnStart | LauncherManualTurnOwner | LauncherManualTurnEnd,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  abortSignal?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(abort, timeoutMs);
  try {
    const response = await postLauncherControl(descriptor, `/v1/manual/${action}`, JSON.stringify(body), controller.signal);
    const decoded = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { response, body: decoded };
  } finally {
    clearTimeout(timer);
    abortSignal?.removeEventListener("abort", abort);
  }
}

async function reconcileLauncherManualMutation(
  descriptor: LauncherBrowserHostDescriptor,
  action: "start" | "started" | "end",
  body: LauncherManualTurnStart | LauncherManualTurnOwner | LauncherManualTurnEnd,
  timeoutMs: number,
  validAcknowledgement: (body: Record<string, unknown>) => boolean,
  invalidAcknowledgementMessage: string,
): Promise<{ response: Response; body: Record<string, unknown> }> {
  let ambiguousError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const result = await launcherManualRequest(descriptor, action, body, timeoutMs);
      if (!result.response.ok || validAcknowledgement(result.body)) return result;
      ambiguousError = new LauncherManualTurnFailedError(invalidAcknowledgementMessage);
    } catch (error) {
      ambiguousError = error;
    }
  }
  // These mutations are keyed by the exact turn owner and are idempotent in the launcher.
  // The second identical request reconciles one missing or incomplete local acknowledgement.
  throw ambiguousError;
}

function isLauncherManualTurnLease(body: Record<string, unknown>): boolean {
  return body.ok === true
    && typeof body.tabId === "string"
    && body.tabId.length > 0
    && typeof body.reused === "boolean"
    && (body.deadlineAt === null
      || (typeof body.deadlineAt === "string" && !Number.isNaN(Date.parse(body.deadlineAt))))
    && ["awaiting-user", "sent", "running", "completed"].includes(String(body.state));
}

function throwManualControlError(response: Response, body: Record<string, unknown>): never {
  const message = typeof body.error === "string" ? body.error : `HTTP ${response.status}`;
  if (body.code === "turn_cancelled") throw new LauncherBrowserTurnCancelledError(message);
  if (body.code === "manual_turn_timed_out") throw new LauncherManualTurnTimedOutError(message);
  throw new LauncherManualTurnFailedError(message);
}

export async function startLauncherManualTurn(
  descriptorPath: string,
  activity: LauncherManualTurnStart,
  timeoutMs = LAUNCHER_MANUAL_TURN_START_TIMEOUT_MS,
): Promise<LauncherManualTurnLease> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const { response, body } = await reconcileLauncherManualMutation(
    descriptor,
    "start",
    activity,
    timeoutMs,
    isLauncherManualTurnLease,
    "Launcher returned an invalid manual turn lease",
  );
  if (!response.ok) throwManualControlError(response, body);
  return {
    tabId: body.tabId as string,
    reused: body.reused as boolean,
    deadlineAt: body.deadlineAt as string | null,
    state: body.state as LauncherManualTurnLease["state"],
  };
}

export async function waitForLauncherManualSent(
  descriptorPath: string,
  owner: LauncherManualTurnOwner,
  options: { abortSignal?: AbortSignal; timeoutMs?: number } = {},
): Promise<{ sentAt: string | null }> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const timeoutMs = options.timeoutMs ?? LAUNCHER_MANUAL_SENT_REQUEST_TIMEOUT_MS;
  for (;;) {
    if (options.abortSignal?.aborted) throw new DOMException("Manual Sent wait aborted", "AbortError");
    const { response, body } = await launcherManualRequest(
      descriptor,
      "wait-sent",
      owner,
      timeoutMs,
      options.abortSignal,
    );
    if (response.status === 202 && body.status === "pending") continue;
    if (!response.ok) throwManualControlError(response, body);
    if (body.status !== "sent"
      || (body.sentAt !== null && (typeof body.sentAt !== "string" || Number.isNaN(Date.parse(body.sentAt))))) {
      throw new LauncherManualTurnFailedError("Launcher returned invalid manual Sent confirmation");
    }
    return { sentAt: body.sentAt as string | null };
  }
}

export async function markLauncherManualTurnStarted(
  descriptorPath: string,
  owner: LauncherManualTurnOwner,
  timeoutMs = LAUNCHER_MANUAL_TURN_END_TIMEOUT_MS,
): Promise<void> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const { response, body } = await reconcileLauncherManualMutation(
    descriptor,
    "started",
    owner,
    timeoutMs,
    body => body.ok === true,
    "Launcher returned an invalid manual started acknowledgement",
  );
  if (!response.ok) throwManualControlError(response, body);
}

export async function waitForLauncherManualTerminal(
  descriptorPath: string,
  owner: LauncherManualTurnOwner,
  options: { abortSignal?: AbortSignal; timeoutMs?: number } = {},
): Promise<LauncherManualTurnTerminal> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const timeoutMs = options.timeoutMs ?? LAUNCHER_MANUAL_SENT_REQUEST_TIMEOUT_MS;
  for (;;) {
    if (options.abortSignal?.aborted) throw new DOMException("Manual terminal wait aborted", "AbortError");
    const { response, body } = await launcherManualRequest(
      descriptor,
      "wait-terminal",
      owner,
      timeoutMs,
      options.abortSignal,
    );
    if (response.status === 202 && body.status === "pending") continue;
    if (!response.ok) throwManualControlError(response, body);
    if (body.status !== "cancelled" && body.status !== "failed") {
      throw new LauncherManualTurnFailedError("Launcher returned an invalid manual terminal signal");
    }
    return { status: body.status };
  }
}

export async function endLauncherManualTurn(
  descriptorPath: string,
  activity: LauncherManualTurnEnd,
  timeoutMs = LAUNCHER_MANUAL_TURN_END_TIMEOUT_MS,
): Promise<{ cancelledByUser: boolean }> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const { response, body } = await reconcileLauncherManualMutation(
    descriptor,
    "end",
    activity,
    timeoutMs,
    body => body.ok === true && typeof body.cancelledByUser === "boolean",
    "Launcher returned an invalid manual turn release result",
  );
  if (!response.ok) throwManualControlError(response, body);
  return { cancelledByUser: body.cancelledByUser as boolean };
}

export async function cancelLauncherManualTurn(
  descriptorPath: string,
  owner: LauncherManualTurnOwner,
  timeoutMs = LAUNCHER_MANUAL_TURN_END_TIMEOUT_MS,
): Promise<void> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const { response, body } = await launcherManualRequest(descriptor, "cancel", owner, timeoutMs);
  if (!response.ok) throwManualControlError(response, body);
}

export async function notifyLauncherTurn(
  descriptorPath: string,
  activity: LauncherTurnActivity,
  timeoutMs = activity.phase === "end"
    ? LAUNCHER_TURN_END_TIMEOUT_MS
    : activity.phase === "heartbeat"
      ? LAUNCHER_TURN_HEARTBEAT_TIMEOUT_MS
      : LAUNCHER_TURN_START_TIMEOUT_MS,
  abortSignal?: AbortSignal,
): Promise<{
  surfaceId?: string;
  taskProgressVersion?: number;
  taskProgressSequence?: number;
  reused?: boolean;
  connectorBound?: boolean;
  cancelledByUser?: boolean;
}> {
  let descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const mutation = activity.phase === "usage"
    ? activity
    : { ...activity, mutationId: randomUUID() };
  let ambiguousError: unknown;
  const attempts = activity.phase === "usage" ? 1 : 2;
  const cancelAdmission = async () => {
    if (activity.phase !== 'start' || activity.taskProgressVersion !== 1) return;
    descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
    for (let attempt = 0; attempt < 8; attempt++) {
      const response = await postLauncherControl(descriptor, '/v1/turn/start-cancel',
        JSON.stringify({ traceId: activity.traceId, helperPid: activity.helperPid }), AbortSignal.timeout(2500));
      const receipt = await response.json() as { cancelling?: boolean; cancelled?: boolean; notSent?: boolean };
      if (response.status === 202 && receipt.cancelling) { await new Promise(resolve => setTimeout(resolve, 250)); continue; }
      if (!response.ok || receipt.cancelled !== true || receipt.notSent !== true) throw new Error('Queued task cancellation was not confirmed; inspect Task center before retrying');
      return;
    }
    throw new Error('Queued task cancellation is still settling; inspect Task center before retrying');
  };
  try {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    abortSignal?.throwIfAborted();
    if (activity.phase === 'start') descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await postLauncherControl(
        descriptor,
        `/v1/turn/${activity.phase}`,
        JSON.stringify(mutation),
        abortSignal ? AbortSignal.any([controller.signal, abortSignal]) : controller.signal,
      );
      const body = await response.json().catch(() => ({})) as Record<string, unknown>;
      abortSignal?.throwIfAborted();
      if (activity.phase === 'start' && response.status === 202) {
        if (body.queued !== true || body.notSent !== true || typeof body.queueId !== 'string') throw new Error('Invalid queue admission receipt');
        // A queued response is a live wait, not a failed attempt or permission to resubmit.
        attempt = -1;
        await new Promise<void>((resolveWait, rejectWait) => {
          const abort = () => { clearTimeout(wait); abortSignal?.removeEventListener('abort', abort); rejectWait(abortSignal?.reason ?? new DOMException('Queued turn aborted', 'AbortError')); };
          const wait = setTimeout(() => { abortSignal?.removeEventListener('abort', abort); resolveWait(); }, 500);
          abortSignal?.addEventListener('abort', abort, { once: true });
          if (abortSignal?.aborted) abort();
        });
        continue;
      }
      if (!response.ok) {
        if (body.code === "account_cooldown") throw new LauncherAccountCooldownError(
          typeof body.error === "string" ? body.error : "Account cooldown is active. Wait before retrying.",
        );
        if (response.status === 409 && body.code === "turn_cancelled") {
          throw new LauncherBrowserTurnCancelledError(
            typeof body.error === "string" ? body.error : `Browser turn ${activity.traceId} was cancelled by the user`,
          );
        }
        if (response.status === 409 && body.code === "retained_conversation_unavailable") {
          throw new LauncherRetainedConversationUnavailableError(
            typeof body.error === "string" ? body.error : "The retained ChatGPT conversation is no longer available",
            body.workStarted === false ? false : undefined,
          );
        }
        const detail = typeof body.error === "string" ? body.error : "";
        const rejection = new Error(`Launcher browser control channel failed: HTTP ${response.status}${detail ? `: ${detail}` : ""}`);
        rejection.name = "LauncherControlRejectedError";
        throw rejection;
      }
      if (activity.phase === "start") {
        if (typeof body.surfaceId !== "string" || !/^[A-Za-z0-9_-]{32}$/.test(body.surfaceId)) {
          throw new Error("Launcher browser control channel returned an invalid turn surface id");
        }
        if (typeof body.reused !== "boolean") {
          throw new Error("Launcher browser control channel returned an invalid reuse state");
        }
        if (typeof body.connectorBound !== "boolean") {
          throw new Error("Launcher browser control channel returned an invalid connector state");
        }
        if (body.queueId !== undefined) {
          if (typeof body.queueId !== 'string' || !/^[a-f0-9-]{36}$/.test(body.queueId)) throw new Error('Invalid admitted queue owner');
          let acknowledged = false;
          for (let ackAttempt = 0; ackAttempt < 2 && !acknowledged; ackAttempt++) {
            abortSignal?.throwIfAborted();
            try {
              const acknowledgement = await postLauncherControl(descriptor, '/v1/turn/start-ack',
                JSON.stringify({ traceId: activity.traceId, helperPid: activity.helperPid, surfaceId: body.surfaceId }),
                abortSignal ? AbortSignal.any([AbortSignal.timeout(timeoutMs), abortSignal]) : AbortSignal.timeout(timeoutMs));
              const receipt = await acknowledgement.json() as { acknowledged?: boolean };
              acknowledged = acknowledgement.ok && receipt.acknowledged === true;
            } catch { if (abortSignal?.aborted) abortSignal.throwIfAborted(); }
          }
          if (!acknowledged) {
            const failure = new Error('Browser lease handoff was not acknowledged; this prompt was not sent');
            failure.name = 'LauncherControlRejectedError'; throw failure;
          }
          abortSignal?.throwIfAborted();
        }
        return {
          surfaceId: body.surfaceId,
          ...(body.taskProgressVersion === 1 && Number.isSafeInteger(body.taskProgressSequence) && (body.taskProgressSequence as number) >= 0
            ? { taskProgressVersion: 1, taskProgressSequence: body.taskProgressSequence as number } : {}),
          reused: body.reused,
          connectorBound: body.connectorBound,
        };
      }
      if (activity.phase === "end") {
        if (body.ok !== true || typeof body.cancelledByUser !== "boolean") {
          throw new Error("Launcher browser control channel returned an invalid turn release result");
        }
        return { cancelledByUser: body.cancelledByUser };
      }
      if (body.ok !== true) {
        throw new Error("Launcher browser control channel returned an invalid acknowledgement");
      }
      return {};
    } catch (error) {
      if (abortSignal?.aborted) throw abortSignal.reason ?? new DOMException('Queued turn aborted', 'AbortError');
      if (controller.signal.aborted) {
        ambiguousError = new Error(`Launcher browser control ${activity.phase} timed out after ${timeoutMs}ms`);
        continue;
      }
      if (error instanceof LauncherBrowserTurnCancelledError
        || error instanceof LauncherAccountCooldownError
        || error instanceof LauncherRetainedConversationUnavailableError
        || (error instanceof Error && error.name === "LauncherControlRejectedError")) throw error;
      ambiguousError = error;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error(`Launcher browser control channel failed: ${ambiguousError instanceof Error ? ambiguousError.message : String(ambiguousError)}`);
  } catch (error) {
    // Only the server's explicit predispatch proof makes cleanup unnecessary.
    // A missing retained tab or a typed failure alone does not prove no work.
    if (error instanceof LauncherRetainedConversationUnavailableError && error.workStarted === false) throw error;
    try { await cancelAdmission(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Browser admission did not finish cleanly; inspect Task center before retrying');
    }
    throw error;
  }
}

export interface LauncherArtifactOwner {
  traceId: string;
  helperPid: number;
  surfaceId: string;
}

export interface LauncherArtifactReceipt extends LauncherArtifactOwner {
  leaseId: string;
  assistantTurnId: string;
  filename: string;
  partialPath: string;
  receivedBytes: number;
  downloadAuthority: "chatgpt.com" | "oaiusercontent.com" | "chatgpt-blob" | "chatgpt-sandbox";
}

export function launcherArtifactTaskDirectory(descriptorPath: string, traceId: string): string {
  if (!/^[A-Za-z0-9_-]{6,128}$/.test(traceId)) throw new Error("Launcher artifact trace identity is invalid");
  const absoluteDescriptor = resolve(expandUserPath(descriptorPath));
  return join(dirname(dirname(absoluteDescriptor)), "artifacts", traceId);
}

async function launcherArtifactRequest(
  descriptorPath: string,
  action: "register" | "wait" | "cancel",
  body: object,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  if (!descriptor.features?.includes("task-artifact-download-v1")) {
    throw new Error("Launcher browser host does not support bounded task artifacts; update or restart NEKODEX before sending files");
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`Launcher artifact ${action} timed out`)), timeoutMs);
  const signal = abortSignal ? AbortSignal.any([controller.signal, abortSignal]) : controller.signal;
  try {
    const response = await postLauncherControl(descriptor, `/v1/turn/artifact-${action}`, JSON.stringify(body), signal);
    const decoded = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(typeof decoded.error === "string" ? decoded.error : `Launcher artifact ${action} failed: HTTP ${response.status}`);
    }
    return decoded;
  } finally {
    clearTimeout(timer);
  }
}

export async function registerLauncherArtifactDownload(
  descriptorPath: string,
  owner: LauncherArtifactOwner & {
    assistantTurnId: string;
    expectedFilename: string;
    maxBytes: number;
    deadlineMs: number;
  },
  abortSignal?: AbortSignal,
): Promise<{ leaseId: string }> {
  const request = { ...owner, mutationId: randomUUID() };
  let body: Record<string, unknown> | undefined;
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try { body = await launcherArtifactRequest(descriptorPath, "register", request, 10_000, abortSignal); break; }
    catch (error) { if (abortSignal?.aborted) throw error; failure = error; }
  }
  if (!body) throw failure instanceof Error ? failure : new Error("Launcher artifact registration failed");
  if (body.ok !== true || typeof body.leaseId !== "string" || !/^artifact_[a-f0-9]{32}$/.test(body.leaseId)) {
    throw new Error("Launcher returned an invalid artifact registration receipt");
  }
  return { leaseId: body.leaseId };
}

export async function waitForLauncherArtifactDownload(
  descriptorPath: string,
  owner: LauncherArtifactOwner & { leaseId: string },
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<LauncherArtifactReceipt> {
  const body = await launcherArtifactRequest(descriptorPath, "wait", owner, timeoutMs + 5_000, abortSignal);
  const expectedDirectory = launcherArtifactTaskDirectory(descriptorPath, owner.traceId);
  if (body.ok !== true || body.leaseId !== owner.leaseId || body.traceId !== owner.traceId
    || body.helperPid !== owner.helperPid || body.surfaceId !== owner.surfaceId
    || typeof body.assistantTurnId !== "string" || typeof body.filename !== "string"
    || typeof body.partialPath !== "string" || dirname(resolve(body.partialPath)) !== expectedDirectory
    || !Number.isSafeInteger(body.receivedBytes) || Number(body.receivedBytes) <= 0
    || !["chatgpt.com", "oaiusercontent.com", "chatgpt-blob", "chatgpt-sandbox"].includes(String(body.downloadAuthority))) {
    throw new Error("Launcher returned an invalid artifact completion receipt");
  }
  return body as unknown as LauncherArtifactReceipt;
}

export async function cancelLauncherArtifactDownload(
  descriptorPath: string,
  owner: LauncherArtifactOwner & { leaseId: string; reason: string },
  abortSignal?: AbortSignal,
): Promise<void> {
  const body = await launcherArtifactRequest(descriptorPath, "cancel", owner, 10_000, abortSignal);
  if (body.ok !== true || typeof body.cancelled !== "boolean") {
    throw new Error("Launcher returned an invalid artifact cancellation receipt");
  }
}

export async function releaseLauncherRetainedConversation(
  descriptorPath: string,
  conversationKey: string,
  timeoutMs = LAUNCHER_TURN_END_TIMEOUT_MS,
): Promise<number> {
  if (!/^[a-f0-9]{64}$/.test(conversationKey)) {
    throw new Error("Launcher retained conversation key is invalid");
  }
  const descriptor = readLauncherBrowserHostDescriptor(descriptorPath);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await postLauncherControl(descriptor, "/v1/turn/release", JSON.stringify({ conversationKey }), controller.signal);
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    if (!response.ok || !Number.isSafeInteger(body.released) || Number(body.released) < 0) {
      const detail = typeof body.error === "string" ? `: ${body.error}` : "";
      throw new Error(`HTTP ${response.status}${detail}`);
    }
    return Number(body.released);
  } catch (error) {
    throw new Error(`Launcher retained conversation release failed: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}
