# NEKODEX triwave review 1 lane 11 — dev chat

- **Baseline:** `3740505b0107af9a83053fd523ae1ad30be36465` (`HEAD`)
- **Scope:** `src/dev-chat/**`, direct `compactRequest`/server caller path, and the browser-only/full mode contract in `docs/dev-chat.md`.
- **Method:** read-only source and direct-caller review. No tests, typechecks, scripts, broad audits, live browser/account actions, production actions, code edits, commit, or ABI changes.
- **ABI boundary:** Native4, Native4 DEV, and ZeroRisk4 identities and public tool schemas were not changed or proposed for change.

## Finding T1-11-1 — browser-only compaction sends Full/MCP tool instructions

**Classification:** concrete conditional defect, P2; no live reproduction claimed.

**Trigger**

Run a named DEV chat in `browser-only` mode using a non-Luna model that supports the separate compaction path, then either:

1. issue interactive `/compact`, or
2. send a turn whose context crosses the automatic compaction threshold.

The direct caller is `DevChatDriver.compactInput()` in [`src/dev-chat/driver.ts:617-640`](../../src/dev-chat/driver.ts#L617). It rejects only Luna, then builds `/v1/responses/compact` with:

- `instructions: DEV_CHAT_SYSTEM_INSTRUCTIONS` at lines 634-638;
- `DEV_CHAT_SYSTEM_INSTRUCTIONS` at lines 85-90, which explicitly says the DEV harness should use available Codex Native tools and that every outer tool result is a simulation receipt.

The caller does not select `DEV_CHAT_BROWSER_ONLY_INSTRUCTIONS` when `this.config.mode !== "full"`.

**Consequence**

The browser-only compaction model receives a system instruction that says outer tools are available and that simulated tool receipts exist, while the browser-only product contract says the profile exposes no outer tools and must not claim commands, file edits, UI actions, or external effects. The compaction response becomes replacement history, so a summary generated under the contradictory instruction can preserve or introduce tool-availability/simulated-effect claims into the named chat's retained context. This makes browser-only compaction semantically different from the advertised browser-only chat contract and can bias later answers after compaction.

This affects both manual and automatic compaction because both call the same `compactInput()` path. The documented browser-only promise is explicit in [`docs/dev-chat.md:115-117`](../../docs/dev-chat.md#L115): browser-only keeps the compaction path while having no retained MCP boundary; it does not authorize Full/MCP tool instructions.

**Counterevidence and limit**

The server's compaction branch removes `parsed.context.tools`, `toolChoice`, and `parallelToolCalls` before adapter dispatch at [`src/server.ts:572-579`](../../src/server.ts#L572). Therefore this finding does **not** establish that a real outer tool bridge is exposed, that a simulated tool call is executed during compaction, or that an external side effect occurs. It is a model-facing instruction mismatch and replacement-history integrity defect. The normal browser-only turn path correctly chooses an empty tool list in [`src/dev-chat/driver.ts:193-200`](../../src/dev-chat/driver.ts#L193-L199), which is counterevidence for the ordinary turn path but does not correct the compaction request.

**Minimum correction direction**

Choose the compaction instruction by mode, using the browser-only instruction when `config.mode === "browser-only"`, while retaining the server-side removal of tools. Do not change connector names, Native4/Native4 DEV/ZeroRisk4 identities, or any public tool ABI.

## Repeats / adjudicated paths checked

- The previous lane-11 finding about connector mention rows escaping the popup is a repeat of the already adjudicated D14 path. Current source includes the wave-2 popup freshness, visible `.popover` scope, exact row/title/highlight/pill gates described in `docs/reviews/2026-09-15-four-wave-fix2-08.md`; it is not reported again as a new T finding.
- The previous D18 DEV CLI cleanup path is corrected in the current `src/dev-chat/cli.ts:411-447`: primary operation failures are retained and both cleanup calls are independently settled. No new D18 finding is reported.
- D11 Full-to-browser-only tunnel ownership remains an adjudicated setup/lifecycle boundary owned by the setup/supervisor lanes, not a new `dev chat` defect in this lane.

## Known limits / optional improvements, not counted

- `DevChatStore.save()` has no cross-process compare-and-swap or named-chat lock. Two simultaneous processes opening the same chat can last-writer-wins overwrite history. The CLI/documentation does not establish concurrent same-name use as a supported workflow, and this review did not classify it as a current defect.
- `DevChatStore.list()` treats every `.json` file in the chat directory as a DEV chat and fails on an unrelated invalid JSON state file. The directory is DEV-owned by this source path; no external-file trigger was established, so this remains an optional hardening idea.
- Full/MCP transport readiness, live account-side connector availability, retained-task behavior, and actual ChatGPT DOM behavior remain outside this read-only source review and are not counted as defects.

## Counts

- **New concrete defects:** 1
- **Conditional defects:** 1
- **Repeats:** 0 new (2 prior lane/adjudicated paths checked and excluded)
- **Known limits:** 3
- **Optional improvements:** 0 independently counted
- **Code changes:** 0
- **Finding IDs:** **T1-11-1**

