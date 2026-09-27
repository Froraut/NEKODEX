import { loadLauncherOwnedConfig } from "./pro-model-config";
import {
  parseChatGptWebCompactionModel,
  type ChatGptWebCompactionModel,
} from "./chatgpt-web-compaction-policy";
import { saveConfig } from "./config";

export async function runCompactionModelConfigCommand(args: string[]): Promise<void> {
  const [action, rawModel, ...rest] = args;
  if (action !== "compaction-model" || !rawModel || rest.length > 1) {
    throw new Error(
      "Config command must be: config compaction-model <follow|extra-high|5.6-pro> --launcher-control",
    );
  }
  if (rest[0] !== "--launcher-control") {
    throw new Error("Compaction model must be changed through NEKODEX Settings");
  }

  let model: ChatGptWebCompactionModel | undefined;
  if (rawModel !== "follow") {
    if (rawModel === "5.5-pro") throw new Error("Select a current summary model in NEKODEX Settings");
    try {
      model = parseChatGptWebCompactionModel(rawModel);
    } catch {
      throw new Error("Invalid compaction model; choose follow, extra-high, or 5.6-pro");
    }
  }

  const { config, snapshot } = await loadLauncherOwnedConfig("compaction model configuration");

  // The daemon samples this value when the next eligible compaction starts.
  if (model === undefined) delete config.compactionModel;
  else config.compactionModel = model;
  saveConfig(config, snapshot);
  process.stdout.write(`${JSON.stringify({ compactionModel: model ?? null })}\n`);
}
