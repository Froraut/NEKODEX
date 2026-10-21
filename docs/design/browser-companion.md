# Browser companion and observation-bound providers (P11–P14)

`browser-companion/` is a reviewable Manifest V3 extension for Chrome and, through
`manifest.firefox.json`, Firefox 153+. It has no static content scripts, background
browsing monitor, browsing-history permission, account login, cookie reader, native
messaging host, arbitrary evaluation or URL execution endpoint. Chrome has actual
MV3 fixture evidence; the Firefox artifact shares every script but its live
load/pair/send acceptance is still separate.

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
4. The popup sends the observation (with the bundled feature list, currently
   `chatgpt-v1`) and hands the selection to an inactive extension **session tab**
   through a one-time session-storage nonce. That session tab owns the single poll
   loop under a Web Lock, so the toolbar popup may close. There is no service
   worker, alarm or automatic reconnect: closing or reloading the session tab
   stops receiving work and cannot resume the consumed handoff. **Stop sharing**
   revokes the host session and forgets the local token.
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
| `poll` | One session-tab owner; deliver at most one command, marking it dispatched before responding |
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

## ChatGPT send through the companion (P11)

The existing ChatGPT turn owner can use the companion as its page transport for an
exact, explicitly bound chatgpt.com document. Ownership stays where it was:

- `ChatGptBrowserWorker.run` remains the only ChatGPT admission point, duplicate/
  capacity registry and settlement owner for Responses, Chat Completions and every
  other consumer. At admission it asks the process-local
  `adapters/chatgpt-web/companion-transport-port.ts` whether a companion transport
  is **engaged**. If so, that one turn runs through the companion leaf instead of the
  launcher helper/embedded page; the choice is final for the turn. A refused
  companion turn never falls back to the embedded browser, and an embedded turn
  never moves to the companion.
- `src/browser-companion/chatgpt-transport.ts` is the leaf. The runtime creates one
  per process (it survives listener Disable/Enable) and the server composition root
  installs its port with the lazily created runtime and removes it on shutdown.
- `host.ts` gains one command kind, `chatgpt`, with three bundled operations:
  `identify`, `send` and `read`. Only `send` may report execution. The host refuses
  the command before queueing unless the selecting extension advertised
  `chatgpt-v1`, so an older extension (protocol/version mismatch) can never receive
  a send. The host still has one operation slot, never re-delivers a dispatched
  command and refuses consumed operation IDs.
- `browser-companion/chatgpt.js` is the bundled page function. It runs only in the
  selected main-frame document, checks the isolated-world scope/document epoch and
  `location.origin === "https://chatgpt.com"`, and uses selectors that a focused
  test keeps identical to `src/chatgpt-session.ts`. The host sends data only, never
  selectors or script. Firefox uses `content.fetch` for the page-context session
  read; Chrome uses the content script's page-relative fetch.

**Binding.** The user pairs, selects a chatgpt.com tab, and chooses **Bind ChatGPT
tab** in NEKODEX, stating the model/effort (and optional pinned version) that the
tab visibly has selected. `identify` reads `/api/auth/session` inside the page and
returns only `sha256("chatgpt-user:" + user.id)`; tokens and email never leave the
page. The binding pins that account digest, a fresh identity epoch, the visible
model-control label and the exact session/scope/tab/window/frame/document/epoch
anchor. An optional trusted-owner `account` digest must match. Pairing, revoke,
disable and a new pairing unbind. NEKODEX does not operate ChatGPT's model picker
through the companion: the user attests the mode at binding time, and each send
refuses if the visible label changed.

**Admission (nothing sent).** A turn is refused before any prompt is prepared when
a held outcome exists, another companion turn is active, the selected anchor is no
longer the bound document (tab/document mismatch), the extension lacks
`chatgpt-v1`, the requested model/effort/version differs from the binding, or the
turn needs features this transport does not provide: local tools/MCP connector,
account tunnel, retained or resumed conversations, compaction, Luna checkpoints.
After `prepare()`, images, files, skill files, multipart context and prompts over
200,000 characters are refused. These are `409` non-retryable adapter errors.

**Send.** Abort, listener, busy-slot and exact-anchor checks run before
`onSendActivated`; the anchor is checked again synchronously with queueing, and
pre-dispatch refusals keep their own codes. `onSendActivated` runs before the
command is queued, so the existing turn runtime treats the prompt as never
replayable from that point. An in-flight companion turn keeps the port engaged even
if Unbind, revoke or Disable runs meanwhile, so no later admission can start the
embedded sender beside it. The page function
re-checks the account digest and visible model label, requires a visible tab, an
empty new chat at `/` with no turns and no active generation, inserts the text with
the same editing command the embedded worker uses, requires whitespace-normalized
composer readback, waits for exactly one enabled send control and clicks it once.
It then waits for exactly one user turn whose text matches the prompt and returns
its message ID, waiting briefly for it to hydrate, or `ordinal:1`. Because send
required an empty new chat, reads keep matching that ordinal after a later ID
hydration. Failures before the click are `rejected`, executed false, and remove the
extension's own draft (the session tab stays alive for a corrected turn); anything
after the click without that proof is `unknown`.

**Settlement.** `read` operations never click and may run while the tab is in the
background. The leaf polls the answer root that follows the sent user message and
precedes any later user message. It settles only when generation has stopped and
two consecutive reads return the same answer HTML, with the second read also
re-checking the account digest. `chatGptHtmlToMarkdown` converts the answer, the
turn receives it through `onTextDelta`, and the transport retains a turn receipt:
operation ID, trace ID, user and assistant message IDs, path, identity epoch and
the answer SHA-256. Answers above 400,000 HTML characters are not truncated into a
false success.

**No replay.** A send that is queued but never delivered settles `not_sent`. A send
delivered without a terminal receipt (lost ACK, session/tab closed, timeout,
cancellation) or reported `unknown` is **held**: the leaf records the operation,
throws a non-retryable `502 companion_outcome_unknown`, keeps the port engaged even
after Unbind, and refuses every later ChatGPT turn with
`companion_outcome_held` until the user inspects the tab and explicitly releases
that exact operation ID. The host also keeps its own unknown slot until a late
receipt or revoke. A late ACK reconciles the host receipt but does not release the
hold or trigger another send. A failure to observe the answer after a confirmed
send is held as `companion_response_unobserved`. Holds live in process memory: an
application restart discards the pairing and selected page authority, so a new
binding is again an explicit user action, and the existing turn runtime still
never replays a send-activated prompt.

Each sent turn leaves the tab on `/c/<id>`; the next send is refused until the user
opens a new chat in that tab. The transport is a Browser-only text transport; it is
not a replacement for the tool-capable embedded flow.

## Store packaging and privacy

`scripts/build-browser-companion.ts <chrome|firefox> <new-dir>` writes a
reproducible ZIP with `manifest.json` at its root and exactly the shipped files,
including 16/32/48/128 px icons resized from the application icon. Permissions
remain `activeTab`, `scripting` and `storage` plus the fixed loopback host.
[PRIVACY.md](../../browser-companion/PRIVACY.md) is the linkable store privacy
policy and is linked from the popup. Nothing is signed or published by the build.

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

`tests/browser-companion-chatgpt.test.ts` drives the real host protocol and
transport with an inert extension protocol fixture: one send settled by the tied
answer, lost ACK/unknown/unobservable answers held without a second send, late ACK,
account/tab/model/turn mismatch and outdated-extension refusals, exact receipt
validation, and routing through the existing worker `run` registry.
`tests/browser-companion-chatgpt-extension.test.ts` loads the actual MV3 artifact in
disposable Chromium, serves an inert ChatGPT-shaped document at
`https://chatgpt.com/` only through the context's local routes (no OpenAI network),
then binds, sends once, reads the tied answer and refuses a second send on the
non-new chat. `tests/browser-companion-store-package.test.ts` checks both store
archives. These do not prove a live chatgpt.com account send.

Actual user-profile extension installation, visible toolbar-popup UX, composed app pairing UI,
a live chatgpt.com send and native desktop providers still require
separate connected-flow evidence. No extension is installed into a real Chrome
profile by these tests. No release artifact or App Store/Web Store submission is
produced.

The implementation follows Chrome's official [activeTab permission](https://developer.chrome.com/docs/extensions/develop/concepts/activeTab),
[scripting/document targeting](https://developer.chrome.com/docs/extensions/reference/api/scripting),
[session storage](https://developer.chrome.com/docs/extensions/reference/api/storage),
and [fixed-host match patterns](https://developer.chrome.com/docs/extensions/develop/concepts/match-patterns).
