import * as z from "zod/v4";

const inputTextSchema = z.object({ type: z.literal("input_text"), text: z.string() });
const plainTextSchema = z.object({ type: z.literal("text"), text: z.string() });
const inputImageBlockSchema = z.object({
  type: z.literal("input_image"),
  // codex-rs ImageDetail: auto|low|high|original (view_image --detail original).
  detail: z.enum(["auto", "low", "high", "original"]).optional(),
  image_url: z.string().optional(),
  file_id: z.string().optional(),
}).refine(v => Boolean(v.image_url) || Boolean(v.file_id), {
  message: "input_image requires at least one of image_url or file_id",
});
const inputFileBlockSchema = z.object({
  type: z.literal("input_file"),
  file_id: z.string().optional(),
  filename: z.string().optional(),
  file_data: z.string().optional(),
}).refine(v => Boolean(v.file_id) !== Boolean(v.file_data), {
  message: "input_file requires exactly one of file_id or file_data",
});
const outputTextSchema = z.object({ type: z.literal("output_text"), text: z.string() });
const outputRefusalSchema = z.object({ type: z.literal("refusal"), refusal: z.string() });
const summaryTextSchema = z.object({ type: z.literal("summary_text"), text: z.string() });
const reasoningTextSchema = z.object({ type: z.literal("reasoning_text"), text: z.string() });
// codex-rs FunctionCallOutputContentItem (protocol/src/models.rs): input_text | input_image | encrypted_content.
const encryptedContentBlockSchema = z.object({ type: z.literal("encrypted_content"), encrypted_content: z.string() });

const inputContentBlockSchema = z.union([inputTextSchema, plainTextSchema, inputImageBlockSchema, inputFileBlockSchema]);
const outputContentBlockSchema = z.union([outputTextSchema, plainTextSchema, outputRefusalSchema]);
// Codex tool outputs can contain both input-shaped and output-shaped content blocks.
const toolOutputContentBlockSchema = z.union([
  outputTextSchema, plainTextSchema, outputRefusalSchema,
  inputTextSchema, inputImageBlockSchema, encryptedContentBlockSchema,
]);
const toolOutputSchema = z.union([z.string(), z.array(toolOutputContentBlockSchema)]);

const userMessageItemSchema = z.object({
  internal_chat_message_metadata_passthrough: z.object({
    content_item_kinds: z.array(z.string()).optional(),
  }).optional(),
  type: z.literal("message").optional(),
  role: z.union([z.literal("user"), z.literal("developer")]),
  content: z.union([z.string(), z.array(inputContentBlockSchema)]).optional(),
});
const systemMessageItemSchema = z.object({
  type: z.literal("message").optional(),
  role: z.literal("system"),
  content: z.union([z.string(), z.array(inputContentBlockSchema)]).optional(),
});
const assistantMessageItemSchema = z.object({
  type: z.literal("message").optional(),
  role: z.literal("assistant"),
  content: z.union([z.string(), z.array(outputContentBlockSchema)]).optional(),
  phase: z.enum(["commentary", "final_answer"]).optional(),
});
const agentMessageItemSchema = z.object({
  type: z.literal("agent_message"),
  author: z.string().optional(),
  recipient: z.string().optional(),
  // MultiAgent V1 sends normal input content. V2 may send only encrypted_content; accept that
  // shape so the HTTP boundary can reject it before constructing a browser adapter instead of
  // silently manufacturing an empty task or starting a retryable SSE stream.
  content: z.union([
    z.string(),
    z.array(z.union([inputContentBlockSchema, encryptedContentBlockSchema])),
  ]).optional(),
}).loose();
const reasoningItemSchema = z.object({
  type: z.literal("reasoning"),
  id: z.string().optional(),
  summary: z.array(summaryTextSchema).optional(),
  content: z.array(reasoningTextSchema).optional(),
  // Round-tripped opaque payload (native OpenAI encryption OR the proxy's ocxr1 envelope).
  encrypted_content: z.string().optional(),
});
const functionCallItemSchema = z.object({
  type: z.literal("function_call"),
  id: z.string().optional(),
  call_id: z.string().min(1),
  name: z.string().min(1),
  namespace: z.string().optional(),
  arguments: z.string().optional(),
});
const functionCallOutputItemSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string().min(1),
  output: toolOutputSchema.optional(),
});
const customToolCallItemSchema = z.object({
  type: z.literal("custom_tool_call"),
  id: z.string().optional(),
  call_id: z.string().min(1),
  name: z.string().min(1),
  input: z.string(),
});
const customToolCallOutputItemSchema = z.object({
  type: z.literal("custom_tool_call_output"),
  call_id: z.string().min(1),
  // codex-rs CustomToolCallOutput carries FunctionCallOutputPayload: string OR content items.
  output: toolOutputSchema,
});
const toolSearchCallItemSchema = z.object({
  type: z.literal("tool_search_call"),
  id: z.string().min(1).optional(),
  call_id: z.string().min(1).optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
}).loose().refine(item => Boolean(item.call_id || item.id), {
  message: "tool_search_call requires a nonempty call_id or id",
});
const toolSearchOutputItemSchema = z.object({
  type: z.literal("tool_search_output"),
  call_id: z.string().min(1),
  status: z.string().optional(),
  tools: z.array(z.unknown()).optional(),
}).loose();

// The fallback is only for item extensions we do not yet model. A known type that fails its
// schema must not fall through and turn malformed content into a placeholder or drop a block.
const knownInputItemTypes = new Set([
  "message", "agent_message", "reasoning", "function_call", "function_call_output",
  "custom_tool_call", "custom_tool_call_output",
  "tool_search_call", "tool_search_output",
]);
const unknownInputItemSchema = z.object({ type: z.string() }).loose().refine(
  item => !knownInputItemTypes.has(item.type),
  { message: "known input item must satisfy its schema" },
);

export const inputItemSchema = z.union([
  userMessageItemSchema,
  systemMessageItemSchema,
  assistantMessageItemSchema,
  agentMessageItemSchema,
  reasoningItemSchema,
  functionCallItemSchema,
  functionCallOutputItemSchema,
  customToolCallItemSchema,
  customToolCallOutputItemSchema,
  toolSearchCallItemSchema,
  toolSearchOutputItemSchema,
  unknownInputItemSchema,
]);

export const toolSchema = z.object({
  type: z.literal("function"),
  name: z.string().min(1),
  description: z.string().optional(),
  parameters: z.record(z.string(), z.unknown()).optional(),
  strict: z.boolean().optional(),
});

const builtinToolSchema = z.object({ type: z.string() }).loose();

const hostedToolType = z.enum([
  "web_search_preview", "file_search", "computer_use_preview",
  "code_interpreter", "image_generation", "mcp",
]);

const allowedToolEntrySchema = z.object({ type: z.string(), name: z.string().optional() });

export const toolChoiceSchema = z.union([
  z.literal("auto"),
  z.literal("none"),
  z.literal("required"),
  z.object({ type: z.literal("function"), name: z.string().min(1) }),
  z.object({ type: z.literal("custom"), name: z.string().min(1) }),
  z.object({ type: hostedToolType }),
  z.object({ type: z.literal("allowed_tools"), mode: z.enum(["auto", "required"]), tools: z.array(allowedToolEntrySchema) }),
]);

export const reasoningConfigSchema = z.object({
  effort: z.string().optional(),
  summary: z.enum(["auto", "concise", "detailed", "none"]).optional(),
});

export const stopSchema = z.union([z.string(), z.array(z.string()), z.null()]);

export const responsesRequestSchema = z.object({
  model: z.string().min(1),
  input: z.union([z.string(), z.array(inputItemSchema)]).optional(),
  instructions: z.union([z.string(), z.null()]).optional(),
  tools: z.array(z.union([toolSchema, builtinToolSchema])).optional(),
  tool_choice: toolChoiceSchema.optional(),
  max_output_tokens: z.number().optional(),
  temperature: z.number().optional(),
  top_p: z.number().optional(),
  stop: stopSchema.optional(),
  stream: z.boolean().optional(),
  reasoning: reasoningConfigSchema.nullable().optional(),
  store: z.boolean().optional(),
  previous_response_id: z.string().optional(),
  parallel_tool_calls: z.boolean().optional(),
  prompt_cache_key: z.string().optional(),
  metadata: z.unknown().optional(),
  user: z.string().optional(),
  service_tier: z.string().optional(),
  presence_penalty: z.number().optional(),
  frequency_penalty: z.number().optional(),
  background: z.unknown().optional(),
  include: z.unknown().optional(),
  prompt: z.unknown().optional(),
  text: z.unknown().optional(),
  truncation: z.unknown().optional(),
}).superRefine((request, ctx) => {
  if (!Array.isArray(request.input)) return;
  for (const [itemIndex, item] of request.input.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const output = (item as { output?: unknown }).output;
    if (((item as { type?: unknown }).type === "function_call_output"
      || (item as { type?: unknown }).type === "custom_tool_call_output") && Array.isArray(output)) {
      for (const [blockIndex, block] of output.entries()) {
        if (block && typeof block === "object" && !Array.isArray(block)
          && (block as { type?: unknown }).type === "input_image"
          && !(block as { image_url?: unknown }).image_url) {
          ctx.addIssue({
            code: "custom",
            message: "file_id-only tool-result input_image is unsupported; image content was not sent",
            path: ["input", itemIndex, "output", blockIndex],
          });
        }
      }
    }
    const blocks = (item as { content?: unknown }).content;
    if (!Array.isArray(blocks)) continue;
    for (const [blockIndex, block] of blocks.entries()) {
      if (!block || typeof block !== "object" || Array.isArray(block)) continue;
      if ((item as { role?: unknown }).role === "system"
        && ((block as { type?: unknown }).type === "input_image"
          || (block as { type?: unknown }).type === "input_file")) {
        ctx.addIssue({
          code: "custom",
          message: "file or image content in a system message is unsupported; content was not sent",
          path: ["input", itemIndex, "content", blockIndex],
        });
      }
    }
  }
});
