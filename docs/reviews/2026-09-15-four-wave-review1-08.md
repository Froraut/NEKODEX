# Four-wave review, wave 1 lane 8 — account identity and allocation

Baseline `3a66157`. Manual source review of `launcher/electron/account-pool.cjs`, its direct control-server and browser-host turn paths, and the generation-4/tunnel result notes. No tests, typechecks, scripts, account actions, code changes, installation, or publication.

## Potential finding (1)

### R1-8-1 — Pinned new turns bypass account readiness after a connector/model change

- **Trigger:** A prior task has a persisted account routing affinity for a non-default account. A subsequent *new* automatic turn for that task uses a fresh conversation key (or no retained tab), requests a different model effort or the generation-4 connector, and that account is now unauthenticated, lacks verified model capability, or has not passed the exact new connector check. `src/adapters/chatgpt-web/index.ts:691` supplies the stable task routing key; `browser-worker.ts:4433-4444` supplies effort and, for connector-bound conversations, the current connector identity; `control-server.cjs:285-293` forwards them.
- **Code path:** `account-pool.cjs:306-309` resolves the persisted task owner and `:327-328` immediately returns it. The checks for authentication, capability and connector readiness at `:314-325` only run for unpinned candidate selection. `:375-393` then starts a turn on that owner; `browser-host.cjs:2424-2436` creates a fresh tab when there is no exact retained tab. Nothing in this fresh-tab path validates the account's verified connector or model capability.
- **Consequence:** The pool may accept a fresh lease on an account it would reject for an equivalent unpinned turn. The later browser/model/connector step can fail after tab acquisition, with the normal early “No enabled ChatGPT account is ready…” message skipped. The affinity must remain on its original owner; the appropriate disposition is an explicit readiness failure, not reassignment.
- **Counterevidence and scope:** Pinned ownership is intentional, including disabled-account continuations (`account-pool.cjs:327`). A truly retained conversation is separately checked against its exact connector identity by `account-pool.cjs:389` and `browser-host.cjs:2322-2343`; this finding concerns a *new* turn with prior task affinity, not a retained old Native3/Zero Risk2 tab. Selected-mode primary-account leniency (`account-pool.cjs:317`) is also separate. Source proves the readiness bypass, but no live generation-4 account failure was reproduced. Severity and the precise downstream error depend on account state and request route.

## Boundaries (no additional defect counted)

- `account-pool.cjs:95` computes connector readiness from an exact verified name; `:210-227` clears an older claim before and after a failed check. These are consistent with the migration note's per-account readiness boundary.
- `account-pool.cjs:308-313` rejects contradictory task/conversation ownership, and `:389` plus `browser-host.cjs:2322-2343` reject unavailable old retained connector tabs rather than silently relabeling them.
- The generation-4 result note explicitly leaves live ChatGPT plugin creation, schema load, native approval, and real retained-task transition unproven. That absence of live proof is a delivery limitation, not another source defect. The tunnel-upstream note's synthetic and bounded checks likewise do not establish live account behavior.

Counts: **1 potential finding, 0 optional improvements, 0 further defects**. Code remains unchanged.
