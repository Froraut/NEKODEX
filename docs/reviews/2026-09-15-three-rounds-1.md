# Three-round review — run 1

Frozen source: 258d89c2a4274e66faf8d6d7ee437a7ce64b23c4. Sixteen gpt-5.6-sol medium reviewers. Raw claims, subject to adjudication. All completed and closed.

## Reviewer 1: Pascal

Agent 01a0a5b3-6d67-7c53-bac2-a633ee95a224

{
  "bugs": [
    {
      "id": "IPC-R1-01",
      "severity": "medium",
      "fileLine": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-helper-main.ts:159",
      "trigger": "An abort frame misses its five-second delivery deadline, the launcher settles that turn, and a retry uses the same trace ID before the helper-side turn ends.",
      "causalEvidence": "The launcher removes the pending entry on abort-delivery failure (launcher-helper-client.ts:614-622, 662-679), but the documented fallback leaves the helper-side turn running until completion or timeout. Trace IDs can repeat (browser-helper-main.ts:202-205). A new run with that ID passes the launcher's pending-map check, then the helper rejects it because its abortControllers map still owns the ID. That error carries the same ID as the new pending turn, so the launcher rejects the retry (launcher-helper-client.ts:443-444, 595-607).",
      "minimalFix": "Keep an ID reserved until the helper acknowledges the old turn's completion, or replace the helper before admitting a retry with that ID after abort delivery fails.",
      "confidence": "medium",
      "unverifiedLimits": "Source-only review. I did not reproduce pipe congestion or establish how often callers retry with an identical trace ID."
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "The launcher checks frame and queued-byte limits before writing and leaves the shared helper alive on local limit rejection.",
    "Normal helper-side turn completion clears prompt selection, Send and fence waiters, abort controller, and mirrored progress."
  ]
}


## Reviewer 2: Zeno

Agent 01a0a5b3-6bf9-76d0-9abf-aa40818fac38

{
  "bugs": [
    {
      "id": "R1-2-B01",
      "severity": "P2",
      "file": "/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:269",
      "trigger": "Global tab capacity is full. The chosen account has a tab with the same conversation key, but the new turn uses a different connector identity or a different trace while that tab is running.",
      "evidence": "ensureTabCapacity returns for any tab with the same key or trace, without checking whether BrowserHost can reuse it. BrowserHost.exactRetainedTurnTab requires a ready tab and an exact connector match (browser-host.cjs:2307–2318); otherwise beginTurn creates a new tab (2406). If that account is below its per-host limit, createTurnTab does not reclaim a tab (590–595), so the pool can exceed its global maxTabs.",
      "minimalFix": "Exempt a turn from global tab reclamation only when its chosen host can reuse the exact tab under the host’s status and connector rules. Otherwise reserve capacity for one new tab.",
      "confidence": "high for the source path; medium for how often the trigger occurs",
      "unverifiedLimits": "Manual source inspection only; no live multi-account reproduction."
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "The documented retained-turn precheck runs after host readiness and before capacity reclamation; no stale R05 finding is repeated."
  ]
}


## Reviewer 3: Helmholtz

Agent 01a0a5b3-6cb5-79a3-b3db-9db165b19f86

{
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "At the frozen commit 258d89c2a4274e66faf8d6d7ee437a7ce64b23c4, manual inspection found no substantiated defect in the scoped paths.",
    "An inactive version 11 journal reconciles a reappeared JSON hook only when its recorded entry matches exactly; changed or ambiguous entries raise an error and retain the journal.",
    "Uninstall checks the hook again before removing journal ownership. The inspected crash windows retain a journal copy from which the operation can resume."
  ]
}

Limits: source and the second-fixes review document were inspected read-only. Crash timing and concurrent external edits were not reproduced.



## Reviewer 4: Fermat

Agent 01a0a5b3-6e0a-7553-b3a2-9172768d067c

{
  "bugs": [
    {
      "id": "S4-01",
      "severity": "medium",
      "file": "/Users/alex/Dev/nekodex/src/setup.ts:752",
      "trigger": "A config save fails before its atomic rename, after setup has written a runtime key or installed tunnel-client.",
      "evidence": "`savedConfigBytes` is set before `saveConfig` at lines 733–737 (also 666–670). The catch treats an existing config whose bytes differ from the planned bytes as an unsafe rollback, even when the file still contains the original bytes. That sets `configRestored=false`; line 787 then skips tunnel and key compensation.",
      "minimalFix": "Checkpoint whether the config write completed. If the current bytes still match `configBeforeRoute`, treat the config as unchanged and allow compensation.",
      "confidence": "high",
      "unverifiedLimits": "Manual source inspection only; the filesystem failure was not reproduced."
    },
    {
      "id": "S4-02",
      "severity": "medium",
      "file": "/Users/alex/Dev/nekodex/src/setup.ts:880",
      "trigger": "DEV full setup supplies a new runtime key and an invalid Tunnel ID, or tunnel configuration fails after the key write.",
      "evidence": "`configureTunnel` writes the managed key at lines 368–372, then installs the client before `createTunnelConfig` validates the ID at line 387. `setupDevProfile` calls it without snapshots or a catch; the later profile/bootstrap and config-save failures also have no compensation. A failed DEV setup can leave the new key or tunnel-client installation behind.",
      "minimalFix": "Validate the Tunnel ID before owned writes and add the same exact-byte compensation for DEV key/client/profile mutations.",
      "confidence": "high",
      "unverifiedLimits": "No DEV failure was reproduced; profile effects depend on which later step fails."
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "Production setup checkpoints tunnel-client bytes and mode and guards rollback against subsequent edits.",
    "A failed external connect that may have written an uncheckpointed profile is deliberately preserved for manual recovery."
  ]
}



## Reviewer 5: Aquinas

Agent 01a0a5b3-6ea9-7023-86c4-a896ac8402b0

{
  "bugs": [
    {
      "id": "R1-5-01",
      "severity": "P2",
      "file": "launcher/electron/runtime-supervisor.cjs:2121",
      "trigger": "Quit or setup stop begins while the initial runtime startup is still waiting for tunnel readiness or a tunnel control command.",
      "evidence": "performStopForSetup awaits startPromise before reaching its bounded recovery settlement. Initial startup calls startTunnel without a recovery signal at line 1341; cancelRecoveries therefore cannot abort that startup. The startup path checks shutdownRequested between waits, but an in-progress control command and subsequent failure cleanup can delay settlement.",
      "minimalFix": "Give initial startup its own cancellation signal, propagate it through tunnel commands and readiness waits, and settle or fence that startup before shutdown cleanup.",
      "confidence": "high",
      "unverifiedLimits": "Manual source inspection only. The exact Quit delay depends on the active command and cleanup path; no live reproduction or timing measurement was run."
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "Recovery tasks have abort controllers and a bounded shutdown settlement.",
    "Committed Quit and failed-Quit restart have explicit start guards."
  ]
}



## Reviewer 6: Godel

Agent 01a0a5b3-6f5f-7670-b2a3-950f6fcae3dc

{
  "bugs": [
    {
      "id": "R1-6-01",
      "severity": "medium",
      "file": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:925",
      "trigger": "Launcher invokes `/admin/cancel-turns` after a completed retained conversation, before compaction or a model switch releases it.",
      "evidence": "`clear()` calls `beginRetirement()` and deletes every session without an existing release obligation (lines 925–930). `beginRetirement()` cancels the turn and waits for physical settlement, but never calls `releaseRetainedConversation` (lines 1012–1050). The callback is the path that asks Launcher to release the retained conversation (`index.ts:442–445`). Removing the entry also removes the owner available to later release paths.",
      "minimalFix": "Before deleting an attached retained session during `clear()`, record and settle a retryable release obligation; keep its owner discoverable until Launcher acknowledges release.",
      "confidence": "high from source inspection",
      "unverifiedLimits": "No runtime reproduction. The observed effect depends on Launcher retaining the conversation after the completed turn."
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "The explicit compaction retirement path keeps entries and conversation keys until release acknowledgement and preserves a settled final response for replay."
  ]
}



## Reviewer 7: Poincare

Agent 01a0a5b3-701e-7933-86a1-0f8369c5d67f

{
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "Manual source inspection at 258d89c2a4274e66faf8d6d7ee437a7ce64b23c4 found no directly reachable defect substantiated within this review scope.",
    "The previously reported partial store-load state and inconsistent root/child delegation decoding are addressed in the current code and documented in docs/reviews/2026-09-15-sol-second-fixes.md.",
    "Current-turn native rollout checks, persisted environment validation, and verified delegation delivery provide causal guards for the paths inspected. Runtime behavior and unusual native transcript shapes remain unverified; no tests, builds, traffic, edits, or extra agents were used."
  ]
}



## Reviewer 8: Ampere

Agent 01a0a5b3-70f4-74b0-8666-1abbc214e87b

{
  "bugs": [
    {
      "id": "R1-8-01",
      "severity": "P2",
      "file": "/Users/alex/Dev/nekodex/src/responses/parser.ts:254",
      "trigger": "A function_call_output or custom_tool_call_output contains an input_image block with file_id but no image_url.",
      "evidence": "schema.ts:5-13 accepts that image block, and schema.ts:31-35 allows it in tool output. Both output paths call outputToToolResultContent (parser.ts:567-588), but its image branch requires image_url. The valid file_id-only block falls through and disappears; an output containing only that block becomes an empty tool result.",
      "minimalFix": "Handle file_id-only tool images explicitly, at least retaining a reference placeholder as the user-message path does. Reject the form if references cannot be represented reliably.",
      "confidence": "High for the source path; actual client use of file_id-only tool images was not verified."
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "Known malformed message types are excluded from the unknown-item fallback.",
    "Inline input_file.file_data and system-message images are rejected explicitly.",
    "Images with image_url remain structured through the parser and prompt attachment path."
  ]
}

This was read-only manual source inspection. No tests, builds, traffic, edits, or additional agents were used.



## Reviewer 9: Lagrange

Agent 01a0a5b3-71ef-7761-a08e-c4c4cbba4b9a

{
  "bugs": [],
  "optimizations": [
    {
      "id": "N9-O1",
      "severity": "low",
      "file": "/Users/alex/Dev/nekodex/src/responses/state.ts:225",
      "trigger": "A long sequence of Web turns using previous_response_id, especially with store:false.",
      "causalSourceEvidence": "expandPreviousResponseInput copies the full prior items array into each new request (lines 177–191). rememberResponseState then stores that expanded input plus the new output (lines 224–227), and measuredEntry serializes the full array to size it (lines 27–35). The module documents the resulting roughly quadratic storage growth at lines 8–10.",
      "minimalFix": "Represent continuation state as a prior-state link plus the turn’s new input and output. Materialize the full item array only when replaying a continuation, while retaining the current expiry and eviction behavior.",
      "confidence": "high for repeated copying; medium for practical efficiency gain",
      "unverifiedLimits": "Manual source inspection only. No workload timings or evidence that this cost dominates request latency."
    }
  ],
  "cleanAreas": [
    "Current native replay removes IDs only from locally restored items and preserves IDs on newly supplied input.",
    "SSE terminal matching keeps a bounded line candidate and requires an exact data: [DONE] line."
  ]
}



## Reviewer 10: Ptolemy

Agent 01a0a5b3-72b4-78c2-b452-7463b9490fe8

{"bugs":[],"optimizations":[],"cleanAreas":["At the frozen commit, claim rejects activity IDs already settled and retires the turn when the active limit is exceeded (turn-broker.ts:1047–1060).","The completion fence requires zero active activities and zero pending native invocations; its commit rechecks the activity revision and rejects later native invocations (turn-broker.ts:443–469, 1127–1149).","MCP claim failures attempt activity cleanup, and invocation transport failures retire the shared binding so late native results cannot be returned as successful MCP responses (mcp-server.ts:465–526, 563–605).","No concrete defect or measured efficiency opportunity was substantiated by manual source inspection. Runtime races and throughput remain unverified."]}



## Reviewer 11: Aristotle

Agent 01a0a5b3-7366-7711-a138-c968c14fe53f

{
  "bugs": [
    {
      "id": "R1-11-01",
      "severity": "medium",
      "file": "/Users/alex/Dev/nekodex/src/browser-login.ts:459",
      "trigger": "During normal managed-Chrome login, launchPersistentContext rejects after starting Chrome but before returning a context handle.",
      "evidence": "Unlike the passkey path, this path does not record that a persistent-context launch was attempted. When context is undefined and the original login process has exited, cleanup at lines 494–503 removes profileDir without confirming whether the Playwright-started Chrome process still owns it.",
      "minimalFix": "Track an attempted persistent-context launch and retain the temporary profile with cleanup instructions whenever closure of that launch cannot be confirmed.",
      "confidence": "high for the missing closure guard; medium for occurrence in a live launch failure",
      "unverifiedLimits": "No Chrome failure was reproduced; Playwright’s behavior after a rejected launch was not observed."
    },
    {
      "id": "R1-11-02",
      "severity": "medium",
      "file": "/Users/alex/Dev/nekodex/src/browser-login.ts:481",
      "trigger": "A repeat normal login writes new storage state, then writing its verification marker fails.",
      "evidence": "Lines 481–482 write state before marker without invalidating the old marker. The passkey file path removes its marker first at line 416. browserLoginStateExists at lines 516–525 accepts the surviving old marker, and the worker checks for marker existence before loading the new state at lines 2358–2369.",
      "minimalFix": "Remove or invalidate the old verification marker before replacing state; write a new authenticated marker only after both state persistence and verification succeed.",
      "confidence": "high",
      "unverifiedLimits": "The disk-write failure was not injected. The resulting session behavior depends on the newly saved state."
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "The passkey path retains its profile when Chrome closure is uncertain.",
    "Completed-answer managed-Chrome state-save failure is handled as a warning."
  ]
}


## Reviewer 12: Meitner

Agent 01a0a5b3-7418-7252-9647-783e9946f331

{
  "bugs": [],
  "optimizations": [
    {
      "id": "R12-OPT-01",
      "severity": "low",
      "file": "/Users/alex/Dev/nekodex/launcher/src/App.tsx:102",
      "trigger": "Any operation emits a completed event after renderer initialization.",
      "causalSourceEvidence": "The handler calls refreshCompletedOperation for every completed operation. That function requests a full launcher snapshot, but copies only state, MCP credential status, and context capabilities into the existing snapshot.",
      "minimalFix": "Refresh only for operation types that can change those displayed fields, or provide a smaller metadata request for this refresh.",
      "confidence": "high",
      "unverifiedLimits": "No runtime measurement was made. The size and frequency of completed-operation snapshots were not measured."
    }
  ],
  "cleanAreas": [
    "Initial listeners register before the snapshot request, and pending state, browser, operation, update, and log events are reconciled when it resolves.",
    "MCP credential status is copied into parent snapshot state and passed to McpSurface; its local state follows later parent changes when credentials are not being replaced."
  ]
}

Manual source inspection only at `258d89c2a4274e66faf8d6d7ee437a7ce64b23c4`; no tests or live race reproduction. No substantiated bug found.



## Reviewer 13: Franklin

Agent 01a0a5b3-74c3-7ab1-8dde-4dd12c2eedbd

{
  "bugs": [
    {
      "id": "R1-13-01",
      "severity": "P2",
      "file": "/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:122",
      "trigger": "Adding an account succeeds in saving its metadata, but creating or preparing its BrowserHost fails.",
      "evidence": "`registry.add(label)` persists the new enabled account and selects it at line 125. The failure handler at line 127 restores only the previous selection; it leaves the new account in the registry. The UI reports an add failure although a new account remains saved.",
      "minimalFix": "Make account creation transactional: remove the newly added account on host preparation failure, or prepare the host before committing registry metadata.",
      "confidence": "high",
      "unverifiedLimits": "Source inspection only; the host failure was not reproduced."
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "AccountSettings coalesces background refresh requests and rejects replies invalidated by newer events.",
    "The account snapshot derives readiness flags from the pool’s current capability and connector maps."
  ]
}



## Reviewer 14: Goodall

Agent 01a0a5b3-7561-75c0-b188-4c522c750410

{
  "bugs": [
    {
      "id": "R1-14-B1",
      "severity": "medium",
      "fileLine": "scripts/install-launcher.ps1:37",
      "trigger": "The newest published release is a documented macOS-only prerelease, and a Windows user runs the installer without CODEX_WEB_GPT_VERSION.",
      "evidence": "The script requests only one release and constructs a Windows installer URL from its tag at lines 52–53. The release contract explicitly permits prereleases containing only macOS assets (docs/release-signing.md:212–217). The download then fails even if an older Windows release is available. The Linux path has the same selection problem at scripts/install-launcher.sh:38.",
      "minimalFix": "Fetch a bounded release list and select the newest published release containing the asset for the detected platform; report clearly when none exists.",
      "confidence": "high",
      "unverifiedLimits": "Manual source inspection only; no release API or installer execution."
    }
  ],
  "optimizations": [
    {
      "id": "R1-14-O1",
      "severity": "low",
      "fileLine": "launcher/electron/main.cjs:1242",
      "trigger": "A compatible release is published while NEKODEX remains open.",
      "evidence": "Startup calls checkOnce once. Its checked flag blocks subsequent checks (launcher/electron/update.cjs:397–400), and the inspected IPC exposes installation but no check action. The running app therefore retains its prior update state until restart.",
      "minimalFix": "Allow a bounded refresh from the UI or a low-frequency timer, with a cooldown for failures.",
      "confidence": "medium",
      "unverifiedLimits": "This is an availability improvement, not a proven violation of the intended update contract."
    }
  ],
  "cleanAreas": [
    "Packaged update repository and release-trust repository both identify Froraut/NEKODEX.",
    "Updater verifies signed metadata identity and asset hash before staging."
  ]
}


## Reviewer 15: Euclid

Agent 01a0a5b3-75fe-7743-8993-f782ce5d59ad

{
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "CI named-case selection: mixed backend and capacity changes select at most five named cases in one Linux invocation. Overflow and unmapped paths are explicitly marked for manual review.",
    "Release packaging and digests: the packaging script stages final artifacts before copying them; the workflow generates checksums after asset collection; signed metadata hashes the collected bytes; publication checks every local asset and compares each draft asset’s remote digest.",
    "Limits: manual source inspection only at main 258d89c2a4274e66faf8d6d7ee437a7ce64b23c4. No tests, builds, release runs, or live digest checks were performed."
  ]
}



## Reviewer 16: Peirce

Agent 01a0a5b3-7693-7840-b0b0-c1de95f49688

{"bugs":[],"optimizations":[],"cleanAreas":["Manual source inspection of compaction-handoff.ts, compaction-continuation.ts, retry-policy.ts, stall-timeout.ts, their direct callers, and the second-fixes review found no directly reachable defect or efficiency change supported strongly enough to report.","The apparent cancellation-versus-cached-summary concern is fenced at the HTTP turn boundary: server.ts records interrupted native turns and aborts later requests with the same identity."]}

No tests, build, app traffic, scripts, edits, or additional agents were used. The cancellation race was not reproduced at runtime; this conclusion is limited to the inspected source at `258d89c2a4274e66faf8d6d7ee437a7ce64b23c4`.
