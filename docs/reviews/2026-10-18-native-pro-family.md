# Native personal Pro variants — 18 October 2026

An actual isolated official CLI sign-in completed on 18 October 2026. The browser
reported `Signed in to Codex`, and the application recorded `signed-in-checking`
after the CLI completed and private auth-file metadata was present. Credential
contents were not read, copied or hashed by the parent.

The subsequent network-denied official-library classifier reported `promax`.
Our original literal `pro` gate rejected that known variant. The pinned public
Codex source defines `Pro`, `ProLite` and `ProMax` separately and groups them as
the Pro family. The classifier, inventory and execution admission now accept
only those exact personal variants. Account evidence keeps the actual plan
value; it is not rewritten to `pro`.

The change does not admit Plus, unknown plans, team/business/enterprise routes,
API-key authentication or paid-credit fallback. Stable account identity,
`ordinaryUsageAllowed`, native account ID, effective policy, auth metadata and
catalog provenance remain independent requirements.

## Evidence

- The focused family case passed 116 assertions: `promax` and `prolite` traversed
  fixture inventory and real admission code with their actual values; unsupported
  families and a relabeled account were rejected. Existing unchanged checks were
  reused.
- The development Rust wrapper built successfully with the existing offline
  locked source and Rust toolchain. The reviewed executable SHA-256 is
  `b1ba58f72cd46caa3d69018bbbb68c2b8afb85dfb9167bba69272dde716a30d6`.
  Build metadata SHA-256 is
  `7ceee884e7992d369105929f646d3e71b01b1b02e5e5d545d0bfdda4e15dccc3`.
- A new network-denied classifier run against the already authorized isolated
  profile returned `classification: personal-pro`, `planType: promax`,
  `type: chatgpt`, `usesCodexBackend: true` and exit zero.
- Both TypeScript projects passed. The explicit reviewed development pins were
  updated to the completed build and `reviewedOwnedNativeDevPin` verified them.

The first post-build inventory attempt correctly refused stale reviewed binary
pins before starting an account server. Its failed receipt is retained. A new
build is never adopted merely because it appears in the build directory.

The computer then required resource recovery and authorization remained saved.
After recovery, a new inventory action qualified the same profile and both
admitted models returned real results. See the separate
[real-model and history evidence](2026-10-18-native-real-models.md), including
its exact task-completion and cleanup limits. This remains source/development
evidence, not installed `.9` delivery.

Primary implementation: pinned Codex `83086188ae0614bd882818ff1aa23f3194962012`,
`codex-rs/protocol/src/account.rs`, `codex-rs/protocol/src/auth.rs` and the Pro
family handling in `codex-rs/protocol/src/error.rs`.
