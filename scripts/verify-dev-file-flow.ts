#!/usr/bin/env bun

import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, lstatSync, realpathSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { deflateSync } from "node:zlib";
import type { ProviderAdapter } from "../src/adapters/base";
import type { AppConfig } from "../src/config";
import type { DevChatTransport } from "../src/dev-chat/transport";
import type { CodexProviderConfig } from "../src/types";

const USAGE = `Focused real DEV file-flow acceptance

Usage:
  bun run scripts/verify-dev-file-flow.ts \\
    --dev-home /absolute/path/to/existing/dev-home \\
    --model chatgpt-web/medium [--scenario all|read|generate] [--timeout-seconds 180] [--cleanup-artifacts]

This command requires an already-running, already-authenticated DEV launcher and an existing
dev-harness config. It never starts a launcher, performs setup, or falls back to a production home.
It makes real provider submissions when a read or generate scenario is selected.
`;

type Scenario = "all" | "read" | "generate";

const DEV_CHAT_MODELS = [
  "chatgpt-web/zero-risk",
  "chatgpt-web/luna",
  "chatgpt-web/think",
  "chatgpt-web/light",
  "chatgpt-web/medium",
  "chatgpt-web/high",
  "chatgpt-web/extra-high",
  "chatgpt-web/pro",
] as const;

type DevChatModel = typeof DEV_CHAT_MODELS[number];
type AdapterFactory = (provider: CodexProviderConfig) => ProviderAdapter;

interface DevProfilePaths {
  home: string;
  codexHome: string;
  launcherUserData: string;
  launcherStatePath: string;
  descriptorPath: string;
  chatsPath: string;
  runtimePath: string;
  configPath: string;
}

let browserOnlyInstructionsRuntime = "";
let responseRequestRuntime: typeof import("../src/server").responseRequest;

interface Options {
  devHome: string;
  model: DevChatModel;
  scenario: Scenario;
  timeoutMs: number;
  cleanupArtifacts: boolean;
}

interface ResponsesEnvelope {
  id?: string;
  status?: string;
  output?: unknown[];
  error?: { message?: string; type?: string; code?: string } | null;
  incomplete_details?: { reason?: string; message?: string } | null;
}

interface ArtifactEvidence {
  name: string;
  path: string;
  mimeType: string;
  size: number;
  sha256: string;
  manifestPath: string;
  manifestSha256: string;
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  const value = args[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`${name} requires a value`);
  args.splice(index, 2);
  return value;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index < 0) return false;
  args.splice(index, 1);
  return true;
}

function parseOptions(argv: string[]): Options | undefined {
  const args = [...argv];
  if (takeFlag(args, "--help") || takeFlag(args, "-h")) {
    process.stdout.write(USAGE);
    return undefined;
  }
  const rawHome = takeOption(args, "--dev-home");
  const rawModel = takeOption(args, "--model");
  const rawScenario = takeOption(args, "--scenario") ?? "all";
  const rawTimeout = takeOption(args, "--timeout-seconds") ?? "180";
  const cleanupArtifacts = takeFlag(args, "--cleanup-artifacts");
  if (args.length > 0) throw new Error(`Unknown arguments: ${args.join(" ")}`);
  if (!rawHome || !isAbsolute(rawHome)) {
    throw new Error("--dev-home must name one explicit absolute existing DEV home");
  }
  if (!rawModel || !(DEV_CHAT_MODELS as readonly string[]).includes(rawModel)) {
    throw new Error(`--model must be one explicit DEV Web model: ${DEV_CHAT_MODELS.join(", ")}`);
  }
  if (!(["all", "read", "generate"] as const).includes(rawScenario as Scenario)) {
    throw new Error("--scenario must be all, read, or generate");
  }
  const timeoutSeconds = Number(rawTimeout);
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 60 || timeoutSeconds > 1_800) {
    throw new Error("--timeout-seconds must be an integer from 60 through 1800");
  }
  return {
    devHome: resolve(rawHome),
    model: rawModel as DevChatModel,
    scenario: rawScenario as Scenario,
    timeoutMs: timeoutSeconds * 1_000,
    cleanupArtifacts,
  };
}

function realDirectory(path: string, label: string): string {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  const info = lstatSync(path);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a file or symlink: ${path}`);
  }
  return realpathSync(path);
}

function expandedUserPath(value: string): string {
  if (value === "~") return homedir();
  if (value.startsWith("~/") || value.startsWith("~\\")) return join(homedir(), value.slice(2));
  return value;
}

function assertIsolatedDevHome(requestedHome: string): DevProfilePaths {
  const home = realDirectory(requestedHome, "DEV home");
  const configuredProduction = resolve(
    expandedUserPath(process.env.CODEX_CHATGPT_WEB_HOME?.trim() || join(homedir(), ".codex-chatgpt-web")),
  );
  if (existsSync(configuredProduction) && realpathSync(configuredProduction) === home) {
    throw new Error("The explicitly selected DEV home resolves to the configured production home");
  }
  const launcherUserData = join(home, "launcher");
  const paths: DevProfilePaths = {
    home,
    codexHome: join(home, "codex-home"),
    launcherUserData,
    launcherStatePath: join(launcherUserData, "launcher-state.json"),
    descriptorPath: join(home, "runtime", "launcher-browser.json"),
    chatsPath: join(home, "chats"),
    runtimePath: join(home, "runtime", "dev-chat"),
    configPath: join(home, "config.json"),
  };
  if (!existsSync(paths.configPath)) throw new Error(`DEV config is missing: ${paths.configPath}`);
  if (!existsSync(paths.descriptorPath)) throw new Error(`DEV launcher descriptor is missing: ${paths.descriptorPath}`);
  return paths;
}

function bootstrapDevProfileEnvironment(paths: DevProfilePaths): void {
  process.env.CODEX_WEB_GPT_DEV_HOME = paths.home;
  process.env.CODEX_CHATGPT_WEB_HOME = paths.home;
  process.env.CODEX_HOME = paths.codexHome;
}

function crc32(bytes: Buffer): number {
  let value = 0xffffffff;
  for (const byte of bytes) {
    value ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
    }
  }
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const typeBytes = Buffer.from(type, "ascii");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([typeBytes, data])));
  return Buffer.concat([size, typeBytes, data, checksum]);
}

const FONT: Record<string, readonly string[]> = {
  "-": ["00000", "00000", "00000", "11111", "00000", "00000", "00000"],
  "0": ["01110", "10001", "10011", "10101", "11001", "10001", "01110"],
  "1": ["00100", "01100", "00100", "00100", "00100", "00100", "01110"],
  "2": ["01110", "10001", "00001", "00010", "00100", "01000", "11111"],
  "3": ["11110", "00001", "00001", "01110", "00001", "00001", "11110"],
  "4": ["00010", "00110", "01010", "10010", "11111", "00010", "00010"],
  "5": ["11111", "10000", "10000", "11110", "00001", "00001", "11110"],
  "6": ["01110", "10000", "10000", "11110", "10001", "10001", "01110"],
  "7": ["11111", "00001", "00010", "00100", "01000", "01000", "01000"],
  "8": ["01110", "10001", "10001", "01110", "10001", "10001", "01110"],
  "9": ["01110", "10001", "10001", "01111", "00001", "00001", "01110"],
  A: ["01110", "10001", "10001", "11111", "10001", "10001", "10001"],
  B: ["11110", "10001", "10001", "11110", "10001", "10001", "11110"],
  C: ["01111", "10000", "10000", "10000", "10000", "10000", "01111"],
  D: ["11110", "10001", "10001", "10001", "10001", "10001", "11110"],
  E: ["11111", "10000", "10000", "11110", "10000", "10000", "11111"],
  F: ["11111", "10000", "10000", "11110", "10000", "10000", "10000"],
  G: ["01111", "10000", "10000", "10111", "10001", "10001", "01111"],
  I: ["11111", "00100", "00100", "00100", "00100", "00100", "11111"],
  M: ["10001", "11011", "10101", "10101", "10001", "10001", "10001"],
};

function visibleTokenPng(token: string): Buffer {
  const scale = 6;
  const padding = 4;
  const width = (padding * 2 + token.length * 6 - 1) * scale;
  const height = (padding * 2 + 7) * scale;
  const pixels = Buffer.alloc(width * height * 3, 255);
  for (const [characterIndex, character] of [...token].entries()) {
    const glyph = FONT[character];
    if (!glyph) throw new Error(`No fixture glyph for ${JSON.stringify(character)}`);
    for (let y = 0; y < glyph.length; y += 1) {
      for (let x = 0; x < glyph[y]!.length; x += 1) {
        if (glyph[y]![x] !== "1") continue;
        for (let dy = 0; dy < scale; dy += 1) {
          for (let dx = 0; dx < scale; dx += 1) {
            const pixelX = (padding + characterIndex * 6 + x) * scale + dx;
            const pixelY = (padding + y) * scale + dy;
            const offset = (pixelY * width + pixelX) * 3;
            pixels[offset] = 10;
            pixels[offset + 1] = 10;
            pixels[offset + 2] = 10;
          }
        }
      }
    }
  }
  const scanlines: Buffer[] = [];
  for (let y = 0; y < height; y += 1) {
    scanlines.push(Buffer.from([0]), pixels.subarray(y * width * 3, (y + 1) * width * 3));
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(Buffer.concat(scanlines))),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function pdfText(value: string): Buffer {
  const escaped = value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
  const stream = `BT\n/F1 24 Tf\n72 720 Td\n(${escaped}) Tj\nET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`,
  ];
  let body = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(body, "ascii"));
    body += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(body, "ascii");
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) body += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(body, "ascii");
}

function messageText(output: unknown[]): string {
  const parts: string[] = [];
  for (const raw of output) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as { type?: unknown; phase?: unknown; content?: unknown };
    if (item.type !== "message" || item.phase === "commentary" || !Array.isArray(item.content)) continue;
    for (const content of item.content) {
      const block = content as { type?: unknown; text?: unknown };
      if ((block.type === "output_text" || block.type === "text") && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
  }
  return parts.join("");
}

function responseFailure(envelope: ResponsesEnvelope, status: number): string {
  const detail = envelope.error?.message
    ?? envelope.incomplete_details?.message
    ?? envelope.incomplete_details?.reason
    ?? envelope.status
    ?? `HTTP ${status}`;
  const code = [envelope.error?.type, envelope.error?.code].filter(Boolean).join("/");
  return code ? `${detail} (${code})` : String(detail);
}

function turnBody(model: DevChatModel, promptContent: unknown[]): Record<string, unknown> {
  const compactId = () => randomUUID().replaceAll("-", "");
  const threadId = `dev_file_thread_${compactId()}`;
  const turnId = `dev_file_turn_${compactId()}`;
  const cwd = process.cwd();
  const metadata = { turn_id: turnId };
  return {
    model,
    instructions: browserOnlyInstructionsRuntime,
    input: [{
      type: "message",
      id: `msg_dev_file_${compactId()}`,
      role: "user",
      content: promptContent,
      internal_chat_message_metadata_passthrough: metadata,
    }],
    tools: [],
    tool_choice: "none",
    parallel_tool_calls: false,
    reasoning: { summary: "auto" },
    stream: false,
    store: false,
    prompt_cache_key: threadId,
    client_metadata: {
      "x-codex-turn-metadata": JSON.stringify({
        thread_id: threadId,
        turn_id: turnId,
        request_kind: "turn",
        sandbox: "none",
        workspaces: { [cwd]: {} },
      }),
    },
    metadata: { codex_chatgpt_web_dev: true, acceptance: "file-flow" },
  };
}

async function submitTurn(
  body: Record<string, unknown>,
  config: AppConfig,
  adapterFactory: AdapterFactory,
  timeoutMs: number,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`DEV acceptance turn exceeded ${timeoutMs} ms`)), timeoutMs);
  timer.unref?.();
  try {
    const response = await responseRequestRuntime(new Request("http://codex-web-gpt.dev/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    }), config, adapterFactory, { rememberState: false });
    const envelope = await response.json() as ResponsesEnvelope;
    if (!response.ok || envelope.status !== "completed" || !Array.isArray(envelope.output)) {
      throw new Error(`DEV Responses request failed: ${responseFailure(envelope, response.status)}`);
    }
    return messageText(envelope.output);
  } finally {
    clearTimeout(timer);
  }
}

async function runReadbackScenario(
  fixtureRoot: string,
  model: DevChatModel,
  config: AppConfig,
  adapterFactory: AdapterFactory,
  timeoutMs: number,
): Promise<void> {
  const nonce = randomBytes(4).toString("hex").toUpperCase();
  const expected = {
    pdf: `PDF-${nonce}`,
    csv: `CSV-${nonce}`,
    image: `IMG-${nonce}`,
  };
  const fixtures = {
    pdf: join(fixtureRoot, "acceptance.pdf"),
    csv: join(fixtureRoot, "acceptance.csv"),
    image: join(fixtureRoot, "acceptance.png"),
  };
  await Promise.all([
    writeFile(fixtures.pdf, pdfText(expected.pdf), { mode: 0o600 }),
    writeFile(fixtures.csv, `kind,value\nacceptance,${expected.csv}\n`, { mode: 0o600 }),
    writeFile(fixtures.image, visibleTokenPng(expected.image), { mode: 0o600 }),
  ]);
  const [pdf, csv, image] = await Promise.all([
    readFile(fixtures.pdf), readFile(fixtures.csv), readFile(fixtures.image),
  ]);
  const output = await submitTurn(turnBody(model, [
    {
      type: "input_text",
      text: "Read all three attached fixtures. Return the distinct identifier in the PDF text, the CSV value cell, and the visible image pixels. Label them PDF, CSV, and IMAGE. Do not infer or invent a value.",
    },
    { type: "input_file", filename: "acceptance.pdf", file_data: `data:application/pdf;base64,${pdf.toString("base64")}` },
    { type: "input_file", filename: "acceptance.csv", file_data: `data:text/csv;base64,${csv.toString("base64")}` },
    { type: "input_image", image_url: `data:image/png;base64,${image.toString("base64")}`, detail: "high" },
  ]), config, adapterFactory, timeoutMs);
  for (const [kind, value] of Object.entries(expected)) {
    if (!output.includes(value)) {
      throw new Error(`Attachment readback failed: the provider response did not contain the ${kind} byte-only identifier`);
    }
  }
  process.stdout.write("PASS read: PDF, CSV, and image byte-only identifiers returned through the real DEV Responses flow.\n");
}

function artifactRows(text: string): Array<Omit<ArtifactEvidence, "manifestPath" | "manifestSha256">> {
  const pattern = /^- \[([^\]]+)]\(<([^>]+)>\) — ([^,]+), ([0-9]+) bytes, SHA-256 `([a-f0-9]{64})`(?:; source ChatGPT (?:chatgpt\.com|oaiusercontent\.com|chatgpt-blob|chatgpt-sandbox), assistant turn `[^`\r\n]+`)?$/gm;
  return [...text.matchAll(pattern)].map(match => ({
    name: match[1]!,
    path: match[2]!.replaceAll("%3E", ">"),
    mimeType: match[3]!,
    size: Number(match[4]),
    sha256: match[5]!,
  }));
}

function ownedPath(path: string, root: string): boolean {
  const resolvedPath = resolve(path);
  const resolvedRoot = resolve(root);
  return resolvedPath === resolvedRoot || resolvedPath.startsWith(`${resolvedRoot}${sep}`);
}

export async function verifyArtifact(text: string, devHome: string, expectedToken: string): Promise<ArtifactEvidence> {
  const rows = artifactRows(text);
  if (rows.length !== 1) throw new Error(`Expected exactly one verified generated artifact, received ${rows.length}`);
  const row = rows[0]!;
  const artifactRoot = join(devHome, "artifacts");
  if (!isAbsolute(row.path) || !ownedPath(row.path, artifactRoot)) {
    throw new Error("Generated artifact path is outside the explicit DEV artifact root");
  }
  if (!row.name.toLowerCase().endsWith(".csv") || row.mimeType !== "text/csv") {
    throw new Error(`Generated artifact is not the requested CSV: ${row.name} (${row.mimeType})`);
  }
  const bytes = await readFile(row.path);
  const measuredHash = createHash("sha256").update(bytes).digest("hex");
  if (bytes.length !== row.size || measuredHash !== row.sha256) {
    throw new Error("Generated artifact bytes do not match the size/hash appended by the real adapter");
  }
  const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  if (!content.includes(expectedToken) || !/item\s*,\s*value/i.test(content)) {
    throw new Error("Generated CSV bytes do not contain the requested schema and acceptance value");
  }
  const manifestPath = join(dirname(row.path), "manifest.json");
  const manifestBytes = await readFile(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString("utf8")) as {
    version?: unknown;
    artifacts?: Array<Record<string, unknown>>;
  };
  const matching = manifest.artifacts?.filter(artifact => artifact.path === row.path) ?? [];
  if (manifest.version !== 1 || matching.length !== 1) {
    throw new Error("Generated artifact has no unique version-1 manifest record");
  }
  const record = matching[0]!;
  if (record.name !== row.name || record.mimeType !== row.mimeType || record.size !== row.size
    || record.sha256 !== row.sha256 || (record.source as { provider?: unknown } | undefined)?.provider !== "chatgpt.com") {
    throw new Error("Generated artifact manifest does not match the actual local artifact bytes");
  }
  return {
    ...row,
    manifestPath,
    manifestSha256: createHash("sha256").update(manifestBytes).digest("hex"),
  };
}

async function runGenerateScenario(
  model: DevChatModel,
  config: AppConfig,
  adapterFactory: AdapterFactory,
  devHome: string,
  timeoutMs: number,
  cleanupArtifacts: boolean,
): Promise<void> {
  const expectedToken = `ARTIFACT-${randomBytes(6).toString("hex").toUpperCase()}`;
  let evidence: ArtifactEvidence | undefined;
  try {
    const output = await submitTurn(turnBody(model, [{
      type: "input_text",
      text: `Create one real downloadable CSV artifact named dev-file-acceptance.csv with header item,value and one data row acceptance,${expectedToken}. Use ChatGPT's file-generation capability so the response contains an actual file control.`,
    }]), config, adapterFactory, timeoutMs);
    // Preserve this synthetic test receipt before validation so verifier-only corrections
    // can be checked offline without another provider submission.
    await writeFile(join(devHome, 'runtime', 'dev-file-acceptance-receipt.json'),
      JSON.stringify({ output, expectedToken }) + '\n', { mode: 0o600 });
    evidence = await verifyArtifact(output, devHome, expectedToken);
    process.stdout.write(
      `PASS generate: ${evidence.path}\n`
      + `  bytes=${evidence.size} sha256=${evidence.sha256}\n`
      + `  manifest=${evidence.manifestPath} manifest_sha256=${evidence.manifestSha256}\n`,
    );
  } finally {
    if (evidence && cleanupArtifacts) {
      await rm(dirname(evidence.path), { recursive: true, force: true });
      process.stdout.write("  cleanup=removed verified task-owned artifact directory\n");
    }
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (!options) return;
  const paths = assertIsolatedDevHome(options.devHome);
  // No NEKODEX runtime module is loaded before these explicit, fail-closed DEV bindings exist.
  // Several runtime modules derive capacity/history/artifact roots at import time.
  bootstrapDevProfileEnvironment(paths);
  const [
    workerModule,
    modelModule,
    configModule,
    driverModule,
    profileModule,
    transportModule,
    constantsModule,
    launcherHostModule,
    serverModule,
  ] = await Promise.all([
    import("../src/adapters/chatgpt-web/browser-worker"),
    import("../src/chatgpt-web-models"),
    import("../src/config"),
    import("../src/dev-chat/driver"),
    import("../src/dev-chat/profile"),
    import("../src/dev-chat/transport"),
    import("../src/dev-chat/constants"),
    import("../src/launcher-browser-host"),
    import("../src/server"),
  ]);
  const activatedPaths = profileModule.activateDevProfileEnvironment(paths);
  if (activatedPaths.home !== paths.home || configModule.getConfigPath() !== paths.configPath) {
    throw new Error("NEKODEX runtime did not retain the explicitly bootstrapped DEV profile");
  }
  browserOnlyInstructionsRuntime = driverModule.DEV_CHAT_BROWSER_ONLY_INSTRUCTIONS;
  responseRequestRuntime = serverModule.responseRequest;
  const config = configModule.loadConfig();
  if (config.purpose !== constantsModule.DEV_CONFIG_PURPOSE) {
    throw new Error("The selected config is not explicitly marked as an isolated dev-harness config");
  }
  if (config.browserHost !== "launcher" || resolve(config.browserHostDescriptorPath ?? "") !== paths.descriptorPath) {
    throw new Error("The selected DEV config is not bound to its own explicit launcher descriptor");
  }
  modelModule.requireChatGptWebModelRoute(options.model, config);
  if (config.browserInteractionMode === "manual") {
    await launcherHostModule.inspectLauncherBrowserHostLiveness(paths.descriptorPath, {
      expectedProfile: constantsModule.DEV_LAUNCHER_PROFILE,
    });
  } else {
    await launcherHostModule.inspectLauncherBrowserHost(paths.descriptorPath, {
      expectedProfile: constantsModule.DEV_LAUNCHER_PROFILE,
    });
  }

  const fixtureRoot = await mkdtemp(join(tmpdir(), "nekodex-dev-file-flow-"));
  let transport: DevChatTransport | undefined;
  let runtime: ReturnType<typeof driverModule.createLauncherDevAdapter> | undefined;
  let primaryFailure: unknown;
  try {
    transport = config.mode === "full"
      ? await transportModule.startDevChatTransport(config, paths.runtimePath)
      : undefined;
    runtime = driverModule.createLauncherDevAdapter(transport?.config ?? config, paths.runtimePath, {
      ...(transport ? { broker: transport.broker } : {}),
    });
    process.stdout.write(`DEV file acceptance: model=${options.model} scenario=${options.scenario} timeout=${options.timeoutMs / 1_000}s\n`);
    if (options.scenario === "all" || options.scenario === "read") {
      await runReadbackScenario(fixtureRoot, options.model, transport?.config ?? config, runtime.adapterFactory, options.timeoutMs);
    }
    if (options.scenario === "all" || options.scenario === "generate") {
      await runGenerateScenario(
        options.model,
        transport?.config ?? config,
        runtime.adapterFactory,
        paths.home,
        options.timeoutMs,
        options.cleanupArtifacts,
      );
    }
  } catch (error) {
    primaryFailure = error;
    throw error;
  } finally {
    const cleanup = await Promise.allSettled([
      rm(fixtureRoot, { recursive: true, force: true }),
      workerModule.closeChatGptBrowserWorkers(),
      transport?.close() ?? Promise.resolve(),
    ]);
    const failures = cleanup.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failures.length > 0) {
      throw new AggregateError(
        [...(primaryFailure ? [primaryFailure] : []), ...failures.map(result => result.reason)],
        primaryFailure ? "DEV acceptance failed and cleanup also failed" : "DEV acceptance cleanup failed",
      );
    }
  }
}

if (import.meta.main) await main();
