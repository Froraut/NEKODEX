import type { AppConfig } from "./config";
import type { CodexModelContextOverride } from "./codex-integration";
import {
  availableChatGptWebModelRoutes,
  CHATGPT_WEB_MODEL_PREFIX,
  resolveChatGptWebContextLimits,
  type ChatGptWebModelRoute,
} from "./chatgpt-web-models";

type JsonObject = Record<string, unknown>;

const WEB_CATALOG_ORDER = [
  "chatgpt-web/pro",
  "chatgpt-web/extra-high",
  "chatgpt-web/high",
  "chatgpt-web/medium",
  "chatgpt-web/light",
] as const;

function webCatalogRank(route: ChatGptWebModelRoute): number {
  const index = WEB_CATALOG_ORDER.findIndex(slug => slug === route.slug);
  return index < 0 ? WEB_CATALOG_ORDER.length : index;
}

function object(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object`);
  }
  return value as JsonObject;
}

function slug(value: unknown): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const candidate = (value as JsonObject).slug;
  return typeof candidate === "string" ? candidate : undefined;
}

function reasoningLevel(template: JsonObject, effort: string, description: string): JsonObject {
  const levels = Array.isArray(template.supported_reasoning_levels)
    ? template.supported_reasoning_levels.filter(level => level && typeof level === "object" && !Array.isArray(level)) as JsonObject[]
    : [];
  const source = levels.find(level => level.effort === effort);
  return { ...(source ? structuredClone(source) : {}), effort, description };
}

function modelPriority(template: JsonObject): number | undefined {
  const value = template.priority;
  if (value === undefined) return undefined;
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new Error("Native Codex model template priority must be an integer");
  }
  return value;
}

function webCatalogPriority(nativeModels: unknown[], template: JsonObject): number | undefined {
  const visiblePriorities = nativeModels.flatMap(candidate => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return [];
    const model = candidate as JsonObject;
    return model.visibility === "list" && typeof model.priority === "number"
      && Number.isSafeInteger(model.priority) ? [model.priority] : [];
  }).toSorted((left, right) => left - right);
  // Codex sorts by priority while retaining catalog order for ties. Web rows are appended after
  // native rows, so sharing the third visible native model's priority puts them immediately after
  // Astra, Sol and Luna in the current catalog, ahead of the next lower-ranked native model.
  return visiblePriorities[Math.min(2, visiblePriorities.length - 1)] ?? modelPriority(template);
}

function nativeTemplateCandidate(value: unknown, requireTools: boolean): value is JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const model = value as JsonObject;
  const modelSlug = slug(model);
  if (!modelSlug || modelSlug.startsWith(CHATGPT_WEB_MODEL_PREFIX)) return false;
  // This route forwards ChatGPT authentication. Codex's own model manager keeps every list-visible
  // model in ChatGPT mode even when `supported_in_api` is false; that flag gates API-key mode, not
  // whether the backend row is a valid catalog template. The routed Web row overrides the flag to
  // true because this local Responses endpoint implements it.
  if (model.visibility !== "list") return false;
  if (!Array.isArray(model.supported_reasoning_levels)) return false;
  return !requireTools || (typeof model.tool_mode === "string" && model.tool_mode.length > 0);
}

function selectNativeTemplate(models: unknown[], config: AppConfig): JsonObject {
  const requireTools = config.mode === "full";
  const candidates = models.filter(model => nativeTemplateCandidate(model, requireTools)) as JsonObject[];
  const template = candidates[0];
  if (template) return template;
  throw new Error(
    requireTools
      ? "Native Codex models response has no list-visible, tool-capable model with reasoning metadata"
      : "Native Codex models response has no list-visible model with reasoning metadata",
  );
}

function useCompatibilityV1SubagentSurface(model: JsonObject): void {
  // Compatibility V1 is an explicit whole-task protocol mode. Preserve an explicit disabled
  // capability instead of advertising support that the native model denied.
  if (model.multi_agent_version !== "disabled") model.multi_agent_version = "v1";
}

function routedSubagentVersion(template: JsonObject, config: AppConfig): string | undefined {
  if (config.allowWebSubagents === false) return "disabled";
  if (config.subagentProtocol === "compatibility-v1") return "v1";
  return typeof template.multi_agent_version === "string" ? template.multi_agent_version : undefined;
}

export function buildChatGptWebModel(
  templateValue: unknown,
  route: ChatGptWebModelRoute,
  config: AppConfig,
  catalogPriority?: number,
): JsonObject {
  const template = object(templateValue, "native Codex model template");
  const templateSlug = slug(template);
  if (!templateSlug || templateSlug.startsWith(CHATGPT_WEB_MODEL_PREFIX)) {
    throw new Error("ChatGPT Web model template must be a native Codex model");
  }
  const limits = resolveChatGptWebContextLimits(route.backendModel, route.adapterEffort, config);
  const multiAgentVersion = routedSubagentVersion(template, config);
  const priority = catalogPriority ?? modelPriority(template);
  const model: JsonObject = {
    ...structuredClone(template),
    slug: route.slug,
    display_name: route.displayName,
    description: route.description,
    input_modalities: route.interactionMode === "manual" ? ["text"] : ["text", "image"],
    visibility: "list",
    // These slugs are implemented by this local Responses-compatible bridge. Marking them false
    // makes Codex drop them from spawn_agent whenever openai_base_url points at the bridge.
    supported_in_api: true,
    // The same priority also controls Codex's bounded spawn-agent override list. Keep native
    // models ahead of Web routes; Pro and Extra High are the first Web overrides when slots remain.
    ...(priority === undefined ? {} : { priority }),
    // ChatGPT Web stays out of spawn_agent unless the user explicitly allows Web sub-agents.
    ...(multiAgentVersion === undefined ? {} : { multi_agent_version: multiAgentVersion }),
    // Code mode collapses the outer registry into an exec gateway; routed models need the regular
    // Responses tool surface so MCP namespaces, deferred tool_search, and custom tools reach us.
    tool_mode: null,
    upgrade: null,
    default_reasoning_level: route.codexEffort,
    supported_reasoning_levels: [reasoningLevel(template, route.codexEffort, route.displayName)],
    context_window: limits.contextWindow,
    max_context_window: limits.contextWindow,
    effective_context_window_percent: limits.effectiveContextWindowPercent,
    auto_compact_token_limit: limits.autoCompactTokenLimit,
    // ChatGPT Web has no Codex service tier. Never inherit the native template's Fast tiers.
    additional_speed_tiers: [],
    service_tiers: [],
    default_service_tier: null,
  };
  // A native template's compaction hash describes OpenAI's native model contract, not this routed
  // browser model. The explicit Web window above is owned by this adapter and never copied back to
  // native models or the user's top-level model_context_window setting.
  delete model.comp_hash;
  delete model.availability_nux;
  return model;
}

export function augmentNativeModelCatalog(
  value: unknown,
  config: AppConfig,
  contextOverride?: CodexModelContextOverride,
): JsonObject {
  const catalog = object(value, "native Codex models response");
  if (!Array.isArray(catalog.models)) {
    throw new Error("Native Codex models response is missing a models array");
  }
  const nativeModels = structuredClone(
    catalog.models.filter(model => !slug(model)?.startsWith(CHATGPT_WEB_MODEL_PREFIX)),
  );
  if (config.subagentProtocol === "compatibility-v1") {
    for (const candidate of nativeModels) {
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        useCompatibilityV1SubagentSurface(candidate as JsonObject);
      }
    }
  }
  const template = selectNativeTemplate(nativeModels, config);
  if (contextOverride) {
    // model_context_window is a single top-level Codex setting, not a per-model one. Apply its
    // advertised maximum to every native row so switching native models cannot silently clamp the
    // effective override. Codex itself applies context_window and auto-compaction configuration.
    for (const candidate of nativeModels) {
      const modelSlug = slug(candidate);
      if (!modelSlug) continue;
      const model = object(candidate, `native ${modelSlug} model`);
      const current = model.max_context_window;
      if (current !== undefined && current !== null
        && (typeof current !== "number" || !Number.isSafeInteger(current) || current <= 0)) {
        throw new Error(`Native ${modelSlug} max_context_window must be a positive integer`);
      }
      if (current === undefined || current === null || current < contextOverride.contextWindow) {
        model.max_context_window = contextOverride.contextWindow;
      }
    }
  }
  const priority = webCatalogPriority(nativeModels, template);
  const webModels = availableChatGptWebModelRoutes(config)
    .toSorted((left, right) => webCatalogRank(left) - webCatalogRank(right))
    .map(route => buildChatGptWebModel(template, route, config, priority));
  return {
    ...structuredClone(catalog),
    models: [...nativeModels, ...webModels],
  };
}
