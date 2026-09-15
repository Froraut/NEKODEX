# Connector identity migration — lane 7 (CLI / DEV transport)

Baseline: `d880b12`. Reviewed `src/cli.ts`, `src/dev-chat/transport.ts`, direct DEV caller `src/dev-chat/cli.ts`, setup result, and connector constants in `src/config.ts`. The coordinated generation-4 targets are `Codex Native4`, `Codex Native4 DEV`, and `Codex Zero Risk4`. `Codex Zero Risk3` is a defensive legacy alias only; it was never published here. No tests, typechecks, suites, benchmarks, account actions, or service operations were run in this lane, per the shared verification budget.

## Change

`src/cli.ts`: after successful Full setup, the CLI reads the active connector name from the saved config and prints it in the ChatGPT plugin instruction. The message says to create the connector under that name and keep the previous connector available for rollback. This follows the parent-owned generation-4 constants through setup/config rather than hardcoding connector names in the CLI. The existing tunnel, setup transaction, environment selection, and uninstall rollback path are unchanged.

`src/dev-chat/transport.ts`: no change. It receives an `AppConfig`, checks isolated DEV purpose and Full tunnel readiness, and binds the broker socket. It does not choose or display a connector identity and contains no retired hardcoded names. The readiness error concerns the tunnel, so connector guidance there would be misleading.

## Parent integration finding

The direct DEV CLI caller in `src/dev-chat/cli.ts` already imports `DEV_CHATGPT_CONNECTOR_NAME` from config and rejects a Full DEV chat when `config.appName` differs. That guard currently also rejects the explicit Manual choice, whose active name is `ZERO_RISK_CHATGPT_CONNECTOR_NAME` (`Codex Zero Risk4`). This is outside lane 7's write paths. Parent should assign a scoped fix or include it in integration review so DEV Manual remains usable under the generation-4 identity. The DEV setup command has no hardcoded connector name to replace.

Manual review of the one CLI diff and its setup/config call path completed. Runtime behavior after parent changes the canonical names was not exercised here. Historical review and release records remain unchanged.
