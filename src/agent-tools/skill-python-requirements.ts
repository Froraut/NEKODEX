import { valid, validRange, satisfies as pep440Satisfies, explain, compare } from "@renovatebot/pep440";

/** Passive PyPA dependency-specifiers/core-metadata interpretation. This module
 * never discovers artifacts, imports Python, fetches URLs or invokes installers.
 * https://packaging.python.org/en/latest/specifications/dependency-specifiers/
 * https://packaging.python.org/en/latest/specifications/core-metadata/
 */
export class PythonRequirementError extends Error {
  constructor(message: string) { super(message); this.name = "PythonRequirementError"; }
}
function fail(reason: string): never { throw new PythonRequirementError(reason); }
export function normalizePythonName(value: string): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,100}[A-Za-z0-9])?$/.test(value)) fail("Invalid Python distribution or extra name");
  return value.toLowerCase().replace(/[-_.]+/g, "-");
}
export function pythonVersionSatisfies(version: string, spec: string): boolean {
  if (spec.length > 512 || !validRange(spec)) fail("Invalid PEP 440 dependency constraint");
  return spec.split(",").filter(p => p.trim()).every(part => {
    const exclusive = /^\s*([<>])\s*([^=].*?)\s*$/.exec(part);
    if (!exclusive) return pep440Satisfies(version, part, { prereleases: true });
    const candidate = explain(version), bound = explain(exclusive[2]!);
    if (!candidate || !bound) fail("Invalid exclusive Python version bound");
    const sameBase = compare(candidate.base_version, bound.base_version) === 0, order = compare(version, exclusive[2]!);
    return exclusive[1] === "<" ? order < 0 && !(sameBase && candidate.is_prerelease && !bound.is_prerelease)
      : order > 0 && !(sameBase && (candidate.local !== null || candidate.is_postrelease && !bound.is_postrelease));
  });
}
type Operand = { field: string } | { literal: string };
type Marker = { op: string; left: Operand; right: Operand } | { join: "and" | "or"; left: Marker; right: Marker };
export interface PythonRequirement { name: string; extras: string[]; specifier?: string; url?: string; marker?: Marker }
const fields = new Set(["os_name", "sys_platform", "platform_machine", "platform_python_implementation", "platform_release", "platform_system", "platform_version", "python_version", "python_full_version", "implementation_name", "implementation_version", "extra"]);
const versions = new Set(["python_version", "python_full_version", "implementation_version"]);
const versionOrString = new Set(["platform_release", "platform_version"]);
export type PythonMarkerEnvironment = Readonly<Partial<Record<string, string>>>;

function parseMarker(source: string): Marker {
  let at = 0, depth = 0, nodes = 0;
  const space = () => { while (/[ \t]/.test(source[at] ?? "\0")) at++; };
  const word = (value: string) => { space(); if (source.slice(at, at + value.length) === value && !/[A-Za-z0-9_]/.test(source[at + value.length] ?? "")) { at += value.length; return true; } return false; };
  const operand = (): Operand => {
    space(); const quote = source[at];
    if (quote === "'" || quote === '"') {
      const start = ++at; while (at < source.length && source[at] !== quote) at++;
      if (at === source.length) fail("Unterminated PEP 508 marker string");
      const literal = source.slice(start, at++);
      if (/[^\x20-\x7e]|\\/.test(literal)) fail("Unsupported PEP 508 marker string escape or character");
      return { literal };
    }
    const field = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(at))?.[0];
    if (!field || !fields.has(field)) fail("Unknown or unsupported PEP 508 marker field (lock-file set fields are not dependency metadata)");
    at += field.length; return { field };
  };
  const atom = (): Marker => {
    if (++nodes > 128) fail("PEP 508 marker expression exceeds its bound");
    space();
    if (source[at] === "(") {
      if (++depth > 16) fail("PEP 508 marker nesting exceeds its bound");
      at++; const result = or(); space(); if (source[at++] !== ")") fail("Unclosed PEP 508 marker group"); depth--; return result;
    }
    const left = operand(); space();
    let op = /^(===|~=|==|!=|<=|>=|<|>)/.exec(source.slice(at))?.[0];
    if (op) at += op.length;
    else if (word("not")) { if (!word("in")) fail("Invalid PEP 508 marker operator"); op = "not in"; }
    else if (word("in")) op = "in";
    else fail("Invalid PEP 508 marker operator");
    const right = operand();
    if (("field" in left) === ("field" in right)) fail("PEP 508 marker comparison requires one field and one string");
    return { op, left, right };
  };
  const and = (): Marker => { let result = atom(); while (word("and")) result = { join: "and", left: result, right: atom() }; return result; };
  const or = (): Marker => { let result = and(); while (word("or")) result = { join: "or", left: result, right: and() }; return result; };
  const result = or(); space(); if (at !== source.length) fail("Unparsed PEP 508 marker syntax"); return result;
}

export function parsePythonRequirement(raw: string): PythonRequirement {
  if (typeof raw !== "string" || !raw.trim() || raw.length > 4096 || /[\r\n\0]/.test(raw)) fail("Invalid or oversized PEP 508 requirement");
  const head = /^\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*(?:\[([^\]]*)\])?\s*/.exec(raw);
  if (!head) fail("Invalid PEP 508 distribution name or extras");
  const name = normalizePythonName(head[1]!), extras = (head[2]?.trim() ? head[2].split(",").map(x => normalizePythonName(x.trim())) : []);
  if (new Set(extras).size !== extras.length || extras.length > 64) fail("Duplicate or oversized PEP 508 extras");
  let rest = raw.slice(head[0].length), url: string | undefined, specifier: string | undefined, marker: Marker | undefined;
  if (rest.startsWith("@")) {
    const match = /^@\s*(\S+)([ \t]+[\s\S]*|$)/.exec(rest);
    if (!match) fail("Invalid PEP 508 direct reference");
    url = validatePythonArtifactUrl(match[1]!); rest = match[2]!.trim();
    if (rest && !rest.startsWith(";")) fail("Direct reference marker requires whitespace and semicolon");
  } else {
    const semi = rest.indexOf(";"); const value = (semi < 0 ? rest : rest.slice(0, semi)).trim(); rest = semi < 0 ? "" : rest.slice(semi);
    if (value) {
      specifier = value.startsWith("(") && value.endsWith(")") ? value.slice(1, -1).trim() : value;
      if (specifier.endsWith(",")) specifier = specifier.slice(0, -1).trim();
      if (!specifier || !validRange(specifier)) fail("Invalid PEP 440 dependency constraint");
    }
  }
  if (rest) { if (!rest.startsWith(";")) fail("Unparsed PEP 508 requirement syntax"); marker = parseMarker(rest.slice(1)); }
  return { name, extras: extras.sort(), ...(specifier ? { specifier } : {}), ...(url ? { url } : {}), ...(marker ? { marker } : {}) };
}
export function validatePythonArtifactUrl(raw: string): string {
  let value: URL; try { value = new URL(raw); } catch { return fail("Direct reference requires an absolute HTTPS or file wheel URL"); }
  if (!["https:", "file:"].includes(value.protocol) || value.username || value.password || value.search || !/\.whl$/i.test(value.pathname)
    || value.protocol === "file:" && value.host && value.host !== "localhost") fail("Unsupported direct reference: only credential-free HTTPS or local file wheel URLs are admitted");
  if (value.hash && !/^#sha256=[a-f0-9]{64}$/i.test(value.hash)) fail("Unsupported direct reference fragment: require a SHA256 pin");
  return raw;
}
export function evaluatePythonMarker(marker: Marker | undefined, environment: PythonMarkerEnvironment, extras?: readonly string[]): boolean {
  if (!marker) return true;
  if ("join" in marker) {
    // Evaluate both branches so unavailable/unsupported fields cannot hide behind
    // short circuiting and silently admit an incomplete closure.
    const left = evaluatePythonMarker(marker.left, environment, extras), right = evaluatePythonMarker(marker.right, environment, extras);
    return marker.join === "and" ? left && right : left || right;
  }
  const field = "field" in marker.left ? marker.left.field : (marker.right as { field: string }).field;
  const literal = "literal" in marker.left ? marker.left.literal : (marker.right as { literal: string }).literal;
  if (field === "extra") {
    if (marker.op !== "==" || !("field" in marker.left)) fail("Unsupported extra marker: require extra == quoted-name");
    if (!extras) fail("Extra marker requires distribution dependency metadata context");
    return extras.includes(normalizePythonName(literal));
  }
  const value = environment[field]; if (typeof value !== "string") fail("PEP 508 marker field is unavailable for the admitted runtime: " + field);
  const left = "field" in marker.left ? value : literal, right = "field" in marker.right ? value : literal;
  if (versions.has(field) && ["in", "not in"].includes(marker.op)) fail("Containment is unsupported for a version marker field");
  if (marker.op === "in") return right.includes(left);
  if (marker.op === "not in") return !right.includes(left);
  if (versions.has(field) || versionOrString.has(field) && valid(left) && validRange(marker.op + right)) {
    if (!valid(left) || !validRange(marker.op + right)) fail("Invalid PEP 440 version marker comparison");
    return pythonVersionSatisfies(left, marker.op + right);
  }
  if (marker.op === "==" || marker.op === ">=" || marker.op === "<=") return left === right;
  if (marker.op === "!=") return left !== right;
  if (marker.op === ">" || marker.op === "<") return false;
  fail("Unsupported string marker operator; use ==, !=, in or not in");
}

export interface PythonSelectedDistribution { name: string; version: string; artifactSha256: string; requires: readonly string[]; providesExtra?: readonly string[] }
export interface PythonDirectArtifactPin { url: string; artifactSha256: string }
export interface PythonDependencyGraph { packages: { name: string; extras: string[] }[]; edges: { from: string; to: string; requirement: string }[] }
/** Every selected artifact is installed (and therefore its base dependencies
 * apply). Explicit roots activate extras; dependency extras propagate to a fixed
 * point, including cycles. URL pins map already selected bytes, never downloads.
 */
export function validatePythonDependencyGraph(distributions: readonly PythonSelectedDistribution[], environment: PythonMarkerEnvironment,
  options: { requirements?: readonly string[]; directArtifacts?: readonly PythonDirectArtifactPin[] } = {}): PythonDependencyGraph {
  if (!distributions.length || distributions.length > 64 || (options.requirements?.length ?? 0) > 256 || (options.directArtifacts?.length ?? 0) > 256) fail("Selected dependency graph exceeds its bound");
  const packages = new Map<string, { dist: PythonSelectedDistribution; extras: Set<string>; provided: Set<string>; requires: { raw: string; parsed: PythonRequirement }[] }>();
  for (const dist of distributions) {
    const name = normalizePythonName(dist.name);
    if (packages.has(name) || !valid(dist.version) || !/^[a-f0-9]{64}$/.test(dist.artifactSha256) || dist.requires.length > 256) fail("Duplicate or invalid selected distribution identity");
    const provided = (dist.providesExtra ?? []).map(normalizePythonName);
    if (new Set(provided).size !== provided.length || provided.length > 64) fail("Ambiguous Provides-Extra metadata");
    packages.set(name, { dist, extras: new Set(), provided: new Set(provided), requires: dist.requires.map(raw => ({ raw, parsed: parsePythonRequirement(raw) })) });
  }
  const pins = new Map<string, string>();
  for (const pin of options.directArtifacts ?? []) {
    const url = validatePythonArtifactUrl(pin.url);
    if (pins.has(url) || !/^[a-f0-9]{64}$/.test(pin.artifactSha256) || !distributions.some(d => d.artifactSha256 === pin.artifactSha256)) fail("Direct reference pin must identify one explicitly selected artifact");
    const fragment = new URL(url).hash.slice(8); if (fragment && fragment.toLowerCase() !== pin.artifactSha256) fail("Direct reference fragment and selected artifact SHA256 differ");
    pins.set(url, pin.artifactSha256);
  }
  let changed = false;
  const apply = (r: PythonRequirement) => {
    const target = packages.get(r.name); if (!target) fail("Selected dependency closure is missing distribution: " + r.name);
    if (r.specifier && !pythonVersionSatisfies(target.dist.version, r.specifier)) fail("Selected distribution violates dependency version: " + r.name);
    if (r.url && pins.get(r.url) !== target.dist.artifactSha256) fail("Direct reference lacks an exact selected artifact SHA256 mapping: " + r.name);
    for (const extra of r.extras) { if (!target.provided.has(extra)) fail("Requested extra is absent from selected distribution metadata: " + r.name + "[" + extra + "]"); if (!target.extras.has(extra)) { target.extras.add(extra); changed = true; } }
  };
  for (const raw of options.requirements ?? []) { const r = parsePythonRequirement(raw); if (evaluatePythonMarker(r.marker, environment)) apply(r); }
  const edges = new Map<string, PythonDependencyGraph["edges"][number]>();
  do {
    changed = false;
    for (const [name, pkg] of packages) for (const { raw, parsed } of pkg.requires) {
      if (!evaluatePythonMarker(parsed.marker, environment, [...pkg.extras])) continue;
      apply(parsed); edges.set(name + "\0" + raw, { from: name, to: parsed.name, requirement: raw });
    }
  } while (changed);
  return { packages: [...packages].map(([name, p]) => ({ name, extras: [...p.extras].sort() })).sort((a, b) => a.name.localeCompare(b.name)), edges: [...edges.values()].sort((a, b) => (a.from + a.requirement).localeCompare(b.from + b.requirement)) };
}
