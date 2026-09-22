import { createConnection } from "node:net";
import type { ChatGptTurnEnvironment } from "./environment";
import { opaqueId, assertSurfaceNonce, MAX_BROKER_LINE_CHARS, BROKER_PROTOCOL_VERSION, type BrokerCallRequest, type BrokerResponse, type BrokerToolRequest, type BrokerToolResult, type BrokerCompletionFenceStart, type TurnBrokerOwner } from "./turn-broker-protocol";

function errorOf(value: unknown): Error { return value instanceof Error ? value : new Error(String(value)); }

/**
 * A turn registered without a TTL has no deadline to bound its tool calls against, so a null
 * timeout waits for as long as the turn itself lives. Undefined keeps the bounded default, because
 * a caller that cannot compute a deadline must not silently inherit an unbounded wait. An
 * unbounded call still ends when the turn is revoked or the broker drops the connection.
 */
export class TurnBrokerTimeoutError extends Error {
  constructor() {
    super("ChatGPT web turn broker timed out");
    this.name = "TurnBrokerTimeoutError";
  }
}

export async function callTurnBroker<T>(
  socketPath: string,
  request: Omit<BrokerCallRequest, "id">,
  timeoutMs: number | null = 5_000,
  signal?: AbortSignal,
): Promise<T> {
  const id = opaqueId("request");
  const settleOnResponseFrame = timeoutMs === null;
  // The wire protocol requires a client-owned activity identity. Most callers never need to see
  // it; the MCP server supplies its own so it can retire an ambiguously delivered claim, while
  // lower-level diagnostics receive an equally client-generated identity here.
  const wireRequest = request.method === "claim" && request.activityId === undefined
    ? { ...request, activityId: opaqueId("activity") }
    : request;
  return new Promise<T>((resolveCall, rejectCall) => {
    const socket = createConnection(socketPath);
    let buffered = "";
    let settled = false;
    let response: BrokerResponse | undefined;
    const onAbort = () => finishError(new DOMException("ChatGPT web turn broker call aborted", "AbortError"));
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const finishError = (error: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      socket.destroy();
      rejectCall(error);
    };
    const finishResponse = () => {
      if (settled) return;
      if (!response) {
        finishError(new Error("ChatGPT web turn broker closed the connection"));
        return;
      }
      settled = true;
      clearTimeout(timer);
      cleanup();
      if (response.error) rejectCall(new Error(response.error));
      else resolveCall(response.result as T);
    };
    const timer = timeoutMs === null
      ? undefined
      : setTimeout(() => finishError(new TurnBrokerTimeoutError()), timeoutMs);
    signal?.addEventListener("abort", onAbort, { once: true });
    if (signal?.aborted) {
      finishError(new DOMException("ChatGPT web turn broker call aborted", "AbortError"));
      return;
    }
    socket.setEncoding("utf8");
    socket.once("error", error => finishError(new Error(`ChatGPT web turn broker unavailable: ${error.message}`)));
    // The server owns response termination. Waiting for the pipe/socket to close before resolving
    // prevents callers from retiring the broker while Bun still has a named-pipe write in flight.
    socket.once("close", finishResponse);
    socket.once("connect", () => socket.write(`${JSON.stringify({ id, ...wireRequest })}\n`));
    socket.on("data", chunk => {
      if (settled || response) return;
      buffered += chunk;
      if (buffered.length > MAX_BROKER_LINE_CHARS) {
        finishError(new Error("ChatGPT web turn broker response exceeds size limit"));
        return;
      }
      const newline = buffered.indexOf("\n");
      if (newline < 0) return;
      let parsed: BrokerResponse;
      try {
        parsed = JSON.parse(buffered.slice(0, newline)) as BrokerResponse;
      } catch (error) {
        finishError(new Error(`ChatGPT web turn broker returned invalid JSON: ${errorOf(error).message}`));
        return;
      }
      if (parsed.id !== id) {
        finishError(new Error("ChatGPT web turn broker response id mismatch"));
        return;
      }
      response = parsed;
      if (settleOnResponseFrame) {
        // A long-poll keeps its request half open while the server waits. Its complete response
        // frame is therefore the terminal boundary; ordinary calls still wait for physical close.
        finishResponse();
        socket.destroy();
      } else {
        // Complete the duplex close handshake (notably Windows named pipes), while
        // retaining physical close as the settlement boundary for ordinary calls.
        socket.end();
      }
    });
  });
}

/**
 * Outer-harness client for a broker already owned by the live launcher runtime. It lets a
 * working-tree DEV driver exercise the production adapter and MCP connector without binding a
 * Responses port or replacing the active Codex route.
 */
export class RemoteTurnBroker implements TurnBrokerOwner {
  constructor(readonly socketPath: string) {}

  async assertCompatible(): Promise<void> {
    let status: { protocolVersion?: unknown; acceptingExternalOwners?: unknown };
    try {
      status = await callTurnBroker(this.socketPath, { method: "owner_status" });
    } catch (error) {
      throw new Error(
        "The running launcher runtime does not expose the DEV turn-owner protocol; update and restart NEKODEX once before using the working-tree DEV chat"
        + ` (${error instanceof Error ? error.message : String(error)})`,
      );
    }
    if (status.protocolVersion !== BROKER_PROTOCOL_VERSION) {
      throw new Error(`Unsupported DEV turn-owner protocol version: ${String(status.protocolVersion)}`);
    }
    if (status.acceptingExternalOwners !== true) {
      throw new Error("The running launcher runtime is draining and is not accepting DEV chat turns");
    }
  }

  async register(environment: ChatGptTurnEnvironment, ttlMs?: number, traceId = "unknown"): Promise<string> {
    const response = await callTurnBroker<{ token?: unknown }>(this.socketPath, {
      method: "owner_register",
      environment,
      ...(ttlMs !== undefined ? { ttlMs } : {}),
      ...(traceId !== "unknown" ? { traceId } : {}),
    });
    if (typeof response.token !== "string" || !response.token.startsWith("turn_")) {
      throw new Error("DEV turn owner received an invalid broker token");
    }
    return response.token;
  }

  async registerSafe(
    environment: ChatGptTurnEnvironment,
    surfaceNonce: string,
    ttlMs?: number,
    traceId = "unknown",
  ): Promise<string> {
    assertSurfaceNonce(surfaceNonce);
    const response = await callTurnBroker<{ token?: unknown }>(this.socketPath, {
      method: "owner_register_safe",
      environment,
      surfaceNonce,
      ...(ttlMs !== undefined ? { ttlMs } : {}),
      ...(traceId !== "unknown" ? { traceId } : {}),
    });
    if (typeof response.token !== "string" || !response.token.startsWith("request_")) {
      throw new Error("DEV Manual mode turn owner received an invalid broker request id");
    }
    return response.token;
  }

  async updateEnvironment(token: string, environment: ChatGptTurnEnvironment): Promise<void> {
    await callTurnBroker(this.socketPath, { method: "owner_update", token, environment });
  }

  async confirmSafeTurnSent(
    token: string,
    surfaceNonce: string,
  ): Promise<{ confirmed: true; duplicate: boolean }> {
    const response = await callTurnBroker<{ confirmed?: unknown; duplicate?: unknown }>(this.socketPath, {
      method: "owner_safe_sent",
      token,
      surfaceNonce,
    });
    if (response.confirmed !== true || typeof response.duplicate !== "boolean") {
      throw new Error("DEV Manual mode turn owner received an invalid Sent confirmation result");
    }
    return { confirmed: true, duplicate: response.duplicate };
  }

  async nextToolBatch(token: string, signal?: AbortSignal): Promise<BrokerToolRequest[]> {
    const response = await callTurnBroker<{ requests?: unknown }>(
      this.socketPath,
      { method: "owner_next", token },
      null,
      signal,
    );
    if (!Array.isArray(response.requests) || response.requests.some(value => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return true;
      const request = value as Partial<BrokerToolRequest>;
      return typeof request.callId !== "string" || typeof request.wireName !== "string"
        || typeof request.freeform !== "boolean"
        || (request.freeform
          ? typeof request.input !== "string"
          : !request.arguments || typeof request.arguments !== "object" || Array.isArray(request.arguments));
    })) throw new Error("DEV turn owner received an invalid tool batch");
    return response.requests as BrokerToolRequest[];
  }

  async completeTool(token: string, callId: string, result: BrokerToolResult): Promise<void> {
    await callTurnBroker(this.socketPath, {
      method: "owner_complete",
      token,
      callId,
      toolResult: result,
    }, null);
  }

  async waitForSafeStart(token: string, signal?: AbortSignal): Promise<void> {
    const response = await callTurnBroker<{ started?: unknown }>(
      this.socketPath,
      { method: "owner_safe_wait_start", token },
      null,
      signal,
    );
    if (response.started !== true) throw new Error("DEV Manual mode turn owner received an invalid start result");
  }

  async waitForSafeCompletion(token: string, signal?: AbortSignal): Promise<string> {
    const response = await callTurnBroker<{ finalAnswer?: unknown }>(
      this.socketPath,
      { method: "owner_safe_wait_completion", token },
      null,
      signal,
    );
    if (typeof response.finalAnswer !== "string" || response.finalAnswer.trim().length === 0) {
      throw new Error("DEV Manual mode turn owner received an invalid completion result");
    }
    return response.finalAnswer;
  }

  async requestCompaction(token: string, queuedResult: BrokerToolResult): Promise<number> {
    const response = await callTurnBroker<{ interrupted?: unknown }>(this.socketPath, {
      method: "owner_request_compaction",
      token,
      toolResult: queuedResult,
    }, null);
    if (!Number.isSafeInteger(response.interrupted) || Number(response.interrupted) < 0) {
      throw new Error("DEV Manual mode turn owner received an invalid compaction interrupt count");
    }
    return Number(response.interrupted);
  }

  async compactionDeliveryCount(token: string): Promise<number> {
    const response = await callTurnBroker<{ count?: unknown }>(this.socketPath, {
      method: "owner_compaction_delivery_count",
      token,
    });
    if (!Number.isSafeInteger(response.count) || Number(response.count) < 0) {
      throw new Error("DEV Manual mode turn owner received an invalid compaction delivery count");
    }
    return Number(response.count);
  }

  async beginCompletionFence(token: string): Promise<BrokerCompletionFenceStart> {
    const response = await callTurnBroker<{
      revision?: unknown;
      blockedReason?: unknown;
      blockedCount?: unknown;
    }>(this.socketPath, {
      method: "owner_completion_fence_begin",
      token,
    });
    if (response.revision === null) {
      // Protocol-v5 runtimes returned only null for ordinary active work. Native5 cannot exist on
      // those runtimes, so this compatibility shape is safely the non-terminal active-work case.
      if (response.blockedReason === undefined && response.blockedCount === undefined) {
        return { blockedReason: "active_work", blockedCount: 1 };
      }
      if ((response.blockedReason !== "active_work"
        && response.blockedReason !== "unacknowledged_async_result")
        || !Number.isSafeInteger(response.blockedCount) || Number(response.blockedCount) <= 0) {
        throw new Error("DEV turn owner received an invalid completion fence block reason");
      }
      return {
        blockedReason: response.blockedReason,
        blockedCount: Number(response.blockedCount),
      };
    }
    if (!Number.isSafeInteger(response.revision) || (response.revision as number) < 0) {
      throw new Error("DEV turn owner received an invalid completion fence revision");
    }
    return { revision: response.revision as number };
  }

  async commitCompletionFence(token: string, revision: number): Promise<boolean> {
    const response = await callTurnBroker<{ committed?: unknown }>(this.socketPath, {
      method: "owner_completion_fence_commit",
      token,
      revision,
    });
    if (typeof response.committed !== "boolean") {
      throw new Error("DEV turn owner received an invalid completion fence result");
    }
    return response.committed;
  }

  async waitForRetirement(token: string, signal?: AbortSignal): Promise<void> {
    const response = await callTurnBroker<{ retired?: unknown }>(
      this.socketPath,
      { method: "owner_wait_retirement", token },
      null,
      signal,
    );
    if (response.retired !== true) throw new Error("DEV turn owner received an invalid retirement result");
  }

  async revoke(token: string, _reason?: Error): Promise<void> {
    await callTurnBroker(this.socketPath, { method: "owner_revoke", token });
  }
}
