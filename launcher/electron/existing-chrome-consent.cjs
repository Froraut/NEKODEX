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
  "zh-TW": {
    title: "使用現有的 Chrome 登入？", message: "從目前的 Google Chrome 設定檔匯入 ChatGPT 登入狀態",
    detail: "Chrome 的「允許」對話框會授予廣泛的瀏覽器偵錯權限。啟動器只使用此連線讀取一次 ChatGPT/OpenAI 登入 Cookie，隨後中斷連線。它不會讀取其他網站、已儲存的密碼、瀏覽紀錄或頁面內容，也不會複製您的 Chrome 設定檔或關閉 Chrome。\n\n您必須自行在 chrome://inspect/#remote-debugging 啟用遠端偵錯，並在 Chrome 的對話框中允許連線。匯入後可以再次關閉遠端偵錯。您目前的 Chrome 帳號會保持開啟；啟動器會驗證匯入到自身的工作階段。",
    cancel: "取消", allow: "繼續前往 Chrome 授權",
  },
  ko: {
    title: "기존 Chrome 로그인을 사용하시겠습니까?", message: "현재 Google Chrome 프로필에서 ChatGPT 로그인 가져오기",
    detail: "Chrome의 허용 대화상자는 브라우저에 대한 광범위한 디버깅 접근 권한을 부여합니다. 런처는 이 연결을 한 번만 사용해 ChatGPT/OpenAI 로그인 쿠키를 읽은 다음 연결을 끊습니다. 다른 웹사이트, 저장된 비밀번호, 방문 기록 또는 페이지 내용을 읽거나 Chrome 프로필을 복사하거나 Chrome을 종료하지 않습니다.\n\nchrome://inspect/#remote-debugging에서 직접 원격 디버깅을 활성화하고 Chrome의 허용 대화상자에서 연결을 승인해야 합니다. 가져온 뒤 원격 디버깅을 다시 끌 수 있습니다. 현재 Chrome 계정은 계속 열려 있으며 런처는 가져온 자체 세션을 확인합니다.",
    cancel: "취소", allow: "Chrome 권한으로 계속",
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
