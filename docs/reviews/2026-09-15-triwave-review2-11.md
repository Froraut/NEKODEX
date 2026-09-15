# NEKODEX triwave review 2 lane 11 — dev chat

- **Baseline:** `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`)
- **Scope:** `src/dev-chat/**`, the direct `responseRequest`/`compactRequest` caller path, and the browser-only/full mode contract in `docs/dev-chat.md`.
- **Method:** read-only independent source review, followed by a challenge of `docs/reviews/2026-09-15-triwave-review1-11.md` and the adjudicated four-wave ledger. No tests, typechecks, scripts, broad audits, live browser/account actions, production actions, code edits, commit, or ABI changes.
- **ABI boundary:** Native4, Native4 DEV, and ZeroRisk4 identities and public tool schemas were not changed or proposed for change.

## Finding T2-11-1 — DEV tool-round loop accepts undeclared or malformed model tool calls

**Classification:** concrete protocol-integrity defect, P2; conditional on a Web response containing an unlisted call or invalid function arguments. No live reproduction claimed.

**Trigger**

In Full DEV mode, let the browser model return a `function_call` or `custom_tool_call` whose name is not one of the tools declared in `DEV_CHAT_TOOLS`, or return a function call whose `arguments` is not valid JSON for the declared object-shaped schema. The direct caller is `DevChatDriver.send()` in [`src/dev-chat/driver.ts:512-557`](../../src/dev-chat/driver.ts#L512). It passes every output item through `toolCalls()` at [`src/dev-chat/driver.ts:229-251`](../../src/dev-chat/driver.ts#L229), which checks only `call_id`, item type, name, and (for functions) whether a JSON string can be parsed.

For invalid JSON, `toolCalls()` deliberately falls back to the raw argument string at lines 237-240. For an unknown name, `simulatedReceipt()` has no allow-list branch and returns the generic simulated receipt at [`src/dev-chat/driver.ts:280-290`](../../src/dev-chat/driver.ts#L280). The loop then appends that receipt as a normal `function_call_output` or `custom_tool_call_output` at [`src/dev-chat/driver.ts:293-308`](../../src/dev-chat/driver.ts#L293).

The declared surface is materially narrower: `DEV_CHAT_TOOLS` lists the six simulator function/custom entries and one namespace with `echo` at [`src/dev-chat/driver.ts:120-137`](../../src/dev-chat/driver.ts#L120), and the large-context tool has an object schema with required `segment` and `target_tokens`, bounded integers, and `additionalProperties: false` at lines 104-118. The generic receipt text claims that the named action was simulated even when the model did not receive that action in the advertised tool surface.

**Consequence**

The DEV harness can continue a tool round as though an unavailable tool had been dispatched, and can accept malformed arguments as though the declared tool contract had been honored. This weakens the harness’s protocol evidence: a successful continuation can no longer prove that the model selected a tool from the declared schema or that the driver supplied schema-valid input. It also makes a model-side tool-name/schema regression look like a successful simulator receipt instead of a fail-closed protocol error.

This is a DEV simulation-integrity issue, not an external side-effect claim. `simulatedReceipt()` explicitly marks `simulated: true` and `side_effects_performed: false`, and the Full DEV contract in [`docs/dev-chat.md:158-171`](../../docs/dev-chat.md#L158) says every dispatched action receives a receipt. The defect is that the driver treats an undeclared or malformed action as dispatched at all.

**Minimum correction direction**

Build an exact allow-list from the declared DEV tool surface, including the namespace-qualified `mcp__dev_simulator__echo` name and the custom `apply_patch` entry. Before generating a receipt, reject any call whose effective name is absent. For function calls, require valid JSON object arguments and validate the applicable declared schema, including the large-context bounds and no-extra-key rule. Preserve the existing universal receipt fields and all Native4/Native4 DEV/ZeroRisk4 names and public tool schemas; this is an internal DEV driver gate, not a public ABI change.

## Challenge of first-wave finding T1-11-1

The prior report correctly identified a source mismatch: `compactInput()` always sends `DEV_CHAT_SYSTEM_INSTRUCTIONS` at [`src/dev-chat/driver.ts:617-640`](../../src/dev-chat/driver.ts#L617), even when `config.mode === "browser-only"`; the normal turn path selects `DEV_CHAT_BROWSER_ONLY_INSTRUCTIONS` at [`src/dev-chat/driver.ts:193-200`](../../src/dev-chat/driver.ts#L193).

The adjudicated consequence needs qualification. `compactRequest()` converts the request into the ordinary response path and appends `compaction_trigger` at [`src/server.ts:805`](../../src/server.ts#L805). The server then removes parsed tools, `toolChoice`, and `parallelToolCalls` at [`src/server.ts:572-580`](../../src/server.ts#L572), while the prompt compiler adds the compaction contract telling the model not to call local or ChatGPT-native tools and to return only the checkpoint summary at [`src/adapters/chatgpt-web/prompt.ts:491-501`](../../src/adapters/chatgpt-web/prompt.ts#L491). Therefore this remains a **repeat of T1-11-1 / known conditional instruction mismatch**, but this source review does not establish that the browser-only compaction model can execute a tool, that a simulated receipt is appended during compaction, or that a later summary necessarily contains a false tool-effect claim. The minimum correction remains mode-specific compaction instructions; the server-side stripping and compaction contract should remain.

## Repeats / adjudicated paths checked

- The nested gateway error-flag and shell-option paths are repeats of D08/D09 in the adjudicated ledger. They live in `src/adapters/chatgpt-web/mcp-server.ts`, outside this lane’s new root, and are not reported again.
- The DEV cleanup error aggregation path is corrected in the current `src/dev-chat/cli.ts:431-445`: the primary failure is retained and both cleanup promises are independently settled. It remains a repeat check of D18, not a new finding.
- Connector mention-row page-wide lookup remains the adjudicated D14 popup-scope path and is excluded from this lane.
- Full-to-browser-only tunnel ownership, setup rollback, journal reconciliation, catalog monitor identity, and account-pool admission/selection remain the ledger’s existing roots and are outside this lane’s new finding.

## Optional / known limits, not counted as defects

- `DevChatStore.save()` still has no cross-process compare-and-swap or named-chat lock. The supported CLI flow does not establish concurrent same-name processes as a current contract, so this remains optional hardening.
- `DevChatStore.list()` treats every matching JSON file as a DEV chat and propagates invalid state. The directory is DEV-owned by the current source contract; no unrelated-file trigger is established.
- `toolCalls()` does not verify every possible future Responses output field beyond the fields used by the driver. That is a general parser-hardening idea; T2-11-1 is limited to the present declared-tool boundary and argument-shape failure.
- Full/MCP transport readiness, account-side connector availability, retained-task behavior, and actual ChatGPT DOM behavior remain outside this source-only review.

## Counts

- **New concrete defects:** 1
- **Conditional defects:** 1
- **Repeats:** 4 checked/excluded, including T1-11-1 as a qualified repeat
- **Known limits:** 3
- **Optional improvements:** 1 independently described (store concurrency)
- **Code changes:** 0
- **Finding IDs:** **T2-11-1**
