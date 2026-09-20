# IPC and loopback resilience/security review — code lane 12

Reviewed source state: branch `codex/account-limits-login`, commit `e10c52acb23da1c05d401faaa49d0b34c912e830` (`5.6.0-nekodex.3` release context supplied by the parent).

Method and limits: manual, read-only source review. No tests, builds, scripts, exploits, live authentication, runtime actions, source edits, or child agents were used. The only write is this report. Primary scope was `launcher/electron/control-server.cjs`, `preload.cjs`, `logging.cjs`, `external-links.cjs`, and `remote-permissions.cjs`; direct-caller review covered the relevant portions of `main.cjs`, `browser-host.cjs`, `account-pool.cjs`, `retained-turn-release.cjs`, `native-proxy.cjs`, `atomic-file.cjs`, `src/launcher-browser-host.ts`, `src/native-network.ts`, and the retained-conversation caller in `src/adapters/chatgpt-web/index.ts`.

## Findings

### 1. Retained-conversation release reports success through the selected account instead of the owning account

**Importance:** Medium resilience / ownership defect. Confidence: high. This is observed in source.

**Exact locations:**

- `launcher/electron/account-pool.cjs:54-61` — unknown methods are proxied to `selectedHost()`.
- `launcher/electron/account-pool.cjs:92` — `turnTabs` is an aggregate of every account host.
- `launcher/electron/retained-turn-release.cjs:1-14`, function `releaseRetainedConversation` — it filters the aggregate map, then calls `host.removeTurnTab(tab, false)` and returns the number filtered rather than the number actually removed.
- `launcher/electron/browser-host.cjs:1667-1669`, method `BrowserHost.removeTurnTab` — a host silently returns when the tab is not in that host's own map.
- `launcher/electron/control-server.cjs:154-160`, `BrowserControlServer.handle` — `/v1/turn/release` publishes that filtered count as a successful release.
- Direct caller: `src/adapters/chatgpt-web/index.ts:467-470` invokes the release by `conversationKey` without an account owner.

**Trigger:** account A owns a ready retained tab for conversation key `K`; account B is selected when the runtime calls `POST /v1/turn/release` for `K`. The pool's aggregate `turnTabs` finds A's tab, but Proxy dispatch resolves `removeTurnTab` on selected host B. B does not own the tab and returns without removing it. `releaseRetainedConversation` still returns `1`, so the control server acknowledges `{ok:true,released:1}` while A's retained browser/session state remains live.

**Impact:** the runtime drops its release obligation based on a false acknowledgement while the account-owned retained surface survives until another cleanup path or TTL. That breaks the exact account/lifecycle ownership contract and can leave stale authenticated browser state available for later reuse or capacity consumption. The source proves the false-success path; later reuse or user-visible cross-account confusion is inferred and was not reproduced live.

**Minimal fix:** implement `AccountBrowserPool.releaseRetainedConversation(conversationKey)` as an explicit pool method. Resolve exactly one owning host from affinity and/or that host's own `turnTabs`, invoke `owner.removeTurnTab(tab, false)`, and count only a confirmed removal. Reject duplicate owners and return zero for no owner. Have `control-server.cjs` call that pool-owned method instead of the generic helper over the proxied pool. Bind the release to the account owner already recorded for the key if that identity is available at the caller.

### 2. External-link private-address validation is not bound to the browser navigation

**Importance:** Medium defensive SSRF/local-network hardening gap. Confidence: medium. The check/open separation is observed; successful exploitation depends on DNS timing and system-browser/network behavior and is therefore inferred.

**Exact locations:**

- `launcher/electron/external-links.cjs:111-134`, function `createExternalLinkBroker.open` — the broker resolves the hostname with `dns.lookup`, verifies the returned addresses, then gives the original hostname URL to `shell.openExternal`.
- Direct callers: `launcher/electron/browser-host.cjs:855-865`, `975-1000`, `1058-1070`, and `1837-1855` broker remote-surface `window.open` requests after a recent gesture.

**Trigger:** an attacker-controlled hostname first resolves to a public address during the broker's `dns.lookup`, passes `publicAddress`, and then resolves to loopback/private space when the system browser independently resolves the unchanged hostname opened by `shell.openExternal`. A recent native gesture on the visible remote surface is required and is consumed correctly, but it does not bind the checked DNS result to the later connection.

**Impact:** the implemented private/loopback filter can be bypassed by DNS rebinding, potentially opening or interacting with a local-network service in the user's ordinary browser origin. Whether a specific local service can be read or changed depends on that service's Host/origin checks and the system browser's private-network controls; no live exploit was attempted.

**Minimal fix:** do not describe a preflight DNS lookup followed by `shell.openExternal(hostname)` as an enforceable private-network boundary. For links originating in remote surfaces, the smallest reliable policy is an explicit trusted-host allowlist. If arbitrary destinations are required, open them through an app-controlled navigation path that enforces destination IP policy on every connection/redirect and prevents DNS rebinding; a second best-effort lookup immediately before `openExternal` only narrows the race and is not a complete fix.

## Reviewed controls and non-findings

- `BrowserControlServer` binds to `127.0.0.1`, uses a random 32-byte bearer token and constant-time comparison, exact method/path dispatch, bounded JSON bodies, and validates turn ownership again in the owning browser host. The descriptor carrying the token is written atomically with private directory/file modes and is revalidated as a loopback endpoint by `readLauncherBrowserHostDescriptor`.
- Browser-origin requests cannot supply the bearer header without a preflight; the server does not grant CORS. Missing `Origin`/`Host` checks are useful defense in depth, but no token-recovery or browser-only authorization bypass was established from current source, so this is not reported as a finding.
- Main renderer IPC is constrained to the current main `webContents`, its current top-level frame process/routing identity, and the exact packaged renderer URL (or configured development origin). Every registered invoke/event handler goes through that authorization callback.
- Remote permission handling is fail-closed, limited to one visible owned main frame, compares the full committed URL across asynchronous consent, invalidates on navigation/renderer loss, and leaves deny handlers installed at teardown.
- `/v1/network/resolve-proxy` accepts only the first-party `https://chatgpt.com/backend-api/codex/` path before consulting the system proxy. No general URL-fetch SSRF was found there.

No other concrete important finding was established in the requested scope.
