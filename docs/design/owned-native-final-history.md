# Owned Native final-summary history

`ConversationHistoryStore.ownedNative` is a leaf of the existing single Bun
SQLite owner. It shares revisions, the logical-byte quota, FTS, exact-revision
links, explicit deletion and Markdown export. It opens no second database/writer,
effect journal, subscriber, timer, transcript discovery or model lifecycle.

The distinct `owned-native-final-summary-v1` policy defaults off for every exact
scope: `{taskId, generation, sourceId, profileId, backendAccountId, authEpoch}`.
`authEpoch` is a UUID string. The source/account/profile/epoch tuple comes from
trusted main admission, never renderer claims or incoming HTTP record bodies.
Global recording must already be enabled; enabling this policy additionally
requires exact task-generation future-content consent and explicit acknowledgement
that unfamiliar secrets may remain. Existing `canonical-thread-text-v1` keeps
unknown authorship, selected-thread explicit refresh and its own separate consent.

The provider obtains `lease(scope, {dispatchId})` **before** its one Native offer.
A disabled policy returns no lease. Enabling it while an offer runs cannot
retroactively capture that offer. Leases carry a private minted identity, exact
dispatch, scope, global recording epoch and consent revision. The class retains a
bounded in-memory lease registry; only terminal observations may leave its
duplicate-observation cache. Active entries are never evicted to admit a write.
No lease survives process restart; durable history and consent do survive.
The provider releases its transient lease in `finally` after terminal capture
processing, including tool-request, failed and aborted offers, so those offers
cannot consume the active-lease bound indefinitely. Release never deletes
retained content or changes Native ownership/receipts.

After Native ownership/receipt validation and protocol parsing, the provider may
pass only `final: {kind: 'final', summary}` to `recordFinal`, together with the
actual Native message/turn/thread IDs, Native timestamp, dispatch, worker binding
and generation, and NativeTurnReceipt ID. Missing actual identities/timestamps
produce no content; there are no invented message IDs or observed-time fallback.
The existing trusted Responses-shaped capture adapter is unrelated and is not
used for this Native JSON protocol.

At write time the composition root resolves the authoritative current task
generation and admitted source tuple again. It supplies the store constructor's
`trustedCurrentScope(taskId)` resolver (preferred), or the in-process
`currentScope` argument. If neither exists, recording refuses content. A resolver
overrides any supplied current-scope argument. Changed task generation,
corrections that advance that generation, account/epoch/source changes, explicit
revocation/reconfirmation, or global off/on invalidate an old lease. Global and
consent checks occur inside the existing synchronous SQLite transaction. History
failure returns a bounded outcome and never changes Native success, retries an
offer, or discards its Native receipt.

Only the validated summary projection is stored as `role: assistant`, `author:
agent`, `source: native`, `sensitivity: known-pattern-filtered`, `coverage:
partial`, reason `validated-owned-native-final-summary-projection`. All
automatic-host compiled context, tool-request JSON, tool arguments/results,
schemas and reasoning remain outside this projection. Metadata is explicitly
whitelisted and bounded; arbitrary input fields never enter SQLite. Private
owned metadata preserves the exact scope and Native provenance in the same
revision JSON. Export includes that provenance.

The existing `known-pattern-filter-v1` whole-item filter is reused. Matches retain
metadata and rejection reason, with no unsafe body stored or hashed. Safe summary
projection, source, Native IDs and provenance determine a SHA-256 revision ID;
reobserving an identical final deduplicates through the same history store.
Known-pattern checks do **not** guarantee automatic removal of unfamiliar
credentials, secrets or private information. Search/export remain a partial
corpus and never imply a complete transcript or verified task outcome. Revocation
stops future writes and retains already-saved records until explicit deletion.

Every explicit `owned-native-consent` with `enabled:false` revokes all scopes
for the validated actual task generation, including alternate sources even when
the current source is available. Returning to a previously enabled source cannot
restore consent. Revocation does not depend on a live source advertisement. After validating the
actual task/family/generation/revision, the trusted root may call
`revokeTaskGeneration({taskId, generation})` when its model source is unavailable.
The method scans at most 256 private consent metadata rows, disables every exact
task-generation scope, increments their consent revisions and forgets its active
capture leases. Other tasks/generations and saved content remain intact. The
source returning later cannot restore consent or authorize old leases. This
method accepts no renderer account/source assertions and never reads transcript
bodies.

`tests/conversation-history-owned-native.test.ts` contains connected synthetic
SQLite cases covering default/global/per-generation opt-in, pre-enable offers,
dispatch/source/generation/epoch fences, revoke/re-enable, actual provenance,
deduplication, filter exclusions, search/export and retained history after
revocation, plus source-unavailable task-generation revocation that preserves
other tasks/generations. These do not establish live account/model execution or installed-app
delivery.
