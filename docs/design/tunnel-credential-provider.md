# D01: shared tunnel credential provider

Status: implemented for macOS Keychain in `6.1.32-nekodex.8`. Electron, Bun CLI
and the headless entry point share one provider. The real development UI migration
and native Keychain roundtrip passed. The local installed app/core were updated,
both active keys migrated and one inactive key archived in Keychain; exact scope
and evidence are in the [delivery report](../reviews/2026-10-18-d01-implementation.md).

Windows and Linux retain legacy configuration compatibility and an **explicit**
`legacy-file` setup choice. Their OS-vault backends are unavailable. New keys
default to protected storage; locked/unsupported storage never silently falls
back to files. The native build supports macOS Intel, but this task's native
execution evidence is Apple Silicon.

## Owners and saved contract

| Boundary | Owner |
| --- | --- |
| Protected storage | `launcher/electron/tunnel-credentials.cjs`, `launcher/native/tunnel-credential-helper.swift` |
| Bun/config port | `src/tunnel-credential.ts`, `src/config.ts` |
| Account migration | `account-tunnels.cjs`, `RuntimeHost.configureAccountTunnel`, existing account mutation lease |
| SDK process and readiness | `runtime-supervisor.cjs`, account peer supervisor, `runtime-tunnel-policy.cjs` |
| Global setup/compensation | `src/setup.ts`, file transaction and credential recovery receipts |
| Headless restart | `tunnel credential-run`, invoked by `src/tunnel-service.ts` |
| UI | Guarded main/preload IPC and `AccountTunnelCredentialStatus` |
| Native build | `scripts/build-credential-helper.cjs`, runtime bundler |

```json
{"credential":{"version":1,"provider":"os-vault","id":"random-uuid","revision":"random-uuid"}}
```

Configuration accepts exactly one immutable credential reference or legacy
`runtimeKeyFile`. The reference contains no key, key-derived hash or executable
path. The native record binds it to canonical application home, distinct
`legacy`/`default`/UUID account, Automatic/Manual mode and tunnel ID. Lookup checks
expected scope before returning secret bytes. DEV and production cannot collide.

## Pinned SDK decision

Official SDK `0.0.16`, commit `5f99daabd4aa4a77049e6d81d54a0d8c18335397`, accepts
`--runtime-api-key env:NEKODEX_TUNNEL_RUNTIME_KEY` through managed connect,
serializes only that selector and explicitly forwards the variable to detached
`run`. Every fresh process needs injection. Same-alias connect may reuse an old
process, so migration still settles the exact affected peer and verifies a new
generation. See [source and actual offline SDK evidence](../reviews/2026-10-18-d01-sdk-contract.md).

The launch owner resolves immediately before connect or remote status and injects
only the selected child environment. New Electron setup keys reach Bun through
captured stdin. The SDK's MCP child inherits its environment; NEKODEX removes the
injected key at the CLI entry before running tools. SDK diagnostics scrub the
exact value across chunks and truncated capture tails. No plaintext mirror is
needed. Local PID/start-identity/healthy-tunnel observation never unlocks a vault.

The headless wrapper reloads saved config, validates the actual profile selector
and tunnel ID, resolves scope, launches the SDK and forwards SIGINT/SIGTERM plus
exit outcomes. Its LaunchAgent plist contains only durable command/config
metadata. Native helper locations are fixed source or bundle paths; config and
renderer input cannot select a helper executable.

## Provider transaction

```js
const provider = createCredentialProvider({ coreHome });
const receipt = provider.prepare(scope, secret);
// { version: 1, reference, scope, scopeHash, owner }
provider.resolve(reference, expectedScope); // internal launch port only
provider.discardPrepared(receipt, currentReferences);
provider.retire(reference, scope, { ownerProof: true, currentReferences });
provider.capabilities();
```

Native JSON is bounded to 24 KiB, secrets to 8 KiB. Prepare inserts an immutable
record and checks exact scoped readback. Discard recomputes the home-bound scope
and deletes only a matching, unreferenced transaction owner. Retirement requires
explicit runtime-owner proof and observed current references. An uncertain put
or readback carries a secret-free `preparedReceipt`; consumers retain it under
`runtime/credential-recovery` and block blind same-scope prepare retries.

macOS uses a Security generic-password item and disables process/query
interaction. Fixed locked/unavailable/not-found/scope-mismatch/unsupported/corrupt
states never erase or replace a record. The helper requires a stable signing
requirement: installed builds keep the publisher identity and identifier.
Ad-hoc development recompilation can change access to an earlier development
item; disposable records are cleaned before changing the signing identity.
Helper bytes are signed before runtime manifest hashes and remain outside ASAR.

## Migration, commit and recovery

1. Capture exact config bytes/link target, account/mode and private regular-file
   identity. Reject a changed sign-in or unsafe legacy file.
2. Prepare and read back protected storage before disturbing the old runtime.
   Keep a nonsecret legacy retirement receipt with path/inode/content identity.
3. Settle only the affected owned peer under existing idle/admission rules.
4. Commit against the original config generation; preserve a newer writer.
5. Publish saved independently from ready. A committed-but-not-ready result keeps
   its reference and old file; retry uses that revision rather than preparing one.
6. Retire the exact old file after fresh process/start-identity, readiness and
   actual SDK selector/tunnel proof. Immediately recheck config references and
   file identity. Keep the nonsecret receipt so housekeeping does not change the
   identity of an already-running peer.

Global/DEV setup retains pending retirement metadata and reports it through
setup/Doctor. Explicit `tunnel credential-finalize` owns vault preflight, captured
config revalidation, exact stopped proof, fresh connect/readiness/profile proof
and exact file retirement. Account mode uses its own owner and rejects this
global action. External user import files are preserved. An outer Electron
checkpoint rollback must preserve newly published protected references before
restoring older config; it cannot orphan the candidate record or guess settlement.

The UI reports saved legacy/protected/missing state, progress and saved-but-not-
ready recovery. Protected storage alone proves neither unlock nor a working
ChatGPT connector. Explicit legacy choice states that the private file is
unencrypted. No secret, vault reference or raw provider error reaches the UI.

## Focused evidence and limits

- Provider checks: immutable writes, exact scope/canonical home, referenced-entry
  protection, locked/unavailable states and uncertain receipts.
- CLI checks: private stdin, explicit legacy compatibility, rollback, fresh
  headless resolution, split-value redaction, exit/signals and global finalization.
- Electron checks: child-only injection, vault-free local health, migration order,
  saved-not-ready retention, concurrent writers, recovery and process/profile proof.
- Actual SDK: synthetic loopback connect/detach/stop; selector-only profile and no
  persisted synthetic key.
- Actual DEV UI: Migrate used native Keychain and a fresh real SDK process against
  a fake local control plane, reached ready and removed the old synthetic file.
  All polls used the expected credential. App/peer/server/vault fixture cleanup
  settled before removal.

These are focused credential-flow proofs. They do not establish Windows/Linux
protected backends, a real ChatGPT connector, Apple notarization or public release.
The local installed update and key migration have their own receipt in the delivery report.
