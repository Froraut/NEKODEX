import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import { responseRequest } from "../src/server";
import type { ProviderAdapter } from "../src/adapters/base";

const onePixelPng =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

function imageRequest(model: string, imageUrl: string): Request {
  return new Request("http://127.0.0.1:17841/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model,
      stream: false,
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "Describe" }, { type: "input_image", image_url: imageUrl }],
      }],
    }),
  });
}

test("Web image boundary rejects unsupported attachments before adapter creation and preserves inline images", async () => {
  const automatic = defaultConfig("browser-only");
  let adapters = 0;
  const adapterFactory: () => ProviderAdapter = () => {
    adapters += 1;
    return {
      name: "web-image-boundary-stub",
      runTurn: async (_parsed, _incoming, emit) => {
        emit({ type: "error", message: "stub turn ended" });
      },
    };
  };

  for (const [url, message] of [
    ["https://example.com/cat.png", "must be an inline base64 data URL"],
    ["data:image/bmp;base64,Qk0=", "unsupported media type: image/bmp"],
  ]) {
    const response = await responseRequest(imageRequest("chatgpt-web/light", url), automatic, adapterFactory);
    expect(response.status).toBe(400);
    expect((await response.json()).error.message).toContain(message);
    expect(adapters).toBe(0);
  }

  const validAutomatic = await responseRequest(imageRequest("chatgpt-web/light", onePixelPng), automatic, adapterFactory);
  expect(validAutomatic.status).toBe(200);
  expect(adapters).toBe(1);

  const manual = { ...defaultConfig("browser-only"), browserInteractionMode: "manual" as const };
  const validManual = await responseRequest(imageRequest("chatgpt-web/zero-risk", onePixelPng), manual, adapterFactory);
  expect(validManual.status).toBe(200);
  expect(adapters).toBe(2);
});
