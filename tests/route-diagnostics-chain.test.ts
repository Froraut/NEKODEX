import { expect, test } from "bun:test";
import { diagnoseCodexConfiguration } from "../src/route-diagnostics";

const RUNTIME = "http://127.0.0.1:17841/v1";
const GATEWAY = "http://127.0.0.1:17844/v1";
const integration = { installed: true, active: true, routeUrl: RUNTIME, errors: [] };
const proof = { url: GATEWAY, upstreamUrl: RUNTIME, upstreamVersion: "6.1.32-nekodex.18", gatewayVersion: "0.5.13" };
const diagnose = (text: string, options: Partial<Parameters<typeof diagnoseCodexConfiguration>[1]> = {}) =>
  diagnoseCodexConfiguration(text, { codexHome: "/tmp/codex-home", integration, ...options });

test("a verified codex-providers gateway in front of this runtime is a matching route", () => {
  const report = diagnose(`openai_base_url = "${GATEWAY}"\n`, { chainedRoute: proof });
  expect(report.routeMatches).toBe(true);
  expect(report.issueCodes).not.toContain("route-mismatch");
});

test("without that proof, or for another upstream or URL, the route still differs", () => {
  expect(diagnose(`openai_base_url = "${GATEWAY}"\n`).issueCodes).toContain("route-mismatch");
  expect(diagnose(`openai_base_url = "${GATEWAY}"\n`, { chainedRoute: { ...proof, upstreamUrl: "http://127.0.0.1:9/v1" } })
    .issueCodes).toContain("route-mismatch");
  expect(diagnose(`openai_base_url = "http://127.0.0.1:18000/v1"\n`, { chainedRoute: proof }).issueCodes).toContain("route-mismatch");
});

test("a profile that points elsewhere is not covered by the root config's gateway proof", () => {
  const report = diagnose(`openai_base_url = "${GATEWAY}"\n`, {
    chainedRoute: proof, profile: "work", profileText: `openai_base_url = "http://127.0.0.1:18000/v1"\n`,
  });
  expect(report.routeMatches).toBe(false);
  expect(report.issueCodes).toContain("route-mismatch");
});

test("the direct route and the diagnostics' other findings are unchanged", () => {
  const direct = diagnose(`openai_base_url = "${RUNTIME}"\nmodel_catalog_json = "/tmp/catalog.json"\n`);
  expect(direct.routeMatches).toBe(true);
  expect(direct.issueCodes).toEqual(["catalog-override"]);
});
