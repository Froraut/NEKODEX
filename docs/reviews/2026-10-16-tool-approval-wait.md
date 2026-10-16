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

Installed acceptance completed on 2026-10-17 local time with app and native core
6.1.32-nekodex.2. The previously failing Web Pro child applied and verified its
file. The Instant approval card stayed visible for at least 81 seconds; a later
one-time Allow released the real patch and file verification. All 17 model routes
passed the shared tool scenario, recorded in the
[all-model report](https://github.com/Froraut/codex-config/blob/5b61f90/providers/all-model-tools-20261017.md).

The local app also includes the merged upstream PR91 background-route fix. After
verifying direct first-party access over this host's OS network, the declared
DIRECT route allowed ordinary Quit to detach the GUI. A fresh native catalog
request returned HTTP200 with the GUI absent, the native core PID stayed the same,
and reopening the app restored ready account tunnels. This host's route evidence
does not automatically authorize DIRECT on other networks.

Source, signed local app and live tool execution are distinct evidence. No public
installer release is part of this correction.
