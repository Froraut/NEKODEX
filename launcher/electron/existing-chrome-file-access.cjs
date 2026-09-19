const fs = require("node:fs");
const path = require("node:path");
const { existingChromeError } = require("./existing-chrome-errors.cjs");
const COPY = {
  ru: {"title": "Разрешить доступ к файлу соединения Chrome", "buttonLabel": "Разрешить этот файл", "message": "Выберите DevToolsActivePort в папке Google Chrome. NEKODEX прочитает только этот файл соединения; затем Chrome отдельно запросит разрешение на подключение."},
  en: { title: "Allow access to Chrome connection file", buttonLabel: "Allow this file", message: "Select DevToolsActivePort in the Google Chrome folder. The launcher reads only this connection file, then Chrome asks separately whether to allow the connection." },
  "zh-CN": { title: "允许访问 Chrome 连接文件", buttonLabel: "允许此文件", message: "请选择 Google Chrome 文件夹中的 DevToolsActivePort。启动器仅读取此连接文件；Chrome 随后会单独询问是否允许连接。" },
  "zh-TW": { title: "允許存取 Chrome 連線檔案", buttonLabel: "允許此檔案", message: "請選取 Google Chrome 資料夾中的 DevToolsActivePort。啟動器只會讀取此連線檔案；接著 Chrome 會另外詢問是否允許連線。" },
  ja: { title: "Chrome 接続ファイルへのアクセスを許可", buttonLabel: "このファイルを許可", message: "Google Chrome フォルダ内の DevToolsActivePort を選択してください。ランチャーはこの接続ファイルだけを読み取り、その後 Chrome が接続の許可を別途確認します。" },
  ko: { title: "Chrome 연결 파일 접근 허용", buttonLabel: "이 파일 허용", message: "Google Chrome 폴더의 DevToolsActivePort를 선택하세요. 런처는 이 연결 파일만 읽고, 이후 Chrome이 연결 허용 여부를 별도로 묻습니다." },
};
function expectedChromeConnectionFile(homeDir) {
  if (typeof homeDir !== "string" || !path.isAbsolute(homeDir) || homeDir.includes("\0") || homeDir.length > 4096) {
    throw existingChromeError("chrome-file-selection-invalid");
  }
  return path.join(homeDir, "Library", "Application Support", "Google", "Chrome", "DevToolsActivePort");
}
function validateConnectionContents(contents) {
  if (typeof contents !== "string" || Buffer.byteLength(contents) > 2048) throw existingChromeError("invalid-endpoint");
  const match = /^([1-9][0-9]{0,4})\r?\n(\/devtools\/browser\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\r?\n?$/i.exec(contents);
  const port = match ? Number(match[1]) : 0;
  if (!match || port < 1024 || port > 65535) throw existingChromeError("invalid-endpoint");
  return contents;
}
async function selectChromeConnectionFile({ dialog, window, homeDir, language, signal, isCurrent,
  platform = process.platform, fileSystem = fs, getuid = process.getuid }) {
  const check = () => {
    signal.throwIfAborted();
    if (platform !== "darwin" || !isCurrent()) throw existingChromeError("chrome-file-selection-invalid");
  };
  check();
  const expected = expectedChromeConnectionFile(homeDir);
  const copy = COPY[language] || COPY.en;
  const selection = await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true; signal.removeEventListener("abort", abort);
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(existingChromeError("cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve().then(() => {
      check();
      return dialog.showOpenDialog(window, { title: copy.title, buttonLabel: copy.buttonLabel,
        message: copy.message, defaultPath: expected, properties: ["openFile", "noResolveAliases"] });
    }).then(value => finish(null, value), () => finish(existingChromeError("chrome-file-selection-invalid")));
    if (signal.aborted) abort();
  });
  check();
  if (selection?.canceled === true) return null;
  // Check exact identity BEFORE any filesystem operation on the selected path.
  if (selection?.canceled !== false || !Array.isArray(selection.filePaths)
    || selection.filePaths.length !== 1 || selection.filePaths[0] !== expected) {
    throw existingChromeError("chrome-file-selection-invalid");
  }
  let fd;
  try {
    check();
    const before = fileSystem.lstatSync(expected);
    if (!before.isFile() || before.isSymbolicLink()) throw existingChromeError("chrome-file-selection-invalid");
    check();
    fd = fileSystem.openSync(expected, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    check();
    const stat = fileSystem.fstatSync(fd);
    if (!stat.isFile() || stat.size < 1 || stat.size > 2048
      || stat.dev !== before.dev || stat.ino !== before.ino || typeof getuid !== "function" || stat.uid !== getuid()) {
      throw existingChromeError("chrome-file-selection-invalid");
    }
    const buffer = Buffer.alloc(2049);
    let count = 0;
    while (count < buffer.length) {
      check();
      const read = fileSystem.readSync(fd, buffer, count, buffer.length - count, null);
      if (!read) break;
      count += read;
    }
    check();
    return validateConnectionContents(new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, count)));
  } catch (error) {
    if (signal.aborted) throw existingChromeError("cancelled");
    if (error?.code === "EPERM" || error?.code === "EACCES") throw existingChromeError("chrome-profile-access-denied");
    throw existingChromeError("chrome-file-selection-invalid");
  } finally { if (fd !== undefined) fileSystem.closeSync(fd); }
}
module.exports = { selectChromeConnectionFile, expectedChromeConnectionFile, validateConnectionContents };
