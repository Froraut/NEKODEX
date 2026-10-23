# Explicit recovery after Native owner loss

This P23 implementation keeps account sign-in, model inventory and execution
separate. Recovery releases only proven stale ownership records. It does not
authenticate, read/copy token contents, refresh a model catalog, resume a thread
or replay an uncertain operation. Existing task and Native action journals retain
their prior outcomes.

Ordinary status remains passive. An explicit `preview-owner-recovery` action
inspects the fixed metadata roots and produces a bounded review with a stable
digest. A separate `recover-owner` action requires that digest and a new durable
action ID. Main alone supplies the official CLI/worker and owned Bun pins;
renderer arguments contain no executable, path, process override or authority.

## Physical absence is a separate requirement

A missing application window or dead parent PID does not prove that a detached
Native worker or device-login CLI has exited. `ps comm` is not sufficient as an
exact executable-path proof: Apple's implementation reads its display command
from the process arguments. See Apple's
[keyword mapping](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/keyword.c)
and [process display implementation](https://github.com/apple-oss-distributions/adv_cmds/blob/main/ps/print.c).

The explicit preview/recovery uses a fixed private metadata-only Bun observer
against macOS libproc. It enumerates the current UID, reads kernel executable
paths and start identities, checks completeness and reconciles process churn, and requires
ESRCH for each legacy former PID. Matching official CLI/worker processes or the
`sandbox-exec` launch carrier block recovery. Unreadable, incomplete or ambiguous
observations also block; there is no force override or process termination.
No argv, environment, profile content or unrelated process path is projected to
the UI or saved in recovery receipts. The observer is pinned, bounded and launched
only by explicit actions; normal status never starts it.

A missing executable path from an unrelated process does not by itself prove a
Native owner is present. The narrowly scoped exclusion requires two stable
kernel BSD observations of PID, UID, start identity and short executable-accounting
name, both running and past exec. The short name must differ from the first 15
bytes of every admitted executable basename and the fixed Native/carrier names.
A matching long name can add a blocker, but cannot establish an exclusion: XNU
allows the process to change that long name. Missing, changed, malformed,
pre-exec or candidate evidence remains blocked. This rule covers the fixed
producers admitted by this Native flow; it does not claim arbitrary descendant
discovery. The source basis is Apple's
[exec-accounting name assignment](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c#L951-L970),
[libproc projection](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/proc_info.c#L703-L708),
[mutable long name](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_sysctl.c#L2855-L2865)
and [exec completion flag](https://github.com/apple-oss-distributions/xnu/blob/f6217f891ac0bb64f3d375211650a4c1ff8ca1ea/bsd/kern/kern_exec.c#L2233-L2236).

libproc cannot inspect an exited child that its parent has not yet reaped. Such a
zombie has released its address space, descriptors and locks, so it cannot own
Native state, but it would otherwise block recovery until an unrelated parent
waits for it. The observer excludes a libproc-uninspectable PID only when
`sysctl` `KERN_PROC_PID` positively reports that PID as `SZOMB` with the current
real and effective UID. Every other uninspectable process still blocks. After the
second enumeration each excluded zombie must still be the same zombie (PID, UID,
start identity) or be strictly absent; a reused PID blocks. The excluded rows
(PID, UID, start) are recorded in the recovery receipt as process evidence, not
in the review digest, so the kernel reaping a zombie does not expire consent.

The observer uses exactly two enumerations. Each added PID receives the same full
observation; removed PIDs require final strict ESRCH. Reused, live or unverifiable
removed PIDs block recovery. Former-owner absence is checked again after this
reconciliation. This avoids rejecting proven exits without a retry loop or a
claim of an atomic system-wide process snapshot.

Executable admission hashes canonical owned files in bounded chunks, with stable
file identity and protected permissions before and after reading. A pinned
executable may have multiple hard links; private metadata markers and receipts
still require a single link. The 512 MiB executable bound accommodates the actual
reviewed development worker rather than relying on a smaller test binary.

Legacy ownership markers do not retain enough per-child provenance to distinguish
another use of the same official CLI. Any observed matching official executable
therefore blocks recovery, including an unrelated live production tunnel client.
The application does not terminate that client or offer a force override.

## Exact metadata transaction

The recoverable set is limited to `owner.lock` and the registered current profile
epochs' direct `.execution-owner`/`.inventory-owner` records. Their canonical
private ancestry, UID, file identity/hash and corresponding bounded journal
metadata must agree. Historical binding locks, authentication/configuration and
conversation files are outside this mutation.

The review digest binds the material plan and trusted pins, not elapsed human
reading time or an ephemeral observer PID. Recovery repeats physical and file
checks immediately before archival. A durable prepare receipt and exclusive gate
precede any rename; profile records are archived first and the global owner last,
with directory durability. The archive retains exact original marker bytes.

An exact receipt lookup can reconcile an already complete archived set or a
proven untouched set after its recovery owner is absent. It cannot rename markers
or replay an action. A partial or unverified set stays unknown/held and blocks new
Native ownership. Closing joins owned diagnostic/recovery work; held recovery
must contribute to activity rather than appear idle.

## Presentation and acceptance

Recovery controls have their own availability gate because stale-owner status
deliberately disables ordinary Native mutations. Preview, acknowledgement and
confirmation are distinct. A materially changed plan requires fresh review;
ordinary refresh of the same plan does not expire consent. Prepared/archiving/
unknown or held receipts cannot clear an uncertain action. Completed recovery
does not automatically sign in, inspect models or send an inference request.

Focused acceptance covers the actual macOS process observer, unchanged metadata
archival, live/uninspectable-owner refusal, journal preservation, interrupted
archival reconciliation and the rendered confirmation/receipt flow. These checks
are separate from installed delivery and real authentication/model acceptance.

## Live GUI tool connection pause

Preview and separately acknowledged Apply require browser turn admission to be open, then acquire the launcher lifecycle owner and close that admission. An existing browser pause is refused without overwriting or reopening its reason. `withNativeRecoveryQuiescence` uses the exact owned daemon runtime-session detach as its atomic idle fence: live Web/Agent/tool work refuses the pause; independent Native HTTP is retained. It gracefully stops only launcher-owned configured tool peers, without editing account bindings, credentials or aliases. The authority then performs the existing complete process proof and exact review-digest checks unchanged. The validated Native registrar invokes a main-owned `withOwnerRecovery` callback inside its existing refusal/receipt boundary. A refusal before entering the authority is retained as exact-action `knownNotStarted`, allowing passive Refresh reconciliation without replay. Both outcomes and exceptions restore saved peers and runtime-session attach in `finally`; restoration failure is surfaced rather than reported as success. The daemon process, monitor and durable background owner are never detached for Quit. Foreign or unproved matching processes still refuse recovery.
