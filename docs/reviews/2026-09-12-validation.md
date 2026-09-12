# September 12 validation checkpoints

## Installed 5.1.0-froraut.4

The current installed candidate is **5.1.0-froraut.4**, published in
[`e4f4560`](https://github.com/Froraut/codex-chatgpt-web/commit/e4f4560d7fa2c66448f7af21b78f153010d9421c).
It adds the narrow native file-selection recovery described in
[existing Chrome sign-in](../existing-chrome-sign-in.md). Its local validation passed:

- 47 focused core tests, 265 assertions, and 231 launcher tests.
- Both typechecks, version consistency, and renderer/runtime builds.
- Native packaged startup and relocated runtime smoke.
- The native launcher visibility check with animation frames disabled.

The installed archive and ASAR matched the build, and Settings visibly reports the new version.
The native picker opened in Chrome's expected directory after the real automatic discovery
denial. At the **11:05 UTC** checkpoint, user selection of `DevToolsActivePort` and the native
file grant were still pending. No real session transfer or embedded authentication is recorded.

- ZIP SHA-256: `0e7f331db555852e85e2ba88bf9a6a2bd23d10f9656f0c13fb26a32003d02961`
- Installed ASAR SHA-256: `2625bad942f39cde35ca6dc6162f2be35f77a60b64daa62ce8526c25ef737e1c`
- Runtime bundle: `1de1a09389d9c13b8d8579dc3489a684817a0580e7a8a8c89324d2145b1754fc`

[CI run 34689690042](https://github.com/Froraut/codex-chatgpt-web/actions/runs/34689690042)
passed on macOS and passed actionlint, but failed on Linux and Windows due to three distinct
CPU-heavy test timeouts. The two packing/planning cases repeatedly tokenized 450,000-character
homogeneous whitespace records; a Windows compaction case used homogeneous 160,000-character
records. The logs showed deadline failures, not failed behavioral assertions. The affected
fixtures now use short separated runs while retaining their byte sizes, full record/order
comparisons, expected partition counts and unchanged deadlines. The independent pathological
tokenizer regression remains present. The four affected suites passed locally: **161 tests,
1,365 assertions**, with the three previously slow cases taking 1.60 s, 1.14 s and 0.05 s in
that run. Root TypeScript and scoped diff checks also passed. These are test-data corrections;
the installed pre4 runtime is unchanged. The failed run is not recorded as a cross-platform pass.

The installed build remains ad-hoc signed. Developer ID signing, notarization, live session
import, installed Codex/MCP execution, and a signed public binary release remain separate gates.

## 5.1.0-froraut.3

This candidate includes the [September 12 upstream fixes](2026-09-12-upstream-triage.md),
safe existing-Chrome error codes, bounded/cancellable login handoff, and visible recovery UI.

The actual installed 5.1.0-froraut.2 failure exposed two independent boundaries. Its private
helper failed quickly, but the renderer kept its old consent screen. After a renderer reload,
native DevTools inspection showed the rendered app shell and error toast both held at inline
`opacity: 0`. The error text existed in the DOM. Core UI visibility no longer waits for those
animations; an offline native Electron test disables every animation frame and verifies the
shell, error, Dismiss, Chrome Retry, navigation and onboarding controls.

Local `bun run verify` passed with Bun 1.4.0 on macOS arm64:

- 982 core tests passed; one Windows-only test skipped.
- 509 launcher tests passed; one Linux-only test skipped.
- Both TypeScript checks and dependency audits passed (106 core and 351 launcher packages).
- Version consistency, renderer/runtime/license builds and relocated runtime smoke passed.
- The native macOS ZIP/DMG built and passed packaged startup smoke and strict deep signature
  verification. This remains an ad-hoc local signature, not Developer ID or notarization.

The candidate was installed with a private backup of the previous app and its own profile.
Settings visibly reports 5.1.0-froraut.3, and page switches now render immediately. A new import
attempt returned `chrome-profile-access-denied` with working recovery controls. It did not
reach Chrome cookie transfer or prove account authentication.

On the tested macOS 27 build, the process was denied access to Chrome's connection descriptor.
Chrome's remote debugging setting was already enabled. Apple's macOS 27 release notes describe
new default-denied app-data restrictions; the exact OS policy behind this file's denial is not
identified by the safe error code alone. Do not reset TCC, disable protection, or use another
privileged process to copy browser data as an implicit workaround. An explicit native file
selection grant is a separately testable, narrower recovery path. [Apple release notes](https://developer.apple.com/documentation/macos-release-notes/macos-27-release-notes)

Installed artifact identities:

- ZIP SHA-256: `6e42d311ed51c6124df566ebba3db4a5d2d51f99d4cded6e09c8f241753a2121`
- ASAR SHA-256: `f0dd7df6b8b5d88e7f6136c27f49e3dc33ecfeeb77965f880ea118a7e9b65159`
- Runtime bundle: `a797822e38e461a177ad263fb14364c6d59616c6077075a7e36411f611a14cab`

Live session import, installed Codex/MCP execution, Apple notarization and a signed public binary
release remain separate gates. Source tests and startup checks are not substitutes for them.
