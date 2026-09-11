const CHROME_SETTINGS_ADDRESS = "chrome://inspect/#remote-debugging";
const COPY = {
  en: {
    title: "Use your existing Chrome sign-in?",
    message: "Import the ChatGPT sign-in from your current Google Chrome profile",
    detail: "Chrome’s Allow dialog grants broad debugging access to your browser. This launcher uses that connection once to read ChatGPT/OpenAI sign-in cookies, then disconnects. It does not read other websites, saved passwords, browsing history or page contents, copy your Chrome profile, or close Chrome.\n\nYou must enable remote debugging yourself at chrome://inspect/#remote-debugging and approve Chrome’s own Allow dialog. After import, you can turn remote debugging off again. Your current Chrome account stays open; the launcher verifies its own imported session.",
    cancel: "Cancel", allow: "Continue to Chrome permission",
  },
  "zh-CN": {
    title: "使用现有 Chrome 登录？", message: "从当前 Google Chrome 配置文件导入 ChatGPT 登录",
    detail: "Chrome 的“允许”对话框会授予广泛的浏览器调试权限。启动器仅使用此连接读取一次 ChatGPT/OpenAI 登录 Cookie，随后断开连接。它不会读取其他网站、已存密码、浏览历史或页面内容，也不会复制配置文件或关闭 Chrome。\n\n请自行在 chrome://inspect/#remote-debugging 启用远程调试，并在 Chrome 的对话框中允许连接。导入后可再次关闭远程调试。当前 Chrome 账号保持打开；启动器会验证导入后的独立会话。",
    cancel: "取消", allow: "继续并在 Chrome 中授权",
  },
  ja: {
    title: "既存の Chrome ログインを使用しますか？", message: "現在の Google Chrome プロファイルから ChatGPT のログインを取り込みます",
    detail: "Chrome の「許可」ダイアログは、ブラウザ全体へのデバッグ権限を付与します。このランチャーは接続を一度だけ使って ChatGPT/OpenAI のログイン Cookie を読み取り、その後切断します。他のサイト、保存済みパスワード、閲覧履歴、ページ内容は読み取りません。プロファイルのコピーや Chrome の終了も行いません。\n\nchrome://inspect/#remote-debugging でリモートデバッグを手動で有効にし、Chrome のダイアログで接続を許可してください。取り込み後は無効に戻せます。現在の Chrome アカウントは開いたままで、ランチャーは取り込んだ独自のセッションを確認します。",
    cancel: "キャンセル", allow: "Chrome の許可に進む",
  },
};
async function confirmExistingChromeImport(dialog, window, language) {
  const copy = COPY[language] || COPY.en;
  const result = await dialog.showMessageBox(window, {
    type: "question", title: copy.title, message: copy.message, detail: copy.detail,
    buttons: [copy.cancel, copy.allow], defaultId: 0, cancelId: 0, noLink: true,
  });
  return result.response === 1;
}
module.exports = { CHROME_SETTINGS_ADDRESS, confirmExistingChromeImport };
