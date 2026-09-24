import type { CodexTool, CodexRequestOptions } from "../types";
import { namespacedToolName } from "../types";
import { CHATGPT_WEB_MODEL_PREFIX } from "../chatgpt-web-models";
import { isCollaborationTool } from "../collaboration-tools";
import { toolSchema } from "./schema";

function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export interface ToolAvailabilityPolicy {
  model: string;
  allowWebSubagents?: boolean;
}

/** Stable first-declaration precedence by the actual adapter wire name. */
export function availableTools(tools: readonly CodexTool[], policy: ToolAvailabilityPolicy): CodexTool[] {
  const seen = new Set<string>();
  return tools.filter(tool => {
    if (policy.model.startsWith(CHATGPT_WEB_MODEL_PREFIX)
      && policy.allowWebSubagents === false && isCollaborationTool(tool)) return false;
    const name = namespacedToolName(tool.namespace, tool.name);
    if (seen.has(name)) return false;
    seen.add(name);
    return true;
  });
}

export function projectAvailableTools(specs: unknown[] | undefined, policy: ToolAvailabilityPolicy): CodexTool[] {
  return availableTools(buildTools(specs) ?? [], policy);
}

export function mapToolChoice(value: unknown): CodexRequestOptions["toolChoice"] {
  if (value === undefined || value === null) return undefined;
  if (value === "auto" || value === "none" || value === "required") return value;
  if (isObj(value) && "type" in value) {
    const t = (value as { type: string }).type;
    if ((t === "function" || t === "custom") && "name" in value) {
      return { name: (value as { name: string }).name };
    }
    if (t === "allowed_tools" && Array.isArray(value.tools)) {
      const names = value.tools
        .map(allowedToolName)
        .filter((name): name is string => Boolean(name));
      return names.length > 0
        ? { allowedTools: [...new Set(names)], mode: value.mode === "required" ? "required" : "auto" }
        : "none";
    }
    return "auto";
  }
  return undefined;
}

function allowedToolName(tool: unknown): string | undefined {
  if (!isObj(tool)) return undefined;
  if (typeof tool.name === "string" && tool.name.length > 0) return tool.name;
  if (tool.type === "web_search" || tool.type === "web_search_preview") return "web_search";
  if (tool.type === "tool_search") return "tool_search";
  return undefined;
}

const DEFAULT_FUNCTION_NAMESPACE = "functions";

function normalizedToolNamespace(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 && value !== DEFAULT_FUNCTION_NAMESPACE
    ? value
    : undefined;
}

function buildTools(tools: unknown[] | undefined): CodexTool[] | undefined {
  if (!tools) return undefined;
  const out: CodexTool[] = [];
  const pushFn = (t: Record<string, unknown>, namespace?: string) => {
    // Namespaced and deferred definitions arrive through open extension envelopes, bypassing
    // the top-level request tool schema. Enforce the same known-function contract here while
    // leaving client-defined extension tool shapes open.
    if (t.type === "function") {
      const validated = toolSchema.safeParse(t);
      if (!validated.success) throw new Error(`responses parse error: ${validated.error.message}`);
      t = validated.data;
    }
    const tool: CodexTool = {
      name: t.name as string,
      description: (t.description as string) ?? "",
      parameters: (t.parameters ?? {}) as Record<string, unknown>,
    };
    if (t.strict !== undefined) tool.strict = t.strict as boolean;
    if (namespace) tool.namespace = namespace;
    out.push(tool);
  };
  const pushFreeform = (t: Record<string, unknown>) => {
    const tool: CodexTool = {
      name: t.name as string,
      description: (t.description as string) ?? "",
      parameters: {
        type: "object",
        properties: {
          input: {
            type: "string",
            description: "Raw tool input. For apply_patch, begin exactly with `*** Begin Patch` (no trailing `***`), then use its standard patch envelope.",
          },
        },
        required: ["input"],
      },
      freeform: true,
    };
    out.push(tool);
  };
  for (const t of tools) {
    if (!isObj(t)) continue;
    if (t.type === "function") {
      pushFn(t);
    } else if (t.type === "namespace" && Array.isArray(t.tools)) {
      // Responses Lite groups ordinary native functions and the native freeform `exec` tool under
      // the default `functions` namespace. Flatten normal functions from every namespace, and the
      // official freeform variant only from that default namespace. Non-default custom namespaces
      // need a distinct round-trip contract and must not be silently exposed as function calls.
      const ns = normalizedToolNamespace(t.name);
      for (const inner of t.tools as unknown[]) {
        if (!isObj(inner)) continue;
        if (inner.type === "function") pushFn(inner, ns);
        else if (typeof inner.name === "string" && t.name === DEFAULT_FUNCTION_NAMESPACE && inner.type === "custom") pushFreeform(inner);
      }
    }
    else if (t.type === "custom" && typeof t.name === "string") {
      // Freeform custom tool (e.g. apply_patch). Chat models can't emit a lark grammar, so expose a
      // function with a single string `input` carrying the raw tool body; the bridge relays the model's
      // call back as a custom_tool_call (Codex's freeform handler rejects a function_call → fatal abort).
      pushFreeform(t);
    }
    else if (t.type === "tool_search") {
      // Client-executed tool discovery — the gateway to deferred tools (subagents, extra MCP tools).
      // Expose as a function so chat models can call it; the bridge relays it as a tool_search_call.
      out.push({
        name: "tool_search",
        description: (t.description as string) ?? "Search for additional tools to load for the next turn.",
        parameters: (isObj(t.parameters) ? t.parameters : {
          type: "object",
          properties: {
            query: { type: "string", description: "Search query for tools to load." },
            limit: { type: "number", description: "Maximum number of tools to return." },
          },
          required: ["query"],
        }) as Record<string, unknown>,
        toolSearch: true,
      });
    }
    else if (typeof t.name === "string" && t.type !== "web_search" && t.type !== "image_generation") {
      // Any other named tool (for example a native computer-use tool type this parser does not
      // model) is client-executed. Pass it through as a function so the routed model can call it
      // naturally and the bridge can relay it as a function_call.
      pushFn(t);
    }
    // Only the OpenAI-hosted server-side tools (web_search, image_generation) are intentionally
    // dropped — they're executed by OpenAI and can't be relayed to a routed chat model.
  }
  return out.length > 0 ? out : undefined;
}
