# Components and alternatives

## Normal operation

`Codex task → local Responses/SSE bridge → owned ChatGPT Web browser → native Codex response`.
In Full mode, `ChatGPT → OpenAI Tunnel → turn-bound MCP broker → native Codex tools → ChatGPT`.
The broker belongs to the active task; it is not a general unauthenticated machine-control server.
Codex retains the task, canonical history, native tool registry, sandbox and approvals.

| Mode | Model response | Local tools | Setup |
| --- | --- | --- | --- |
| Automatic Browser-only | Automated browser | None | Login, one reply check, model route |
| Automatic Full | Automated browser | Native task tools through MCP | Browser-only plus tunnel/runtime key and ChatGPT connector |
| Manual | User pastes/selects/sends | MCP after manual handoff | Separate Manual connector/tunnel; images manually attached |

The displayed Pro family and available effort levels come from the live account. A selected
plan label does not establish a context window or unlock unavailable models. Manual routes
remain text-only until their image payload/export/attachment contract is implemented; merely
advertising image input would cause silent loss at a different layer.

Connector identities in the audited fork are `Codex Native3` (Automatic), `Codex Native3 DEV`
(isolated development) and `Codex Zero Risk2` (Manual). Read current `src/config.ts` before setup.
Upstream v5.0.6 used Native2. A public schema change requires deliberate identity migration;
renaming a connector is not proof that ChatGPT refreshed its cached schema. Never rename one
to evade a platform restriction.

## Alternatives

- Native Codex with ChatGPT sign-in: simplest coding workflow; uses native models and Codex
  allowance. It does not promise a separate Web Pro quota.
- Native Codex with an API key: avoids Web UI/session transfer, with separate API billing and
  model availability. Never switch billing as an implicit fallback.
- ChatGPT Work: a first-party workflow for longer deliverables. Desktop local access and web
  cloud work differ; Work follows Codex's usage structure.
- `tunnel-client codex plugin install`: an actual Codex-local management plugin for runtimes
  and profiles, not an alternative model bridge or replacement ChatGPT connector.
- MCP-chunk or TXT context transport: potential composer-performance improvements. Require
  complete-context delivery/ownership, accounting and continuation evidence. File upload or
  marker recall alone does not prove complete model context.
- A browser extension for login or a native Responses tool-call protocol without MCP would
  be new implementations, not currently proven drop-in alternatives.

Primary references: [upstream Full harness](https://github.com/miuuyy/codex-chatgpt-web#full-harness),
[Codex authentication](https://developers.openai.com/codex/auth),
[Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels),
[ChatGPT Work and Codex](https://help.openai.com/en/articles/20001275/).
