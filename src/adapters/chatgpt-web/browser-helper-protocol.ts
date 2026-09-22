import { parseChatGptLunaCheckpoint, type ChatGptLunaCheckpoint } from "./rolling-checkpoint";

// Maintenance operations have a separate receiver in Electron. The turn decoder below
// deliberately rejects value-only results, preserving its fail-closed boundary.
export type HelperMaintenanceResult =
  | { authenticated: true; temporary: true; url: string; solAvailable?: boolean;
      extraHighAvailable?: boolean; proAvailable?: boolean }
  | { effort: string; response: string };

export type HelperOutputMessage = HelperTurnOutputMessage
  | { type: "result"; id: string; value: HelperMaintenanceResult };

export type HelperTurnOutputMessage =
  | { type: "ready"; features?: string[] }
  | { type: "event"; id: string; event: "heartbeat" | "submitted" | "reasoning" | "commentary" | "text"; text?: string; continuation?: boolean }
  | { type: "event"; id: string; event: "send_activated"; requestId?: number }
  | { type: "event"; id: string; event: "turn_settled" }
  | { type: "event"; id: string; event: "tool_batch_observed"; revision: number }
  | { type: "event"; id: string; event: "multipart_stage_acknowledged"; stageIndex: number }
  | { type: "event"; id: string; event: "completion_fence_begin"; requestId: number }
  | { type: "event"; id: string; event: "completion_fence_commit"; requestId: number; revision: number }
  | { type: "event"; id: string; event: "prepared_selected"; reused: boolean }
  | { type: "event"; id: string; event: "luna_checkpoint"; checkpoint: ChatGptLunaCheckpoint; answerHash: string }
  | { type: "result"; id: string; text: string }
  | {
      type: "error";
      id: string;
      name?: string;
      message: string;
      status?: number;
      errorType?: string;
      code?: string;
      retryable?: boolean;
    };

export function parseHelperMessage(line: string): HelperTurnOutputMessage {
  const value = JSON.parse(line) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Launcher browser helper message is not an object");
  }
  const message = value as Record<string, unknown>;
  if (message.type === "ready") {
    const features = message.features;
    if (features !== undefined
      && (!Array.isArray(features) || features.some(feature => typeof feature !== "string"))) {
      throw new Error("Launcher browser helper advertised invalid features");
    }
    return { type: "ready", ...(features ? { features: features as string[] } : {}) };
  }
  if (typeof message.id !== "string" || !message.id) {
    throw new Error("Launcher browser helper message has no turn identity");
  }
  if (message.type === "event") {
    const event = message.event;
    if (event === "turn_settled") return { type: "event", id: message.id, event };
    if (event === "send_activated") {
      if (message.requestId !== undefined
        && (!Number.isSafeInteger(message.requestId) || (message.requestId as number) <= 0)) {
        throw new Error("Launcher browser helper Send activation request id is invalid");
      }
      return { type: "event", id: message.id, event,
        ...(message.requestId !== undefined ? { requestId: message.requestId as number } : {}) };
    }
    if (event === "multipart_stage_acknowledged") {
      if (!Number.isSafeInteger(message.stageIndex) || (message.stageIndex as number) <= 0) {
        throw new Error("Launcher browser helper multipart stage index is invalid");
      }
      return { type: "event", id: message.id, event, stageIndex: message.stageIndex as number };
    }
    if (event === "tool_batch_observed") {
      if (!Number.isSafeInteger(message.revision) || (message.revision as number) <= 0) {
        throw new Error("Launcher browser helper tool-boundary revision is invalid");
      }
      return { type: "event", id: message.id, event, revision: message.revision as number };
    }
    if (event === "completion_fence_begin") {
      if (!Number.isSafeInteger(message.requestId) || (message.requestId as number) <= 0) {
        throw new Error("Launcher browser helper completion fence request id is invalid");
      }
      return { type: "event", id: message.id, event, requestId: message.requestId as number };
    }
    if (event === "completion_fence_commit") {
      if (!Number.isSafeInteger(message.requestId) || (message.requestId as number) <= 0
        || !Number.isSafeInteger(message.revision) || (message.revision as number) < 0) {
        throw new Error("Launcher browser helper completion fence revision is invalid");
      }
      return {
        type: "event",
        id: message.id,
        event,
        requestId: message.requestId as number,
        revision: message.revision as number,
      };
    }
    if (event === "luna_checkpoint") {
      if (typeof message.answerHash !== "string" || !/^[a-f0-9]{64}$/.test(message.answerHash)) {
        throw new Error("Launcher browser helper Luna checkpoint answer hash is invalid");
      }
      return {
        type: "event",
        id: message.id,
        event,
        checkpoint: parseChatGptLunaCheckpoint(message.checkpoint),
        answerHash: message.answerHash,
      };
    }
    const text = message.text;
    const continuation = message.continuation;
    if (event === "prepared_selected") {
      if (typeof message.reused !== "boolean") {
        throw new Error("Launcher browser helper prompt selection is invalid");
      }
      return { type: "event", id: message.id, event, reused: message.reused };
    }
    if (!["heartbeat", "submitted", "reasoning", "commentary", "text"].includes(String(event))) {
      throw new Error("Launcher browser helper emitted an unknown event");
    }
    if (text !== undefined && typeof text !== "string") {
      throw new Error("Launcher browser helper event text is invalid");
    }
    if (continuation !== undefined && typeof continuation !== "boolean") {
      throw new Error("Launcher browser helper continuation flag is invalid");
    }
    return {
      type: "event",
      id: message.id,
      event: event as "heartbeat" | "submitted" | "reasoning" | "commentary" | "text",
      ...(text !== undefined ? { text: text as string } : {}),
      ...(continuation !== undefined ? { continuation: continuation as boolean } : {}),
    };
  }
  if (message.type === "result") {
    const text = message.text;
    if (typeof text !== "string") {
      throw new Error("Launcher browser helper result text is invalid");
    }
    return { type: "result", id: message.id, text };
  }
  if (message.type === "error") {
    const errorMessage = message.message;
    const errorName = message.name;
    const status = message.status;
    const errorType = message.errorType;
    const code = message.code;
    const retryable = message.retryable;
    const structured = status !== undefined
      || errorType !== undefined
      || code !== undefined
      || retryable !== undefined;
    if (typeof errorMessage !== "string"
      || (errorName !== undefined && typeof errorName !== "string")
      || (structured && (
        !Number.isInteger(status)
        || (status as number) < 400
        || (status as number) > 599
        || typeof errorType !== "string"
        || !errorType
        || typeof code !== "string"
        || !code
        || typeof retryable !== "boolean"
      ))) {
      throw new Error("Launcher browser helper error payload is invalid");
    }
    return {
      type: "error",
      id: message.id,
      message: errorMessage,
      ...(errorName !== undefined ? { name: errorName as string } : {}),
      ...(structured ? {
        status: status as number,
        errorType: errorType as string,
        code: code as string,
        retryable: retryable as boolean,
      } : {}),
    };
  }
  throw new Error("Launcher browser helper emitted an unknown message type");
}
