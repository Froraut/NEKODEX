import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { StandaloneToolsPort, ToolScope } from "../agent-tools/types";
import type { BrowserCompanionHost } from "./host";
import { browserBindingOf, type BrowserAction, type BrowserBinding, type BrowserObservation, type CompanionReceipt } from "./protocol";

export interface BrowserProviderPort {
  capabilities(): { providerId: string; available: boolean; actions: readonly string[]; reason?: string };
  /** Selected document anchor survives consumed input; it permits a fresh read, never stale input. */
  selected(): BrowserBinding | undefined;
  receipt(operationId: string): CompanionReceipt | undefined;
  current(): BrowserObservation | undefined;
  observe(binding: BrowserBinding, signal?: AbortSignal, operationId?: string, options?: { includeImage?: boolean }): Promise<CompanionReceipt>;
  act(binding: BrowserBinding, action: BrowserAction, signal?: AbortSignal, operationId?: string): Promise<CompanionReceipt>;
}
export function createCompanionBrowserProvider(host: BrowserCompanionHost): BrowserProviderPort {
  return {
    capabilities: () => ({ providerId: "chrome-companion-v1", available: host.status().paired && host.status().connected && !!host.status().selected,
      actions: ["observe", "click", "type"], ...(!host.status().paired ? { reason: "Pair the extension explicitly" } : !host.status().selected ? { reason: "Select a tab in the extension popup" } : !host.status().connected ? { reason: "Keep the selected tab's extension popup open" } : {}) }),
    selected: () => host.status().selected ?? undefined,
    receipt: host.receipt,
    current: host.observation, observe: host.observe, act: host.act,
  };
}

const identity = z.string().min(1).max(160);
export const desktopBindingSchema = z.object({
  providerId: identity, scopeId: identity, observationId: identity,
  platform: z.enum(["darwin", "win32"]), windowId: identity, processId: identity, windowEpoch: identity,
  frameId: identity, frameEpoch: identity, screenshotId: identity,
  coordinateSpace: z.literal("screenshot-pixels"), width: z.number().int().positive().max(32_768), height: z.number().int().positive().max(32_768),
}).strict();
export const desktopObservationSchema = desktopBindingSchema.extend({
  kind: z.literal("desktop"),
  /** Opaque provider resource, not an arbitrary URL to fetch. No screenshot data is persisted here. */
  screenshotResource: z.string().min(1).max(1024),
}).strict();
export const desktopActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("type"), text: z.string().max(8000) }).strict(),
]);
export type DesktopBinding = z.infer<typeof desktopBindingSchema>;
export type DesktopObservation = z.infer<typeof desktopObservationSchema>;
export type DesktopAction = z.infer<typeof desktopActionSchema>;
export interface DesktopReceipt { operationId: string; outcome: "completed" | "rejected" | "unknown" | "not_sent"; executed: boolean; reason?: string }
export interface DesktopProviderPort {
  capabilities(scope: ToolScope, signal?: AbortSignal): Promise<{ available: boolean; platform: "darwin" | "win32"; reason?: string }>;
  observe(scope: ToolScope, signal?: AbortSignal): Promise<DesktopObservation>;
  act(scope: ToolScope, binding: DesktopBinding, action: DesktopAction, signal?: AbortSignal): Promise<DesktopReceipt>;
  invalidate(): void;
}
export function desktopBindingOf(value: DesktopBinding): DesktopBinding {
  return desktopBindingSchema.parse(Object.fromEntries(Object.keys(desktopBindingSchema.shape).map(key => [key, value[key as keyof DesktopBinding]])));
}
export function toolSchemaDigest(schema: Record<string, unknown>): string {
  // Discovery and pin creation use the same canonical digest, independent of object key order.
  const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value);
  return createHash("sha256").update(canonical(schema)).digest("hex");
}
export interface McpDesktopProviderOptions {
  port: StandaloneToolsPort;
  providerId: string;
  platform: "darwin" | "win32";
  /** Only explicitly installed tools implementing the exact-observation protocol qualify. */
  contract: "nekodex.observation-input.v1";
  observeTool: { id: string; schemaDigest: string };
  inputTool: { id: string; schemaDigest: string };
  /** Trusted admission/approval owner; this callback must never be supplied by model arguments. */
  grant(request: { scope: ToolScope; tool: string; arguments: Record<string, unknown> }): Promise<string> | string;
}
const inputReceiptSchema = z.object({ operationId: identity, outcome: z.enum(["completed", "rejected", "unknown"]), executed: z.boolean(), reason: z.string().max(240).optional() }).strict();

/** A supported MCP route, not native OS capture/input. The installed provider must validate the
 * observation binding again immediately before input, including human/window/frame changes. */
export function createMcpDesktopProvider(options: McpDesktopProviderOptions): DesktopProviderPort {
  if (options.contract !== "nekodex.observation-input.v1") throw new Error("Desktop provider lacks the observation-bound input contract");
  let latest: DesktopObservation | undefined;
  let scopeKey: string | undefined;
  let busy = false;
  let uncertain = false;
  let generation = 0;
  const key = (scope: ToolScope) => `${scope.taskId}\0${scope.generation}`;
  async function capabilities(scope: ToolScope, signal?: AbortSignal) {
    try {
      const tools = await options.port.discover(scope, { signal });
      for (const pin of [options.observeTool, options.inputTool]) {
        const tool = tools.find(row => row.id === pin.id);
        if (!tool?.supported || toolSchemaDigest(tool.inputSchema) !== pin.schemaDigest) return { available: false, platform: options.platform, reason: "Pinned observation provider is unavailable or its schema changed" };
      }
      return { available: true, platform: options.platform };
    } catch { return { available: false, platform: options.platform, reason: "Desktop provider discovery failed; no OS input was sent" }; }
  }
  async function invoke(scope: ToolScope, tool: string, args: Record<string, unknown>, operationId: string, signal?: AbortSignal) {
    signal?.throwIfAborted();
    const grantId = await options.grant({ scope, tool, arguments: args });
    signal?.throwIfAborted();
    return options.port.invoke({ scope, tool, arguments: args, grantId, idempotencyKey: operationId }, { signal });
  }
  function structured(value: unknown): unknown {
    if (!value || typeof value !== "object" || (value as Record<string, unknown>).isError === true) throw new Error("MCP provider did not return a successful structured receipt");
    return (value as Record<string, unknown>).structuredContent;
  }
  return {
    capabilities,
    async observe(scope, signal) {
      if (busy || uncertain) throw new Error("Desktop provider is active or has an uncertain input outcome");
      busy = true; const revision = generation;
      latest = undefined;
      try {
        const state = await capabilities(scope, signal);
        if (!state.available) throw new Error(state.reason);
        const result = await invoke(scope, options.observeTool.id, { contract: options.contract, providerId: options.providerId, platform: options.platform, scopeId: key(scope) }, randomUUID(), signal);
        if (result.state !== "completed") throw new Error("Desktop observation is unavailable");
        const observed = desktopObservationSchema.parse(structured(result.result));
        if (observed.providerId !== options.providerId || observed.platform !== options.platform || observed.scopeId !== key(scope) || revision !== generation) throw new Error("Desktop observation changed provider or scope");
        latest = observed; scopeKey = key(scope);
        return structuredClone(observed);
      } finally { busy = false; }
    },
    async act(scope, bindingValue, actionValue, signal) {
      if (busy || uncertain) throw new Error("Desktop provider is active or has an uncertain input outcome");
      const binding = desktopBindingSchema.parse(bindingValue);
      const action = desktopActionSchema.parse(actionValue);
      if (!latest || scopeKey !== key(scope) || JSON.stringify(desktopBindingOf(latest)) !== JSON.stringify(binding)) throw new Error("Stale or foreign desktop observation");
      if (action.kind === "click" && (action.x >= binding.width || action.y >= binding.height)) throw new Error("Input coordinates lie outside the observed screenshot");
      busy = true;
      const revision = generation, operationId = randomUUID();
      let offered = false;
      try {
        const state = await capabilities(scope, signal);
        if (!state.available) return { operationId, outcome: "not_sent", executed: false, reason: state.reason };
        const args = { contract: options.contract, operationId, binding, action };
        const grantId = await options.grant({ scope, tool: options.inputTool.id, arguments: args });
        signal?.throwIfAborted();
        if (revision !== generation || !latest) return { operationId, outcome: "not_sent", executed: false, reason: "Observation was invalidated before dispatch" };
        latest = undefined; offered = true;
        const result = await options.port.invoke({ scope, tool: options.inputTool.id, arguments: args, grantId, idempotencyKey: operationId }, { signal });
        if (result.state !== "completed") { uncertain = true; return { operationId, outcome: "unknown", executed: false, reason: "MCP input has no terminal execution receipt; reconcile the exact operation" }; }
        const receipt = inputReceiptSchema.parse(structured(result.result));
        if (receipt.operationId !== operationId) throw new Error("Desktop receipt changed operation identity");
        if ((receipt.outcome === "completed" && !receipt.executed) || (receipt.outcome === "rejected" && receipt.executed)) throw new Error("Desktop receipt does not establish the claimed input outcome");
        uncertain = receipt.outcome === "unknown";
        return receipt;
      } catch (error) {
        if (offered) uncertain = true;
        return { operationId, outcome: offered ? "unknown" : "not_sent", executed: false, reason: error instanceof Error ? error.message.slice(0, 240) : "Desktop input failed" };
      } finally { busy = false; }
    },
    invalidate() { generation++; latest = undefined; scopeKey = undefined; },
  };
}

/** Capability-only adapter: binding an extension tab does not admit an alternate ChatGPT sender.
 * The existing account/tunnel/turn owner must authorize and execute the actual send. */
export function companionChatGptCapability(host: BrowserCompanionHost, account: { accountId: string; identityEpoch: string; tabId: number; documentId: string } | undefined) {
  const observed = host.observation();
  const exact = !!account && !!observed && new URL(observed.url).origin === "https://chatgpt.com" && observed.tabId === account.tabId && observed.documentId === account.documentId;
  return { transport: "chrome-companion" as const, paired: host.status().paired, observedChatGptDocument: exact,
    sendSupported: false as const, reason: exact ? "Companion observation is available; existing turn/account owner has not admitted a companion send" : "Select and bind the exact ChatGPT account document first",
    ...(exact ? { accountId: account!.accountId, identityEpoch: account!.identityEpoch, binding: browserBindingOf(observed!) } : {}) };
}
