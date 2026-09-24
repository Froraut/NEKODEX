**Browser admission queue**

The launcher owns admission for automatic Web tasks. The configured browser ceiling still limits live task tabs. Up to 64 additional execution owners can wait without a tab or a provider submission; the daemon and helper outstanding-owner bounds include that waiting capacity. Existing replay-byte limits remain in force.

`POST /v1/turn/start` with the current progress contract returns 202 while queued. The helper polls the same canonical execution, scheduling requirements and owner; a 202 is not a failed browser attempt. Each queued record contains only scheduling metadata, never a prompt, response, cookie, key or tool payload. Selected mode captures the selected account when enqueued. Existing conversation affinity remains authoritative.

A dispatch rechecks runtime admission, physical capacity, account identity/capabilities, connector and local pacing. Pause affects new admission, not accepted work. The durable account binding is committed at the first sending progress boundary; before then a tentative owner prevents competing account assignment. Exact pre-send cancellation returns the new-session reservation and, if no newer safety mutation superseded it, the pacing clocks. It never undoes a subsequent provider cooldown.

After acquiring a tab, the launcher exposes the lease as cancellable until the helper acknowledges it with `/v1/turn/start-ack`. Only then may the helper execute the browser turn. Repeated acknowledgement is idempotent. A start receipt cannot replay a removed surface or survive turn completion as a usable lease. Cancellation tombstones prevent a late start or poll from recreating a task after the user has cancelled and dismissed its queue record.

Aborting the producer before handoff calls `/v1/turn/start-cancel` and waits for the exact unsent cleanup. If cleanup cannot be confirmed, the client reports that boundary rather than claiming a clean cancellation. A cancellation after sending belongs to the ordinary task-control path and does not promise to undo provider work.

On restart, waiting metadata returns paused and disconnected. It cannot launch work by itself: the original execution must reconnect and the user must resume it. An admitted/running receipt from the old process becomes interrupted; it is never replayed as an active lease. Task history preserves the separate submission evidence. An earlier uncertain or accepted submission blocks a new queued attempt until the outcome is reviewed; history dismissal is not an automatic resend action.

The Task Center exposes queue position, owner reconnect needs, local retry time, global/per-account pause, move-to-front, cancellation and explicit resume. It distinguishes cancelling from cancelled. The live queue owner and backend state remain authoritative over stale renderer controls.

Focused evidence is tracked in `docs/reviews/chrome-implementation-progress.md`. Logic/HTTP checks use disposable local state and no provider submissions. An actual queued provider task and live account flows remain separate acceptance evidence.
