# Three-round review — run 3

Frozen source: 258d89c2a4274e66faf8d6d7ee437a7ce64b23c4. Sixteen fresh gpt-5.6-sol medium reviewers, informed by rounds 1 and 2. Raw claims subject to adjudication. All completed and closed.

## Reviewer 1: Socrates

Agent 01a0a5b8-6463-7cc2-8a1f-3ac0bad11216

{
  "previous": [
    {
      "id": "IPC-R1-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts:614",
      "evidence": "If abort delivery fails, finishWithError removes the launcher pending entry (lines 614-622, 662-679), while the helper can retain the ID until its run finishes (browser-helper-main.ts:159, 325-339). The worker's activeRuns guard ends with the settled launcher promise (browser-worker.ts:2219-2238), and the direct caller derives repeatable trace IDs (index.ts:213-223). A same-ID retry during that interval can therefore be rejected by the helper. This remains a source-derived timing case."
    },
    {
      "id": "IPC-R2-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts:515",
      "evidence": "The Send acknowledgement continuation checks pending identity but not the abort signal (lines 513-517). Abort removes the helper's Send waiter (browser-helper-main.ts:473-480); an acknowledgement processed afterward emits a same-ID error (lines 427-431), which can settle the launcher turn before the helper's abort result (launcher-helper-client.ts:595-607). The direct callers' callbacks are synchronous, which narrows the timing window, but does not eliminate it when abort is queued before the launcher processes an already emitted send_activated event. Ordering was not reproduced."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The line reader bounds retained input before decoding and routes an oversized or throwing frame callback to failure handling (process-line-reader.ts:33-34, 50-69).",
    "On normal helper turn finalization, prompt selection, Send and fence waiters, abort controller, and mirrored progress are removed (browser-helper-main.ts:325-339)."
  ]
}


## Reviewer 2: Harvey

Agent 01a0a5b8-64f1-7161-8da7-8389a51d1e81

{
  "previous": [
    {
      "id": "R1-2-B01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:269",
      "evidence": "The pool exempts any tab with the same conversation key from global reclamation. BrowserHost reuses a tab only when it is ready, automatic, and matches the connector identity and binding (browser-host.cjs:2307–2318, 2353–2357). Otherwise it creates one (2406); a host below its own limit does not reclaim capacity (590–595). The automatic API passes the key and connector identity through control-server.cjs:285–293."
    }
  ],
  "bugs": [
    {
      "id": "R3-2-B01",
      "severity": "P2",
      "file": "/Users/alex/Dev/nekodex/launcher/electron/browser-host.cjs:2353",
      "trigger": "Two automatic start requests use different trace IDs and the same conversation key while the first turn is running, with capacity available for another tab.",
      "causalGuard": "The existing-turn check matches trace ID; exactRetainedTurnTab matches only ready tabs. Neither rejects a different running trace with the same conversation key.",
      "evidence": "The pool pins the second request to the first tab’s account through chooseAccount (account-pool.cjs:232–238), but BrowserHost creates a second tab at 2406. If both turns complete with retention, endTurn retains both (2449–2459); a later continuation encounters the multiple-tab error at 2315–2316. The authenticated start API validates the key but has no running-key exclusion (control-server.cjs:142–165, 281–293).",
      "minimalFix": "Reject a new trace while another turn with that conversation key is running on its chosen host, before creating a tab. Keep the existing same-trace ownership checks.",
      "confidence": "high for the source path; concurrency frequency unverified",
      "unverifiedLimits": "Read-only manual source review; no runtime reproduction."
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "Pending affinity is installed before the host readiness await and removed in finally (account-pool.cjs:296–322). The inspected key-routing path supports the earlier conclusion that reservations preserve account ownership across that wait.",
    "Manual start follows its separate synchronous path; a same-trace automatic tab is rejected by BrowserHost (browser-host.cjs:2043–2047). No additional Manual-mode finding is supported here."
  ]
}


## Reviewer 3: Kepler

Agent 01a0a5b8-6579-76f0-aafe-80ecb0edc5d6

{
  "previous": [
    {
      "id": "P1-no-substantiated-defect",
      "status": "confirm",
      "file": "src/setup.ts:743",
      "evidence": "The additional setup caller installs the Codex route at the end of its transaction. Its catch path restores the application configuration only when the bytes still match what setup wrote. This path did not substantiate a new scoped defect at the frozen commit; the conclusion is limited to manual source inspection."
    },
    {
      "id": "P2-inactive-json-hook",
      "status": "confirm",
      "file": "src/codex-integration-journal.ts:330",
      "evidence": "The alternate route-status API reads a journal snapshot without invoking reconciliation. The operational readJournal path reconciles an inactive JSON hook before returning an identical pair of journals, or the selected journal after copy recovery. The recorded-slot and exact-entry guards examined in earlier rounds still support the claim."
    },
    {
      "id": "P3-uninstall-crash-recovery",
      "status": "uncertain",
      "file": "src/codex-integration-shared.ts:423",
      "evidence": "The recovery journal is written before config and hooks, with the primary journal written last. Uninstall removes recovery before primary; if interrupted between those removals, readJournal can recreate recovery from primary. These are source-derived recovery paths. Crash timing and a concurrent edit between the final check and write remain untested, so the broader recovery claim is not confirmed."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The route diagnostics API uses readJournalSnapshot and marks active state unknown when journal copies differ; it does not silently perform repair during a status request.",
    "Read-only manual review of the frozen source and second-round review document. No tests, builds, traffic, edits, or agents."
  ]
}


## Reviewer 4: Erdos

Agent 01a0a5b8-6602-72f0-9529-0afeae03a648

{
  "previous": [
    {
      "id": "S4-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/setup.ts:752",
      "evidence": "Both production save paths set savedConfigBytes before saveConfig. atomicWriteFile can fail before its rename, leaving the original config bytes in place. The catch accepts only the planned bytes, sets configRestored=false, and skips tunnel, client, and key compensation."
    },
    {
      "id": "S4-02",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/setup.ts:880",
      "evidence": "The DEV CLI calls setupDevProfile in an isolated home. configureTunnel can write its managed key and install tunnel-client before createTunnelConfig validates the supplied ID. setupDevProfile has no snapshots or compensation for subsequent setup failures. Bytes possibly written by a failed external profile connect have uncertain ownership."
    },
    {
      "id": "S4-03",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/setup.ts:588",
      "evidence": "Production snapshots the managed key before configureTunnel; installRuntimeKeyBytes replaces it without an expected-before comparison. An intervening edit can be overwritten, and a later rollback can restore the older snapshot when the current key matches setup's write. The tunnel-client installer does perform an expected-before check."
    }
  ],
  "bugs": [
    {
      "id": "S4-04",
      "severity": "medium",
      "file": "/Users/alex/Dev/nekodex/src/setup.ts:670",
      "trigger": "Another writer edits the config after configUnchanged passes but before production saveConfig performs its atomic replacement; the launcher-owned save at line 737 has the same gap.",
      "causalGuard": "configUnchanged checks the snapshot before the save, but saveConfig re-reads the current file only to preserve its BOM and does not require its bytes to match configBeforeRoute.",
      "evidence": "setup.ts checks at lines 665 and 732, then saves at lines 670 and 737. config.ts:580–583 reads the current file and calls atomicWriteFile without an expected-before check. An intervening edit is overwritten. If a later step fails, the rollback can restore the still older snapshot because the file matches setup's planned bytes.",
      "fix": "Make the config replacement conditional on its current bytes matching configBeforeRoute at the write boundary; compensate only a verified owned replacement.",
      "confidence": "high; source-derived interleaving, not reproduced"
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "Tunnel-client installation compares its current bytes and executable mode with the production pre-install snapshot before installation, and its restore path rejects subsequent edits.",
    "Production preserves uncheckpointed profile bytes that a failed external connect may have written; the source does not establish ownership of those bytes."
  ]
}

## Reviewer 5: Hypatia

Agent 01a0a5b8-6711-7703-b44b-9056ed0afa62

{
  "previous": [
    {
      "id": "R1-5-01",
      "status": "confirm",
      "file": "launcher/electron/runtime-supervisor.cjs:2121",
      "evidence": "performStopForSetup awaits startPromise without a settlement bound. Initial startup calls startTunnel without a signal at line 1341, so cancelRecoveries cannot abort its in-progress control command. shutdownRequested prevents later starts but does not interrupt that command or its failure cleanup. The resulting Quit delay is source-derived; it was not measured."
    },
    {
      "id": "R2-5-01",
      "status": "refute",
      "file": "launcher/electron/main.cjs:1001",
      "evidence": "For the stated trigger, connectBridgeRoute sets lifecycleOperation to bridge-connect before its first await (runtime.cjs:973-979). requestQuit checks runtimeHost.currentOperation before calling shutdown and refuses Quit while that connection is pending. The claimed Quit-during-connect shutdown therefore does not follow from this path."
    }
  ],
  "bugs": [
    {
      "id": "R3-5-01",
      "severity": "P2",
      "file": "launcher/electron/main.cjs:1428",
      "trigger": "Initial runtime startup fails or is cancelled for Quit, and the detached startup catch begins its route restoration after requestQuit has passed its active-operation check.",
      "causalGuard": "requestQuit checks currentOperation only at line 1001; restoreCodexRouteAfterRuntimeFailure does not check shutdownInProgress, quitting, or exitCommitted before starting a new operation.",
      "evidence": "The catch unconditionally calls restoreCodexRouteAfterRuntimeFailure. That helper invokes runtimeHost.restoreBridgeRoute, which can run route disconnect and verification commands (runtime.cjs:943-969). Its lifecycleOperation guards a subsequent Quit attempt, but cannot stop a Quit already proceeding through runtime shutdown. Route restoration and its state updates can therefore overlap that shutdown. This is a source-derived race; no runtime reproduction was performed.",
      "fix": "Fence the detached failure continuation when Quit has begun, and coordinate any permitted route restoration with shutdown before changing the route or publishing its result.",
      "confidence": "medium"
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "Recovery timer callbacks recheck stopping and shutdownRequested before creating a task.",
    "An in-flight bridge connection is represented by runtimeHost.currentOperation and blocks requestQuit."
  ]
}

## Reviewer 6: Cicero

Agent 01a0a5b8-6689-77f0-859e-a6b4459a8da0

{
  "previous": [
    {
      "id": "R1-6-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:925",
      "evidence": "The authorized /admin/cancel-turns handler calls clear() (src/server.ts:1036–1043). For an attached session without an existing obligation, clear() calls beginRetirement() and removes the entry and conversation head. beginRetirement() waits for physical settlement but never invokes releaseRetainedConversation (lines 1012–1050). The Launcher callback is supplied for eligible retained turns (index.ts:432–445). This is a source-derived release-obligation gap; retained-tab persistence was not reproduced."
    },
    {
      "id": "R2-6-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:992",
      "evidence": "getOrCreate() and activeCount() invoke prune(). Once an attached session is settled and older than the TTL, prune() removes its entry and head without establishing a release obligation (lines 994–1002). The later model-switch release path searches entries (lines 708–713), while compaction looks up the head (index.ts:988–1000). This has the same root cause as R1-6-01 at another callsite. The 30-minute Launcher outcome remains unverified at runtime."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The distinct explicit conversation-retirement path records an obligation before waiting for physical settlement and invokes the Launcher callback before detaching entries (turn-execution.ts:813–858). A failed callback leaves that obligation available for retry.",
    "Review of the native interrupt API found another removal path for exact turn IDs (src/server.ts:986–1034; turn-execution.ts:954–971). Its missing retained release belongs to the already reported retirement root cause, so it is not counted as a new finding."
  ]
}


## Reviewer 7: Turing

Agent 01a0a5b8-679a-75f1-9be4-f46e791a12ba

{
  "previous": [
    {
      "id": "prior-no-reachable-defect",
      "status": "refute",
      "file": "src/adapters/chatgpt-web/thread-environment.ts:243",
      "evidence": "set() changes the in-memory entry before persist() succeeds. The caller at index.ts:861–869 propagates a write error, but a later request in the same process can read the unpersisted entry."
    },
    {
      "id": "prior-store-load-and-delegation-fixes",
      "status": "confirm",
      "file": "src/adapters/chatgpt-web/thread-environment.ts:267",
      "evidence": "load() validates into a temporary collection before replacing the map. native-delegation.ts:43 decodes the verified envelope before both the root and child branches."
    },
    {
      "id": "prior-causal-guards-and-runtime-limit",
      "status": "confirm",
      "file": "src/adapters/chatgpt-web/codex-rollout-environment.ts:29",
      "evidence": "Delegation checks the claimed delivery against a response item in the current native turn. The environment fallback also requires current rollout evidence. This review did not establish runtime behavior for unusual transcript shapes."
    },
    {
      "id": "R2-7-01",
      "status": "confirm",
      "file": "src/adapters/chatgpt-web/thread-environment.ts:243",
      "evidence": "atomicWriteFile can fail before replacing the file, after set() has published the new map entry. The TTL deletion at lines 235–237 has the same publish-before-write root cause and is one finding under the parent counting rule."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "Independent read-only inspection of the TTL retirement path and server delegation boundary found no additional substantiated defect. No tests, builds, traffic, edits, scripts, or agents were used."
  ]
}


## Reviewer 8: Hegel

Agent 01a0a5b8-681f-7601-b1bb-0e04100b19fa

{
  "previous": [
    {
      "id": "R1-8-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/responses/parser.ts:254",
      "evidence": "schema.ts:5-13 and 31-35 accept a file_id-only input_image in tool output. Both tool-output branches use outputToToolResultContent, which retains an image only when image_url is a string. The file_id-only block is dropped, and a sole such block becomes empty content. server.ts:480-493 catches parser errors, but this path does not throw. This is source-derived; client use was not verified."
    },
    {
      "id": "R2-8-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/responses/parser.ts:535",
      "evidence": "tool_search_call and tool_search_output enter through the loose unknown-item schema because schema.ts:102-105 omits both types. parser.ts:527-530 can create a call with id \"\", and parser.ts:555-556 can create a result with toolCallId \"\" when call_id is absent. prompt.ts:227-238 and 288-296 forward those IDs. server.ts:480-493 catches thrown parse errors, but neither missing-ID path throws. The reachable malformed-request path is source-derived; native client occurrence was not established."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The request boundary returns parser exceptions as 400 errors before routing the Web turn (server.ts:480-493).",
    "The prompt projects image_url-backed tool-result images as attachment references and retains the pairing ID supplied by the parser (prompt.ts:194-213, 283-296).",
    "The Hermes caller excludes tool_search history and independently checks pending function-call result IDs (hermes-integration.ts:73-112)."
  ]
}



## Reviewer 9: Hooke

Agent 01a0a5b8-68aa-7de0-81df-de2b9422e33d

{
  "previous": [
    {
      "id": "N9-O1",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/responses/state.ts:188",
      "evidence": "On a Web continuation, responseRequest expands the stored prior items before parsing (server.ts:478), then records the expanded input plus new output (server.ts:523–526; state.ts:224–227). Repeated chained turns therefore copy and measure growing arrays. A linked representation would have to preserve replay across expiry, eviction, and disk snapshot omissions. No latency gain was measured."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The native /responses and /responses/compact callers pass decoded JSON to forwarding (server.ts:467,761). Forwarding still reads the original request bytes; when no local continuation or bridge artifact requires rewriting, it forwards those bytes (native-passthrough.ts:259–298).",
    "A local continuation removes previous_response_id and strips IDs only from the restored prefix (native-passthrough.ts:278–291). A cache miss retains the original upstream continuation. Bridge-artifact scrubbing can additionally remove IDs across the full input, so newly supplied IDs are not unconditionally preserved.",
    "SSE inspection bounds its line candidate and matches an exact data: [DONE] line, including an unterminated final line (native-passthrough.ts:177–223). A read error before that marker reaches the client. These source checks yielded no new valid finding."
  ]
}

## Reviewer 10: Parfit

Agent 01a0a5b8-692f-72a1-a4de-3d22a1aabc25

{
  "previous": [
    {
      "id": "activity-limit",
      "status": "confirm",
      "file": "src/adapters/chatgpt-web/turn-broker.ts:1047",
      "evidence": "A delayed Manual mode claim rechecks the channel after waiting for Sent. A completed activity ID cannot be claimed again; a new claim at the 64-active limit revokes the turn before adding the ID."
    },
    {
      "id": "completion-fence",
      "status": "confirm",
      "file": "src/adapters/chatgpt-web/turn-broker.ts:443",
      "evidence": "Begin and commit require zero active activities and pending invocations. Commit checks the captured activity revision, then marks the channel committed synchronously; later claims and invocations reject it."
    },
    {
      "id": "mcp-cleanup-and-late-results",
      "status": "confirm",
      "file": "src/adapters/chatgpt-web/mcp-server.ts:465",
      "evidence": "A failed claim attempts cleanup with its client-owned activity ID. An invocation transport failure attempts release of the shared binding; broker revocation rejects and clears pending invocations. The late-result guarantee depends on release reaching the broker."
    },
    {
      "id": "no-substantiated-defect-or-efficiency-gain",
      "status": "confirm",
      "file": "src/adapters/chatgpt-web/turn-broker.ts:428",
      "evidence": "This additional read-only inspection of delayed claims, owner completion, and socket failure paths found no new concrete defect or measured efficiency opportunity. Runtime races and throughput remain unverified."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "A Manual mode claim waiting for Sent rechecks channel existence and completion state before recording activity (turn-broker.ts:1027–1060).",
    "Owner completion accepts only a still-pending call ID that was delivered; revocation rejects and clears pending calls, so a later owner result fails (turn-broker.ts:428–440, 1203–1215).",
    "An ambiguous claim response is followed by cleanup using the same activity ID; cleanup leaves a tombstone that blocks a delayed claim from reopening activity (mcp-server.ts:471–489; turn-broker.ts:1077–1104)."
  ]
}


## Reviewer 11: Copernicus

Agent 01a0a5b8-69bc-7d51-b39c-ad1f182b437a

{
  "previous": [
    {
      "id": "R1-11-01",
      "status": "uncertain",
      "file": "/Users/alex/Dev/nekodex/src/browser-login.ts:459",
      "evidence": "If launchPersistentContext rejects before assigning context, cleanup at lines 494–503 has no handle for the attempted launch and removes the temporary profile when the original login process has exited. The passkey path retains its profile in this situation at lines 377–385. The installed Playwright package is bundled, and this review did not establish whether a rejected launch can leave Chrome owning the profile. The surviving-process claim therefore remains unproven."
    },
    {
      "id": "R1-11-02",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/browser-login.ts:481",
      "evidence": "Normal repeat login replaces storage state at line 481 before writing its marker at line 482, without invalidating an existing marker. If the marker write fails, browserLoginStateExists still accepts the old marker at lines 516–525; the worker checks only for both files at lines 2358–2359 and 2376–2377. inspectStoredState verified the new state before persistence, so this establishes stale verification metadata, not an unauthenticated session."
    },
    {
      "id": "R2-11-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-worker.ts:2386",
      "evidence": "ensureManagedBrowser obtains a local browser at lines 2382–2385 but assigns this.browser only after newContext succeeds. A rejection at line 2386 clears the opening promise without closing that local browser; close() can reach only this.browser. ensurePage has the related failure path at lines 2364–2369. This is a source-derived handle leak; no storage-load failure was reproduced."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "inspectStoredState closes its verifier browser in a finally block even if context creation or inspection fails.",
    "After a completed managed-Chrome answer, storage-state write failure is caught and warned about; diagnostic capture also catches its own write failures before the answer returns."
  ]
}


## Reviewer 12: Bacon

Agent 01a0a5b8-6a45-7c91-9295-9c5bf65aa24d

{
  "previous": [
    {
      "id": "R12-OPT-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/launcher/src/App.tsx:69",
      "evidence": "Every completed operation after initialization calls refreshCompletedOperation, which requests the full launcher snapshot and applies only state, MCP credential status, and context capabilities. The snapshot API also includes browser state, logs, and other fields. MCP verification additionally calls updateSnapshot after completion. Filtering must retain completions that change the applied fields; request size, frequency, and performance impact were not measured."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The Settings caller uses the main-process target-mode credential check: missing credentials open MCP configuration without changing the current mode. MCP setup validates or replaces credentials for the requested mode, then publishes the changed state.",
    "An operation event received before the initial snapshot resolves is retained; a pending completion requests fresh metadata afterward. Live state events increment a revision so an older refresh cannot replace a newer state event."
  ]
}

Read-only source inspection at `258d89c2a4274e66faf8d6d7ee437a7ce64b23c4`. No tests, build, traffic, or live race reproduction; no new substantiated finding.



## Reviewer 13: Maxwell

Agent 01a0a5b8-6ace-7ed0-a4ec-623cdc31be36

{
  "previous": [
    {
      "id": "R1-13-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:125",
      "evidence": "registry.add persists and selects the new account before selectedHost().ready(). If host initialization rejects, the catch restores the previous selection but leaves the new account saved. AccountSettings reports the rejected action without refreshing its account list."
    }
  ],
  "bugs": [
    {
      "id": "R3-13-01",
      "severity": "P2",
      "file": "/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:154",
      "line": 154,
      "trigger": "The user clicks Check or Check connector for an account while that host has an active turn or browser operation.",
      "causalGuard": "AccountSettings disables these buttons only for its local busy state. BrowserHost.withManualOperation rejects inspection when a turn or manual operation is active.",
      "evidence": "checkAccount deletes cached capability evidence, and possibly connector evidence, before awaiting inspectSession. On rejection it neither restores those entries nor publishes an account snapshot. AccountSettings displays the error but does not refresh after a failed action, so its Checked or connector-ready indicator can remain green while the pool maps have already been cleared. Model routing reads those maps.",
      "minimalFix": "Reject conflicting checks before clearing evidence; on an inspection failure, publish the resulting account state or restore the prior evidence according to the intended invalidation policy, and refresh the UI after failed actions that can mutate state.",
      "confidence": "high",
      "unverifiedLimits": "Source-derived; no runtime reproduction."
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "The accounts IPC handler returns accountSnapshot directly, and the UI refresh path ignores an in-flight response invalidated by a newer browser or operation event.",
    "The snapshot's checked and connectorReady flags reflect membership in the pool's current evidence maps; this is a source-contract assessment."
  ]
}


## Reviewer 14: Mencius

Agent 01a0a5b8-6b55-70c1-bbc0-6eac50313c0a

{
  "previous": [
    {
      "id": "R1-14-B1",
      "status": "confirm",
      "file": "scripts/install-launcher.ps1:37",
      "evidence": "Without CODEX_WEB_GPT_VERSION, PowerShell requests releases?per_page=1 and uses the first tag to construct a Windows asset URL (lines 35–53). The shell installer does the same for macOS or Linux (scripts/install-launcher.sh:35–52). The release policy permits macOS-only prereleases (docs/release-signing.md:212–217), so a newer such release can make default Windows or Linux installation fail despite an older compatible release. Source-derived; no release API or installer execution."
    },
    {
      "id": "R1-14-O1",
      "status": "confirm",
      "file": "launcher/electron/update.cjs:397",
      "evidence": "checkOnce sets checked before its fetch and leaves it set after an error (lines 397–445). main.cjs:1242 calls it at startup; the inspected IPC offers update installation at main.cjs:971–979 but no refresh call. This confirms the availability limitation, without establishing a contract defect."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The separate updater path filters releases that explicitly omit the platform archive (update.cjs:35–52). A selected archive with missing trust assets fails closed rather than falling back (update.cjs:421–437).",
    "Installation checks signed repository, tag and version identity, then requires the selected asset size and SHA-256 to match the signed metadata before staging (release-trust.cjs:58–99; update.cjs:456–510). The staged application also checks its packaged update repository (update-validation.cjs:384–388). These are source-derived findings; no runtime reproduction was performed."
  ]
}


## Reviewer 15: Bernoulli

Agent 01a0a5b8-6be2-7b80-bf8f-5b019a376ad7

{
  "previous": [
    {
      "id": "prior-ci-selection",
      "status": "refute",
      "file": "scripts/focused-pr-check.ts:78",
      "evidence": "The push caller uses git diff --name-only and retains only the reported destination of a detected rename. A mapped backend or capacity path renamed into docs/*.md can therefore be classified as metadata without a behavior case. The PR caller includes previous_filename at lines 57–62."
    },
    {
      "id": "prior-release-digests",
      "status": "confirm",
      "file": "scripts/publish-release.cjs:19",
      "evidence": "The workflow collects and flattens assets before checksumming and signing. Publication checks each local asset against signed metadata, then compares each draft asset with the digest reported by GitHub. This is a source-level confirmation conditional on that API digest."
    },
    {
      "id": "prior-limits",
      "status": "confirm",
      "file": ".github/workflows/release.yml:232",
      "evidence": "This round inspected source at the frozen commit only. No tests, builds, release operations, or live digest checks were performed."
    }
  ],
  "bugs": [
    {
      "id": "package-removes-previous-artifacts-before-validating-staging",
      "severity": "medium",
      "file": "launcher/scripts/package.cjs:150",
      "trigger": "electron-builder exits successfully but staging contains no distributable AppImage, DMG, EXE, or ZIP.",
      "evidence": "Lines 150–155 delete existing distributable files from launcher/artifacts. The no-distributable guard runs afterward at lines 156–160 and throws, leaving the previous files removed. This concerns a packaging failure path; it does not contradict the release workflow's digest checks for a successful build.",
      "fix": "Enumerate and validate staged distributables before removing existing artifacts; then replace the output files.",
      "confidence": "high"
    }
  ],
  "optimizations": [],
  "cleanAreas": []
}


## Reviewer 16: Dalton

Agent 01a0a5b8-6c79-7171-ba21-2242c6d2f723

{
  "previous": [
    {
      "id": "prior-clean-scope",
      "status": "refute",
      "file": "src/adapters/chatgpt-web/compaction-handoff.ts:474",
      "evidence": "The owner settlement and retained-conversation retirement guards hold on the inspected paths. A separate cached-success path bypasses the interruption check after the HTTP interruption record is evicted; see the new finding."
    },
    {
      "id": "cancellation-versus-cached-summary",
      "status": "refute",
      "file": "src/server.ts:143",
      "evidence": "The HTTP turn boundary aborts a later request only while its identity remains in HttpTurnCounter.interrupted. That map evicts its oldest identity above 1,024 entries. The earlier claim that all later requests with the same identity are aborted is therefore too broad."
    }
  ],
  "bugs": [
    {
      "file": "src/adapters/chatgpt-web/compaction-handoff.ts:474",
      "trigger": "A structured compaction succeeds and remains cached. Its native turn is then interrupted, followed by enough distinct interruptions to evict that identity from HttpTurnCounter.interrupted. The exact compact request is submitted again before the cached run expires.",
      "causalGuardEvidence": "cancelStructuredCompactionNativeTurn records the interruption but cancels only active runs (compaction-handoff.ts:532-540). runStructuredCompactionOnce returns an existing cached promise before checking the interruption. The caller also checks existingStructuredCompactionRun first (index.ts:900). Once the HTTP record is evicted (server.ts:143-147), bindIdentity no longer aborts this replay (server.ts:239-240). A completed summary can consequently be returned for an interrupted turn.",
      "fix": "Apply the native-turn interruption check before returning a cached compaction result, including at the caller’s cache lookup. Keep the interruption and cache retention policies aligned within their existing bounds.",
      "confidence": "medium; directly reachable from source, not reproduced at runtime"
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "The inspected fallback registers its physical settlement before awaiting the browser result; retirement waits for retained-session settlement and release acknowledgement.",
    "The retry budget is keyed to the native turn, and adapter heartbeats remain armed across the compaction wait. These are source-only observations at 258d89c2a4274e66faf8d6d7ee437a7ce64b23c4."
  ]
}
