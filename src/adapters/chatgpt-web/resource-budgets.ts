import { ChatGptWebAdapterError } from "./adapter-error";

// These bound retained payloads and IPC queues, not total V8/process memory. Keep the helper
// frame large enough for the existing 50 MB image allowance after base64/JSON encoding.
export const CHATGPT_HELPER_FRAME_BYTES = 128 * 1024 * 1024;
export const CHATGPT_HELPER_PENDING_BYTES = 128 * 1024 * 1024;
export const CHATGPT_HELPER_DIAGNOSTIC_BYTES = 256 * 1024;
export const CHATGPT_TRACE_BUFFER_BYTES = 8 * 1024 * 1024;
export const CHATGPT_MARKDOWN_BUFFER_BYTES = 32 * 1024 * 1024;
export const CHATGPT_TEXT_BUFFER_BYTES = 16 * 1024 * 1024;
export const CHATGPT_REPLAY_BYTES = 32 * 1024 * 1024;
export const CHATGPT_REGISTRY_REPLAY_BYTES = 128 * 1024 * 1024;

export class ChatGptResourceLimitError extends ChatGptWebAdapterError {
  constructor(resource: string, limit: number) {
    super(`${resource} exceeded its ${limit}-byte buffer limit. Start a new turn with less output.`, {
      status: 502,
      errorType: "server_error",
      code: "chatgpt_resource_limit",
      retryable: false,
    });
  }
}

export function assertByteLimit(value: number, limit: number, resource: string): void {
  if (!Number.isSafeInteger(limit) || limit <= 0) throw new Error("Buffer byte limit must be a positive safe integer");
  if (value > limit) throw new ChatGptResourceLimitError(resource, limit);
}

// Include a small per-record charge so empty records cannot evade a payload-byte budget.
export function retainedRecordBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8") + 64;
}
