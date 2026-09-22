import { createHash } from "node:crypto";
import { estimateTokens } from "../../lib/token-estimate";
import * as z from "zod/v4";

// Alphanumeric by design: ChatGPT's DOM-to-Markdown serializer escapes `_`, `*`, and brackets.
export const CHATGPT_LUNA_CHECKPOINT_MARKER = "CODEXLUNAPRIVATECHECKPOINTV1A7F3C9D2";
export const CHATGPT_LUNA_CHECKPOINT_MAX_TOKENS = 4_000;

const legacyCheckpointString = z.string().trim().min(1).max(1_200);
const legacyCheckpointSchema = z.object({
  version: z.literal(1),
  objective: z.string().trim().min(1).max(2_000),
  state: z.array(legacyCheckpointString).max(32),
  evidence: z.array(legacyCheckpointString).max(32),
  decisions: z.array(legacyCheckpointString).max(32),
  pending: z.array(legacyCheckpointString).max(32),
}).strict();
const textCheckpointSchema = z.object({
  version: z.literal(2),
  summary: z.string().trim().min(1).max(24_000),
}).strict();
const checkpointSchema = z.discriminatedUnion("version", [legacyCheckpointSchema, textCheckpointSchema]);

export type ChatGptLunaCheckpoint = z.infer<typeof checkpointSchema>;

export interface CapturedChatGptLunaCheckpoint {
  checkpoint: ChatGptLunaCheckpoint;
  answerHash: string;
}

export interface CompletedChatGptLunaCheckpoint {
  answer: string;
  visibleRemainder: string;
  captured?: CapturedChatGptLunaCheckpoint;
}

const VISIBLE_MARKER_RESERVE_CHARS = CHATGPT_LUNA_CHECKPOINT_MARKER.length + 16;

function canonicalAnswer(answer: string): string {
  return answer.replaceAll("\r\n", "\n").trimEnd();
}

export function hashChatGptLunaAnswer(answer: string): string {
  return createHash("sha256").update(canonicalAnswer(answer)).digest("hex");
}

export function parseChatGptLunaCheckpoint(value: unknown): ChatGptLunaCheckpoint {
  const checkpoint = checkpointSchema.parse(value);
  const tokens = estimateTokens(JSON.stringify(checkpoint));
  if (tokens > CHATGPT_LUNA_CHECKPOINT_MAX_TOKENS) {
    throw new Error(
      `ChatGPT Luna rolling checkpoint requires ${tokens.toLocaleString("en-US")} tokens; maximum is ${CHATGPT_LUNA_CHECKPOINT_MAX_TOKENS.toLocaleString("en-US")}`,
    );
  }
  return checkpoint;
}

function parseCheckpointText(text: string): ChatGptLunaCheckpoint {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("ChatGPT Luna did not provide a rolling checkpoint");
  // Luna supplies semantic state, not transport syntax. The bridge owns serialization so quotes,
  // backslashes, control characters, and copied user text cannot make the checkpoint malformed.
  return parseChatGptLunaCheckpoint({ version: 2, summary: trimmed });
}

/**
 * Splits the model's final Markdown stream at the private checkpoint marker. A marker-sized tail is
 * held back so a marker split across DOM snapshots can never leak into the outer Codex answer.
 */
export class ChatGptLunaCheckpointStream {
  private pending = "";
  private checkpointText = "";
  private visibleAnswer = "";
  private markerSeen = false;

  push(delta: string): string {
    if (!delta) return "";
    if (this.markerSeen) {
      this.checkpointText += delta;
      return "";
    }

    this.pending += delta;
    const markerIndex = this.pending.indexOf(CHATGPT_LUNA_CHECKPOINT_MARKER);
    if (markerIndex >= 0) {
      const visible = this.pending.slice(0, markerIndex).trimEnd();
      this.checkpointText = this.pending.slice(markerIndex + CHATGPT_LUNA_CHECKPOINT_MARKER.length);
      this.pending = "";
      this.markerSeen = true;
      this.visibleAnswer += visible;
      return visible;
    }

    if (this.pending.length <= VISIBLE_MARKER_RESERVE_CHARS) return "";
    const emitLength = this.pending.length - VISIBLE_MARKER_RESERVE_CHARS;
    const visible = this.pending.slice(0, emitLength);
    this.pending = this.pending.slice(emitLength);
    this.visibleAnswer += visible;
    return visible;
  }

  private flushVisibleRemainder(): string {
    if (this.markerSeen || !this.pending) return "";
    const visible = this.pending;
    this.pending = "";
    this.visibleAnswer += visible;
    return visible;
  }

  /** A missing checkpoint skips the private cache; a present checkpoint still validates strictly. */
  finishOptional(rawResponseText: string): CompletedChatGptLunaCheckpoint {
    if (this.markerSeen) {
      const completed = this.finish(rawResponseText);
      return { ...completed, visibleRemainder: "" };
    }
    if (rawResponseText.includes(CHATGPT_LUNA_CHECKPOINT_MARKER)) {
      throw new Error("ChatGPT Luna rolling checkpoint marker was not preserved in the Markdown stream");
    }
    const visibleRemainder = this.flushVisibleRemainder();
    const answer = canonicalAnswer(this.visibleAnswer);
    if (!answer) throw new Error("ChatGPT Luna completed without a user-facing answer");
    return { answer, visibleRemainder };
  }

  finish(rawResponseText: string): { answer: string; captured: CapturedChatGptLunaCheckpoint } {
    if (!this.markerSeen) {
      throw new Error(
        `ChatGPT Luna completed without the required ${CHATGPT_LUNA_CHECKPOINT_MARKER} rolling checkpoint marker`,
      );
    }
    const rawMarkerIndex = rawResponseText.indexOf(CHATGPT_LUNA_CHECKPOINT_MARKER);
    if (rawMarkerIndex < 0 || rawMarkerIndex !== rawResponseText.lastIndexOf(CHATGPT_LUNA_CHECKPOINT_MARKER)) {
      throw new Error("ChatGPT Luna response must contain exactly one raw rolling checkpoint marker");
    }
    if (this.checkpointText.includes(CHATGPT_LUNA_CHECKPOINT_MARKER)) {
      throw new Error("ChatGPT Luna Markdown stream contained more than one rolling checkpoint marker");
    }
    // Capture the DOM's plain text rather than Turndown Markdown: the checkpoint is opaque
    // assistant-owned state, so Markdown escapes must not alter paths, commands, or evidence.
    const checkpoint = parseCheckpointText(
      rawResponseText.slice(rawMarkerIndex + CHATGPT_LUNA_CHECKPOINT_MARKER.length),
    );
    const answer = canonicalAnswer(this.visibleAnswer);
    if (!answer) throw new Error("ChatGPT Luna completed without a user-facing answer before its rolling checkpoint");
    return {
      answer,
      captured: { checkpoint, answerHash: hashChatGptLunaAnswer(answer) },
    };
  }
}
