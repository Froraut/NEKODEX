# Restricted skill scripts and SSH aliases — 18 October 2026

This source batch follows published `6c91ab8`, whose four exact
[CI jobs passed](https://github.com/Froraut/NEKODEX/actions/runs/39160380988).
Previous source CI does not verify the new script/sandbox/SSH bytes. Source/DEV
remains `.9`; installed D01 remains `.8`. Actual Native human authentication and
model admission are still absent; no release or installed update is claimed.

## Script result and limits

Selected JS/MJS32 KiB entries use v3 packages with16 resources/512 KiB; v1/v2
identities are unchanged. Metadata-only selectedSkills, immutable package closure,
separate task-generation workspace grant and same ToolJournal per-call approval
separate import, attachment, filesystem access and execution. Schemas enumerate
at most8 current grants,128 retained operations per process; grants do not restore on restart.

A fixed pinned Bun bootstrap invokes sandbox_init before selected import, denying
fork/all further exec/network operations while disclosing permitted socket
allocation, global file metadata and system-library reads. Scoped workspace roots
are read-only or read-write; readable mutable data may still be interpreted, so
there is no universal immutable-code-origin claim. Supervisor PID/start/permit
persistence precedes import;15-second/16 KiB output/2live/256retained limits and
EOF/timeout/output/cancel handling bound the execution. SIGKILL/lost-owner results
remain unknown/no replay. A peer P1 found fresh-instance live-owner close/restart reconciliation incomplete.
The fix now scans at most256 retained private receipts before status/admission/close,
reports recoveryRequired/supportfalse and holds fresh-instance close for live or
missing-receipt ownership. Root lazy close also loads retained directories. Exact
pinned kernel proof below passed; peer closure re-review closed P1 with no additional material findings.

## SSH result and limits

Saved profiles can explicitly select bounded Host aliases; old direct profiles,
fingerprints and argv remain unchanged. Adding/listing does not read config or
connect. Explicit Connect resolves canonical `~/.ssh/config` data only, with
64 KiB/2048-line bounds, supported Host patterns/first-value endpoint options and
up to8 IdentityFiles. Include/Match/ProxyCommand/ProxyJump and unsupported active
configuration refuse before spawn; no `ssh -G`, shell evaluation or rewriting.
The owner still uses `-F /dev/null` with compiled safe options, BatchMode and strict
host-key checking. Config/key metadata/effective options pin the connection;
drift requires reconnect/new approval and cannot inherit old worktree/Agent
scope. Default agent/known_hosts remain OpenSSH-owned. This fixes the bounded
alias/config source gap, not full OpenSSH-config parity or real authentication.

## Focused evidence

| Boundary | Observed result | Limit |
| --- | --- | --- |
| Script package store | 2 cases/101 assertions passed | New47 + legacy54; exact immutable packages |
| Script provider/current attachment/grants | 1/83 passed | Injected ports; no real account |
| Exact pinned macOS Bun execution/restart boundary | 3/39 passed,2.41 s | Bun1.4.0 build34cbb9a40; fresh status/admission/close held until exact physical cleanup; then close passed, original effect still unknown; missing receipt also held |
| Actual publicHTTP/store/runtime/ToolJournal + real macOS script | 1/61 passed,480 ms | Fake Native model adapter; no effect before approval, actual transform/append once, duplicate cache/detach/continuation review_required, cost null/no evidence |
| Actual Chrome155 component + actualHTTP | 1/58 passed,1.71 s | Inert executor0/modelnone;133-byte code imported once/unattached, picker alone0grant, changed access/generation resets ack, explicit generation2 read-only grant/revoke |
| Guarded picker/grant/privacy IPC, pinned Bun1.4.0 | 1/10 passed | Picker0authority; drain allows observe/revoke and refuses new picker/grant |
| SSH alias/config boundary | 1/44 passed | Temporary config/key metadata/injected transports, not live SSH |
| Independent SSH peer review | No material findings | Bounded source/fixture review |

The component screenshot/JSON are retained at workspace
`reviews/evidence/full-adoption/skill-script-preview-20261018.{png,json}`; the root
visually inspected the screenshot and read the receipt. Exact browser/server/temp
state closed. The133-byte reviewed code SHA256 is
`418cd4094b62e568716db79d6c19aa088608a52706be0dee5fc94a46e5c66e54`.
Headless DOM does not establish Electron/full-app or model execution.

Both TypeScript projects passed at20:02 after the final owner-hydration fix.
Renderer197 modules passed in1.20s; the existing large-chunk advisory is nonblocking.
PlainCLI648 modules/11.29 MB/exact `6.1.32-nekodex.9` passed at20:04. Module-map
contains737 modules; final check and documented paths passed after docs freeze.
The verified temporary CLI was removed. Exact pinnedBun1.4.0 build34cbb9a40 SHA256
`539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf`
executor3/39 passed2.41s; no owned fixture processes remain. Peer review closed the
P1 restart/lazy-close findings with no additional material findings. Source publication and exact CI are tracked in the current task delivery ledger. Existing unchanged checks are reused. Actual SSH/UI/authentication
and remote mutation remain open, as do broader Python/shell/network/PDF/binary
skill formats. P03/P16/P17 remain partial; all44 macOS-first capabilities and
Windows/Linux phase2 are retained. See [script contract](../design/restricted-skill-scripts.md),
[SSH contract](../design/remote-ssh-config.md) and [full program](../design/full-adoption-program.md).
