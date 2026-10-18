import type { Language } from "./types";

type SettingsSearchCopy = {
  label: string; placeholder: string; clear: string; hint: string; noResults: string;
  results: string; unavailable: string;
};

const copy: Record<Language, SettingsSearchCopy> = {
  en: {
    label: "Search settings", placeholder: "Name, section or description", clear: "Clear search",
    hint: "Find a setting, then select it to move to its control. Use ↓ to browse results and Escape to clear.",
    noResults: "No matching settings. Try another name or description.", results: "Settings found: {count}",
    unavailable: "Currently unavailable",
  },
  ru: {
    label: "Поиск настроек", placeholder: "Название, раздел или описание", clear: "Очистить поиск",
    hint: "Найдите настройку и выберите её, чтобы перейти к элементу управления. ↓ — результаты, Escape — очистить.",
    noResults: "Подходящих настроек нет. Попробуйте другое название или описание.", results: "Найдено настроек: {count}",
    unavailable: "Сейчас недоступно",
  },
  "zh-CN": {
    label: "搜索设置", placeholder: "名称、分区或描述", clear: "清除搜索",
    hint: "查找并选择设置以跳转到对应控件。按 ↓ 浏览结果，按 Escape 清除搜索。",
    noResults: "没有匹配的设置。请尝试其他名称或描述。", results: "找到的设置：{count}", unavailable: "当前不可用",
  },
  "zh-TW": {
    label: "搜尋設定", placeholder: "名稱、區段或說明", clear: "清除搜尋",
    hint: "尋找並選取設定以跳至對應控制項。按 ↓ 瀏覽結果，按 Escape 清除搜尋。",
    noResults: "沒有符合的設定。請嘗試其他名稱或說明。", results: "找到的設定：{count}", unavailable: "目前無法使用",
  },
  ja: {
    label: "設定を検索", placeholder: "名前、セクション、説明", clear: "検索をクリア",
    hint: "設定を検索して選ぶと、その操作項目に移動します。↓ で結果を選択、Escape で検索をクリアします。",
    noResults: "一致する設定がありません。別の名前や説明をお試しください。", results: "見つかった設定：{count}", unavailable: "現在利用できません",
  },
  ko: {
    label: "설정 검색", placeholder: "이름, 섹션 또는 설명", clear: "검색 지우기",
    hint: "설정을 검색한 뒤 선택하면 해당 컨트롤로 이동합니다. ↓ 키로 결과를 탐색하고 Escape 키로 지웁니다.",
    noResults: "일치하는 설정이 없습니다. 다른 이름이나 설명을 검색하세요.", results: "검색된 설정: {count}", unavailable: "현재 사용할 수 없음",
  },
};

export function settingsSearchCopy(language: Language): SettingsSearchCopy { return copy[language]; }
