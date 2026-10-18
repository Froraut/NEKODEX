# Explicit SSH Host aliases

Remote workspace profiles can explicitly select `ssh-config-alias`. Existing
profiles remain direct connections with their original serialized configuration,
fingerprint and OpenSSH arguments. Adding or listing an alias profile does not
read SSH configuration or connect. Only explicit Connect resolves the alias.

The data-only resolver reads the current user's canonical `~/.ssh/config`, with
64 KiB/2048-line limits. It supports Host patterns (including negation, `*` and
`?`), first-value HostName/User/Port/IdentitiesOnly/HostKeyAlias and up to eight
IdentityFile entries. Blank user/port inherit configuration, then the current OS
user/22. Explicit user/port override configuration. IdentityFile supports `~/`
and `%d`, `%h`, `%r`, `%n`, `%p` expansion. Private key bytes are never read by the
resolver; only referenced file identity metadata is pinned.

Matching blocks may also declare `StrictHostKeyChecking yes` (case-insensitive),
which agrees with the transport's fixed strict checking. Every matching value
must be `yes`; `no`, `ask`, `accept-new` and other values refuse before connection.
ConnectTimeout (1–60 seconds), ServerAliveInterval (1–300 seconds), and
ServerAliveCountMax (1–10) accept decimal integers only. Every matching value
is validated; the first matching value wins. Aliases compile these values into
the single transport argument for each option, with defaults of 15/15/3. Direct
profiles retain their original 15/15/3 arguments. These options and their source
bytes remain part of the pinned connection fingerprint.

This does not add custom `UserKnownHostsFile` support or alter default known_hosts.

This is deliberately a bounded subset, not full OpenSSH config parity. Include,
Match (including exec), ProxyCommand, ProxyJump and other active unsupported
directives refuse before any SSH process starts. Unsupported directives in an
unmatched Host block are ignored; Include/Match refuse anywhere because their
effects cannot be skipped safely. No `ssh -G`, shell/config command evaluation,
automatic connection, arbitrary config-file picker or config rewriting occurs.

The existing SSH owner executes fixed argv with `-F /dev/null`, compiled selected
identity/key-alias options, resolved endpoint/user/port, BatchMode and
StrictHostKeyChecking. The default SSH agent and known_hosts remain OpenSSH's
responsibility. Unknown or changed host keys are never accepted automatically.

Each connected alias session pins source bytes and inode/timestamps, referenced
key metadata and effective options. Its effective fingerprint includes the saved
profile fingerprint and snapshot fingerprint. Existing human command approvals,
remote Agent attachment and worktree scope therefore bind to the exact resolved
connection without a new sender. Before further work and each physical SSH
connection the snapshot is revalidated; drift requires disconnect/reconnect and
new approval. Restart restores only the saved alias profile and never a live
snapshot or previous connection authority. The UI shows the original alias and
resolved destination after connection.

Connected alias projections also expose the saved hostname/user/port and mode as
`configuredEndpoint`, without credentials or key contents. Opening a managed
worktree as another remote root copies that saved endpoint, including blank
inherited values or explicit user/port overrides, rather than the resolved
display endpoint. Existing-profile reuse compares the saved endpoint and mode.

The focused fixture uses only temporary config/key metadata and injected local
transports. It establishes argv, inheritance, unsupported-directive refusal,
drift fencing and old-approval invalidation. It does not establish real SSH
authentication, host-key acceptance, remote mutation or installed UI delivery.
