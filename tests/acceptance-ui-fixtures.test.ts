import { expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import datasetV1 from "./fixtures/chatgpt-ui/v1.json";
import {
  evaluateUiFixtureDataset, parseUiFixtureDataset, runUiFixtureChecks,
} from "../src/acceptance-ui-fixtures";
import { chatGptModelStateMatches } from "../src/chatgpt-session";
import { chatGptProUsageLimitTooltip } from "../src/adapters/chatgpt-web/pro-retry-hint";
import { proRetryTooltipFixture } from "./fixtures/pro-retry-tooltip";

test("default UI fixture acceptance stays offline and reports only bounded structural evidence", () => {
  const denyNetwork = () => { throw new Error("Network must not be used"); };
  const fetch = spyOn(globalThis, "fetch").mockImplementation(Object.assign(denyNetwork, { preconnect: denyNetwork }));
  const read = spyOn(fs, "readFileSync").mockImplementation(() => { throw new Error("Runtime file/profile reads must not be used"); });
  try {
    const checks = runUiFixtureChecks();
    expect(checks.length).toBeGreaterThan(25);
    expect(checks.every(check => check.passed)).toBeTrue();
    expect(new Set(checks.map(check => check.id)).size).toBe(checks.length);
    expect(checks.every(check => Object.keys(check).sort().join(",") === "detail,id,passed")).toBeTrue();
    expect(checks.every(check => check.detail.length < 200)).toBeTrue();
    expect(fetch).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
    const report = JSON.stringify(checks);
    expect(report).not.toContain("使用左右箭头");
    expect(report).not.toContain("Try again after");
    expect(report).not.toContain("/Users/");
  } finally {
    fetch.mockRestore();
    read.mockRestore();
  }
});

test.each([0, 2, "1", null])("unsupported dataset version %j fails explicitly", version => {
  expect(() => parseUiFixtureDataset({ ...datasetV1, version })).toThrow("Unsupported UI fixture dataset version");
});

test.each([
  { name: "null", value: null },
  { name: "array", value: [] },
  { name: "empty object", value: {} },
  { name: "missing cases", value: { version: 1 } },
  { name: "empty cases", value: { ...datasetV1, cases: [] } },
])("malformed dataset fails instead of being silently skipped: $name", ({ value }) => {
  expect(() => parseUiFixtureDataset(value)).toThrow("Malformed UI fixture dataset");
});

test("fixture parser rejects unknown fields and untrusted provenance without echoing them", () => {
  const secret = "synthetic-sensitive-field-do-not-echo";
  expect(() => parseUiFixtureDataset({ ...datasetV1, accountToken: secret })).toThrow("Malformed UI fixture dataset");
  expect(() => parseUiFixtureDataset({
    ...datasetV1, provenance: { ...datasetV1.provenance, liveAccountEvidence: true },
  })).toThrow("Malformed UI fixture dataset");
  try {
    parseUiFixtureDataset({ ...datasetV1, cases: [{ ...datasetV1.cases[0], pageText: secret }] });
    throw new Error("Expected schema rejection");
  } catch (error) {
    expect((error as Error).message).toBe("Malformed UI fixture dataset");
    expect((error as Error).message).not.toContain(secret);
  }
});

test("duplicate identities and oversized fixture input are rejected", () => {
  expect(() => parseUiFixtureDataset({ ...datasetV1, cases: [datasetV1.cases[0], datasetV1.cases[0]] }))
    .toThrow("duplicate case IDs");
  expect(() => parseUiFixtureDataset({ ...datasetV1, cases: Array(129).fill(datasetV1.cases[0]) }))
    .toThrow("Malformed UI fixture dataset");
  expect(() => parseUiFixtureDataset({
    ...datasetV1, cases: [{ ...datasetV1.cases[0], attributes: ["0", "4", "1".repeat(33)] }],
  })).toThrow("Malformed UI fixture dataset");
});

test("independent Extra High and all pinned Pro versions use the production model classifier", () => {
  const checks = new Map(evaluateUiFixtureDataset(datasetV1).map(check => [check.id, check]));
  for (const id of [
    "extra-high-available-without-pro", "pro-does-not-imply-extra-high", "unavailable-pro-does-not-fallback",
    "pro-pinned-5-6", "pro-pinned-5-5", "pro-pinned-6", "pro-version-rejects-7",
  ]) expect(checks.get(id)?.passed).toBeTrue();
  const fixtures = structuredClone(datasetV1);
  const independentExtraHigh = fixtures.cases.find(fixture => fixture.id === "extra-high-available-without-pro")!;
  // A changed expectation must fail; the runner must not report all well-formed inputs as passing.
  independentExtraHigh.expected = null;
  expect(evaluateUiFixtureDataset(fixtures).find(check => check.id === independentExtraHigh.id)?.passed).toBeFalse();
});

test("the shared state proof keeps version and Pro in the same accessibility description", () => {
  expect(chatGptModelStateMatches(["5.6 Pro，第 5 项，共 5 项。"], "5.6", true)).toBeTrue();
  expect(chatGptModelStateMatches(["5.6 Instant", "Use Pro for difficult tasks"], "5.6", true)).toBeFalse();
  expect(chatGptModelStateMatches(["Latest Pro"], "6", true)).toBeFalse();
  expect(chatGptModelStateMatches(["GPT-5.60 Pro"], "5.6", true)).toBeFalse();
});

test("selector drift is reported as a failed string contract without claiming a DOM match", () => {
  const fixtures = structuredClone(datasetV1);
  const selector = fixtures.cases.find(fixture => fixture.kind === "selector-contract")!;
  selector.expected = "#synthetic-retired-selector";
  const result = evaluateUiFixtureDataset(fixtures).find(check => check.id === selector.id)!;
  expect(result.passed).toBeFalse();
  expect(result.detail).toContain("no browser DOM matching");
  expect(result.detail).not.toContain("synthetic-retired-selector");
});

test("versioned provenance reuses the existing synthetic Pro tooltip ownership and absence fixture", async () => {
  const source = fs.readFileSync(new URL("./fixtures/pro-retry-tooltip.html", import.meta.url), "utf8");
  expect(source).toContain("SYNTHETIC linkage and layout");
  expect(source).toContain('role="menuitemradio">Extra High');
  expect(source).toContain('id="pro" role="menuitemradio" aria-disabled="true">Pro');
  expect(datasetV1.provenance.sourceFixtures).toContain("tests/fixtures/pro-retry-tooltip.html");
  const linked = proRetryTooltipFixture();
  expect(await chatGptProUsageLimitTooltip(linked.menu, { timeoutMs: 0 }))
    .toBe("Try again after Sep 15, 2026.");
  expect(linked.reads).toEqual(["pro-tooltip"]);
  const unlinked = proRetryTooltipFixture({ descriptionId: null, mount: false });
  expect(await chatGptProUsageLimitTooltip(unlinked.menu, { timeoutMs: 0 })).toBeUndefined();
  expect(unlinked.reads).toEqual([]);
});
