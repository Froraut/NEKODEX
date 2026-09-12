# 5.1.0-froraut.3 validation checkpoint

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
