# Transactional launcher updates

The automatic updater authenticates `release-metadata.json` with the release public keys
packaged in this fork, then requires the selected asset's exact signed byte count and SHA-256
to agree with the release API and `checksums.txt`. Repository ownership, maximum download
size and total request/download deadlines remain enforced. Discovery includes this fork's
`froraut.*` prerelease channel; a stable build does not opt into another prerelease channel.

Before the running launcher exits, the updater extracts the authenticated asset and validates
the staged application. Validation reads bounded ASAR/package metadata and checks the exact
version, package name, repository, entrypoint, renderer and runtime files. It verifies the
runtime manifest and both Electron and Bun's native platform/architecture headers. macOS
additionally requires the expected bundle identifier/product identity. Essential files cannot
escape the staged directory through symlinks. These checks inspect metadata and native file
layout; they do not establish that arbitrary future application logic is correct.

Windows automatic updates use the ZIP artifact rather than running NSIS over an active
installation. The NSIS installer remains available for installation. The updater preserves
the existing `Uninstall Codex Web GPT.exe` so the existing uninstall registration continues to
work; it does not run the uninstaller or change installer registry state during replacement.
Linux stages a separate version directory containing its own AppImage runner and retains the
old version/runner. It changes only the stable launcher wrapper during the switch.

## Replacement, readiness and recovery

The detached worker copies its runtime and recovery helpers into a private durable directory
beside the installation (beside the stable wrapper on Linux). A journal is flushed before each
replacement operation. The old application or wrapper is renamed to an adjacent backup and
kept intact while the replacement starts. The rename operations remain on one filesystem.

A separate supervisor must receive durable authorization before it can launch the replacement.
Its PID and OS process birth identity are recorded before authorization, closing the interval
where worker termination could otherwise leave an untracked replacement running. A separate
guardian waits for worker termination and recovers unfinished operations. Recovery uses an
exclusive ownership lock and verifies process birth identity before terminating the replacement;
a recycled PID is never sufficient authority to terminate a process.

The replacement signals readiness only after its main renderer loads, browser-control/host
bootstrap completes, and the packaged core runtime executes `--version` successfully with the
expected version. The proof includes a one-use private nonce, version, platform, architecture,
process ID and installed-package path. The worker verifies this proof and requires the
replacement and its supervisor to remain alive for a grace period. Only then does it flush a
commit record and release the old backup. Failed launch, missing/invalid proof, startup failure,
or early process exit stop the replacement, restore the exact previous files, and relaunch it.

Before modifying an installed file, the worker also registers a temporary recovery entry for
the next user login: a macOS LaunchAgent, a uniquely named Windows HKCU Run value, or a Linux
XDG desktop autostart entry. This recovers an interrupted transaction after reboot. Completion
removes only that update's entry; it does not change the user's ordinary app auto-start setting.
Windows retains a terminal journal directory while its helper executable is still running and
removes it before the next update. Linux intentionally keeps the previous version directory.

If recovery cannot identify or stop the replacement, restore files, or remove an externally
changed recovery registration, it preserves the journal/backup and reports failure in
`update-worker.log`. Re-running the recorded helper with the journal path and `--recover`
resumes the same transaction. A nonterminal transaction blocks another update.

## Evidence and limits

`launcher/tests/update-worker.test.cjs` exercises interruption before and after backup/replace,
interruption during rollback, staging and launch failures, readiness failure, idempotent recovery,
live-owner locking and exact prior content/mode/timestamp preservation for all three platform
transaction shapes. Native POSIX subprocess tests kill a worker with SIGKILL at each replacement
edge, verify guardian recovery and actual relaunch, prove that unauthorized supervisors cannot
launch, and exercise successful/failed native readiness handoffs. The native subprocess cases
are skipped on Windows; the cross-platform filesystem/state regressions still run there.

`launcher/tests/update-validation.test.cjs` tests malformed or mismatched packages/native headers,
ASAR bounds/path handling, runtime identity, and escaped symlinks. A real Electron subprocess
also verifies compatibility with Electron's ASAR filesystem behavior. The existing installed
macOS arm64 application was inspected read-only using the new validator successfully.

These local checks do not constitute native Windows/macOS x64/Linux package installation,
reboot or login-service acceptance. Reboot recovery runs at the next graphical user login and
depends on that operating system allowing the registered per-user entry. An administrator can
disable such entries. Filesystem or hardware failure that loses already flushed data is outside
the journal guarantee. Rollback covers installed application files, not account activity or
future application-specific profile/data migrations. Readiness is a local startup/runtime proof,
not proof of ChatGPT authentication, a live model response or an installed Codex/MCP task.
Publisher signing/notarization and release provenance are documented separately in
[release validation](release-validation.md).
