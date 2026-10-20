# Selected skill resources and owned Native worker boundary

Date: 18 October 2026. Branch: `codex/full-adoption-20261018`.
The user selected the entire agreed feature set on macOS first, followed by
Windows/Linux. This batch advances that program; it does not complete all 36
areas or replace installed `6.1.32-nekodex.8` with source `.9`.

## Selected text resources

The existing standalone skill owner now imports an explicitly selected local
`SKILL.md` together with up to 16 UTF-8 references/templates under `references/`
or `assets/`. Supported extensions are `.md`, `.txt`, `.json`, `.csv`, with 32 KiB
per resource and 128 KiB for the complete package. Links in instructions do not
cause additional reads. Scripts, binary/network resources, automatic dependency
discovery and copied official/vendor plugin distributions remain unsupported.

The same durable review/commit/version/attachment owner handles the package.
Source pins are rechecked before import; package/version/review digests bind every
selected file. Retained delivery verifies the selected tree and bytes. Quotas
include resources. An update does not replace existing task attachments, and
revocation blocks future delivery while retaining referenced files and receipts.
The model packet contains relative names and source-material roles, with no
absolute source path or new tool/filesystem authority.

The Russian/English UI lets the user specify files explicitly and inspect every
full text, MIME type, byte count and SHA-256 plus the package digest before the
existing separate import action. Importing and attaching remain separate steps.
Changing the form retires its previous review; incomplete previews disable commit.

Two review findings were resolved before handoff: inherited object-property
extension names no longer pass the media-type classifier, and publication flushes
every intermediate resource-directory ancestor bottom-up.

| Evidence | Observed result |
| --- | --- |
| Selected-resource plus legacy text fixtures | 4 passed, 97 assertions, 478 ms; actual temporary files and durable metadata |
| Relevant follow-up after directory flush correction | 1 passed, 54 assertions, 85 ms; nested retained resource after reopen/recovery; unchanged legacy results reused |
| Actual local HTTP → import → attach → composer → fake Responses | 1 passed, 19 assertions, 271 ms; exactly one counted fake offer, immutable source drift and revoke boundary |
| Root and renderer TypeScript | Both passed |
| Renderer build | 192 modules; development output, no release packaging |
| Plain CLI development bundle | 628 modules; actual `--version` returned `6.1.32-nekodex.9`; temporary bundle removed |
| Actual macOS DEV UI through CUA | Native picker, discovery, full 180-byte instruction + 84-byte reference preview, package digest, import unattached, explicit task-generation attachment, revoke with retained bytes, detach |

The actual UI version was
`037b242cb47c159d01f6f0241a20dc50f6adaef648912d8aa640ca4e87dc05da`,
package digest
`76389545feb03de91a7f59f7ee8c66c5f4f1a44972c8e924875e9d9318afa8ea`.
The prepared synthetic task stayed at zero model offers, dispatches and tool calls.
The GUI and private core both exited 0; exact owned PIDs and port were checked
closed, then the disposable profile was removed. No OS permission grant or
inspection, actual user skill, account authentication or external model was used.

## Owned Native worker

A separate private Native leaf is implemented with a pinned stock Codex
0.163.0 executable, dedicated profile/SQLite/cwd, sealed one-model catalog,
pre-start source admission and connected public effective-policy checks before
creating one new ephemeral thread. It does not add turn/approval authority to the
existing metadata/fork client and is not yet connected to main/Bun/product UI.

Status 2026-10-21: this and the next paragraph are superseded. The leaf now runs under main's
[Native account execution](../../launcher/electron/native-account-execution.cjs),
reached through the main [Native bridge](../../launcher/electron/agent-native-bridge.cjs)
and the Bun [Native port](../../src/agent-mode/native-provider.ts), with Native
account and thread panels in the UI. Official-account inference has run: real
models on 18 October ([evidence](2026-10-18-native-real-models.md)) and official
sign-in with a ten-model catalog in installed `.13`.

The current product route for official-account inference remains unavailable.
Stock Codex can bootstrap eligible managed cloud policy and plugin warmups before
the public configuration RPC is processed; a post-start check alone does not
establish startup isolation. The local fake backend proof is separate from that
unresolved real-account boundary. The complete leaf contract and final focused
evidence belong in [owned-native-worker.md](../design/owned-native-worker.md).

The actual stock-CLI/local-fake run observed `tools:[]`, four canonical messages
with native IDs/timestamps, structured output, usage and continuation in the same
child/thread. Three observed provider requests included deliberate ACK loss and
zero replay. Targeted follow-ups verified the changed lifetime and journal
boundaries: observation waits retain the physical owner, exact late ACK/terminal
reconcile without replay, earlier held unknown facts remain in bounded append-only
observations, mutable constructor/schema inputs cannot change admitted pins, and
a passive second inspector does not declare a live owner lost. Stale locks are
preserved for controlled recovery. The final changed late-result case passed
one test with 23 assertions; unchanged stock wire evidence was reused. Independent
read-only re-review confirmed the concrete findings resolved. This leaf adds no
Electron package dependency; a trusted constructor supplies a synchronous schema
compiler, and only literal `true` accepts its result.

Native integration remains a subsequent coherent batch: the Bun Agent store and
runner retain scheduling and ToolJournal ownership, main alone sends Native RPC,
and an already-durable exact dispatch claim must authorize the bridge. A fixed
NEKODEX structured-text protocol must not fabricate native tool calls or human
authorship. Text-only Native input does not provide screenshot vision delivery;
a Native turn-offer bound is distinct from an internal provider request count.

## Delivery status

Source publication and exact CI will be recorded after final leaf review and map
generation. No full repository suite, distribution packaging, signing,
notarization, release assets, merge or installed-app replacement was performed
for this batch. D01's separately verified installed credential migration remains
documented in [its receipt](2026-10-18-d01-implementation.md).

Status 2026-10-21: the batch was committed as `d5da164` and reached `main` with the
adoption stack (`296addd`, CI passed).
