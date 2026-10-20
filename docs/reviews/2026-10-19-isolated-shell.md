# Isolated Linux shell development evidence — 2026-10-19

The P16/P17 continuation now has an implemented and exercised macOS development
execution boundary. It is not yet exposed as a product Agent tool or installed
capability. The complete 44-item adoption program remains open.

## Implemented ownership

- A dedicated Swift Virtualization helper, development signed with exactly
  `com.apple.security.virtualization: true`; source/build/entitlement identities
  are captured before compilation. The general Bun runtime receives no new rights.
- One user-wide private VM authority across launcher profiles; Darwin advisory
  lock, authenticated bounded job/gate records, durable helper PID/start binding
  and START intent before its parent-gated write. Duplicate actions do not execute.
- Two virtual CPUs, 2 GiB RAM, zero NICs, zero directory shares and zero storage
  devices, asserted on the constructed VZ configuration. One bounded vsock service.
- Official pinned Alpine ARM64 kernel/minirootfs and task-local Go compiler;
  self-contained initrd/static agent, clean offline build environment, source and
  artifact manifest. Jobs use UID/GID 1000, clean environment and `/workspace`.
- Bounded strict scoped NDJSON, ordered hash-checked file snapshots, exact output
  allowlist, frame/queue/log/file budgets and independent helper import/job timers.
- Guest exit/status/output remains untrusted. An actual VZ stopped observation,
  closed guest channels, authenticated durable stopped receipt and exact helper
  process/stdio join precede terminal gate release and candidate lookup.
- Host candidate filenames are hashes; guest paths are metadata. Reading a
  settled candidate grants no workspace destination/write authority. Lost release
  publication can reconcile its exact signed pending record without job replay.

## Focused evidence

| Boundary | Result | Scope |
| --- | --- | --- |
| Parent protocol/journal | 8 cases / 52 assertions passed | Framing/UTF-8, ordered exact outputs/hash/allowlist/scope, nonadjacent ancestor collisions, global held owner, pending records, HMAC identity and exact pending gate release. Initial seven cases and the later one-case addition were run separately; unchanged results reused. |
| Static guest agent | 3 cases passed | Strict JSON/duplicate fields/paths/base64, transfer ordering and overflow cancellation. Darwin stub executes no guest shell; this is separate from real VM evidence. |
| Helper build/signature | Passed | Final Swift compilation, strict ad-hoc signature, virtualization-only entitlements and passive description/manifest identity. |
| Real external pipeline | Passed, 439 ms | Action `8260e07f-4aa1-4b62-ac23-a0b85045d4fc`: external cat/tr/sort, subshell, detached setsid/background, UID 1000, guest reports only loopback/no host `/Users`. Host configuration independently excludes NIC/shares. Output exact 32 bytes, SHA below. Normal shell exit still ends with complete VM stop. |
| Inherited background stdio | Passed, 642 ms | Action `051f29ce-adf4-4dbc-b621-f70dc92fcdc3`: a 60-second background child retains pipes. Bounded drain flags incomplete logs, captures the exact same candidate and stops the whole VM; no 60-second pipe wait. |
| Explicit cancellation | Passed, 10,008 ms | Action `297926ec-76fc-4113-89f7-19f9ebc3bb91`: actual shell marker precedes cancel; foreground loop plus detached background work; authenticated physical stop and exact join. |
| Execution timeout | Passed, 1,930 ms total | Action `9f1dd4ba-cbd7-4190-ac00-b77dd30b6d32`: actual marker, 1,500 ms execution deadline, physical stop and join. Deadline alone does not settle. |
| Core process EOF | Passed | Action `f023d924-1356-4d69-8c52-9321dab8b58b`: intentional exit of the exact development owner after recorded running phase. Same helper stops on pipe EOF; a fresh passive controller verifies its stopped receipt and exact process absence, settles without execution replay. No guest semantic result is claimed after process loss. |
| Duplicate / fresh read | Passed | Successful normal/cancel/timeout cases return the same retained result digest from duplicate execution and fresh reconciliation, without another VM execution. |
| Final ownership | Passed | All six actions, including the initial failed attempt, have authenticated stopped receipts and settled journals; exact helper identities absent; global held owner is null. |

Pipeline candidate bytes are `ALPHA\nBRAVO\nCHARLIE\nSUBSHELL_OK\n`, SHA-256
`cef56ec6061e2c6e2544e02fb9a4981dd3a9e98d4224cdd2584ab1c2e304a4de`.
No workspace export or business/model result is inferred from this fixture.

A single live helper sample during cancellation showed PID 62676, 0.0% CPU and
11,536 KiB RSS at five seconds. This is the helper process only; it is not total
VM/XPC or whole-system memory. The admitted guest configuration remains 2 GiB.
No host performance guarantee is inferred from this small fixture.

Private raw evidence is retained in the task workspace under
`reviews/evidence/full-adoption/vm-{pipeline-accept,cancel,timeout,eof,eof-reconciled,inherited-stdio,final-owners}-20261019.json`.
Per-action private boot diagnostics and signed ownership records remain under the
user-wide VM authority. Receipt keys/configuration secrets are not published.

## Corrected initial failure

Action `494f0812-95b7-4116-9493-0467a94dc69b` booted the actual kernel, then failed
the guest listener; no pipeline output was claimed. It was physically stopped
and joined in 448 ms before any new action. Its original receipt is retained.

The pinned Go 1.26.3 `syscall.Accept4` wrapper converts peer addresses through
`anyToSockaddr`, which lacks AF_VSOCK, closes the accepted FD and returns
EAFNOSUPPORT. The guest now uses raw `SYS_ACCEPT4` with nil sockaddr and
CLOEXEC/NONBLOCK. Actual pinned gzip module headers were also decoded/verified as
ARM64 ELF, with every dependency edge rewritten to plain `.ko` names for this
minimal BusyBox initrd. Kernel ELF noise alone was not treated as proof of the
primary cause. The helper's generic parent-protocol diagnostic also covers a
connection disappearing before hello; an exact race was not inferred.

## Artifact identity and remaining work

| Artifact | SHA-256 |
| --- | --- |
| Final helper executable | `d1947d0a5d5e5b3ccb081d0950eed436ff12bcdd3681304b909bbdeddd56c727` |
| Helper manifest | `6c6ff5cfeae5dab819cedff17d59b82ff0b7a9f04e6a3c03ac857544a3f979df` |
| Guest manifest | `25585846358b037b33497c258cd39f399e1f2558f474582262aec6a0551b5a26` |
| Kernel Image | `1993474a172566b1573234900ff611c9fa4307b9398742c4c210b1e9664d6e56` |
| Initrd | `aade8d4a30ce0639ad450552be6d14aeec4f0a9d38135d3776686adf643da932` |
| Guest agent | `1c863003155e9a33f034b4ac5605083aefe84748b8d3cab9edceeebe1b3dbb16` |

Explicit developer commands are `vm:build:helper`, `vm:prepare:guest` and `vm:dev`.
Guest preparation downloads only the locked official inputs; it never boots a VM.
The fixture is run directly with the declared Bun 1.4.0 executable. A package
script invoking bare `bun` can otherwise select a different PATH runtime.
Generated guest/toolchain/helper directories are excluded from the source module
map; source files remain tracked.

Still required: product Review/Prepare/Attach and existing ToolJournal/UI wiring,
separately approved revision-aware workspace export, stale-export refusal, Linux
compiler/Python/native extension build support, broader PEP 508/dependency inputs,
network authority, production publisher/image licensing/update policy, arbitrary
helper SIGKILL recovery, Darwin-native parity, real Native-model shell outcome and
installed delivery. Windows/Linux host support and the other approved program
items remain open. No app restart, installed replacement or release was performed.
