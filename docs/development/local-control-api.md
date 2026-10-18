# Local control API v1

This supported local surface is disabled by default. The launcher owner explicitly enables it and receives one newly generated read credential. The Electron registrar consumes that credential in main and copies it once; renderer snapshots never receive it. Copying can fail after creation, in which case the user must explicitly rotate the credential. There is no credential recovery or automatic rotation/retry.

The private policy is `<coreHome>/local-control-api/policy.json`, in an owner-only directory with an owner-only file. It contains an enabled flag, SHA-256 token hash, and a separate saved-history content permission. It never contains the raw token. Writes preserve the captured policy snapshot and reject a competing change. Disabling revokes access immediately and clears content consent. Rotation invalidates the previous token immediately. The read token is distinct from the server control bearer and starts with `nk-read-`.

## Read routes

Send `Authorization: Bearer <READ_TOKEN>` to the current owned runtime's exact loopback origin, for example `http://127.0.0.1:17841`. Use the actual configured port. Host, Origin, fetch-site and peer-IP guards apply; there is no cross-origin browser permission. The API has no account credentials, shell, arbitrary destination URL, file-path command, runtime-start or provider-send operation.

| Route | Result |
| --- | --- |
| `GET /api/v1/status` | Whitelisted service version, readiness, optional active counts, effective read permissions. |
| `GET /api/v1/tasks` | Task metadata: ID/state and optional kind/mode/generation/revision/timestamps. No title, prompt, goal, source path or account fields. |
| `GET /api/v1/agent-tasks` | The same metadata projection for already-owned Agent Mode tasks. Reading never starts a runtime or task. |
| `GET /api/v1/history?view=coverage` | Recording/coverage counts and content-access state, without thread IDs or text. This is the default history view. |
| `GET /api/v1/history?view=threads` | Saved history thread identities and coverage, only after separate explicit history-content consent. |
| `GET /api/v1/history?view=messages&clientId=…&threadId=…` | Latest recorded user/assistant message text and exact revision links, only with content consent. Percent-encode identities. |

Task/history lists accept `limit` (1–100, default 30) and `offset` (0–1,000,000). Pages disclose total and remaining rows. Responses have an explicit 2 MiB bound; reduce the page size on `response_limit_exceeded_reduce_page` (`413`). No text is silently truncated. Unknown query parameters are rejected. A missing passive source returns `source_unavailable` (`503`) instead of inventing an empty successful snapshot.

JSON envelopes include `apiVersion: "1"` and either `{ok: true, value: ...}` or `{ok: false, error: {code: ...}}`. Responses use `Cache-Control: no-store`. Other important codes are `api_disabled` (`404`), `invalid_read_credential` (`401`), `history_content_consent_required` (`403`), `read_only_credential` (`403`) and `route_not_found` (`404`). Read tokens cannot authorize any non-versioned/admin route, enable content permission or upgrade their authority.

History coverage remains unknown for a full original transcript. Content permission exposes only text already explicitly retained by the history owner; it does not enable recording, discover/import client transcripts, redact credentials, or grant system/developer/tool-content capture.

## Administrative routes and action ownership

`POST /admin/local-control-api` uses the existing control bearer, exact local guard and loopback peer check. Its bounded JSON accepts `action: status | enable | disable | rotate | history-consent`. Enabling and rotation require `consent: true`. History-content permission uses `{action: "history-consent", enabled: true, consent: true}` and is independently revocable. Only an enable/rotation receipt can contain `readToken`; it is returned once and must never be logged or retained in a UI snapshot.

`POST /admin/local-control-api-action` also requires the existing administrative authority. It accepts exactly `taskId`, `actionId`, `familyId`, `generation`, `revision`, `operation` (`pause`, `resume`, `stop`, `step`, `review`) and `explicitUserAction: true`. It delegates once to the already-owned `AgentModeRuntime.executeScopedAction` owner. That owner checks a stable durable action ID before current scope, so an unchanged retry reuses its receipt; a stale scope or changed payload conflicts. Admission, dispatch outbox, cancellation, quotas and provider execution remain with Agent Mode. This module has no second action queue, sender, retry loop or scheduler. No action can enable loop mode, alter a plan or execute an arbitrary command.

## Server composition

Create `createLocalControlApiRoutes` with explicit `coreHome`, existing `authorizeAdmin` and `localGuard`, live `port`/`peerAddress` callbacks and passive `sources`. Mount it after the ordinary local boundary and **before other authentication or inference/admin dispatch**, so any `nk-read-` bearer is denied outside its read routes. An unrecognized unrelated request returns `undefined` for the existing server to handle.

Sources return whitelisted metadata, or `undefined` when unavailable. The history source returns the already-owned history store. An Agent action delegate must use the existing scoped action method; it must not create another runtime to satisfy a read or action request. The renderer's `LocalControlApiSurface` takes an injected stable `api.request` function and optional language. `registerLocalControlApi({handle, runtimeHost, clipboard})` registers `launcher:local-control-api` and uses the current supervisor's private control request, without auto-starting it.
