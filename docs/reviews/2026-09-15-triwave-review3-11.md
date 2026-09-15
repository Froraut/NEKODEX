# NEKODEX triwave review 3 lane 11 — dev chat

- **Baseline:** `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`)
- **Scope:** `src/dev-chat/**`, the direct `responseRequest`/`compactRequest` caller path, the Responses parser path that consumes DEV tool rounds, and the browser-only/full mode contract in `docs/dev-chat.md`.
- **Method:** final read-only adversarial source review after wave1 and wave2. No tests, typechecks, scripts, broad audits, live browser/account actions, production actions, code edits, commit, or ABI changes.
- **Review budget:** 8 bounded scenarios; 1 new concrete path reported.
- **ABI boundary:** Native4, Native4 DEV, and ZeroRisk4 identities and public tool schemas were preserved and no ABI change is proposed.

## Finding T3-11-1 — duplicate DEV tool call IDs are accepted and mis-associated

**Classification:** concrete protocol-integrity defect, P2; conditional on a Web response containing a duplicate `call_id`. No live reproduction claimed.

**Trigger**

In Full DEV mode, let one Responses envelope contain two `function_call`/`custom_tool_call` items with the same nonempty `call_id`, or let a later envelope reuse a `call_id` already present in the retained `workingInput`. `DevChatDriver.toolCalls()` at [`src/dev-chat/driver.ts:229-251`](../../src/dev-chat/driver.ts#L229) records every call and does not enforce uniqueness within the response or against the current round history. `DevChatDriver.send()` then emits a receipt and appends one output item for each call at [`src/dev-chat/driver.ts:512-557`](../../src/dev-chat/driver.ts#L512).

The next request is parsed by `findToolById()` at [`src/responses/parser.ts:277-285`](../../src/responses/parser.ts#L277), which scans assistant tool calls from newest to oldest and returns the first matching ID. Both `function_call_output` and `custom_tool_call_output` use that lookup at [`src/responses/parser.ts:572-595`](../../src/responses/parser.ts#L572). The parser therefore cannot preserve which duplicate call a receipt belongs to; the later duplicate shadows the earlier one.

**Consequence**

The DEV harness can report a completed simulated tool round while the adapter receives ambiguous or incorrectly named tool results. A receipt generated for call A can be interpreted as the result of the later call B when both share an ID. This weakens the evidence that the simulator preserved the model’s declared tool protocol and can cause a subsequent model turn to reason from a result attached to the wrong tool. It is an internal DEV protocol-integrity issue; it does not establish an external side effect.

**Minimum correction direction**

Reject duplicate nonempty `call_id` values before emitting receipts or appending tool outputs. The uniqueness check should cover the current response and the already retained unresolved tool-call history, while preserving valid repeated rounds whose IDs are distinct. Keep the existing Native4, Native4 DEV, and ZeroRisk4 identities, universal simulated receipt fields, and public tool schemas unchanged.

## Candidate roots confirmed or rejected

- **T1-11-1 browser-only compaction instructions:** **confirmed as a repeat/refinement, not a new T3 finding.** `compactInput()` still sends `DEV_CHAT_SYSTEM_INSTRUCTIONS` at [`src/dev-chat/driver.ts:617-640`](../../src/dev-chat/driver.ts#L617) for every non-Luna mode. The ordinary turn path still selects browser-only instructions and no tools at [`src/dev-chat/driver.ts:186-209`](../../src/dev-chat/driver.ts#L186). Server compaction still strips parsed tools and adds the dedicated no-tool compaction contract at [`src/server.ts:572-580`](../../src/server.ts#L572), so this pass found no additional execution or side-effect path.
- **T2-11-1 undeclared or malformed tool calls:** **confirmed as a repeat, not a new T3 finding.** `toolCalls()` still accepts unknown names and falls back to raw invalid JSON arguments, while `simulatedReceipt()` still supplies a generic receipt. The new finding above is the distinct identity-collision case.
- **Browser-only `tool_choice: "auto"` with an empty tool list:** **rejected as a new root.** The request has no declared tools, and the server/parser path does not turn that option into a tool bridge or simulated receipt. It is redundant wire state, not a demonstrated defect in this scope.
- **Compaction replacement history losing tool outputs:** **rejected as a new root.** `compactRequest()` returns the bounded user-message plus summary replacement from `buildCompactV1Output()`; the server’s compaction prompt and output validation keep the separate compaction turn from dispatching tools. This is covered by the existing T1 compaction qualification.
- **DEV chat persistence race / last-writer-wins:** **known optional hardening, not counted.** `DevChatStore.save()` has no cross-process compare-and-swap, but the documented named-chat CLI contract does not establish concurrent same-name processes as supported usage.
- **Full-only broker ownership and tunnel readiness:** **rejected as a new lane root.** `startDevChatTransport()` checks the isolated DEV purpose, Full mode, tunnel readiness, and closes its broker; remaining setup/lifecycle ownership is an adjudicated cross-lane root.
- **Native4, Native4 DEV, ZeroRisk4 identity or ABI drift:** **rejected.** The inspected DEV caller and configuration checks preserve the existing connector identities and public schemas; no source change was made.

## Repeats / known limits / exclusions

- The wave1 connector mention-row popup path, wave1 D18 cleanup path, wave2 nested gateway error-flag and shell-option paths, and wave2 connector-scope path remain adjudicated repeats outside this lane’s new root.
- Full/MCP transport readiness, account-side connector availability, retained-task behavior, actual ChatGPT DOM behavior, and live model behavior were not verified by this source-only pass.
- No code changes were made.

## Counts

- **New concrete defects:** 1
- **Conditional defects:** 1
- **Repeats/refinements:** 2 primary wave findings plus the adjudicated paths listed above
- **Rejected candidates:** 5
- **Known/optional limits:** 1 newly restated, plus prior report limits
- **Code changes:** 0
- **Finding IDs:** **T3-11-1**
