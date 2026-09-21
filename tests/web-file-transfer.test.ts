import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { Readable } from "node:stream";
import { expect, spyOn, test } from "bun:test";
import { chatGptDocumentFilePayloads, chatGptPromptFilePayloads } from "../src/adapters/chatgpt-web/browser-worker";
import {
  acquireChatGptResponseArtifacts,
  chatGptArtifactMarkdown,
  writeAllArtifactBytes,
} from "../src/adapters/chatgpt-web/artifacts";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import {
  chatGptManualAttachmentInstructions,
  materializeChatGptManualAttachments,
} from "../src/adapters/chatgpt-web/manual-attachments";
import { parseRequest } from "../src/responses/parser";

const csv = Buffer.from("id,name\n1,unique-neko-file\n", "utf8");

function storedZip(entries: Array<{ name: string; data?: Buffer }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let localOffset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const data = entry.data ?? Buffer.alloc(0);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(localOffset, 42);
    centrals.push(central, name);
    localOffset += local.length + name.length + data.length;
  }
  const centralBytes = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBytes.length, 12);
  eocd.writeUInt32LE(localOffset, 16);
  return Buffer.concat([...locals, centralBytes, eocd]);
}

function artifactSurface(name: string, bytes: Buffer, options: {
  pageUrl?: string;
  downloadUrl?: string;
  createReadStream?: () => Promise<Readable>;
  onCancel?: () => void;
  click?: () => Promise<void>;
  hover?: () => Promise<void>;
} = {}) {
  const card = { hover: options.hover ?? (async () => {}) };
  const control = {
    evaluate: async () => ({ label: name, depth: 1 }),
    locator: () => card,
    click: options.click ?? (async () => {}),
  };
  const controls = { filter: () => controls, count: async () => 1, nth: () => control };
  return {
    responseTurn: {
      getByRole: (role: string, query: { name: string; exact: boolean }) => {
        expect({ role, query }).toEqual({ role: "button", query: { name: "Download file", exact: true } });
        return controls;
      },
    },
    page: {
      url: () => options.pageUrl ?? "https://chatgpt.com/c/owned-task",
      waitForEvent: async () => ({
        suggestedFilename: () => name,
        url: () => options.downloadUrl ?? `https://chatgpt.com/backend-api/files/${encodeURIComponent(name)}`,
        cancel: async () => { options.onCancel?.(); },
        failure: async () => null,
        createReadStream: options.createReadStream ?? (async () => Readable.from([bytes])),
      }),
    },
  };
}

test("inline CSV bytes survive Responses parsing, prompt projection, and composer payload preparation", () => {
  const parsed = parseRequest({
    model: CHATGPT_WEB_MODEL_ID,
    input: [{
      role: "user",
      content: [
        { type: "input_text", text: "Read the unique value in this CSV." },
        { type: "input_file", filename: "evidence.csv", file_data: `data:text/csv;base64,${csv.toString("base64")}` },
      ],
    }],
  });
  const file = Array.isArray(parsed.context.messages[0]?.content)
    ? parsed.context.messages[0]!.content.find(part => part.type === "file")
    : undefined;
  expect(file).toEqual({
    type: "file",
    name: "evidence.csv",
    mimeType: "text/csv",
    base64: csv.toString("base64"),
    size: csv.length,
    sha256: createHash("sha256").update(csv).digest("hex"),
    source: "inline",
  });

  const compiled = compileChatGptWebPrompt(parsed, {
    localToolsEnabled: false,
    solAvailable: true,
    proAvailable: false,
  });
  expect(compiled.files).toHaveLength(1);
  expect(compiled.text).toContain("file_attachment");
  expect(compiled.text).toContain("evidence.csv");
  expect(compiled.text).toContain(file!.sha256);
  const payloads = chatGptPromptFilePayloads(compiled);
  expect(payloads.map(payload => ({ name: payload.name, mimeType: payload.mimeType, text: payload.buffer.toString("utf8") })))
    .toEqual([{ name: "evidence.csv", mimeType: "text/csv", text: csv.toString("utf8") }]);
});

test("file_id resolves only through an explicit authority and revalidates bytes", () => {
  const body = {
    model: "chatgpt-web/medium",
    input: [{ role: "user", content: [{ type: "input_file", file_id: "owned-1", filename: "owned.txt" }] }],
  };
  expect(() => parseRequest(body)).toThrow("no authorized file resolver");
  const parsed = parseRequest(body, {
    resolveFileId: id => id === "owned-1"
      ? { name: "owned.txt", mimeType: "text/plain", data: Buffer.from("authorized bytes", "utf8") }
      : undefined,
  });
  const part = Array.isArray(parsed.context.messages[0]?.content) ? parsed.context.messages[0]!.content[0] : undefined;
  expect(part).toMatchObject({ type: "file", name: "owned.txt", source: "authorized_file_id", fileId: "owned-1" });
});

test("authorized image file_id becomes real inline image bytes", () => {
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64");
  const parsed = parseRequest({
    model: CHATGPT_WEB_MODEL_ID,
    input: [{ role: "user", content: [{ type: "input_image", file_id: "owned-image", detail: "original" }] }],
  }, {
    resolveFileId: id => id === "owned-image"
      ? { name: "owned.png", mimeType: "image/png", data: png }
      : undefined,
  });
  expect(parsed.context.messages[0]?.content).toEqual([{
    type: "image",
    imageUrl: `data:image/png;base64,${png.toString("base64")}`,
    detail: "high",
  }]);
});

test("PDF, UTF-8 text, and image documents preserve exact bytes for composer upload", () => {
  const fixtures = [
    { name: "brief.pdf", mime: "application/pdf", bytes: Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n", "ascii") },
    { name: "notes.txt", mime: "text/plain", bytes: Buffer.from("exact UTF-8 text: кот", "utf8") },
    {
      name: "pixel.png",
      mime: "image/png",
      bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==", "base64"),
    },
  ];
  for (const fixture of fixtures) {
    const parsed = parseRequest({
      model: CHATGPT_WEB_MODEL_ID,
      input: [{ role: "user", content: [{
        type: "input_file",
        filename: fixture.name,
        file_data: `data:${fixture.mime};base64,${fixture.bytes.toString("base64")}`,
      }] }],
    });
    const compiled = compileChatGptWebPrompt(parsed, {
      localToolsEnabled: false, solAvailable: true, proAvailable: false,
    });
    const payload = chatGptPromptFilePayloads(compiled)[0]!;
    expect({ name: payload.name, mimeType: payload.mimeType, bytes: payload.buffer })
      .toEqual({ name: fixture.name, mimeType: fixture.mime, bytes: fixture.bytes });
  }
});

test("bad names, MIME conflicts, signatures, and payload mutation fail before composer delivery", () => {
  const request = (filename: string, mimeType: string, bytes: Buffer) => () => parseRequest({
    model: "chatgpt-web/medium",
    input: [{ role: "user", content: [{
      type: "input_file", filename, file_data: `data:${mimeType};base64,${bytes.toString("base64")}`,
    }] }],
  });
  expect(request("../escape.csv", "text/csv", csv)).toThrow("plain filename");
  expect(request("wrong.pdf", "text/csv", csv)).toThrow("conflicts");
  expect(request("fake.pdf", "application/pdf", csv)).toThrow("do not match");

  const sha256 = createHash("sha256").update(csv).digest("hex");
  expect(() => chatGptDocumentFilePayloads([{
    ref: "codex-input-file-1", name: "evidence.csv", mimeType: "text/csv",
    base64: Buffer.from("changed", "utf8").toString("base64"), size: csv.length, sha256, source: "inline",
  }])).toThrow(/size does not match|bytes do not match/);

  const valid = {
    ref: "codex-input-file-1", name: "evidence.csv", mimeType: "text/csv",
    base64: csv.toString("base64"), size: csv.length, sha256, source: "inline" as const,
  };
  expect(() => chatGptDocumentFilePayloads([valid, { ...valid, ref: "codex-input-file-2" }]))
    .toThrow("duplicate filename or attachment reference");
});

test("verified artifact metadata renders a usable absolute local link", () => {
  const markdown = chatGptArtifactMarkdown([{
    name: "result.csv",
    path: "/tmp/nekodex artifact/result--1234.csv",
    mimeType: "text/csv",
    size: 42,
    sha256: "a".repeat(64),
    source: {
      provider: "chatgpt.com", traceId: "trace_123456", assistantTurnId: "turn_123456",
      downloadAuthority: "chatgpt.com",
    },
  }]);
  expect(markdown).toContain("[result.csv](</tmp/nekodex artifact/result--1234.csv>)");
  expect(markdown).toContain("42 bytes");
  expect(markdown).toContain("a".repeat(64));
});

test("a bound response file control is acquired once through real bytes and a verified manifest", async () => {
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = await mkdtemp(`${tmpdir()}/nekodex-file-transfer-`);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  const bytes = Buffer.from("id,value\n1,artifact-proof\n", "utf8");
  let downloadWaits = 0;
  let clicks = 0;
  const control = {
    evaluate: async () => ({ label: "result.csv", depth: 1 }),
    locator: () => ({ hover: async () => {} }),
    click: async () => { clicks += 1; },
  };
  const controls = {
    filter: () => controls,
    count: async () => 1,
    nth: () => control,
  };
  const responseTurn = { getByRole: () => controls };
  const page = {
    url: () => "https://chatgpt.com/c/owned-task",
    waitForEvent: async (event: string) => {
      expect(event).toBe("download");
      downloadWaits += 1;
      return {
        suggestedFilename: () => "result.csv",
        url: () => "https://chatgpt.com/backend-api/files/result.csv",
        cancel: async () => {},
        failure: async () => null,
        createReadStream: async () => Readable.from([bytes]),
      };
    },
  };
  try {
    const first = await acquireChatGptResponseArtifacts(
      page as never, responseTurn as never, "trace_123456", "turn_123456",
    );
    expect(first).toHaveLength(1);
    expect(await readFile(first[0]!.path)).toEqual(bytes);
    expect(first[0]).toMatchObject({
      name: "result.csv",
      mimeType: "text/csv",
      size: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      source: {
        provider: "chatgpt.com", traceId: "trace_123456", assistantTurnId: "turn_123456",
        downloadAuthority: "chatgpt.com",
      },
    });
    const replay = await acquireChatGptResponseArtifacts(
      page as never, responseTurn as never, "trace_123456", "turn_123456",
    );
    expect(replay).toEqual(first);
    expect({ downloadWaits, clicks }).toEqual({ downloadWaits: 1, clicks: 1 });
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("artifact file writes persist every byte across partial write results", async () => {
  const source = Buffer.from("partial-write-proof", "utf8");
  const written: Buffer[] = [];
  await writeAllArtifactBytes({
    write: async (buffer: Uint8Array, offset: number, length: number) => {
      const count = Math.min(2, length);
      written.push(Buffer.from(buffer).subarray(offset, offset + count));
      return { bytesWritten: count, buffer };
    },
  } as never, source);
  expect(Buffer.concat(written)).toEqual(source);
});

test("generated ZIP and XLSX outputs are accepted only as safe inert containers", async () => {
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = await mkdtemp(`${tmpdir()}/nekodex-office-artifacts-`);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try {
    const fixtures = [
      { name: "bundle.zip", bytes: storedZip([{ name: "reports/result.csv", data: csv }]) },
      { name: "workbook.xlsx", bytes: storedZip([
        { name: "[Content_Types].xml" }, { name: "_rels/.rels" }, { name: "xl/workbook.xml" },
      ]) },
    ];
    for (const [index, fixture] of fixtures.entries()) {
      const surface = artifactSurface(fixture.name, fixture.bytes);
      const result = await acquireChatGptResponseArtifacts(
        surface.page as never, surface.responseTurn as never, `office_trace_${index}`, `office_turn_${index}`,
      );
      expect(Buffer.compare(await readFile(result[0]!.path), fixture.bytes)).toBe(0);
      expect(result[0]!.mimeType).toBe(index === 0
        ? "application/zip"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    }

    let cancelled = 0;
    const unsafe = artifactSurface("unsafe.zip", storedZip([{ name: "../escape.txt" }]), {
      onCancel: () => { cancelled += 1; },
    });
    await expect(acquireChatGptResponseArtifacts(
      unsafe.page as never, unsafe.responseTurn as never, "unsafe_trace", "unsafe_turn",
    )).rejects.toThrow("unsafe entry name");
    expect(cancelled).toBeGreaterThan(0);
    expect((await readdir(`${home}/artifacts/unsafe_trace`)).some(name => name.endsWith(".partial"))).toBeFalse();
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("artifact transaction deadline starts before Playwright waits for completed download bytes", async () => {
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = await mkdtemp(`${tmpdir()}/nekodex-artifact-deadline-`);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  let cancelled = 0;
  const surface = artifactSurface("slow.csv", csv, {
    createReadStream: () => new Promise<Readable>(() => {}),
    onCancel: () => { cancelled += 1; },
  });
  try {
    await expect(acquireChatGptResponseArtifacts(
      surface.page as never, surface.responseTurn as never, "slow_trace", "slow_turn", undefined,
      { transactionTimeoutMs: 15 },
    )).rejects.toThrow("download transaction exceeded");
    expect(cancelled).toBeGreaterThan(0);
    expect((await readdir(`${home}/artifacts/slow_trace`)).some(name => name.endsWith(".partial"))).toBeFalse();
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("launcher network receipt is validated and promoted without a Playwright download stream", async () => {
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = await mkdtemp(`${tmpdir()}/nekodex-native-artifact-`);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  const traceId = "native_trace";
  const assistantTurnId = "native_turn";
  const leaseId = `artifact_${"c".repeat(32)}`;
  const partialPath = `${home}/artifacts/${traceId}/.network-test.partial`;
  let streamCalled = false;
  const stages: string[] = [];
  const surface = artifactSurface("native.csv", csv, {
    createReadStream: async () => { streamCalled = true; throw new Error("Playwright stream must not be used"); },
    hover: async () => { stages.push("hover"); },
    click: () => { stages.push("click"); return new Promise<void>(() => {}); },
  });
  try {
    const result = await acquireChatGptResponseArtifacts(
      surface.page as never,
      surface.responseTurn as never,
      traceId,
      assistantTurnId,
      undefined,
      {
        taskDirectory: `${home}/artifacts/${traceId}`,
        networkGuard: {
          async register() {
            stages.push("register");
            await writeFile(partialPath, csv, { mode: 0o600 });
            return { leaseId };
          },
          async wait() {
            return {
              leaseId,
              traceId,
              assistantTurnId,
              filename: "native.csv",
              partialPath,
              receivedBytes: csv.length,
              downloadAuthority: "chatgpt.com",
            };
          },
          async cancel() {},
        },
      },
    );
    expect(streamCalled).toBeFalse();
    expect(stages).toEqual(["hover", "register", "click"]);
    expect(Buffer.compare(await readFile(result[0]!.path), csv)).toBe(0);
    expect(result[0]).toMatchObject({ name: "native.csv", size: csv.length });
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("native artifact failure reports host-wait and click stages without URL details", async () => {
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = await mkdtemp(`${tmpdir()}/nekodex-native-artifact-stage-`);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  const warnings: string[] = [];
  const warning = spyOn(console, "warn").mockImplementation(value => { warnings.push(String(value)); });
  const surface = artifactSurface("stage.csv", csv, {
    click: async () => { const error = new Error("locator.click: Timeout 10000ms exceeded at https://secret.invalid"); error.name = "TimeoutError"; throw error; },
  });
  try {
    await expect(acquireChatGptResponseArtifacts(
      surface.page as never,
      surface.responseTurn as never,
      "stage_trace",
      "stage_turn",
      undefined,
      {
        taskDirectory: `${home}/artifacts/stage_trace`,
        networkGuard: {
          async register() { return { leaseId: `artifact_${"e".repeat(32)}` }; },
          async wait() { throw new Error("Artifact network transfer exceeded its deadline"); },
          async cancel() {},
        },
      },
    )).rejects.toThrow("artifact_host_wait_deadline");
    expect(warnings).toEqual([
      "[chatgpt-web] ChatGPT artifact acquisition failed at click [artifact_click_timeout]",
    ]);
    expect(warnings.join(" ")).not.toContain("secret.invalid");
  } finally {
    warning.mockRestore();
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("post-download size rejection cancels ownership and removes every partial file", async () => {
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = await mkdtemp(`${tmpdir()}/nekodex-artifact-size-`);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  let cancelled = 0;
  const surface = artifactSurface("large.csv", csv, { onCancel: () => { cancelled += 1; } });
  try {
    await expect(acquireChatGptResponseArtifacts(
      surface.page as never, surface.responseTurn as never, "large_trace", "large_turn", undefined,
      { maxAcceptedBytes: 4 },
    )).rejects.toThrow("post-download acceptance limit");
    expect(cancelled).toBeGreaterThan(0);
    expect((await readdir(`${home}/artifacts/large_trace`)).some(name => name.endsWith(".partial"))).toBeFalse();
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("artifact acquisition rejects untrusted page and download origins", async () => {
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = await mkdtemp(`${tmpdir()}/nekodex-artifact-origin-`);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try {
    const foreignPage = artifactSurface("result.csv", csv, { pageUrl: "https://example.com/task" });
    await expect(acquireChatGptResponseArtifacts(
      foreignPage.page as never, foreignPage.responseTurn as never, "origin_trace", "origin_turn",
    )).rejects.toThrow("untrusted bound page origin");

    let cancelled = 0;
    const foreignDownload = artifactSurface("result.csv", csv, {
      downloadUrl: "https://example.com/result.csv",
      onCancel: () => { cancelled += 1; },
    });
    await expect(acquireChatGptResponseArtifacts(
      foreignDownload.page as never, foreignDownload.responseTurn as never, "download_trace", "download_turn",
    )).rejects.toThrow("download origin");
    expect(cancelled).toBeGreaterThan(0);
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("verified manifests reject symlinked files and oversized metadata", async () => {
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = await mkdtemp(`${tmpdir()}/nekodex-artifact-manifest-`);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try {
    const surface = artifactSurface("result.csv", csv);
    const first = await acquireChatGptResponseArtifacts(
      surface.page as never, surface.responseTurn as never, "manifest_trace", "manifest_turn",
    );
    const external = `${home}/external.csv`;
    await writeFile(external, csv);
    await rm(first[0]!.path);
    await symlink(external, first[0]!.path);
    await expect(acquireChatGptResponseArtifacts(
      surface.page as never, surface.responseTurn as never, "manifest_trace", "manifest_turn",
    )).rejects.toThrow("non-owned or changed file");

    const secondSurface = artifactSurface("second.csv", csv);
    await acquireChatGptResponseArtifacts(
      secondSurface.page as never, secondSurface.responseTurn as never, "oversize_trace", "oversize_turn",
    );
    await writeFile(`${home}/artifacts/oversize_trace/manifest.json`, "x".repeat(1024 * 1024 + 1));
    await expect(acquireChatGptResponseArtifacts(
      secondSurface.page as never, secondSurface.responseTurn as never, "oversize_trace", "oversize_turn",
    )).rejects.toThrow("manifest exceeds the 1 MB limit");
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});

test("Manual mode materializes exact local files and requires explicit attachment confirmation", async () => {
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const home = await mkdtemp(`${tmpdir()}/nekodex-manual-files-`);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try {
    const parsed = parseRequest({
      model: CHATGPT_WEB_MODEL_ID,
      input: [{ role: "user", content: [{
        type: "input_file", filename: "manual.csv", file_data: `data:text/csv;base64,${csv.toString("base64")}`,
      }] }],
    });
    const compiled = compileChatGptWebPrompt(
      parsed,
      { localToolsEnabled: true, solAvailable: true, proAvailable: false },
      "turn_12345678901234567890123456789012",
      { manualControl: true },
    );
    const files = await materializeChatGptManualAttachments("trace_manual_123", compiled);
    expect(files).toHaveLength(1);
    expect(await readFile(files[0]!.path)).toEqual(csv);
    const instructions = chatGptManualAttachmentInstructions(files);
    expect(instructions).toContain("before confirming Sent");
    expect(instructions).toContain(files[0]!.path);
    expect(instructions).toContain(files[0]!.sha256);
    expect(instructions).toContain("mark the Manual turn failed");
  } finally {
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    await rm(home, { recursive: true, force: true });
  }
});
