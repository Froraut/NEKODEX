import { createHash } from "node:crypto";
import type { ResponseContinuationScope } from "./state-snapshot";
export type { ResponseContinuationScope } from "./state-snapshot";

const MAX_PROVIDER_NAMESPACE_LENGTH = 128;
const MAX_OWNER_KEY_LENGTH = 128;
const MAX_ACCOUNT_ROUTING_KEY_LENGTH = 128;

export interface ResponseContinuationOwnerContext {
  /** Stable cache namespace. Use the same namespace when a native request expands Web-owned output. */
  providerNamespace: string;
  threadId?: string;
  promptCacheKey?: string;
  turnId?: string;
  /** The launcher's already-derived sticky account key, when the selected route has one. */
  accountRoutingKey?: string;
}

export function boundedIdentity(value: unknown, maxLength: number): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= maxLength;
}

export function normalizeContinuationScope(value: unknown): ResponseContinuationScope | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Response continuation scope must be an object");
  }
  const scope = value as Partial<ResponseContinuationScope>;
  if (!boundedIdentity(scope.providerNamespace, MAX_PROVIDER_NAMESPACE_LENGTH)) {
    throw new TypeError("Response continuation provider namespace is invalid");
  }
  if (!boundedIdentity(scope.ownerKey, MAX_OWNER_KEY_LENGTH) || !/^[a-f0-9]{64}$/.test(scope.ownerKey)) {
    throw new TypeError("Response continuation owner key is invalid");
  }
  if (scope.accountRoutingKey !== undefined
    && (!boundedIdentity(scope.accountRoutingKey, MAX_ACCOUNT_ROUTING_KEY_LENGTH)
      || !/^[a-f0-9]{64}$/.test(scope.accountRoutingKey))) {
    throw new TypeError("Response continuation account routing key is invalid");
  }
  return {
    providerNamespace: scope.providerNamespace,
    ownerKey: scope.ownerKey,
    ...(scope.accountRoutingKey !== undefined ? { accountRoutingKey: scope.accountRoutingKey } : {}),
  };
}

/**
 * Derive a persistence-safe owner scope from the same native identity and account-affinity inputs
 * used by request routing. Callers should pass the returned scope to resolve/expand and remember.
 * No scope is returned for ordinary OpenAI-compatible requests that carry no stable native owner.
 */
export function createResponseContinuationScope(
  context: ResponseContinuationOwnerContext,
): ResponseContinuationScope | undefined {
  const owner = boundedIdentity(context.threadId, 4_096)
    ? { kind: "thread", id: context.threadId }
    : boundedIdentity(context.promptCacheKey, 4_096)
      ? { kind: "prompt_cache", id: context.promptCacheKey }
      : boundedIdentity(context.turnId, 4_096)
        ? { kind: "turn", id: context.turnId }
        : undefined;
  if (!owner) return undefined;
  if (!boundedIdentity(context.providerNamespace, MAX_PROVIDER_NAMESPACE_LENGTH)) {
    throw new TypeError("Response continuation provider namespace is invalid");
  }
  if (context.accountRoutingKey !== undefined
    && (!boundedIdentity(context.accountRoutingKey, MAX_ACCOUNT_ROUTING_KEY_LENGTH)
      || !/^[a-f0-9]{64}$/.test(context.accountRoutingKey))) {
    throw new TypeError("Response continuation account routing key is invalid");
  }
  return {
    providerNamespace: context.providerNamespace,
    ownerKey: createHash("sha256").update(JSON.stringify(owner)).digest("hex"),
    ...(context.accountRoutingKey !== undefined ? { accountRoutingKey: context.accountRoutingKey } : {}),
  };
}

export function continuationScopeStatus(
  stored: ResponseContinuationScope | undefined,
  expected: ResponseContinuationScope | undefined,
): "retained" | "owner-mismatch" | "owner-unavailable" {
  if (!stored && !expected) return "retained";
  if (!stored || !expected) return "owner-unavailable";
  return stored.providerNamespace === expected.providerNamespace
    && stored.ownerKey === expected.ownerKey
    && stored.accountRoutingKey === expected.accountRoutingKey
    ? "retained"
    : "owner-mismatch";
}
