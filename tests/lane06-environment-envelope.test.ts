import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { extractChatGptTurnEnvironment, MissingTrustedCodexEnvironmentError } from "../src/adapters/chatgpt-web/environment";
import { parseEnvironmentEnvelope } from "../src/adapters/chatgpt-web/environment-envelope";
import type { CodexParsedRequest } from "../src/types";

function legacyRequest(literalPath: string): CodexParsedRequest {
  const encodedPath = literalPath.replaceAll("&", "&amp;");
  const xml = `<environment_context><environments>
    <environment><cwd>/other</cwd></environment>
    <environment><cwd> ${encodedPath} </cwd></environment>
  </environments><workspace_roots><root>${encodedPath}</root></workspace_roots>
  <sandbox_mode>workspace-write</sandbox_mode></environment_context>`;
  return {
    modelId: "gpt-6-astra", stream: true,
    context: { messages: [{ role: "user", content: "Inspect", timestamp: 1 }] },
    options: {},
    _rawBody: {
      client_metadata: { "x-codex-turn-metadata": JSON.stringify({
        thread_id: "thread_lane06", turn_id: "turn_lane06", sandbox: "workspace-write",
        workspaces: { [literalPath]: {} },
      }) },
      input: [
        { id: "environment", type: "message", role: "user", content: [{ type: "input_text", text: xml }] },
        { id: "instruction", type: "message", role: "user", content: [{ type: "input_text", text: "Inspect" }] },
      ],
    },
  };
}

for (const name of ["A&B", "A&amp;B", "A&quot;B"]) {
  test(`lane06 legacy cwd decodes XML once and preserves literal metadata ${name}`, () => {
    const path = resolve("/work", name);
    expect(extractChatGptTurnEnvironment(legacyRequest(path))).toEqual({
      cwd: path, roots: [path], writableRoots: [path],
      sandboxPolicy: { type: "workspaceWrite", writableRoots: [path], networkAccess: false },
      tools: [],
    });
  });
}

test("lane06 syntax facade preserves missing versus invalid error identity", () => {
  expect(() => parseEnvironmentEnvelope("<sandbox_mode>read-only</sandbox_mode>"))
    .toThrow(MissingTrustedCodexEnvironmentError);
  let failure: unknown;
  try {
    parseEnvironmentEnvelope("<cwd>relative</cwd><sandbox_mode>read-only</sandbox_mode>");
  } catch (error) { failure = error; }
  expect(failure).toBeInstanceOf(Error);
  expect(failure).not.toBeInstanceOf(MissingTrustedCodexEnvironmentError);
  expect((failure as Error).message).toContain("must contain absolute paths");
});
