import { appendFileSync, readFileSync } from "node:fs";

type ChangedScope = { files: string[]; manualReason?: string };

const reviewCases = {
  native: "review: native continuation expands a locally owned Web response only",
  windows: "review: Windows-shaped delivery stays bounded until consumer demand",
  helper: "review: closing a helper before ready settles the pending run",
  checkpoint: "review: checkpoint read failure does not authorize overwrite on retry",
  parser: "review: parser rejects inline file bytes and retains opaque redacted metadata",
} as const;
type ReviewCase = keyof typeof reviewCases;
const backendReviewFiles = new Map<string, ReviewCase[]>([
  ["src/native-passthrough.ts", ["native"]],
  ["src/responses/state.ts", ["native"]],
  ["src/server.ts", ["windows"]],
  ["src/adapters/chatgpt-web/launcher-helper-client.ts", ["helper"]],
  ["src/adapters/chatgpt-web/rolling-checkpoint.ts", ["checkpoint"]],
  ["src/responses/parser.ts", ["parser"]],
  ["src/responses/schema.ts", ["parser"]],
  ["src/responses/reasoning-envelope.ts", ["parser"]],
  ["tests/backend-review-regressions.test.ts", Object.keys(reviewCases) as ReviewCase[]],
]);
const capacityFiles = new Set([
  "launcher/electron/browser-capacity.cjs",
  "src/adapters/chatgpt-web/concurrency.ts",
  "tests/browser-capacity-16.test.ts",
]);
const capacityCase = "worker admits 16 distinct requests, rejects 17th, and reuses a released slot";
const maximumChangedFiles = 30;
const maximumSelectedCases = 5;

function summary(message: string): void {
  console.log(message);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
}

function output(name: string, value: string): void {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

async function pullRequestFiles(event: Record<string, any>): Promise<ChangedScope> {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GITHUB_TOKEN;
  const number = event.pull_request?.number;
  if (!repository || !token || !Number.isSafeInteger(number)) throw new Error("Missing pull request metadata or read token");
  if (event.pull_request.changed_files > maximumChangedFiles) {
    return { files: [], manualReason: `PR has more than ${maximumChangedFiles} changed files; automated case selection is too broad` };
  }
  const files: string[] = [];
  for (let page = 1; page <= 2; page++) {
    const response = await fetch(`https://api.github.com/repos/${repository}/pulls/${number}/files?per_page=100&page=${page}`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json" },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Could not enumerate PR files (HTTP ${response.status})`);
    const entries = await response.json() as Array<{ filename?: string; previous_filename?: string; status?: string }>;
    if (!Array.isArray(entries)) throw new Error("Unexpected PR files response");
    for (const entry of entries) {
      if (typeof entry.filename !== "string") throw new Error("PR file has no filename");
      files.push(entry.filename);
      if (entry.status === "renamed" && typeof entry.previous_filename === "string") files.push(entry.previous_filename);
    }
    if (files.length > maximumChangedFiles) {
      return { files, manualReason: `PR has more than ${maximumChangedFiles} changed paths; automated case selection is too broad` };
    }
    if (entries.length < 100) return { files };
  }
  throw new Error("PR file pagination did not finish");
}

async function pushFiles(event: Record<string, any>): Promise<ChangedScope> {
  const before = event.before;
  const after = event.after;
  if (typeof before !== "string" || typeof after !== "string"
    || !/^[a-f0-9]{40}$/.test(before) || !/^[a-f0-9]{40}$/.test(after)
    || /^0{40}$/.test(before)) return { files: [], manualReason: "Push has no comparable base commit" };
  const child = Bun.spawn(["git", "diff", "--name-status", "-z", "--find-renames", before, after, "--"], { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
  if (exitCode !== 0) throw new Error(`Could not compare push commits: ${stderr.trim()}`);
  if (stdout && !stdout.endsWith("\0")) throw new Error("Incomplete push diff output");
  const fields = stdout ? stdout.slice(0, -1).split("\0") : [];
  const files: string[] = [];
  for (let index = 0; index < fields.length;) {
    const status = fields[index++];
    if (!/^[ACDMTUXB]$|^[RC][0-9]*$/.test(status)) throw new Error(`Unexpected push diff status: ${status}`);
    const first = fields[index++];
    if (!first) throw new Error("Push diff entry has no filename");
    if (status.startsWith("R") || status.startsWith("C")) {
      const destination = fields[index++];
      if (!destination) throw new Error("Push rename or copy has no destination filename");
      if (status.startsWith("R")) files.push(first);
      files.push(destination);
    } else {
      files.push(first);
    }
  }
  return files.length > maximumChangedFiles
    ? { files, manualReason: `Push has more than ${maximumChangedFiles} changed paths; automated case selection is too broad` }
    : { files };
}

function metadata(file: string): boolean {
  return (file.startsWith("docs/") && file.endsWith(".md")) || file === "README.md"
    || file === ".github/dependabot.yml" || /^\.github\/workflows\/[^/]+\.yml$/.test(file);
}

function regexLiteral(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function main(): Promise<void> {
  if (!process.env.GITHUB_EVENT_PATH) throw new Error("Missing GitHub event payload");
  const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
  const kind = process.env.GITHUB_EVENT_NAME;
  if (kind !== "pull_request" && kind !== "push") throw new Error(`Unsupported CI event: ${kind}`);
  const scope = kind === "pull_request" ? await pullRequestFiles(event) : await pushFiles(event);
  const files = [...new Set(scope.files)];
  const selected = new Set<ReviewCase>();
  const direct = new Set<ReviewCase>();
  for (const file of files) for (const name of backendReviewFiles.get(file) ?? []) {
    selected.add(name);
    if (file !== "tests/backend-review-regressions.test.ts") direct.add(name);
  }
  const capacity = files.some(file => capacityFiles.has(file));
  const selectedNames = (Object.keys(reviewCases) as ReviewCase[])
    .filter(name => direct.has(name))
    .concat((Object.keys(reviewCases) as ReviewCase[]).filter(name => selected.has(name) && !direct.has(name)));
  const mode = scope.manualReason || !files.length ? "manual-review"
    : selectedNames.length && capacity ? "mixed-review"
    : selectedNames.length ? "backend-review" : capacity ? "capacity"
    : files.every(metadata) ? "metadata" : "manual-review";
  output("mode", mode);
  summary(`### CI scope: ${mode}`);
  summary(`Changed paths: ${files.length ? files.join(", ") : "unavailable"}.`);

  if (mode === "backend-review" || mode === "mixed-review") {
    const mixed = mode === "mixed-review";
    const backendNames = mixed ? selectedNames.slice(0, maximumSelectedCases - 1) : selectedNames;
    const overflow = mixed ? selectedNames.slice(maximumSelectedCases - 1) : [];
    const cases: string[] = backendNames.map(name => reviewCases[name]);
    if (mixed) cases.push(capacityCase);
    output("pattern", `^(?:${cases.map(regexLiteral).join("|")})$`);
    summary(`Linux selects ${cases.length} named ${mixed ? "backend and capacity" : "backend review"} case(s) in one bounded test execution: ${cases.join("; ")}.`);
    if (overflow.length) summary(`**Manual review required for backend case(s) beyond the ${maximumSelectedCases}-case shared limit:** ${overflow.map(name => reviewCases[name]).join("; ")}.`);
    const manual = files.filter(file => !backendReviewFiles.has(file) && !capacityFiles.has(file) && !metadata(file));
    if (manual.length) summary(`Manual review still required for paths without a selected case: ${manual.join(", ")}.`);
    const metadataPaths = files.filter(metadata);
    if (metadataPaths.length) summary(`Manual diff review still required for metadata paths: ${metadataPaths.join(", ")}.`);
    if (files.includes("tests/backend-review-regressions.test.ts")) summary("Changes to the regression file itself require review; newly added cases are not selected automatically.");
    if (mixed && files.includes("tests/browser-capacity-16.test.ts")) summary("Changes to the capacity test file itself require review; newly added cases are not selected automatically.");
    summary("A passing test covers only the named cases; it does not establish release or live-account behavior.");
  } else if (mode === "capacity") {
    output("pattern", `^${regexLiteral(capacityCase)}$`);
    summary(`Linux selects one browser admission case in one test execution: ${capacityCase}.`);
    const manual = files.filter(file => !capacityFiles.has(file) && !metadata(file));
    if (manual.length) summary(`Manual review still required for paths without a selected case: ${manual.join(", ")}.`);
    const metadataPaths = files.filter(metadata);
    if (metadataPaths.length) summary(`Manual diff review still required for metadata paths: ${metadataPaths.join(", ")}.`);
    if (files.includes("tests/browser-capacity-16.test.ts")) summary("Changes to the capacity test file itself require review; newly added cases are not selected automatically.");
  } else if (mode === "manual-review") {
    summary(`**Manual review required; no automated behavior test selected.** ${scope.manualReason ?? "Changed behavior has no safe named-case mapping."}`);
    if (files.length) summary(`Manual review paths: ${files.filter(file => !metadata(file)).join(", ") || "metadata only"}.`);
    summary("A green `verify` job in this mode records classification only; it does not mean the review happened or the behavior passed.");
  } else {
    summary("Metadata requires manual diff review. `actionlint` checks workflows; no runtime behavior test is selected.");
  }
  summary("The macOS and Windows `verify` jobs retain required check names and do not run PR behavior tests.");
}

main().catch(error => {
  summary(`Focused CI classification failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
