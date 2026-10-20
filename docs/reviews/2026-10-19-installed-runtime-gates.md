# Installed macOS runtime gates

The local `.10` application and durable runtime passed the macOS integrity inspector. The actual installed production CLI then exposed a different boundary: VM preparation refused admission before starting any guest. The runtime passed an inline publisher requirement to `codesign -R` without its required leading `=`. macOS treated that argument as a requirements file name. Read-only checks against the same installed app and helper returned exit 1 with the old argument and exit 0 with the corrected inline argument. The shared verifier now fixes both app and helper checks while retaining the Apple anchor, exact identifier, publisher team and remaining artifact checks.

The `.10` GUI also demonstrated the supported deferred-update state: it adopted the still-serving `.8` core, whose active requests must remain intact. New Agent panels previously rendered raw HTTP 404 errors against that older API. The renderer now explains the actual application and committed runtime versions. Main IPC fences new core-dependent work until the existing runtime owner completes its safe switch. Existing reads, retained receipts, exact pause/stop, cancellation and revocation remain reachable through owned-runtime checks. Main-local Native account closure, OAuth, remote revocation and retained exports remain mounted and unchanged. An actual old-core HTTP 404 becomes a versioned pending message; no success or retry is invented.

Validation before the final `.11` build:

- Two focused IPC cases passed with 56 assertions covering old-owner cleanup, new-work refusal, owner readiness, 404 without retry, preserved 409 and main-local controls.
- Renderer TypeScript, changed CJS syntax and scoped diff checks passed. No broad local test suite was run.
- The real app/helper publisher checks confirmed the corrected `codesign` argument.
- The isolated `.10` production main and core were drained and closed; the reused task-owned DEV configuration was restored byte-for-byte. Credentials were neither copied nor read. Native login in the ordinary installed profile remains postponed by the user.

Installed `.11` admission and UI observations are recorded separately after delivery. A successful package inspector or prepared VM environment does not establish a VM boot, task-bound execution, final result verification or completed authentication.
