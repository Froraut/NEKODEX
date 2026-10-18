# D01 credential implementation and verification

Date: 2026-10-18. Source delivery version: `6.1.32-nekodex.8`.
Base: selective adoption `e7bec90f8f727815de83c110822919adc20f3edd` / PR #96.
The user explicitly requested source, verification and migration of the installed
application. Local app-only delivery is authorized; public release assets are not.

The [current design](../design/tunnel-credential-provider.md) is implemented for
macOS Keychain. Electron and Bun share the same native protocol and immutable
home/account/mode/tunnel scope. SDK profiles store an environment selector;
LaunchAgent restart uses a credential-resolving CLI entry. New setup keys use
private stdin instead of a staging file. Other platforms expose explicit legacy
private-file storage and do not claim an implemented protected backend.

## Focused evidence

| Boundary | Observed result |
| --- | --- |
| Provider | Five deterministic cases / 97 assertions passed: immutable readback, exact scope/home isolation, referenced cleanup protection, bounded fixed errors and uncertain receipts. |
| Electron | Focused adapter/migration cases passed, including actual inert child environment/output, exact-peer stop/commit/start ordering, saved-not-ready same-reference recovery, concurrent config/file changes, uncertain-write receipts and fresh process/profile proof. Existing account patch/store checks passed. |
| Bun/CLI | Focused cases passed for config rollback, locked preflight, legacy/vault union, explicit legacy selection, bounded stdin, same-scope recovery blocking, output/exit/signal forwarding and global finalization. Existing SDK compatibility checks passed. |
| Actual SDK | Installed official 0.0.16 passed the isolated loopback fixture: selector-only profile, detached authenticated poll after connect exit, exact alias/PID settlement and no persisted synthetic key. [Detailed receipt](2026-10-18-d01-sdk-contract.md). |
| Native Keychain | Actual prepare/resolve, cross-mode refusal, referenced preservation and exact synthetic cleanup passed. |
| Real DEV UI | The actual Migrate button saved a synthetic key in Keychain, started a fresh actual SDK peer, displayed protected/ready and removed its old file. Config/profile contained no key; all 258 observed fixture polls authenticated. Explicit unencrypted-file selection showed its warning and was cancelled without saving. |
| Built headless CLI | Two separate `app/cli.js tunnel credential-run` starts without Electron read the actual Keychain through the bundled helper, delivered the expected synthetic key only in child environment and exited 0. Exact record retirement was verified as not-found. |
| Relocation | A separate-process test proved sibling bundled-helper lookup and failure when it is absent, even while source checkout exists. Bun's inlined CJS source dirname is not trusted for the installed runtime. |
| Development build | Renderer build, source/launcher typechecks, architecture map and version synchronization passed. A native-runtime development bundle was built. |

Disposable native/UI/headless fixtures, their app/SDK/server processes and scoped
vault records were settled and removed. No real key value entered review output.
The UI evidence remains a private local artifact rather than public fixture data.

## Review corrections included

- Global setup preserves exact legacy retirement metadata and requires explicit
  finalization after new SDK readiness/selector proof.
- SDK captures scrub exact injected values before diagnostics, including split
  chunks and truncated tails.
- Uncertain vault writes preserve ownership receipts and block blind retry.
- Outer Electron rollback preserves newly committed candidate references before
  restoring an older config; unverified process settlement is explicit.
- Packaged Bun locates the helper from the running entry, without source fallback.
- The native compiler explicitly receives the selected macOS SDK.

## Installed delivery

Pending until the local application replacement and exact migration receipts are
recorded below. Development success does not establish an installed update.
The existing installation uses Developer ID team `CNMWGJF2CG`; the local update
must retain that publisher. No DMG/ZIP, notarization submission, release tag or
public installable asset is part of this task.

## Deferred-feature decision

The [complete Russian backlog table](2026-10-18-deferred-features-next.md) contains
36 dispositions mapped to every original deferred group. D01/P02 is this batch;
the next recommended work is native plan/evidence and worker-tree UI, followed by
opt-in transcripts, incremental search/supported fork and manual outcome review.
