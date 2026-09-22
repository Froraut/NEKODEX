import type { Language } from "./types";

export type BrowserWindowCopy = {
  newWindow: string; newTab: string; hint: string; windows: string; account: string;
  open: string; close: string; restore: string; saved: string; current: string;
  empty: string; temporary: string; tabsMacOnly: string; saveFailed: string;
  identityChanging: string;
  needsOriginalAccount: string;
  restored(count: number): string;
  skippedTemporary(count: number): string;
  skippedCapacity(count: number): string;
  skippedIdentity(count: number): string;
};

const copy: Record<Language, BrowserWindowCopy> = {
  en: {
    newWindow: "New browser window", newTab: "New browser tab",
    hint: "Selected account · ⌘T new tab · Control-Tab switch tabs",
    windows: "Browser workspaces", account: "Account", open: "Open", close: "Close",
    restore: "Restore saved workspaces", saved: "Saved for restart", current: "Open now",
    empty: "No browser workspaces for this account.", temporary: "Temporary Chat closes with the app and cannot be restored.",
    tabsMacOnly: "This platform uses separate windows. Native browser tabs are available on macOS.",
    saveFailed: "Not all browser workspaces could be saved for restart. Open windows are unaffected.",
    identityChanging: "Checking the account after a sign-in or sign-out change…",
    needsOriginalAccount: "Needs the original ChatGPT account",
    restored: (count: number) => `${count} workspace${count === 1 ? "" : "s"} restored`,
    skippedTemporary: (count: number) => `${count} Temporary Chat workspace${count === 1 ? " was" : "s were"} not restored`,
    skippedCapacity: (count: number) => `${count} saved workspace${count === 1 ? " is" : "s are"} waiting for a free window slot; choose Restore saved workspaces after freeing a slot`,
    skippedIdentity: (count: number) => `${count} saved workspace${count === 1 ? " needs" : "s need"} its original ChatGPT account`,
  },
  ru: {
    newWindow: "Новое окно браузера", newTab: "Новая вкладка браузера",
    hint: "Выбранный аккаунт · ⌘T новая вкладка · Control-Tab переключение",
    windows: "Рабочие окна браузера", account: "Аккаунт", open: "Открыть", close: "Закрыть",
    restore: "Восстановить сохранённые окна", saved: "Сохранено для перезапуска", current: "Открыто сейчас",
    empty: "У этого аккаунта нет рабочих окон браузера.", temporary: "Temporary Chat закрывается вместе с приложением и не восстанавливается.",
    tabsMacOnly: "На этой платформе используются отдельные окна. Нативные вкладки браузера доступны в macOS.",
    saveFailed: "Не все рабочие окна удалось сохранить для перезапуска. Открытые окна продолжают работать.",
    identityChanging: "Проверяем аккаунт после изменения входа или выхода…",
    needsOriginalAccount: "Нужен исходный аккаунт ChatGPT",
    restored: (count: number) => `Восстановлено окон: ${count}`,
    skippedTemporary: (count: number) => `Не восстановлено Temporary Chat: ${count}`,
    skippedCapacity: (count: number) => `Ожидают свободного места: ${count}. Освободите место и нажмите «Восстановить сохранённые окна».`,
    skippedIdentity: (count: number) => `Требуют исходный аккаунт ChatGPT: ${count}`,
  },
  "zh-CN": {
    newWindow: "新建浏览器窗口", newTab: "新建浏览器标签页",
    hint: "所选账户 · ⌘T 新标签页 · Control-Tab 切换",
    windows: "浏览器工作区", account: "账户", open: "打开", close: "关闭",
    restore: "恢复已保存的工作区", saved: "已保存以供重启后恢复", current: "当前已打开",
    empty: "此账户没有浏览器工作区。", temporary: "Temporary Chat 会随应用关闭，无法恢复。",
    tabsMacOnly: "此平台使用独立窗口。原生浏览器标签页仅在 macOS 上可用。",
    saveFailed: "未能保存所有浏览器工作区以供重启后恢复。已打开的窗口不受影响。",
    identityChanging: "正在检查登录或退出更改后的账户…",
    needsOriginalAccount: "需要原始 ChatGPT 账户",
    restored: (count: number) => `已恢复 ${count} 个工作区`,
    skippedTemporary: (count: number) => `${count} 个 Temporary Chat 工作区未恢复`,
    skippedCapacity: (count: number) => `${count} 个已保存工作区正在等待可用窗口；腾出空间后请选择“恢复已保存的工作区”`,
    skippedIdentity: (count: number) => `${count} 个已保存工作区需要原始 ChatGPT 账户`,
  },
  "zh-TW": {
    newWindow: "新增瀏覽器視窗", newTab: "新增瀏覽器分頁",
    hint: "所選帳戶 · ⌘T 新分頁 · Control-Tab 切換",
    windows: "瀏覽器工作區", account: "帳戶", open: "開啟", close: "關閉",
    restore: "還原已儲存的工作區", saved: "已儲存供重新啟動後還原", current: "目前已開啟",
    empty: "此帳戶沒有瀏覽器工作區。", temporary: "Temporary Chat 會隨應用程式關閉，且無法還原。",
    tabsMacOnly: "此平台使用獨立視窗。原生瀏覽器分頁僅在 macOS 上可用。",
    saveFailed: "無法儲存所有瀏覽器工作區供重新啟動後還原。已開啟的視窗不受影響。",
    identityChanging: "正在檢查登入或登出變更後的帳戶…",
    needsOriginalAccount: "需要原始 ChatGPT 帳戶",
    restored: (count: number) => `已還原 ${count} 個工作區`,
    skippedTemporary: (count: number) => `${count} 個 Temporary Chat 工作區未還原`,
    skippedCapacity: (count: number) => `${count} 個已儲存工作區正在等待可用視窗；騰出空間後請選擇「還原已儲存的工作區」`,
    skippedIdentity: (count: number) => `${count} 個已儲存工作區需要原始 ChatGPT 帳戶`,
  },
  ja: {
    newWindow: "新しいブラウザーウインドウ", newTab: "新しいブラウザータブ",
    hint: "選択中のアカウント · ⌘T 新規タブ · Control-Tab 切り替え",
    windows: "ブラウザーワークスペース", account: "アカウント", open: "開く", close: "閉じる",
    restore: "保存済みワークスペースを復元", saved: "再起動後のために保存済み", current: "現在開いています",
    empty: "このアカウントにはブラウザーワークスペースがありません。", temporary: "Temporary Chat はアプリ終了時に閉じ、復元できません。",
    tabsMacOnly: "このプラットフォームでは個別のウインドウを使用します。ネイティブタブは macOS で利用できます。",
    saveFailed: "再起動後の復元用にすべてのブラウザーワークスペースを保存できませんでした。開いているウインドウには影響しません。",
    identityChanging: "サインインまたはサインアウト変更後のアカウントを確認しています…",
    needsOriginalAccount: "元の ChatGPT アカウントが必要です",
    restored: (count: number) => `${count} 件のワークスペースを復元しました`,
    skippedTemporary: (count: number) => `${count} 件の Temporary Chat は復元されませんでした`,
    skippedCapacity: (count: number) => `${count} 件の保存済みワークスペースは空き待ちです。空きを作り「保存済みワークスペースを復元」を選択してください`,
    skippedIdentity: (count: number) => `${count} 件の保存済みワークスペースには元の ChatGPT アカウントが必要です`,
  },
  ko: {
    newWindow: "새 브라우저 창", newTab: "새 브라우저 탭",
    hint: "선택한 계정 · ⌘T 새 탭 · Control-Tab 전환",
    windows: "브라우저 작업 공간", account: "계정", open: "열기", close: "닫기",
    restore: "저장된 작업 공간 복원", saved: "재시작 후 복원하도록 저장됨", current: "현재 열림",
    empty: "이 계정에는 브라우저 작업 공간이 없습니다.", temporary: "Temporary Chat은 앱과 함께 닫히며 복원할 수 없습니다.",
    tabsMacOnly: "이 플랫폼에서는 별도 창을 사용합니다. 기본 브라우저 탭은 macOS에서 사용할 수 있습니다.",
    saveFailed: "재시작 후 복원할 브라우저 작업 공간을 모두 저장하지 못했습니다. 열린 창은 계속 작동합니다.",
    identityChanging: "로그인 또는 로그아웃 변경 후 계정을 확인하는 중…",
    needsOriginalAccount: "원래 ChatGPT 계정이 필요함",
    restored: (count: number) => `작업 공간 ${count}개 복원됨`,
    skippedTemporary: (count: number) => `Temporary Chat 작업 공간 ${count}개는 복원되지 않음`,
    skippedCapacity: (count: number) => `저장된 작업 공간 ${count}개가 빈 창을 기다리는 중입니다. 공간을 확보한 후 저장된 작업 공간 복원을 선택하세요`,
    skippedIdentity: (count: number) => `저장된 작업 공간 ${count}개에 원래 ChatGPT 계정이 필요함`,
  },
};

export const browserWindowCopy = (language: Language): BrowserWindowCopy => copy[language] ?? copy.en;
