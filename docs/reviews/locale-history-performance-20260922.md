# Locale loading and task history performance

Baseline: `7990fd3f844db826e0b7bdca840f1bfe4e159063`. This follow-up reduces
initial renderer work and repeated task-history reads/formatting on the same
architecture branch and PR.

## Implementation

- Extracted English, Simplified Chinese and Japanese dictionaries from the
  2,167-line `i18n.ts`; Russian, Korean and Traditional Chinese retain their JSON
  files. The message facade is now 443 lines. All six dictionaries exactly match
  baseline values; translation wording/placeholders were not rewritten.
- Added `locale-catalog.ts` and `useLocaleCopy.ts`. English stays immediately
  available; five additional languages load as separate chunks. Each resource
  shares in-flight work and remains independent of other language completions.
  Synchronous `copyFor` returns English until that dictionary is loaded.
- Added `language-selection.ts` to own the preparation/save revision across
  Settings and Onboarding. A late preparation cannot invoke save over a newer
  selection; superseded results/failures do not overwrite its UI. Settings keeps
  the screen and dirty fields mounted while preparing the new language.
- First startup awaits the saved language with IPC subscriptions active. Failed
  loading leaves an English interface, preserves the saved preference, and offers
  explicit reload. Onboarding can change preview selections during a pending load;
  a failure does not trap the user away from the language-selection step.
- The task ledger indexes IDs over its existing records. Regular writes publish
  the index after durable writing succeeds. Failed writes leave the previous
  record/index; restart, interrupted-submission and dismissal rules remain intact.
  No second persistence owner or authority cache was added.
- Task Center creates one date formatter per mounted language and reuses it across
  rows/filter changes, retaining action, confirmation and focus handling.

## Measurements

Same production renderer/Chromium fixture as the preceding pass. Initial script
bytes count every JavaScript resource requested by Overview, including the selected
locale chunk. Gzip is a size comparison, not Electron file transport.

| Initial script payload | Baseline | Current | Reduction |
| --- | ---: | ---: | ---: |
| English | 738,853 bytes | 494,065 bytes | 33.1% |
| Russian, including its dictionary | 738,853 bytes | 576,944 bytes | 21.9% |
| English gzip comparison | 235,417 bytes | 158,024 bytes | 32.9% |
| Russian gzip comparison | 235,417 bytes | 180,631 bytes | 23.3% |

The main chunk is below 500 kB and the previous Vite size advisory no longer
appears. This defers unused languages, not their total installed bytes. It does
not establish an equivalent change in wall-clock launch time, RAM or provider
latency. The Russian startup fixture requested only its locale chunk.

The compiled Task Center fixture rendered 1,000 synthetic rows, then filtered to
11 matching rows. Date-formatter constructor observations:

| Operation | Baseline | Current |
| --- | ---: | ---: |
| Open 1,000 rows | 1,000 | 1 |
| Filter those rows to 11 | 11 | 0 additional |

The lookup comparison loaded the same valid 2,048-record journal into actual
baseline/current ledger classes, checked storage availability and all records,
then measured 8,192 reads in seven alternating samples after two warmups:
median **22.623 ms → 0.319 ms**. This isolates indexed lookup CPU; it excludes
durable writes and does not measure the whole browser/UI update. The index adds
a bounded Map of references and rebuild work on save. The first synthetic fixture
was rejected for too-short tab IDs; those were corrected, and availability and
record-count checks now precede timing.

## Focused verification

Sixteen distinct behavior scenarios passed:

- Four Bun cases: complete dictionaries for all deferred languages, shared
  loads/independent late completion, failed/incomplete fallback, and stale
  selection/failure suppression. Separately compared all dictionary values to
  the captured baseline; all six matched exactly.
- Three ledger cases: one new connected write-failure/retry/restart/dismissal
  scenario; two existing interrupted-send and multipart-evidence scenarios.
- Three existing Task Center cases: exact-account confirmation/dismissal,
  combined filters/stale confirmation removal, keyboard focus on row removal.
- Two existing localization cases: IPC error normalization and Japanese runtime
  messages. Fixture loaders now resolve actual TS/JSON dependencies and preload
  languages. An old Chrome-only phrase assertion contradicted the unchanged
  browser-neutral passkey text; replaced it with a nonempty check while keeping
  the error-mapping assertions.
- Three compiled UI cases: saved Russian loads only its dictionary, a delayed
  Japanese selection saves after loading and preserves dirty input, and switching
  back reuses the resource; Onboarding ignores stale completion; failed startup
  language loading keeps navigation available and explicit reload recovers.
- One source Electron case: seven screens through real preload, then a real
  `file://` Russian module load and saved-language IPC. No page errors; temporary
  DEV process/profile removed. Russian Settings screenshot inspected.

Renderer types and the 116-module renderer build passed. Architecture-map/link
freshness and changed ledger syntax are checked with this change. No full
repository/package suite or live provider workload was run.

Measurement reproduction:

```sh
bun run --cwd launcher build:renderer
node launcher/scripts/measure-ui-work.cjs --startup-only
node launcher/scripts/measure-ui-work.cjs --startup-only --language=ru
node launcher/scripts/measure-task-history.cjs
node launcher/scripts/measure-task-lookup.cjs 7990fd3
```

Local evidence remains in ignored `launcher/output/architecture-refactor/` and
`launcher/output/playwright/architecture-refactor/`. Version stays
`5.9.0-nekodex.5`; installed app, account/tunnel configuration and release assets
were not changed. Language-save proof used the disposable DEV profile.

Further candidates remain measurable IPC payload reduction for large histories
and browser observation profiling. Task Center still renders all matching rows;
this pass does not introduce virtualization or pagination.
