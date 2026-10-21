import { z } from "zod";
import { decodeAgentToolImage } from "../agent-mode/tool-images";

export const COMPANION_VERSION = 1 as const;
export const COMPANION_ORIGIN = "http://127.0.0.1:17843";
export const COMPANION_PATH = "/v1/companion";
const id = z.string().min(1).max(160);
export const browserBindingSchema = z.object({
  sessionId: id, scopeId: id, tabId: z.number().int().nonnegative(), windowId: z.number().int().nonnegative(),
  frameId: z.literal(0), documentId: id, documentEpoch: id, observationId: id,
}).strict();
/** Pixels are optional, separately requested by the exact approved observe call.
 * The surrounding observation binds capture to its selected tab/window/document. */
export const browserScreenshotSchema = z.object({
  mimeType: z.enum(["image/png", "image/jpeg"]), data: z.string().min(1).max(218_456),
  width: z.number().int().positive().max(16_384), height: z.number().int().positive().max(16_384),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(value => {
  try {
    const decoded = decodeAgentToolImage(value.mimeType, value.data);
    return decoded.sha256 === value.sha256 && decoded.width === value.width && decoded.height === value.height;
  } catch { return false; }
}, "Screenshot bytes do not match their bounded image identity");
export const browserObservationSchema = browserBindingSchema.extend({
  kind: z.literal("browser"), url: z.string().url().max(4096).refine(value => ["http:", "https:"].includes(new URL(value).protocol)),
  title: z.string().max(512), text: z.string().max(16_000),
  refs: z.array(z.object({ ref: id, role: z.enum(["button", "link", "textbox"]), label: z.string().max(240) }).strict()).max(100),
  screenshot: browserScreenshotSchema.optional(),
}).strict();
export const browserActionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("click"), ref: id }).strict(),
  z.object({ kind: z.literal("type"), ref: id, text: z.string().max(8000) }).strict(),
]);
/** Bundled ChatGPT document operations (extension `chatgpt.js`). The host never sends selectors
 * or script; each operation runs only on the exact selected https://chatgpt.com document. */
export const COMPANION_CHATGPT_FEATURE = "chatgpt-v1" as const;
export const CHATGPT_COMPANION_MAX_PROMPT_CHARS = 200_000;
export const CHATGPT_COMPANION_MAX_ANSWER_HTML_CHARS = 400_000;
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const modelLabel = z.string().min(1).max(120);
export const chatGptCompanionRequestSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("identify") }).strict(),
  z.object({ op: z.literal("send"), text: z.string().min(1).max(CHATGPT_COMPANION_MAX_PROMPT_CHARS),
    expectedAccount: digest, expectedModelLabel: modelLabel }).strict(),
  z.object({ op: z.literal("read"), userMessageId: id, verifyAccount: z.boolean().optional() }).strict(),
]);
export const chatGptCompanionResultSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("identify"), account: digest, modelLabel, path: z.string().max(2048),
    newChat: z.boolean(), composerReady: z.boolean(), generating: z.boolean() }).strict(),
  z.object({ op: z.literal("send"), userMessageId: id, path: z.string().max(2048) }).strict(),
  z.object({ op: z.literal("read"), path: z.string().max(2048), userTurnFound: z.boolean(), generating: z.boolean(),
    account: digest.optional(),
    assistant: z.object({ messageId: id.optional(), html: z.string().max(CHATGPT_COMPANION_MAX_ANSWER_HTML_CHARS),
      truncated: z.boolean(), completionAction: z.boolean() }).strict().optional() }).strict(),
]);
export type ChatGptCompanionRequest = z.infer<typeof chatGptCompanionRequestSchema>;
export type ChatGptCompanionResult = z.infer<typeof chatGptCompanionResultSchema>;
export type BrowserBinding = z.infer<typeof browserBindingSchema>;
export type BrowserObservation = z.infer<typeof browserObservationSchema>;
export type BrowserAction = z.infer<typeof browserActionSchema>;
export type OperationOutcome = "completed" | "not_sent" | "rejected" | "unknown";
export interface CompanionReceipt {
  operationId: string;
  outcome: OperationOutcome;
  cancelRequested: boolean;
  /** True means the extension reported execution, not that a website accepted a submission. */
  executed?: boolean;
  /** Added by the host from the dispatched command, never accepted from extension result JSON. */
  binding?: BrowserBinding;
  reason?: string;
  observation?: BrowserObservation;
  /** Bundled ChatGPT document receipt; present only for a delivered `chatgpt` command. */
  chatgpt?: ChatGptCompanionResult;
}
export interface CompanionCommand {
  operationId: string;
  kind: "observe" | "act" | "chatgpt";
  binding: BrowserBinding;
  action?: BrowserAction;
  /** `chatgpt` only: one bundled operation; only `send` can produce input. */
  chatgpt?: ChatGptCompanionRequest;
  /** Observe only. False/absent keeps the existing text-only disclosure boundary. */
  includeImage?: boolean;
}
export function sameBrowserBinding(a: BrowserBinding, b: BrowserBinding): boolean {
  return Object.keys(browserBindingSchema.shape).every(key => a[key as keyof BrowserBinding] === b[key as keyof BrowserBinding]);
}
export function browserBindingOf(value: BrowserBinding): BrowserBinding {
  return browserBindingSchema.parse(Object.fromEntries(Object.keys(browserBindingSchema.shape).map(key => [key, value[key as keyof BrowserBinding]])));
}
export const resultSchema = z.object({
  operationId: id,
  outcome: z.enum(["completed", "rejected", "unknown"]),
  executed: z.boolean(), reason: z.string().max(240).optional(), observation: browserObservationSchema.optional(),
  chatgpt: chatGptCompanionResultSchema.optional(),
}).strict();
