import { expect, test } from "bun:test";
import { assertReadmeDownloads } from "../scripts/readme-downloads";

test("release downloads follow the fork version and macOS artifact names", () => {
  const options = {
    version: "5.2.0-nekodex.3", repository: "Froraut/NEKODEX",
    dmgName: "NEKODEX-${version}-mac-${arch}.${ext}",
    archiveName: "codex-web-gpt-${version}-${os}-${arch}.${ext}",
  };
  const readme = ["arm64", "x64"].map(arch =>
    `[Download](https://github.com/Froraut/NEKODEX/releases/download/v${options.version}/NEKODEX-${options.version}-mac-${arch}.dmg)`
  ).join("\n");
  expect(() => assertReadmeDownloads("README.md", readme, options)).not.toThrow();
  expect(() => assertReadmeDownloads("README.md", readme.replaceAll("nekodex.3", "nekodex.2"), options)).toThrow("outdated");
  expect(() => assertReadmeDownloads("README.ko.md", readme.replaceAll("Froraut/NEKODEX", "miuuyy/codex-chatgpt-web"), options)).toThrow("outdated");
  expect(() => assertReadmeDownloads("README.md", readme.replaceAll("NEKODEX-5", "codex-web-gpt-5"), options)).toThrow("unsupported");
});
