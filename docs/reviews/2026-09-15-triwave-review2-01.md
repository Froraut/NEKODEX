# NEKODEX triwave review 2, lane 1 — setup/rollback

Reviewed frozen `HEAD 3740505b0107af9a83053fd523ae1ad30be36465` independently in `src/setup.ts`, direct CLI/launcher setup callers, and coordinated `service.ts`, `tunnel-service.ts`, `tunnel.ts` helpers. Challenged `2026-09-15-triwave-review1-01.md` against the adjudicated four-wave ledger and current source. Manual, read-only source review; no tests, typechecks, scripts, broad audits, runtime/production operations, code edits or commit. This document is the only saved output. Native4, Native4 DEV, ZeroRisk4 identities and public ABI pins remain untouched.

## Counts and disposition

- **One new conditional source defect:** `T2-1-1` (P2). Same recovery assumption appears in service and tunnel paths, counted once.
- **Repeats, no new ID:** D01/D02 owned write-before-bootstrap checkpoints; D10/D11 direct DEV running/unknown-alias refusal; D12 post-commit warning. These are fixed at this HEAD on the inspected branches.
- **Known limit, no new ID:** a DEV alias can restart after the explicit stopped observation and before mutation; direct CLI has no atomic owner/idle-drain handshake. `T1` correctly treated that as an ownership race rather than a demonstrated independent current-build failure.
- **Optional improvement:** none independently justified here.

## T2-1-1 / P2 — rollback can replace an already divergent original service definition

**Trigger.** A valid saved Full config exists, but the installed launchd plist for its loaded service is already byte-different from the plist generated from that config (for example, a stale definition left by earlier maintenance or an administrator's launchd edit). A new setup changes the service/tunnel and later fails, such as during readiness or final route commit. The mismatch exists **before** this setup's snapshot; no concurrent edit during this transaction is needed.

**Current source path.** Setup snapshots the service definition and loaded state at `src/setup.ts:625-637` and the tunnel definition at `:628-637`. `serviceUnchanged()` and `tunnelServiceUnchanged()` compare current bytes/state with those snapshots at `:687-718`, so an initially divergent but unchanged definition passes the pre-mutation guard. On rollback, the service path restores `serviceBeforeRoute` at `:884-886`, then calls `installService(existing)` when it was loaded. `src/service.ts:125-132` constructs the plist from `existing` and overwrites the restored bytes whenever they differ. The tunnel path has the same sequence at `src/setup.ts:932-935`; `src/tunnel-service.ts:121-133` constructs from `existing` and writes a different definition before bootstrap. Thus the exact pre-setup bytes can be replaced during rollback even though no later actor changed them. The relevant terminal Full tunnel migration is entered when the loaded service definition does not match the new config at `src/setup.ts:790-813`; the service path is entered for a changed loaded terminal runtime with `--restart-service` at `:727-758`.

**Consequence.** A failed setup may leave a loaded old runtime with a generated definition that differs from the definition present before setup. If that original plist carried a legitimate custom launchd setting, the setting is lost. The rollback's exact-byte preservation claim therefore holds through `restoreFileSnapshot`, but not through the subsequent installer call. This is distinct from D01/D02, which addressed missing checkpoints for definitions **written by this setup before bootstrap**; this path concerns recovery of a mismatched baseline.

**Counterevidence and severity limit.** A normally installed plist matching `existing` does not trigger the overwrite. An already divergent baseline may be unsupported or may itself be stale; this report does not assert a live incident, a correct custom service configuration, or that the old process becomes unhealthy. The source path nonetheless defeats byte-for-byte rollback for a concrete valid-config/loaded-plist state. A minimal correction would preserve the captured original definition during re-bootstrap, or reject an unverifiable baseline before mutation. Any correction must still fail closed on actual concurrent edits and unknown loaded state; do not broaden it into a connector ABI change.

## Challenge to wave 1

The first-wave statement that no independent setup/rollback root was found is too broad for the divergent-baseline branch above. Its narrower conclusions about D01/D02 callbacks, D10/D11 DEV refusal and D12 warnings remain supported. The first-wave DEV race paragraph is properly a known limitation, and I assign it no `T2` ID.

The parent retains its single focused verification budget of at most 60 seconds and ten scenarios. No verification was performed in this lane.
