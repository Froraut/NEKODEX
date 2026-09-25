import { createHash } from "node:crypto";
import { boundedIdentity } from "../lib/bounded-identity";
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

function assertProviderNamespace(value: unknown): asserts value is string {
  if (!boundedIdentity(value, MAX_PROVIDER_NAMESPACE_LENGTH)) {
    throw new TypeError("Response continuation provider namespace is invalid");
  }
}

function assertAccountRoutingKey(value: unknown): void {
  if (value !== undefined
    && (!boundedIdentity(value, MAX_ACCOUNT_ROUTING_KEY_LENGTH)
      || !/^[a-f0-9]{64}$/.test(value))) {
    throw new TypeError("Response continuation account routing key is invalid");
  }
}

export function normalizeContinuationScope(value: unknown): ResponseContinuationScope | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Response continuation scope must be an object");
  }
  const scope = value as Partial<ResponseContinuationScope>;
  assertProviderNamespace(scope.providerNamespace);
  if (!boundedIdentity(scope.ownerKey, MAX_OWNER_KEY_LENGTH) || !/^[a-f0-9]{64}$/.test(scope.ownerKey)) {
    throw new TypeError("Response continuation owner key is invalid");
  }
  assertAccountRoutingKey(scope.accountRoutingKey);
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
  assertProviderNamespace(context.providerNamespace);
  assertAccountRoutingKey(context.accountRoutingKey);
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
