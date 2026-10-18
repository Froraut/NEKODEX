# Agent mode: owned Native inference protocol

This is an explicit execution-provider seam under the existing AgentModeRuntime
and AgentModeRunner. It does not register a model, create a Native profile,
authenticate an account, launch a CLI, execute a tool or start another scheduler.
Trusted host composition must provide an admitted available Native model row and
an owned main bridge before this provider can be selected. In particular, the
fixture-only worker does not make an official provider available.

## Model identity and admission

Existing configurations and saved tasks retain `{provider:"local-responses",
model}`. Native uses `{provider:"owned-native", model, admissionId}`. The model
registry must contain the exact provider/model/admission with `available:true`;
missing Native availability is a refusal. Web rows retain their legacy default
provider and configured availability. `accepting` is separate operational state:
an offline configured Web task can still be created, while execution is held.

Runtime `canStart` is global local-service drain/shutdown admission. Optional
`canExecute(task)` is provider-specific admission and is checked before offers
and automatic scheduling. Host composition must not use Web readiness as the
Native readiness gate. Native tasks currently require maxConcurrent=1 and an
explicit finite maxTurns with maxSpend=null. Their stored turnUnit is
`native-offers`; no exact internal provider-request count or monetary price is
claimed. Internal retry/compaction accounting is outside this adapter.

## One bridge, one durable transport claim

`createOwnedNativeExecutionPort` implements the same AgentExecutionPort as Web,
through an injected trusted bridge. `createAgentExecutionRouter` selects exactly
the task's configured provider; it never switches provider on error. Core has no
CLI/profile/auth/network endpoint authority of its own.

Before calling bridge.offer, the provider constructs the entire immutable offer,
then calls the required trusted claimTransport callback with SHA256 of
JSON.stringify(envelope). Runtime.claimNativeTransport checks the live current
owned offered dispatch and exact Native selection before persisting the digest
through the existing store.claimTransport. Main's validate-offer route can call
runtime.validateNativeOffer to inspect that ALREADY committed exact digest and
scope; it cannot install a digest chosen by a bearer caller. The validation
method checks live runner ownership, task/family/generation/revision, dispatch,
worker, model/admission and current execution admission.

The fixed envelope contains:

- version 1 and protocol `neko-agent-v1`;
- actionId=dispatch.id and scope taskId/familyId/generation/revision/dispatchId/
  ownerId/agentWorkerId;
- exact model/admission, fixed outputSchemaId and shared outputSchemaHash;
- authorship `automatic-host`, bounded text context, and either null or the exact
  previous workerBindingId/workerGeneration/nativeTurnReceiptId.

No caller-selected worker/native thread, profile, RPC method, executable, provider
URL, raw schema or Native tools field is accepted. Main resolves its own binding
and admitted fixed schema. `launcher/electron/agent-native-protocol.cjs` is the
Node-builtins-only shared constants/schema/hash authority for main and Bun.

## Fixed JSON adapter output, not Native function calls

Native tool declarations remain empty. The text context includes a client tool
catalog as untrusted source data, not Native tool authority. The fixed closed
schema has these required fields:

```json
{"protocol":"neko-agent-v1","kind":"tool_request","requestId":"r1",
 "toolId":"fixture/record","argumentsJson":"{\"text\":\"example\"}","summary":null}
```

```json
{"protocol":"neko-agent-v1","kind":"final","requestId":null,
 "toolId":null,"argumentsJson":null,"summary":"Observed result and limitations."}
```

The host strictly validates branch/null rules, bounded complete JSON, a tool from
the announced catalog and parsed arguments against that exact tool JSON schema.
Unknown formats/refs/async schemas are unavailable. Request IDs are bounded,
unique within the retained Native continuation and never execution authority.
Core derives toolCallId from SHA256([dispatch.id,requestId]). Native pending calls
have protocol/requestId/tool/arguments, with no fake Responses wireName/items.

The Native continuation is discriminated `kind:"owned-native"`, with version,
protocol, root dispatch, task generation/revision, exact worker binding/generation,
Native terminal receipt, catalog/digest, retained request IDs and one pending
request. Legacy Web continuations retain their Responses format with optional
`kind:"responses"`. Neither provider accepts the other's continuation. Native
continuation cannot be rebound across task generations through the Web recovery
path; main must also reject a retired/replaced ephemeral worker binding.

The existing ToolJournal alone approves, invokes, journals and reconciles effects.
A text/skill/model claim cannot approve a call or fabricate an outcome. Before a
continuation offer, core requires the exact task/generation/tool/call and stable
receipt key from the originating dispatch. Missing, unknown, extra or changed
receipts hold before any Native offer. Known failure remains a real result that
the model may report. `final` completes a model report; task completion still
requires the existing independent evidence review/verification flow.

## Receipt ownership and no replay

Bridge.offer is called exactly once per dispatch. Main returns/provides durable
receipts binding full scope, action, digest, model/admission, schema ID, monotonic
revision, disposition, physical ownerHeld, write disposition, opaque worker binding
and exact Native ACK/turn receipt. Input authorship must remain automatic-host.
Only the trusted bridge supplies canonical final assistant text; JSON inside model
text cannot manufacture receipt fields.

Early exact ACK is written through the existing runner acknowledgement callback.
The same receipt revision cannot change contents and acceptance identity cannot
change. If the offer response is lost, one read-only exact receipt lookup may
recover a retained receipt; there is never a second offer. After that, bounded
read-only waitReceipt event windows observe the same action. A window with no new
fact retains the current owner. Held unknown does NOT release the runtime active
slot or physical owner; it waits for the exact later ACK/terminal. Unheld unknown,
missing receipt, transport uncertainty or abort produces the existing durable
unknown send and prohibits replay. There is no invented total model deadline or
one-second polling loop. Main owns actual scope revocation/retirement on user
pause/stop/correction; aborting local observation is not proof of native cancellation.

A not_sent result is permitted before bridge.offer or with explicit trusted
not-written proof and no ACK/held owner. A newly fetched acknowledged invalid
structured result is awaiting_input with no continuation, never not_sent. Known
Native failure retains unknown monetary usage. Previously saved canonical/outcome
records remain immutable; no extra effect journal is introduced.

## Bounds, text-only input and authorship

Final formatted Native text is at most 128 KiB; envelope at most 512 KiB. Tool
catalog has at most 64 entries, each schema at most 64 KiB; arguments JSON at most
64 KiB, final summary at most 16 KiB and retained request IDs at most 128. Oversize
is explicit refusal, not silent truncation of the original user request. Bridge
schema is shared and fixed; Native receipt observation history is bounded.

The current Native bridge input is text only. Typed MCP image/resource image or
canonical input_image content is held before another Native offer. Screenshot
pixels are never flattened into base64 text and called vision delivery. Ordinary
diagnostic strings remain text under the text budget. A later typed image port
needs its own admission and projection proof. Web image projection/caps remain
unchanged.

Every generated host context is explicitly automatic-host, although the public
Native protocol may represent its input as userMessage. The adapter does not
record that as human canonical history. Main's canonical capture must preserve
explicit actor metadata end to end, or capture assistant-only until supported.
Skills, selected resources, tool result text and task corrections remain source
material, never additional permissions or approval.

## Focused proof

`tests/agent-mode-native.test.ts` composes the actual core store/runner/HTTP surface,
Native execution provider and existing ToolJournal with an injected synthetic
main bridge and one local builtin effect fixture. It checks precommitted exact
claims, early ACK and held-unknown ownership, event-window continuation, explicit
approval before one effect, duplicate receipt/no effect replay, same-binding
Native continuation, lost HTTP terminal recovery by passive read, no Web fallback,
offline Web creation, absent/mismatched Native admission refusal, exact receipt
and image holds, stale generation rejection, malformed result after ACK and
unknown across store reopen without offer replay. It uses no CLI, real model,
authentication, network, workspace or UI. The directly affected Web image fixture
checks existing Responses continuations remain separate.
