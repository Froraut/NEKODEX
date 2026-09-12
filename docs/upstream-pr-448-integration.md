# Cumulative checkpoint preservation in fallback compaction

This fork integrates the focused compiler fix from [upstream PR #448](https://github.com/miuuyy/codex-chatgpt-web/pull/448), addressing [issue #447](https://github.com/miuuyy/codex-chatgpt-web/issues/447).

- Upstream author: Dongfang Liu (`liu-dongfang`).
- Reviewed upstream commit: [`fb9929a18d6be506364b2b14bb79ad6d8075072c`](https://github.com/miuuyy/codex-chatgpt-web/commit/fb9929a18d6be506364b2b14bb79ad6d8075072c).
- Upstream base: `e85e3693fdb4e3e033348c08df0298c20fcdb612`.
- Fork baseline: `72ff04ac31acbd5885eed2de76aa96bccd6cb429`.
- Review date: 2026-09-12. The upstream PR was open and draft, with no reviews or CI results; local verification is recorded separately below.

When inline fallback compaction exceeds its 110,000-byte JSON transport budget, the previous compiler removed messages from the beginning. A cumulative checkpoint could disappear while a larger later tool result remained. The next summary would then lose the only surviving record of earlier work, and the transport still claimed that its context was complete.

The compiler now protects the newest readable cumulative checkpoint and the final compaction instruction. It removes other history items from oldest to newest, retains their original order, rebuilds image references, and tells the summarizer how many items were omitted. If the required context cannot fit, compilation fails explicitly. Existing retired-capability-handle scrubbing still applies to checkpoint text.

This changes only inline compaction fit recovery. Normal turns and the existing two/three-part Bigger Context transport retain their existing behavior and budgets. Full-harness permissions, Manual mode control bindings, completion gates, and trusted-environment recovery are unchanged. No larger-context or assistant-rebinding behavior from closed upstream PRs #453/#454 is included.

## Local verification

The issue's synthetic checkpoint + 100,000-character tool-output fixture was reproduced on the fork baseline without a browser or account:

| Observation | Baseline | Integrated fix |
| --- | --- | --- |
| Cumulative checkpoint present | No | Yes |
| Large old tool result present | Yes | No |
| Recent verified progress present | Yes | Yes |
| Context incorrectly claimed complete | Yes | No |
| Omitted messages | 1 | 1 |
| JSON-encoded prompt bytes | 102,906 | 23,604 |

Nine new tests in `tests/fallback-compaction-checkpoint.test.ts` failed before the source change and passed afterward. They cover v1/v2 newline framing, string/text-part summaries, oversized required checkpoints, newest-checkpoint selection and order, image rebuilding, retired-token scrubbing, and Manual mode isolation.

The focused verification command passed **95 tests, 0 failures, 1,160 assertions**:

```sh
bun test tests/fallback-compaction-checkpoint.test.ts tests/prompt-contract.test.ts tests/zero-risk-prompt-contract.test.ts tests/chatgpt-web-usage.test.ts tests/retained-compaction.test.ts tests/server-compaction.test.ts
```

Root TypeScript checking and `git diff --check` also passed. These checks prove deterministic compiler and local protocol behavior. An installed long-running ChatGPT/MCP task was not exercised for this change; it does not claim to resolve the separate browser/handoff/environment symptoms in issue #424.
