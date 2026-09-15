# Three-round review — run 2

Frozen source: 258d89c2a4274e66faf8d6d7ee437a7ce64b23c4. Sixteen fresh gpt-5.6-sol medium reviewers, informed by round 1. Raw claims subject to adjudication. All completed and closed.

## Reviewer 1: Lorentz

Agent 01a0a5b5-b8a2-73e3-ba88-bf53699b3eed

{
  "previous": [
    {
      "id": "IPC-R1-01",
      "status": "confirm",
      "evidence": "The worker rejects a duplicate trace ID only while its own run promise is active (browser-worker.ts:2219-2238). An abort-delivery failure settles the launcher promise and deletes its pending entry, while the helper may still own that ID until its run ends (browser-helper-main.ts:159, 325-339). The direct caller derives trace IDs deterministically (index.ts:213-223), and its physical-settlement guard waits for the worker promise, which has already settled in this failure path (index.ts:92-109; turn-execution.ts:666-693). The claim remains conditional on abort delivery failing and a same-ID retry arriving before helper cleanup; neither timing was reproduced.",
      "file": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts:614"
    }
  ],
  "bugs": [
    {
      "id": "IPC-R2-01",
      "severity": "medium",
      "file:line": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/launcher-helper-client.ts:515",
      "trigger": "The turn aborts after a send_activated event while the launcher's acknowledgement callback is still pending.",
      "evidence": "The acknowledgement continuation checks only whether the pending entry still exists (lines 513-517). Abort delivery does not immediately remove it. The helper's abort handler deletes and rejects the Send waiter (browser-helper-main.ts:473-480); a subsequent send_activation_ack elicits a same-ID 'no pending Send activation' error (lines 427-431). If that error arrives before the helper's abort result, the launcher rejects the turn with the acknowledgement error (launcher-helper-client.ts:595-607). Direct callers provide onSendActivated callbacks (index.ts:513; compaction-handoff.ts:330). Ordering is source-derived and was not reproduced.",
      "fix": "Suppress Send acknowledgement once the turn's abort signal is aborted; make the helper ignore an acknowledgement for a waiter already removed by abort.",
      "confidence": "medium"
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "The worker's activeRuns guard prevents concurrent same-ID calls while its launcher promise remains unsettled.",
    "Helper abort and finalization reject outstanding Send and completion-fence waiters and remove per-turn maps."
  ]
}


## Reviewer 2: Singer

Agent 01a0a5b5-b923-7951-8a0e-fc9c5cc18002

{
  "previous": [
    {
      "id": "R1-2-B01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:269",
      "evidence": "At global tab capacity, ensureTabCapacity exempts any matching conversation key. For a new trace, BrowserHost can reuse only a ready automatic tab with the exact connector identity and binding (browser-host.cjs:2307–2318, 2353–2357). With a different connector, beginTurn creates a tab (2406). The per-host guard reclaims only when that host reaches maxTabs (590–595), so a chosen host below its limit can take the global pool past maxTabs. A pool filled entirely with running turns is blocked earlier at account-pool.cjs:291–293; the reachable case includes retained ready tabs."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The direct automatic caller passes conversation key, connector identity, retained requirement, and routing key into the pool (control-server.cjs:285–293). A required retained turn is prechecked before capacity reclamation and cannot fall through to new-tab creation.",
    "The Manual-mode caller uses a separate synchronous path (control-server.cjs:194–201). BrowserHost rejects a same-trace tab owned by automatic interaction (browser-host.cjs:2043–2047); no separate finding is supported from that exception path.",
    "Reservations are installed before the asynchronous host readiness wait and removed in finally (account-pool.cjs:296–322). This manual review found no distinct, concrete reservation or affinity failure to add."
  ]
}


## Reviewer 3: Heisenberg

Agent 01a0a5b5-b99f-77e0-9ddc-e7633cc63f33

{
  "previous": [
    {
      "id": "P1-no-substantiated-defect",
      "status": "confirm",
      "evidence": "The different direct paths inspected here—preflight, activation, status, and uninstall—did not establish a new defect at the frozen commit. This is a bounded manual-review conclusion.",
      "file": "src/codex-integration.ts:277"
    },
    {
      "id": "P2-inactive-json-hook",
      "status": "confirm",
      "evidence": "readJournal reconciles an inactive journal only after the restored config matches. The hook guard requires the recorded entry and a unique hash match; an occupied or ambiguous slot raises an error. The write checks expected bytes and compensates on failure.",
      "file": "src/codex-integration-journal.ts:224"
    },
    {
      "id": "P3-uninstall-crash-recovery",
      "status": "uncertain",
      "evidence": "Uninstall rechecks for a reappeared hook before removing the recovery and primary journals. Deactivation writes the recovery copy before config, hooks, and primary. Those guards support the earlier claim, but process-crash timing and external edits in the final check-to-write gap were not reproduced.",
      "file": "src/codex-integration.ts:627"
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The direct uninstall caller reaches integration removal after its service teardown; the integration journal remains available if its hook or route guard throws. This review did not establish whether every service retry path recovers, and makes no broader claim about them.",
    "Manual source inspection only. No tests, builds, traffic, edits, or additional agents."
  ]
}

## Reviewer 4: Newton

Agent 01a0a5b5-ba1b-7d10-8b05-247aaabfc19c

{
  "previous": [
    {
      "id": "S4-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/setup.ts:752",
      "evidence": "The production CLI calls setup directly. Both save paths set savedConfigBytes before saveConfig. saveConfig can fail before atomic rename, leaving the original config intact; the catch nevertheless requires the planned bytes at lines 754–755, marks configRestored false, and skips tunnel compensation at line 787. This is a source-established failure path, not a reproduced filesystem failure."
    },
    {
      "id": "S4-02",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/setup.ts:880",
      "evidence": "The DEV CLI accepts a user-supplied Tunnel ID and calls setupDevProfile. configureTunnel writes the managed key and may install tunnel-client before createTunnelConfig validates the ID. setupDevProfile has no compensation around that call, bootstrapTunnelProfile, or saveConfig. The DEV CLI first selects an isolated home. Native profile effects after a failed external connect cannot be assumed to be exact owned writes."
    }
  ],
  "bugs": [
    {
      "id": "S4-03",
      "severity": "medium",
      "file": "/Users/alex/Dev/nekodex/src/setup.ts:588",
      "trigger": "Another writer changes the managed runtime key after production setup snapshots it but before installRuntimeKeyBytes replaces it.",
      "evidence": "Production setup snapshots the key at line 589, then configureTunnel writes it without checking those current bytes. installRuntimeKeyBytes performs the atomic replacement at tunnel.ts:272. A successful setup overwrites the intervening edit; on a later failure, lines 799–809 can restore the older snapshot because the current file matches setup's own write. The tunnel-client has an expected-before check, but the key does not.",
      "fix": "Check the current key against the pre-write snapshot immediately before replacing it; preserve an intervening edit and compensate only a verified owned key write.",
      "confidence": "high"
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "The production tunnel-client installer checks its expected pre-install bytes and mode, and its restore path rejects changes made after installation.",
    "Production setup preserves profile bytes that a failed external connect may have written without a checkpoint; their ownership is uncertain."
  ]
}


## Reviewer 5: Euler

Agent 01a0a5b5-ba99-7d62-9bd8-9c29fbd3f3ef

{
  "previous": [
    {
      "id": "R1-5-01",
      "status": "confirm",
      "file": "launcher/electron/runtime-supervisor.cjs:2121",
      "evidence": "stopForSetup waits for startPromise before bounded recovery settlement. Initial startup calls startTunnel without a cancellation signal at line 1341. The tunnel control command can wait for its timeout and termination path, and startup failure can then enter cleanup. shutdownRequested guards later starts but does not interrupt an already running command. This confirms the delay path; its duration was not measured."
    }
  ],
  "bugs": [
    {
      "id": "R2-5-01",
      "severity": "P2",
      "file": "launcher/electron/main.cjs:1380",
      "trigger": "Quit begins after startIfConfigured returns ready but while connectBridgeRoute is pending.",
      "evidence": "The detached startup chain awaits connectBridgeRoute after the supervisor's start promise has settled. requestQuit can therefore shut down the runtime concurrently. Neither the bridge-route call nor the subsequent ready-state update checks shutdownInProgress, quitting, or exitCommitted. A late completion can report setup complete after shutdown; route effects depend on RuntimeHost behavior outside these two files.",
      "fix": "Fence the detached startup continuation against Quit before connecting the route and before publishing ready state; coordinate any in-flight route connection with shutdown.",
      "confidence": "medium"
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "Recovery timer callbacks recheck stopping and shutdownRequested before creating a task.",
    "A failed Quit explicitly enables a guarded restart; a committed shutdown does not."
  ]
}



## Reviewer 6: Bohr

Agent 01a0a5b5-bb16-7ab1-bc6b-5f0649ddf5f3

{
  "previous": [
    {
      "id": "R1-6-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:925",
      "evidence": "The authorized /admin/cancel-turns handler calls clear() (server.ts:1036–1043). clear() preserves only sessions already in retainedReleases; it removes other attached sessions after beginRetirement(), which does not call releaseRetainedConversation. The Launcher release callback is installed for eligible retained turns at index.ts:432–445. A completed turn can therefore lose its registry owner before compaction or a model switch releases its ready Launcher tab. This remains a source-level finding; Launcher tab retention was not reproduced at runtime."
    }
  ],
  "bugs": [
    {
      "id": "R2-6-01",
      "severity": "medium",
      "file": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/turn-execution.ts:992",
      "trigger": "A completed retained session has been physically settled and unused for the 30-minute registry TTL; a later getOrCreate() or activeCount() invokes prune().",
      "evidence": "prune() exempts active, physically unsettled, recent, and already obligated sessions (lines 994–998), but deletes an older attached session and its conversation head (lines 999–1002) without recording a release obligation or calling the Launcher callback. Subsequent compaction cannot find the head, and a model switch cannot find the previous owner conversation. The Launcher release endpoint removes ready tabs by conversation key (retained-turn-release.cjs:1–14).",
      "fix": "Before pruning an attached retained session, establish a retryable release obligation and keep its owner addressable until Launcher acknowledges release.",
      "confidence": "high for the registry path; actual retained-tab persistence after 30 minutes was not observed"
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "The structured compaction guard routes local-tools non-Luna requests through retained-conversation retirement; its catch path also attempts release after a handoff failure.",
    "A failed explicit release obligation stays discoverable for the next owner turn and for compaction cleanup."
  ]
}


## Reviewer 7: Beauvoir

Agent 01a0a5b5-bb90-7113-b558-c705a165c1f0

{
  "previous": [
    {
      "id": "prior-no-reachable-defect",
      "status": "refute",
      "evidence": "A direct caller catches a failed environment-store write, but the store has already changed its in-memory authority. A later request in the same process can read that unpersisted entry.",
      "file": "src/adapters/chatgpt-web/thread-environment.ts:243"
    },
    {
      "id": "prior-store-load-and-delegation-fixes",
      "status": "confirm",
      "evidence": "load() validates entries into a temporary map before assigning it. Both root and child branches of normalizeNativeDelegation() pass envelope text through decodeDelegationXml().",
      "file": "src/adapters/chatgpt-web/thread-environment.ts:267"
    },
    {
      "id": "prior-causal-guards-and-runtime-limit",
      "status": "confirm",
      "evidence": "The fallback checks the latest native rollout, and delegation verifies the claimed delivery against a current-turn response item. Unusual transcript shapes and runtime behavior remain unverified by this read-only review.",
      "file": "src/adapters/chatgpt-web/codex-rollout-environment.ts:29"
    }
  ],
  "bugs": [
    {
      "id": "R2-7-01",
      "severity": "medium",
      "file:line": "src/adapters/chatgpt-web/thread-environment.ts:243",
      "trigger": "An atomicWriteFile failure while recording a trusted environment, followed by a same-thread request without a fresh environment envelope.",
      "evidence": "set() replaces the map entry before persist() can throw. The adapter catches the error at index.ts:861–869; a subsequent resolve() can return the new map entry although the file retains the old state. Restarting then yields different authority. This is reachable when the configured state path cannot be written; it does not depend on forged input.",
      "fix": "Stage the updated map and publish it only after the atomic write succeeds, or restore the prior map on write failure. Apply the same rule to TTL deletion.",
      "confidence": "high"
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "Manual source review only at 258d89c2a4274e66faf8d6d7ee437a7ce64b23c4. No tests, builds, traffic, edits, or agents."
  ]
}


## Reviewer 8: Wegener

Agent 01a0a5b5-bc09-70d2-83d5-b99c89027577

{
  "previous": [
    {
      "id": "R1-8-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/responses/parser.ts:254",
      "evidence": "schema.ts:5-13 and 31-35 accept a file_id-only input_image in tool output. Both output branches at parser.ts:567-588 use outputToToolResultContent, whose image branch requires image_url. No request guard rejects this shape; a sole file_id-only image becomes empty tool-result content. Actual client use of this shape remains unverified."
    }
  ],
  "bugs": [
    {
      "id": "R2-8-01",
      "severity": "P2",
      "file": "/Users/alex/Dev/nekodex/src/responses/parser.ts:535",
      "trigger": "A tool_search_output history item lacks call_id, including after a tool_search_call that has a usable id.",
      "evidence": "tool_search_output is absent from schema.ts:102-105's known-type set, so the loose unknown-item schema accepts it. The parser loads its tool specs and creates a tool result with toolCallId \"\" (parser.ts:539-556); prompt.ts:288-296 forwards that empty pairing ID. The parser also accepts a tool_search_call with neither call_id nor id (parser.ts:523-530). This is a reachable malformed-request path, though occurrence in native client history was not established.",
      "fix": "Validate recognized tool_search call/output shapes before projection and require a nonempty pairing ID; reject malformed history rather than emitting an unpaired result.",
      "confidence": "Medium"
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "The server catches parser failures as request errors before the Web turn (server.ts:480-494).",
    "The prompt retains image_url-backed tool-result images as attachments through messageEnvelope and inputContent (prompt.ts:196-212, 283-296).",
    "The Hermes producer limits its accepted history types and checks pending tool-result IDs independently (hermes-integration.ts:73-112)."
  ]
}



## Reviewer 9: Raman

Agent 01a0a5b5-bc84-73a3-902e-8977efd7864a

{
  "previous": [
    {
      "id": "N9-O1",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/responses/state.ts:188",
      "evidence": "The Web caller expands a known previous_response_id before parsing (server.ts:478), then records the expanded input plus output with force:true (server.ts:523–526; state.ts:224–227). Each chained turn copies and measures the accumulated items. The proposed linked representation would also need to preserve replay when older entries expire or are evicted, and when snapshots omit large entries. No latency gain was measured."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The native /responses and /responses/compact callers pass the already decoded body to forwarding (server.ts:467,761). A local cache hit removes previous_response_id and strips IDs from the restored prefix; a cache miss leaves the native continuation request intact.",
    "The prior claim that newly supplied IDs are always preserved needs qualification. If any input contains a bridge reasoning or compaction artifact, scrubBridgeArtifactsForNative removes IDs from the entire input (native-passthrough.ts:104–140). That matches the module’s stated policy for history crossing providers; this review found no concrete failure caused by it.",
    "The SSE reader bounds its line candidate and recognizes an exact data: [DONE] line, including a final line without a newline. Errors before that marker remain visible to the client. The direct guards examined here yielded no new finding."
  ]
}

## Reviewer 10: Ohm

Agent 01a0a5b5-bd01-72d3-bf12-3de4ba79b84d

{
  "previous": [
    {
      "id": "activity-limit",
      "status": "confirm",
      "evidence": "A completed activity ID is rejected on claim. A new claim at 64 active activities revokes the turn before adding the ID.",
      "file": "src/adapters/chatgpt-web/turn-broker.ts:1047"
    },
    {
      "id": "completion-fence",
      "status": "confirm",
      "evidence": "Begin and commit both require no active activities or pending invocations; commit also requires the captured activity revision. Subsequent claims and invokes reject the committed channel.",
      "file": "src/adapters/chatgpt-web/turn-broker.ts:443"
    },
    {
      "id": "mcp-cleanup-and-late-results",
      "status": "confirm",
      "evidence": "Claim failures attempt activity cleanup. Invocation transport failures attempt to release the shared binding; a successful release rejects pending broker invocations, so the failed MCP call cannot later receive a successful native result. This guarantee depends on release reaching the broker.",
      "file": "src/adapters/chatgpt-web/mcp-server.ts:465"
    },
    {
      "id": "no-substantiated-defect-or-efficiency-gain",
      "status": "confirm",
      "evidence": "The additional direct-path inspection produced no concrete new defect or measured efficiency opportunity. Runtime races and throughput were outside this manual-only review.",
      "file": "src/adapters/chatgpt-web/mcp-server.ts:923"
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "Manual mode completion checks active activities and pending invocations synchronously before marking the request completed; later ordinary claims fail its terminal-state guard (turn-broker.ts:547–576, 1027–1040).",
    "The browser owner rereads completion evidence between fence begin and commit; a changed activity revision makes commit fail and restarts that decision (browser-worker.ts:5167–5191).",
    "Late owner tool results require a still-pending, delivered call ID; revocation rejects and clears pending invocations (turn-broker.ts:428–440, 1203–1215).",
    "The special compaction-control call bypasses the ordinary activity claim but submits through its separate compaction transaction rather than queuing a native invocation (mcp-server.ts:902–923)."
  ]
}

## Reviewer 11: Gibbs

Agent 01a0a5b5-bd7e-7ba0-b2c6-deba15117120

{
  "previous": [
    {
      "id": "R1-11-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/browser-login.ts:459",
      "evidence": "The CLI directly calls loginToChatGpt at cli.ts:161, and setup calls it at setup.ts:564 for managed Chrome. If launchPersistentContext rejects before assigning context, cleanup at browser-login.ts:494–503 can remove profileDir based only on the original login process having exited. The passkey path explicitly guards an attempted launch without a context handle at lines 315 and 377–385. Whether Playwright leaves Chrome running after a rejected launch remains unobserved."
    },
    {
      "id": "R1-11-02",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/src/browser-login.ts:481",
      "evidence": "A forced repeat login reaches the direct setup caller at setup.ts:549–564. State is atomically replaced before its marker is written, with no prior marker invalidation. If marker writing fails, setup reports failure, but browserLoginStateExists can still accept the old marker at lines 516–525; worker startup checks only that both files exist at browser-worker.ts:2376–2386. The new state was inspected before writing, so actual authentication failure is not established; the concrete defect is stale verification metadata surviving an incomplete persistence step."
    }
  ],
  "bugs": [
    {
      "id": "R2-11-01",
      "severity": "medium",
      "file": "/Users/alex/Dev/nekodex/src/adapters/chatgpt-web/browser-worker.ts:2386",
      "trigger": "Managed Chrome launches successfully, then browser.newContext rejects while loading the saved storage state.",
      "evidence": "ensureManagedBrowser assigns this.browser only after newContext succeeds at lines 2386–2388. Its catch clears the cached opening promise but does not close the local browser. Worker close() at lines 2275–2291 can close only this.browser, so the launched process has no retained handle. The separate ensurePage path has the same ordering at lines 2364–2369.",
      "fix": "Close the locally launched browser in a finally/catch when context or page creation fails; assign an owned handle only with a corresponding failure cleanup path.",
      "confidence": "high for the exception-path leak; no storage-load failure was reproduced"
    }
  ],
  "optimizations": [],
  "cleanAreas": [
    "The launcher-host branch of ensurePage does not read managed-Chrome storage files.",
    "After a completed managed-Chrome answer, failure to save storage state is caught and logged as a warning at browser-worker.ts:5264–5276; the answer remains eligible to return."
  ]
}


## Reviewer 12: Darwin

Agent 01a0a5b5-bdfd-70c2-8c3b-a8d30798febc

{
  "previous": [
    {
      "id": "R12-OPT-01",
      "status": "confirm",
      "evidence": "App refreshes the full snapshot after every completed operation but applies only state, MCP credential status, and context capabilities. The completed mcp-verification path also calls updateSnapshot directly, creating a redundant request. Setup completion can require a refresh, so filtering must preserve operations that change these fields. Request size and frequency remain unmeasured.",
      "file": "/Users/alex/Dev/nekodex/launcher/src/App.tsx:69"
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The Settings mode-switch caller asks the main-process guard whether the target mode already has saved credentials. It opens the MCP configuration surface only when credentials are required; the apparent inactive-mode credential gap is therefore not a reachable saved-credential failure through this caller.",
    "MCP setup and verification catch both IPC and snapshot-refresh failures and surface the error. A successful setup updates credential status explicitly; subsequent parent updates propagate to the MCP surface while credentials are not being replaced.",
    "During initialization, state, browser, operation, update, and log events are retained until the initial snapshot resolves. A pending completed operation triggers a metadata refresh afterward."
  ]
}

Manual source inspection only at `258d89c2a4274e66faf8d6d7ee437a7ce64b23c4`. No tests, builds, or runtime reproduction; no new substantiated finding.



## Reviewer 13: Tesla

Agent 01a0a5b5-be79-73a3-9113-5428af6c0b02

{
  "previous": [
    {
      "id": "R1-13-01",
      "status": "confirm",
      "file": "/Users/alex/Dev/nekodex/launcher/electron/account-pool.cjs:122",
      "evidence": "The direct launcher:account-add handler calls addAccount. registry.add saves the new account and selects it before selectedHost().ready(). BrowserHost.ready awaits initializationReady, which can reject after browser initialization fails. The catch selects the previous account but does not remove the new one. AccountSettings reports the rejection and does not refresh on action failure, so the saved account may also remain absent from the current UI until another refresh."
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "AccountSettings invalidates an in-flight accounts() response when a newer browser or operation event arrives, then schedules a replacement request. Events waiting behind the 150 ms timer are coalesced before that request starts.",
    "The direct account-select path prepares the requested host before saving selection; its current-operation guard blocks switching during a host operation.",
    "The snapshot reads authentication and active-turn state from each existing host and derives checked and connectorReady from the pool maps. publish clears those maps when a host reports authenticated false. This is a source-contract assessment; no runtime behavior was exercised."
  ]
}


## Reviewer 14: Noether

Agent 01a0a5b5-bef7-7701-8cc1-e1714e60b229

{
  "previous": [
    {
      "id": "R1-14-B1",
      "status": "confirm",
      "evidence": "Both installers resolve only the first published release when no version is specified (scripts/install-launcher.ps1:35–41; scripts/install-launcher.sh:35–40), then request an asset for the local platform. The release policy permits macOS-only prereleases (docs/release-signing.md:212–217). Thus a newer macOS-only release makes the default Windows or Linux installation fail even when a suitable older release exists.",
      "file": "scripts/install-launcher.ps1:37"
    },
    {
      "id": "R1-14-O1",
      "status": "confirm",
      "evidence": "main.cjs:1242 calls checkOnce at startup. checkOnce sets checked before fetching and rejects every later call, including after a fetch error (update.cjs:397–400, 441–445). The inspected IPC registers update installation but no refresh action (main.cjs:971–979). This remains an availability optimization, not a demonstrated contract defect.",
      "file": "launcher/electron/update.cjs:397"
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "The packaged repository and trust policy both name Froraut/NEKODEX (launcher/package.json:7; launcher/release-trust.json:3). The documented older .1 binary remains pinned to its prior repository and requires manual transition.",
    "The in-app installer verifies the signed release identity, selected asset size and hash against the checksum before extracting or staging (update.cjs:456–510; release-trust.cjs:58–99). The first-install scripts have a separately documented bootstrap trust boundary; their checksum checks alone were not treated as equivalent to the in-app signature."
  ]
}

## Reviewer 15: Ramanujan

Agent 01a0a5b5-bf71-7850-abfd-d1bf6845926c

{
  "previous": [
    {
      "id": "prior-ci-selection",
      "status": "refute",
      "evidence": "The five-case limit and manual-review messages are present, but the push caller can omit the old path of a detected rename. That allows a mapped source file renamed into a metadata path to receive no behavior case or manual-behavior warning.",
      "file": "scripts/focused-pr-check.ts:78"
    },
    {
      "id": "prior-release-digests",
      "status": "confirm",
      "evidence": "Packaging verifies staged output before copying it. The workflow collects assets before checksumming; signing hashes those collected files; publication verifies local assets and compares each draft asset with the digest reported by GitHub. This confirms the guards in source, conditional on the remote API reporting digests accurately.",
      "file": "scripts/publish-release.cjs:19"
    },
    {
      "id": "prior-limits",
      "status": "confirm",
      "evidence": "This round used manual source inspection at the frozen commit. No tests, builds, release runs, or live digest checks were performed.",
      "file": ".github/workflows/release.yml:232"
    }
  ],
  "bugs": [
    {
      "id": "push-rename-loses-mapped-source",
      "severity": "medium",
      "file": "scripts/focused-pr-check.ts:78",
      "trigger": "On a push where Git detects a rename from a mapped backend or capacity file into a docs/*.md path, git diff --name-only reports the destination path.",
      "evidence": "The push caller retains only reported names. The destination passes metadata(), so mode becomes metadata and no behavior case or manual-behavior path is reported. The PR caller separately includes previous_filename for renames at lines 57–62.",
      "fix": "Include both sides of push renames when classifying scope; for example, compare with rename detection disabled so deleted and added paths are both reported.",
      "confidence": "medium"
    }
  ],
  "optimizations": [],
  "cleanAreas": []
}


## Reviewer 16: Kuhn

Agent 01a0a5b5-bfea-73b2-b839-ba306817b1b2

{
  "previous": [
    {
      "id": "prior-clean-scope",
      "status": "confirm",
      "evidence": "The inspected alternate paths did not establish a new directly reachable defect. Structured compaction serializes work by ownerKey, waits for recorded physical settlements, and gates retained-conversation retirement. Retry failures use a native-turn budget; the bridge receives adapter heartbeats while compaction is pending. This is a source-only conclusion.",
      "file": "src/adapters/chatgpt-web/compaction-handoff.ts:467"
    },
    {
      "id": "cancellation-versus-cached-summary",
      "status": "confirm",
      "evidence": "The interrupt endpoint records the native-turn interruption in HttpTurnCounter and aborts matching HTTP observers. Later requests that bind the same identity are aborted at that boundary, even though existingStructuredCompactionRun can return a cached promise before its own interruption check.",
      "file": "src/server.ts:174"
    }
  ],
  "bugs": [],
  "optimizations": [],
  "cleanAreas": [
    "Reviewed the structured compaction caller’s fallback, timeout and retirement exception paths, including its observer-disconnect branch.",
    "Reviewed the interrupt endpoint and HTTP identity guard, retry-budget caller and key, bridge stall handling, continuation acceptance, and helper abort acknowledgement. No runtime race was reproduced; findings are limited to manual inspection of 258d89c2a4274e66faf8d6d7ee437a7ce64b23c4."
  ]
}
