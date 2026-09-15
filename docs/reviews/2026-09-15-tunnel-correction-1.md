# Tunnel correction run 1 — 2026-09-15

Baseline: `359d8fc000d73b32497cf6465fbd3cd1998d3a14`. Run 1 implemented all three unique findings T01–T03 from [tunnel research](2026-09-15-tunnel-research.md). No commit, tests, typecheck, bundle, dependency install, service command, tunnel command or production mutation was performed. Root/launcher untracked `node_modules` predated this run and were not altered.

## Run 1 changes

| Finding | Source change | Remaining limit |
| --- | --- | --- |
| T01 download memory cap | `src/tunnel.ts` now reads `Response.body` incrementally, checks declared and actual byte counts before copying into a complete array, cancels the reader and releases its lock on errors, and aborts the fetch on size failure. The existing download timer remains active through body consumption. The checksum text has a separate 1 MiB cap. | Chunk accumulation plus final copy can temporarily use roughly twice the bounded download size. A network chunk itself can be larger than the cap before the reader observes it. |
| T02 full ZIP inflation | `src/tunnel.ts` uses the existing `fflate.unzipSync` filter to materialize only the selected executable. It rejects unsafe path segments, duplicate executable basenames, more than 128 entries, invalid/oversized declared binary size and an oversized resulting binary. Hash and `--version` checks still precede install. | ZIP central-directory parsing still occurs for every entry. The cap applies to decompressed binary allocation through `fflate`'s declared output size; it does not establish a hard CPU budget for malformed compressed input. |
| T03 unbounded service-status probe | `src/tunnel-service.ts` gives each `launchctl print` a 5-second timeout. `runCommand` throws on `ETIMEDOUT`, so a stalled probe is not mistaken for an unloaded service. The previous ordinary nonzero-print `unloaded` interpretation remains. | The timeout bounds each print probe, not the whole stop operation: `bootout`, unload polling and the final status read are separate steps. |

Unique findings addressed in run 1: **3**. T01 and T02 had their identified resource paths corrected; T03's per-probe timeout was corrected, while the polling deadline edge remained and was fixed in [run 2](2026-09-15-tunnel-correction-2.md). Independent optimizations implemented: **0**; the smaller checksum cap is included in T01's resource correction. Existing pinned `tunnel-client v0.0.12`, installed-binary version verification, release SHA256 comparison and runtime status semantics were preserved.

## Manual source review and focused test handoff

Reviewed the changed diff and direct setup/CLI/doctor/DEV transport call paths. Inspected `fflate@0.8.3`'s local `unzipSync` implementation: its filter sees each central-directory member before inflation, and deflate allocates an output buffer sized from `originalSize`; the new filter gates that size. Read `src/process.ts` to confirm `runCommand` throws when `spawnSync` reports a timeout. Confirmed `stopTunnelService` performs `bootout`, post-bootout polling and a final status query; the report therefore claims only a per-probe bound. No broad code audit was run.

Added exactly two named cases in `tests/tunnel-improvements-focused.test.ts` without executing them: unannounced body exceeds the byte cap and cancels; selected ZIP binary is returned while an unsafe path is rejected. Parent may run `bun test tests/tunnel-improvements-focused.test.ts` as the small targeted check if it fits the shared 60-second/1–5-case budget. T03 can be checked by manual code review or a later single injected timeout case; do not launch/stop the real user service as a test. Typecheck/test execution and any integration correction remain with parent or authorized later runs.

## Timing and files

Run began at **16:43:45 UTC** and the final file/status review ended at **16:46:24 UTC**, about **2m 39s** elapsed. This is wall-clock research/edit/review time, not test runtime or model compute. Edited `src/tunnel.ts`, `src/tunnel-service.ts`, `tests/tunnel-improvements-focused.test.ts` and this report. Inspected these files plus the relevant direct caller slices in `src/setup.ts`, `src/cli.ts`, `src/doctor.ts`, `src/dev-chat/transport.ts`, `src/process.ts`, and local `fflate` README/type declarations/runtime implementation. Read the standing `right-size-test-runs` skill earlier in this task. Runs 2 and 3 should re-evaluate failure paths of this implementation and leave clean paths unchanged.
