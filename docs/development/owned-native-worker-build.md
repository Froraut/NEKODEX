# DEV owned Native worker wrapper

This Mac-first helper embeds the official public Codex app-server Rust library at exact revision `83086188ae0614bd882818ff1aa23f3194962012` (tag `rust-v0.163.0`). It is a small separate Cargo root, not a maintained Codex fork or vendored copy. The owned-worker admission leaf supports this exact wrapper variant; main/Bun/Agent integration contracts are now wired, with no real profile admission. The helper is outside packaging and has not been delivered to an installed app or release. Windows/Linux remain phase 2.

Initial verification was compilation/source-entrypoint review and static `--build-info`. After that passed, the parent authorized one connected wrapper fixture against an owned loopback fake Responses server with disposable profile/dummy auth only. That distinct check also passed, as recorded below. Real account authentication, real provider delivery, installed-app use and full authenticated startup admission remain unverified.

## Why a wrapper

Stock 0.163 can schedule plugin startup warmup before a client can inspect public effective configuration. The public Rust `AppServerRuntimeOptions` provides `PluginStartupTasks::Skip`, which the normal production CLI does not expose. This wrapper chooses that option while retaining the normal managed/system/MDM/cloud policy loader.

`Skip` omits constructor plugin warmup. It is not a permission override, a general no-network policy, or proof that all authenticated startup inputs are safe. Later app-server account-login completion has separate plugin warmup; the future owner must not use that path for first login. Keep the existing `official_policy_preflight_unverified` boundary until the exact wrapper/profile/startup/policy/transport flow is verified. Auth-only official CLI device login is a distinct explicit owner/UI interaction, not part of this build. A separate qualified-account admission owner now consumes proven inventory; the original fixture `official-openai` admission refusal remains unchanged. No real account/model has yet been admitted.

## Fixed public entrypoint

`launcher/native/owned-worker/src/main.rs` calls public `run_main_with_transport_options` with:

- `LoaderOverrides::default()`: no managed/login requirements bypass or test override.
- Empty `CliConfigOverrides`: no arbitrary wrapper `-c` input.
- `strict_config=true`, default analytics disabled, fixed `AppServerTransport::Stdio`.
- Honest `SessionSource::Custom("nekodex-owned-worker")`.
- `PluginStartupTasks::Skip`, `RemoteControlStartupMode::DisabledEphemeral`, `managed_daemon=false`.
- A Tokio runtime configured with2 worker threads and the upstream public16MiB async thread stack budget; this is not a claim about the library's total thread/memory use.
- Explicit self-executable path, no Linux sandbox/retired wrapper path.

Only no arguments, `--stdio`, static `--build-info`, or the separate fixed `--account-info` classifier are accepted. There is no call to `arg0_dispatch`/`arg0_dispatch_or_else`, no `.env` loading, PATH alias creation, apply-patch/exec/fs helper argv dispatch, selectable listener/remote code-mode host, daemon command, or custom managed-policy escape. An attempted helper re-exec is rejected by the same fixed argv boundary. Compatibility of any legitimate later helper behavior is a separate connected-runtime question; it is not claimed by a passing compile.

Before app-server entry the wrapper requires explicit canonical and distinct HOME/CODEX_HOME/CODEX_SQLITE_HOME directories and a cwd inside that private HOME. It does not inspect or copy credentials. Full path ownership, environment allowlisting, catalog/capability admission, executable/hash validation, and effective-policy checks remain the main owner's responsibilities. Static `--build-info` returns before reading those directories or constructing the app-server/runtime.

The public upstream stdio reader uses `BufRead::lines()` and does not expose a per-line allocation cap. This wrapper does not claim to bound internal child allocation or total child memory. The sole trusted Node owner retains its1MiB write/read caps, request correlation, and lifecycle authority. No FD relays, unsafe descriptor replacement, extra sender/proxy, or TCP listener are introduced merely to restate the parent's boundary.

## Build inputs and ownership

The standalone Cargo root is `launcher/native/owned-worker/`. Its own `rust-toolchain.toml` selects **1.95.0**, matching upstream. All direct Codex dependencies pin the same exact git revision; the classifier also uses the public native config/auth libraries. The manifest repeats the exact upstream root patches for crossterm, tokio-tungstenite, tungstenite and the SSH-source tungstenite redirect because Cargo does not inherit a dependency's root patch table. Tokio1.52.3 matches the inspected upstream lock; the wrapper commits its own resolved Cargo.lock.

Toolchain1.95.0 was installed through official rustup with the minimal profile. The pre-existing global default stable1.99.1 was not changed. The selected Xcode compiler and macOS SDK were found through xcrun; no license was accepted or global compiler configuration modified.

First reviewed lock resolution and DEV build:

```sh
node scripts/build-owned-native-worker.cjs --development --resolve-lock
```

Subsequent builds use the committed lock:

```sh
node scripts/build-owned-native-worker.cjs --development
```

The script builds only `nekodex-owned-native-worker` for the current Mac host target, with at most4 Cargo jobs, development profile/debug information disabled, and requested `MACOSX_DEPLOYMENT_TARGET=13.0`. Requested deployment target is not a measured compatibility result; generated metadata keeps `minimumOSVerified:false`. It runs no upstream tests, release/voice pipeline, V8-host target, app packaging, distribution signing, notarization, install, login or inference.

`launcher/native/owned-worker/{target,build}/` are ignored by the leaf's own `.gitignore`. Cargo git/registry/toolchain caches remain shared and preserved. The script owns one build/owner.lock and never steals a stale owner; reconcile the exact PID/terminal checkpoint before manual recovery. Interrupt signals target only the runner's exact detached Cargo process group. No invented timeout cancels a slow compile.

The durable ignored `build/checkpoint.json` records owner PID/nonce, active Cargo PID, exact source/toolchain/target, phase, log path/bytes, latest progress and terminal result. `build/build.log` retains build diagnostics. Final output lives at `build/<host-target>/nekodex-owned-native-worker` with a sidecar build-info.json containing binary bytes/SHA256, manifest/lock/main hashes and actual resolved package count. Temporary copy candidates are removed; one current output and the reusable task target cache remain. No runnable duplicate .app bundle is created.

## Current build checkpoint

The latest locked offline rebuild completed on 2026-10-18 at 16:59:12 UTC with exit 0 after approximately 4 minutes 20 seconds. It adds the public native-library account classifier and official bootstrap-catalog sidecar. The build checkpoint is terminal; its reusable target remains retained while the current Native batch settles. Earlier successful build/checkpoint and local fake-wire receipts remain historical evidence, not fresh real-account proof.

| Observed artifact evidence | Result |
| --- | --- |
| Output | `launcher/native/owned-worker/build/aarch64-apple-darwin/nekodex-owned-native-worker` |
| Binary bytes | 446,394,224 |
| Binary SHA256 | `835674dd9455f7394ee0992596ad39d03d6872a739afec4afedd7c543a039d64` |
| Own Cargo.lock SHA256 | `7f8aa38db1eb8b1362a612ad0a8a6b2fb3f668fe23c292ec5a3b6ebedaee62bf` |
| Resolved lock entries |1,145 packages;117 `codex-*` crates all matched the exact same admitted git revision |
| Static probe | `env -i PATH=/usr/bin:/bin <exact-output> --build-info` exited0 and returned the expected static Skip/strict/stdio/custom-source metadata with runtime/provider verificationfalse |
| Mach-O header | arm64 executable; `LC_BUILD_VERSION` platformmacOS, `minos13.0`, SDK27.0 |
| Target OS limit | Header13.0 is observed; execution on an actual Mac13 system remains unverified |
| Toolchain | Project1.95.0 installed; global default remains stable1.99.1 |
| Retained generated storage | Current output/metadata and reusable task target retained, both ignored; no app/installer or shared-cache deletion. The earlier 4.08 GiB cleanup is historical, before the classifier rebuild. |

The static probe returned before app-server initialization and without HOME/CODEX_HOME/auth variables. The later connected check used only an isolated fake-provider fixture; no real account login/provider delivery, authenticated startup-policy proof, signing/package/install or release was performed. Keep the build's general `runtimeVerified:false`, `realProviderVerified:false` and `minimumOSVerified:false` flags; the narrowly scoped connected proof has its own receipt.

First resolution produced1,145 packages. The first compile failed before wrapper compilation because a zeroize_derive procedural-macro dylib could not load. A focused rustc import of that exact owned artifact exposed `mis-aligned LINKEDIT string pool`; file architecture and code signature were valid. This matches [Rust issue157750](https://github.com/rust-lang/rust/issues/157750) and [LLVM issue203678](https://github.com/llvm/llvm-project/issues/203678). The DEV profile now explicitly sets `strip="none"`; no toolchain/global config/dependency source was changed to mask the error. Only the exact known failed macro artifact/fingerprint was removed before resuming the same locked build; shared dependency caches were preserved.

The corrected build reached codex-core-plugins, where fresh `zip2.6.1` resolution failed against the pinned source's `ZipFile<'_>` signature. The official source lock useszip2.4.2. The wrapper adds an exact compatibility constraint for2.4.2 and updates only that dependency resolution; no Codex source/fork/vendor patch or full clean is used. The transitive dependency API failure is separate from the previous local Mach-O stripping issue.

## Explicit wrapper admission and connected proof

The trusted-main owned-worker constructor now accepts `executableVariant:'owned-wrapper'` with the existing independently known `executableSha256` and `wrapperBuildPin:{metadataPath,metadataSha256,sourceRoot,sourcePinSha256}`. Stock remains the default variant, with unchanged startup argv and receipt identity. These fields are never renderer input; product composition must obtain them from the reviewed build/packaged manifest rather than automatically trusting whichever local files happen to exist.

Wrapper admission first hashes the binary using1MiB chunks, validates the pinned build metadata, requires its fixed output path and binary identity, compares manifest/Cargo.lock/main source hashes, and verifies the fixed source-pin JSON. Only then does it execute bounded `--build-info` with an empty profile/auth environment and compare exact artifact/version/revision/strict/Skip/remote-control/managed-policy/stdio metadata. Wrapper worker argv is only`--stdio`; there are no generic argv hooks or config bypasses. The original fixture `official-openai` route still reports `official_policy_preflight_unverified` before any probe/profile/worker creation. It is distinct from the new trusted inventory → qualified-account admission → execution owner route; the latter requires actual private-profile identity/usage/catalog proof and currently has no real admitted rows.

Current reviewed DEV pins, in addition to the binary SHA above:

- Build metadata SHA256: `c36b1fa061944512c106db652258489f12087c09f4c2fdbecdd49e91f7f3332f`.
- Source-pin JSON SHA256: `3b5bc45bbbd6c5170c4786b63276837d8fe1eaf4339c1a90aa13d5b2e61c3fcc`.

One new focused gate case passed7 assertions: changed executable, startup-option metadata and source pins all reject before an inert executable can reach its static probe or create an authority profile. The shared local fixture was adapted with an explicit variant flag rather than duplicating its ordinary flow; the old stock case was not repeated.

```sh
node tests/fixtures/owned-native-worker-local.cjs /absolute/reviewed/nekodex-owned-native-worker --owned-wrapper
```

The actual wrapper check finished at13:37:36UTC in about5.7seconds:

```json
{"proof":"owned-wrapper-0.163-local-fake-only","realOpenAI":false,"realAccountAuth":false,"toolsExactlyEmpty":true,"canonicalMessages":4,"nativeTimestamps":true,"sameThreadContinuation":true,"ownedChildCount":1,"providerRequests":3,"unknownWithoutReplay":true,"structuredOutput":{"answer":"local first"},"nativeUsage":{"totalTokens":10,"inputTokens":7,"cachedInputTokens":0,"cacheWriteInputTokens":0,"outputTokens":3,"reasoningOutputTokens":0}}
{"ownedChildClosed":true,"listenerClosed":true,"privateStateRemoved":true}
```

It verified actual serialized tools=[], fixed schema, nonempty exact canonical IDs/timestamps and automatic-host input authorship, same-child/thread continuation and held unknown/no replay after a deliberately filtered third-turn ACK. All provider requests reached only the task-owned loopback server, using the fixture's dummy bearer value. No real credentials were read/copied, no existing thread was adopted, and no installed app was launched. The current helper/build metadata and the scoped `build/connected-proof.json` receipt were retained.

After the original connected boundary passed, the earlier task target (approximately 4.08 GiB) was removed with the then-current executable retained. The classifier source change justified the later rebuild above. The current target is retained to avoid another unnecessary full compile; the original local fake-provider proof is reused only for unchanged protocol behavior.

## Account classifier and catalog resource

`--account-info` returns before app-server construction. Public `ConfigBuilder` and native auth loading classify only `type`, `planType`, `usesCodexBackend` and `classification` with a schema version; no email, principal, token or auth content is returned. Initial admission requires exact personal Pro. Generic stored PAT/agent auth can otherwise cause native loader network access, so the owner must execute this branch with both network and process-fork denied, using the exact private environment. A successful classifier does not prove cloud policy, available models or inference.

The actual current arm64 binary was run with an empty disposable private profile under that macOS sandbox: exit 0, `unauthenticated`, empty stderr, and no auth/cache creation. The profile was removed. This is a real binary/sandbox empty-profile check, not a signed-in-account check.

The builder copies the actual pinned official `codex-rs/models-manager/models.json`: 472,072 bytes, SHA256 `943ca7fe1d19ed019054158303f0dbbd80b3bef43b3aa425a71aa7cb3fb52c2b`. Build metadata binds this `officialBootstrapCatalog` resource. It is bootstrap-only; account availability must come from the own-profile online inventory and fresh native cache. The reviewed DEV pin module binds binary, build-metadata and source-pin hashes. A packaged production manifest and real-provider verification remain separate work. *Status 2026-10-21: both now exist. Local builds sign a copy of the pinned worker and write `production-manifest.json` beside it (`launcher/scripts/prepare-runtime.cjs`), and Native sign-in and inference on the official account passed in installed `.13`.*

## Subsequent actual typed-image transport proof

The current retained wrapper was run once through the local fixture with
`--owned-wrapper --images`: exit 0 in 653 ms, one child and two fake-provider
requests (first text, then two images). Exact Native IDs/timestamps and canonical
image metadata were observed. A third cumulative image was refused before any
new provider send. Finally the exact child/listener/temporary profile closed.
This is a new actual wrapper wire check, separate from the historical three-request
text-only receipt above. It uses loopback/dummy auth only, not real OpenAI/login.

No Rust rebuild is claimed for this image batch. Fixed high-detail data URLs have
strict typed echo; ambiguous remote file-ID/media omission retains unknown without
replay. The durable binding budget is two images/160 KiB across offers, including
unknown outcomes. Longer vision loops and real file-upload correlation remain
unverified. Whole Bun/ToolJournal/private HTTP/main image integration passed1/40 with a fake
physical leaf. Image source gates passed: rootTS18:30/rendererTS18:29, renderer195/plainCLI638
exact `.9` and final module-map/paths at18:32. Source commit/CI remain pending. See [image evidence](../reviews/2026-10-18-owned-native-images.md).

Status 2026-10-21: the image batch was committed as `70ffe3b` and reached `main` with
the adoption stack (`296addd`, CI passed). Real-account Native image input later
passed in installed `.13`; see the status note in
[owned Native image input](../design/owned-native-images.md).

## Primary pinned references

- [Public runtime options/entrypoint](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server/src/lib.rs#L460-L509), [plugin-startup option use](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server/src/lib.rs#L1003-L1010).
- [Public Arg0DispatchPaths](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/arg0/src/lib.rs#L25-L36), [arg0 helper/dotenv paths deliberately not reused](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/arg0/src/lib.rs#L59-L134).
- [SessionSource custom](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/protocol/src/protocol.rs#L2945-L2959), [RemoteControlStartupMode](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-transport/src/transport/remote_control/mod.rs#L78-L84).
- [Upstream toolchain](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/rust-toolchain.toml), [root patches](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/Cargo.toml#L641-L652), [async stack budget](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/async-utils/src/lib.rs#L8-L9).
- [Upstream stdio reader](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server-transport/src/transport/stdio.rs#L66-L78), [account-login warmup ordering](https://github.com/openai/codex/blob/83086188ae0614bd882818ff1aa23f3194962012/codex-rs/app-server/src/request_processors/account_processor.rs#L929-L986).

Expanded pre-implementation research is retained at `/Users/alex/Documents/ChatGPT/Nekodex/reviews/owned-native-official-admission-20261018.md`.
