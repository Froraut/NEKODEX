# Real macOS SSH/SFTP and remote worktree acceptance

Observed 18 October 2026 using the actual development renderer and system OpenSSH.
The user allowed selection of an existing SSH destination. The run used a known
Linux host, its existing dedicated key and existing known-host verification.
No SSH configuration, credential, server package, service or business project
was changed. All remote writes were confined to a newly created private directory
under /tmp, containing only this test's Git repository and managed worktree.

| User flow | Actual result |
| --- | --- |
| Add/select an existing Host alias | Saved explicit profile; no connection until Connect |
| Connect and list | Real SSH authentication, canonical root and SFTP hello.txt listing |
| Open file | Read the initial NEKODEX_REMOTE_BASELINE text |
| Edit/save | SFTP wrote and read back NEKODEX_REMOTE_EDITED plus LF |
| Preview/run a command | Exact account/root/command/timeout review, then sha256sum hello.txt exited0 |
| Independent content | SHA256 84573d23b41d3c61d5353a449d4dadc6b4c8ec53c3e5b312e2f8c1e11fb2b6fc |
| Create managed worktree | Explicit review, codex/remote-qa-20261018, pinned original Git HEAD |
| Open worktree as remote workspace | Retained original SSH alias/overrides, separately connected, read original baseline |
| Archive worktree | archived state and refs/nekodex/remote-archives recovery ref; original folder retained |
| Independent archive check | Recovery ref matched original HEAD, worktree file retained baseline, source kept its edit |
| Cleanup | Both test connections closed; final core/GUI exit0; exact owned /tmp fixture removed afterwards |

The first connection refused the existing configuration before spawning because
the bounded parser did not accept its ordinary strict-checking and timing
directives. The supported subset now accepts only StrictHostKeyChecking=yes,
ConnectTimeout1–60, ServerAliveInterval1–300 and ServerAliveCountMax1–10.
Every matching occurrence is validated. Values compile once into the exact
transport arguments; legacy direct defaults, key-metadata/config pins,
BatchMode and strict known-host checking remain unchanged. Include, Match,
proxies and arbitrary configuration execution remain unsupported.

The live run also found two UI issues. Initial automatic worktree listing
started before the parent connection's directory load released its host lock.
It now waits for the parent/host to be idle, without retries or timers. The
corrected live connection listed the existing worktree without that error.
Opening a worktree had copied the resolved display endpoint, losing the selected
alias and dedicated identity. The main owner now exposes a bounded nonsecret
configuredEndpoint. New-root cloning and profile reuse use that original
connection mode and its explicit or inherited user/port fields. A direct
profile is not reused as an equivalent alias. The corrected live Open flow
authenticated and read the worktree using the original alias.

Focused SSH parser/service tests covered accepted settings, invalid ranges and
weaker policies, duplicate directives, drift and new-root cloning. Both
TypeScript targets, renderer198 and the architecture map passed. Real SFTP
read/save, approved command, create/Open/archive and cleanup are separate from
those fixtures.

The archive operation itself retained the worktree files and recovery reference;
the later explicit test cleanup removed the entire isolated fixture. Its
historical offline development profile and signed archive receipts remain in
the private test state. They are not an installed production profile and do
not refer to retained server files after cleanup.

This proves the stated manual remote flows. It does not claim a real
Native-to-remote Agent execution, arbitrary SSH configuration compatibility,
remote conflict-free writes against concurrent changes, or a complete
remote Git-review UI. SFTPv3 timing limits and the fact that command cwd is not
an OS sandbox remain explicit.

Private evidence: remote-fixture-setup-20261018.json,
remote-before-worktree-archive-20261018.json,
remote-final-registry-20261018.json,
remote-archive-verification-20261018.json and
remote-fixture-cleanup-20261018.json in the task workspace.
