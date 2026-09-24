const api = window.nekodexChromeProfiles;
const elements = {
  search: document.getElementById('search'),
  profiles: document.getElementById('profiles'),
  status: document.getElementById('status'),
  connect: document.getElementById('connect'),
  cancel: document.getElementById('cancel'),
  createNew: document.getElementById('new'),
};
let profiles = [];
let selectedId = null;
let copy = null;

const text = {
  en: {
    eyebrow: 'Connect Google Chrome Stable', title: 'Choose a Chrome Stable profile',
    intro: 'These profiles belong to Google Chrome Stable. The Google account shown here is profile metadata. NEKODEX verifies the actual ChatGPT account separately before changing your saved session.',
    search: 'Search profiles', placeholder: 'Name, Google email, or profile', cancel: 'Cancel',
    createNew: 'Use a new isolated sign-in', connect: 'Continue', noEmail: 'No Google email in profile metadata',
    none: 'No profiles match this search.', count: count => `${count} profile${count === 1 ? '' : 's'} shown`, selected: 'Previously connected profile',
  },
  ru: {
    eyebrow: 'Подключение Google Chrome Stable', title: 'Выберите профиль Chrome Stable',
    intro: 'Эти профили принадлежат Google Chrome Stable. Показанный аккаунт Google — это только метаданные профиля. Перед изменением сохранённой сессии NEKODEX отдельно проверит фактический аккаунт ChatGPT.',
    search: 'Поиск профилей', placeholder: 'Имя, почта Google или профиль', cancel: 'Отмена',
    createNew: 'Использовать новый изолированный вход', connect: 'Продолжить', noEmail: 'В метаданных нет почты Google',
    none: 'По этому запросу профили не найдены.', count: count => `Показано профилей: ${count}`, selected: 'Ранее подключённый профиль',
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

function render() {
  const visible = visibleProfiles();
  elements.profiles.replaceChildren();
  for (const profile of visible) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'profile';
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(profile.id === selectedId));
    button.dataset.id = profile.id;
    const name = document.createElement('span'); name.className = 'profile-name'; name.textContent = profile.name || profile.id;
    const metadata = document.createElement('span'); metadata.className = 'profile-meta'; metadata.textContent = profile.googleEmail || copy.noEmail;
    const directory = document.createElement('span'); directory.className = 'profile-id'; directory.textContent = profile.id;
    button.append(name, metadata, directory);
    if (profile.saved) { const saved = document.createElement('span'); saved.className = 'saved'; saved.textContent = copy.selected; button.append(saved); }
    button.addEventListener('click', () => { selectedId = profile.id; render(); });
    button.addEventListener('dblclick', () => api.select(profile.id));
    elements.profiles.append(button);
  }
  elements.status.textContent = visible.length ? copy.count(visible.length) : copy.none;
  elements.connect.disabled = !profiles.some(profile => profile.id === selectedId);
}

api.receive(payload => {
  if (!payload || payload.type !== 'profiles' || !Array.isArray(payload.profiles)) return api.cancel();
  copy = text[payload.language] || text.en;
  document.documentElement.lang = payload.language === 'ru' ? 'ru' : 'en';
  document.getElementById('eyebrow').textContent = copy.eyebrow;
  document.getElementById('title').textContent = copy.title;
  document.getElementById('intro').textContent = copy.intro;
  document.getElementById('search-label').textContent = copy.search;
  elements.search.placeholder = copy.placeholder;
  elements.cancel.textContent = copy.cancel;
  elements.createNew.textContent = copy.createNew;
  elements.connect.textContent = copy.connect;
  profiles = payload.profiles.map(profile => ({ ...profile, saved: profile.id === payload.selectedId }));
  selectedId = profiles.some(profile => profile.id === payload.selectedId) ? payload.selectedId : null;
  render();
  elements.search.focus();
});

elements.search.addEventListener('input', render);
elements.search.addEventListener('keydown', event => {
  if (event.key !== 'ArrowDown') return;
  const first = elements.profiles.querySelector('.profile');
  if (first) { event.preventDefault(); first.focus(); }
});
elements.profiles.addEventListener('keydown', event => {
  const items = [...elements.profiles.querySelectorAll('.profile')];
  const index = items.indexOf(document.activeElement);
  if (!['ArrowDown', 'ArrowUp'].includes(event.key) || index < 0) return;
  event.preventDefault();
  items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
});
elements.connect.addEventListener('click', () => { if (selectedId) api.select(selectedId); });
elements.cancel.addEventListener('click', api.cancel);
elements.createNew.addEventListener('click', api.createNew);
document.addEventListener('keydown', event => { if (event.key === 'Escape') api.cancel(); });
api.ready();
