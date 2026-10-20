# Authenticity and ownership: focused necessity review

Reviewed the NEKODEX source at `f1016ab5cc82ad3a12f74d147cf6daff9c97345b`
and the resulting selective Chat On Steroids adoption change. The review and
focused synthetic fixtures establish source/development behavior, not a
vulnerability reproduction, release verification or installed-state result.
No credentials or installed browser/tunnel profiles were read.

The checks below protect different identities or state transitions. Keeping them
does not mean adding a second approval dialog, repeatedly probing a settled fact,
or forcing the user to reconfirm an unchanged operation. One concrete
simplification is implemented: update discovery and staging no longer require or
download `checksums.txt`; authenticated metadata supplies the expected digest.

## Decisions

| Boundary | Failure or threat actually prevented | Overlap and cost | Decision |
| --- | --- | --- | --- |
| Signed release metadata | A download endpoint or release account serving replacement bytes and a matching replacement checksum list; wrong fork/version assets; stale or untrusted signing roots. | Verifies a bounded metadata document, not the whole archive. A hash establishes authenticity only when its expected value already has a trusted origin. | **Retain.** Keep the packaged Ed25519 root, exact repository/tag/version, validity and asset digest bindings. |
| Actual archive and staged-copy hashes | Corrupt/partial downloads, a stale or modified cache, or changed bytes between cache and extraction. | The cache and staged archive are different mutable files. Reading the staged copy after copying is a distinct boundary; a prior download receipt does not prove its bytes. | **Retain.** Do not replace actual byte verification with a version label, URL, file existence or successful HTTP status. |
| Separate unsigned `checksums.txt` download | Previously detected inconsistency between two published release descriptions. | Its selected digest had to equal the already authenticated asset digest. It added no independent signing authority and added an HTTP/availability dependency. | **Simplified.** Discovery accepts the platform package and signed metadata without the sidecar; staging uses `authenticatedAsset.sha256`. Checksum-list generation/consistency remains a release-assembly concern. |
| OS distribution signatures / notarization | Installation under an unintended OS publisher and failure of the platform distribution policy. | A fork-controlled Ed25519 key and an OS publisher certificate are different trust roots. A valid signature is not a source-code audit; artifact attestation is a third, separate provenance statement. | **Retain the existing release/installer gates.** Do not add redundant OS commands to every local tool operation or claim they ran during this review. |
| Renderer IPC WebContents, main-frame and allowed-URL identity | A different embedded page, subframe, detached document or navigation reusing a channel intended for trusted launcher UI. | Comparing frame process/routing IDs supports distinct Electron wrappers for the same frame. URL validation and WebContents identity constrain different things. These are local synchronous checks with no provider round trip. | **Retain.** Continue using one guarded registrar rather than adding checks independently to every feature handler. |
| Authenticated principal and session evidence | Cookie presence, visible composer or cached model evidence being mistaken for the currently accepted account. | Endpoint identity answers who is signed in; Temporary Chat/composer readiness answers whether this surface can execute the task. Neither substitutes for the other. | **Retain.** Cookie changes trigger observation; they do not establish authentication themselves. |
| Authentication generation, probe revision and identity epoch | An old asynchronous probe overwriting a new login, account or browser view; connector/tool evidence surviving an account switch. | Generation identifies an auth operation, revision orders overlapping probes, epoch invalidates identity-derived evidence. These are in-memory comparisons, not additional sign-in attempts. | **Retain.** Recheck after asynchronous boundaries; do not repeat a network auth probe before every local action. |
| Turn token / internal binding and active outer tool membership | A retained ChatGPT message invoking tools for a completed/revoked/different Codex turn, or calling tools absent from that turn. | Token claim, request activity, tool admission and completion fence have different lifetimes. A discoverable tool schema alone is not authorization. | **Retain.** Keep the current native Codex execution/approval owner; do not add CoS's independent shell or approved-root authority. |
| Browser trace/helper/surface/account owner | A stale helper closing another task's tab, releasing a replacement surface, accepting another account's output, or attributing late progress to a new task. | PID alone can be reused; trace alone may outlive a replaced document. The random surface and account bind the exact live resource. | **Retain.** Maintain a single tab/lease owner and pass its receipt, rather than inventing another registry. |
| Operation fingerprints, acknowledgements and removal receipts | Lost HTTP responses causing a duplicate mutation; the same operation key carrying different inputs; refund/retry of a prompt whose submission is unknown. | Acknowledgement releases retained result payloads; compact replay guards still prevent re-execution. Missing UI is not a durable unsent receipt. | **Retain.** Preserve durable ledger-before-removal-before-settlement order. Do not interpret timeout as rollback. |
| Account tunnel PID plus process start identity | Stopping an unrelated process after PID reuse, adopting an orphan belonging to another generation, or losing the only evidence of a live detached tunnel. | `processAlive` distinguishes exited from permission/observation uncertainty; start identity distinguishes reuse. Verified local evidence already avoids slow remote `runtimes status` probes. | **Retain the local owner checks.** Reuse current verified evidence; do not restore remote status lookup on every monitor/quit path. |
| Config bytes, canonical target and generation journal | A setup or rollback overwriting a newer edit or replacing the active generation link; failed setup deleting a credential still referenced by committed config. | Path identity, before-image and committed-write receipt are different facts. One semantic writer can carry these together. | **Retain.** Keep compare-before-commit and compare-before-compensation. Encryption must extend these receipts, not bypass them. |

## Source evidence

Unchanged-boundary line references identify the review baseline. The updater
references below identify the final implementation in this change.

- Release authority: [`release-trust.cjs`](../../launcher/electron/release-trust.cjs),
  lines 36–55 validate packaged roots; 58–99 authenticate exact metadata bytes and
  release/asset identity.
  [`update-staging.cjs`](../../launcher/electron/update-staging.cjs#L47), lines
  47–58 authenticate metadata, bind the selected asset name/size and use its signed
  digest directly; lines 65–90 retain cache, streamed-download and staged-copy
  verification. [`update.cjs`](../../launcher/electron/update.cjs#L444), lines
  444–460 require only the platform package and metadata with exact validated
  release URLs and bounded asset size. Discovery is a candidate hint; staging
  still verifies the publisher signature before package download or extraction.
- Native publisher gates: [`release-signing.cjs`](../../launcher/scripts/release-signing.cjs),
  lines 5–15 and 22–36 distinguish a publisher release, expected Developer ID/team,
  notarization and Windows certificate verification. The existing
  [release-signing contract](../release-signing.md) also distinguishes independent
  artifact attestation. This review did not check provisioned signing identities,
  account settings, published attestations or installer acceptance.
- IPC: [`logging.cjs`](../../launcher/electron/logging.cjs), lines 266–305,
  validates the exact launcher WebContents, live main frame, process/routing IDs
  and allowed URLs before calling a handler.
  [`main.cjs`](../../launcher/electron/main.cjs), lines 934–941, wires that one
  authorization function into the registrar. Context isolation remains useful,
  but does not replace sender authorization at this privileged boundary.
- Browser identity: [`browser-auth-probe.cjs`](../../launcher/electron/browser-auth-probe.cjs),
  lines 59–118, checks the non-redirected session endpoint, principal, error and
  expiry. [`browser-host.cjs`](../../launcher/electron/browser-host.cjs), lines
  3505–3517 and 3562–3584 reject obsolete asynchronous observations; 3592–3625
  require both surface readiness and session evidence and advance identity epochs.
  [`account-pool.cjs`](../../launcher/electron/account-pool.cjs), lines 421–427,
  captures the account/principal/epoch lease. Its lines 1733–1737 already avoid
  requiring prior connector verification for an explicitly selected or pinned
  account; keep that existing reduction in unnecessary readiness restrictions.
- Turn capability: [`turn-broker.ts`](../../src/adapters/chatgpt-web/turn-broker.ts),
  lines 1223–1292 and 1349–1397, rejects terminal tokens/bindings and mismatched
  invocation replay. [`mcp-tool-routing.ts`](../../src/adapters/chatgpt-web/mcp-tool-routing.ts),
  lines 280–303 and 409–465, retains exact advertised native tools and structured
  nested dispatch, excluding raw composition when Web subagents are disabled.
- Replay delivery: [`turn-broker-owned-operations.ts`](../../src/adapters/chatgpt-web/turn-broker-owned-operations.ts),
  lines 75–99 retain token, binding and invocation fingerprint through live and
  acknowledged states. [`browser-turn-lifecycle.cjs`](../../launcher/electron/browser-turn-lifecycle.cjs),
  lines 47–52, 164–182 and 291–308 check the live owner and settle the durable
  ledger before publishing removal. [`account-pool.cjs`](../../launcher/electron/account-pool.cjs),
  lines 1760–1777 require an exact terminal, unsent, removed task receipt before
  releasing unsent admission. [`browser-artifact-transfers.cjs`](../../launcher/electron/browser-artifact-transfers.cjs),
  lines 96–105 recheck exact ownership after awaiting download; that post-await
  check is necessary even though registration checked the same inputs earlier.
- Tunnel resources: [`account-tunnel-supervisor.cjs`](../../launcher/electron/account-tunnel-supervisor.cjs),
  lines 51–59 distinguish process death/reuse/uncertainty; 167–193 bind markers
  and current config to one account/mode/tunnel/alias; 196–217 check observed
  process identity. [`account-tunnels.cjs`](../../launcher/electron/account-tunnels.cjs),
  lines 83–93 compare the canonical generation target and captured config bytes;
  146–156 discard only an unreferenced matching credential file.
  [`runtime-generation.cjs`](../../launcher/electron/runtime-generation.cjs),
  lines 49–68 and 71–111 preserve concurrent config changes during recovery.

## Resulting behavior and focused verification

An update listing containing the correct platform archive and signed metadata
can now reach `available` even if `checksums.txt` is absent. During staging the
expected digest comes from the authenticated asset record, so an unavailable
unsigned checksum endpoint no longer blocks an otherwise valid update. Invalid
publisher signatures still stop the operation before package download/extraction;
changed stream, cache or staged-copy bytes still fail validation. Structural
application validation and transaction ownership remain in place. Release
generation can continue publishing checksum lists for humans and other clients.

The update owner ran `bun test tests/update-authenticated-staging.test.ts`:
**6 passing focused cases**. The
[`fixture`](../../tests/update-authenticated-staging.test.ts#L128) uses the real
Ed25519 verifier, production authenticated downloader/hash path and Linux
structural application validator with inert extraction. Coverage comprises
staging without a usable unsigned checksum endpoint, public-controller discovery
without a checksum asset, signature refusal before any package download/extraction,
and rejection of corrupted stream, cache and staged-copy bytes. These passing
results were reused by this documentation lane; tests were not rerun. No update
worker, installer, real credential or provider account was used.

The removed sidecar dependency does not justify removing archive hashing,
publisher metadata authentication, platform distribution gates or stage ownership
checks.

No additional security-code removal is supported by this focused source review.
Several adjacent comparisons are cheap checks of different resource lifetimes;
their proximity is not evidence of a redundant permission restriction. Existing
local PID evidence, selected-account readiness and one guarded IPC registrar
already avoid repeated expensive checks. Keep those simplifications rather than
adding new per-action audits or arbitrary consent expiry.

The review does not claim the absence of every vulnerability or prove a current
installed app, live account, release artifact or remote provider state. The
credential follow-up is specified separately in
[the shared provider design](../design/tunnel-credential-provider.md).
