# Four-wave review 1, lane 12 — retained turn lifecycle

Baseline: `3a66157`. Scope: manual source review of `src/adapters/chatgpt-web/index.ts`, `turn-execution.ts`, and direct cancellation caller `src/server.ts`; consulted `2026-09-15-connector-generation4-results.md` and `2026-09-15-tunnel-upstream-results.md`. No code change, test, typecheck, script audit, installation, or publication.

## Potential findings

**0.** No `R1-12-n` ID assigned. The reviewed paths do not support a concrete new defect with a trigger and consequence.

## Counterevidence and boundaries

- Retained release is keyed to the conversation and kept attached until the Launcher callback succeeds (`turn-execution.ts:795-886`). Failed acknowledgements remain retryable through the next owner and compaction cleanup (`:650-658`, `:759-767`). Physical settlement is awaited before release; `index.ts:93-120` makes the ordinary worker's physical settlement resolve even if its browser result rejects, and `src/server.ts:1023-1045` observes interrupted-turn cleanup failures.
- Owner replacement waits for physical settlement (`turn-execution.ts:666-703`), while supersession requires a canonical predecessor instruction (`:675-687`). Compaction preserves only an already final response and retires the retained epoch before returning the summary (`index.ts:983-1099`; `turn-execution.ts:779-886`). Generic failure handling retires retryable sessions, journals deterministic terminal errors, and leaves Automatic aborted observers eligible for exact reconnect (`index.ts:1404-1458`).
- Generation4 changes connector names and optional `codex_exec` approval fields at the public gateway. No reviewed retained-turn key or release path depends on the old public connector name. The migration report explicitly states that account-side schema load and real retained tasks across transition have no live proof; that absence is a verification boundary, not a source defect. Native4 / Native4 DEV / Zero Risk4 remain the canonical identities.

## Optional improvements / known limitations

- `releaseOtherOwnerConversations` (`turn-execution.ts:707-744`) uses a separate release path from `closeConversationAndWait`, but retains attached entries and retries on a subsequent owner attempt if release fails. Unifying those paths could simplify reasoning; no observed lost acknowledgement or double submission establishes a defect.
- In-memory replay and retained release obligations do not themselves establish survival across a process restart. The two consulted results make no claim of end-to-end installed-app or account transition proof.

Counts: **0 potential defects; 1 optional simplification; 1 known proof boundary**. Source review only.
