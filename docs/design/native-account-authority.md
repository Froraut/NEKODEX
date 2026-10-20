# Owned Native account authentication

`launcher/electron/native-account-authority.cjs` is a trusted-main auth-only owner.
It prepares a logical UUID profile and a fresh immutable physical UUID epoch under
`CORE_HOME/native-accounts`. Metadata, base config, lock and bounded action receipts
use mode 0600; owned directories use 0700. The official CLI alone writes credentials.
Parent code never opens, parses, hashes, copies, links or exports auth content.
`resolveProfile` and successful login settlement inspect auth path metadata only.
No existing global account, cache, profile or credential store is imported.

The owner uses the official standalone CLI 0.163.0 layout, a trusted-main binary
SHA256, and source revision `83086188ae0614bd882818ff1aa23f3194962012`.
The sole child command is `login --device-auth`, with ignored stdin, private HOME,
CODEX_HOME, SQLite/cwd/tmp and a constructed environment. Ambient secrets, proxy,
issuer/client overrides and unrelated configuration are absent. The base config
selects the official provider and file credential storage, disables update checks,
and sets empty project root markers. The pinned loader therefore treats the private
cwd as its project root. System config/requirements presence and forced macOS
managed preferences are refused; no override bypasses required policy. The native
loader still checks its mandatory requirements.

Device login may clear/revoke auth in its selected profile. Every epoch accepts
at most one login intent, even after failure/cancellation; a new explicit attempt
requires a fresh epoch. The bounded registry journals action intent before profile
writes or child creation. Action IDs cannot be replayed. Mutation errors include
trusted `actionRecorded`: false proves this invocation recorded no intent; true
requires receipt inspection and includes journal uncertainty. This field lets IPC
classify a known pre-intent rejection without inventing a completed action.

A private lock has one main owner for the persistent registry. A second object is
passive and cannot claim/kill/adopt the first owner's child. A missing/dead owner
projects persisted nonterminal login as `auth-outcome-unknown`; it never starts
another child. A stale crash lock requires explicit reconciliation, rather than
unlink-and-retry races that could steal a new owner's lock. Normal shutdown stops
new admission, signals only exact owned process groups, waits for child `close`,
then releases the matching lock. Concurrent shutdown calls share that work; a
failed cleanup retains ownership and may be retried. An observation wait never
expires a human login. Graceful process termination may escalate to SIGKILL;
physical close remains required before releasing the owner.

The stdout parser retains at most 16 KiB in memory. It supports chunked UTF8 and
SGR color sequences, requires the pinned complete prompt and exact fixed official
`https://auth.openai.com/codex/device` URL, and projects a bounded printable code
from the designated line. It rejects control characters, alternate URLs, multiple
prompts and oversized output. Stderr is drained without retention. Neither raw
stream nor URL/code enters receipts, logs or support projections. The code exists
only in main memory and the intentional pending-login UI, and is cleared on cancel
request, error and physical settlement. The UI keeps the official warning to
continue only for a login the user initiated.

Exit zero plus private CLI-auth file metadata establishes `signed-in-checking`.
It does not establish account identity, subscription usage, remote catalog
provenance, execution readiness or inference delivery. Missing/unsafe persistence,
process errors, cancellation and signal races retain uncertainty. Cancellation
stops the local poller and does not claim remote grant revocation or delete the
epoch. Known nonzero native exit is a generic failure; raw diagnostics are omitted.

The renderer receives only opaque profile/epoch/action/login IDs, labels, truthful
states and transient pending code/URL. `inspect`/`snapshot` are passive and contain
bounded action receipts for transport-loss reconciliation. They do not create a
profile, invoke a CLI or replay a request. Main-only `resolveProfile(profileId,
epoch)` requires signed-in-checking with no live login, rechecks private paths,
epoch/config metadata, executable SHA and auth stat metadata, then returns trusted
paths for the next inventory owner. It returns the currently journaled expected config SHA and auth stat metadata
(dev/inode/size/timestamps). The trusted `publishProfileConfig` port takes exact
profile/epoch/action IDs, expected config SHA and constrained owner-generated
nonsecret TOML. It requires the official provider, file auth and empty project
markers, rejects credential/provider overrides, journals before/candidate hashes
before fsync/rename/readback, then commits the expected hash. An interrupted write
remains uncertain; the next main-only resolution compares actual config bytes to
that exact journaled pair and either commits the candidate metadata or records
that the old bytes remained. Unknown bytes are refused. It never rewrites config
to manufacture reconciliation.

`acquireProfileOwner({profileId,epoch,actionId,kind:'inventory'})` takes the shared
per-epoch gate and returns an opaque exact-object lease. Resolution/config
publication require that same lease while held; cloned objects cannot release
it. The inventory owner holds the lease across its journal/child/cache lifetime
and releases it only after physical settlement. Account shutdown retains the
global registry lock while a profile lease remains; cleanup may be retried after
the actual owner settles. The gate is main-only and is never exported through IPC.

Inventory, model admission and execution remain separate future owners. This module
always projects `executionAvailable:false` and never invokes app-server, a model
endpoint, thread/start, turn/start, browser login or token exchange itself. Existing
`official_policy_preflight_unverified` execution admission is unchanged.

Focused verification: `bun test tests/native-account-authority.test.ts`. The fixture
uses an inert pinned-layout file and injected process events/signals; no real CLI,
account, login, profile outside temporary fixture directories or network is used.
It covers private persistence, intent-before-spawn, chunked prompt parsing and
secret omission, strict argv/environment, cancellation/close races, owner-loss
uncertainty, no replay, executable/fresh-epoch rejection and trusted auth-metadata
resolution, journaled config write/reconciliation and shared profile lease cleanup. These are fixture results, not live provider or installed-app proof.
