# Browser companion and observation-bound providers (P11–P14)

`browser-companion/` is a reviewable Chrome Manifest V3 extension. It has no
static content scripts, background browsing monitor, browsing-history permission,
account login, cookie reader, native messaging host, arbitrary evaluation or URL
execution endpoint. The first supported browser artifact is Chrome; Firefox is
not advertised as tested or supported.

`src/browser-companion/host.ts` owns private pairing, the selected main-frame
document, one queued/dispatched operation and bounded receipts. Its HTTP handler
is injected into a loopback listener by the application composition root; creating
the module does not start a listener or install an extension. The root must bind
**127.0.0.1:17843 only**, use the user's exact extension ID, and keep the bootstrap
out of public HTTP routes and diagnostics. The extension pins this same origin
both in fetch code and CSP. No task/model argument can select a different host.

`runtime.ts` supplies the actual application owner: `createBrowserCompanionRuntime`
starts disabled, and its explicit `enable(extensionId)` creates one Bun listener
on that fixed address. A conflicting/unavailable port produces an unavailable
status; it never stops an unknown owner or silently selects another port. User
disable and runtime shutdown first revoke/settle the host, retain an unknown
receipt for dispatched input, and close the owned listener. A concurrent runtime
quit joins the same shutdown promise. Neither extension identity nor enablement,
pairing secrets or page content is persisted as startup policy.

`http.ts` provides `browserCompanionRequest(req, getRuntime)` for the existing
`/admin/browser-companion` control route. The composition root must apply its
existing exact-local-request and control-token guards before this factory. It
admits only status, explicit enable/disable, create-pairing and revoke; it does
not expose browser actions or arbitrary host configuration. The runtime manager
can be constructed lazily without opening any socket.

The artifact resolver supports the exact source layout (`src/browser-companion/runtime.ts`
→ repository `browser-companion/`) and the bundled layout (`app/cli.js` → adjacent
`app/browser-companion/`). A trusted composition-root override remains supported.
It does not search the working directory, another checkout or a parent directory
when that expected artifact is missing. The runtime bundle script copies only the
extension's shipped manifest/scripts/popup/style/README into that adjacent directory
before the recursive runtime manifest is generated, so its files receive the same
hash coverage as other runtime resources. No packaging or signing is needed to
verify this path contract.

The dedicated Electron IPC registrar proxies through the current owned runtime
and the existing guarded handle. `BrowserCompanionSurface.tsx` accepts an injected
control API and shows the reviewed extension directory/manifest, extension ID
validation, listener states, pairing code, copy-and-hide, revoke, selection and
uncertain-operation state. It has English and Russian copy. Its private pairing
JSON exists only in component memory until hidden/copied/unmounted; optional
clipboard IPC validates its exact shape. It never installs an extension or sends
browser input. The root owns registration, navigation and lifecycle wiring.

## Explicit pairing and selected-tab flow

1. The local owner calls `createBrowserCompanionHost({ extensionId })`, mounts
   `host.fetch`, and displays `host.createPairing()` through its trusted local UI.
   The bootstrap JSON contains a random one-time secret; the owner must treat it
   as private and show it only for the intended human pairing operation.
2. The user loads/reviews the extension, invokes its action on the intended web
   page, and pastes that JSON into the popup. The extension checks its own ID,
   fixed host origin, protocol version and returned host ID before retaining the
   session token in `chrome.storage.session`. Browser restart clears that token.
3. The user explicitly selects **Select current tab and connect**. The activeTab
   grant from the action invocation permits a bundled isolated-world function on
   that tab's main frame. Only then does it read visible page text and control
   labels. The extension does not enumerate other page URLs or infer an account.
4. The popup sends the observation and polls its paired host while it remains
   open. This simple first transport intentionally has no service worker, alarms
   or automatic reconnect. Closing the popup stops receiving work. Reopening
   requires selecting a tab again. **Stop sharing** revokes the host session and
   forgets the local token.
5. The trusted caller uses `browserBindingOf(observation)` with `host.act(...)` or
   `host.observe(...)`; refs and coordinates cannot be supplied without a binding.
   Successful input consumes the current action observation. A document anchor
   allows a fresh read after input, while another input requires the new snapshot.

No tab URL, page text, screenshot or pairing secret is written to extension local
or sync storage. The popup and host hold one bounded observation in memory, and
the isolated world holds current refs until the page unloads or is selected again.
It observes local mutation/input counters for staleness without transmitting a
background capture. DOM text can contain sensitive material: selecting the tab is
the explicit disclosure boundary and the popup explains it. Password/file/hidden
inputs are excluded, and form values are not included as observation fields.

Chrome's `activeTab` grant may persist across same-origin navigation; the stricter
companion binding does not. The exact Chrome document ID, random document epoch,
selected scope, tab/window/main-frame and observation ID travel together.
Same-document URL changes are refused by the document function. DOM mutations,
trusted human input/scroll, changed visibility and obscured controls make old refs
unusable before input. No cross-frame action is currently supported. The provider
performs no implicit scroll, focus switching or navigation to repair an old ref.

## Protocol and outcome ownership

All wire requests are bounded JSON POSTs under `/v1/companion/`. The fixed
loopback authority and exact `chrome-extension://<selected-id>` origin are checked
before reading the body. `OPTIONS` supports only that extension. Pairing consumes
the bootstrap; all other endpoints require the random bearer token, host ID,
protocol version and session ID. Tokens never appear in URLs or sanitized status.

| Endpoint | Owner and purpose |
| --- | --- |
| `pair` | Consume the human-provided one-time bootstrap; return one session |
| `select` | Admit the popup's explicitly selected observation; changed scope cancels queued work |
| `poll` | One popup owner; deliver at most one command, marking it dispatched before responding |
| `result` | Reconcile only that operation ID and exact document owner |
| `revoke` | Retire the pairing and selected scope without replaying dispatched work |

The host has one operation slot. Queued cancellation produces `not_sent`.
Cancellation after delivery, missing document results, lost responses and partial
input produce `unknown`; no new input is admitted while that operation remains
unreconciled. A matching late receipt can update an unknown outcome and keeps
`cancelRequested: true`. It never reactivates an old observation. Foreign,
unsolicited and queued-operation receipts are refused. A changed selection cannot
erase an uncertain operation. Explicit revoke retires that session; its retained
uncertain receipt must remain uncertain in the caller's durable task journal.

Host state is intentionally in memory and receipts are capped at 100. A host
restart discards the token and old page authority; it cannot resume a send. The
task/execution owner must durably record offers and uncertain results before
dispatch and must never recreate/replay an old action after host restart. This
module does not replace the standalone tool journal or ChatGPT turn journal.

`completed/executed` means the extension reported DOM input execution. It is not
provider acceptance, account authentication, legal authorization, successful form
submission, a ChatGPT turn, or a finished business outcome. A snapshot read never
grants new permissions. Only bundled observe/click/type operations exist; arbitrary
selectors, script source, coordinates and URL execution are rejected.

## Browser and desktop provider ports

`providers.ts` exposes `BrowserProviderPort`, the companion wrapper and
`DesktopProviderPort`. Desktop binding includes provider, platform, selected scope,
exact process/window/window epoch, frame/frame epoch, screenshot ID and its pixel
dimensions. Coordinates are integer **screenshot pixels**; out-of-bounds points or
any foreign identity are rejected before calling a provider. A screenshot resource
is an opaque provider reference, not an arbitrary URL this code fetches.

`createMcpDesktopProvider` uses the existing standalone `StandaloneToolsPort` for
discovery and execution. It accepts only explicitly selected installed MCP tool
IDs, exact canonical schema SHA-256 pins and a trusted local grant callback. It
does not read a client's advertised inventory as authorization, modify account
registries, invoke native OS helpers, or install a provider. macOS and Windows
are distinct configured platform identities; success on one proves nothing about
the other.

The installed provider must implement `nekodex.observation-input.v1`: observe takes
`contract`, `providerId`, `platform`, `scopeId` and returns a validated observation
in MCP `structuredContent`. Input takes `contract`, `operationId`, `binding`,
`action`; immediately before native input it must independently check that exact
window/process/frame/screenshot and human freshness are still current. Its
structured terminal receipt must identify the same operation. A local cache alone
cannot prove that a native window has not moved. Tools without this supported
contract remain unavailable; mapping a generic click tool's name is insufficient.

Inputs consume the desktop snapshot. Permission/discovery/schema failure returns
unavailable or `not_sent`; a call offered to the MCP host without a matching
terminal provider receipt stays `unknown` and blocks that adapter. Invalidation
cannot clear unknown delivery. Reconciliation belongs to the existing durable MCP
call journal; replacing an adapter is not authorization to repeat its old input.
The generic MCP contract fixture does not prove OS capture/input. Concrete macOS
source and its separate consumer are described below; Windows remains unavailable.

## Standalone native desktop consumer (P13)

`agent-desktop-tools.ts` exports a controller/built-in around the trusted
`MacosDesktopProvider` factory. One lazily created native provider owns its helper,
selected window, raw image and input receipts. The controller starts off, stores
no enablement or task attachment across restart, and never accepts a model or
renderer helper path, command or unverified process identity. Its synchronous
`status()` and model `discover()` read cached state only; they do not instantiate
the provider, start its child, inspect windows, capture the OS or request consent.

Trusted explicit controls separately inspect permissions, list window metadata,
enable capture/input, select-and-bind one exact list row, revoke task attachment,
disable or close. Selection pins window ID, process-start identity and window
epoch from both the explicitly inspected list and a fresh native list before
selection. The global selected window is separate from task ID/generation
attachment. Replacing a selection clears prior cached authority before native
selection can commit, so a failed following status read cannot let an old task
capture the newly chosen window. OS permission prompts/settings remain external
human actions; the controller only reports preflight results.

The existing shared tool host declares `desktop/observe`, `desktop/click` and
`desktop/type` together and retains the same per-call approval, grant fingerprint,
durable journal and canonical continuation owner. An approved observe captures
only the attached exact window and emits its `DesktopObservation`/binding with
standard MCP image content. The model JPEG is bounded to 160 KiB, has the same
pixel dimensions as its source PNG, and carries its own hash and the source
screenshot ID; the full result is bounded to 256 KiB. The raw PNG, allowed up to
8 MiB by its private native resource, is never copied into this model/tool result.
The native provider validates the JPEG codec dimensions/source binding, and the
controller validates its identity and result size again. Observing discloses this
selected screenshot to the task's model and private saved tool results; it is not
permission for input.

Click/type need this task generation's exact latest window/process/frame/epoch/
screenshot binding. Coordinates are integer screenshot pixels with no scaling or
implicit window switch. Input consumes that observation and uses a stable native
UUID derived from the shared execution owner's idempotency key. Cancellation or a
soft wait without a terminal receipt retains unknown delivery and its physical
native owner. Passive `activeCount` includes that pending owner after the JavaScript
call returns; `waitForIdle` uses native owner notifications, not another request or
timer that aborts accepted input. Explicit revoke/invalidation/close abort only
their owned work. Shutdown closes the native provider before waiting for the
shared tool host to drain.

Read-only reconciliation checks the old exact operation, screenshot binding,
task scope and original action against retained native receipts. It neither starts
a helper nor observes, sends input or reactivates revoked attachments. A terminal
receipt is native input execution proof only; actual application acceptance still
requires a later observation. macOS helper source and this controller do not
establish Windows support, installed system permissions or live OS behavior from
an injected fixture.

## Standalone Agent browser consumer (P12)

`agent-tools.ts` is a built-in leaf for the existing standalone tool host. It
exports `createAgentBrowserToolsProvider({ provider, isScopeActive })` with
`serverId: "browser"`, `discover`, `execute`, read-only late `reconcile`, and trusted
task attachment controls `bind`, `revoke`, `status` and `invalidate`. It owns no
second grant store, tool journal, browser resource or model sender. The existing
host alone resolves the exact pending Agent call, obtains the human's per-call
approval, consumes its fingerprinted grant, journals unknown-before-effect, and
settles the terminal result used by canonical Responses continuation.

User selection in the extension does not attach a page to every task. Attachment
defaults off, is explicit for one task ID/generation and exact selected
session/tab/window/main-frame/document/epoch/user scope, and is held only in
memory. A correction/generation change or new user selection cannot inherit old
authority. The trusted composition supplies the runtime provider callback and
checks active task scope; no renderer-supplied URL, provider, ownership or grant
reaches execution. A tool call still needs its separate exact approval.

All three tools (`browser/observe`, `browser/click`, `browser/type`) are declared
together so the same Responses continuation retains the available tool contract.
Discovery supplies opaque selection IDs but does not disclose page URL, title or
text before an approved observation. Observe requires an exact full binding and
returns the fresh observation plus its binding. Input requires that same binding
and a returned ref; the leaf checks both the task's approved observation and the
current provider observation before delegating. Every input consumes refs, so
further input requires another approved observe. There is no arbitrary selector,
script, navigation, account selection or ChatGPT submission API.
An approved observe discloses that selected page snapshot to this task's model
context and private saved tool results; the tool description makes that boundary
explicit. Task revocation removes future input authority, without deleting the
existing execution owner's historical receipts or rewriting model context.

The execution owner passes its idempotency key through as a stable opaque
`agent_browser:<sha256>` extension operation ID. The host refuses consumed IDs
and adds the original command binding to its receipts rather than trusting a
binding supplied in extension result JSON. Cancellation after delivery remains
unknown. Reconciliation only reads a retained exact operation/binding receipt;
it works without reviving the old task attachment and never calls observe/act.
Missing receipt after runtime loss remains unknown. A terminal click/type result
is explicitly browser-input execution proof, with no website acceptance or
model-send claim.

## ChatGPT transport boundary

`companionChatGptCapability` describes an observed exact ChatGPT document only
when the trusted existing account owner supplies a matching tab/document binding.
An extension tab does not establish its account identity or tunnel ownership.
`sendSupported` remains false: the current browser worker/turn registry retains
send, account admission, cancellation, receipt and settlement ownership. There is
no fallback that turns failed companion delivery into a second embedded send.

Turning this into a selectable ChatGPT transport requires the real composition
root to bind the existing account identity epoch and turn owner, implement its
submission/response protocol, and collect an actual provider turn receipt. Generic
DOM click receipts cannot satisfy that contract. This remaining integration is
visible capability state, not a claim that P11 live ChatGPT transport is complete.

## Focused evidence and limits

`tests/browser-companion.test.ts` exercises pair/version/origin/revoke, exact
binding, consumed observations, queued/dispatched cancellation, late receipts,
navigation mismatch, generic execution refusal, and desktop MCP schema/binding/
coordinate/unknown protections. `tests/browser-companion-page.test.ts` runs the
bundled page function in an owned headless Chrome on inert local markup: observe,
type, fresh read, click, DOM/human staleness and document navigation. It closes its
browser and local server. This is a browser DOM fixture, **not** an installed
extension, a real ChatGPT account result, or live macOS/Windows input proof.
`tests/browser-companion-runtime.test.ts` adds off-by-default/one-listener and
port-conflict ownership, admin control bounds, guarded IPC, private pairing copy,
dispatched-input shutdown receipts and joining an in-flight listener shutdown.
`tests/browser-companion-artifact.test.ts` builds only the companion runtime exports
into a temporary `app/cli.js`, copies the inert source artifact, and verifies the
bundled path, manifest availability and missing-artifact refusal without running
the full runtime bundle, installers, signing or dependency installation.

`tests/browser-companion-extension.test.ts` additionally loads the actual MV3
artifact in a disposable official Playwright Chromium profile and verifies its
enabled extension identity. It pairs through the actual extension popup document,
proves that pairing alone cannot read an ungranted tab, invokes the real browser
action through the browser-level CDP `Extensions.triggerAction` on its exact tab
target, and then selects/observes/types/reads/clicks/revokes on inert local markup.
The `activeTab`, `scripting`, document targeting, host permission, popup fetch and
session-storage paths are real Chrome APIs, with no API mocks or widened page
host grants. The popup HTML runs as an extension test tab, as documented by
Playwright; headless Chromium's toolbar popup is not exposed as a Playwright page.
This verifies the extension permission/transport flow, not a visible toolbar
popup, a user's Chrome profile installation, account sign-in or provider send.
Its reusable owned setup is `tests/fixtures/browser-companion-extension.ts`, so a
connected Agent/model approval fixture can use the same actual extension boundary
without inventing another browser owner or broad test matrix.
`tests/agent-browser-tools.test.ts` checks default-off task attachment, exact
generation/document/ref ownership, no pre-observe content disclosure, consumed
input, stable wire operation IDs and cancellation/late receipt reconciliation
against the real host protocol with an inert extension protocol fixture.
`tests/agent-desktop-tools.test.ts` is one pure injected native-transport fixture
covering passive/default-off state, explicit controls, exact list-row attachment,
bounded standard model image, consumed and out-of-bounds input, physical owner
retention/late action-specific reconciliation, and post-selection read failure.
It creates no native child and captures or inputs nothing on the actual OS.

Actual user-profile extension installation, visible toolbar-popup UX, composed app pairing UI,
selected account/turn integration and native desktop providers still require
separate connected-flow evidence. No extension is installed into a real Chrome
profile by these tests. No release artifact or App Store/Web Store submission is
produced.

The implementation follows Chrome's official [activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab),
[scripting/document targeting](https://developer.chrome.com/docs/extensions/reference/api/scripting),
[session storage](https://developer.chrome.com/docs/extensions/reference/api/storage),
and [fixed-host match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns).
