import type { ChatGptSandboxPolicy } from "./environment-envelope";
export type { ChatGptSandboxPolicy } from "./environment-envelope";
import {
  pathIdentity,
  matchesPath,
  sandboxTypeFromEnvironment,
  environmentCwdMatches,
  environmentRootMatches,
  parseEnvironmentEnvelope,
} from "./environment-envelope";
// Compatibility facade: syntax helpers carry no turn provenance or authority on their own.
export {
  MissingTrustedCodexEnvironmentError,
  decodeXmlText,
  decodeXmlPath,
  pathIdentity,
  matchesPath,
  sandboxTypeFromEnvironment,
  environmentCwdMatches,
  environmentRootMatches,
  parseEnvironmentEnvelope,
} from "./environment-envelope";
import { isVerifiedParentMessage } from "./verified-parent-message";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { isReadableCompactionSummaryText, OPAQUE_COMPACTION_NOTE } from "../../responses/compaction";
import type { CodexContentPart, CodexParsedRequest, CodexTool } from "../../types";
import { jsonRecord as record } from "../../lib/json-record";
import { isAcceptedCompactionContinuation, recoverCompactionInstruction } from "./compaction-continuation";
import { clearRetryableTurnHandoff, isAcceptedRetryContinuation } from "./retry-continuation";
import {
  clientTurnMetadataFromBody,
  extractCodexTurnIdentityFromBody,
  type ChatGptTurnIdentity,
} from "./browser-request-contract";
import { itemTurnId, rawMessageText } from "./raw-input-item";

export { extractCodexTurnIdentityFromBody } from "./browser-request-contract";
export type { ChatGptTurnIdentity } from "./browser-request-contract";

export interface ChatGptTurnEnvironment {
  producer?: "codex" | "hermes";
  cwd: string;
  roots: string[];
  writableRoots: string[];
  sandboxPolicy: ChatGptSandboxPolicy;
  tools: CodexTool[];
}

export interface ChatGptThreadSpawnLineage {
  threadId: string;
  parentThreadId: string;
  agentName: string;
  sandboxType: ChatGptSandboxPolicy["type"];
  workspaceRoots: string[];
}

export interface ChatGptRootThreadMetadata {
  threadId: string;
  sandboxType: ChatGptSandboxPolicy["type"] | "platform";
  workspaceRoots: string[];
}

export interface ChatGptTurnUserRevision {
  content: unknown;
  turnId?: string;
  itemId?: string;
}

/**
 * A pathless environment delta can corroborate one current native turn, but can never provide
 * filesystem authority. Its caller must resolve cwd/roots from that exact turn's canonical rollout.
 */
export interface ChatGptTrailingEnvironmentDeltaClaim {
  threadId: string;
  turnId: string;
  sandboxType: ChatGptSandboxPolicy["type"];
  networkAccess?: boolean;
}

export const CHATGPT_TURN_REVISION_CONFLICT_MESSAGE =
  "ChatGPT web current user message conflicts with native Codex turn_id metadata";

function contentText(content: string | CodexContentPart[]): string {
  if (typeof content === "string") return content;
  return content.filter(part => part.type === "text").map(part => part.text).join("\n");
}

function clientTurnMetadata(parsed: CodexParsedRequest): Record<string, unknown> | undefined {
  return clientTurnMetadataFromBody(parsed._rawBody);
}

/** Only a user context fragment can claim environment authority; prose mentions cannot. */
function hasEnvironmentContextFragment(item: Record<string, unknown> | undefined): item is Record<string, unknown> {
  if (item?.type !== "message" || item.role !== "user") return false;
  const kinds = record(item.internal_chat_message_metadata_passthrough)?.content_item_kinds;
  if (Array.isArray(kinds) && kinds.includes("environments.environment_context")) return true;
  const texts = typeof item.content === "string" ? [item.content]
    : Array.isArray(item.content) ? item.content.map(part => record(part)?.text) : [];
  return texts.some(text => typeof text === "string"
    && /^<\/?environment_context\b/i.test(text.trimStart()));
}

/** True when the raw Responses input attempted to carry an environment envelope, valid or not. */
export function hasRawChatGptEnvironmentContext(parsed: CodexParsedRequest): boolean {
  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : [];
  return input.some(value => hasEnvironmentContextFragment(record(value)));
}

/** Historical XML is not a current environment update, including in old untagged rollouts. */
export function hasCurrentChatGptEnvironmentContext(parsed: CodexParsedRequest): boolean {
  const turnId = extractChatGptTurnIdentity(parsed).turnId;
  if (!turnId) return hasRawChatGptEnvironmentContext(parsed);
  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : [];
  let laterAssistantOutput = false;
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = record(input[index]);
    if (!item) continue;
    if ((item.type === "message" && item.role === "assistant")
      || item.type === "function_call" || item.type === "reasoning" || item.type === "compaction") {
      laterAssistantOutput = true;
    }
    if (!hasEnvironmentContextFragment(item)) continue;
    const owner = itemTurnId(item);
    if (owner === turnId || (owner === undefined && !laterAssistantOutput)) return true;
  }
  return false;
}

export interface ChatGptUnattributedEnvironmentMessage {
  id: string;
  content: unknown;
}

/** These are claims to locate in native history, never a source of filesystem authority. */
export function unattributedChatGptEnvironmentMessages(
  parsed: CodexParsedRequest,
): ChatGptUnattributedEnvironmentMessage[] | undefined {
  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : [];
  const currentTurnId = extractChatGptTurnIdentity(parsed).turnId;
  const messages: ChatGptUnattributedEnvironmentMessage[] = [];
  for (const value of input) {
    const item = record(value);
    if (!hasEnvironmentContextFragment(item)) continue;
    // Explicit current provenance must keep the normal current-update rejection. A native item
    // without provenance is historical only if the canonical rollout proves that exact message.
    const owner = itemTurnId(item);
    if (owner !== undefined && owner !== currentTurnId) continue;
    if (owner !== undefined || item.role !== "user"
      || typeof item.id !== "string" || !item.id) return undefined;
    messages.push({ id: item.id, content: item.content });
  }
  return messages.length > 0 ? messages : undefined;
}

export function contextualUserMessage(value: Record<string, unknown>): boolean {
  const text = rawMessageText(value).trim();
  if (hasEnvironmentContextFragment(value)) {
    const parts = typeof value.content === "string" ? [value.content]
      : Array.isArray(value.content) ? value.content.map(part => record(part)?.text) : [];
    // A native preamble can group environment, plugin and AGENTS fragments. Every part must be
    // contextual; a real task in the same user item remains an instruction.
    return parts.length > 0 && parts.every(part => typeof part === "string" && (
      /^<environment_context>[\s\S]*<\/environment_context>$/.test(part.trim())
      || /^<recommended_plugins>[\s\S]*<\/recommended_plugins>$/.test(part.trim())
      || /^# AGENTS\.md instructions\s*<INSTRUCTIONS>[\s\S]*<\/INSTRUCTIONS>$/.test(part.trim())
      || /^<app-context>[\s\S]*<\/app-context>$/.test(part.trim())
    ));
  }
  return /^<subagent_notification>[\s\S]*<\/subagent_notification>$/.test(text)
    || isReadableCompactionSummaryText(text)
    || text === OPAQUE_COMPACTION_NOTE;
}

/** V2 delivers tasks as agent_message; only this child's direct parent can revise its task. */
function isUserOrParentInstruction(
  item: Record<string, unknown> | undefined,
  metadata?: Record<string, unknown>,
): item is Record<string, unknown> {
  if (item && isVerifiedParentMessage(item)) {
    return metadata?.subagent_kind === "thread_spawn" && metadata.request_kind === "turn"
      && item.recipient === metadata.thread_id && item.author === metadata.parent_thread_id
      && itemTurnId(item) === metadata.turn_id;
  }
  if (item?.type === "message" && item.role === "user") return !contextualUserMessage(item);
  if (item?.type !== "agent_message" || typeof item.id !== "string" || !item.id
    || metadata?.subagent_kind !== "thread_spawn"
    || (metadata.request_kind !== "turn" && metadata.request_kind !== "compaction")
    || typeof metadata.thread_id !== "string" || !metadata.thread_id
    || typeof metadata.parent_thread_id !== "string" || !metadata.parent_thread_id
    || metadata.thread_id === metadata.parent_thread_id) return false;
  const agentName = metadata.agent_name;
  return typeof agentName === "string" && /^\/root\/(?:[^/]+\/)*[^/]+$/.test(agentName)
    && item.recipient === agentName
    && item.author === agentName.slice(0, agentName.lastIndexOf("/"));
}

function isTurnAbortedNotice(value: Record<string, unknown>): boolean {
  return /^<turn_aborted>[\s\S]*<\/turn_aborted>$/.test(rawMessageText(value).trim());
}

/** Native turn ids that Codex has authoritatively marked as interrupted in this thread. */
export function priorChatGptAbortedTurnIds(parsed: CodexParsedRequest): string[] {
  const currentTurnId = extractChatGptTurnIdentity(parsed).turnId;
  if (!currentTurnId) return [];
  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : [];
  return [...new Set(input.flatMap(value => {
    const item = record(value);
    const abortedTurnId = item ? itemTurnId(item) : undefined;
    return item?.type === "message"
      && item.role === "user"
      && isTurnAbortedNotice(item)
      && abortedTurnId !== undefined
      && abortedTurnId !== currentTurnId
      ? [abortedTurnId]
      : [];
  }))];
}

/**
 * Return the latest human or direct-parent instruction owned by the current native Codex turn.
 *
 * Provider rounds replay the same instruction and steering appends a newer one. Remote
 * compaction uses this revision to identify and stop the superseded browser response; once Codex
 * installs the replacement history, the immediate continuation starts a fresh browser response
 * under the same logical task revision.
 */
export function extractChatGptTurnUserRevision(parsed: CodexParsedRequest): unknown {
  const identity = extractChatGptTurnIdentity(parsed);
  const turnId = identity.turnId;
  if (!turnId) throw new Error("ChatGPT web requires native Codex turn_id metadata for browser-session replay");
  const revision = latestChatGptTurnUserRevision(parsed, turnId);
  if (!revision) throw new Error("ChatGPT web requires a current-turn user message for browser-session replay");
  if (revision.turnId === undefined || revision.turnId === turnId) {
    clearRetryableTurnHandoff(parsed, identity);
    return revision.content;
  }
  // A pre-turn compact may summarize an earlier user message before native Codex continues
  // under its new turn id without adding a new human message. Accept only our exact completed
  // checkpoint; an arbitrary older prompt is still not a new instruction or a valid handoff.
  if (revision.turnId !== undefined && revision.turnId !== turnId
    && (priorChatGptAbortedTurnIds(parsed).includes(revision.turnId)
      || (!isAcceptedCompactionContinuation(parsed, identity, revision)
        && !isAcceptedRetryContinuation(parsed, identity, revision)))) {
    throw new Error(CHATGPT_TURN_REVISION_CONFLICT_MESSAGE);
  }
  return revision.content;
}

function latestChatGptTurnUserRevision(parsed: CodexParsedRequest, expectedTurnId?: string): ChatGptTurnUserRevision | undefined {
  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : [];
  const metadata = clientTurnMetadata(parsed);
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = record(input[index]);
    const revision = userRevision(item, expectedTurnId, metadata);
    if (revision) return revision;
    // An unproven later user instruction cannot be replaced by an older proven instruction or
    // a completed checkpoint. Pure context fragments and summaries remain transparent.
    if (item?.type === "message" && item.role === "user" && !contextualUserMessage(item)) return undefined;
  }
  return recoverCompactionInstruction(parsed, extractChatGptTurnIdentity(parsed))?.source;
}

function userRevision(value: unknown, expectedTurnId?: string, metadata?: Record<string, unknown>): ChatGptTurnUserRevision | undefined {
  const item = record(value);
  if (!isUserOrParentInstruction(item, metadata)) return undefined;
  const messageTurnId = itemTurnId(item);
  // An abort notice is contextual only when native metadata identifies its earlier turn.
  if (item.type === "message" && isTurnAbortedNotice(item) && expectedTurnId !== undefined
    && messageTurnId !== undefined && messageTurnId !== expectedTurnId) return undefined;
  const itemId = typeof item.id === "string" && item.id.length > 0 ? item.id : undefined;
  if (messageTurnId === undefined && itemId === undefined) return undefined;
  return { content: item.content, ...(messageTurnId ? { turnId: messageTurnId } : {}),
    ...(itemId ? { itemId } : {}) };
}

/** Canonical instruction order distinguishes new steering from a delayed older request. */
export function chatGptTurnUserRevisionHistory(parsed: CodexParsedRequest): ChatGptTurnUserRevision[] {
  const body = record(parsed._rawBody);
  const turnId = extractChatGptTurnIdentity(parsed).turnId;
  const metadata = clientTurnMetadata(parsed);
  const revisions: ChatGptTurnUserRevision[] = [];
  let laterUnprovenInstruction = false;
  for (const value of Array.isArray(body?.input) ? body.input : []) {
    const item = record(value);
    const revision = userRevision(item, turnId, metadata);
    if (revision) {
      revisions.push(revision);
      laterUnprovenInstruction = false;
    } else if (item?.type === "message" && item.role === "user" && !contextualUserMessage(item)) {
      laterUnprovenInstruction = true;
    }
  }
  if (laterUnprovenInstruction) return [];
  if (revisions.length > 0) return revisions;
  const recovered = recoverCompactionInstruction(parsed, extractChatGptTurnIdentity(parsed));
  return recovered ? [recovered.source] : [];
}

/** The human instruction summarized by a remote compaction request belongs to an earlier turn. */
export function extractChatGptCompactionSourceRevision(parsed: CodexParsedRequest): ChatGptTurnUserRevision {
  if (!parsed._compactionRequest) throw new Error("ChatGPT web compaction source requires a compaction request");
  const revision = latestChatGptTurnUserRevision(parsed, extractChatGptTurnIdentity(parsed).turnId);
  if (!revision) throw new Error("ChatGPT web compaction requires a source user message");
  return revision;
}

/** A completed checkpoint binds an older instruction to this exact continuing native turn. */
export function isChatGptCompactionContinuation(parsed: CodexParsedRequest): boolean {
  const identity = extractChatGptTurnIdentity(parsed);
  const revision = latestChatGptTurnUserRevision(parsed, identity.turnId);
  return revision?.turnId !== undefined && identity.turnId !== undefined
    && revision.turnId !== identity.turnId
    && !priorChatGptAbortedTurnIds(parsed).includes(revision.turnId)
    && isAcceptedCompactionContinuation(parsed, identity, revision);
}

/** Parse a claim only: the caller must compare it with this turn's native rollout authority. */
export function extractChatGptContinuationEnvironmentClaim(parsed: CodexParsedRequest): ChatGptTurnEnvironment {
  const turnId = extractChatGptTurnIdentity(parsed).turnId;
  const body = record(parsed._rawBody);
  const updates = (Array.isArray(body?.input) ? body.input : []).flatMap(value => {
    const item = record(value);
    if (item?.type !== "message" || item.role !== "user" || itemTurnId(item) !== turnId
      || typeof item.id !== "string" || !item.id) return [];
    // Native compaction groups plugins, instructions and environment into sibling content parts.
    // Read the environment part without treating the surrounding preamble as part of its XML.
    const parts = typeof item.content === "string" ? [item.content]
      : Array.isArray(item.content) ? item.content.map(part => record(part)?.text) : [];
    return parts.flatMap(value => {
      if (typeof value !== "string") return [];
      const text = value.trim();
      return /^<environment_context>[\s\S]*<\/environment_context>$/.test(text) ? [text] : [];
    });
  });
  if (updates.length !== 1) throw new Error("Compaction continuation requires one current native environment claim");
  return parseChatGptEnvironmentText(parsed, updates[0]!);
}

/**
 * Steering can separate the original environment/instruction pair from the active instruction.
 * Git workspace metadata need not list every native filesystem root. Return that earlier claim
 * only for a same-turn pair; the store must compare it with the current canonical rollout.
 */
export function extractChatGptSteeringEnvironmentClaim(parsed: CodexParsedRequest): ChatGptTurnEnvironment | undefined {
  const turnId = extractChatGptTurnIdentity(parsed).turnId;
  if (!turnId) return undefined;
  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : [];
  const metadata = clientTurnMetadata(parsed);
  const activeIndex = input.findLastIndex(value => isUserOrParentInstruction(record(value), metadata));
  const active = record(input[activeIndex]);
  if (itemTurnId(active) !== turnId || typeof active?.id !== "string" || !active.id) return undefined;

  // Do not skip an unrecognized update or use one of several competing envelopes. Older,
  // explicitly attributed history is not a current claim; untagged XML remains unproven.
  const claims = input.flatMap((value, index) => {
    const item = record(value);
    if (!hasEnvironmentContextFragment(item)) return [];
    const owner = itemTurnId(item);
    return owner === undefined || owner === turnId ? [{ item, index }] : [];
  });
  if (claims.length !== 1) return undefined;
  const claim = claims[0]!;
  if (claim.item.role !== "user" || itemTurnId(claim.item) !== turnId
    || typeof claim.item.id !== "string" || !claim.item.id) return undefined;
  const parts = Array.isArray(claim.item.content) ? claim.item.content : [];
  if (parts.filter(part => /<\/?environment_context\b/i.test(String(record(part)?.text ?? ""))).length !== 1) return undefined;

  for (let index = claim.index + 1; index < activeIndex; index += 1) {
    const instruction = record(input[index]);
    if (typeof instruction?.id !== "string" || !instruction.id) continue;
    const text = environmentBeforeUser(input, index, turnId, metadata);
    if (text) return parseChatGptEnvironmentText(parsed, text);
  }
  return undefined;
}

/**
 * Recognize Codex's same-turn date/time refresh when it trails the active instruction and tool
 * rounds. This is only a corroborating claim: it deliberately carries no cwd or roots, and must
 * never be answered from cached authority.
 */
export function extractChatGptTrailingEnvironmentDeltaClaim(
  parsed: CodexParsedRequest,
): ChatGptTrailingEnvironmentDeltaClaim | undefined {
  if (parsed._compactionRequest) return undefined;
  const metadata = clientTurnMetadata(parsed);
  if (!metadata || metadata.request_kind !== "turn") return undefined;
  const identity = extractChatGptTurnIdentity(parsed);
  const threadId = typeof metadata.thread_id === "string" ? metadata.thread_id.trim() : "";
  const turnId = typeof metadata.turn_id === "string" ? metadata.turn_id.trim() : "";
  if (!threadId || !turnId || identity.threadId !== threadId || identity.turnId !== turnId) return undefined;

  const rolloutIdentity = extractChatGptThreadSpawnLineage(parsed) ?? extractChatGptRootThreadMetadata(parsed);
  if (!rolloutIdentity || rolloutIdentity.threadId !== threadId) return undefined;

  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : [];
  const trailingIndex = input.length - 1;
  const trailing = record(input[trailingIndex]);
  if (!trailing || trailing.type !== "message" || trailing.role !== "user"
    || typeof trailing.id !== "string" || !trailing.id || itemTurnId(trailing) !== turnId
    || !Array.isArray(trailing.content) || trailing.content.length !== 1) return undefined;
  const part = record(trailing.content[0]);
  const text = typeof part?.text === "string" ? part.text.trim() : "";
  if (part?.type !== "input_text" || !/^<environment_context>[\s\S]*<\/environment_context>$/.test(text)) {
    return undefined;
  }
  if ([...text.matchAll(/<environment_context>/g)].length !== 1
    || [...text.matchAll(/<\/environment_context>/g)].length !== 1) return undefined;

  // A trailing refresh may describe policy, never paths or writable entries. Filesystem authority
  // comes exclusively from the exact current rollout selected by the caller.
  if (/<\/?(?:cwd|root|workspace_roots|path)\b/i.test(text)) return undefined;
  const entryTags = [...text.matchAll(/<entry\b[^>]*>/gi)];
  if (entryTags.some(tag => {
    const access = /\baccess\s*=\s*["']([^"']+)["']/i.exec(tag[0])?.[1]?.toLowerCase();
    return access !== "read" && access !== "deny";
  })) return undefined;
  const profileTags = [...text.matchAll(/<permission_profile\b[^>]*>/gi)];
  const modeTags = [...text.matchAll(/<sandbox_mode\b[^>]*>/gi)];
  const fileSystems = [...text.matchAll(/<file_system\b[^>]*>/gi)];
  if (profileTags.length + modeTags.length !== 1) return undefined;
  if (profileTags.length === 1) {
    const profileType = /\btype=["']([^"']+)["']/i.exec(profileTags[0]![0])?.[1]?.toLowerCase();
    const fileSystemType = fileSystems.length === 1
      ? /\btype=["']([^"']+)["']/i.exec(fileSystems[0]![0])?.[1]?.toLowerCase()
      : undefined;
    if (!((profileType === "disabled" && fileSystemType === "unrestricted")
      || (profileType === "managed" && fileSystemType === "restricted"))) return undefined;
  } else if (fileSystems.length > 0) return undefined;

  const sandboxType = sandboxTypeFromEnvironment(text);
  if (!sandboxType) return undefined;
  if (rolloutIdentity.sandboxType !== "platform" && rolloutIdentity.sandboxType !== sandboxType) return undefined;

  const networkTags = [...text.matchAll(/<network_access\b[^>]*>([^<]*)<\/network_access>/gi)];
  if (/<\/?network_access\b/i.test(text) && networkTags.length !== 1) return undefined;
  const networkValue = networkTags[0]?.[1]?.trim().toLowerCase();
  if (networkValue !== undefined && networkValue !== "enabled" && networkValue !== "disabled") return undefined;
  // Restricted policies must state network authority rather than asking a caller to infer it from
  // omission. Danger-full-access has no separate network bit in ChatGptSandboxPolicy.
  if ((sandboxType === "dangerFullAccess") !== (networkValue === undefined)) return undefined;

  let activeInstructionIndex = -1;
  for (let index = trailingIndex - 1; index >= 0; index -= 1) {
    const item = record(input[index]);
    if (!isUserOrParentInstruction(item, metadata)) continue;
    if (typeof item.id !== "string" || !item.id || itemTurnId(item) !== turnId) return undefined;
    activeInstructionIndex = index;
    break;
  }
  if (activeInstructionIndex < 0) return undefined;
  for (let index = activeInstructionIndex + 1; index < trailingIndex; index += 1) {
    const item = record(input[index]);
    if (!item || typeof item.id !== "string" || !item.id || itemTurnId(item) !== turnId) return undefined;
    if (item.type === "message" && item.role !== "assistant") return undefined;
    if (item.type !== "message" && item.type !== "reasoning"
      && item.type !== "function_call" && item.type !== "function_call_output") return undefined;
  }

  return {
    threadId,
    turnId,
    sandboxType,
    ...(networkValue !== undefined ? { networkAccess: networkValue === "enabled" } : {}),
  };
}

function environmentBeforeUser(input: unknown[], userIndex: number, expectedTurnId?: string, metadata?: Record<string, unknown>): string | undefined {
  if (userIndex <= 0) return undefined;
  const user = record(input[userIndex]);
  if (!isUserOrParentInstruction(user, metadata)) return undefined;

  const userTurnId = itemTurnId(user);
  if (!userTurnId || (expectedTurnId && userTurnId !== expectedTurnId)) return undefined;

  let candidateIndex = userIndex - 1;
  let candidate = record(input[candidateIndex]);
  while (candidate?.type === "message" && candidate.role === "developer") {
    const developerTurnId = itemTurnId(candidate);
    if (developerTurnId !== userTurnId) return undefined;
    candidateIndex -= 1;
    candidate = record(input[candidateIndex]);
  }
  if (candidate?.type !== "message" || candidate.role !== "user") return undefined;

  const candidateTurnId = itemTurnId(candidate);
  if (candidateTurnId !== userTurnId) return undefined;

  const content = Array.isArray(candidate.content) ? candidate.content : [];
  for (const part of content) {
    const text = record(part)?.text;
    if (typeof text !== "string") continue;
    const trimmed = text.trim();
    if (/^<environment_context>[\s\S]*<\/environment_context>$/.test(trimmed)) return trimmed;
  }
  return undefined;
}

type ChatGptMetadataSandbox = ChatGptSandboxPolicy["type"] | "platform";

function canonicalSandboxMetadata(metadata: Record<string, unknown>): unknown {
  return metadata.sandbox_mode ?? metadata.sandbox;
}

function sandboxTypeFromMetadata(value: unknown): ChatGptMetadataSandbox | undefined {
  if (typeof value !== "string") return undefined;
  switch (value.trim().toLowerCase().replaceAll("_", "-")) {
    case "none":
    case "unrestricted":
    case "danger-full-access":
      return "dangerFullAccess";
    case "workspace-write":
      return "workspaceWrite";
    case "read-only":
      return "readOnly";
    // Codex CLI reports the host sandbox mechanism here, while the XML envelope carries the
    // effective filesystem policy. Keep the platform tag as a separate class and validate the
    // actual policy below instead of guessing write access from the platform name.
    case "windows-sandbox":
    case "windows-elevated":
    case "seatbelt":
    case "seccomp":
      return "platform";
    default:
      return undefined;
  }
}

function sandboxMetadataMatchesEnvironment(
  metadataValue: unknown,
  environmentText: string,
): boolean {
  const metadataSandbox = sandboxTypeFromMetadata(metadataValue);
  const environmentSandbox = sandboxTypeFromEnvironment(environmentText);
  if (!metadataSandbox || !environmentSandbox) return false;
  if (metadataSandbox === "platform") {
    return environmentSandbox === "workspaceWrite" || environmentSandbox === "readOnly";
  }
  return metadataSandbox === environmentSandbox;
}

function environmentMatchesCanonicalMetadata(
  environmentText: string,
  metadata: Record<string, unknown>,
  requireMetadataBoundRoots: boolean,
): boolean {
  const metadataSandboxValue = canonicalSandboxMetadata(metadata);
  const metadataSandbox = sandboxTypeFromMetadata(metadataSandboxValue);
  if (!metadataSandbox) return false;
  const workspaces = record(metadata.workspaces);
  const metadataRoots = workspaces ? Object.keys(workspaces) : [];
  if (metadataRoots.some(path => !isAbsolute(path))) return false;
  const normalizedMetadataRoots = [...new Set(metadataRoots.map(pathIdentity))];

  let cwdMatches: string[];
  try {
    cwdMatches = environmentCwdMatches(environmentText, normalizedMetadataRoots);
  } catch {
    return false;
  }
  if (cwdMatches.length !== 1 || !isAbsolute(cwdMatches[0]!)) return false;
  const rootMatches = environmentRootMatches(environmentText);
  const declaredRootValues = rootMatches.length > 0 ? rootMatches : cwdMatches;
  if (declaredRootValues.some(path => !isAbsolute(path))) return false;
  const declaredRoots = [...new Set(declaredRootValues.map(pathIdentity))];
  const cwd = pathIdentity(cwdMatches[0]!);
  if (normalizedMetadataRoots.length > 0
    && !normalizedMetadataRoots.some(root => matchesPath(root, cwd))) return false;
  if (requireMetadataBoundRoots && (
    normalizedMetadataRoots.length === 0
    || declaredRoots.some(root => (
      !normalizedMetadataRoots.some(metadataRoot => matchesPath(metadataRoot, root))
      && !isCurrentOrParentThreadVisualizationRoot(root, metadata)
    ))
  )) return false;
  if (!declaredRoots.some(root => matchesPath(root, cwd))) return false;
  return sandboxMetadataMatchesEnvironment(metadataSandboxValue, environmentText);
}

function isCurrentOrParentThreadVisualizationRoot(path: string, metadata: Record<string, unknown>): boolean {
  const threadIds = [metadata.thread_id, metadata.parent_thread_id]
    .filter((value): value is string => typeof value === "string")
    .map(value => process.platform === "win32" ? value.trim().toLowerCase() : value.trim())
    .filter(Boolean);
  if (threadIds.length === 0) return false;

  // Codex advertises its task-scoped visualization output directory in workspace_roots but omits
  // it from Git-oriented turn metadata. Authenticate that one auxiliary shape by both its private
  // Codex home and current or parent thread id; arbitrary roots and unrelated output remain untrusted.
  const configuredCodexHome = process.env.CODEX_HOME?.trim();
  const codexHome = resolve(configuredCodexHome || join(homedir(), ".codex"));
  const visualizationBase = pathIdentity(join(codexHome, "visualizations"));
  const rel = relative(visualizationBase, pathIdentity(path));
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return false;

  const parts = rel.split(sep);
  return parts.length === 4
    && /^\d{4}$/.test(parts[0]!)
    && /^(?:0[1-9]|1[0-2])$/.test(parts[1]!)
    && /^(?:0[1-9]|[12]\d|3[01])$/.test(parts[2]!)
    && threadIds.includes(parts[3]!);
}

function canonicalMetadataEnvironmentBeforeUser(
  input: unknown[],
  userIndex: number,
  metadata: Record<string, unknown> | undefined,
  requireMetadataBoundRoots = false,
): string | undefined {
  if (userIndex <= 0 || !metadata) return undefined;
  const metadataTurnId = typeof metadata.turn_id === "string" ? metadata.turn_id.trim() : "";
  const metadataSandbox = sandboxTypeFromMetadata(canonicalSandboxMetadata(metadata));
  if (!metadataTurnId || !metadataSandbox) return undefined;

  const user = record(input[userIndex]);
  if (!isUserOrParentInstruction(user, metadata) || typeof user.id !== "string" || !user.id) return undefined;
  const userTurnId = itemTurnId(user);
  if (userTurnId !== undefined && userTurnId !== metadataTurnId) return undefined;

  return canonicalMetadataEnvironmentBefore(input, userIndex, metadata, requireMetadataBoundRoots);
}

/** A completed checkpoint may stand between a current envelope and its original instruction. */
function canonicalMetadataEnvironmentBefore(
  input: unknown[], anchorIndex: number, metadata: Record<string, unknown>, requireMetadataBoundRoots = false,
): string | undefined {
  const metadataTurnId = typeof metadata.turn_id === "string" ? metadata.turn_id.trim() : "";
  if (!metadataTurnId) return undefined;

  let candidateIndex = anchorIndex - 1;
  let candidate = record(input[candidateIndex]);
  while (candidate?.type === "message" && (candidate.role === "developer"
    || (candidate.role === "user" && isReadableCompactionSummaryText(rawMessageText(candidate).trim())))) {
    const developerTurnId = itemTurnId(candidate);
    const serverOwnedId = typeof candidate.id === "string" && candidate.id.length > 0;
    if (developerTurnId === undefined ? !serverOwnedId : developerTurnId !== metadataTurnId) return undefined;
    candidateIndex -= 1;
    candidate = record(input[candidateIndex]);
  }
  if (candidate?.type !== "message" || candidate.role !== "user" || typeof candidate.id !== "string" || !candidate.id) return undefined;
  const candidateTurnId = itemTurnId(candidate);
  if (candidateTurnId !== undefined && candidateTurnId !== metadataTurnId) return undefined;

  const content = Array.isArray(candidate.content) ? candidate.content : [];
  for (const part of content) {
    const text = record(part)?.text;
    if (typeof text !== "string") continue;
    const trimmed = text.trim();
    if (!/^<environment_context>[\s\S]*<\/environment_context>$/.test(trimmed)) continue;
    // Current Codex stamps server-owned item IDs but not per-item turn IDs on the initial request,
    // and canonical workspaces contains Git enrichment rather than filesystem authority. Bind the
    // structurally adjacent context (allowing only provenance-checked developer messages) to
    // canonical turn/sandbox metadata; when Git roots are present, require the primary cwd to agree
    // with them as an additional check.
    if (!environmentMatchesCanonicalMetadata(trimmed, metadata, requireMetadataBoundRoots)) continue;
    return trimmed;
  }
  return undefined;
}

function hasAssistantOutputBetween(input: unknown[], startIndex: number, endIndex: number): boolean {
  for (let index = startIndex; index < endIndex; index += 1) {
    const item = record(input[index]);
    if (!item) continue;
    if (item.type === "message" && item.role === "assistant") return true;
    if (item.type === "function_call" || item.type === "reasoning") return true;
  }
  return false;
}

function rawEnvironmentText(parsed: CodexParsedRequest): string | undefined {
  const body = record(parsed._rawBody);
  const input = Array.isArray(body?.input) ? body.input : [];
  const metadata = clientTurnMetadata(parsed);
  let activeUserIndex = -1;
  for (let index = input.length - 1; index >= 0; index -= 1) {
    const item = record(input[index]);
    if (isUserOrParentInstruction(item, metadata)) {
      activeUserIndex = index;
      break;
    }
  }
  const checkpoint = activeUserIndex < 0
    ? recoverCompactionInstruction(parsed, extractChatGptTurnIdentity(parsed)) : undefined;
  const anchorIndex = checkpoint?.summaryIndex ?? activeUserIndex;
  const turnId = metadata?.turn_id;
  // A later current-turn fragment supersedes the start envelope and must be checked against the
  // current native rollout before older cached authority can be used.
  if (input.slice(anchorIndex + 1).some(value => {
    const item = record(value);
    return hasEnvironmentContextFragment(item)
      && (itemTurnId(item) === undefined || itemTurnId(item) === turnId);
  })) return undefined;
  const currentByTurn = environmentBeforeUser(
    input,
    activeUserIndex,
    typeof turnId === "string" ? turnId : undefined,
    metadata,
  );
  if (currentByTurn) return currentByTurn;

  const current = checkpoint && metadata
    ? canonicalMetadataEnvironmentBefore(input, checkpoint.summaryIndex, metadata)
    : canonicalMetadataEnvironmentBeforeUser(input, activeUserIndex, metadata);
  if (current) return current;

  // A skill invocation appends another server-owned user item after the real instruction. Recover
  // the earlier current-turn environment/prompt pair only through canonical metadata, and bind all
  // declared roots to metadata workspaces so user-authored XML cannot widen filesystem authority.
  let crossedAssistantOutput = false;
  for (let index = activeUserIndex - 1; index > 0; index -= 1) {
    crossedAssistantOutput ||= hasAssistantOutputBetween(input, index, index + 1);
    // Replayed untagged history is not a same-turn skill invocation. Only explicit current-turn
    // provenance may cross an assistant response; otherwise resolve from the native rollout.
    if (crossedAssistantOutput && itemTurnId(input[index]) !== turnId) continue;
    const sameTurn = canonicalMetadataEnvironmentBeforeUser(input, index, metadata, true);
    if (sameTurn) return sameTurn;
  }

  // An attempted current update takes precedence over all older authority, even when its native
  // item metadata is incomplete. Never mask malformed permissions/cwd with a previous turn.
  if (hasCurrentChatGptEnvironmentContext(parsed)) return undefined;

  const replayPrefixLen = Math.min(parsed._replayPrefixLen ?? 0, input.length);
  for (let index = replayPrefixLen - 1; index > 0; index -= 1) {
    const replayed = environmentBeforeUser(input, index, undefined, metadata);
    if (replayed) return replayed;
  }

  // Codex can resume a local task by explicitly replaying its native transcript instead of
  // sending previous_response_id. In that shape, accept a historical environment/user pair only
  // when both items carry the same native turn_id and either completed assistant output separates
  // that turn from the active user or the complete historical pair is server-owned and its
  // filesystem authority still matches the current thread's canonical workspace/sandbox metadata.
  // A user-authored <environment_context> inside one chat message cannot satisfy this structure.
  const currentTurnId = typeof turnId === "string" ? turnId : undefined;
  const currentThreadId = typeof metadata?.thread_id === "string" && metadata.thread_id.trim()
    ? metadata.thread_id
    : undefined;
  const activeUser = record(input[activeUserIndex]);
  const activeUserOwned = isUserOrParentInstruction(activeUser, metadata)
    && typeof activeUser.id === "string"
    && activeUser.id.length > 0
    && itemTurnId(activeUser) === currentTurnId;
  if (currentTurnId && itemTurnId(activeUser) === currentTurnId) {
    for (let index = activeUserIndex - 1; index > 0; index -= 1) {
      const historicalUser = record(input[index]);
      const historicalTurnId = itemTurnId(historicalUser);
      if (!historicalTurnId || historicalTurnId === currentTurnId) continue;
      const historical = environmentBeforeUser(input, index, undefined, metadata);
      if (!historical) continue;
      if (hasAssistantOutputBetween(input, index + 1, activeUserIndex)) return historical;
      if (!currentThreadId || !metadata || !activeUserOwned) continue;
      const bounded = canonicalMetadataEnvironmentBeforeUser(
        input,
        index,
        { ...metadata, turn_id: historicalTurnId, sandbox: canonicalSandboxMetadata(metadata) },
        true,
      );
      if (bounded === historical) return bounded;
    }
  }
  return undefined;
}

function clientMetadataWorkspaceRoots(parsed: CodexParsedRequest): string[] {
  const workspaces = record(clientTurnMetadata(parsed)?.workspaces);
  if (!workspaces) return [];
  const roots = Object.keys(workspaces);
  if (roots.some(path => !isAbsolute(path))) return [];
  return [...new Set(roots.map(pathIdentity))];
}

function trustedEnvironmentText(parsed: CodexParsedRequest): string {
  const raw = rawEnvironmentText(parsed);
  if (raw) return raw;
  // A real Responses request always has `_rawBody`. Parsed system/developer text has already lost
  // the wire provenance needed to distinguish Codex context from user-authored XML, so it must
  // never become filesystem authority for a raw request.
  if (parsed._rawBody !== undefined) return "";
  const system = parsed.context.systemPrompt ?? [];
  const developer = parsed.context.messages
    .filter(message => message.role === "developer")
    .map(message => contentText(message.content));
  return [...system, ...developer].join("\n");
}

export function extractChatGptTurnEnvironment(parsed: CodexParsedRequest): ChatGptTurnEnvironment {
  return parseChatGptEnvironmentText(parsed, trustedEnvironmentText(parsed));
}

function parseChatGptEnvironmentText(parsed: CodexParsedRequest, text: string): ChatGptTurnEnvironment {
  return { ...parseEnvironmentEnvelope(text, clientMetadataWorkspaceRoots(parsed)), tools: parsed.context.tools ?? [] };
}

export function extractChatGptTurnIdentity(parsed: CodexParsedRequest): ChatGptTurnIdentity {
  if (parsed._hermesContext) return {
    threadId: parsed._hermesContext.threadId, turnId: parsed._hermesContext.turnId,
  };
  const body = record(parsed._rawBody);
  return {
    ...extractCodexTurnIdentityFromBody(body),
    ...(typeof body?.prompt_cache_key === "string" ? { promptCacheKey: body.prompt_cache_key } : {}),
  };
}

/**
 * Return the canonical parent link carried by a native Codex thread-spawn request.
 * This is deliberately stricter than generic metadata parsing: only a real child turn with an
 * agent name, explicit turn purpose, sandbox policy, and absolute workspace evidence can inherit
 * filesystem authority from a previously verified parent thread.
 */
export function extractChatGptThreadSpawnLineage(
  parsed: CodexParsedRequest,
): ChatGptThreadSpawnLineage | undefined {
  const metadata = clientTurnMetadata(parsed);
  if (!metadata || !isEnvironmentRequest(metadata, parsed) || metadata.subagent_kind !== "thread_spawn") return undefined;
  const threadId = typeof metadata.thread_id === "string" ? metadata.thread_id.trim() : "";
  const parentThreadId = typeof metadata.parent_thread_id === "string" ? metadata.parent_thread_id.trim() : "";
  const agentName = typeof metadata.agent_name === "string" ? metadata.agent_name.trim() : "";
  if (!threadId || !parentThreadId || threadId === parentThreadId
    || (agentName !== "/root" && !/^\/root\/.+/.test(agentName))) return undefined;

  const sandboxType = sandboxTypeFromMetadata(canonicalSandboxMetadata(metadata));
  if (!sandboxType || sandboxType === "platform") return undefined;
  const workspaces = record(metadata.workspaces);
  const workspacePaths = workspaces ? Object.keys(workspaces) : [];
  if (workspacePaths.some(path => !isAbsolute(path))) return undefined;
  const workspaceRoots = [...new Set(workspacePaths.map(path => resolve(path)))];
  return { threadId, parentThreadId, agentName, sandboxType, workspaceRoots };
}

/** Root tasks have no spawn edge; their canonical session and current turn must prove authority. */
export function extractChatGptRootThreadMetadata(parsed: CodexParsedRequest): ChatGptRootThreadMetadata | undefined {
  const metadata = clientTurnMetadata(parsed);
  if (!metadata || !isEnvironmentRequest(metadata, parsed)
    || metadata.parent_thread_id != null || metadata.subagent_kind != null
    || (metadata.agent_name != null && metadata.agent_name !== "/root")) return undefined;
  const threadId = typeof metadata.thread_id === "string" ? metadata.thread_id.trim() : "";
  const sandboxType = sandboxTypeFromMetadata(canonicalSandboxMetadata(metadata));
  const workspaces = record(metadata.workspaces);
  const workspacePaths = workspaces ? Object.keys(workspaces) : [];
  if (!threadId || !sandboxType || workspacePaths.some(path => !isAbsolute(path))) return undefined;
  return { threadId, sandboxType, workspaceRoots: [...new Set(workspacePaths.map(path => resolve(path)))] };
}

function isEnvironmentRequest(metadata: Record<string, unknown>, parsed: CodexParsedRequest): boolean {
  return metadata.request_kind === "turn"
    || (parsed._compactionRequest === true && metadata.request_kind === "compaction");
}
