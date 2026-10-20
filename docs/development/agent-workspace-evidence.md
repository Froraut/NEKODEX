# Selected workspace file outcome evidence

This observer proves one explicitly selected file property for one current task requirement. A human maps the file/property to the requirement; a matching file hash or file's existence does not automatically establish every business meaning of that requirement. It does not run a model, execute a tool, approve a mutation, attach a workspace to a prompt, or grant model filesystem access.

## Authority and capture

The renderer supplies only a picker-owned workspace ID, workspace-relative file path, requirement ID, selected property, optional expected SHA-256, and its stable action ID. Main fetches the actual current task through the existing administrative owner, checks the captured UI scope, and passes that actual task to `createAgentWorkspaceEvidenceAuthority({keyPath, resolveWorkspace}).observe(...)`. `resolveWorkspace` is the current validated picker registry owner, not an incoming root path.

The selected property is exactly one of:

- `file-exists`: the selected safe regular file must currently exist.
- `file-absent`: the selected file must currently be absent, with an existing safe parent directory. Absence is never inferred from capture failure, unreadable parents, links, or permission errors.
- `file-sha256`: the selected safe regular file's actual SHA-256 must equal the explicitly entered expected lowercase digest.

Capture uses the shared `workspace-file-capture.cjs` leaf. It refuses escaping/reserved paths, symlinks, hard links, changed ancestry, nonregular files and files larger than 256 KiB. Each observation selects one file. Binary and text files are hashed as actual bytes; no raw file content is returned in the signed proof, evidence, reference or journal.

The HMAC reuses the existing private `agent-workspace/grant-key`, with the separate `nekodex:workspace-file-observation:v1` namespace. The signed proof binds task ID, task family, generation, task revision, requirement, workspace identity, canonical root ancestry, relative path, desired property, expected digest, actual file revision/digest/size/existence and observation time. Snapshot-only grants cannot substitute for file-property proofs, or vice versa.

Main retains bounded signed metadata at `<keyPath>.evidence.json`: at most 256 capture attempts and 4 MiB. It writes a preparing record before workspace capture and preserves failed attempts. An unchanged retry of a successful observation returns the same proof only if the current selected file still matches. A failed/preparing attempt or a drifted file is never recaptured under the same action ID; the user must explicitly start a new observation. No history is automatically purged.

## Bun owner and verification

`createAgentWorkspaceEvidence({storagePath, keyPath})` owns the private SQLite evidence journal. It accepts only a main-signed admitted proof, verifies its current task scope, rechecks root ancestry and recaptures the actual selected file. It derives `passed` or `failed` from the real file property; a caller cannot submit an asserted outcome.

The owner exposes:

```ts
observe(task, proof): { reference, evidence }
resolve(task, reference): OutcomeEvidence
assertCurrent(task, evidence): void
listTask(taskId)
close()
```

References use `sourceEventId: workspace-file:<observationId>`, a stable `workspace:<workspaceId>/<relativePath>` subject, the actual captured file revision (or an ancestry-bound absence marker), and the exact desired property. `file-sha256:<expectedDigest>` keeps different desired hashes distinct. Public metadata includes observation time, actual digest and existence, without file contents or a root path. The observer ID is `workspace-file-observer-v1`.

The SQLite owner preserves at most 1,024 observation attempts and 8 MiB of logical proof/projection metadata, with a separate SQLite physical page bound. A new valid signed proof gets a durable preparing entry before Bun's recapture; failed captures remain failed. Invalid signatures and cross-scope proofs are refused before journal admission. Only one writer owns a journal in this process, and SQLite enforces its cross-process write lock.

Before final verification, the Agent owner must synchronously call `assertCurrent` for each active selected workspace-file fact immediately before committing completion. It must not reuse a prior positive file fact after the file, root ancestry, task revision or generation changes. A new explicit observation can supersede only active facts with the exact same task revision, requirement, stable subject, desired property and observer. Immutable old observations remain in history; unrelated failed/unknown properties cannot be hidden by a newer file fact. The superseded IDs are captured in the first trusted Bun projection and remain stable on a retry.

A final check establishes the selected property's observed state at that verification boundary. Subsequent external file changes require a fresh observation for a subsequent verification.

## Composition

Main signs using its actual task and sends the resulting signed value as `proof` through the existing administrative `workspace-evidence` action. Bun resolves that proof through this owner and calls the existing task owner's `recordObservedEvidence`. The runtime's synchronous before-verify hook rechecks only the active selected facts. No model text, prompt envelope, ordinary read token or incoming absolute path can create this authority.
