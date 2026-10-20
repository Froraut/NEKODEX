# NekodexTaskMonitor

`task-monitor` is a named consumer of the existing bundled `local-api` CLI. It
never starts the core service. Use the origin shown in **Local control API** on
an already running core, enable its read token explicitly, and use your secure
credential manager to pipe one token line to stdin. Credentials are never CLI
arguments, environment variables, journal fields or output.

```sh
# Substitute your installed CLI and the already running core's numeric origin.
# secure-read-token is your own credential-manager command, not supplied by NEKODEX.
secure-read-token | codex-chatgpt-web task-monitor snapshot \
  --origin http://127.0.0.1:60549 --journal-dir "$HOME/.nekodex-task-monitor" --token-stdin
```

Snapshot reads status, one page of up to 100 Agent task metadata rows (including
family, generation and revision), and history coverage counts. `hasMore` is
preserved; it does not claim a complete inventory. An unavailable owner remains
unavailable. No transcript is requested, even when history-content access was
enabled separately. `api enable/key` belongs to the distinct model protocol API
and does not create this read credential.

An explicitly requested Pause requires the separate existing administrative
control credential and the exact task/family/generation/revision observed in
metadata. A read token cannot perform or reconcile an action. Choose one stable
action ID for that intent and keep it across invocations:

```sh
secure-admin-token | codex-chatgpt-web task-monitor pause \
  --origin http://127.0.0.1:60549 --journal-dir "$HOME/.nekodex-task-monitor" --token-stdin \
  --task-id TASK --family-id FAMILY --generation 1 --revision 1 --action-id pause-TASK-001

secure-admin-token | codex-chatgpt-web task-monitor reconcile \
  --origin http://127.0.0.1:60549 --journal-dir "$HOME/.nekodex-task-monitor" --token-stdin \
  --action-id pause-TASK-001
```

Pause first creates an exclusive private journal record and flushes it before
invoking the bundled CLI once. Reusing its ID returns that local record without
POSTing. A transport failure or process crash leaves `unknown`; reconcile only
GETs the existing owner's durable command result with the original exact scope.
No result, an unavailable owner or an authentication failure preserves unknown.
Never delete an unknown record or create a new action ID merely to retry it.
Resolve the original outcome with the owner first. Completed receipts describe
owner acceptance/state, not independent business-result verification.

The reusable TypeScript class is `src/local-control-api/task-monitor.ts`.
Its `cli` array must name the existing bundled executable (or runtime plus CLI
entrypoint), and `journalDirectory` must be a private directory dedicated to this
consumer. It provides `snapshot(readToken)`, `pause(exactScope, adminToken)` and
`reconcile(actionId, adminToken)`. It has no timer, watcher or automatic sender.
