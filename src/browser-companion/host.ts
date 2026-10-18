import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readRequestBodyBytes } from "../http-body";
import {
  COMPANION_ORIGIN, COMPANION_PATH, COMPANION_VERSION, browserActionSchema, browserBindingSchema,
  browserObservationSchema, resultSchema, sameBrowserBinding, browserBindingOf,
  type BrowserBinding, type BrowserObservation, type CompanionCommand, type CompanionReceipt,
} from "./protocol";

interface Pending {
  command: CompanionCommand;
  phase: "queued" | "dispatched" | "unknown";
  resolve: (receipt: CompanionReceipt) => void;
  detach: () => void;
}
export interface BrowserCompanionHostOptions {
  /** Exact unpacked/store extension identity selected by the local user. No wildcard origins. */
  extensionId: string;
  origin?: string;
  hostId?: string;
}

/** A private, in-memory owner. Mount only on a loopback listener; the bootstrap API stays in-process. */
export function createBrowserCompanionHost(options: BrowserCompanionHostOptions) {
  if (!/^[a-p]{32}$/.test(options.extensionId)) throw new Error("An exact Chrome extension ID is required");
  const origin = options.origin ?? COMPANION_ORIGIN;
  if (origin !== COMPANION_ORIGIN) throw new Error("Companion origin must match the fixed extension host permission");
  const extensionOrigin = `chrome-extension://${options.extensionId}`;
  const hostId = options.hostId ?? randomUUID();
  let pairingCode: string | undefined;
  let token: string | undefined;
  let sessionId: string | undefined;
  let observation: BrowserObservation | undefined;
  let selected: BrowserBinding | undefined;
  let pending: Pending | undefined;
  let polling = false;
  let wake: (() => void) | undefined;
  let closed = false;
  const receipts = new Map<string, CompanionReceipt>();
  const secretEqual = (a: string | undefined, b: string | undefined) => !!a && !!b && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
  function retain(receipt: CompanionReceipt) {
    receipts.set(receipt.operationId, structuredClone(receipt));
    while (receipts.size > 100) receipts.delete(receipts.keys().next().value!);
    return receipt;
  }
  function uncertain(reason: string) {
    if (!pending) return;
    const current = pending;
    const receipt = retain({ operationId: current.command.operationId, outcome: current.phase === "queued" ? "not_sent" : "unknown", cancelRequested: true, reason });
    current.detach(); current.resolve(receipt);
    if (current.phase === "queued") pending = undefined;
    else current.phase = "unknown";
    observation = undefined;
    wake?.();
  }
  function revoke() {
    uncertain("Pairing or selected scope was revoked");
    // Preserve uncertain receipts, but the retired session can no longer execute or reconcile.
    pending = undefined; token = undefined; sessionId = undefined; pairingCode = undefined; observation = undefined; selected = undefined; wake?.();
  }
  function response(body: unknown, status = 200): Response {
    return Response.json(body, { status, headers: {
      "access-control-allow-origin": extensionOrigin, "vary": "Origin", "cache-control": "no-store",
      "access-control-allow-methods": "POST, OPTIONS", "access-control-allow-headers": "authorization, content-type",
      "access-control-allow-private-network": "true",
    } });
  }
  function assertBinding(value: unknown, kind: CompanionCommand["kind"]) {
    const binding = browserBindingSchema.parse(value);
    const anchor = kind === "observe" ? selected : observation;
    if (!anchor || !sameBrowserBinding(anchor, binding) || binding.sessionId !== sessionId) throw new Error("Stale or foreign observation; select or observe the exact tab again");
    return binding;
  }
  function dispatch(kind: CompanionCommand["kind"], bindingValue: unknown, actionValue?: unknown, signal?: AbortSignal): Promise<CompanionReceipt> {
    if (closed || !token) throw new Error("Companion is not paired");
    if (pending) throw new Error("A companion operation is active or has an uncertain outcome; reconcile its receipt first");
    const binding = assertBinding(bindingValue, kind);
    const action = kind === "act" ? browserActionSchema.parse(actionValue) : undefined;
    if (action && !observation!.refs.some(row => row.ref === action.ref && (action.kind !== "type" || row.role === "textbox"))) throw new Error("Unknown or incompatible observation reference");
    signal?.throwIfAborted();
    const operationId = randomUUID();
    return new Promise(resolve => {
      const abort = () => uncertain("Caller cancelled; a dispatched input may already have occurred");
      pending = { command: { operationId, kind, binding: structuredClone(binding), ...(action ? { action } : {}) }, phase: "queued", resolve,
        detach: () => signal?.removeEventListener("abort", abort) };
      signal?.addEventListener("abort", abort, { once: true });
      wake?.();
    });
  }
  async function fetchRequest(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== origin || url.search || url.hash || (request.headers.has("host") && request.headers.get("host") !== url.host) || request.headers.get("origin") !== extensionOrigin) return response({ error: "Companion origin or host identity mismatch" }, 403);
    const route = url.pathname;
    if (!["pair", "poll", "select", "result", "revoke"].some(name => route === `${COMPANION_PATH}/${name}`)) return response({ error: "Unknown companion endpoint" }, 404);
    if (request.method === "OPTIONS") return response({ version: COMPANION_VERSION });
    if (request.method !== "POST" || request.headers.get("content-type")?.split(";")[0] !== "application/json") return response({ error: "JSON POST is required" }, 415);
    if (closed) return response({ error: "Companion host is closed" }, 410);
    try {
      const wire = await readRequestBodyBytes(request, 64 * 1024);
      const body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(wire));
      if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid companion message");
      if (body.version !== COMPANION_VERSION || body.hostId !== hostId) return response({ error: "Companion protocol or host identity mismatch" }, 409);
      if (route.endsWith("/pair")) {
        if (!pairingCode || !secretEqual(pairingCode, body.pairingCode) || token) return response({ error: "Pairing code is invalid or consumed" }, 403);
        pairingCode = undefined; token = randomBytes(32).toString("base64url"); sessionId = randomUUID();
        return response({ version: COMPANION_VERSION, hostId, token, sessionId });
      }
      const supplied = request.headers.get("authorization");
      if (!secretEqual(token, supplied?.startsWith("Bearer ") ? supplied.slice(7) : undefined) || body.sessionId !== sessionId) return response({ error: "Companion session is not paired" }, 403);
      if (route.endsWith("/revoke")) { revoke(); return response({ revoked: true }); }
      if (route.endsWith("/select")) {
        // The extension sends this only following the explicit Select current tab button.
        const selected = browserObservationSchema.parse(body.observation);
        if (selected.sessionId !== sessionId) throw new Error("Selected tab has a foreign session");
        if (pending) uncertain("User changed the selected tab or freshness scope");
        if (pending) throw new Error("An uncertain input must be reconciled before selecting another scope");
        observation = selected;
        // Keep a document anchor after input; it can authorize a fresh read, never another input.
        setSelected(selected);
        return response({ selected: true, observationId: observation.observationId });
      }
      if (route.endsWith("/result")) {
        const result = resultSchema.parse(body.result);
        if (!pending || pending.command.operationId !== result.operationId) throw new Error("Unknown operation receipt");
        const current = pending;
        if (current.phase === "queued") throw new Error("Operation has not been delivered");
        if ((result.outcome === "rejected" && result.executed) || (result.outcome === "completed" && result.executed !== (current.command.kind === "act")) || (current.command.kind === "act" && result.observation)) throw new Error("Execution receipt does not match the delivered operation");
        if (result.outcome === "completed" && current.command.kind === "observe") {
          if (!result.observation) throw new Error("Observation receipt is missing");
          const candidate = result.observation;
          const previous = current.command.binding;
          if (candidate.sessionId !== previous.sessionId || candidate.scopeId !== previous.scopeId || candidate.tabId !== previous.tabId || candidate.windowId !== previous.windowId || candidate.frameId !== previous.frameId || candidate.documentId !== previous.documentId || candidate.documentEpoch !== previous.documentEpoch || candidate.observationId === previous.observationId) throw new Error("Observation changed owner or document");
          if (current.phase !== "unknown") { observation = candidate; setSelected(candidate); }
        } else observation = undefined;
        const receipt = retain({ ...result, cancelRequested: current.phase === "unknown" });
        current.detach(); current.resolve(receipt);
        if (result.outcome === "unknown") current.phase = "unknown";
        else pending = undefined;
        return response({ accepted: true });
      }
      if (polling) return response({ error: "One extension poll owner is already active" }, 409);
      polling = true;
      try {
        if (!pending || pending.phase !== "queued") await new Promise<void>(resolve => {
          const timer = setTimeout(done, 20_000);
          function done() { clearTimeout(timer); request.signal.removeEventListener("abort", done); wake = undefined; resolve(); }
          wake = done; request.signal.addEventListener("abort", done, { once: true });
          if (request.signal.aborted) done();
        });
        if (request.signal.aborted) return response({ commands: [] });
        if (!pending || pending.phase !== "queued" || !token) return response({ commands: [] });
        pending.phase = "dispatched";
        return response({ commands: [pending.command] });
      } finally { polling = false; }
    } catch (error) {
      return response({ error: error instanceof Error && !error.name.includes("Zod") && !error.message.includes("JSON") ? error.message.slice(0, 240) : "Invalid companion protocol message" }, 400);
    }
  }
  function setSelected(value: BrowserBinding) { selected = browserBindingOf(value); }
  return {
    fetch: fetchRequest,
    /** Local-only bootstrap; never expose this through an unauthenticated HTTP endpoint or logs. */
    createPairing() {
      if (closed) throw new Error("Companion host is closed");
      if (pending) throw new Error("Reconcile the active operation before pairing another session");
      revoke(); pairingCode = randomBytes(32).toString("base64url");
      return { version: COMPANION_VERSION, origin, hostId, pairingCode, extensionId: options.extensionId };
    },
    status: () => ({ version: COMPANION_VERSION, hostId, extensionId: options.extensionId, paired: !!token, connected: polling && !!token,
      selected: selected ? structuredClone(selected) : null,
      operation: pending ? { operationId: pending.command.operationId, phase: pending.phase } : null }),
    observation: () => observation ? structuredClone(observation) : undefined,
    observe: (binding: BrowserBinding, signal?: AbortSignal) => dispatch("observe", binding, undefined, signal),
    act: (binding: BrowserBinding, action: unknown, signal?: AbortSignal) => dispatch("act", binding, action, signal),
    receipt: (operationId: string) => receipts.has(operationId) ? structuredClone(receipts.get(operationId)) : undefined,
    revoke,
    close() { revoke(); pairingCode = undefined; closed = true; },
  };
}
export type BrowserCompanionHost = ReturnType<typeof createBrowserCompanionHost>;
