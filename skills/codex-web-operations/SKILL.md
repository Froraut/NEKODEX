---
name: codex-web-operations
description: Set up, diagnose and update the FroRaut Codex Web GPT bridge, including existing-Chrome sign-in, Codex or Hermes model routing and the ChatGPT MCP connector. Use for codex-chatgpt-web operations, not general native Codex account questions.
---

# Codex Web GPT operations

Complete the user's requested bridge workflow through installed behavior. Keep source publication,
installed version, login, model catalog, a real response and MCP execution as separate evidence.

## Establish the current state

- Maintained fork: `https://github.com/Froraut/codex-chatgpt-web`.
- Original project: `https://github.com/miuuyy/codex-chatgpt-web`.
- Known Mac checkout: `/Users/alex/Dev/codex-chatgpt-web`; installed app:
  `/Applications/Codex Web GPT.app`. Revalidate paths/version on the current host.
- The human works in **Codex** and selects a ChatGPT Web model. The local app transports the
  task to ChatGPT Web. Full mode uses a **ChatGPT connector** to return tool calls to the same
  native Codex task. Installing a Codex plugin alone does not implement this model route.
- Public author/committer attribution is **FroRaut**; GitHub's repository path is **Froraut**.
  Keep original contributor/license attribution and genuine upstream source links.

Read [architecture and alternatives](references/architecture.md) when explaining where each
component belongs or comparing simpler approaches. Do not silently replace the requested Web
model route with native Codex or API billing.

## Setup and acceptance

Read [setup](references/setup.md) for installation, login, model setup, the tunnel/key/connector
sequence and direct acceptance. Reuse an existing authorized tunnel/key/profile before creating
another. Keep approved decisions across turns, and follow current tool confirmation requirements
only for the actual consequential action. An automatic goal continuation is not a new answer.

Success is scoped: a model catalog request does not prove a desktop picker refreshed; a browser
reply does not prove native Codex received it; a healthy tunnel or visible connector does not
prove a tool ran. Do not announce full setup until a real native request and an actual tool
result establish it. State platform/model flows not exercised.

## Recovery and updates

Read [troubleshooting](references/troubleshooting.md) for the exact failing layer. Preserve the
working account/profile and current request; a failed observation does not authorize duplicate
sends, resets or reinstall loops. Never copy cookies, a debugging endpoint or keys through
operator tooling to bypass an application's access denial.

For code changes, inspect the current fork and relevant upstream issue/PR heads. Adapt verified
fixes without weakening native approvals or relabeling mutating tools. Follow the user's current
verification limits; do not import an old full-suite requirement from this runbook. Build and
deliver the scoped change, preserve rollback, verify the installed identity, and finish authorized
Git publication. Keep account data and raw diagnostics out of commits and this skill.

## Hermes

Read [Hermes integration](references/hermes.md) when the user wants Hermes to use Web models
with its own tools. Preserve Hermes' normal tool loop and approvals. A provider entry or an
ordinary reply is not proof of tool execution; require the original function call, Hermes'
actual result and the continued model response before claiming full integration works.

The detailed public investigation and workflow live in the fork under
`docs/reviews/2026-09-14-investigation.md` and `docs/workflow-and-alternatives.md`. These are dated
evidence; refresh mutable state instead of treating their checkpoints as today's result.
