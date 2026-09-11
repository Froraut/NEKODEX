# Security policy

Do not open public issues containing ChatGPT cookies, browser storage, tunnel IDs, API keys,
Codex prompts, tool results, or local filesystem paths. Redact diagnostic bundles before sharing.

The daemon binds only to loopback. If another local user can access your account or application
home, treat the browser session and tunnel key as compromised and rotate them.

Read the complete [security model](docs/security-model.md) before enabling full mode. In particular,
full mode lets an untrusted model response request tools from the current Codex turn; keep connector
action control, Codex sandboxing, and approvals aligned with the workspace's risk.

The application uses the MCP SDK's stdio transport. Its dependency graph also contains HTTP/SSG
components that are not imported by this application. The fork pins `@hono/node-server` 2.0.12
and `hono` 4.13.5 as dependency floors, and pins build-time `js-yaml` 4.3.2. These address the
advisories found by the September 2026 review; an affected dependency is not by itself proof of
a reachable application exploit. Run both dependency audits, MCP protocol tests, and runtime
smoke checks when updating these pins. See the [review](docs/reviews/2026-09-11-review.md).

Once the GitHub repository is public, use its private Security Advisory reporting flow. Until that
is enabled, do not publish a proof of concept that exposes credentials or arbitrary local tool
execution; contact the maintainer privately through the GitHub account listed by the repository.
