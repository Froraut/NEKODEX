# Mixed-model six-wave experiment

Baseline: `9925453`. Requested: review Luna medium ×16 twice, Sol medium ×16 once; then correction Luna, Terra, Sol medium ×16 each.

Reviews share an unchanged source tree. Review 2 is blind to review 1. Review 3 evaluates both reports against source. The coordinator deduplicates root causes and accepts only concrete source-supported behavior defects. Historical reports and skill rules are context, not evidence that a defect exists.

Sixteen stable ownership lanes partition source. Review agents may write only their own report. Correction agents may edit only their assigned paths; cross-lane suggestions go to the coordinator. No agent commits, publishes, touches live accounts, starts applications, runs suites, or delegates further.

Metrics: actual requested model and effort, dispatch/completion timestamps, completed lanes, candidate claims, accepted unique roots, duplicate/unsupported observations, accepted fixes, follow-up corrections, and coordinator intervention. Timing is wall clock including tool overhead; no token or monetary cost is inferred without usage data. Reviewer productivity uses accepted roots per minute and precision. Correction productivity uses accepted fixed roots per minute, qualified by severity and residual workload.

Sequential correction waves are not a controlled model ranking: later waves inherit earlier changes and fewer defects. A no-change lane is a valid result; do not invent edits to fill quotas. No runtime speedup or zero-bug conclusion follows from reviewer throughput.

Verification is centralized: at most five focused named cases (ten expanded maximum), 30 seconds per check and 60 seconds aggregate automated verification. Manual inspection covers other edits. No full suites or mass audit scripts.

## Availability deviation

The Terra correction wave produced capacity errors and no source changes. A same-model retry also produced no result within the bounded eight-minute window. The user explicitly requested retry first and authorized changing model if it still did not work. The remaining Terra attempts were stopped; the replacement correction wave uses sixteen Sol medium agents. The separately planned final Sol correction wave remains intact. Terra availability time is reported separately and is not a model-quality score.

The correction baseline snapshot was created just after Terra dispatch because `.git` is a worktree pointer rather than a directory. Before fallback, byte comparison of every changed source path with that snapshot showed no Terra edits.
