import { expect, test } from "bun:test";
import { evaluatePythonMarker, parsePythonRequirement, validatePythonDependencyGraph } from "../src/agent-tools/skill-python-requirements";

const env = { python_version: "3.14", python_full_version: "3.14.8", sys_platform: "linux", platform_release: "6.12", implementation_name: "cpython" };
const hash = "a".repeat(64), otherHash = "b".repeat(64);
test("PEP508 markers obey typed fields, precedence and grouping without hiding unsupported syntax", () => {
  const active = parsePythonRequirement('demo [ Fancy_Extra ] ( >=1.0, <2, ) ; sys_platform == "linux" and (python_version >= "3.9" or implementation_name == "pypy")');
  expect(active.name).toBe("demo"); expect(active.extras).toEqual(["fancy-extra"]);
  expect(evaluatePythonMarker(active.marker, env)).toBe(true);
  expect(evaluatePythonMarker(parsePythonRequirement('other; sys_platform == "win32" or python_version < "3.10"').marker, env)).toBe(false);
  expect(evaluatePythonMarker(parsePythonRequirement('other; "lin" in sys_platform').marker, env)).toBe(true);
  expect(() => parsePythonRequirement('other; sys_platform == "win32" and unknown_field == "x"')).toThrow("Unknown");
  expect(() => evaluatePythonMarker(parsePythonRequirement('other; sys_platform == "linux" or platform_machine == "x"').marker, env)).toThrow("unavailable");
  expect(() => evaluatePythonMarker(parsePythonRequirement('other; extra != "gui"').marker, env)).toThrow("require extra ==");
  expect(() => evaluatePythonMarker(parsePythonRequirement('other; extra == "gui"').marker, env)).toThrow("metadata context");
});

test("selected artifact graph propagates transitive extras through cycles and ignores only false dependency markers", () => {
  const distributions = [
    { name: "app", version: "1.0", artifactSha256: hash, providesExtra: ["gui"], requires: ['lib[fast] >=1; extra == "gui"', 'windows-only; sys_platform == "win32"'] },
    { name: "lib", version: "1.7.post3", artifactSha256: otherHash, providesExtra: ["fast"], requires: ['app[gui]; extra == "fast"', 'leaf >1.7.post2; extra == "fast"'] },
    { name: "leaf", version: "1.7.post3", artifactSha256: "c".repeat(64), requires: [] },
  ];
  const base = validatePythonDependencyGraph(distributions, env); expect(base.edges).toEqual([]);
  const graph = validatePythonDependencyGraph(distributions, env, { requirements: ["app[GUI]==1.0"] });
  expect(graph.packages).toEqual([{ name: "app", extras: ["gui"] }, { name: "leaf", extras: [] }, { name: "lib", extras: ["fast"] }]);
  expect(graph.edges.map(e => e.to).sort()).toEqual(["app", "leaf", "lib"]);
  expect(() => validatePythonDependencyGraph(distributions.slice(0, 2), env, { requirements: ["app[gui]"] })).toThrow("missing distribution: leaf");
  expect(() => validatePythonDependencyGraph(distributions, env, { requirements: ["app[unpublished]"] })).toThrow("absent");
});

test("direct wheel URLs bind exact explicitly selected bytes and never imply fetching or fallback", () => {
  const url = `https://files.example.invalid/demo-1.0-py3-none-any.whl#sha256=${hash}`;
  const distributions = [{ name: "demo", version: "1.0", artifactSha256: hash, requires: [] }];
  expect(validatePythonDependencyGraph(distributions, env, { requirements: [`demo @ ${url} ; python_version >= '3.9'`], directArtifacts: [{ url, artifactSha256: hash }] }).packages[0]?.name).toBe("demo");
  expect(() => validatePythonDependencyGraph(distributions, env, { requirements: [`demo @ ${url}`] })).toThrow("exact selected artifact SHA256 mapping");
  expect(() => validatePythonDependencyGraph(distributions, env, { directArtifacts: [{ url, artifactSha256: otherHash }] })).toThrow("explicitly selected");
  expect(() => parsePythonRequirement("demo @ git+https://example.invalid/repo.git")).toThrow("Unsupported direct reference");
  expect(() => parsePythonRequirement("demo @ https://user:secret@example.invalid/demo.whl")).toThrow("credential-free");
  expect(() => parsePythonRequirement("demo @ https://example.invalid/demo.whl ; extras == 'dev'")).toThrow("lock-file set fields");
});
