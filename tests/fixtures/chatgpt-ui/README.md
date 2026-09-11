# Versioned offline ChatGPT UI contracts

`v1.json` is a synthetic contract dataset recorded on 2026-09-11. It contains only
ARIA scalar values, model/effort capabilities, short synthetic accessibility
descriptions, expected parser results, and exported selector strings. It contains
no account identifiers, profile paths, cookies, prompts, conversation extracts,
screenshots, or captured private DOM. Do not replace these synthetic values with
raw account output.

Provenance is intentionally split:

- `../pro-model-picker.json` is the existing sanitized picker fixture. The default
  evaluator also consumes that file directly to check its hidden semantic slider,
  described Pro state, and recorded version inventory. Its `observedAt` date is
  historical evidence, not proof that an account currently exposes those controls.
- `../pro-retry-tooltip.html` is the existing **synthetic** ownership/layout fixture
  for upstream PR #432. Its exact Pro and Extra High radio labels are retained as
  independent capabilities in this dataset. Upstream reported a hover portal but
  supplied no captured linkage DOM; `aria-describedby`, tooltip roles, IDs and
  competing conversation nodes in that HTML are test constructions. Do not describe
  them as observed upstream DOM. The actual asynchronous ownership/absence checks
  remain in `tests/pro-retry-hint.test.ts` and `tests/pro-retry-hint-worker.test.ts`.

`src/acceptance-ui-fixtures.ts` executes the production slider parser, model-mode
classifier, pinned-version validator and described-state matcher. Selector checks
compare exported selector contracts only. They do not execute a browser, perform
DOM matching, test visibility, hover a control, submit a prompt, or read a profile.
The default function imports fixed datasets; it accepts no filesystem path.

Schema changes require a new supported dataset version. The parser rejects unknown
versions, unknown fields, duplicate case IDs, excessive case/field lengths and
malformed cases instead of silently skipping them. A failed expected result is
reported as `passed: false`; diagnostic details contain fixed categories rather
than the fixture's description text.

An offline pass establishes only that these historical and synthetic contracts
still match the shipped logic. It does not establish authentication, current
ChatGPT UI compatibility, entitlement to Extra High or Pro, actual model selection,
or successful account-bound Codex/MCP execution.
