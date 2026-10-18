# D01: shared tunnel credential provider

Status: approved design scope for selective CoS adoption; **no credential format,
startup route or saved credential migration is implemented by this document**.
The source baseline is `f1016ab5cc82ad3a12f74d147cf6daff9c97345b`.

## Outcome and constraint

Save tunnel runtime credentials using an OS-backed provider while retaining
Electron startup, Bun CLI setup, native headless service restart, account/mode
isolation and exact rollback ownership. Successful encrypted persistence is a
different result from a working tunnel or accepted ChatGPT connector.

Electron `safeStorage` is a useful reference for store serialization and recovery,
but is insufficient as the sole runtime API: the Bun CLI and native launchd
service do not run inside Electron. Do not encrypt the existing `.key` bytes and
leave a native `file:` selector pointing to ciphertext, or leave a permanent
plaintext mirror and label the result encrypted saved credentials.

## Checked facts and unresolved SDK contract

| Checked source fact | Consequence |
| --- | --- |
| [`src/tunnel.ts`](../../src/tunnel.ts), line 18, pins official tunnel-client `0.0.16`. Lines 553–570 call `runtimes connect --runtime-api-key file:<runtimeKeyFile>` from Bun. | The existing CLI needs a non-Electron provider and an adapter preserving managed startup. |
| [`runtime-tunnel-policy.cjs`](../../launcher/electron/runtime-tunnel-policy.cjs), lines 84–97, builds the same file selector. [`runtime-supervisor.cjs`](../../launcher/electron/runtime-supervisor.cjs), lines 577–584 and 1482–1505, require that saved file and own managed startup. | Both producers must change under one contract; renderer state cannot resolve secrets or start another tunnel. |
| [`account-tunnel-supervisor.cjs`](../../launcher/electron/account-tunnel-supervisor.cjs), lines 178–193, projects one account/mode into the shared supervisor. | The provider scope must include application home, account, mode and tunnel; one account may never borrow another's credential. |
| [`src/tunnel-service.ts`](../../src/tunnel-service.ts), lines 53–78, starts `tunnel-client run --profile-dir … --profile …` directly through launchd, with `RunAtLoad` and `KeepAlive`. | Native service startup currently bypasses Electron and Bun. Supporting it requires a headless provider entry point or verified native SDK credential support. |
| [`src/setup.ts`](../../src/setup.ts), lines 532–548 and 797–830, snapshots config, key, client, profile and service, refusing unsafe rollback when ownership or status is unresolved. | Replace raw-key file receipts with versioned provider receipts without losing transaction semantics. |
| [`account-tunnels.cjs`](../../launcher/electron/account-tunnels.cjs), lines 96–135 and 146–156, prepares a new immutable key then commits config, and discards only its own unreferenced file. [`runtime.cjs`](../../launcher/electron/runtime.cjs), lines 640–652, preserves a committed binding even if readiness fails. | Encrypted storage must retain prepare/commit/discard and the saved-but-not-ready result. |

The reviewed NEKODEX call sites do **not** establish what SDK `0.0.16` serializes
in its generated profile, which key selectors it supports, when it reopens a key
file, or what its detached runtime inherits on recovery. CoS passes a key in the
environment to its direct `run` route; that does not prove equivalent behavior
for NEKODEX's managed `runtimes connect` route. Resolve these questions from the
exact official SDK revision and a disposable fixture with a synthetic credential,
not by reading installed profiles or testing with a real key.

## One provider contract

Introduce a runtime-independent credential service with a small typed protocol.
Electron main and Bun call the same service; a native headless startup adapter
uses the same scope and version rules. A native OS-backed helper is the preferred
candidate when it avoids loading Electron to access storage. Platform adapters
must support the actual supported login/service contexts; a backend label alone
is not proof that protection or noninteractive access is available.

Proposed saved configuration representation:

```json
{
  "credential": {
    "version": 1,
    "provider": "os-vault",
    "id": "opaque-random-credential-id",
    "revision": "immutable-random-revision"
  }
}
```

The reference contains no secret, raw key hash or user-selected executable path.
The provider record binds that reference to canonical application home, account
ID, Automatic/Manual mode and tunnel ID. Include the application home so DEV and
production cannot collide. Provider lookup validates the expected scope rather
than accepting arbitrary renderer-supplied vault IDs. Keep the existing alias,
profile, process ownership and account binding owners.

The versioned config schema should initially accept either the existing
`runtimeKeyFile` or the new credential reference, never both as competing active
authorities. Older configs remain readable; migration is an explicit durable
operation, not a side effect of reading a status snapshot. Unknown versions fail
with an actionable compatibility error and preserve the record.

Suggested operations:

- `capabilities(context)` returns protected-storage and noninteractive-read
  availability without returning credentials or showing an unlock prompt.
- `prepare(scope, secret)` writes a new immutable revision and returns a receipt
  naming only its reference, scope and transaction ID. Secret input travels over
  a private pipe/native call; command arguments and JSON diagnostics contain none.
- `resolveForLaunch(ref, expectedScope, owner)` resolves only for the captured
  launch operation. It yields a private launch adapter/lease, not plaintext IPC
  to the renderer or a general HTTP credential endpoint.
- `discardPrepared(receipt, currentReferences)` removes only that transaction's
  uncommitted, unreferenced revision. `retire(ref)` schedules exact old revision
  cleanup only after config, profiles and live owners no longer depend on it.

References can be logged only through bounded identifiers consistent with other
runtime diagnostics. Avoid keeping credential-derived hashes in diagnostics.
Secrets remain readable by authorized same-user runtime code at use time; this
design protects durable storage, not a compromised OS account.

## Locked or unavailable storage

Distinguish `locked`, `unavailable`, `not-found`, `scope-mismatch`, `unsupported`
and `corrupt` from invalid credentials or remote tunnel failure. None is a reason
to write an empty store, generate a replacement key, borrow another account's
key, erase ciphertext, or silently downgrade encryption.

Interactive setup may offer the platform's normal unlock flow after an explicit
user action. Headless startup reports a bounded actionable unavailable/locked
state and waits for a supported retry; it cannot depend on a hidden desktop
prompt or an invented approval expiry. A currently healthy tunnel need not be
restarted merely because a later store availability probe is inconclusive.
The provider must report whether unattended restart is possible in the selected
OS context before enabling encrypted credentials for that route.

## Native launch adapter decision

Prefer a native SDK selector/provider supported by the pinned version if it can
resolve this reference noninteractively and does not copy raw keys into profiles.
Otherwise use a small NEKODEX credential launch adapter as the headless service
entry point. It resolves one exact reference, injects the key through an SDK
mechanism whose inheritance and persistence have been verified, and transfers
process/cleanup ownership through the existing runtime owner.

Private IPC/anonymous handles or process environment are candidates only after
checking the SDK contract. Secrets must not be part of the persisted launchd
plist, SDK profile, command arguments, public descriptors, generated logs or
recovery journals. A change from direct native service launch to an adapter is
an explicit service definition change with the existing unload/rollback rules.

If the only compatible selector is `file:`, a temporary private file requires
an exact lease and proven SDK reopen/restart semantics. It may remain necessary
for the lifetime of an owned runtime; then the product must disclose that runtime
plaintext artifact and avoid claiming that no plaintext remains on disk. Do not
delete it simply because the control command returned or a readiness deadline
elapsed. If this cannot meet the agreed storage outcome, retain legacy storage
and keep encrypted mode unavailable until the adapter or SDK is ready.

## Migration, commit and recovery

1. Capture the exact config generation/link target, old credential reference or
   legacy file receipt, affected account/mode, service/profile receipts and current
   live owners. Reading a snapshot grants no new key access.
2. Prepare and read back a new protected immutable provider revision using a
   synthetic check of the record contract. Record only its opaque receipt in the
   existing setup transaction. Do not delete the old key/profile yet.
3. Prove that the selected native startup adapter can use the new reference. Stop
   only an affected owned peer when replacement requires it; active tasks retain
   the existing idle/admission rules. Do not race an unresolved prior connect.
4. Commit the candidate config with its new reference using the captured config
   generation. A newer writer wins; compensation cannot overwrite it.
5. Publish `saved` independently from `ready`. A post-commit readiness failure
   preserves the committed revision and uses normal recovery. It does not discard
   that credential or repeatedly provision replacements.
6. Retire the legacy file/old revision only after durable config/profile migration,
   successful matching runtime startup and exact owner settlement. A rollback
   window may intentionally preserve the prior credential; cleanup then belongs
   to this one migration transaction, never a general secret/cache sweep.

A crash journal records phases and opaque receipts (`prepared`, `config-committed`,
`runtime-verified`, `retired`) plus expected config hashes; it stores no secret
bytes. On recovery, classify the durable config as previous, candidate or
concurrent before acting. Preserve uncertain state for recovery rather than
deleting referenced credentials. Provider writes and config commits are separate
resources, so a single semantic coordinator must own compensation across them.

## Technical exit criteria before implementation is called complete

- Establish exact SDK `0.0.16` selector, profile persistence, inherited-secret and
  restart behavior from its source and focused synthetic-credential fixtures.
  Record the exact version and evidence; do not assume current upstream matches.
- Select a protected backend callable from Electron, Bun CLI and native headless
  restart for every platform/route that claims support. Unsupported combinations
  stay explicitly on the legacy route rather than silently falling back.
- Exercise one coherent focused flow: migrate one account/mode, restart it through
  the normal owner, restart its headless entry point without Electron, then restore
  the prior generation after an injected pre-commit failure. Include a locked-store
  observation and a concurrent config change. Use synthetic keys, no provider calls.
- Demonstrate post-commit saved-but-not-ready retention, exact revision cleanup,
  account/DEV separation and no raw secret in generated config/profile/plist/logs.
  Deleting a temporary file requires observed owner settlement, not a timer.
- Update the config/runtime schema consumers, service definition, architecture and
  extension-guide rows together when implementing. Add native helper packaging
  only after the supported development path works; it is separate release work.

These are targeted implementation acceptance conditions, not authorization for
a broad repository suite, account mutation or speculative packaging. D01 is
complete as a design when the unresolved SDK/backend decisions and their exit
criteria are explicit; encrypted credential implementation remains a later
coherent feature. Fresh page/screenshot-bound extension control and a QuickJS
composition runtime also remain deferred from this selective batch: neither is
needed to implement the approved diagnostics and workflow improvements.
