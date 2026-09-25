# Claude change review and local update readiness

Reviewed range: `1525595..f3cf75c`, including usage, Native request handling,
launcher UI, runtime ownership, and the explicitly requested removal of automated
test suites. The deleted suites were not restored.

Four independent reviewers ran: two `gpt-6-sol` and two `gpt-6-luna`, all at medium
reasoning effort. Their actual turn metadata confirmed these model identities.
The scopes were lifecycle/browser ownership, Native/persistence, renderer/usage,
and test-removal integration. The parent coordinated one focused verification plan.

## Findings and disposition

- Fixed: tiny nonzero completion rates were clamped to 0.1%, materially overstating
  sufficiently small values. The UI now shows localized `<0.1%` or `>99.9%` when
  normal rounding would produce a false endpoint; exact 0% and 100% remain exact.
- Fixed: all Native body-preparation exceptions became HTTP 400. Body validation
  now emits typed client errors; unknown stream/internal errors and cancellation
  propagate. Malformed JSON, UTF-8, known zstd data errors and invalid local
  checkpoints remain 400, size limits 413 and unsupported encoding 415.
- Clarified: two retained design/integration documents contain historical test
  commands and results. Notes identify the removal revision and distinguish this
  evidence from currently runnable verification.
- No confirmed new regression in the changed runtime-owner preservation or
  browser logging paths. The changed repository skill was reviewed under
  `astra-skill-authoring`; its focused DEV/manual guidance matches the removal.

## Development evidence

- Root and renderer TypeScript checks, renderer build, version synchronization,
  architecture map/path check, and `git diff --check` passed. No general suite ran.
- A bounded Native probe returned 401 for missing auth, 400 for malformed JSON,
  invalid UTF-8 and invalid zstd, 415 for unsupported encoding, and 413 for declared
  oversize. An incoming stream I/O error propagated unchanged. None called upstream.
- A temporary-file probe preserved replacement bytes and POSIX mode 0600.
  Nullable optional token details preserved known totals. Web CSV incomplete
  counts remained blank and Native counts retained explicit zero. Boundary rates
  and 59.96-second unit rollover produced the expected localized values.
- A separate Sol probe used the real supervisor with an isolated config and live
  probe-process PID: mismatched versions returned `needs-setup` while all 145 bytes
  of the existing ownership record remained unchanged.
- Source Electron ran with a new isolated DEV profile and no copied credentials.
  Its real Settings controls switched the interface to Russian through IPC.
  The renderer preview exercised logout confirmation/cancel, expanded usage
  details, and Web-to-Native filter switching with synthetic data.
- Sol independently counter-reviewed the rate fix; Luna counter-reviewed the
  final Native classification fix. These source checks do not establish live
  ChatGPT login, provider response, or account-side connector execution.

## Delivery boundary

Before this task's installation, `/Applications/NEKODEX.app` was version
`6.0.0-nekodex.1`, signed with Developer ID and notarized. Its live daemon still
reported `5.9.0-nekodex.5`, with active Native work on port 17841. Disk version,
running launcher, committed runtime configuration, and a real response must be
checked separately during handoff. Preserve the active route and account state.

This report records source/development readiness. Installation and any signing
or notarization outcome must be recorded separately after they actually finish.

## Installed result and retained runtime

The local application built from `58139fa` was Developer ID signed, accepted by
Apple under submission `0289f1f4-4350-419e-8c44-b94336deb1c4`, stapled, and accepted
by Gatekeeper. The existing transactional updater installed it and committed
after replacement-launcher readiness. The installed runtime bundle ID is
`fa0a873e5f550cebf8a6ccccfe8e14eef8ddbdfcf44e3474ed93b52b96c174b9`.
Its build metadata records `dirty: true` because the local dependency symlinks
were untracked; tracked application source was clean at the recorded commit.
This is a local app update with the existing `6.0.0-nekodex.1` version marker;
no release tag, DMG or public release assets were created.

Runtime activation is **not complete**. The production Restart action retained
the old daemon while Native HTTP work was active. A supported non-cancelling
Stop connections and quit attempt also refused after its idle-drain timeout,
then resumed admission. Following explicit consent, the UI acknowledged
cancelling one HTTP stream; another restart still found active work. After the
user reported that the connection worked again, the pending guarded cancellation
observer was terminated before it performed another cancellation or launch.

The final observation was daemon `5.9.0-nekodex.5`, PID `26835`, accepting requests
and not draining. This distinguishes the working existing route from activation
of the new backend. No update or cancellation worker remains scheduled. The
previous application and private state snapshots are retained locally for rollback;
no account credentials or profile data were copied into the application bundle.
