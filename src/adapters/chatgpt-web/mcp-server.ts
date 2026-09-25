import {
  BRIDGE_TOOL_NAMES,
  wireName,
  safeVisibleTools,
  browserToolDescription,
  browserToolParameters,
  execGateway,
  execGatewayProgram,
  gatewayExcludedNames,
  gatewayToolCatalogProgram,
  gatewayToolCatalogPage,
  gatewayToolDescription,
  resolveBrowserInvocation,
  type McpToolRoutingPolicy,
  type ChatGptMcpContract,
} from "./mcp-tool-routing";
import {
  registerNativeTools,
  turnTokenSchema,
  turnReferenceInput,
  turnReference,
  afterSafeStart,
  type ClaimedTurn,
  type McpRequestExtra,
} from "./mcp-native-tools";
export type { ChatGptMcpContract };
import { createHash, randomBytes } from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { observeMcpTransport } from "./mcp-diagnostics";
import * as z from "zod/v4";
import {
  isSpawnCollaborationWireName,
} from "../../collaboration-tools";
import type { CodexTool } from "../../types";
import { VERSION } from "../../version";
import type { ChatGptTurnEnvironment } from "./environment";
import { CODEX_COMPACTION_CONTROL_WIRE_NAME } from "./native-compaction-control";
import {
  callTurnBroker,
  TurnBrokerTimeoutError,
  type BrokerOwnedOperationSnapshot,
  type BrokerOwnedOperationStartResult,
  type BrokerOwnedOperationStatus,
  type BrokerToolResult,
} from "./turn-broker";

const jsonArgumentsSchema = z.record(z.string(), z.unknown()).default({});
// The OpenAI tunnel currently owns a two-minute command-response deadline. The local MCP server
// must settle first so an abandoned native tool call is returned as an MCP error instead of
// letting the tunnel tear down and poison its long-lived stdio transport.
const CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS = 90_000;
const ZERO_RISK_MCP_INSTRUCTIONS = [
  "For each pasted Codex Web GPT request, begin with codex_turn_start using the request_id in its request block.",
  "Use that request_id with the Codex tools needed for the task.",
  "When the task is finished, send the complete answer with codex_turn_complete.",
  "If a tool returns an error, report that error instead of changing the request_id.",
  "A cancelled or timed-out Codex Native tool call retires this entire request_id; do not retry it or use it for sibling calls.",
].join(" ");

function scopeHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

function requestScopeSummary(extra: McpRequestExtra): string {
  const meta = extra._meta && typeof extra._meta === "object" && !Array.isArray(extra._meta)
    ? Object.entries(extra._meta as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => ({
        key,
        type: value === null ? "null" : Array.isArray(value) ? "array" : typeof value,
        ...(typeof value === "string" ? { chars: value.length, hash: scopeHash(value) } : {}),
      }))
    : [];
  const requestInfoKeys = extra.requestInfo && typeof extra.requestInfo === "object"
    ? Object.keys(extra.requestInfo as Record<string, unknown>).sort()
    : [];
  return JSON.stringify({
    requestId: String(extra.requestId),
    session: extra.sessionId ? { chars: extra.sessionId.length, hash: scopeHash(extra.sessionId) } : null,
    meta,
    requestInfoKeys,
  });
}

function result(value: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value) }],
    structuredContent: value,
    ...(isError ? { isError: true } : {}),
  };
}

function chatGptMcpInvocationTimeout(
  environment: ChatGptTurnEnvironment & { expiresAt?: number },
  now = Date.now(),
): number {
  const remaining = environment.expiresAt === undefined
    ? CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS
    : Math.max(1, environment.expiresAt - now);
  return Math.min(CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS, remaining);
}

function asMcpResult(value: BrokerToolResult) {
  return {
    content: value.content as never,
    ...(value.structuredContent !== undefined && value.structuredContent !== null && typeof value.structuredContent === "object"
      ? { structuredContent: value.structuredContent as Record<string, unknown> }
      : {}),
    ...(value.isError ? { isError: true } : {}),
    ...(value._meta !== undefined && value._meta !== null && typeof value._meta === "object"
      ? { _meta: value._meta as Record<string, unknown> }
      : {}),
  };
}

function asOwnedOperationResult(value: BrokerOwnedOperationSnapshot) {
  if (value.state === "completed") {
    const metadata = {
      operation_id: value.operationId,
      state: value.state,
      delivery_id: value.deliveryId,
      acknowledgement_required: true,
    };
    return {
      ...asMcpResult(value.result),
      content: [
        ...(value.result.content as never[]),
        { type: "text" as const, text: JSON.stringify(metadata) },
      ] as never,
      structuredContent: {
        ...metadata,
        ...(value.result.structuredContent !== undefined ? { result: value.result.structuredContent } : {}),
      },
    };
  }
  if (value.state === "failed" || value.state === "cancelled" || value.state === "expired") {
    return result({
      operation_id: value.operationId,
      state: value.state,
      delivery_id: value.deliveryId,
      acknowledgement_required: true,
      message: value.error,
      ...(value.cancellationScope ? { cancellation_scope: value.cancellationScope } : {}),
    }, true);
  }
  return result({
    operation_id: value.operationId,
    state: value.state,
    ...(value.state === "running" ? { poll_again: true } : {}),
  });
}

export async function runChatGptMcpServer(options: {
  brokerSocketPath: string;
  contract?: ChatGptMcpContract;
  allowWebSubagents?: boolean;
  /** Native5-only schema. Native4 and Manual mode must leave this disabled. */
  asyncToolOperations?: boolean;
  /** Adds the Native6 metadata recovery tool without changing Native4/5 schemas. */
  native6?: boolean;
}): Promise<void> {
  const contract = options.contract ?? "native";
  if (options.asyncToolOperations && contract !== "native") {
    throw new Error("Owned async tool operations are unavailable in the Manual mode MCP contract");
  }
  if (options.native6 && (!options.asyncToolOperations || contract !== "native")) {
    throw new Error("Native6 requires async tool operations and the native MCP contract");
  }
  const routingPolicy: McpToolRoutingPolicy = Object.freeze({ contract, allowWebSubagents: options.allowWebSubagents !== false });
  const server = new McpServer(
    { name: contract === "safe" ? "codex-safe" : "codex-native", version: VERSION },
    contract === "safe" ? { instructions: ZERO_RISK_MCP_INSTRUCTIONS } : undefined,
  );

  const claimTurn = async (
    toolName: string,
    turnToken: string,
    extra: McpRequestExtra,
  ): Promise<ClaimedTurn> => {
    console.error(`[chatgpt-web-mcp] ${toolName} scope=${requestScopeSummary(extra)}`);
    const activityId = `activity_${randomBytes(18).toString("base64url")}`;
    try {
      const claimed = await callTurnBroker<Omit<ClaimedTurn, "activityId">>(
        options.brokerSocketPath,
        { method: "claim", token: turnToken, activityId, contract },
        contract === "safe" ? null : 5_000,
        extra.signal,
      );
      return { ...claimed, activityId };
    } catch (error) {
      try {
        await settleTurnActivity(turnToken, activityId);
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Codex Native claim failed and its broker activity could not be retired",
        );
      }
      throw error;
    }
  };

  const settleTurnActivity = async (turnToken: string, activityId: string): Promise<void> => {
    let firstError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await callTurnBroker(options.brokerSocketPath, {
          method: "activity_complete",
          token: turnToken,
          activityId,
        }, 5_000);
        return;
      } catch (error) {
        firstError ??= error;
      }
    }
    throw new AggregateError(
      [firstError],
      "Codex Native broker activity cleanup failed after an idempotent retry",
    );
  };

  const withClaimedTurn = async <T>(
    toolName: string,
    turnToken: string,
    extra: McpRequestExtra,
    action: (claimed: ClaimedTurn) => Promise<T> | T,
  ): Promise<T> => {
    const claimed = await claimTurn(toolName, turnToken, extra);
    let actionFailed = false;
    let actionError: unknown;
    let value: T | undefined;
    try {
      value = await action(claimed);
    } catch (error) {
      actionFailed = true;
      actionError = error;
    }
    let cleanupFailed = false;
    let cleanupError: unknown;
    try {
      // The broker's terminal fence treats even a fully local inventory lookup as live MCP work.
      // Settle the lease without the request AbortSignal: cancellation must not strand activity
      // and silently prevent every later completion candidate from committing.
      await settleTurnActivity(turnToken, claimed.activityId);
    } catch (error) {
      cleanupFailed = true;
      cleanupError = error;
    }
    if (actionFailed) {
      if (cleanupFailed) {
        throw new AggregateError(
          [actionError, cleanupError],
          "Codex Native action failed and its broker activity could not be retired",
        );
      }
      throw actionError;
    }
    if (cleanupFailed) throw cleanupError;
    return value as T;
  };

  if (contract === "safe") {
    server.registerTool(
      "codex_turn_start",
      {
        title: "Connect a Codex Manual mode request",
        description: "Connect the request_id included in the pasted Codex Web GPT request so its Codex tools can be used.",
        inputSchema: {
          request_id: turnTokenSchema,
        },
        outputSchema: {
          started: z.literal(true),
          duplicate: z.boolean(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ request_id }, extra) => {
        console.error(`[chatgpt-web-mcp] codex_turn_start scope=${requestScopeSummary(extra)}`);
        const response = await callTurnBroker<{ started: true; duplicate: boolean }>(options.brokerSocketPath, {
          method: "safe_start",
          token: request_id,
        }, 5_000, extra.signal);
        return result(response);
      },
    );
  }

  const invoke = async (
    bindingId: string,
    bound: ChatGptTurnEnvironment & { expiresAt?: number },
    tool: CodexTool,
    payload: { arguments?: Record<string, unknown>; input?: string },
    signal?: AbortSignal,
  ) => {
    const timeoutMs = chatGptMcpInvocationTimeout(bound);
    try {
      const response = await callTurnBroker<BrokerToolResult>(options.brokerSocketPath, {
        method: "invoke",
        bindingId,
        wireName: wireName(tool),
        freeform: tool.freeform === true,
        ...(tool.freeform ? { input: payload.input ?? "" } : { arguments: payload.arguments ?? {} }),
      }, timeoutMs, signal);
      return asMcpResult(response);
    } catch (error) {
      // Whole-turn cancellation is the deliberate transport contract. This MCP request does not
      // receive the broker's native callId, and a native tool already delivered to Codex can
      // still finish (or cause side effects) after the MCP request aborts. Retiring only this
      // pending promise would let late native results escape their consumer while siblings reuse
      // the same binding. Revoke the shared turn on any invocation transport failure; siblings
      // fail explicitly and the native result cannot be presented as a successful MCP response.
      try {
        await callTurnBroker(options.brokerSocketPath, {
          method: "release",
          bindingId,
        });
      } catch (releaseError) {
        throw new AggregateError(
          [error, releaseError],
          "Codex Native invocation failed and its abandoned broker binding could not be retired",
        );
      }
      if (error instanceof TurnBrokerTimeoutError) {
        const toolName = wireName(tool);
        console.error(
          `[chatgpt-web-mcp] ${toolName} did not complete within ${timeoutMs}ms; retired its turn binding`,
        );
        return result({
          code: "codex_tool_timeout",
          tool: toolName,
          timeout_ms: timeoutMs,
          retryable: false,
          message: `Codex tool ${toolName} did not complete before the MCP transport deadline. The current turn binding was retired; do not retry it in this ChatGPT response.`,
        }, true);
      }
      throw error;
    }
  };

  const invokeNestedNative = (
    bindingId: string,
    bound: ChatGptTurnEnvironment & { expiresAt?: number },
    nestedToolName: string,
    freeform: boolean,
    payload: { arguments?: Record<string, unknown>; input?: string },
    signal?: AbortSignal,
  ) => {
    const gateway = execGateway(bound);
    if (!gateway) {
      throw new Error(`This Codex turn did not advertise ${nestedToolName} or the native exec gateway`);
    }
    return invoke(bindingId, bound, gateway, {
      input: execGatewayProgram(nestedToolName, freeform, payload, gatewayExcludedNames(bound, routingPolicy)),
    }, signal);
  };

  registerNativeTools(server, { contract, withClaimedTurn, invoke, invokeNestedNative });

  server.registerTool(
    "codex_tool_inventory",
    {
      title: "Discover tools from the current Codex harness",
      description: contract === "safe"
        ? "List tools available to the connected Manual mode request, including configured MCP and app tools."
        : "Search the exact tool registry supplied to the current outer Codex turn, including configured MCP/app tools.",
      inputSchema: {
        ...turnReferenceInput(contract),
        query: z.string().max(500).optional(),
        offset: z.number().int().min(0).max(100_000).default(0),
        limit: z.number().int().min(1).max(50).default(20),
        include_schema: z.boolean().default(true),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input, extra) => withClaimedTurn(
      "codex_tool_inventory",
      turnReference(contract, input),
      extra,
      async claimed => {
        const { query, offset, limit, include_schema } = input;
        const bound = claimed.environment;
        const needle = query?.trim().toLowerCase();
        const visibleTools = safeVisibleTools(bound, routingPolicy);
        const directMatches = visibleTools.filter(tool => !needle || [
          wireName(tool),
          tool.name,
          tool.namespace ?? "",
          tool.description,
        ].join("\n").toLowerCase().includes(needle));
        const directPage = directMatches.slice(offset, offset + limit).map(tool => ({
          wire_name: wireName(tool),
          name: tool.name,
          namespace: tool.namespace ?? null,
          description: browserToolDescription(tool),
          kind: tool.freeform ? "freeform" : tool.toolSearch ? "tool_search" : "function",
          ...(include_schema ? { parameters: browserToolParameters(tool) } : {}),
        }));
        let nestedTotal = 0;
        let nestedPage: Array<Record<string, unknown>> = [];
        const gateway = execGateway(bound);
        if (gateway) {
          const excludedGatewayNames = gatewayExcludedNames(bound, routingPolicy);
          const nestedOffset = Math.max(0, offset - directMatches.length);
          const nestedLimit = Math.max(0, limit - directPage.length);
          const response = await invoke(claimed.bindingId, bound, gateway, {
            input: gatewayToolCatalogProgram({
              query,
              offset: nestedOffset,
              limit: nestedLimit,
              // A gateway-discovered entry may supplement the outer registry, but it must never
              // duplicate or reopen an outer tool that this contract deliberately hid (including
              // our own MCP namespace in Zero Risk).
              excludedNames: excludedGatewayNames,
            }),
          }, extra.signal);
          const catalog = gatewayToolCatalogPage(response, new Set(excludedGatewayNames));
          nestedTotal = catalog.total;
          nestedPage = catalog.tools.map(tool => ({
            wire_name: tool.name,
            name: tool.name,
            namespace: null,
            description: gatewayToolDescription(tool),
            kind: "gateway",
            ...(include_schema ? {
              parameters: {
                type: "object",
                additionalProperties: true,
                description: "Pass the exact structured arguments declared in this tool's description. For a declared freeform tool, use codex_tool_call.input instead.",
              },
            } : {}),
          }));
        }
        const page = [...directPage, ...nestedPage];
        const total = directMatches.length + nestedTotal;
        // A filtered miss need not mean deferred tools are unavailable. Advertise only the
        // current contract's visible native search tools, separately from matches/pagination.
        // This does not invoke discovery or widen Native/Manual or subagent visibility.
        const discoveryTools = needle && total === 0
          ? visibleTools.filter(tool => tool.toolSearch).map(tool => ({
            wire_name: wireName(tool),
            name: tool.name,
            namespace: tool.namespace ?? null,
            description: browserToolDescription(tool),
            kind: "tool_search",
            ...(include_schema ? { parameters: browserToolParameters(tool) } : {}),
          }))
          : [];
        return result({
          tools: page,
          total,
          next_offset: offset + page.length < total ? offset + page.length : null,
          ...(discoveryTools.length > 0 ? { discovery_tools: discoveryTools } : {}),
        });
      },
    ),
  );

  server.registerTool(
    "codex_tool_call",
    {
      title: "Call any tool from the current Codex harness",
      description: afterSafeStart(contract, "Invoke an exact wire_name returned by codex_tool_inventory. The outer Codex runtime performs the call, approvals, and UI lifecycle."),
      inputSchema: {
        ...turnReferenceInput(contract),
        wire_name: z.string().min(1).max(1_000),
        arguments: jsonArgumentsSchema.optional(),
        input: z.string().max(5_000_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (toolInput, extra) => {
      const { wire_name, arguments: args, input } = toolInput;
      if (options.allowWebSubagents === false && isSpawnCollaborationWireName(wire_name)) {
        throw new Error(`Web subagents are disabled: ${wire_name}`);
      }
      const requestId = turnReference(contract, toolInput);
      if (contract === "native" && wire_name === CODEX_COMPACTION_CONTROL_WIRE_NAME) {
        if (input !== undefined) {
          throw new Error("Compaction control handoff does not accept freeform input");
        }
        const handoffId = args?.handoff_id;
        const summary = args?.summary;
        if (typeof handoffId !== "string" || handoffId.length === 0) {
          throw new Error("Compaction control handoff requires handoff_id");
        }
        if (typeof summary !== "string") {
          throw new Error("Compaction control handoff requires summary");
        }
        await callTurnBroker(options.brokerSocketPath, {
          method: "submit_compaction_handoff",
          token: requestId,
          handoffId,
          summary,
        }, 5_000, extra.signal);
        return result({ submitted: true });
      }
      return withClaimedTurn("codex_tool_call", requestId, extra, async claimed => {
        const invocation = resolveBrowserInvocation(routingPolicy, claimed.environment, wire_name, args, input);
        return invoke(claimed.bindingId, claimed.environment, invocation.tool, invocation.payload, extra.signal);
      });
    },
  );

  if (options.native6) {
    server.registerTool(
      "codex_tool_status",
      {
        title: "Recover owned operation metadata",
        description: "Native6 only. List all live/unacknowledged operations plus the newest acknowledged guards, up to 64 identities, without delivery IDs. The truncated and omitted fields report older acknowledged guards that remain protected from replay until turn retirement. Returns metadata only and never acknowledges or restarts work. Poll a recovered terminal operation to receive its result and delivery_id before acknowledging that exact delivery_id. Expired payloads cannot be recovered and never authorize rerunning side effects.",
        inputSchema: { turn_token: turnTokenSchema },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ turn_token }, extra) => withClaimedTurn("codex_tool_status", turn_token, extra, async () => {
        const status = await callTurnBroker<BrokerOwnedOperationStatus>(options.brokerSocketPath, {
          method: "operation_status", token: turn_token,
        }, 5_000, extra.signal);
        return result({ ...status });
      }),
    );
  }

  if (options.asyncToolOperations) {
    server.registerTool(
      "codex_tool_start",
      {
        title: "Start a long native Codex tool operation",
        description: options.native6
          ? "Native6 only. Start an exact wire_name once under operation_key. Reuse the same operation_key after an ambiguous transport failure, then use codex_tool_poll until terminal and acknowledge its delivery_id."
          : "Native5 only. Start an exact wire_name once under operation_key. Reuse the same operation_key after an ambiguous transport failure, then use codex_tool_poll until terminal and acknowledge its delivery_id.",
        inputSchema: {
          turn_token: turnTokenSchema,
          operation_key: z.string().regex(/^[A-Za-z0-9_-]{16,128}$/),
          wire_name: z.string().min(1).max(1_000),
          arguments: jsonArgumentsSchema.optional(),
          input: z.string().max(5_000_000).optional(),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      async (toolInput, extra) => {
        const { turn_token, operation_key, wire_name, arguments: args, input } = toolInput;
        if (options.allowWebSubagents === false && isSpawnCollaborationWireName(wire_name)) {
          throw new Error(`Web subagents are disabled: ${wire_name}`);
        }
        const operationId = `operation_${createHash("sha256")
          .update(`${turn_token}\0${operation_key}`)
          .digest("base64url")}`;
        return withClaimedTurn("codex_tool_start", turn_token, extra, async claimed => {
          if (claimed.environment.producer === "hermes") {
            throw new Error("Owned async Codex operations are unavailable for Hermes-origin turns");
          }
          const invocation = resolveBrowserInvocation(routingPolicy, claimed.environment, wire_name, args, input);
          const snapshot = await callTurnBroker<BrokerOwnedOperationStartResult>(options.brokerSocketPath, {
            method: "invoke_async",
            token: turn_token,
            bindingId: claimed.bindingId,
            operationId,
            wireName: wireName(invocation.tool),
            freeform: invocation.tool.freeform === true,
            ...(invocation.tool.freeform
              ? { input: invocation.payload.input ?? "" }
              : { arguments: invocation.payload.arguments ?? {} }),
          }, 5_000, extra.signal);
          return snapshot.state === "control" ? asMcpResult(snapshot.result) : asOwnedOperationResult(snapshot);
        });
      },
    );

    server.registerTool(
      "codex_tool_poll",
      {
        title: "Poll or acknowledge a long native Codex tool operation",
        description: options.native6
          ? "Native6 only. Wait at most 30 seconds for an owned operation. A poll timeout or disconnect never restarts or retires it. After receiving a terminal result, call again with its exact delivery_id to acknowledge and release it."
          : "Native5 only. Wait at most 30 seconds for an owned operation. A poll timeout or disconnect never restarts or retires it. After receiving a terminal result, call again with its exact delivery_id to acknowledge and release it.",
        inputSchema: {
          turn_token: turnTokenSchema,
          operation_id: z.string().regex(/^operation_[A-Za-z0-9_-]{32,128}$/),
          wait_ms: z.number().int().min(0).max(30_000).default(30_000),
          ack_delivery_id: z.string().regex(/^delivery_[A-Za-z0-9_-]{32,128}$/).optional(),
        },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ turn_token, operation_id, wait_ms, ack_delivery_id }, extra) => {
        return withClaimedTurn("codex_tool_poll", turn_token, extra, async () => {
          const snapshot = await callTurnBroker<BrokerOwnedOperationSnapshot>(options.brokerSocketPath, {
            method: "operation_poll",
            token: turn_token,
            operationId: operation_id,
            waitMs: wait_ms,
            ...(ack_delivery_id ? { deliveryId: ack_delivery_id } : {}),
          }, wait_ms + 5_000, extra.signal);
          return asOwnedOperationResult(snapshot);
        });
      },
    );

    server.registerTool(
      "codex_tool_cancel",
      {
        title: "Cancel observation of one long native Codex tool operation",
        description: options.native6
          ? "Native6 only. Cancels a queued call before dispatch. After dispatch it cancels only this operation's observation; the external tool and side effects may continue. Sibling calls and the owning turn remain active. Acknowledge the returned delivery_id with codex_tool_poll."
          : "Native5 only. Cancels a queued call before dispatch. After dispatch it cancels only this operation's observation; the external tool and side effects may continue. Sibling calls and the owning turn remain active. Acknowledge the returned delivery_id with codex_tool_poll.",
        inputSchema: {
          turn_token: turnTokenSchema,
          operation_id: z.string().regex(/^operation_[A-Za-z0-9_-]{32,128}$/),
        },
        annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
      },
      async ({ turn_token, operation_id }, extra) => {
        return withClaimedTurn("codex_tool_cancel", turn_token, extra, async () => {
          const snapshot = await callTurnBroker<BrokerOwnedOperationSnapshot>(options.brokerSocketPath, {
            method: "operation_cancel",
            token: turn_token,
            operationId: operation_id,
          }, 5_000, extra.signal);
          return asOwnedOperationResult(snapshot);
        });
      },
    );
  }

  if (contract === "safe") {
    server.registerTool(
      "codex_turn_complete",
      {
        title: "Return the result to Codex",
        description: "Send the complete answer back to the connected Codex request after its work is finished. For compaction, send the requested compacted summary.",
        inputSchema: {
          request_id: turnTokenSchema,
          final_answer: z.string().min(1).max(5_000_000),
        },
        outputSchema: {
          completed: z.literal(true),
          duplicate: z.boolean(),
        },
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ request_id, final_answer }, extra) => {
        console.error(`[chatgpt-web-mcp] codex_turn_complete scope=${requestScopeSummary(extra)}`);
        const response = await callTurnBroker<{ completed: true; duplicate: boolean }>(options.brokerSocketPath, {
          method: "safe_complete",
          token: request_id,
          finalAnswer: final_answer,
        }, null, extra.signal);
        return result(response);
      },
    );
  }

  await server.connect(observeMcpTransport(new StdioServerTransport(), BRIDGE_TOOL_NAMES));
}
