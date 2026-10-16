# Browser and upstream review — 2026-10-16

Comparison baseline: e820daa1a9b2665dc27eadb419f7ac18a78d3951. Source fixes and installed acceptance are separate below.

## Reviewed scope

- miuuyy/codex-chatgpt-web: all 3 open PRs, 27 open issues, and closed items updated since the prior complete scan (24 September): 201 unique items. All were triaged; 34 received focused source/discussion review. 58 releases and 353 commits were inventoried. Latest release v6.1.9; main f137c2f84da5df214c1e228d74f5ff43e7641c48. The other 167 items retain triage status, not a claim of full source review.
- Evanlau1798/codex-chatgpt-web: 9 open PRs, 9 open issues, 62 updated items plus one unchanged open issue: 63 unique items. All bodies/relevant comments triaged; 10 source comparisons. 37 releases (8 since 24 September) and 266 commits inventoried. Latest release v6.1.8-Enhanced.1 at7d0abecf33cc887a72dca57aa894057a9c27fe60; main de76195c82a33fa70ec1cb60a277fe55b0332664 includes later model/replay changes.

## Selected fixes

- Local reproduction: installed Prim2 Chrome import succeeded, but OpenAI Platform remained blank. Native DevTools showed its bootstrap JavaScript failing HTTP403; an unauthenticated HEAD corroborated Cloudflare403. Opening a window was incorrectly the only success signal. Add owned navigation state, safe failure diagnostics and explicit retry/external recovery. Do not claim that local code can remove a server403.
- Graphify traced account-pool → workspace → session mutation verification. This revealed an API-origin verification loop, missing renderer-death settlement, and initial programmatic auth navigation outside the mutation owner. Correct those boundaries without adding a blanket navigation restriction. Explicit navigation cancels and joins a background inspection.
- Evan #79/a939b389: challenge handling must retain human drafts, avoid reloading active work, use exact origins, and report managed-tab challenges without resubmission.
- Evan2537456a: retained-history anchor distinguishes older remounted rows from a new submitted turn. Preserve meaningful unique-turn evidence.
- miuuyy#835/f137c2f: expand collapsed user messages; use compiler-owned token or structured user text and exclude connector chrome, instead of brittle full-rendered-text equality.
- miuuyy#832: remove the suggestion control's hidden sizing copy from answer extraction and fingerprints while retaining unrelated answer content.
- miuuyy#840: SDK0.0.12 lacks the initialized-notification option. Upgrade the pinned official SDK to0.0.16 and pass MCP_STDIO_SEND_INITIALIZED_NOTIFICATION only through tunnel startup paths. Preserve existing proxy/control cancellation and account-specific keys.
- Existing local chain fix35d3ec6e is included: user-selected gateway17844 → NEKODEX17841 is recognized without rewriting configuration. Live read-only source route status confirmed the chain.

## Not imported wholesale

Experimental Native2/OpenCodex services, advertised context limits, old unmerged vendor patches and inferred DOM fixes are not equivalent to this fork. Broader compaction/environment variants, model rejection receipts and Windows socket retirement remain separate candidates, with source evidence retained in the item ledgers. Their absence is not presented as a reproduced local failure.

## Verification

A single coordinated focused pass covers browser-window/lease recovery, native reload routing, background-check cancellation, secondary-account import availability, retained turn identity, real Chromium DOM extraction, SDK process environment and session-retry preservation. Corrected failures are rerun only at their changed boundary. Development UI and installed acceptance are pending until their receipts are appended.

Graphify snapshot: 641 code files, 6557 nodes,19771 edges, built13:17UTC with code-only local extraction; no semantic backend. It omits non-code files and runtime callback edges, and browser sources changed after that snapshot. Source inspection confirmed all three graph-derived findings. Final graph freshness is recorded with its artifact.

## Development acceptance receipts

- Launcher typecheck and Vite build completed. The coordinated focused cases passed after two precisely scoped corrections: an invalid crash-test fixture and a real answer-projection mismatch. Previously passing cases were reused. The chained-route tests and live source route status returned no errors.
- DEV6.1.32 launched with the existing isolated profile and retained sign-in. Pro returned exactly `NEKODEX_BROWSER_READY_20261016` in a temporary conversation. Native Reload targeted the browser rather than restarting the shell.
- The API window classified its observed bootstrap-script HTTP403 and offered recovery. Explicit Retry reused the same window/session and loaded the real Platform login page. Saved-account sign-in then reached the actual Cloudflare challenge; the user authorized its checkbox, and the site reported verification successful while waiting for auth.openai.com. That external sign-in is not yet a completed tunnel/connector setup.
- Official SDK0.0.16 downloaded/installed in the isolated DEV home with the pinned checksum and ran successfully. The active production SDK remains unchanged pending the combined local app update.
- Current graph refresh contains6588nodes/19813edges; all9 focus-file hashes match the extraction manifest. Durable artifact: `/Users/alex/.local/share/nekodex/verification/browser-upstream-20261016/graph/graph.html`.

## Follow-up from actual Platform login

After the authorized Cloudflare checkbox succeeded, the old navigation handler blocked a same-source transition and replaced native POST navigation with loadURL(GET). The matching local blocked-operation event established this as an application defect, not merely a slow provider. The handler now reuses the exact same-source/generation owner and allows the browser's original navigation. Three focused event-order tests passed (navigation-first, request-first while verification is pending, and foreign source). The stopped DEV login attempt was closed through its window; no key/tunnel was created. A fresh DEV run verifies the corrected flow.

The installed run exposed an overly broad version-equality gate on account-tunnel setup. Real active Native traffic correctly kept the old core alive, but independent Full-mode peer configuration did not require that core to restart. A narrow patch-family compatibility path now retains the old generation and other peers; two focused constructor/store/subprocess tests passed.
