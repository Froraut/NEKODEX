import { createHash } from "node:crypto";
import { z } from "zod";
import { validateToolScope } from "../agent-tools/journal";
import type { ToolDescriptor, ToolInvocation, ToolOutcome, ToolScope } from "../agent-tools/types";
import { macosWindowSelectionSchema, type MacosDesktopProvider, type MacosDesktopStatus, type MacosWindowMetadata, type MacosWindowSelection } from "./macos-desktop";
import type { AgentTask, OutcomeEvidence } from "../agent-mode/types";
import { desktopApplicationPropertiesSchema, desktopPropertyExpectationSchema, desktopPropertyReference, evaluateDesktopProperty } from "./desktop-outcome";
import { desktopBindingOf, desktopBindingSchema, desktopObservationSchema, type DesktopObservation, type DesktopReceipt } from "./providers";

const PROVIDER_ID = "nekodex-macos-desktop-v1";
const MAX_MODEL_IMAGE = 160 * 1024;
const MAX_RESULT = 256 * 1024;
const calls = {
  observe: z.object({ selection: macosWindowSelectionSchema, waitForForeground: z.literal(true).optional() }).strict(),
  readProperties: z.object({ selection: macosWindowSelectionSchema }).strict(),
  verifyProperty: z.object({ selection: macosWindowSelectionSchema, expectation: desktopPropertyExpectationSchema }).strict(),
  click: z.object({ binding: desktopBindingSchema, x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), waitForForeground: z.literal(true).optional() }).strict(),
  type: z.object({ binding: desktopBindingSchema, text: z.string().min(1).max(8000), waitForForeground: z.literal(true).optional() }).strict(),
};
type Request = Omit<ToolInvocation, "grantId">;
type ModelImage = Awaited<ReturnType<MacosDesktopProvider["modelImage"]>>;
export interface AgentDesktopToolsOptions {
  /** Trusted fixed helper configuration. Never a path, PID, command or factory from model/renderer. */
  createProvider: () => MacosDesktopProvider;
  isScopeActive(scope: ToolScope): boolean;
  platform?: NodeJS.Platform;
}
const selectionOf = (value: MacosWindowSelection): MacosWindowSelection => ({ windowId: value.windowId, processId: value.processId, windowEpoch: value.windowEpoch });
const sameSelection = (a: MacosWindowSelection, b: MacosWindowSelection) => a.windowId === b.windowId && a.processId === b.processId && a.windowEpoch === b.windowEpoch;
const sameBinding = (a: z.infer<typeof desktopBindingSchema>, b: z.infer<typeof desktopBindingSchema>) => Object.keys(desktopBindingSchema.shape).every(key => a[key as keyof typeof a] === b[key as keyof typeof b]);
function operationIdentity(key: string): string {
  const bytes = createHash("sha256").update("nekodex-agent-desktop\0").update(key).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50; bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex"); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** One lazy native resource and task attachments. Existing StandaloneMcpHost alone owns
 * approval, durable unknown-before-effect and canonical continuation of these tools. */
export function createAgentDesktopToolsProvider(options: AgentDesktopToolsOptions) {
  const platform = options.platform ?? process.platform;
  let native: MacosDesktopProvider | undefined;
  let enabled = false, closed = false;
  let reason: string | null = null;
  let cached: MacosDesktopStatus | null = null;
  let inspectedAt: number | null = null;
  let windows: MacosWindowMetadata[] = [];
  let latestOwner: string | undefined;
  let latestProperty: { scopeKey: string; sourceEventId: string; subjectRevision: string } | undefined;
  let closing: Promise<void> | undefined;
  const attachments = new Map<string, MacosWindowSelection>();
  const observations = new Map<string, DesktopObservation>();
  const pending = new Set<Promise<unknown>>();
  let operation: { controller: AbortController; scopeKey?: string } | undefined;
  const scopeKey = (scope: ToolScope) => JSON.stringify([scope.taskId, scope.generation]);
  const nativeScope = (scope: ToolScope) => `${scope.taskId}\0${scope.generation}`;
  const active = (scope: ToolScope) => { validateToolScope(scope); if (closed || !options.isScopeActive(scope)) throw new Error("Current owned Agent desktop scope is unavailable"); };
  const explicit = (value: boolean) => { if (value !== true || closed) throw new Error("Explicit local desktop control is required"); };
  function resource() {
    if (closed || platform !== "darwin") throw new Error("Native desktop provider is unavailable on this platform");
    return native ??= options.createProvider();
  }
  const propertiesAvailable = () => enabled && !!native && native.passiveStatus().enabled && !native.passiveStatus().closed && !native.passiveStatus().uncertain
    && !!cached?.enabled && cached.selectionCurrent && cached.inputWindowBound && cached.accessibilityGranted && !cached.uncertain;
  const available = () => propertiesAvailable() && !!cached?.screenCaptureGranted;
  function status(scope?: ToolScope) {
    if (scope) validateToolScope(scope);
    const selected = cached?.selected ? selectionOf(cached.selected) : null;
    const count = Math.max(pending.size, native?.passiveStatus().activeCount ?? 0);
    return {
      providerId: PROVIDER_ID, platform, state: closed ? "closed" as const : reason && !enabled ? "unavailable" as const : enabled ? "enabled" as const : "disabled" as const,
      enabled, created: !!native, activeCount: count, available: available(), reason,
      permissions: cached ? { screenCaptureGranted: cached.screenCaptureGranted, accessibilityGranted: cached.accessibilityGranted, postEventGranted: cached.postEventGranted } : null,
      permissionInspectionAt: inspectedAt, nativeStatus: cached ? structuredClone(cached) : null,
      windows: structuredClone(windows), selected, restartPolicy: "off" as const,
      modelImage: { mimeType: "image/jpeg" as const, maxBytes: MAX_MODEL_IMAGE, coordinateSpace: "screenshot-pixels" as const },
      bindings: [...attachments].filter(([key]) => !scope || key === scopeKey(scope)).map(([key, selection]) => {
        const [taskId, generation] = JSON.parse(key) as [string, number];
        return { taskId, generation, selection: structuredClone(selection), observed: observations.has(key), active: operation?.scopeKey === key };
      }),
    };
  }
  async function inspect(provider: MacosDesktopProvider, signal?: AbortSignal) {
    const value = await provider.status(signal); cached = value; inspectedAt = Date.now();
    if (!value.selectionCurrent || !value.inputWindowBound || !value.screenCaptureGranted || !value.accessibilityGranted || value.uncertain) { observations.clear(); latestOwner = undefined; }
    return value;
  }
  async function run<T>(scope: ToolScope | undefined, fn: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (closed || operation || (native?.passiveStatus().activeCount ?? 0) > 0) throw new Error("Wait for the current native desktop owner; no second operation was started");
    const current = { controller: new AbortController(), ...(scope ? { scopeKey: scopeKey(scope) } : {}) }; operation = current;
    const combined = signal ? AbortSignal.any([current.controller.signal, signal]) : current.controller.signal;
    const promise = Promise.resolve().then(() => { combined.throwIfAborted(); latestProperty = undefined; return fn(combined); });
    pending.add(promise);
    try { return await promise; }
    finally { pending.delete(promise); if (operation === current) operation = undefined; }
  }
  function result(request: Request, state: ToolOutcome["state"], value?: unknown, failure?: string): ToolOutcome {
    const body = value ?? (failure ? { isError: true, structuredContent: { source: "owned-macos-desktop", outcome: state === "failed" ? "not_sent" : "unknown", reason: failure } } : undefined);
    return { scope: structuredClone(request.scope), tool: request.tool, idempotencyKey: request.idempotencyKey, state,
      ...(body === undefined ? {} : { result: body }), ...(failure ? { reason: failure } : {}) };
  }
  function receiptResult(request: Request, receipt: DesktopReceipt) {
    const state = receipt.outcome === "completed" ? "completed" : receipt.outcome === "unknown" ? "outcome_unknown" : "failed";
    return result(request, state, { isError: state !== "completed", structuredContent: { source: "owned-macos-desktop", taskId: request.scope.taskId, generation: request.scope.generation,
      proof: "native-input-execution-only", execution: receipt, limitation: "Native input execution is not application acceptance or a completed business outcome." } }, receipt.reason);
  }
  function nameAndArgs(request: Request) {
    validateToolScope(request.scope);
    if (!request.idempotencyKey || request.idempotencyKey.length > 240 || !Object.keys(calls).some(name => request.tool === `desktop/${name}`)) throw new Error("Invalid owned desktop tool identity");
    const name = request.tool.slice("desktop/".length) as keyof typeof calls;
    return { name, args: calls[name].parse(request.arguments) };
  }
  function bound(scope: ToolScope, needsImage = true): MacosWindowSelection {
    active(scope);
    const attachment = attachments.get(scopeKey(scope)); const selected = cached?.selected;
    if (!enabled || !native || !attachment || !selected || !sameSelection(attachment, selected) || !(needsImage ? available() : propertiesAvailable())) throw new Error("Enable and explicitly attach the exact accessible window to this task generation");
    return attachment;
  }
  function validateImage(image: ModelImage, observation: DesktopObservation) {
    const bytes = Buffer.from(image.base64, "base64");
    if (image.mimeType !== "image/jpeg" || bytes.length > MAX_MODEL_IMAGE || bytes.length < 4 || bytes.toString("base64") !== image.base64
      || bytes[0] !== 0xff || bytes[1] !== 0xd8 || image.sourceScreenshotId !== observation.screenshotId || image.width !== observation.width || image.height !== observation.height
      || createHash("sha256").update(bytes).digest("hex") !== image.sha256) throw new Error("Bounded model image does not match the observed screenshot");
  }
  function invalidate(taskId?: string) {
    const keys = [...attachments.keys()].filter(key => taskId === undefined || (JSON.parse(key) as [string, number])[0] === taskId);
    for (const key of keys) {
      if (operation?.scopeKey === key) operation.controller.abort();
      attachments.delete(key); observations.delete(key);
      if (latestProperty?.scopeKey === key) latestProperty = undefined;
      if (latestOwner === key) { native?.invalidate(); latestOwner = undefined; }
    }
  }
  return {
    serverId: "desktop", status,
    async inspectPermissions(explicitUserAction: boolean) {
      explicit(explicitUserAction);
      try { await run(undefined, signal => inspect(resource(), signal)); reason = null; }
      catch (error) { reason = error instanceof Error ? error.message.slice(0, 240) : "Desktop permissions could not be inspected"; throw error; }
      return status();
    },
    async listWindows(explicitUserAction: boolean) {
      explicit(explicitUserAction);
      try { await run(undefined, async signal => { windows = await resource().listWindows(signal); }); reason = null; }
      catch (error) { reason = error instanceof Error ? error.message.slice(0, 240) : "Desktop windows could not be listed"; throw error; }
      return status();
    },
    async setEnabled(value: boolean, explicitUserAction: boolean) {
      explicit(explicitUserAction);
      if (typeof value !== "boolean") throw new Error("Explicit desktop preference is required");
      if (!value) {
        operation?.controller.abort(); invalidate(); enabled = false; cached = null; windows = [];
        await native?.setEnabled(false, true); await Promise.allSettled([...pending]); reason = null;
        return status();
      }
      try {
        await run(undefined, async signal => { const provider = resource(); await provider.setEnabled(true, true); enabled = true; await inspect(provider, signal); });
        reason = null;
      } catch (error) { enabled = false; reason = error instanceof Error ? error.message.slice(0, 240) : "Desktop provider could not be enabled"; throw error; }
      return status();
    },
    async selectAndBind(scope: ToolScope, expectedSelection: MacosWindowSelection, explicitUserAction: boolean) {
      explicit(explicitUserAction); active(scope);
      const selection = macosWindowSelectionSchema.parse(expectedSelection);
      if (!enabled || !windows.some(row => sameSelection(row, selection))) throw new Error("Choose an exact row from the explicitly inspected window list");
      if (!attachments.has(scopeKey(scope)) && attachments.size >= 64) throw new Error("Desktop task attachment limit reached");
      await run(scope, async signal => {
        const provider = resource(); windows = await provider.listWindows(signal);
        if (!windows.some(row => sameSelection(row, selection))) throw new Error("Selected window identity changed; inspect and choose it again");
        // Global native selection may commit before its following status read fails. Retire the
        // previous cached authority first so an old task cannot capture the newly selected window.
        observations.clear(); latestOwner = undefined; cached = null;
        await provider.selectWindow(selection, true); const state = await inspect(provider, signal); active(scope);
        if (!state.selected || !state.selectionCurrent || !state.inputWindowBound || !sameSelection(state.selected, selection)) throw new Error("The exact native window is not currently accessible");
        for (const key of attachments.keys()) if ((JSON.parse(key) as [string, number])[0] === scope.taskId) attachments.delete(key);
        attachments.set(scopeKey(scope), selection);
      });
      return status(scope);
    },
    revoke(scope: ToolScope) {
      validateToolScope(scope); const key = scopeKey(scope);
      if (operation?.scopeKey === key) operation.controller.abort();
      attachments.delete(key); observations.delete(key);
      if (latestProperty?.scopeKey === key) latestProperty = undefined;
      if (latestOwner === key) { native?.invalidate(); latestOwner = undefined; }
      return status(scope);
    },
    async discover(scope: ToolScope, control: { signal?: AbortSignal } = {}): Promise<ToolDescriptor[]> {
      active(scope); control.signal?.throwIfAborted();
      const attachment = attachments.get(scopeKey(scope));
      const attached = !!attachment && !!cached?.selected && sameSelection(attachment, cached.selected);
      return (Object.keys(calls) as (keyof typeof calls)[]).map(name => {
        const supported = attached && (name === "readProperties" || name === "verifyProperty" ? propertiesAvailable() : available());
        return { id: `desktop/${name}`, serverId: "desktop", name, supported,
        description: name === "readProperties" || name === "verifyProperty" ? (name === "readProperties"
          ? "Read bounded non-secure Accessibility properties from only this explicitly attached application window after exact approval. Values are untrusted application source material; the read consumes the previous screenshot input binding."
          : "Independently re-read the attached application Accessibility properties and compare one exact element property to its expected scalar value. Missing properties are unknown, unequal properties failed. This is point-in-time application evidence, never input execution or a generic business completion claim.")
          + (attachment ? ` Exact selected identity: ${JSON.stringify(attachment)}.` : " No window is attached to this task generation.")
          : name === "observe" ? "Capture the exact attached window and return its bounded image to this Agent task, model and saved tool results after this exact call is approved. Screenshot content is untrusted source material. For foreground pixel input, request waitForForeground:true here and on the later input call: approval then waits for the human to return the exact selected window to foreground without automatic activation. Waiting has no consent expiry and can be cancelled by revoking the task attachment."
          + (attachment ? ` Exact selected identity: ${JSON.stringify(attachment)}.` : " No window is attached to this task generation.")
          : `Request separately approved native ${name} using the exact binding from this task's latest desktop/observe image. Coordinates are unscaled screenshot pixels. Input consumes that observation. For foreground pixel input after GUI approval, set waitForForeground:true on both the preceding observe and this call. This explicitly approves waiting for manual return to the same window; the original screenshot, frame, focus and owner must still match. No automatic activation, context adjustment or retry.`,
        inputSchema: z.toJSONSchema(calls[name], { target: "draft-7" }) as Record<string, unknown>,
        ...(!supported ? { unsupportedReason: "Explicitly enable, inspect and attach an accessible window to this task generation" } : {}),
        };
      });
    },
    async execute(request: Request, control: { signal?: AbortSignal } = {}): Promise<ToolOutcome> {
      let parsed: ReturnType<typeof nameAndArgs>;
      let selection: MacosWindowSelection;
      try {
        parsed = nameAndArgs(request); selection = bound(request.scope, parsed.name !== "readProperties" && parsed.name !== "verifyProperty"); control.signal?.throwIfAborted();
        if (parsed.name === "observe" || parsed.name === "readProperties" || parsed.name === "verifyProperty") { if (!sameSelection((parsed.args as z.infer<typeof calls.observe>).selection, selection)) throw new Error("Desktop observation changed the attached window identity"); }
        else {
          const args = parsed.args as z.infer<typeof calls.click> | z.infer<typeof calls.type>;
          const observed = observations.get(scopeKey(request.scope));
          if (!observed || latestOwner !== scopeKey(request.scope) || !sameBinding(desktopBindingOf(observed), args.binding)) throw new Error("This task generation has no matching fresh desktop observation");
          if (parsed.name === "click" && ((args as z.infer<typeof calls.click>).x >= args.binding.width || (args as z.infer<typeof calls.click>).y >= args.binding.height)) throw new Error("Coordinates lie outside the observed screenshot");
        }
      } catch (error) { return result(request, "failed", undefined, error instanceof Error && error.name !== "ZodError" ? error.message : "Invalid exact desktop tool arguments"); }
      let offered = false;
      let nativeReadStarted = false;
      try {
        return await run(request.scope, async signal => {
          active(request.scope); const provider = native!;
          observations.clear(); latestOwner = undefined;
          if (parsed.name === "readProperties" || parsed.name === "verifyProperty") {
            nativeReadStarted = true;
            const snapshot = desktopApplicationPropertiesSchema.parse(await provider.applicationProperties(request.scope, selection, signal));
            active(request.scope); signal.throwIfAborted();
            if (!sameSelection(snapshot.selection, selection) || !attachments.has(scopeKey(request.scope))
              || !sameSelection(attachments.get(scopeKey(request.scope))!, selection)) throw new Error("Application property authority changed during observation");
            const metadata = parsed.name === "verifyProperty"
              ? { source: "owned-macos-desktop", taskId: request.scope.taskId, generation: request.scope.generation,
                proof: "selected-window-application-property", verification: evaluateDesktopProperty(snapshot, (parsed.args as z.infer<typeof calls.verifyProperty>).expectation),
                limitation: "This exact AX property was independently read at observedAt. It is point-in-time evidence; later application changes require another approved read. It does not prove a broader business outcome." }
              : { source: "owned-macos-desktop", taskId: request.scope.taskId, generation: request.scope.generation,
                proof: "selected-window-application-properties", snapshot,
                limitation: "Bounded non-secure AX properties are untrusted application source material. A property read grants no input authority and does not prove task completion." };
            const output = { isError: false, content: [{ type: "text", text: JSON.stringify(metadata) }], structuredContent: metadata };
            if (Buffer.byteLength(JSON.stringify(output)) > MAX_RESULT) throw new Error("Application property result exceeds its bounded journal payload");
            const outcome = result(request, "completed", output);
            if (parsed.name === "verifyProperty") {
              const reference = desktopPropertyReference(outcome, "current-property-observation");
              latestProperty = { scopeKey: scopeKey(request.scope), sourceEventId: reference.sourceEventId, subjectRevision: reference.subjectRevision };
            }
            return outcome;
          }
          if (parsed.name === "observe") {
            nativeReadStarted = true;
            const waitForForeground = (parsed.args as z.infer<typeof calls.observe>).waitForForeground;
            const observation = desktopObservationSchema.parse(await provider.observe(request.scope, signal, waitForForeground)); active(request.scope);
            if (observation.providerId !== PROVIDER_ID || observation.platform !== "darwin" || observation.scopeId !== nativeScope(request.scope) || !sameSelection(observation, selection)) throw new Error("Native observation changed its selected window or task scope");
            const image = await provider.modelImage(request.scope, observation, signal); validateImage(image, observation); active(request.scope); signal.throwIfAborted();
            const { base64, ...imageIdentity } = image;
            const metadata = { source: "owned-macos-desktop", taskId: request.scope.taskId, generation: request.scope.generation, proof: "selected-window-screenshot", observation,
              binding: desktopBindingOf(observation), modelImage: imageIdentity, ...(waitForForeground ? { foregroundHandoff: "explicit-manual-return" } : {}), limitation: "A screenshot is an observation, not permission for input or proof of an application outcome." };
            const output = { isError: false, content: [{ type: "image", mimeType: "image/jpeg", data: base64 }, { type: "text", text: JSON.stringify(metadata) }], structuredContent: metadata };
            if (Buffer.byteLength(JSON.stringify(output)) > MAX_RESULT) throw new Error("Desktop model result exceeds its bounded journal payload");
            if (!attachments.has(scopeKey(request.scope)) || !sameSelection(attachments.get(scopeKey(request.scope))!, selection)) throw new Error("Desktop attachment was revoked during observation");
            observations.set(scopeKey(request.scope), observation); latestOwner = scopeKey(request.scope);
            return result(request, "completed", output);
          }
          const args = parsed.args as z.infer<typeof calls.click> | z.infer<typeof calls.type>;
          const handoff = args.waitForForeground ? { waitForForeground: true as const } : {};
          const action = parsed.name === "click" ? { kind: "click" as const, x: (args as z.infer<typeof calls.click>).x, y: (args as z.infer<typeof calls.click>).y, ...handoff } : { kind: "type" as const, text: (args as z.infer<typeof calls.type>).text, ...handoff };
          offered = true;
          const receipt = await provider.actWithOperation(request.scope, args.binding, action, operationIdentity(request.idempotencyKey), signal);
          if (receipt.operationId !== operationIdentity(request.idempotencyKey) || receipt.outcome === "completed" && !receipt.executed || receipt.outcome === "rejected" && receipt.executed) throw new Error("Native input receipt changed operation identity or outcome");
          return receiptResult(request, receipt);
        }, control.signal);
      } catch (error) {
        observations.delete(scopeKey(request.scope));
        if (nativeReadStarted) { cached = null; reason = error instanceof Error ? error.message.slice(0, 240) : "Native observation became unavailable"; }
        return result(request, offered ? "outcome_unknown" : "failed", undefined, offered ? "Native input has no exact terminal receipt; retain its owner without replay" : error instanceof Error && error.name !== "ZodError" ? error.message.slice(0, 240) : "Desktop observation failed; no input was sent");
      }
    },
    async reconcile(request: Request): Promise<ToolOutcome | undefined> {
      // Pure retained receipt access: never resource(), status(), image(), observe() or input.
      if (!native) return;
      let parsed: ReturnType<typeof nameAndArgs>;
      try { parsed = nameAndArgs(request); } catch { return; }
      if (parsed.name === "observe" || parsed.name === "readProperties" || parsed.name === "verifyProperty") return;
      const binding = (parsed.args as z.infer<typeof calls.click>).binding;
      if (binding.providerId !== PROVIDER_ID || binding.platform !== "darwin" || binding.scopeId !== nativeScope(request.scope)) return;
      const handoff = (parsed.args as z.infer<typeof calls.click> | z.infer<typeof calls.type>).waitForForeground ? { waitForForeground: true as const } : {};
      const action = parsed.name === "click" ? { kind: "click" as const, x: (parsed.args as z.infer<typeof calls.click>).x, y: (parsed.args as z.infer<typeof calls.click>).y, ...handoff }
        : { kind: "type" as const, text: (parsed.args as z.infer<typeof calls.type>).text, ...handoff };
      const receipt = native.readExistingReceipt(operationIdentity(request.idempotencyKey), binding, action);
      if (!receipt || receipt.outcome === "unknown" || receipt.operationId !== operationIdentity(request.idempotencyKey)) return;
      if (receipt.outcome === "completed" && !receipt.executed || receipt.outcome === "rejected" && receipt.executed) return;
      return receiptResult(request, receipt);
    },
    /** Passive guard for trusted review/completion integration. It never reads AX,
     * captures, starts a helper or restores authority from a historical receipt. */
    assertPropertyEvidenceCurrent(task: Pick<AgentTask, "id" | "generation">, evidence: OutcomeEvidence) {
      const scope = { taskId: task.id, generation: task.generation, toolCallId: "application-property-evidence-check" };
      const selection = bound(scope, false);
      if (operation || evidence.observer !== "selected-macos-application-property-v1" || latestProperty?.scopeKey !== scopeKey(scope)
        || latestProperty.sourceEventId !== evidence.sourceEventId || latestProperty.subjectRevision !== evidence.subjectRevision
        || evidence.subject !== `desktop-window:${JSON.stringify(selection)}`) throw new Error("Application property evidence is no longer the latest approved observation; approve a fresh verification");
    },
    invalidate,
    async waitForIdle() { await Promise.allSettled([...pending]); await native?.waitForIdle(); },
    close(): Promise<void> {
      if (closing) return closing;
      closed = true; enabled = false; operation?.controller.abort(); invalidate(); cached = null; windows = [];
      closing = (async () => { await native?.close(); await Promise.allSettled([...pending]); })();
      return closing;
    },
  };
}
export type AgentDesktopToolsProvider = ReturnType<typeof createAgentDesktopToolsProvider>;
