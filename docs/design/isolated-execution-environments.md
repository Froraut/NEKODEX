# Isolated execution environments: proposed continuation

**Development product flow accepted; production/installed delivery remains open.**
The dedicated helper, guest producer, strict protocol and private execution leaf
now exist and actual pipeline/background/cancel/timeout/core EOF checks passed.
See [physical ownership evidence](../reviews/2026-10-19-isolated-shell.md) and
[product export/recovery acceptance](../reviews/2026-10-19-vm-product-refactor.md).
The ToolJournal/UI and separate revision-aware export are accepted in development.
The fixed offline GCC/Python profile passed actual C shared-library and CPython
extension builds through Native and separately approved export; see
[native build acceptance](../reviews/2026-10-19-vm-native-builds.md). General build
systems/dependency preparation, production/installed admission, network grants
and Darwin parity remain open.
This extends the full P16/P17 scope
in the [adoption program](full-adoption-program.md), including real shell external
programs/pipelines, native builds and explicit network authority. Existing
[restricted scripts](restricted-skill-scripts.md) and
[selected Python environments](python-skill-environments.md) retain their current
contracts. A selected pure-wheel environment is not general shell/build support.

## Proposed execution boundary

Use a dedicated signed Swift helper owning one Apple Virtualization.framework
`VZVirtualMachine` for one action. The guest is a disposable pinned Linux ARM64
image with a declared shell, utilities, Python/build tools and guest agent.
Guest fork, pipelines, background jobs and `setsid` stay inside the same VM;
physical settlement concerns the complete VM, not a sampled host PID tree.
Do not use a shared Docker VM, attach another application's VM or accept a
user-supplied VM control socket as this action's ownership proof.

Proposed initial resource envelope: **one owned VM, two virtual CPUs, 2 GiB RAM**.
These values were admitted and asserted on the actual development VZ configuration;
the small fixture is not a host-performance guarantee or production acceptance.
Wall-time, output, disk-growth, snapshot/import/export and vsock message budgets
must be explicit bounded fields in the reviewed action manifest. A deadline may
request stop; it cannot independently declare physical completion.

Default configuration has **no network device and no host directory shares**.
Do not expose host HOME, credentials, SSH agent, Docker socket, environment
variables, package-manager configuration or arbitrary host filesystem handles.
One bounded virtio-vsock channel connects the owned helper and pinned guest agent;
it is a data protocol, not a shell, host command launcher, file server or network
proxy. Guest data remains untrusted even when the guest agent is pinned.

The helper owns a private disposable disk overlay and exact per-action VM identity.
The pinned base image/kernel/initrd/agent/toolchain manifest identifies all inputs;
mutable guest work never modifies the shared base. Missing helper/image/signature,
unsupported host architecture or unavailable virtualization entitlement produces
unavailable, without fallback to an unrestricted host shell.
The development producer pins an official Alpine ARM64 kernel/minirootfs and
Go toolchain, builds a static guest agent and self-contained initrd, and records
their exact source/artifact identities. This is not a production guest admission
or arbitrary build-system/package support. A fixed GCC/Python development profile
is now pinned and tested; production admission and broader formats remain separate
prerequisites.

Linux guest native code is **not Darwin-native parity**: Linux `.so`, toolchain,
ABI, paths and outputs differ from macOS dylibs/extensions and code signing.
Darwin-specific building/execution remains separate work and must not inherit a
Linux acceptance claim. Distribution of guest images/toolchains also needs an
explicit licensing/update owner.

## Main, helper and journal ownership

The existing tool host and ToolJournal remain the top-level authorization/sender
owner. Add an execution-environment leaf, not a second Agent scheduler. Its main
port admits a fixed helper and guest manifest, prepares an immutable input plan,
starts the exact approved action, cancels/stops it, inspects exact receipts and
retains unresolved physical ownership. Status is cached/passive; it must not boot
a VM or start an inventory process.

The Swift helper needs a fixed source/build/signature identity and the Apple
virtualization entitlement. Development compilation/signing and focused acceptance
precede distribution packaging. Production must verify its publisher/signature
and manifest rather than accepting an arbitrary executable or PATH fallback.
One helper owns the VM and bounded host resources; main owns its PID/start and
action lease. Control identity, operation IDs and acknowledgements are exact, with
no guest-provided host paths or authority objects.

Suggested state sequence:

`reviewed -> prepared -> starting -> running -> stopping -> stopped -> settled`

`unknown/held` is an outcome whenever accepted ownership or stop/publication proof
is incomplete. Persist the intent before helper/VM start, bind the helper's exact
identity before launch permission, and journal execution/result/stop/export phases
separately. Duplicate action IDs return retained state. Lost acknowledgements,
restart, UI remount or a new action UUID never authorize another execution.

Guest command exit and guest-agent final output are semantic result observations,
not physical terminal receipts. Request graceful shutdown when supported, then
use the owned VM stop operation if necessary. Report physical terminal only after
successful complete-VM stop observation and closure/settlement of owned channels,
disk I/O and helper resources. A guest self-stop racing a stop request must be
handled through exact stopped-state/delegate evidence, rather than treating the
request's resulting error as either proof of liveness or proof of completion.
Main joins the exact helper's physical exit before its final physical receipt.
Cancellation, timeout, core EOF and output overflow
all follow that lifecycle; a promise returning unknown cannot release the lease.

Helper death or control loss remains unknown/held until an exact supported owner
reconciliation proves the VM/resources are gone. Do not assume helper disappearance
alone is sufficient, kill by generic process name, adopt another VM or restart the
action to discover what happened. A future restart-recovery implementation must
prove its resource identity and stopping capability before claiming support.
The helper should survive ordinary core control loss long enough to stop and
record on EOF; arbitrary helper SIGKILL recovery is unproved. Guest cgroup v2
`cgroup.kill`/`cgroup.events` may assist orderly descendant drain if the job cannot
write its control hierarchy, but neither guest process exit nor cgroup emptiness
replaces host-authoritative complete-VM stop.

## Immutable inputs and approved host export

The action review binds selected script/source bytes, exact guest/toolchain
manifest, offline dependency/build artifacts and bounded workspace snapshots.
Copy only explicitly granted selected inputs; package metadata does not grant
access to linked files or user home. Recheck snapshot source identity/revisions
and complete hashes before sealing. The VM receives immutable input media/data
and private guest scratch, not live shared workspace directories.
Any later live VirtioFS share, including read-only sharing, needs a separate root
grant and explicit non-snapshot semantics; the initial configuration has none.

Native builds may execute guest compiler/build hooks and arbitrary guest children
only inside that VM. Build-system dependencies, sdists and prebuilt artifacts must
be explicitly acquired, pinned and included; no automatic host pip, setup.py,
network fetch, credential discovery or toolchain installation occurs as a side
effect of discovering a resource. Guest result logs do not certify an artifact.
Broader native Python dependency preparation can use a separately approved builder
VM and export an exact immutable guest environment. A Linux `.so`/environment is
never admitted as the existing Apple Python runtime/environment brand.

After execution, the guest can propose bounded export candidates containing safe
relative paths, sizes, modes and content hashes. Host independently validates the
data and manifest. Export is a **separate reviewed ToolJournal action** with an
exact destination grant, candidate bytes and expected source/destination revisions;
guest execution approval never grants arbitrary host writes.
Host publication/export may start only after complete VM physical settlement.
Execution outcome, VM stop, export outcome and cleanup remain separate receipts.

Use snapshot/revision comparison and per-file staged publication/CAS checks at
the existing filesystem owner. Refuse stale revisions, symlink/path escape and
foreign targets; preserve user edits and exact drafts/candidates. Do not claim a
multi-file atomic transaction or adversarial filesystem CAS from ordinary rename.
Persist each publication intent/result; partial or unknown export stays explicit
and is reconciled without rerunning the build or rewriting completed files.
No automatic clean, reset, checkout or rollback of unrelated work is implied.

## Network and restricted native alternatives

The initial VM mode remains offline. A subsequent explicit network grant must
define exact task/generation/action scope, destination/protocol/method, credential
owner, proxy/DNS/redirect policy, byte/request limits and durable unknown-effect
handling. Adding a NIC or forwarding arbitrary vsock requests is not an acceptable
implicit grant. A scoped host request broker can be a useful separate increment;
it is not arbitrary guest socket or subprocess-network support.
An explicitly approved NAT mode would permit broad outbound traffic; NAT is not
a domain allowlist. Domain/protocol constraints require an enforcing proxy or
packet backend. Revocation stops the exact active VM, while already accepted
external effects remain subject to unknown/reconciliation rather than rollback.

An optional restricted host-native broker mode may interpret a declared shell
dialect/AST and pipelines, with every external utility launched by the owner as a
separately sealed deny-fork/deny-exec leaf. It must disclose its supported syntax,
trusted-code assumptions and prove its own settlement
boundary. Stock `/bin/sh` plus negative-PGID kill/poll is insufficient. Native
Python/FFI or an allowed utility can change groups/sessions; observation cannot
retroactively prevent an escaped descendant. Do not narrow the full requirement
to builtins-only or quietly substitute this restricted mode for general execution.

## Focused acceptance before claiming support

Use one coordinated isolated development target and a bounded disposable fixture:

- Execute a real external-program pipeline, subshell and background work; verify
  result bytes and that normal command exit still leads to complete VM stop.
- Run guest fork/`setsid`/double-fork/background cases, including closed stdio;
  cancel/timeout/core EOF must stop all guest execution before physical terminal.
- Build and import a small native Linux extension from exact offline inputs;
  verify ABI/toolchain provenance and explicitly label the result Linux-only.
- Demonstrate no NIC/no host shares, denied outside-input access and no host
  network request via the vsock protocol. No live account or credential fixture.
- Export an exact approved artifact, then introduce a concurrent destination edit;
  stale export must refuse without overwrite and preserve the proposed bytes.
- Exercise duplicate/lost-ACK/helper-loss receipt handling: no second run/export,
  unknown ownership retained, exact supported reconciliation and cleanup only.

Inspect the real UI review/approval/cancel/result path after core acceptance.
Native model use and application/business outcome are later explicit proofs.
Measure resource behavior rather than calling the proposed 2-vCPU/2-GiB envelope
validated. Installed delivery, Darwin-native parity, network-enabled execution and
the remaining 44-item scope stay open until their own implementation/acceptance.

## Primary-source rationale

- [Apple: virtualization entitlement](https://developer.apple.com/documentation/virtualization/adding-the-virtualization-entitlement-to-your-project)
  belongs on the new dedicated helper, not a widened global Bun runtime.
- [Apple: running Linux in a VM](https://developer.apple.com/documentation/virtualization/running-linux-in-a-virtual-machine)
  describes the boot/configuration boundary; SDK availability alone is not an
  entitled boot or guest compatibility result.
- [Apple Virtualization: stop(completionHandler:)](https://developer.apple.com/documentation/virtualization/vzvirtualmachine/stop(completionhandler:))
  defines a complete VM stop callback, including error, distinct from graceful
  shutdown. This proposal still needs an implemented/reviewed owner around it.
- [Apple XNU process/session implementation](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_prot.c)
  provides `setsid`/`setpgid`; process-group membership is not an immutable container.
- [Apple XNU kqueue process filter](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/kern/kern_event.c#L1031)
  rejects `NOTE_TRACK`, `NOTE_TRACKERR` and `NOTE_CHILD`; a FreeBSD-style automatic
  descendant-tracking assumption does not establish a Darwin ownership boundary.
- [Apple: NAT attachment](https://developer.apple.com/documentation/virtualization/vznatnetworkdeviceattachment),
  [read-only shared directories](https://developer.apple.com/documentation/virtualization/vzshareddirectory/isreadonly)
  and [VirtioFS permissions](https://developer.apple.com/documentation/virtualization/vzvirtiofilesystemdevice)
  describe distinct network/share facilities; none implies snapshot isolation or a
  domain policy. The initial proposal configures no network or shared directories.
- [Linux cgroup v2](https://www.kernel.org/doc/html/latest/admin-guide/cgroup-v2.html#core-interface-files)
  documents optional guest drain mechanisms; these remain subordinate to host VM
  ownership and cannot substitute for its terminal evidence.
