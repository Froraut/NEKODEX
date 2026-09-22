import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import * as z from "zod/v4";
import type { CodexTool } from "../../types";
import type { ChatGptTurnEnvironment } from "./environment";
import { assertCommandEscalationSchema, hasCommandEscalation } from "./command-escalation";
import { exactTool, exactCodexAppTool, execGateway, execCommandGatewayProgram, type ChatGptMcpContract } from "./mcp-tool-routing";

export interface ClaimedTurn {
  bindingId: string;
  activityId: string;
  environment: ChatGptTurnEnvironment & { expiresAt?: number };
}

export interface McpRequestExtra {
  sessionId?: string;
  requestId: string | number;
  _meta?: unknown;
  requestInfo?: unknown;
  signal?: AbortSignal;
}

// Polling earlier preserves the native session and leaves room for MCP delivery.
export const CHATGPT_WEB_WRITE_STDIN_MAX_FORWARD_YIELD_MS = 60_000;

export const turnTokenSchema = z.string().min(20).max(256);

export function turnReferenceInput(contract: ChatGptMcpContract): Record<string, z.ZodString> {
  return contract === "safe"
    ? { request_id: turnTokenSchema }
    : { turn_token: turnTokenSchema };
}

export function turnReference(contract: ChatGptMcpContract, input: object): string {
  const key = contract === "safe" ? "request_id" : "turn_token";
  const value = (input as Record<string, unknown>)[key];
  if (typeof value !== "string") throw new Error(`${key} is required`);
  return value;
}

export function afterSafeStart(contract: ChatGptMcpContract, description: string): string {
  return contract === "safe"
    ? `For a Manual mode request connected by codex_turn_start. ${description}`
    : description;
}

export interface NativeToolContext {
  readonly contract: ChatGptMcpContract;
  withClaimedTurn<T>(toolName: string, token: string, extra: McpRequestExtra, action: (claimed: ClaimedTurn) => Promise<T> | T): Promise<T>;
  invoke(bindingId: string, environment: ClaimedTurn["environment"], tool: CodexTool, payload: NativeToolPayload, signal?: AbortSignal): Promise<CallToolResult>;
  invokeNestedNative(bindingId: string, environment: ClaimedTurn["environment"], name: string, freeform: boolean, payload: NativeToolPayload, signal?: AbortSignal): Promise<CallToolResult>;
}

export interface NativeToolPayload { arguments?: Record<string, unknown>; input?: string }

export function registerNativeTools(server: McpServer, context: NativeToolContext): void {
  const { contract, withClaimedTurn, invoke, invokeNestedNative } = context;
  server.registerTool(
    "codex_exec",
    {
      title: "Run a native Codex command",
      description: afterSafeStart(contract, "Invoke the command tool advertised by the current outer Codex harness. A long-running command returns its native session_id."),
      inputSchema: {
        ...turnReferenceInput(contract),
        cmd: z.string().min(1).max(100_000),
        workdir: z.string().max(16_384).optional(),
        yield_time_ms: z.number().int().min(250).max(30_000).optional(),
        max_output_tokens: z.number().int().min(1).max(1_000_000).optional(),
        tty: z.boolean().optional(),
        sandbox_permissions: z.enum(["use_default", "require_escalated"]).optional(),
        justification: z.string().min(1).max(16_384).optional(),
        prefix_rule: z.array(z.string().min(1).max(16_384)).min(1).max(100).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (input, extra) => withClaimedTurn(
      "codex_exec",
      turnReference(contract, input),
      extra,
      async claimed => {
        const { cmd, workdir, yield_time_ms, max_output_tokens, tty,
          sandbox_permissions, justification, prefix_rule } = input;
        const bound = claimed.environment;
        const escalation = { sandbox_permissions, justification, prefix_rule };
        const execCommandArguments = {
          cmd,
          ...(workdir ? { workdir } : {}),
          ...(yield_time_ms !== undefined ? { yield_time_ms } : {}),
          ...(max_output_tokens !== undefined ? { max_output_tokens } : {}),
          ...(tty !== undefined ? { tty } : {}),
          ...(sandbox_permissions !== undefined ? { sandbox_permissions } : {}),
          ...(justification !== undefined ? { justification } : {}),
          ...(prefix_rule !== undefined ? { prefix_rule } : {}),
        };
        const shellCommandArguments = {
          command: cmd,
          ...(workdir ? { workdir } : {}),
          ...(yield_time_ms !== undefined ? { timeout_ms: yield_time_ms } : {}),
          ...(sandbox_permissions !== undefined ? { sandbox_permissions } : {}),
          ...(justification !== undefined ? { justification } : {}),
          ...(prefix_rule !== undefined ? { prefix_rule } : {}),
        };
        const tool = exactTool(bound, "exec_command") ?? exactTool(bound, "shell_command");
        if (tool) {
          if (hasCommandEscalation(escalation)
            && bound.tools.filter(candidate => !candidate.namespace && candidate.name === tool.name).length !== 1) {
            throw new Error(`Native ${tool.name} has an ambiguous command schema for approval arguments`);
          }
          assertCommandEscalationSchema(tool, escalation);
          if (tool.name === "shell_command" && (max_output_tokens !== undefined || tty !== undefined)) {
            throw new Error("Native shell_command does not support codex_exec max_output_tokens or tty");
          }
          const args = tool.name === "exec_command" ? execCommandArguments : shellCommandArguments;
          return invoke(claimed.bindingId, bound, tool, { arguments: args }, extra.signal);
        }
        const gateway = execGateway(bound);
        if (!gateway) {
          throw new Error("This Codex turn did not advertise a native command tool or the native exec gateway");
        }
        if (hasCommandEscalation(escalation)) {
          throw new Error("Native exec gateway has no exact command JSON schema for approval arguments; use codex_tool_inventory and codex_tool_call with an advertised structured command tool");
        }
        return invoke(claimed.bindingId, bound, gateway, {
          input: execCommandGatewayProgram(execCommandArguments, shellCommandArguments),
        }, extra.signal);
      },
    ),
  );

  server.registerTool(
    "codex_write_stdin",
    {
      title: "Continue a native Codex command session",
      description: afterSafeStart(contract, "Write characters to, or poll, a session_id returned by codex_exec."),
      inputSchema: {
        ...turnReferenceInput(contract),
        session_id: z.number().int().nonnegative(),
        chars: z.string().max(1_000_000).optional(),
        yield_time_ms: z.number().int().min(250).max(300_000).optional(),
        max_output_tokens: z.number().int().min(1).max(1_000_000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async (input, extra) => withClaimedTurn(
      "codex_write_stdin",
      turnReference(contract, input),
      extra,
      async claimed => {
        const { session_id, chars, yield_time_ms, max_output_tokens } = input;
        const bound = claimed.environment;
        const tool = exactTool(bound, "write_stdin");
        const forwardedYieldMs = yield_time_ms === undefined ? undefined
          : Math.min(yield_time_ms, CHATGPT_WEB_WRITE_STDIN_MAX_FORWARD_YIELD_MS);
        const payload = { arguments: {
          session_id,
          ...(chars !== undefined ? { chars } : {}),
          ...(forwardedYieldMs !== undefined ? { yield_time_ms: forwardedYieldMs } : {}),
          ...(max_output_tokens !== undefined ? { max_output_tokens } : {}),
        } };
        return tool
          ? invoke(claimed.bindingId, bound, tool, payload, extra.signal)
          : invokeNestedNative(claimed.bindingId, bound, "write_stdin", false, payload, extra.signal);
      },
    ),
  );

  server.registerTool(
    "codex_apply_patch",
    {
      title: "Apply a native Codex patch",
      description: afterSafeStart(contract, "Invoke the outer Codex apply_patch tool, producing a native file-change item in the Codex task."),
      inputSchema: { ...turnReferenceInput(contract), patch: z.string().min(1).max(5_000_000) },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false },
    },
    async (input, extra) => withClaimedTurn(
      "codex_apply_patch",
      turnReference(contract, input),
      extra,
      async claimed => {
        const { patch } = input;
        const bound = claimed.environment;
        const tool = exactTool(bound, "apply_patch");
        if (!tool) return invokeNestedNative(claimed.bindingId, bound, "apply_patch", true, { input: patch }, extra.signal);
        return tool.freeform
          ? invoke(claimed.bindingId, bound, tool, { input: patch }, extra.signal)
          : invoke(claimed.bindingId, bound, tool, { arguments: { input: patch } }, extra.signal);
      },
    ),
  );

  server.registerTool(
    "codex_view_image",
    {
      title: "View an image through native Codex",
      description: afterSafeStart(contract, "Invoke the outer Codex view_image tool and return its multimodal result to this same ChatGPT response."),
      inputSchema: {
        ...turnReferenceInput(contract),
        path: z.string().min(1).max(16_384),
        detail: z.enum(["high", "original"]).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input, extra) => withClaimedTurn(
      "codex_view_image",
      turnReference(contract, input),
      extra,
      async claimed => {
        const { path, detail } = input;
        const bound = claimed.environment;
        const tool = exactTool(bound, "view_image");
        const payload = { arguments: { path, ...(detail ? { detail } : {}) } };
        return tool
          ? invoke(claimed.bindingId, bound, tool, payload, extra.signal)
          : invokeNestedNative(claimed.bindingId, bound, "view_image", false, payload, extra.signal);
      },
    ),
  );

  server.registerTool(
    "codex_read_thread",
    {
      title: "Read a referenced Codex task",
      description: afterSafeStart(
        contract,
        "Invoke the outer Codex read_thread tool for a referenced task. This action is read-only and cannot continue, archive, or otherwise modify the task.",
      ),
      inputSchema: {
        ...turnReferenceInput(contract),
        threadId: z.string().min(1).max(256),
        cursor: z.string().max(16_384).optional(),
        hostId: z.string().max(256).optional(),
        includeOutputs: z.boolean().optional(),
        maxOutputCharsPerItem: z.number().int().min(1).max(1_000_000).optional(),
        turnLimit: z.number().int().min(1).max(10).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input, extra) => withClaimedTurn(
      "codex_read_thread",
      turnReference(contract, input),
      extra,
      async claimed => {
        const { threadId, cursor, hostId, includeOutputs, maxOutputCharsPerItem, turnLimit } = input;
        const tool = exactCodexAppTool(claimed.environment, "read_thread");
        if (!tool) throw new Error("The current outer Codex turn does not advertise read_thread");
        return invoke(claimed.bindingId, claimed.environment, tool, {
          arguments: {
            threadId,
            ...(cursor !== undefined ? { cursor } : {}),
            ...(hostId !== undefined ? { hostId } : {}),
            ...(includeOutputs !== undefined ? { includeOutputs } : {}),
            ...(maxOutputCharsPerItem !== undefined ? { maxOutputCharsPerItem } : {}),
            ...(turnLimit !== undefined ? { turnLimit } : {}),
          },
        }, extra.signal);
      },
    ),
  );

}
