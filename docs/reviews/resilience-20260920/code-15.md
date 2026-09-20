# NEKODEX tool-capability resilience/security review — code lane 15

Reviewed commit: `e10c52acb23da1c05d401faaa49d0b34c912e830` (`codex/account-limits-login`, released as `5.6.0-nekodex.3` per review brief).

Scope: manual, read-only review of `src/adapters/chatgpt-web/mcp-server.ts`, `turn-broker.ts`, `native-delegation.ts`, and `prompt.ts`, plus the direct owner handoff in `index.ts` needed to resolve structured-tool forwarding. Review questions were limited to cross-turn ownership, capability tokens, approval boundaries, schema injection, and unexpected forwarding. No tests, builds, live authentication, exploitation, source edits, or child agents were used.

## Findings

### 1. Medium — output-schema text can terminate its transport delimiter

- **Location:** `src/adapters/chatgpt-web/prompt.ts`, `compileChatGptWebPrompt`, lines 619–626.
- **Trigger:** a requested output schema contains a string value such as a property `description` with `</codex_output_schema_json>` followed by instruction-like text. `JSON.stringify` preserves the literal `<` and `>` characters, so the resulting prompt contains an apparent closing transport tag before the bridge's real closing tag.
- **Observed:** the compiler says the schema is data, then concatenates `JSON.stringify(parsed.options.outputFormat.schema)` directly between textual XML-like delimiters. There is no delimiter escaping, length framing, or encoding at this boundary.
- **Inferred impact:** this does not change JavaScript control flow or grant a broker token by itself, but it weakens the intended instruction/data boundary. A schema supplied through a less-trusted integration can visually escape the marked data region and attempt to influence the web model's tool choices or final-answer behavior.
- **Minimal fix:** serialize schema data with an unambiguous framing that cannot contain the delimiter (for example base64 plus an integrity/length field), or at minimum escape `<`, `>`, and `&` before interpolation and tell the model to decode only as schema data. Keep final structured-output validation authoritative after generation.

### 2. Medium — `codex_tool_call` treats advertised JSON Schema as documentation, not an enforced forwarding boundary

- **Location:** `src/adapters/chatgpt-web/mcp-server.ts`, `jsonArgumentsSchema` line 55; `resolveBrowserInvocation` lines 754–805; `codex_tool_call` lines 1112–1154; async equivalent lines 1176–1216. Forwarding is materialized in `src/adapters/chatgpt-web/turn-broker.ts`, `dispatch`, lines 1352–1427.
- **Trigger:** the web model calls a structured tool with an exact visible `wire_name`, but supplies a wrong-typed value, an undeclared property, or a sensitive optional field that was not valid under that tool's advertised `parameters` schema. Only the special `wait_agent` transport field receives local validation.
- **Observed:** the public bridge accepts `arguments` as `z.record(z.string(), z.unknown())`; `resolveBrowserInvocation` checks tool identity and freeform-versus-structured shape, then returns the argument object unchanged. The broker copies it into `BrokerToolRequest`, and the owner emits it as the native tool-call argument JSON. The generic path never validates against `tool.parameters`.
- **Inferred impact:** a downstream runtime or individual tool may still reject invalid arguments, so this review does not establish that every malformed call executes. The bridge nevertheless cannot guarantee its stated “exact structured schemas” boundary and can forward fields that the browser-visible schema did not authorize. This is most relevant to tools whose optional fields alter approval, destination, identity, or mutation scope.
- **Minimal fix:** compile/cache a validator from the exact selected `tool.parameters` and reject arguments before `invoke`/`invoke_async`; default to rejecting undeclared properties when the schema does not explicitly permit them. Preserve the existing dedicated command-escalation checks, and fail closed for schemas the bridge cannot validate rather than forwarding them as generic records.

### 3. Medium — an active turn token does not pin the tool registry it authorizes

- **Location:** `src/adapters/chatgpt-web/turn-broker.ts`, `environmentIdentity` lines 267–274 and `updateEnvironment` lines 461–477; owner dispatch lines 1114–1117. The active owner refresh occurs in `src/adapters/chatgpt-web/index.ts`, lines 1296–1300.
- **Trigger:** between browser continuation rounds, the owner supplies an environment with the same `cwd`, roots, writable roots, sandbox policy, and producer, but with tools added, removed, or redefined. This can happen through legitimate deferred discovery, configuration drift, or a compromised/misbehaving tool provider.
- **Observed:** `environmentIdentity` excludes `environment.tools`. `updateEnvironment` compares only that reduced identity and then replaces the entire environment, including the tool list. The same token and binding remain active, and subsequent inventory/resolution uses the replacement definitions.
- **Inferred impact:** no cross-turn token theft was found, and outer runtime approvals still apply where implemented. However, the bearer capability's callable surface can expand or change after issuance without a new capability or an explicit broker-side authorization event. A changed description/schema can also combine with finding 2 to produce unexpected forwarding under the original turn token.
- **Minimal fix:** pin each active turn to a canonical fingerprint of callable tool identity, freeform mode, and schema. Permit only unchanged entries by default. If deferred tool discovery must add entries, require a narrow owner method that records the trusted discovery result and only appends those exact fingerprints; reject redefinition of an existing `wire_name` for the life of the turn.

## Boundary checks with no finding

- Turn/request handles are generated from 24 random bytes (`turn-broker.ts:226–227`), are bound to one channel, and are rejected after completion, expiry, or revocation. Claims also create bounded activity leases, and the completion fence refuses to commit while activities, invocations, or unacknowledged async results remain.
- Async operation replay is tied to the turn token, binding ID, operation ID, and a canonical invocation fingerprint (`turn-broker.ts:242–256`, `1363–1377`, `1473–1505`). Poll/cancel paths reject a token belonging to another operation owner.
- Historical broker handles are scrubbed from prompt context values before replay (`prompt.ts:154–219`), while the current token is supplied only to tool-capable mode; read-only web modes reject any token (`prompt.ts:540–546`).
- Native delegation promotion requires current-turn provenance and `verifyNativeDelegation` before converting the delivered envelope into a user/agent message (`native-delegation.ts:12–57`). No source-only path was found that promotes an unverified historical delivery.
- The Unix broker socket is changed to mode `0600` and an existing socket must be owned by the current user with no group/other permission bits (`turn-broker.ts:903–905`, `926–935`).

These conclusions are source-only. They do not claim runtime exploitability, third-party compromise, or complete behavior outside the scoped forwarding path.
