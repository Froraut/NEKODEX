# CI-built macOS arm64 releases with accepted Native inputs

Status: implemented in this change; the transport release is not published yet and the
release workflow has not been dispatched with it (both need the owner's go-ahead).

## Problem

Since the owned-native and execution VM adoption (#96–#98), a macOS arm64 package embeds two
reviewed local builds that are not in git:

| Input | Fixed layout | Why it is not rebuilt in CI |
|---|---|---|
| Owned Native worker (Codex 0.163.0 wrapper, 446 MB) + `build-info.json` + official bootstrap catalog | `launcher/native/owned-worker/build/aarch64-apple-darwin/` | A Rust build of 1,145 crates. The output is not byte-reproducible, and the accepted build is the one the acceptance evidence covers. |
| Execution VM guest (`manifest.json`, kernel `Image`, `initrd.gz`, provenance) | `launcher/native/execution-guest/.build/bundle/` | An Alpine/Go image build with live package capture; same reasons. |

`release.yml` therefore failed at `build:runtime` on `macos-15`. The worker admission also
bound packaging to one checkout: `reviewedOwnedNativeDevPin` requires the `executable` path
recorded in `build-info.json`, which is `/Users/alex/Dev/nekodex-cos-adoption-20261018/...`,
to equal the current one. That receipt's digest is pinned, so the path cannot change. Release
6.1.33-nekodex.1 had to be built locally and signed offline (`buildType: local`). The
installers accept only `github-actions` metadata.

## Decision: pinned inputs fetched by CI (option a)

Rebuilding in CI (option b) would produce new, unreviewed bytes on every release and would
add a long Rust and VM image build to each run. Instead:

1. **Lock in source.** [`launcher/native/release-inputs.json`](../../launcher/native/release-inputs.json)
   pins each input file by name, path, size and SHA-256. The worker entries must equal the
   reviewed development pin (`REVIEWED_OWNED_NATIVE_DEV_PIN`). A test enforces this, so the
   development runtime and release packaging accept the same build. The tag name is content
   derived: `native-inputs-<worker sha256[:8]>-<guest manifest sha256[:8]>`.
2. **Transport release.** The same files are published once as assets of a prerelease with
   that tag in `Froraut/NEKODEX`, marked not-latest. The release adds no trust: CI verifies
   every byte against the lock in the reviewed commit before writing anything. The bytes are
   already public inside every arm64 app since 6.1.33, and the guest's GPL provenance files
   (`kernel.config`, package provenance) ship alongside them. The installers and the in-app
   updater ignore the release because it has no `codex-web-gpt-*` asset and no version tag. The
   release workflow does not trigger on it, because the tag does not match `v*`.
3. **CI fetch.** On `macos-15` only, `node scripts/native-release-inputs.cjs fetch` runs before
   packaging, using `GH_TOKEN` = `github.token` with the job's existing `contents: read`. It
   downloads into a private temporary directory, checks sizes, digests and the exact asset
   set, then copies the files into the fixed layouts with `O_EXCL`. The worker is mode 0755,
   everything else 0644. Files that already exist must already match the lock.
4. **Path-independent packaging admission.** `prepareOwnedNativeRuntime` now uses
   `acceptedOwnedNativeInput`, which applies the same pins as the development receipt:
   - executable, receipt and source-pin digests;
   - `WRAPPER_INFO` policy, target, size and the `sha256` binding;
   - `Cargo.toml`, `Cargo.lock` and `main.rs` against the checked-out tree;
   - the bootstrap catalog digest;
   - the static `--build-info` probe, run only after every byte pin passes.

   It drops only the equality between the receipt's recorded `executable` and catalog paths and
   the current checkout. The production manifest already records hashes only. The shipped
   `build-info.json` keeps its original bytes, including the historical path string, because its
   digest is the receipt pin.
5. **Guest admission.** `prepareExecutionVmRuntime` now requires the guest `manifest.json` to
   match the lock. It also requires every file in the manifest's `sourceSha256` closure to match
   the checked-out `launcher/native/execution-guest/` sources. Before this, any guest bundle whose
   kernel and initrd matched its own manifest was accepted.
6. **Installer default.** `install-launcher.sh` lists the candidate releases that have the
   platform asset. It reads each candidate's `release-metadata.json` payload and skips
   `buildType: local` builds (6.1.33-nekodex.1 for macOS arm64), so it takes the newest GitHub
   Actions release. Unreadable metadata fails instead of falling back. An explicit
   `CODEX_WEB_GPT_VERSION` still selects a local build; on macOS only the Developer ID checks apply
   to it, and on Linux the metadata verifier still refuses it. Selection reads unverified bytes;
   every existing trust check is unchanged.

Not changed: the trust root, the metadata format, `publish-release.cjs` (it already requires
`github-actions` from the same run), `install.sh`, the Intel, Linux and Windows legs, and the
development profile's `reviewedOwnedNativeDevPin`.

## Verified locally (2026-10-21)

All checks ran in a fresh worktree of `origin/main`, using the accepted files from the
6.1.33 build checkout:

- `verify --from <accepted checkout>` matches all 10 lock entries.
- `fetchReleaseInputs` with a local copy as the downloader fetches 10 files. A second run
  fetches 0.
- `acceptedOwnedNativeInput` passes from the relocated checkout, including the real
  `--build-info` probe, and so does `assertAcceptedExecutionGuest`.
- `prepareExecutionVmRuntime` and `prepareOwnedNativeRuntime` ran into a scratch app directory
  with the Developer ID identity. The Swift helper was compiled and signed, and the worker copy
  was signed. The production manifest has `buildInfoSha256` 7ceee884… and
  `unsignedExecutableSha256` b1ba58f7…, the accepted pins.
- Against live GitHub, `install-launcher.sh` on this Mac skipped 6.1.33-nekodex.1 and requested
  the 6.1.28-nekodex.1 arm64 ZIP.
- `tests/native-release-inputs.test.ts` (in the CI Linux job) covers the lock and its
  consistency with the development pin, fetch rejection and idempotence, the guest source
  closure, and installer selection with offline shims.

Not verified until a dispatch: Swift compilation with the `macos-15` runner's Xcode, gh asset
download speed, and notarization of the full app in CI.

## Runbook

Publish the transport release once (owner action; it creates a public prerelease). Run it
from a checkout of this commit; `--from` names the checkout that holds the accepted files:

```bash
node scripts/native-release-inputs.cjs publish --from /Users/alex/Dev/nekodex-cos-adoption-20261018
```

This stages verified copies, creates a draft, compares GitHub's reported digests and sizes with
the lock, and only then publishes it as a not-latest prerelease. It refuses an existing tag.

Release dry run (owner action): push the next version tag as usual, then run
`gh workflow run release.yml --ref v<version> -f platform_scope=macos`. The `macos-15` log shows
`{"fetched":10}` before `build:runtime`.

When the worker or guest is rebuilt and accepted, update `REVIEWED_OWNED_NATIVE_DEV_PIN` and
the lock together, rename the tag from the new digests, and publish a new transport release.
The old one is never overwritten. Older tags keep building from their own lock.
