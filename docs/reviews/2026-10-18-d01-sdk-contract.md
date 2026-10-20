# D01: pinned tunnel-client credential contract

The SDK supports the required encrypted-storage launch adapter without a
plaintext credential file: save an `env:` selector in the native profile and
resolve the OS-backed credential into the environment of each new tunnel launch.
Managed `runtimes connect` explicitly forwards that selected variable to its
detached child. A fresh headless service start must resolve the vault again;
the SDK does not retrieve a key from an OS vault itself.

The investigation combines pinned-source review with the focused offline SDK
fixture recorded below. It does not establish platform keyring access or a live
tunnel/account result. No real credential, installed profile, service, OS vault
or provider API was accessed. The installed SDK binary was executed only against
synthetic loopback endpoints and isolated fixture state; no SDK source or suite
was executed.

## Provenance

NEKODEX `e7bec90f8f727815de83c110822919adc20f3edd`
[`src/tunnel.ts`](../../src/tunnel.ts#L18) pins version `0.0.16` and constructs
downloads under `https://github.com/openai/tunnel-client/releases/download/v0.0.16`.
The official repository identified by that source was cloned into the isolated
scratch checkout `/tmp/nekodex-tunnel-sdk-0016-20261018`, selecting tag `v0.0.16`.
The annotated tag object is `957db90fb996d17f522f94f7e3237914b1fc4f74`; its peeled
commit is `5f99daabd4aa4a77049e6d81d54a0d8c18335397`. The
[official release page](https://github.com/openai/tunnel-client/releases/tag/v0.0.16)
also identifies commit `5f99daa`. All SDK source links below use the full peeled
commit, not moving `master`. This verifies source identity; it is not an artifact
signature or checksum verification of an installed binary.

## Exact SDK behavior

| Question | Answer and source |
| --- | --- |
| What does managed connect accept? | [`cmd/client/runtimes_command.go:111–151`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/cmd/client/runtimes_command.go#L111) passes `--runtime-api-key` into `ConnectOptions.RuntimeAPIKey`. [`pkg/codexplugin/manager.go:365–367`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/manager.go#L365) defaults it to `env:CONTROL_PLANE_API_KEY` and validates a secret reference. [`state/state.go:332–336`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/state/state.go#L332) accepts `env:` or `file:` prefixes and rejects inline values. NEKODEX should supply its own fixed valid environment variable name. |
| Does the profile contain plaintext? | The connect manager passes the original selector to profile writing at [`manager.go:410–421`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/manager.go#L410). [`session/session.go:283–354`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/session/session.go#L283) writes the selector directly as `control_plane.api_key`, together with tunnel identity, MCP target, health/log configuration. It marshals JSON-compatible YAML and does not resolve the secret before serialization. With `env:NEKODEX_TUNNEL_RUNTIME_KEY`, only that reference is stored. |
| Is the selected environment forwarded to the detached runtime? | Yes. [`manager.go:453–461`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/manager.go#L453) calls `runtimeLaunchEnvOverrides`. [`manager.go:1331–1363`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/manager.go#L1331) resolves the `env:` variable and returns its value as a launch override. [`session.go:574–579`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/session/session.go#L574) forwards it to the starter. [`session.go:1258–1264`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/session/session.go#L1258) re-executes the current SDK executable with `run`, sets `cmd.Env`, and starts it detached. |
| Is this a wrapper executable substitution? | No. [`session.go:1238–1258`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/session/session.go#L1238) resolves `os.Executable()` and constructs a fixed SDK run invocation. Keep the official SDK binary; add credential resolution at NEKODEX's launch boundary instead of passing a replacement binary as the compatibility override. |
| What does direct run do? | [`cmd/client/run_command.go:123–163`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/cmd/client/run_command.go#L123) loads config then creates/runs the application. [`runtimeconfig/file_config.go:328–334`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/runtimeconfig/file_config.go#L328) resolves profile `api_key` into the effective environment. [`runtimeconfig/config.go:1060–1113`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/runtimeconfig/config.go#L1060) supports explicit `env:` / `file:` references and default `CONTROL_PLANE_API_KEY`, then `OPENAI_API_KEY`. Lines 1258–1286 validate and retain the resolved string in `ControlPlaneConfig`. No vault selector exists in this resolution path. |
| Can the raw file be deleted immediately after connect? | A `file:` selector persists in the profile and is read on future config loading. Deleting it breaks a later start. Migration must first save the `env:` selector and verify the new exact process; then legacy file retirement can follow the existing config/profile/process receipts. The source supports avoiding a temporary plaintext file entirely. |
| Does connect apply a changed key to an existing live process? | Not necessarily. [`manager.go:408–409`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/manager.go#L408) requests replacement only for a changed tunnel ID. [`session.go:539–570`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/session/session.go#L539) can reuse a matching existing live process. Updating the stored selector or injecting a new value into a new connect command does not alter that old process's memory/environment. Retain NEKODEX's exact affected-peer stop/restart for rotation and migrated startup proof. |
| Is a resolved secret written into alias/process state? | [`state/state.go:41–78`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/state/state.go#L41) lists alias/process fields; they contain profile/target/process identity rather than an environment snapshot. [`manager.go:1021–1052`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/manager.go#L1021) constructs that process record without a resolved key. This finding concerns these write paths, not every possible diagnostic export. |
| What survives parent exit? | The spawned runtime receives its own environment at process start. [`session.go:1415–1437`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/session/session.go#L1415) merges the parent environment and explicit overrides. [`process_unix.go:29–30`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/session/process_unix.go#L29) establishes a new session on Unix. The same key is available while that process lives; a new process after exit/reboot needs fresh injection. The Windows detached hook is empty in [`process_windows.go:57`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/session/process_windows.go#L57); this review does not infer extra Windows service/console guarantees from the Unix hook. |
| What happens to a later status command? | [`manager.go:1264–1279`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/codexplugin/manager.go#L1264) selects a runtime credential from its profile only when the reference is available in that command's environment. Missing it can prevent the optional remote read-only lookup. Local process and health evidence should remain the ordinary observation route; do not require vault unlock for every status/quit operation. |

## Implementation consequences for NEKODEX

1. Change only the selected credential launch route to pass the fixed nonsecret
   selector `env:NEKODEX_TUNNEL_RUNTIME_KEY`. Resolve the captured, scoped provider
   reference immediately before launch and put plaintext only in that child's
   environment. Keep native MCP arguments and the existing initialized-notification
   setting. Do not mutate the long-lived launcher's global environment.
2. Electron managed connect and Bun managed connect can use the same adapter.
   The SDK's detached process inherits the selected variable and its profile
   contains only the selector. No new SDK release, patched SDK, plaintext staging
   file or replacement tunnel transport is needed for this part.
3. The current native launchd service directly executes `tunnel-client run` from
   [`src/tunnel-service.ts`](../../src/tunnel-service.ts#L53). Replace that service
   entry with the authorized headless NEKODEX credential wrapper, which resolves
   the exact provider reference on every start and then launches the same SDK run
   command with the secret environment. Keep the plist free of secret values.
   Preserve the existing service/config generation and rollback owner.
4. Do not claim credential rotation from a reused process. Retain affected-peer
   ownership and stop/settle before the new launch. A healthy existing process
   can remain working when an unrelated vault read is unavailable; do not turn a
   failed store observation into permission to kill or replay it.
5. The injected environment can reach the MCP child: SDK
   [`pkg/mcpclient/stdio_command.go:87–102`](https://github.com/openai/tunnel-client/blob/5f99daabd4aa4a77049e6d81d54a0d8c18335397/pkg/mcpclient/stdio_command.go#L87)
   constructs `exec.Command` without a filtered `Env`, while the tunnel process
   inherited the selected secret variable. Remove NEKODEX's injected tunnel key
   at the earliest controlled MCP entry point before it can spawn unrelated
   children. This reduces accidental propagation; the same OS user remains in
   the trust boundary and the tunnel still needs the secret in memory.
6. Migration journals, provider references, profile snapshots and diagnostics must
   contain no raw key or environment dump. Preserve D01's prepare/config-commit/
   runtime-verified/retirement receipts and concurrent-change protections. The
   source facts remove the need for a speculative temporary-file fallback.

## Focused evidence still needed by the implementation owner

No broader SDK suite is necessary. Use a synthetic credential with an isolated
profile/state directory and a local fake control plane if exercising real SDK
connect. Managed connect performs a remote lookup even with an explicit tunnel
ID (`manager.go:386–393`), so an offline fixture must explicitly direct that
control-plane base URL to loopback and isolate `TUNNEL_CLIENT_STATE_DIR`; merely
using a fake key does not make the default command offline.

The useful adapter checks are: original selector stored rather than plaintext,
secret delivered to the child without argv/global-environment leakage, headless
entry resolving afresh after restart, same-alias rotation starting a new owned
process, locked-vault result preserving saved references, and failed/concurrent
migration preserving the previous committed generation. OS-backend verification
and actual user-requested tunnel readiness remain separate outcomes owned by the
implementation/integration lanes.

## Offline installed-binary result

The explicit standalone fixture
[`tests/fixtures/tunnel-sdk-env-offline.cjs`](../../tests/fixtures/tunnel-sdk-env-offline.cjs)
passed on the installed official `0.0.16` Darwin arm64 SDK. Binary location was
derived from NEKODEX's managed binary-path source and read-only installation
metadata; no real key bytes or installed SDK profile was read. The fixture checks
the binary against its installation receipt before execution. Observed SHA-256:
`6f1e8d5494d6c4d6c45cd4f6e07b5291459c0b23f4b8cd8266c7a64be3d9a2a0`.

```sh
node tests/fixtures/tunnel-sdk-env-offline.cjs \
  /Users/alex/.codex-chatgpt-web/bin/tunnel-client \
  /Users/alex/.codex-chatgpt-web/bin/tunnel-client-manifest.json
```

The fixture uses a fresh random alias/tunnel ID and synthetic key, explicit
`TUNNEL_CLIENT_STATE_DIR` and profile directory under its own temporary root,
an allowlisted child environment, and a loopback-only fake control plane/MCP
endpoint. It neither changes the global SDK state nor inherits the user's API
keys, proxy credentials or telemetry environment. It is not part of the ordinary
test suite and requires explicit binary/manifest arguments to launch anything.

Observed result: successful managed connect; selector-only generated profile;
seven loopback polls all authenticated with the synthetic key; at least one
authenticated poll after the connect control process exited; successful exact
fixture alias stop and observed exit of its captured PID/start identity; no
synthetic secret in the generated profile/state/log files. Only local tunnel
lookup/poll, MCP and OAuth discovery routes were requested. The successful
fixture removed its own temporary state after process settlement.

The first fixture attempt exposed an empty MCP discovery POST that its initial
JSON handler did not accept. That fixture error was corrected; it was not an SDK
or application defect. Its exact detached scratch process was identified by the
unique temporary profile path and captured start identity, stopped and observed
exited before the corrected run. No process-name termination or real-runtime
restart occurred. SDK state filenames are JSON-compatible `processes.yaml` and
`aliases.yaml`; the final fixture uses the actual `processes.yaml` receipt.

This supplies real installed-SDK evidence for selector persistence, detached
environment inheritance and exact stop/cleanup. It does not prove OS-vault access,
NEKODEX migration/rollback, headless launchd restart, Windows behavior, a valid
real tunnel key or ChatGPT connector readiness; those remain implementation-owner
checks at their corresponding boundary.
