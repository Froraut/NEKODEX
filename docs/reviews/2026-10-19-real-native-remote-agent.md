# Real Native Agent to SSH workspace

The existing Native and remote owners were exercised together on macOS against
an actual SSH host. This was an acceptance gap, not a missing transport: no second
sender or SSH executor was added. The run used source `359fba4`, a previously
authenticated personal Pro-family profile and `gpt-6.1-sol`.

All remote files belonged to a fresh private directory under `/tmp`. The selected
existing SSH alias, dedicated key metadata and strict known-host verification
were preserved. No SSH configuration, account credential, server package, service
or business directory was changed. The command ran with the SSH user's full
permissions; its selected root was a working directory, not an OS sandbox.

## Observed flow

| Boundary | Actual result |
|---|---|
| Host selection | New saved profile added through the actual DEV UI; connecting was a separate explicit action; SFTP listed only `invoice.json` and the QA ownership marker |
| Task attachment | Exact connected host/canonical root attached to a fresh task family/generation/revision; global MCP remained off |
| Goal | One actual UI Run, limit four turns and one worker; no manual Step |
| First Native proposal | `remote/read` for `invoice.json`; approved separately |
| Second Native proposal | Exact previously reviewed `remote/command`, timeout 30 seconds; approved separately; one `summary.csv` created using exclusive creation |
| Third Native proposal | `remote/read` for `summary.csv`; approved separately |
| Continuation | Three durable automatic continuation dispatches; four completed Native offers in one binding/thread, no pending tool calls |
| Remote authority | Three signed terminal main intents linked to two read receipts and one command receipt; exact binding and ToolJournal scope retained |
| Independent artifact | Separate read-only SSH observation confirmed owner marker, unchanged source SHA, exact 251-byte CSV text and expected artifact SHA |
| Visible result | DEV task showed four of four turns, all three completed tool outcomes and the final arithmetic |
| Retirement | Task attachment revoked; active remote operations zero; Native execution closed with authentication retained; SSH separately disconnected; only exact owned QA files/root removed |

Task: `74d87ad4-bab2-4180-8dc9-9ad10ae6349e`.
Native thread: `01a151c8-4b14-7617-8c73-4a125f872d25`.
The final arithmetic was `2 × 20.22 = 40.44`, `5 × 10.56 = 52.80`, total `93.24`.
Artifact SHA-256:
`a4dcaae0e65859f91ffd0a05d7f23673e414303e931fd6214218f43ee953d8b3`.

Canonical input was checked in the actual selected binding's journal, limited to
this task's four action IDs. Neither the fresh source marker nor the expected
total was present in the first user input. The actual ordered tool-result inputs
were empty, `remote/read`, `remote/command`, `remote/read`. The final canonical
answer matched the independently observed marker and arithmetic.

Each approval was performed by the QA agent through the supported exact-call
owner. These are not claims of personal human confirmation. The task honestly
remained `review_required`: the separate QA artifact observation is not a generic
in-product business-outcome observer or a `verified_complete` task receipt.
Monetary cost remained unknown.

Private evidence includes preparation/three distinct approval intents,
`native-remote-native-receipts-20261019.json`,
`native-remote-independent-artifact-20261019.json`,
`native-remote-final-owner-records-20261019.json` and
`native-remote-retirement-20261019.json` in the task workspace.

## Remaining scope

This proves the normal Native-to-SSH proposal/approval/effect/continuation path.
It does not prove real network-loss reconciliation, long remote worker lifetime,
arbitrary SSH configuration support or installed delivery. The retained lost-HTTP
fixture remains separate from a real network interruption.

Full remote Git Review remains a separate implementation described in the
[remote Git contract](../design/remote-git-review.md). It is not supplied by this
command flow or by the existing worktree controls.

The run exposed `/healthz` reporting requested port `0` instead of the bound
ephemeral port. A separate source fix now reports `server.port`; one real loopback
test passed ten assertions, including reconnecting through the advertised port
and exact cleanup. The explicit fetch return annotation also passed root
TypeScript. The already-running user DEV pair was preserved and still requires
a later coordinated core replacement to load this small health fix.
