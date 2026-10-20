# Selected native canonical history capture

The canonical source is the existing main-owned Codex app-server client, not a Responses request body, a rollout-file scan, or inferred prompt text. `CodexClientControl.readThreadConversation` binds the exact requested thread through metadata `thread/read` (`includeTurns: false`) and reads one supported `thread/items/list` page. The method requests recent items in descending order and returns the retained page chronologically. It does not call thread/resume, turn/start, fork, approval or interrupt, and it adds no transport or event subscription.

The current public schema was generated from official Codex 0.163.0. Native `userMessage` text inputs and `agentMessage` text are projected; tools, system/developer-like items, hooks, plans, reasoning and nontext attachments are excluded. The native reader bounds a page to 100 raw entries, 128 KiB per item and 384 KiB of projected JSON; oversized items are omitted whole and counted. Native item and turn IDs are retained. Authorship is unknown unless actually established by the source; user role is never assumed to mean human. Compaction identity remains null because this supported reader does not establish it. A missing native timestamp is represented as observed time with explicit provenance.

## Explicit consent and refresh boundary

Global local-history recording is disabled by default. Each selected native thread additionally requires explicit private-content consent and acknowledgement that unfamiliar secrets/private information may remain in canonical conversation text. These choices persist only in the private history owner's SQLite database, keyed by a main-supplied opaque configured-profile source ID and exact thread UUID. The source ID describes that configured native profile lineage, not a signed-in account or all machine history.

`createCanonicalNativeHistoryRecorder({sourceId, getClient, requestHistory, knownSecrets?})` is the trusted main coordinator. `requestHistory` resolves the existing daemon admin route's unwrapped `value`, after verifying the current owned runtime; the coordinator never opens another database or starts a runtime. Its public methods are:

```ts
status(threadId)
setConsent(threadId, { enabled, consent, acknowledgeUnknownSecrets })
refresh(threadId, { cursor?, limit? })
list({ cursor?, limit? })
```

`status`, a disabled capture lease, and consent changes do not instantiate/connect the native client. `list` is an explicit user metadata read through the same client and can be used while recording is off; it records no text. No native list/read runs automatically on screen mount or process restart.

Each explicit refresh obtains a daemon consent lease before the native read and rechecks it transactionally before persistence. The lease binds the per-thread consent revision and a durable global recording epoch. Revocation, revoke/re-enable, and global off/on invalidate in-flight leases. A late read then stores no message revision. Revocation preserves existing history.

The screen calls this **capture after explicit native refresh**, with no background watcher. A future supported event subscription would need its own owner and consent lifecycle; none is implied here. An empty canonical page means no canonical text was returned, not proof that the original conversation is empty.

## Privacy and completeness

Canonical roles establish structure, not secret-free text. A deterministic `known-pattern-filter-v1` policy excludes the entire item when it matches known credential patterns, explicitly supplied known secrets, or known generated-instruction/schema envelopes. Excluded item bodies are neither stored nor hashed; only bounded identity, original byte count and a fixed safe reason remain. The daemon independently applies known pattern checks to accepted canonical text. No vault/profile credential scan is performed to populate the filter.

The policy is not exhaustive redaction. Ordinary user/assistant text can contain private data or credentials that do not match known patterns; that risk is separately and visibly acknowledged before opting in a thread. Manual imports keep their existing caller-validation contract and cannot claim canonical filtering. Unknown-sensitivity manual text still produces metadata-only rejected records.

All captured records are partial corpus coverage. Native item/attachment omissions, privacy exclusions, page limits, unavailable older pages and quotas remain explicit. Recording one recent page does not claim full thread, machine, account or compaction history. Supported native text edits create immutable local revisions and replace the latest FTS projection; unchanged refreshes do not create duplicates. A new local revision uses the actual canonical message ID, a persisted monotonic revision number, and a fingerprint of retained/metadata-only content. Search indexes only the latest retained text.

## IPC and ownership

Only `canonical-status`, `canonical-consent`, `canonical-refresh` and `canonical-list` are exposed through the guarded history registrar. They accept exact whitelisted public fields. Renderer input cannot supply source IDs, leases, message arrays or canonical recording payloads. `canonical-lease` and `canonical-record` are private administrative operations constructed by the trusted main coordinator. The daemon remains the sole history database writer. Existing read-only API history-content permission remains separate from recording permission.

## Evidence and limits

`tests/conversation-history-canonical.test.ts` connects the real native client owner over synthetic JSON-RPC streams to the main coordinator, guarded public registrar and actual SQLite history owner. It covers opt-in/privacy exclusions, partial/unknown authorship, source identity, edits and deduplication, late per-thread revocation, durable global off/on epochs, source inactivity while disabled, and refusal of renderer-supplied canonical batches. This proves the connected native-shaped producer flow; it does not establish a live account transcript.

An offline official app-server probe confirmed that `thread/read` and `thread/items/list` succeed on an inert synthetic thread, but its injected model-visible history produced an empty canonical item page. Thus actual nonempty canonical text projection remains synthetic-RPC evidence; the UI must describe a live empty page truthfully and must not import raw Responses or rollout contents as a fallback.
