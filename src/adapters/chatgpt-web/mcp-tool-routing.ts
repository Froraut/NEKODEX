import { chatgptWebBlockedGatewayWireNames, isSpawnCollaborationWireName } from "../../collaboration-tools";
import { namespacedToolName, type CodexTool } from "../../types";
import type { ChatGptTurnEnvironment } from "./environment";
import { CODEX_COMPACTION_CONTROL_WIRE_NAME } from "./native-compaction-control";

export type ChatGptMcpContract = "native" | "safe";

export const BRIDGE_TOOL_NAMES: ReadonlySet<string> = new Set([
  "codex_turn_start",
  "codex_exec",
  "codex_write_stdin",
  "codex_apply_patch",
  "codex_view_image",
  "codex_read_thread",
  "codex_tool_inventory",
  "codex_tool_call",
  "codex_tool_start",
  "codex_tool_poll",
  "codex_tool_cancel",
  "codex_tool_status",
  "codex_turn_complete",
]);

const GATEWAY_AGENT_WAIT_TOOL_NAMES = new Set([
  "multi_agent_v1__wait_agent",
  "multi_agent_v2__wait_agent",
  "collaboration__wait_agent",
]);

// Match Codex's default wait interval while returning before the MCP invocation deadline.
export const CHATGPT_WEB_AGENT_WAIT_POLL_MS = 30_000;
const AGENT_WAIT_TRANSPORT_RULE = `ChatGPT Web transport rule: wait for exactly ${CHATGPT_WEB_AGENT_WAIT_POLL_MS / 1_000} seconds per call, matching the Codex default, then release the MCP channel so spawned Web agents can use their own tools. A wait timeout is not task completion; check agent progress and wait again if needed. Keep the native tool's declared arguments.`;

export function wireName(tool: CodexTool): string {
  return namespacedToolName(tool.namespace, tool.name);
}

export function exactTool(environment: ChatGptTurnEnvironment, name: string): CodexTool | undefined {
  return environment.tools.find(tool => !tool.namespace && tool.name === name);
}

export function exactCodexAppTool(environment: ChatGptTurnEnvironment, name: string): CodexTool | undefined {
  const candidates = environment.tools.filter(tool => wireName(tool) === `mcp__codex_app__${name}`);
  if (candidates.length > 1 || candidates.some(tool => tool.freeform)) {
    throw new Error(`The current outer Codex turn must advertise exactly one structured mcp__codex_app__${name} tool`);
  }
  return candidates[0];
}

function gatewayToolNameIsValid(name: string): boolean {
  return /^[A-Za-z0-9_$]+$/.test(name);
}

export function safeVisibleTools(environment: ChatGptTurnEnvironment, policy: McpToolRoutingPolicy): CodexTool[] {
  const { contract, allowWebSubagents } = policy;
  // The native exec realm cannot be restricted by a JavaScript wrapper. Keep it private when
  // delegation is disabled; trusted, structured gateway programs can still use it internally.
  const tools = environment.tools.filter(tool => allowWebSubagents
    || (tool !== execGateway(environment) && !isSpawnCollaborationWireName(wireName(tool))));
  if (contract === "native") return tools;
  const bridgeNamespaces = new Set(environment.tools
    .filter(tool => tool.namespace && BRIDGE_TOOL_NAMES.has(tool.name))
    .map(tool => tool.namespace!));
  return tools.filter(tool => (
    wireName(tool) !== CODEX_COMPACTION_CONTROL_WIRE_NAME
    && !BRIDGE_TOOL_NAMES.has(tool.name)
    // Zero Risk does not expose model-authored JavaScript. Automatic Full mode keeps the native
    // Codex exec surface and applies its transport guard at invocation time below.
    && (tool.namespace !== undefined || tool.name !== "exec")
    && (!tool.namespace || !bridgeNamespaces.has(tool.namespace))
  ));
}

function isAgentWaitTool(tool: CodexTool): boolean {
  return isGatewayAgentWaitTool(wireName(tool));
}

function isGatewayAgentWaitTool(name: string): boolean {
  return GATEWAY_AGENT_WAIT_TOOL_NAMES.has(name);
}

export function browserToolDescription(tool: CodexTool): string {
  if (isAgentWaitTool(tool)) return `${tool.description}\n\n${AGENT_WAIT_TRANSPORT_RULE}`;
  if (!tool.namespace && tool.name === "exec") {
    return `${tool.description}\n\n${AGENT_WAIT_TRANSPORT_RULE} Use the supplied tools wrapper for wait_agent polling; do not invoke recursive raw exec. These cooperative guards do not isolate arbitrary JavaScript.`;
  }
  return tool.description;
}

export function browserToolParameters(tool: CodexTool): Record<string, unknown> {
  if (!isAgentWaitTool(tool)) return tool.parameters;
  const parameters = structuredClone(tool.parameters);
  const properties = parameters.properties && typeof parameters.properties === "object" && !Array.isArray(parameters.properties)
    ? parameters.properties as Record<string, unknown>
    : {};
  const timeout = properties.timeout_ms && typeof properties.timeout_ms === "object" && !Array.isArray(properties.timeout_ms)
    ? properties.timeout_ms as Record<string, unknown>
    : {};
  // The cloned native schema must not advertise a default that contradicts our required interval.
  delete timeout.default;
  const required = Array.isArray(parameters.required)
    ? parameters.required.filter((value): value is string => typeof value === "string")
    : [];
  return {
    ...parameters,
    properties: {
      ...properties,
      timeout_ms: {
        ...timeout,
        type: "number",
        const: CHATGPT_WEB_AGENT_WAIT_POLL_MS,
        minimum: CHATGPT_WEB_AGENT_WAIT_POLL_MS,
        maximum: CHATGPT_WEB_AGENT_WAIT_POLL_MS,
        description: `Required transport-safe polling interval. Use exactly ${CHATGPT_WEB_AGENT_WAIT_POLL_MS}; a timed-out wait does not mean the agents have finished.`,
      },
    },
    required: [...new Set([...required, "timeout_ms"])],
  };
}

function assertBrowserToolArguments(tool: CodexTool, args: Record<string, unknown>): void {
  assertGatewayToolArguments(wireName(tool), args);
}

function assertGatewayToolArguments(name: string, args: Record<string, unknown>): void {
  if (!isGatewayAgentWaitTool(name)) return;
  if (args.timeout_ms !== CHATGPT_WEB_AGENT_WAIT_POLL_MS) {
    throw new Error(
      `ChatGPT Web wait_agent requires timeout_ms=${CHATGPT_WEB_AGENT_WAIT_POLL_MS}`
      + " so the shared MCP channel remains available to spawned Web agents",
    );
  }
}

export function execGateway(environment: ChatGptTurnEnvironment): CodexTool | undefined {
  const tool = exactTool(environment, "exec");
  return tool?.freeform ? tool : undefined;
}

function gatewayNestedToolName(toolName: string): string {
  return toolName.replace(/[^A-Za-z0-9_$]/g, "_");
}

interface GatewayToolDescriptor {
  name: string;
  description: string;
}

interface GatewayToolCatalogPage {
  tools: GatewayToolDescriptor[];
  total: number;
}

export function gatewayToolDescription(tool: GatewayToolDescriptor): string {
  if (!isGatewayAgentWaitTool(tool.name)) return tool.description;
  return `${tool.description}\n\n${AGENT_WAIT_TRANSPORT_RULE}`;
}

export function gatewayToolCatalogProgram(options: {
  query?: string;
  offset: number;
  limit: number;
  excludedNames: string[];
}): string {
  const needle = options.query?.trim().toLowerCase() ?? "";
  return [
    "if (typeof ALL_TOOLS === \"undefined\" || !Array.isArray(ALL_TOOLS)) throw new Error(\"Native nested tool registry is unavailable\");",
    `const excludedNames = new Set(${JSON.stringify(options.excludedNames)});`,
    `const needle = ${JSON.stringify(needle)};`,
    "const visibleName = name => {",
    "  return typeof name === \"string\" && /^[A-Za-z0-9_$]+$/.test(name) && !excludedNames.has(name);",
    "};",
    "const matches = ALL_TOOLS",
    "  .filter(tool => visibleName(tool?.name))",
    "  .map(tool => ({ name: tool.name, description: typeof tool.description === \"string\" ? tool.description : \"\" }))",
    "  .filter(tool => !needle || (tool.name + \"\\n\" + tool.description).toLowerCase().includes(needle));",
    `const page = matches.slice(${options.offset}, ${options.offset + options.limit});`,
    "text(JSON.stringify({ tools: page, total: matches.length }));",
  ].join("\n");
}

export function gatewayToolCatalogPage(response: {
  content: unknown[];
  isError?: boolean;
}, excludedNames: ReadonlySet<string>): GatewayToolCatalogPage {
  const textBlocks = response.content
    .map(item => item && typeof item === "object" && !Array.isArray(item)
      ? item as Record<string, unknown>
      : undefined)
    .filter((item): item is Record<string, unknown> => item?.type === "text" && typeof item.text === "string")
    .map(item => item.text as string);
  if (response.isError) {
    throw new Error(`Native nested tool inventory failed: ${textBlocks.join("\n") || "unknown error"}`);
  }
  if (textBlocks.length !== 1) {
    throw new Error("Native nested tool inventory returned an invalid text response");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(textBlocks[0]!);
  } catch {
    throw new Error("Native nested tool inventory returned invalid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Native nested tool inventory returned an invalid catalog");
  }
  const catalog = parsed as Record<string, unknown>;
  if (!Number.isSafeInteger(catalog.total) || (catalog.total as number) < 0 || !Array.isArray(catalog.tools)) {
    throw new Error("Native nested tool inventory returned invalid pagination");
  }
  const tools = catalog.tools.map((value): GatewayToolDescriptor => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Native nested tool inventory returned an invalid tool entry");
    }
    const tool = value as Record<string, unknown>;
    if (typeof tool.name !== "string"
      || typeof tool.description !== "string"
      || !gatewayToolNameIsValid(tool.name)
      || excludedNames.has(tool.name)) {
      throw new Error("Native nested tool inventory returned an invalid tool descriptor");
    }
    return { name: tool.name, description: tool.description };
  });
  return { tools, total: catalog.total as number };
}

function execGatewayResultProgram(invocation: string[], toolName: string): string {
  return [
    ...invocation,
    "if (result && typeof result === \"object\" && result.isError === true) {",
    "  const errorText = Array.isArray(result.content) ? result.content.filter(item => item?.type === \"text\" && typeof item.text === \"string\").map(item => item.text).join(\"\\n\").slice(0, 8192) : \"\";",
    "  let structuredError = \"\";",
    "  try { if (result.structuredContent !== undefined) structuredError = JSON.stringify(result.structuredContent)?.slice(0, 8192) ?? \"\"; } catch { structuredError = \"[unserializable structured error]\"; }",
    `  throw new Error("Native nested tool " + ${toolName} + " returned isError=true: " + (errorText || "no text content") + (structuredError ? "\\nstructuredContent: " + structuredError : ""));`,
    "}",
    "const emit = value => {",
    "  if (Array.isArray(value)) { for (const item of value) emit(item); return; }",
    "  if (value && typeof value === \"object\") {",
    "    if (value.type === \"image\") { image(value); return; }",
    "    if (value.type === \"audio\") { audio(value); return; }",
    "    if (value.type === \"text\" && typeof value.text === \"string\") { text(value.text); return; }",
    "    if (typeof value.image_url === \"string\" && typeof value.output_hint === \"string\") { generatedImage(value); return; }",
    "    if (typeof value.image_url === \"string\") { image(value.image_url, value.detail ?? \"auto\"); return; }",
    "    if (typeof value.audio_url === \"string\") { audio(value.audio_url); return; }",
    "    if (Array.isArray(value.content)) { for (const item of value.content) emit(item); return; }",
    "  }",
    "  text(value);",
    "};",
    "const emitMedia = value => {",
    "  if (Array.isArray(value)) { for (const item of value) emitMedia(item); return; }",
    "  if (!value || typeof value !== \"object\") return;",
    "  if (value.type === \"image\") { image(value); return; }",
    "  if (value.type === \"audio\") { audio(value); return; }",
    "  if (typeof value.image_url === \"string\" && typeof value.output_hint === \"string\") { generatedImage(value); return; }",
    "  if (typeof value.image_url === \"string\") { image(value.image_url, value.detail ?? \"auto\"); return; }",
    "  if (typeof value.audio_url === \"string\") { audio(value.audio_url); return; }",
    "  if (Array.isArray(value.content)) { for (const item of value.content) emitMedia(item); }",
    "};",
    "const hasStructuredContent = result && typeof result === \"object\" && Object.prototype.hasOwnProperty.call(result, \"structuredContent\");",
    "const hasMeta = result && typeof result === \"object\" && Object.prototype.hasOwnProperty.call(result, \"_meta\");",
    "if (hasStructuredContent || hasMeta) {",
    "  const content = result && typeof result === \"object\" && Array.isArray(result.content) ? result.content : [];",
    "  emitMedia(content);",
    "  const envelope = { content, ...(hasStructuredContent ? { structuredContent: result.structuredContent } : {}), ...(hasMeta ? { _meta: result._meta } : {}) };",
    "  text(JSON.stringify(envelope));",
    "} else {",
    "  emit(result);",
    "}",
  ].join("\n");
}

export function execGatewayProgram(
  nestedToolName: string,
  freeform: boolean,
  payload: { arguments?: Record<string, unknown>; input?: string },
  excludedNames: string[],
): string {
  if (!gatewayToolNameIsValid(nestedToolName) || excludedNames.includes(nestedToolName)) {
    throw new Error(`Codex nested tool is not available in this turn: ${nestedToolName}`);
  }
  const gatewayName = gatewayNestedToolName(nestedToolName);
  if (gatewayName !== nestedToolName) {
    throw new Error(`Codex nested tool name is invalid: ${nestedToolName}`);
  }
  const nestedInput = freeform ? payload.input ?? "" : payload.arguments ?? {};
  return execGatewayResultProgram([
    "if (typeof ALL_TOOLS === \"undefined\" || !Array.isArray(ALL_TOOLS)) throw new Error(\"Native nested tool registry is unavailable\");",
    `const nestedToolName = ${JSON.stringify(gatewayName)};`,
    `const excludedNames = new Set(${JSON.stringify(excludedNames)});`,
    "if (excludedNames.has(nestedToolName)) throw new Error(\"Native nested tool is not callable through the structured gateway\");",
    "if (!ALL_TOOLS.some(tool => tool?.name === nestedToolName)) throw new Error(\"Native nested tool is not listed in this turn\");",
    "const nestedTool = tools[nestedToolName];",
    "if (typeof nestedTool !== \"function\") throw new Error(\"Native nested tool is listed but unavailable\");",
    `const result = await nestedTool(${JSON.stringify(nestedInput)});`,
  ], "nestedToolName");
}

/**
 * Preserve native freeform exec for unrestricted delegation, with cooperative transport guards.
 * This wrapper is not an isolation boundary for model-authored JavaScript. Restricted turns must
 * use the structured gateway, whose tool name and input are serialized by trusted host code.
 */
export function transportBoundRawExecProgram(
  input: string,
  blockedExecName: string,
  spawnExclusions: readonly string[] = [],
): string {
  if (spawnExclusions.length > 0) {
    throw new Error("Raw exec is unavailable while Web subagents are disabled; use structured tool calls");
  }
  return [
    "await (async (tools) => {",
    input,
    "})((() => {",
    "  const source = tools;",
    `  const waitNames = new Set(${JSON.stringify([...GATEWAY_AGENT_WAIT_TOOL_NAMES])});`,
    `  const spawnNames = new Set(${JSON.stringify(spawnExclusions)});`,
    `  const blockedExecName = ${JSON.stringify(blockedExecName)};`,
    `  const pollMs = ${CHATGPT_WEB_AGENT_WAIT_POLL_MS};`,
    "  const registryNames = new Set(Reflect.ownKeys(source));",
    "  if (typeof ALL_TOOLS !== \"undefined\" && Array.isArray(ALL_TOOLS)) {",
    "    for (const tool of ALL_TOOLS) if (typeof tool?.name === \"string\") registryNames.add(tool.name);",
    "  }",
    "  const wrappers = new Map();",
    "  const expose = name => {",
    "    if (wrappers.has(name)) return wrappers.get(name);",
    "    const value = Reflect.get(source, name, source);",
    "    let exposed = value;",
    "    if (typeof value === \"function\" && name === blockedExecName) {",
    "      exposed = () => { throw new Error(\"Nested raw exec is unavailable inside ChatGPT Web exec\"); };",
    "    } else if (typeof value === \"function\" && typeof name === \"string\" && spawnNames.has(name)) {",
    "      exposed = () => { throw new Error(\"ChatGPT Web cannot run Codex \" + name); };",
    "    } else if (typeof value === \"function\" && typeof name === \"string\" && waitNames.has(name)) {",
    "      exposed = args => {",
    "        if (!args || typeof args !== \"object\" || Array.isArray(args) || args.timeout_ms !== pollMs) {",
    "          throw new Error(\"ChatGPT Web wait_agent requires timeout_ms=\" + pollMs + \" so the shared MCP channel remains available to spawned Web agents\");",
    "        }",
    "        return Reflect.apply(value, source, [args]);",
    "      };",
    "    } else if (typeof value === \"function\") {",
    "      exposed = (...args) => Reflect.apply(value, source, args);",
    "    }",
    "    wrappers.set(name, exposed);",
    "    return exposed;",
    "  };",
    "  return new Proxy(Object.create(null), {",
    "    get: (_target, name) => expose(name),",
    "    has: (_target, name) => registryNames.has(name) || Reflect.has(source, name),",
    "    ownKeys: () => [...registryNames],",
    "    getOwnPropertyDescriptor: (_target, name) =>",
    "      registryNames.has(name) || Reflect.has(source, name)",
    "        ? { configurable: true, enumerable: true, writable: false, value: expose(name) }",
    "        : undefined,",
    "    set: () => false,",
    "    defineProperty: () => false,",
    "    deleteProperty: () => false,",
    "    setPrototypeOf: () => false,",
    "    getPrototypeOf: () => null,",
    "    preventExtensions: () => false,",
    "  });",
    "})());",
  ].join("\n");
}

export function execCommandGatewayProgram(
  execCommandArguments: Record<string, unknown>,
  shellCommandArguments: Record<string, unknown>,
): string {
  const execCommandName = gatewayNestedToolName("exec_command");
  const shellCommandName = gatewayNestedToolName("shell_command");
  const unmappableShellOptions = ["tty", "max_output_tokens"]
    .filter(option => execCommandArguments[option] !== undefined);
  return execGatewayResultProgram([
    "if (typeof ALL_TOOLS === \"undefined\" || !Array.isArray(ALL_TOOLS)) throw new Error(\"Native command tool registry is unavailable\");",
    "const nativeCommandNames = new Set(ALL_TOOLS.map(tool => tool?.name));",
    `const nativeCommandCandidates = ${JSON.stringify([execCommandName, shellCommandName])}.filter(name => nativeCommandNames.has(name));`,
    "if (nativeCommandCandidates.length !== 1) throw new Error(\"Expected exactly one native command tool; found \" + (nativeCommandCandidates.join(\", \") || \"none\"));",
    "const nativeCommandName = nativeCommandCandidates[0];",
    `const unmappableShellOptions = ${JSON.stringify(unmappableShellOptions)};`,
    `if (nativeCommandName === ${JSON.stringify(shellCommandName)} && unmappableShellOptions.length) throw new Error("Native shell_command does not support codex_exec " + unmappableShellOptions.join(", "));`,
    "const nativeCommand = tools[nativeCommandName];",
    "if (typeof nativeCommand !== \"function\") throw new Error(\"Native command tool \" + nativeCommandName + \" is listed but unavailable\");",
    `const nativeCommandInput = nativeCommandName === ${JSON.stringify(execCommandName)} ? ${JSON.stringify(execCommandArguments)} : ${JSON.stringify(shellCommandArguments)};`,
    "const result = await nativeCommand(nativeCommandInput);",
  ], "nativeCommandName");
}

export interface McpToolRoutingPolicy {
  readonly contract: ChatGptMcpContract;
  readonly allowWebSubagents: boolean;
}

function gatewaySpawnExclusions(policy: McpToolRoutingPolicy): string[] {
  return policy.allowWebSubagents ? [] : chatgptWebBlockedGatewayWireNames();
}

export function gatewayExcludedNames(environment: ChatGptTurnEnvironment, policy: McpToolRoutingPolicy): string[] {
  return [...environment.tools.map(wireName), ...gatewaySpawnExclusions(policy)];
}

export function resolveBrowserInvocation(
  policy: McpToolRoutingPolicy,
  bound: ChatGptTurnEnvironment & { expiresAt?: number },
  wireNameValue: string,
  args: Record<string, unknown> | undefined,
  input: string | undefined,
): { tool: CodexTool; payload: { arguments?: Record<string, unknown>; input?: string } } {
  const { allowWebSubagents } = policy;
  const spawnExclusions = gatewaySpawnExclusions(policy);
  if (allowWebSubagents === false && wireNameValue === "exec") {
    throw new Error("Raw exec is unavailable while Web subagents are disabled; use structured tool calls");
  }
  const tool = safeVisibleTools(bound, policy).find(candidate => wireName(candidate) === wireNameValue);
  if (!tool) {
    const gateway = execGateway(bound);
    const hiddenOuterTool = bound.tools.some(candidate => wireName(candidate) === wireNameValue);
    if ((allowWebSubagents === false && isSpawnCollaborationWireName(wireNameValue))
      || !gateway || hiddenOuterTool || !gatewayToolNameIsValid(wireNameValue)) {
      throw new Error(
        allowWebSubagents === false && isSpawnCollaborationWireName(wireNameValue)
          ? `ChatGPT Web cannot run Codex ${wireNameValue}`
          : `Codex tool is not available in this turn: ${wireNameValue}`,
      );
    }
    if (input !== undefined && args && Object.keys(args).length > 0) {
      throw new Error(`Codex nested tool ${wireNameValue} accepts either arguments or freeform input, not both`);
    }
    if (isGatewayAgentWaitTool(wireNameValue) && input !== undefined) {
      throw new Error(`ChatGPT Web wait_agent requires structured arguments and timeout_ms=${CHATGPT_WEB_AGENT_WAIT_POLL_MS}`);
    }
    const invocationArguments = args ?? {};
    assertGatewayToolArguments(wireNameValue, invocationArguments);
    return {
      tool: gateway,
      payload: {
        input: execGatewayProgram(wireNameValue, input !== undefined, {
          ...(input !== undefined ? { input } : { arguments: invocationArguments }),
        }, gatewayExcludedNames(bound, policy)),
      },
    };
  }
  if (tool.freeform) {
    if (input === undefined) throw new Error(`Freeform Codex tool ${wireNameValue} requires input`);
    if (args && Object.keys(args).length > 0) throw new Error(`Freeform Codex tool ${wireNameValue} does not accept arguments`);
    return {
      tool,
      payload: {
        input: tool === execGateway(bound)
          ? transportBoundRawExecProgram(input, wireName(tool), spawnExclusions)
          : input,
      },
    };
  }
  if (input !== undefined) throw new Error(`Function Codex tool ${wireNameValue} does not accept freeform input`);
  const invocationArguments = args ?? {};
  assertBrowserToolArguments(tool, invocationArguments);
  return { tool, payload: { arguments: invocationArguments } };
}
