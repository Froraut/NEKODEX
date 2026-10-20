# Execution VM wire v1 — implementation contract

This is the shared implementation seam for the isolated execution environment.
It does not announce runtime availability. The owning design is
[isolated-execution-environments.md](isolated-execution-environments.md).

All messages are one UTF-8 JSON object per LF. Protocol is `neko-vm-v1`.
Every scoped message carries `actionId` (UUID) and `nonce` (64 lowercase hex).
Reject unknown fields, malformed/noncanonical base64, duplicate starts, changed
identities and over-budget streams. One vsock connection, one hello and one
execute per VM; no generic host service. Guest port is 4041.

Initial hard policy: one owned VM, 2 vCPUs, 2 GiB RAM, no network devices or host
shares. Max frame 256 KiB; file chunk 64 KiB; input 64 MiB/4096 regular files;
output 16 MiB/256 regular files; stdout+stderr 1 MiB; script 64 KiB. Job timeout
is at most 600000 ms and requests physical stop, never declares it complete.
Paths are relative beneath `/workspace`, no empty/dot/dotdot segments, absolute
paths, NUL, backslashes, symlinks or special files. Modes are 0600 or 0700.

Host -> guest payloads (all include protocol/actionId/nonce):

- `type:hello` — no additional fields.
- `type:file-begin`, `path`, `mode`, `size`, `sha256`.
- `type:file-chunk`, `path`, `offset`, `dataBase64`.
- `type:file-end`, `path`.
- `type:execute`, `script`, `outputPaths` (exact reviewed allowlist), `timeoutMs`.

Guest -> host payloads:

- `type:ready`, `agentVersion:1`, `architecture:arm64`, `capability:linux-shell`.
- `type:stdout` or `type:stderr`, `dataBase64`.
- `type:output-begin`, `path`, `mode`, `size`, `sha256`.
- `type:output-chunk`, `path`, `offset`, `dataBase64`.
- `type:output-end`, `path`.
- `type:result`, `exitCode` (integer or null), `signal` (integer or null),
  `outputs` (relative paths), `stdoutTruncated`, `stderrTruncated`,
  `errorCode` (null or fixed non-sensitive code).

Guest results, output bytes and exit status remain untrusted. Each output is a
captured proposal, not a claim of quiescent final filesystem state. The host may
stage candidates privately while receiving them, but no host workspace export
can occur until VM physical settlement and a separate reviewed export action.

The Swift helper uses stdio NDJSON wrappers. `--describe-build` is passive.
`--run CONFIG_PATH CONFIG_SHA256` reads a private bounded config and emits
`event:helper-ready` with protocol/actionId/nonce/configSha256/pid. It MUST NOT
boot before the parent sends a matching `command:start`. The parent first binds
and durably records the exact helper PID/start. Config includes exact canonical
kernel/initrd paths and SHA256, jobRoot, actionId/nonce, cpuCount:2,
memoryBytes:2147483648, bootTimeoutMs, maxFrameBytes:262144, logLimitBytes:1048576
and a private 32-byte receipt key as `receiptKeyHex` (never guest-visible/logged).

Parent commands: start; guest-frame (payload object); stop (fixed reason enum).
The helper emits helper-ready, vm-starting, vm-running, guest-connected,
guest-frame (payload object), console (bounded base64), stopping, vm-stopped,
error (fixed code), and terminal. All events include the same scope/config hash.
Guest frames cannot become helper lifecycle events. Receipt key stays on the
host; boot arguments and guest messages never contain it.

EOF, cancellation, runtime/boot timeout, malformed guest data or output overflow
must stop the exact VM and settle channels. Normal guest result also initiates
whole-VM stop, even if descendants still run. Record physical stop only from the
actual VZ stopped state/delegate/completion; an error callback alone is not proof.

The helper durably writes `stopped.json` beneath jobRoot AFTER stopped observation
and channel closure. Envelope is `{bodyBase64,macHex}`: body bytes are a bounded
JSON record, mac is HMAC-SHA256(receiptKey, raw body bytes). Body binds protocol,
actionId, nonce, configSha256, helper pid, `vmState:stopped`,
`channelsClosed:true`, `stopEvidence` (host-stop-completion/delegate-stopped),
reason and timestampMs. Persist/fsync before exit. Main additionally joins the
exact helper process; guest output and PID absence without that receipt cannot
release an unknown/held owner. No replay after lost acknowledgement.

`channelsClosed` covers guest vsock, console and pending connection operations.
The helper control stdout remains open only to emit its bounded final events;
the parent's exact process/stdio join settles that final channel. The parent
records `launchAttempted:true` durably before attempting to write START. A
joined helper with no attempted START can be recorded as `never-started`, without
inventing a VM stopped receipt. Once START was attempted, stopped proof is
mandatory even if its write acknowledgement was lost.

The guest agent owns the vsock service as root. Each selected job uses fixed
UID/GID 1000, sanitized environment, `/workspace` cwd and stdio-only child file
descriptors. Input/output paths must also reject file/parent collisions; frames
have ordered begin/contiguous nonempty chunks/hash/end sequencing. Normal job
exit must not wait indefinitely for pipes inherited by background descendants.
