# NEKODEX mixed-model experiment review wave 3, lane 1

- Repository: `/Users/alex/Dev/nekodex`
- Baseline: `9925453bd51e61c7b398abec12ec0da3aca3d3af`
- Review type: source-only adjudication; no source edits, tests, typechecks, automated audits, runtime actions, commits, or delegation.
- Scope: `src/service.ts`, `src/tunnel-service.ts`, `src/process.ts`, and direct lifecycle callers in `src/setup.ts`, `src/doctor.ts`, and `src/cli.ts`.

## Adjudication

### Review1 claim 1 — accepted; root L01

The claim is directly evidenced. `src/service.ts:103-113` sets `loaded: result.status === 0`, so every ordinary nonzero `launchctl print` result is exposed as `loaded:false`. `src/tunnel-service.ts:103-115` does the same for both `loaded` and `running`, and its comment explicitly treats an ordinary nonzero print as unloaded.

That result is consumed by lifecycle branches: `service.ts:123-144` may write/bootstrap when `loaded:false`; `service.ts:308-332` and `tunnel-service.ts:192-212` may skip bootout and remove definitions; `setup.ts:544-558, 768-816` and `cli.ts:520-529` make ownership and teardown decisions from the status. The existing catches in `setup.ts:647-665` and rollback guards at `879-909` only help when the probe throws. An ordinary nonzero result does not throw.

The counterevidence in review2 is valid but does not defeat the claim: `runCommand` throws for spawn errors and timeouts, and the tunnel print has a five-second timeout. Those are already unknown through the exception path. They do not classify ordinary nonzero statuses. The fix must recognize only a documented, exact absent-service result as unloaded; permission, malformed-state, transport, and other nonzero outcomes must remain unknown and block destructive lifecycle decisions.

### Review1 claim 2 — accepted; root L02

The claim is directly evidenced for the daemon service. `waitForServiceUnloaded` at `src/service.ts:51-57` checks the wall-clock deadline around synchronous calls, while `getServiceStatus` at `103-114` calls `runCommand` without a timeout. `src/process.ts:24-35` passes the options to synchronous `spawnSync`. A stalled print therefore prevents the enclosing loop from reaching its next deadline check. The same unbounded status call is reachable from install/start/restart/stop/uninstall, acquire-drain, doctor, setup, and CLI status.

The tunnel path is partial counterevidence only: `src/tunnel-service.ts:94-107` bounds its print probe, and `165-188` bounds polling by the remaining unload deadline. That makes the tunnel polling path bounded, but it does not repair the daemon path or L01, and it does not give all probes a shared enclosing deadline. The actionable root is therefore the missing per-probe deadline contract across the service lifecycle, with the daemon status probe as the confirmed high-impact instance.

### Review1 claim 3 — accepted; root L03

The claim is directly evidenced. `src/service.ts:134,143,287,311,325` call `runChecked` for bootstrap/bootout without a timeout. `bootstrapService:39-49` has a 20-second retry deadline checked only before an unbounded synchronous `runCommand`, so the loop deadline cannot bound an individual attempt. The restart path acquires a drain lease at `282-286`, then can block at `287` before its catch at `290-292` can release the lease.

The tunnel path supplies the same independent defect: `src/tunnel-service.ts:147-150,158-160,192-199` passes an abort signal but no `timeout` to launchctl mutations. An abort signal does not by itself prove that synchronous `spawnSync` has stopped. This is actionable and distinct from L02 because adding a timeout to status probes alone would leave bootstrap/bootout and restart compensation unbounded.

### Review2 claim 1 — accepted; root L01

This is the same root as review1 claim 1. Its source locations and caller consequences are confirmed. The review2 counterevidence is also correct but limited to thrown spawn/timeout errors and does not cover ordinary nonzero `launchctl print` results. The setup and doctor callers make the distinction material: `doctor.ts:164-183, 201-218` can report a normal absent/error-shaped result when the probe returned nonzero, while their catch branches are reached only for thrown failures.

### Review2 claim 2 — accepted; root L02

This is the same root as review1 claim 2 for the daemon status probe, with the additional valid observation that tunnel mutation calls are unbounded; that mutation part is merged into L03 rather than counted twice. The fixed tunnel print timeout and remaining-deadline polling are real counterevidence against a claim that every tunnel status probe is unbounded, so the accepted scope is the daemon status path plus the missing uniform per-probe deadline contract.

## Design limit

The reports did not supply a separate numbered claim about `loaded` meaning process health, and that would be a design limitation rather than a defect. Launchd registration is not proof that the process is currently running; the tunnel module already exposes a separate `running` field based on print output. Adding a process-health probe would change semantics and is outside this adjudication.

No gateway envelope finding is accepted: the requested scope contains no evidence that a freeform gateway envelope is an undeclared fixed schema. No imported-CSS finding is accepted: CSS may be supplied through `src/nekodex.css`, so an absent import in a narrower file would not establish a defect. No non-atomic-race finding is accepted without a concrete actionable gap; setup already snapshots bytes, checks ownership, and preserves concurrent edits in its rollback guards.

## Root summary

Three unique actionable roots are accepted:

- **L01 — launchd nonzero print is misclassified as unloaded (P1).** Trigger: ordinary nonzero `launchctl print` result from permission, malformed state, transport, or another error. Fix: represent unknown separately and map only an exact recognized absence result to unloaded; fail closed in install/start/stop/restart/uninstall/setup.
- **L02 — service status probes can exceed their enclosing deadline (P1).** Trigger: daemon `launchctl print` stalls inside synchronous `spawnSync`. Fix: pass a timeout bounded by the enclosing deadline to every status probe and preserve timeout as unknown.
- **L03 — launchd mutations can block lifecycle and drain compensation (P1).** Trigger: `bootstrap` or `bootout` stalls during install/start/stop/restart/uninstall, including tunnel lifecycle. Fix: bound every mutation by the operation deadline and retain the primary mutation failure plus any compensation failure.

Essential fixes are limited to those three roots. Public connector ABI and names remain unchanged.
