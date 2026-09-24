# Lane 14 — runtime supervision, updates and storage

Baseline: `53d17361f3e9c81910055a7e2c18759ffce458bc` (HEAD confirmed). Read-only source review; only this report was written. **No tests run**, no builds, apps, updater, installation, provider/account operations or agent dispatch. Applied `right-size-test-runs`; verification below is proposed for the implementation wave, with parent-owned integration/build/UI planning.

Read the relevant completed-work sections in `app-improvements-20260922.md`, `app-improvements-wave3-20260922.md`, and `app-improvements-waves4-5-20260922.md`. Failed-Quit supervision recovery, guardian-start compensation, durable rollback/relaunch fencing, commit-versus-cleanup distinction, and download telemetry freshness are already implemented; they are not new findings here. Source, rather than those reports' historical test counts, grounds the recommendations.

## 14-runtime-updates-F1 — Extract the runtime configuration contract from supervision

**Type / priority:** bounded architecture improvement, P2. No new runtime malfunction claimed.

**Evidence:** `launcher/electron/runtime-supervisor.cjs:210-344` embeds configuration normalization, DEV/production authority, platform endpoints, model/capability validation, and active-tunnel identity inside a 3,046-line process supervisor. `:490-518` separately implements strict runtime loading and deliberately more permissive setup loading, duplicating profile policy. `:84-95` supplies path/pipe identity helpers. Every future configuration field currently requires touching the same file that owns start, drain, recovery, monitoring and shutdown.

**Callers checked:** `readConfig()` feeds supervision and runtime generation recovery; `runtime.cjs:1580-1588,1625-1674` depends on strict validation after staging and before ownership-sensitive stop/restart. `readSetupConfig()` intentionally accepts the legacy `pro-only` spelling for setup. `runtime-supervisor.test.cjs:128-178,242-277` directly imports the existing exported `validateConfig`, including return-identity and Windows/DEV checks. These are distinct contracts, not candidates for one permissive validator.

**Concrete change:** create `runtime-config-contract.cjs` containing the existing strict validator and a separately named setup-config normalizer/profile validator. Keep disk reads, errors tied to filesystem paths, process actions and lifecycle decisions in the supervisor. Retain its `validateConfig` re-export so callers need not migrate. Preserve defaults, return identity, error semantics, active-tunnel checks and exact accepted inputs. Do not replace the current tunnel comparison or broaden compatibility while extracting. Keep `absolutePath` available for the supervisor's health-file check at `:1247` (a local helper or explicit import); do not accidentally remove that non-config consumer.

**Benefit:** configuration extensions acquire one discoverable boundary without coupling them to recovery machinery. Setup compatibility remains visibly separate from authority to run a daemon. This is a useful first reduction of mixed responsibilities, not a wholesale supervisor rewrite or generic state-machine framework.

**Write set:** `launcher/electron/runtime-supervisor.cjs`, new `launcher/electron/runtime-config-contract.cjs`, and a small new `launcher/tests/runtime-config-contract-focused.test.cjs`. No changes to `runtime.cjs`, main-process lifecycle orchestration, core setup producers or account policy. Coordinate any new config field from other lanes through this owner.

**Smallest verification:** selected existing strict-validator cases plus one setup compatibility/rejection case; explicitly preserve DEV/production refusal, descriptor ownership, Windows pipe handling and active-mode mismatch. Maximum **30 seconds per focused invocation**. No process launch is necessary.

## 14-runtime-updates-F2 — Separate authenticated preparation from update control and handoff

**Type / priority:** bounded architecture improvement, P2.

**Evidence:** `launcher/electron/update.cjs:434-565` owns discovery/check state, while `:568-718` combines preparation lifetime, metadata authentication, cache management, extraction, staging validation, helper copying, worker launch and cleanup. `:720-735` implements cancellation against that shared closure; `:739-764` handles the fundamentally different failed-Quit compensation. Adding preparation steps currently requires reasoning about all these responsibilities simultaneously.

**Callers checked:** `launcher/electron/main.cjs:1623-1626,1639-1670` owns IPC, lifecycle admission, active-turn gating, quit, and compensation via `cancelInstall`. `update-preparation.cjs:43-266` already owns extraction-process cancellation/exit proof; it is not an unused generic preparation module. Worker recovery is a separate protocol and is copied explicitly by `update.cjs:643-645`.

**Concrete change:** extract the authenticated staging sequence (`:590-662`) to `update-staging.cjs`, with explicit selected-release identity, dependencies, abort signal and progress callback. Its result should contain only a validated job/worker path and owned staging root. Give it cleanup responsibility before successful return, preserving the existing `preserveStaging` behavior when extractor exit is unproven. After return, the controller owns cleanup and handoff. Keep the final `setImmediate` cancellation opportunity, `handoffCommitted`, status publication, worker launch and cancellation settlement in the controller. Keep discovery and failed-Quit compensation there as well. Document this ownership transfer next to the result contract instead of adding another mutable pending/controller state.

**Benefit:** future download/staging improvements gain a cohesive module and explicit resource ownership. The controller becomes readable as lifecycle orchestration. Reuse existing extraction primitives; do not turn `update-preparation.cjs` into another mixed-responsibility file.

**Write set:** `launcher/electron/update.cjs`, new `launcher/electron/update-staging.cjs`, new `launcher/tests/update-staging-focused.test.cjs`. Keep worker/recovery/validation files and their copied-helper manifest unchanged; the new staging module runs only in the launcher, not the detached worker. Main/renderer contracts remain unchanged. This write set is coupled to F3 and must have the same owner.

**Smallest verification:** one valid fixture reaching mocked worker handoff exactly once, one cancellation during preparation with owned-temp cleanup, and one unproven-extractor-exit case preserving staging. Reuse selected existing `update.test.cjs` authentication/handoff cases rather than rerunning all updater/OS recovery tests. Maximum **30 seconds per focused invocation**; stub network, extraction and worker launch. Assert the intended boundary was reached before injecting failure.

## 14-runtime-updates-F3 — Make cache and staged-asset hashing cancellable

**Type / priority:** source-confirmed responsiveness/cancellation defect, P2; elapsed user-visible delay has not been measured.

**Trigger / evidence:** an update asset can be up to 1 GiB. `update.cjs:290-304` hashes with a synchronous `readSync` loop, wired as the production dependency at `:372-378`. The cached asset is verified synchronously at `:609`; the copied staging asset is verified synchronously again at `:626`. These calls execute from the Electron main-process install handler (`main.cjs:1639-1648`). The cancel IPC handler (`:1623-1626`) therefore cannot run while either loop is reading/hashing. Abort checks before/after the calls do not interrupt them. A large asset or slow disk stalls cancellation and other main-process work until hashing returns.

This is distinct from the already-fixed download hashing deadline: `resumable-download.cjs:98-112` uses an abortable streaming pipeline, but those two controller checks do not use it. The current authentication ordering remains correct; this finding does not claim an unverified asset can install.

**Concrete change:** introduce one abortable streaming file-digest helper, await it for both checks, and pass the existing preparation signal. Reuse it in the resumable downloader's digest step while retaining its existing overall deadline, network-idle separation, exact-byte check and promotion ordering. Keep validation of both cached and copied bytes; do not optimize away either check. Preserve cancellation classification, owned-temp cleanup and resumable cache retention. Async conversion must update injected digest dependencies and their callers together.

**Write set:** same owner as F2; additionally new `launcher/electron/update-asset-hash.cjs`, `launcher/electron/resumable-download.cjs`, and focused hash coverage in `update-staging-focused.test.cjs` (plus only affected existing fixtures if needed).

**Smallest verification:** a controlled slow stream proves hashing has started; schedule cancellation on a subsequent event-loop turn and assert rejection before remaining bytes are supplied, stream disposal, no extraction/worker handoff, and retained valid cache. Include one matching and one mismatching digest case. Maximum **30 seconds**; tiny fixtures, no 1-GiB benchmark. Parent may inspect cancel responsiveness in an isolated development UI later; this lane does not launch it.

## Ownership and limits

Assign one lane-14 implementation owner to F1–F3; F2/F3 must not be split between simultaneous writers of `update.cjs`. Proposed new files are bounded lane-local contracts. Parent owns acceptance, cross-lane integration, build/UI checks, Git and publication. Main-process admission/UI lanes should preserve the existing updater API and leave its implementation here.

No additional change proposed for atomic storage, launcher state, window persistence, startup recovery or updater transaction journals on the evidence reviewed. Do not merge their differing durability/failure contracts merely to share a writer. Runtime-generation recovery also retains its existing candidate-ownership-before-stop ordering. This is a targeted source review, not proof of all crash interleavings or installed-release behavior.
