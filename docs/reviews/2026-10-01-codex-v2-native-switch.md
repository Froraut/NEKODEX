# Native V2 protocol transition

At fork base `5fd97c1d`, `subagents native` rejected a user-enabled `multi_agent_v2` after Compatibility V1 setup. The integration treated the changed feature as drift before it could release its old V1 overrides.

The explicit native transition now restores only feature/depth lines still exactly owned by the previous V1 setup. It preserves user-written scalar, inline-table and feature-table V2 settings. URL, realtime route, provider, catalog and interrupt-hook validation retain their existing strict checks. Ordinary setup and repair still reject a newer feature edit. Runtime config and the integration journal share the existing compensation boundary.

The live Web subagent check now accepts `--v2` and named Web model rows; its isolated client home does not copy account credentials or change the production route. Opaque encrypted native-to-Web payloads remain rejected.

## Focused development evidence

- Codex CLI 0.159.3: V1 and V2 nested lifecycle fixtures both completed child/grandchild, wait and follow-up steps.
- Protocol-switch fixture: scalar, inline and table user-enabled V2 settings preserved; changed route refused with all snapshots unchanged; ordinary repair retained its drift rejection.
- Runtime TypeScript check, architecture map/check, connector ABI check and diff whitespace check passed.
- A live V2 Web trial reached the installed account readiness queue and remained not sent because the selected account had no personal local-tools connector. The task-owned client was stopped and its exact queued browser admission was cancelled through Task Center; it did not produce a child or a provider reply. This is a live account readiness limitation, not successful Web V2 acceptance.

Installed NEKODEX was 6.1.15-nekodex.1 during that observation. Source/fixture evidence does not establish an installed update.

## Account-scoped OpenAI API panel

Accounts → Setup and settings and Connections → Local tools connector now open fixed Tunnels/API keys destinations in the captured account's own session. The isolated final DEV source build (6.1.16-nekodex.1) was exercised with native Computer Use: the account button opened `platform.openai.com/settings/organization/tunnels` in the separately titled account window. A clean profile reaches Platform's challenge/login boundary; this opening evidence does not confirm access to the production organization or creation of a ChatGPT app.

The private panel is absent from automated task surfaces and does not read or write the ChatGPT workspace location manifest. Popup/session leases and request fencing were independently reviewed. Runtime/launcher typechecks, renderer build, focused response/auth accounting and panel-policy fixtures, architecture and version checks passed for the reviewed source.
