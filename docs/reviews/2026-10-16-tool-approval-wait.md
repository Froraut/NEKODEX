# Manual connector approval must not become an automatic denial

The all-model subagent check exposed a Web-only failure before native `apply_patch`
dispatch. Native and API/Antigravity models could read an unpredictable fixture,
inspect its image, apply a small patch and verify the new file. Web Pro read the
fixture and image but returned the site's “user has declined” message.

The transport log contained no `codex_apply_patch` request. The browser diagnostic
recorded a visible connector approval. With `autoApproveToolCalls=false`, the old
page guard waited 60 seconds and then clicked Deny itself. A following Extra High
case showed the same approval card; explicitly choosing Allow once let the patch
and its verification complete. No persistent connector permission was changed.

Version 6.1.32-nekodex.2 removes that timed denial. A manual approval waits for the
user or the turn's cancellation, continues heartbeats, and is excluded from the
response deadline. After it resolves, DOM grace tracking resumes from fresh
evidence. Automatic approval, when already enabled by the user, still selects only
the unique one-time Allow action; this correction does not enable it globally.

Focused development verification used actual Chromium pages: the manual card
remained untouched past the former deadline, a later Allow resolved it, cancellation
left all decision buttons untouched, and the existing one-time automatic path
continued to pass. Core TypeScript checking and version synchronization passed.

Installed activation and the remaining Web model results are recorded separately
in the final all-model tool report. Source, signed local app and live tool execution
are distinct evidence. No public installer release is part of this correction.
