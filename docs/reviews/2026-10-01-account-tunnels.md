# Account-owned tunnel support

The desktop account router previously used one tunnel per interaction mode. An account with a different Platform organization could be signed in and model-ready while having no access to that shared tunnel. The requested behavior is one account's own tunnel, with no borrowing or cross-account failover for a continuing task.

`accountTunnelMode` and `accountTunnels` add bindings by captured local account ID and Automatic/Manual mode. Cloud IDs, aliases, profiles and private key files are distinct. Existing global fields remain a compatibility projection; the desktop never assigns an unknown legacy tunnel to an account. Native forwarding remains separate. Inactive-mode credentials stay stored without starting that mode's transport.

The binding store prepares an immutable private key and exact config-generation snapshot before the affected peer stops, commits only when bytes and the generation link still match, and preserves newer edits. Newer sign-in fingerprints invalidate old-account readiness. Committed-but-not-ready changes return a saved receipt and retire old connector proof. Key bytes and filesystem paths do not enter account views. Removed bindings retain their old files for recovery.

Each active binding has an independent supervisor/ownership record. A scoped alias/status observation supplies the exact tunnel ID and PID; unknown identity fails closed. Updating Beta does not restart a healthy Alpha. Normal shutdown drains active work before stopping peers; an idle refusal preserves them. First production Browser-only to Full activation waits for the owned core to become idle, then restarts it to initialize the broker; later Full edits affect only the target peer.

The browser lease carries its tunnel before prompt preparation. The helper's prepared handshake delivers it to the outer runtime before the broker token is compiled. MCP endpoints capture `--tunnel-id` at startup. Native, async and Manual operations reject missing/wrong endpoints for scoped tokens. Manual pending scope uses a named option consistently for local and remote owners; public Native6/Zero Risk schemas and sandbox/approval grants are unchanged.

## Focused evidence

- Private store: distinct keys/profiles, no shared fallback, sign-in mismatch, generation symlink preservation, newer-writer refusal and removal of only the selected binding.
- First startup: prepare the private account profile directory before SDK inventory uses it as its working directory. A real child-process fixture reaches that inventory boundary from an absent directory; it checks private mode and complete child settlement.
- Monitoring: an account peer supervises transport only, so healthy SDK observations keep it ready without a per-peer broker. The production parent retains its own broker/admission requirement. The focused monitor case checks both outcomes.
- Native6 setup preflight: the shared picker waits for exact row confirmation and can retry only an explicit requested row after a missed pointer activation. A delayed-selection fixture observes the original family before commitment; a missed-selection fixture proves two attempts at the same row, with no fallback and the draft preserved.
- Stopped proof: a real SDK 0.0.12 observation after owner-managed shutdown returned exit 0, `process_running:false`, `runtime_state:stopped` and `error:""`. The pure status owner accepts only canonical no-error values and still rejects live, uncertain, malformed or unsuccessful observations. DEV setup checks every prior active-mode alias before writing; an empty set requires the retained projection to prove stopped.
- Runtime transition: reached idle refusal preserves config and pending key; first Full enable initializes core; later edits preserve Native; post-commit failure produces an explicit recovery receipt.
- Admission: busy-account refusal; changing an idle account keeps another account's running task and proof.
- Peer supervision: isolated failure, unchanged-owner start count, changed-peer stop before config write, inactive-mode handling, scoped SDK command, PID mismatch refusal, drain refusal and shutdown compensation.
- Broker/helper: scoped own tool result; wrong/missing endpoint rejection; immutable and retired scopes; local/remote Manual pending scope; scope handshake before preparation; legacy and no-tools compatibility.
- Server: validated distinct ownership and aggregate readiness; no ready tunnel blocks Web tools while Native admission remains available.
- Renderer: through Computer Use in the credential-free preview, saving the first account changed only its tunnel, left other accounts unconfigured and kept connector verification separate. Keys were synthetic and cleared on submission. This is UI-flow evidence, not a real OpenAI tunnel.
- Runtime/launcher typechecks, renderer/helper/CLI development builds, version and architecture checks passed. No full suite or installable release publication was used.

Source is prepared as 6.1.17-nekodex.1. Installed NEKODEX/runtime remains 6.1.15-nekodex.1. Real account tunnel provisioning requires each account's own Platform tunnel and Tunnels Read + Use credentials; cloud attachment and provider child/tool execution are separate acceptance steps. The prior Prim2 session and API login are preserved.
