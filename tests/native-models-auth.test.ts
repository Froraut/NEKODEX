import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import { modelsRequest } from "../src/server";

type ModelCatalogFailure = Parameters<NonNullable<Parameters<typeof modelsRequest>[4]>>[0];

test("native model discovery fails closed with 401 and never contacts ChatGPT without the incoming Bearer", async () => {
  for (const authorization of [undefined, "", "Bearer ", "Basic codex-oauth-token"]) {
    let upstreamCalls = 0;
    let failure: ModelCatalogFailure | undefined;
    const request = new Request("http://127.0.0.1:17841/v1/models", {
      headers: authorization === undefined ? {} : { authorization },
    });
    const response = await modelsRequest(
      request,
      defaultConfig("full"),
      async () => { upstreamCalls += 1; return new Response("{}"); },
      undefined,
      value => { failure = value; },
    );
    expect(response.status).toBe(401);
    expect((await response.json()).error).toMatchObject({
      type: "authentication_error",
      message: "Native Codex passthrough requires the incoming Bearer authorization",
    });
    expect(upstreamCalls).toBe(0);
    expect(failure).toMatchObject({ stage: "request" });
  }
});
