import type { AppConfig } from "../config";
import { CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET } from "../adapters/chatgpt-web/input-tokens";
import { availableChatGptWebModelRoutes, CHATGPT_WEB_LUNA_BACKEND_MODEL, CHATGPT_WEB_PLATFORM_RESERVE_TOKENS,
  resolveChatGptWebContextLimits, resolveChatGptWebMessageTokenBudget } from "../chatgpt-web-models";

const PREFIX = "claude-chatgpt-web-";
export const claudeGatewayModelId = (slug: string) => PREFIX + slug.slice("chatgpt-web/".length);
export const resolveClaudeGatewayModelId = (id: string) => id.startsWith(PREFIX)
  ? "chatgpt-web/" + id.slice(PREFIX.length) : undefined;

export function claudeGatewayModels(config: AppConfig) {
  return availableChatGptWebModelRoutes(config).filter(route => route.interactionMode === "automatic").map(route => ({
    id: claudeGatewayModelId(route.slug), type: "model", display_name: route.displayName,
    created_at: "2026-09-27T00:00:00Z",
    max_input_tokens: Math.max(1, Math.min(
      resolveChatGptWebContextLimits(route.backendModel, route.adapterEffort, { ...config, experimentalBiggerContext: false }).autoCompactTokenLimit,
      route.backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL ? CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET
        : resolveChatGptWebMessageTokenBudget(route.backendModel, route.adapterEffort, config),
    ) - CHATGPT_WEB_PLATFORM_RESERVE_TOKENS),
  }));
}

export function preferredClaudeGatewayModelIds(config: AppConfig): string[] {
  return claudeGatewayModels(config).map(model => model.id).sort((a, b) =>
    Number(b === `${PREFIX}gpt-5.6-sol`) - Number(a === `${PREFIX}gpt-5.6-sol`));
}

export function claudeGatewayModelsResponse(config: AppConfig): Response {
  const data = claudeGatewayModels(config);
  return Response.json({ data, has_more: false, first_id: data[0]?.id ?? null, last_id: data.at(-1)?.id ?? null },
    { headers: { "cache-control": "no-store" } });
}

export function isClaudeGatewayModelsRequest(request: Request): boolean {
  return request.headers.has("anthropic-version") || new URL(request.url).pathname.startsWith("/claude/");
}
