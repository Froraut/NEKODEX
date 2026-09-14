# Hermes through Codex Web GPT

Use the maintained fork's `docs/hermes-integration.md` as the implementation runbook. Inspect
the installed Hermes Responses transport before assuming compatibility with a newer release.

The intended path is Hermes' normal loop → `/hermes/v1/responses` → owned ChatGPT browser →
ChatGPT MCP connector → structured Responses function call → Hermes execution/approval → tool
result → continued ChatGPT answer. The Codex-specific app-server runtime has a narrower Hermes
callback toolset and must not silently replace this path.

In the app, finish Automatic-mode login and tools setup, then **Setup → Hermes → Add Hermes
provider**. This creates one named `codex-web` provider and a private local token, backs up settings,
and preserves the existing default. Restart Hermes and choose ChatGPT Web · FroRaut in a new
session. The transport is `codex_responses`; copying `/v1` into a Chat Completions provider is
insufficient. No paid API fallback, auxiliary provider or scheduler change is implied.

Keep local token/config files out of tool output, Git, screenshots and this skill. Do not reuse
OpenAI keys or the daemon admin token. Reinstallation must not overwrite unrelated providers,
manual edits, profile data or active sessions. Use the effective Hermes home and current paths.

First prove one actual response, then a single scoped harmless tool round trip using a disposable
fixture. Observe the tool call, its execution in Hermes and the model's answer based on the result.
An authenticated endpoint/catalog and mocked protocol case are separate checks, not that proof.

If the tunnel list is empty, compare the currently signed-in Platform, ChatGPT and embedded-app
accounts before creating a duplicate. Developer mode and connector creation may require user
action. Reuse existing explicit authorization. Do not weaken global plugin action controls.

An unknown/expired pending tool result requires a new user turn after daemon restart or idle
expiry. Native compaction and Codex lifecycle metadata are unsupported on the Hermes route;
Hermes supplies its own full history and session-scoped prompt cache key. Hermes enforces a 64k minimum. Use the live per-mode catalog and omit smaller browser modes;
never inflate their advertised window just to pass Hermes initialization. Model, tool and platform capabilities
not exercised remain unverified.
