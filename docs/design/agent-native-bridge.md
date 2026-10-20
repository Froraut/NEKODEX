# Agent Native main bridge

`launcher/electron/agent-native-bridge.cjs` is a main-only adapter between a
durably claimed Bun Agent dispatch and the existing owned Native worker leaf.
It adds no Native RPC sender, effect journal, account/authentication reader,
profile policy, proxy client or foreign-thread adoption. Shared protocol/schema
constants live in `agent-native-protocol.cjs`; the bridge uses Node built-ins
and a literal fixed-schema compiler, without an Electron AJV dependency.

## Trusted composition

```js
const bridge = createAgentNativeBridge({
  canStart: () => currentLocalOwnerIsAccepting,
  validateOffer: async (envelope, payloadDigest) => {
    // Existing private Bun control transport must inspect its already-durable
    // exact live dispatch claim. Caller scope/digest alone are never proof.
    return validateClaimInOwnedBun(envelope, payloadDigest);
  },
  resolveAdmission: (admissionId, model) => selectedTrustedAdmission(admissionId, model),
});
```

An admitted resolver returns `createWorker(binding, onReceipt)`. That factory
constructs a passive facade for the same deterministic binding's retained leaf
journal and uses its existing `createOwnedWorker`, `offerOwnedTurn`, passive
`inspectOwnedWorker`, `retireOwnedWorker` and `destroy` methods. It may capture
`compileOutputSchema: compileAgentNativeOutputSchema` when constructing the leaf.
Neither Bun nor renderer supplies a schema/compiler, executable, path, account,
profile, worker handle or native thread ID. The bridge does not decide whether a
future admitted factory uses a separate fixture process or a binding facade on an
account-owned transport. Real authentication and production admission remain
with their existing owners and are not established by this source or fixture.

The composition root owns HTTP authorization, exact local authority, current
runtime-instance binding and invocation of the durable Bun claim validator.
`offer(envelope, { payloadDigest, signal, onReceipt })` recomputes the exact JSON
digest, rejects unknown envelope/scope/continuation fields and enforces fixed
version, protocol, schema ID/hash, automatic-host authorship, dispatch UUID and
text/envelope byte bounds. It validates the durable claim before factory creation
or any thread/model call. Empty admission or rejected admission before effects
produces `not_sent`; an error after possible offer remains unknown and cannot
trigger another sender or automatic retry.
After that first exact claim validation, the bridge publishes a prepared,
not-written receipt before factory/thread startup. HTTP may return that observation
and leave the same owned operation running, rather than waiting for a late ACK or
terminal and timing out without a receipt. After startup, it reads the exact Bun
claim again immediately before calling the leaf offer, then rechecks local owner,
generation fences and invalidation epoch after that await. A superseded claim
retires the created worker and returns known not-sent without a model offer.

## One binding and one offer owner

Main derives an opaque binding from task, family, task generation, Agent worker,
admission and model. The native worker creation action is a separate derived UUID;
the model-offer action is the exact Bun dispatch UUID. Duplicate action/digest/
scope offers observe the existing operation. A conflicting payload is rejected.
The bridge retains bounded in-memory projections (32 bindings, 256 action rows,
64 meaningful projection revisions and 32 observers/waiters per action); it does
not evict uncertain ownership to make room or create another effect journal.

A continuation requires the same binding/generation and exact previous completed
Native-turn receipt. It cannot reuse a held, failed, retired or foreign turn.
Every new offer still requires its own already-durable Bun claim. Task text,
selected skills and tool results remain automatic host context; native tools and
the existing Native worker's inference-only admission do not change here.

## Receipt projection and observation

Leaf callbacks must match offer action, admission, owned worker/thread, exact text
hash, fixed leaf schema hash and automatic input authorship. Append-only leaf
observation counts prevent an older callback/returned row from overwriting a newer
ACK or terminal. A matched Native turn produces stable binding, turn and acceptance
receipts. Canonical assistant text is selected only from the exact leaf turn's
final assistant item, with a matched automatic canonical input item. Caller result
fields, `structuredOutput`, a foreign turn and arbitrary assistant metadata never
become that text. Semantic NEKO branch/tool validation remains with Bun.

`readReceipt({ actionId, scope, payloadDigest })` and bounded event-based
`waitReceipt({ ..., afterRevision })` read only this main instance's retained
projection. They never resolve an admission, create a facade, start a child,
submit, reconnect, replay or cancel. Lookup/wait results are cloned. Cancelling a
request or an observation wait detaches that observer; it does not cancel Native
inference. A soft held-unknown result retains its physical owner and can receive
a later ACK/terminal through the same callback and revision stream. Status omits
assistant text and retains uncertain/unsettled owner activity until explicit
retirement proves release.

## Invalidation, retirement and restart limits

`invalidateTask(taskId, { familyId, beforeGeneration })` fences and retires only
matching bindings with task generation below the supplied boundary. The HTTP
composition must verify the family and that Bun's current generation is at least
that captured boundary. A delayed old cleanup therefore cannot close a newly
stepped current-generation binding. The unscoped overload is reserved for trusted
internal whole-task shutdown/disable, not a generic HTTP task-kill capability.

Invalidation also fences a pending claim/admission before it can create a worker
or offer. Retirement waits for owned creation to settle if necessary, persists a
distinct retirement action through the existing leaf journal, then closes that
exact leaf. `destroy()` follows the same sequence for every owned binding and
awaits pending operations. No timeout/disconnect invents a retirement request;
failed retirement/close remains visible as unsettled ownership.
After successful physical close, any held projection belonging to that exact
binding becomes unheld unknown even if its last leaf row was malformed and could
not be projected. Its write disposition is preserved; shutdown does not invent
success or not-sent proof. A failed physical close retains held ownership.

In-memory projections do not establish restart rehydration. A fresh main receipt
lookup returns unavailable and starts nothing. If a later offer encounters prior
receipts or another/stale leaf owner in that deterministic namespace, it returns
unheld unknown and never creates, adopts, resumes or reoffers the old worker.
Rehydration needs separately admitted durable binding metadata. The factory must
not redirect a lost binding to an empty new namespace; doing so would discard the
leaf's replay protection and violates this contract.
Waiting on an absent mapping throws owner-unavailable; `undefined` is reserved
for a bounded no-change wait on an existing action. This avoids turning a lost
mapping into an immediate busy loop that falsely retains the previous owner.

## Focused evidence

`tests/agent-native-bridge.test.ts` uses one fake owned leaf with retained journal
rows. It checks claim/admission gating before creation, closed-envelope and digest
rejection, one create/offer on duplicates, exact ACK/held/late terminal projection,
canonical text selection, passive read/wait cancellation and expiry, continuation
binding, delayed generation-scoped retirement, explicit close and lost-mapping
refusal. It invokes no CLI, Native model, account/authentication, GUI, OS input or
network provider. It does not prove a production admission, installed launcher,
actual HTTP mounting, restart rehydration or a live provider result.
