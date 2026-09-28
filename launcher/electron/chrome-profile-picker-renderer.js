const api = window.nekodexChromeProfiles;
// The launcher passes its resolved theme; anything else keeps the dark default palette.
if (new URLSearchParams(location.search).get('theme') === 'light') document.documentElement.dataset.theme = 'light';
const elements = {
  search: document.getElementById('search'),
  profiles: document.getElementById('profiles'),
  status: document.getElementById('status'),
  empty: document.getElementById('empty'),
  emptyTitle: document.getElementById('empty-title'),
  emptyBody: document.getElementById('empty-body'),
  clear: document.getElementById('clear'),
  connect: document.getElementById('connect'),
  cancel: document.getElementById('cancel'),
  createNew: document.getElementById('new'),
};
let profiles = [];
/** One option element per profile, kept across renders so the focused option keeps focus. */
const options = new Map();
let selectedId = null;
let copy = null;

// The launcher's six languages (electron/languages.json). Terms follow the launcher's own copy.
const text = {
  en: {
    windowTitle: 'Chrome profile', eyebrow: 'Google Chrome Stable', title: 'Choose a Chrome profile',
    intro: 'Google profile details are shown below. Your ChatGPT account is verified separately before connecting.',
    search: 'Search profiles', placeholder: 'Name, Google email, or profile', cancel: 'Cancel',
    createNew: 'New isolated sign-in', connect: 'Continue', noEmail: 'No Google email in profile metadata',
    count: count => `${count} profile${count === 1 ? '' : 's'} shown`, selected: 'Previously connected profile',
    noMatches: query => `No profiles match “${query}”`, noMatchesBody: 'Try another name or email, or clear the search.',
    clear: 'Clear search', none: 'No Chrome profiles found',
    noneBody: 'Google Chrome Stable has no profiles to connect. Use New isolated sign-in to sign in with a separate profile.',
  },
  ru: {
    windowTitle: 'Профиль Chrome', eyebrow: 'Google Chrome Stable', title: 'Выберите профиль Chrome',
    intro: 'Ниже указаны данные профилей Google. Перед подключением NEKODEX отдельно проверит аккаунт ChatGPT.',
    search: 'Поиск профилей', placeholder: 'Имя, почта Google или профиль', cancel: 'Отмена',
    createNew: 'Новый изолированный вход', connect: 'Продолжить', noEmail: 'В метаданных нет почты Google',
    count: count => `Показано профилей: ${count}`, selected: 'Ранее подключённый профиль',
    noMatches: query => `Нет профилей по запросу «${query}»`, noMatchesBody: 'Попробуйте другое имя или почту либо очистите поиск.',
    clear: 'Очистить поиск', none: 'Профили Chrome не найдены',
    noneBody: 'В Google Chrome Stable нет профилей для подключения. Выберите «Новый изолированный вход», чтобы войти в отдельном профиле.',
  },
  'zh-CN': {
    windowTitle: 'Chrome 资料', eyebrow: 'Google Chrome Stable', title: '选择 Chrome 资料',
    intro: '下方显示 Google 资料详情。连接前，NEKODEX 会单独验证你的 ChatGPT 账号。',
    search: '搜索资料', placeholder: '名称、Google 邮箱或资料', cancel: '取消',
    createNew: '新的隔离登录', connect: '继续', noEmail: '资料元数据中没有 Google 邮箱',
    count: count => `显示 ${count} 个资料`, selected: '之前连接的资料',
    noMatches: query => `没有与“${query}”匹配的资料`, noMatchesBody: '请尝试其他名称或邮箱，或清除搜索。',
    clear: '清除搜索', none: '未找到 Chrome 资料',
    noneBody: 'Google Chrome Stable 中没有可连接的资料。使用“新的隔离登录”在单独的资料中登录。',
  },
  'zh-TW': {
    windowTitle: 'Chrome 設定檔', eyebrow: 'Google Chrome Stable', title: '選擇 Chrome 設定檔',
    intro: '下方顯示 Google 設定檔詳細資料。連線前，NEKODEX 會另外驗證您的 ChatGPT 帳號。',
    search: '搜尋設定檔', placeholder: '名稱、Google 電子郵件或設定檔', cancel: '取消',
    createNew: '新的隔離登入', connect: '繼續', noEmail: '設定檔中繼資料沒有 Google 電子郵件',
    count: count => `顯示 ${count} 個設定檔`, selected: '先前連線的設定檔',
    noMatches: query => `沒有符合「${query}」的設定檔`, noMatchesBody: '請嘗試其他名稱或電子郵件，或清除搜尋。',
    clear: '清除搜尋', none: '找不到 Chrome 設定檔',
    noneBody: 'Google Chrome Stable 中沒有可連線的設定檔。使用「新的隔離登入」以獨立的設定檔登入。',
  },
  ja: {
    windowTitle: 'Chrome プロファイル', eyebrow: 'Google Chrome Stable', title: 'Chrome プロファイルを選択',
    intro: '以下に Google プロファイルの詳細を表示しています。接続前に、NEKODEX が ChatGPT アカウントを別途確認します。',
    search: 'プロファイルを検索', placeholder: '名前、Google メール、またはプロファイル', cancel: 'キャンセル',
    createNew: '新しい分離ログイン', connect: '続ける', noEmail: 'プロファイル情報に Google メールがありません',
    count: count => `${count} 件のプロファイルを表示中`, selected: '以前に接続したプロファイル',
    noMatches: query => `「${query}」に一致するプロファイルはありません`, noMatchesBody: '別の名前やメールで検索するか、検索をクリアしてください。',
    clear: '検索をクリア', none: 'Chrome プロファイルが見つかりません',
    noneBody: 'Google Chrome Stable に接続できるプロファイルがありません。「新しい分離ログイン」を使うと、別のプロファイルでログインできます。',
  },
  ko: {
    windowTitle: 'Chrome 프로필', eyebrow: 'Google Chrome Stable', title: 'Chrome 프로필 선택',
    intro: '아래에 Google 프로필 정보가 표시됩니다. 연결하기 전에 NEKODEX가 ChatGPT 계정을 별도로 확인합니다.',
    search: '프로필 검색', placeholder: '이름, Google 이메일 또는 프로필', cancel: '취소',
    createNew: '새 격리 로그인', connect: '계속', noEmail: '프로필 메타데이터에 Google 이메일이 없습니다',
    count: count => `프로필 ${count}개 표시됨`, selected: '이전에 연결한 프로필',
    noMatches: query => `‘${query}’ 검색 결과가 없습니다`, noMatchesBody: '다른 이름이나 이메일로 검색하거나 검색어를 지우세요.',
    clear: '검색어 지우기', none: 'Chrome 프로필을 찾을 수 없습니다',
    noneBody: 'Google Chrome Stable에 연결할 프로필이 없습니다. ‘새 격리 로그인’을 사용해 별도 프로필로 로그인하세요.',
  },
};

function normalize(value) {
  return typeof value === 'string' ? value.normalize('NFKC').trim().toLocaleLowerCase().slice(0, 160) : '';
}

function visibleProfiles() {
  const query = normalize(elements.search.value);
  return query ? profiles.filter(profile => [profile.name, profile.googleEmail, profile.id]
    .some(value => normalize(value).includes(query))) : profiles;
}

/** The options that are shown, in list order. */
function visibleOptions() {
  return [...options.values()].filter(option => !option.hidden);
}

function createOption(profile) {
  const option = document.createElement('button');
  option.type = 'button';
  option.className = 'profile';
  option.setAttribute('role', 'option');
  option.tabIndex = -1;
  option.dataset.id = profile.id;
  const name = document.createElement('span'); name.className = 'profile-name'; name.textContent = profile.name || profile.id;
  const metadata = document.createElement('span'); metadata.className = 'profile-meta'; metadata.textContent = profile.googleEmail || copy.noEmail;
  const directory = document.createElement('span'); directory.className = 'profile-id'; directory.textContent = profile.id;
  option.append(name, metadata, directory);
  if (profile.saved) { const saved = document.createElement('span'); saved.className = 'saved'; saved.textContent = copy.selected; option.append(saved); }
  option.addEventListener('click', () => choose(profile.id));
  option.addEventListener('dblclick', () => api.select(profile.id));
  return option;
}

function choose(id) {
  selectedId = id;
  render();
}

/**
 * Updates the list in place (shown, selected, tab stop) so a focused option keeps focus. The listbox is one tab stop:
 * the selected option when it is shown, otherwise the first shown option. Continue needs a selection the user can see.
 */
function render() {
  const visible = visibleProfiles();
  const shown = new Set(visible.map(profile => profile.id));
  const selectedShown = selectedId !== null && shown.has(selectedId);
  const tabStop = selectedShown ? selectedId : visible[0]?.id;
  for (const [id, option] of options) {
    option.hidden = !shown.has(id);
    option.setAttribute('aria-selected', String(id === selectedId));
    option.tabIndex = id === tabStop ? 0 : -1;
  }
  const query = elements.search.value.trim();
  const empty = visible.length === 0;
  elements.profiles.hidden = empty;
  elements.empty.hidden = !empty;
  if (empty) {
    const title = profiles.length && query ? copy.noMatches(query) : copy.none;
    elements.emptyTitle.textContent = title;
    elements.emptyBody.textContent = profiles.length && query ? copy.noMatchesBody : copy.noneBody;
    elements.clear.hidden = !(profiles.length && query);
    // The status line announces the empty state; on screen the empty state says it in the list area instead.
    elements.status.textContent = title;
  } else {
    elements.status.textContent = copy.count(visible.length);
  }
  elements.status.classList.toggle('visually-hidden', empty);
  elements.connect.disabled = !selectedShown;
}

function clearSearch() {
  elements.search.value = '';
  render();
  elements.search.focus();
}

api.receive(payload => {
  if (!payload || payload.type !== 'profiles' || !Array.isArray(payload.profiles)) return api.cancel();
  const language = Object.hasOwn(text, payload.language) ? payload.language : 'en';
  copy = text[language];
  document.documentElement.lang = language;
  // Electron shows the page title as the window title.
  document.title = copy.windowTitle;
  document.getElementById('eyebrow').textContent = copy.eyebrow;
  document.getElementById('title').textContent = copy.title;
  document.getElementById('intro').textContent = copy.intro;
  document.getElementById('search-label').textContent = copy.search;
  elements.search.placeholder = copy.placeholder;
  elements.clear.textContent = copy.clear;
  elements.cancel.textContent = copy.cancel;
  elements.createNew.textContent = copy.createNew;
  elements.connect.textContent = copy.connect;
  profiles = payload.profiles.map(profile => ({ ...profile, saved: profile.id === payload.selectedId }));
  selectedId = profiles.some(profile => profile.id === payload.selectedId) ? payload.selectedId : null;
  options.clear();
  for (const profile of profiles) options.set(profile.id, createOption(profile));
  elements.profiles.replaceChildren(...options.values());
  // Without profiles there is nothing to search or continue with: a new isolated sign-in is the next step.
  const none = profiles.length === 0;
  elements.search.disabled = none;
  elements.connect.hidden = none;
  elements.createNew.className = none ? 'primary' : 'secondary';
  render();
  (none ? elements.createNew : elements.search).focus();
});

elements.search.addEventListener('input', render);
elements.search.addEventListener('keydown', event => {
  // Escape clears a search first; the window closes on the next Escape.
  if (event.key === 'Escape' && elements.search.value) {
    event.preventDefault();
    event.stopPropagation();
    clearSearch();
    return;
  }
  if (event.key !== 'ArrowDown') return;
  // Into the list at its tab stop (the selected profile when it is shown); selection follows focus.
  const target = visibleOptions().find(option => option.tabIndex === 0);
  if (!target) return;
  event.preventDefault();
  choose(target.dataset.id);
  target.focus();
});
elements.profiles.addEventListener('keydown', event => {
  const items = visibleOptions();
  const index = items.indexOf(document.activeElement);
  if (index < 0) return;
  const next = event.key === 'ArrowDown' ? items[Math.min(index + 1, items.length - 1)]
    : event.key === 'ArrowUp' ? (index === 0 ? elements.search : items[index - 1])
      : event.key === 'Home' ? items[0]
        : event.key === 'End' ? items[items.length - 1] : null;
  if (!next) return;
  event.preventDefault();
  if (next === elements.search) { elements.search.focus(); return; }
  choose(next.dataset.id);
  next.focus();
});
elements.clear.addEventListener('click', clearSearch);
elements.connect.addEventListener('click', () => {
  if (selectedId !== null && options.get(selectedId)?.hidden === false) api.select(selectedId);
});
elements.cancel.addEventListener('click', api.cancel);
elements.createNew.addEventListener('click', api.createNew);
document.addEventListener('keydown', event => { if (event.key === 'Escape') api.cancel(); });
api.ready();
