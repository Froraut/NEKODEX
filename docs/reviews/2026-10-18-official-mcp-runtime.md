# Official filesystem MCP: actual enabled runtime and approved tools

Observed 18 October 2026, 20:23:29–20:23:32 UTC. This is a separate persistent
task-owned development proof, not the installed application/core/Native account
profile. The base source is `63ab32f`; the receipt additionally pins the exact
strict schema-validator, MCP host and Native protocol source hashes used here.
Publication/CI of that correction belongs to the root delivery ledger.

The earlier installer receipt used a temporary home and explicitly removed its
trees. It was historical installation evidence, not a reusable current runtime.
This proof performed one new official prepare, complete graph review and frozen
install, without lifecycle scripts, using pinned Bun1.4.0 build34cbb9a40 SHA256
`539598c775882420b9d8deb7dc14d845f20f7d26f5600c50ab067dde6ac3f3bf`.

The fresh104-row graph, lock and installed4691-entry tree exactly match the
historical reviewed pins:

| Artifact | SHA256 |
| --- | --- |
| Full graph | `a45f4b2c643fe49640139df7c4248cc3bf52f708cca55fc5d6de5c12b556dc8c` |
| Bun lock | `d64c2f8a69294ec74bab2d668798afa09af81552ea8cacc40f3bf55481b2fc5b` |
| Installed dependency tree | `4905b698868fd4db935db930a0721b1d0ffe3d0a3babaab53b2bbf4b3929b860` |
| Official filesystem1.0.0 entry | `68e6aae96c907bf00089dd48b9f2fdd06113e6588d9915f19852cb468f9296d8` |

The private profile is
`/Users/alex/.codex-chatgpt-web-native-dev/official-mcp-runtime-proof/profile`.
Its sole allowed data root is the sibling `data/`; code and authority metadata
are not writable data grants. The installed action is
`official-runtime-91b4b9b6-23b8-461a-88a9-45ab5c0f4aeb`, server
`npm-filesystem-faf3059e4ab5`. Its complete runtime path and exact executable,
entry, configuration, package graph/tree and sandbox roots are in the receipt.

The first actual connection exposed a real compatibility gap: all14 official
tools advertised JSON Schema2020-12 and the default draft07 Ajv rejected them.
The source correction selects strict local Ajv2020 only for its canonical dialect,
keeps default/explicit draft07 behavior and formats, and refuses unknown dialects
or unresolved external references. Async schemas are also refused because these
owners validate arguments synchronously. It neither strips `$schema` nor disables
strict validation. The same pure compiler serves MCP/builtin schemas and Native
declared-tool argument validation. Focused evidence: strict/default/formats/refusals1/30;
actual installed official server14 advertised schemas through SDK in-memory
discovery and both validators1/59. No tool was invoked in that schema check.

The original pre-effect failure and a later one-off runner action-ID conflict are
retained as attempt1/attempt2 receipts. Both had zero tool intents and no target
file; cleanup stopped their owners before continuation. The runner now gives
each new task unique durable action IDs. It reused the committed installation,
disabled recipe and exact pins without reinstalling or replaying either task.

The successful connected flow used the real official SDK stdio server in the
existing custom macOS Seatbelt boundary, PID54856:

- All14 discovered tools were supported; the model bridge was explicitly fake.
- A manual Agent task requested the actual discovered `write_file`; before
  approval no file or tool outcome existed, and a false explicit-action flag
  was refused.
- Exact approval used the existing ToolJournal and wrote the requested file.
  Duplicate approval returned the same canonical receipt. A separately approved
  official `read_file` returned the same content to the continuation.
- Independent filesystem observation confirmed50 exact bytes at
  `data/proof.txt`, SHA256
  `6f0203307af9cc523982a8d6239a05d67c5f3ce95dde36c03373e156f306730a`.
- There were three fake model offers, two canonical tool outcomes and exactly
  two ToolJournal rows. The final task remained `review_required` with no
  self-certified outcome evidence.
- Final server and global host flags are disabled, connectedfalse/PIDnull,
  activeCount0 and installerActiveCount0. Exact PID54856 was independently
  confirmed absent. The installed runtime, journals, effect and receipts remain;
  only its owned `.installer-cache`/`.installer-home` intermediates were removed.

Sanitized result and the one-off runner are retained at workspace
`reviews/evidence/full-adoption/official-mcp-runtime-20261018.json` and `.ts`;
immutable failed observations are `-attempt1.json` and `-attempt2.json`.
The profile also retains `runtime-proof.json`, `prepared-graph.json` and
`approved-graph.json`. The runtime stays disabled for later explicitly selected
real-model acceptance.

This establishes actual official-tool connection, approval, execution, file bytes
and stopped-process cleanup. It does not establish real-account model delivery,
OAuth/secret-backed MCP, application/business acceptance, general post-parent
descendant cleanup, installed-app replacement or a complete P15/macOS program.
