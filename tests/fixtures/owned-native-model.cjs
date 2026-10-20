'use strict';
// Minimum ModelInfo fields from official rust-v0.163.0 protocol/openai_models.rs.
// Fixture identity only; never a claim that OpenAI serves this model.
const modelId = 'nekodex-local-contract-fixture';
const json = JSON.stringify({ models: [{ slug: modelId, display_name: 'Local fixture',
  description: 'Local fake Responses contract only', supported_reasoning_levels: [],
  shell_type: 'disabled', visibility: 'list', supported_in_api: true, priority: 0,
  availability_nux: null, upgrade: null,
  model_messages: { instructions_template: 'Local fake Responses contract fixture only.' },
  include_skills_usage_instructions: false, include_plugin_usage_instructions: false,
  include_apps_usage_instructions: false, default_reasoning_summary: 'none',
  support_verbosity: false, default_verbosity: null, apply_patch_tool_type: null,
  truncation_policy: { mode: 'tokens', limit: 10000 }, context_window: 128000,
  experimental_supported_tools: [], supports_search_tool: false, tool_mode: 'direct',
  node_repl_disabled: true, use_responses_lite: false, prefer_websockets: false,
  input_modalities: ['text'], supports_reasoning_summary_parameter: false }] });
module.exports = { modelId, json };
