import { authorizeLauncherControl } from "./pro-model-config";
import { assertServiceIdle } from "./service";
import { resolve } from "node:path";
import {
  parseChatGptWebCompactionModel,
  type ChatGptWebCompactionModel,
} from "./chatgpt-web-compaction-policy";
import { loadConfigWithSnapshot, saveConfig } from "./config";

export async function runCompactionModelConfigCommand(args: string[]): Promise<void> {
  const [action, rawModel, ...rest] = args;
  if (action !== "compaction-model" || !rawModel || rest.length > 1) {
    throw new Error(
      "Config command must be: config compaction-model <follow|extra-high|5.6-pro|5.5-pro> --launcher-control",
    );
  }
  if (rest[0] !== "--launcher-control") {
    throw new Error("Compaction model must be changed through NEKODEX Settings");
  }

  let model: ChatGptWebCompactionModel | undefined;
  if (rawModel !== "follow") {
    try {
      model = parseChatGptWebCompactionModel(rawModel);
    } catch {
      throw new Error("Invalid compaction model; choose follow, extra-high, 5.6-pro, or 5.5-pro");
    }
  }

  const authorizedDescriptorPath = authorizeLauncherControl("compaction model configuration");
  const { config, snapshot } = loadConfigWithSnapshot();
  if (config.browserHost !== "launcher" || !config.browserHostDescriptorPath
    || resolve(config.browserHostDescriptorPath) !== resolve(authorizedDescriptorPath)) {
    throw new Error("Launcher authorization does not own this configuration");
  }

  if (config.purpose !== "dev-harness") await assertServiceIdle(config);

  // The daemon samples this value when the next eligible compaction starts.
  if (model === undefined) delete config.compactionModel;
  else config.compactionModel = model;
  saveConfig(config, snapshot);
  process.stdout.write(`${JSON.stringify({ compactionModel: model ?? null })}\n`);
}
