import type { Language } from "./types";

export type BrowserAddressCopy = {
  label: string;
  placeholder: string;
  hint(shortcut: string): string;
  invalid: string;
  externalBlocked: string;
};

const copy: Record<Language, BrowserAddressCopy> = {
  en: {
    label: "Address",
    placeholder: "ChatGPT page or web address",
    hint: shortcut => `Enter a ChatGPT page (chatgpt.com/…, /codex, c/<id>) or a web address. Other sites open in your default browser. ${shortcut} selects the address.`,
    invalid: "Enter a ChatGPT page or a web address.",
    externalBlocked: "Local and private addresses can’t be opened from NEKODEX.",
  },
  ru: {
    label: "Адрес",
    placeholder: "Страница ChatGPT или веб-адрес",
    hint: shortcut => `Введите страницу ChatGPT (chatgpt.com/…, /codex, c/<id>) или веб-адрес. Другие сайты откроются в браузере по умолчанию. ${shortcut} выделяет адрес.`,
    invalid: "Введите страницу ChatGPT или веб-адрес.",
    externalBlocked: "Локальные и частные адреса нельзя открыть из NEKODEX.",
  },
  "zh-CN": {
    label: "地址",
    placeholder: "ChatGPT 页面或网址",
    hint: shortcut => `输入 ChatGPT 页面（chatgpt.com/…、/codex、c/<id>）或网址。其他网站会在默认浏览器中打开。按 ${shortcut} 选中地址。`,
    invalid: "请输入 ChatGPT 页面或网址。",
    externalBlocked: "无法从 NEKODEX 打开本地或私有地址。",
  },
  "zh-TW": {
    label: "網址",
    placeholder: "ChatGPT 頁面或網址",
    hint: shortcut => `輸入 ChatGPT 頁面（chatgpt.com/…、/codex、c/<id>）或網址。其他網站會在預設瀏覽器中開啟。按 ${shortcut} 選取網址。`,
    invalid: "請輸入 ChatGPT 頁面或網址。",
    externalBlocked: "無法從 NEKODEX 開啟本機或私人位址。",
  },
  ja: {
    label: "アドレス",
    placeholder: "ChatGPT のページまたは Web アドレス",
    hint: shortcut => `ChatGPT のページ（chatgpt.com/…、/codex、c/<id>）または Web アドレスを入力します。ほかのサイトは既定のブラウザーで開きます。${shortcut} でアドレスを選択します。`,
    invalid: "ChatGPT のページまたは Web アドレスを入力してください。",
    externalBlocked: "ローカルまたはプライベートのアドレスは NEKODEX から開けません。",
  },
  ko: {
    label: "주소",
    placeholder: "ChatGPT 페이지 또는 웹 주소",
    hint: shortcut => `ChatGPT 페이지(chatgpt.com/…, /codex, c/<id>) 또는 웹 주소를 입력하세요. 다른 사이트는 기본 브라우저에서 열립니다. ${shortcut}로 주소를 선택합니다.`,
    invalid: "ChatGPT 페이지 또는 웹 주소를 입력하세요.",
    externalBlocked: "로컬 또는 비공개 주소는 NEKODEX에서 열 수 없습니다.",
  },
};

export const browserAddressCopy = (language: Language): BrowserAddressCopy => copy[language] ?? copy.en;
