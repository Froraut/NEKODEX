import type { Language } from './types';
const copy = {
 en: {newWindow:'New browser window',newTab:'New browser tab',hint:'Selected account · ⌘T new tab · Control-Tab switch tabs'},
 ru: {newWindow:'Новое окно браузера',newTab:'Новая вкладка браузера',hint:'Выбранный аккаунт · ⌘T новая вкладка · Control-Tab переключение'},
 'zh-CN': {newWindow:'新建浏览器窗口',newTab:'新建浏览器标签页',hint:'所选账户 · ⌘T 新标签页 · Control-Tab 切换'},
 'zh-TW': {newWindow:'新增瀏覽器視窗',newTab:'新增瀏覽器分頁',hint:'所選帳戶 · ⌘T 新分頁 · Control-Tab 切換'},
 ja: {newWindow:'新しいブラウザーウインドウ',newTab:'新しいブラウザータブ',hint:'選択中のアカウント · ⌘T 新規タブ · Control-Tab 切り替え'},
 ko: {newWindow:'새 브라우저 창',newTab:'새 브라우저 탭',hint:'선택한 계정 · ⌘T 새 탭 · Control-Tab 전환'},
};
export const browserWindowCopy = (language: Language) => copy[language] ?? copy.en;
