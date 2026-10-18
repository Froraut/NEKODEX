# Opt-in external usage and API-equivalent estimates

`launcher/electron/external-usage.cjs` owns a separate private metadata registry.
`ipc/external-usage.cjs` receives the composition root's sender-authorized handle;
`ExternalUsageSurface.tsx` receives only `{ request, selectRoot }`. This feature
never modifies the Native/Web usage store or adds imported counts to those
receipts. It does not run another client, inspect authentication, query a provider,
or discover home-directory log locations.

## Explicit grant and bounded import

The main-owned `pickDirectory` port returns the directory chosen by a human in a
native picker. The renderer supplies only a known client, a local pseudonym,
request scope, and explicit metadata consent. It cannot grant an incoming path.
Choosing a directory grants its JSONL descendants only: Codex `rollout-*.jsonl`,
or Claude Code `.jsonl`. Native picker cancellation has no durable effect. There
is no watcher or timer. Status reads do not read the selected logs. Each Import
button reads one bounded batch; Pause prevents future imports without deleting
saved metadata. Remove explicitly deletes that source's metadata and cursor;
original client logs are never changed.

The selected root and ancestor device/inode identities are retained privately.
An identity change requires a new picker grant. Symlinks are excluded during
inventory and immediately before a regular file is opened with `O_NOFOLLOW`
where available. Inventory limits are 512 files, 4096 directory entries, and depth
8. A batch reads at most 8 MiB, with bounded chunks and 256 KiB maximum lines;
limits and unreadable or excluded data are visible warnings. An inventory limit
asks the user to choose a narrower directory rather than claiming complete
coverage. The file order resumes round-robin after a byte-limited batch.

Offsets advance only over complete JSONL lines. Partial tails are reread on the
next explicit batch; raw pending text is never persisted. Oversized lines are
skipped up to the next newline and reported. Device/inode changes, shrinkage,
and a bounded prefix fingerprint detect ordinary rotation and truncate/rewrite.
The importer rereads changed files with logical deduplication. The prefix check
is not proof against arbitrary in-place edits elsewhere in a previously read
file: the feature supports append/rotation/truncation, not forensic monitoring.

The registry atomically commits sanitized records and cursor state together,
with private file permissions and bounded 24 MiB/20,000-record storage. An
uncommitted parse or write failure leaves the previous durable snapshot and
resume point intact. No automatic deletion occurs at the storage limit.

## Supported format adapters and provenance

The schema names describe intentionally narrow adapters, not a promise to parse
all historical or future client versions. Codex CLI `0.x.y` and Claude Code
`1.x.y` / `2.x.y` with the following observed schema shapes are supported. Other
major versions, missing versions, invalid counters and unsupported identities
remain visibly unknown. Structural version/schema checks happen before tokens
are accepted. Official format sources checked on 2026-10-18:

- [OpenAI protocol source](https://github.com/openai/codex/blob/main/codex-rs/protocol/src/protocol.rs)
  defines cumulative `TokenUsage` / `TokenUsageInfo`, token-count events, and the
  rollout metadata/context variants. `codex-rollout-v1` requires `session_meta`
  with `payload.id` and `cli_version`, `turn_context` for a model and optional
  `turn_id`, and `event_msg` / `token_count` with `info.total_token_usage`.
  It subtracts the session's durable cumulative high watermark; it never sums
  repeated `last_token_usage` snapshots. Cached/reasoning output counts are not
  added again to their containing input/output totals.
- [Anthropic session reader source](https://github.com/anthropics/claude-agent-sdk-python/blob/main/src/claude_agent_sdk/_internal/sessions.py)
  documents JSONL session storage and reads typed assistant message entries.
  [Official session documentation](https://code.claude.com/docs/en/agent-sdk/sessions)
  describes session message access. `claude-transcript-v1` reads assistant rows
  with `sessionId`, `version`, `message.id`, `message.model`, and
  `message.usage`. The same API message ID in streamed blocks or copied files
  updates one nondecreasing snapshot rather than adding several calls.
  The [provider's prompt-cache documentation](https://platform.claude.com/docs/en/build-with-claude/prompt-caching)
  distinguishes uncached input, cache reads, and cache creation; this adapter
  preserves the components and totals them once. There is no claim that a
  transcript is a billing receipt or that these documents guarantee every CLI
  log version. Synthetic fixtures test exactly the supported shapes.

Client, hashed session/message/turn identity, version, model, timestamp and token
counts are the record allowlist. Prompts, responses, instructions, tool names,
arguments/results, working-directory fields, headers and credentials never enter
saved records. The private registry also needs the human-selected root grant,
opaque cursor fingerprints, pseudonym and price catalog. Raw log bodies and
pending lines are transient bounded parser input only.

Cross-root duplicates retain their original attribution rather than counting
again or silently reassigning the account. Model identity is an exact metadata
claim; unknown models remain unknown. Counter resets and conflicting decreasing
snapshots produce warnings. Missing usage is represented by unknown records;
zero recorded tokens never establishes zero actual usage. Versions, adapter,
source/client/pseudonym/scope, known counts, unknown records, and coverage
warnings remain visible separately.

## Estimates, pricing and overlapping receipts

The surface separates recorded token counts from **estimated API-equivalent
cost**. No prices are bundled or fetched. The user supplies a catalog with a
version, effective date, `USD`, and exact `model` → `priceModel` rows containing
uncached input, cached input, cache-write and output prices per million tokens.
`null` explicitly represents an unknown price. No fuzzy model remapping occurs.
Missing cache breakdowns leave input unpriced. Each available priced component
contributes to an estimated subtotal; unpriced token counts and records with
unknown usage remain visible. Without priced tokens, the amount is unknown,
not zero. Reasoning tokens are part of output, and no context-length/tool-call
multiplier fabricates spend. Tools, discounts, subscriptions, taxes, tiered
pricing and provider invoices are outside this estimate.

Scope defaults to unknown. Only explicitly user-declared external-only sources
enter the external aggregate; potentially forwarded/unknown sources remain
visible individually and are excluded from that aggregate. Imported counts are
never combined with NEKODEX Native/Web totals, because there is no authoritative
cross-receipt identity linking a client log to those receipts. Scope and account
pseudonyms are declarations, not provider-verified facts. No savings or actual
bill is claimed.

## Focused evidence

`bun test tests/external-usage.test.ts` uses synthetic temporary directories only.
It covers no read before picker consent, sanitized private persistence,
restart/append, repeated cumulative snapshots, rotation/copies/rewrite, partial
lines, symlink exclusion, unsupported versions, missing usage, Claude streaming
revisions, bounded oversized-line recovery, scope exclusion, explicit deletion,
and partial/unknown price estimates. A targeted TypeScript check compiles the
new surface and contracts. No real user log, auth file, provider call, installed
application or release was used for this evidence.
