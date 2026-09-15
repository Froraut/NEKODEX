# NEKODEX generation 4 connector migration

Baseline: `d880b12664fa4103bf59daf9977ebaf7bcc31aad`. Date: 2026-09-15.
The user authorized sixteen Sol agents to research and implement the previously deferred #487 migration, then explicitly required one synchronized generation number for both modes.

## Result

| Mode | New public identity | Immediately retired identity |
| --- | --- | --- |
| Automatic Full | Codex Native4 | Codex Native3 |
| Repository DEV Automatic | Codex Native4 DEV | Codex Native3 DEV |
| Manual | Codex Zero Risk4 | Codex Zero Risk2 |

Zero Risk3 was an intermediate local proposal, never a published contract here. It is recognized defensively as an old alias. Older Native/Native2/Zero Risk aliases remain supported as migration inputs. Automatic custom names remain unchanged; users with a custom cached connector must choose a distinct new App ID/name for the new schema rather than assume its cache refreshes.

Sixteen `gpt-5.6-sol` medium agents completed disjoint implementation/research lanes; parent integrated config identity maps, account readiness, DEV state, remaining live strings, exact-schema ambiguity rejection and final ABI hashes. All sixteen were closed. Elapsed time from dispatch through integration and focused checks was approximately 9m41s, including the user's generation-number change; this is wall-clock coordination time, not summed model compute or a controlled comparison. Individual source/research reports are `2026-09-15-connector-migration-01.md` through `-16.md` in this directory. They record lane handoffs; final pin values and integration outcomes below supersede their interim pending instructions.

## Implemented behavior

- `codex_exec` exposes optional `sandbox_permissions`, `justification`, and `prefix_rule` in both public contracts. Supplied arguments are forwarded unchanged only if the exact selected structured native command schema declares support for their shape/value. Omitted arguments stay omitted. Unsupported/ambiguous schemas and a gateway without exact schema evidence fail explicitly.
- Native `exec_command` and legacy `shell_command` retain their respective command/timing mappings. Unsupported shell TTY/output options are rejected explicitly. The generic exact-tool route remains available. Public mutating annotations, sandbox policy and native approval authority are unchanged; the bridge does not approve a command itself.
- Runtime config rejects known retired identities. Setup maps persisted active and inactive identity fields to generation 4 while preserving separate Automatic/Manual tunnel objects, credentials, account registry, cookies and conversation affinity.
- Setup detects an old persisted active name even after loading its migrated in-memory copy. The active tunnel profile is refreshed within existing rollback boundaries; inactive old names alone do not force that tunnel's refresh.
- Launcher detects migration even when the application version is unchanged, including Browser-only saved configs. Legacy connector verification cannot become a successful new-identity claim. Saved MCP/catalog readiness and relevant smoke evidence are invalidated; DEV legacy state requires setup before starting the old runtime.
- Per-account readiness compares the exact verified name to the current target. Old leases keep their identity and are not relabeled. A retained request that requires the old connector fails explicitly rather than being reassigned across accounts.
- Helper verification and browser-menu selection reject the old mode-specific identity with migration guidance. A new connector means a new ChatGPT plugin App ID, not renaming or refreshing the old entry.
- CLI, renderer copy in English/Chinese/Japanese, setup errors, Manual turn cards, current docs and current test fixtures use generation 4. Explicit historical/legacy evidence retains old names. DEV named-chat validation now recognizes the Manual target when Manual was explicitly configured.

## Public contract pins

Captured once from the actual source MCP stdio servers using the repository SDK client. Each listed tool was normalized to name/title/description/inputSchema/outputSchema/annotations, canonicalized with sorted object keys, then SHA-256 hashed:

| Contract | Tools | Complete tools/list SHA-256 |
| --- | ---: | --- |
| Native4 (also Native4 DEV) | 7 | `ce27b6bc87879360e67d534121f83aca3b6a131be2eb40ae978e1fd5600f22da` |
| Zero Risk4 | 9 | `d06f09a5bb8805ac445e0d23a3fe912cfd5bb1103fa6f2de36ff544fc1f7ab25` |

The fixture pins were updated from this capture after the schema implementation was stable. Same generation does not mean identical schemas: Manual intentionally has its start/completion lifecycle actions.

## Focused verification

Five bounded checks (six scenarios) completed successfully:

1. Native stdio tools/list exposes all three new optional fields and yields the Native4 hash above.
2. Manual stdio tools/list exposes the same optional fields and yields the Zero Risk4 hash above.
3. The exact named broker test forwards supported approval arguments unchanged and rejects an unsupported native schema before dispatch (two scenarios). Its command and result are synthetic; no native command is executed.
4. The exact named Manual config migration case maps Zero Risk2/Native3 DEV to generation 4 while preserving both tunnel objects.
5. The exact named launcher upgrade case initiates migration when the saved connector is old but releaseVersion is unchanged.

Backend and launcher `tsc --noEmit` passed. Six changed Electron modules passed `node --check`. Test/schema/type/syntax commands took about five seconds combined, within the shared 60-second limit. No full suite, broad benchmark, paid model turn or dependency installation ran. Temporary MCP transports/servers were closed, and their task-owned temporary directory removed. No production instance was stopped or replaced.

## Delivery boundary

The source and launcher remain at unreleased `5.2.0-nekodex.2`; live GitHub release listing still showed only `.1` during this task. Historical `.1` assets and their Native3/ZeroRisk2 contracts remain untouched. No new DMG, signing/notarization, installed-app replacement or ChatGPT account-side connector creation was performed.

The implementation and local protocol checks do not prove that ChatGPT has loaded the new schema, a live Codex approval has succeeded, or a real account's long-running/retained tasks survive transition. The documented account transition is: install the new build when released, reconnect the intended mode, create the matching generation-4 connector against its tunnel, then verify a real task. Preserve the former app/config and old connectors for rollback. See [the migration guide](../connector-identity-migration.md).
