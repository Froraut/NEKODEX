const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { writePrivateFileAtomic } = require('./atomic-file.cjs');
const { validateAccountId } = require('./account-registry.cjs');
const profileId = value => typeof value === 'string' && /^(Default|Profile [1-9][0-9]{0,5})$/.test(value);
const email = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value.trim().toLowerCase() : null;

function readProfiles(root) {
  const file = path.join(root, 'Local State');
  let stat;
  try { stat = fs.lstatSync(file); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 8 * 1024 * 1024) throw new Error('Chrome profile list is unavailable');
  const cache = JSON.parse(fs.readFileSync(file, 'utf8'))?.profile?.info_cache;
  if (!cache || typeof cache !== 'object' || Array.isArray(cache)) return [];
  // Profile metadata only: no cookies, Login Data, browsing history or credential decryption.
  return Object.entries(cache).filter(([id, value]) => profileId(id) && value && typeof value === 'object')
    .map(([id, value]) => ({ id, email: email(value.user_name),
      name: typeof value.name === 'string' ? value.name.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 80) : id }))
    .filter(profile => { try { const s = fs.lstatSync(path.join(root, profile.id)); return s.isDirectory() && !s.isSymbolicLink(); } catch { return false; } });
}
function selectMatch(profiles, expectedEmail, saved) {
  const expected = email(expectedEmail);
  const mapped = saved && profiles.find(p => p.id === saved.id && p.email && p.email === saved.email);
  if (mapped && (!expected || mapped.email === expected)) return mapped;
  const matches = expected ? profiles.filter(p => p.email === expected) : [];
  return matches.length === 1 ? matches[0] : null;
}
function openProfile(executable, id) {
  if (!profileId(id)) throw new Error('Invalid Chrome profile');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [`--profile-directory=${id}`, '--new-window', 'https://chatgpt.com/?temporary-chat=true'],
      { detached: true, stdio: 'ignore', shell: false });
    child.once('error', reject); child.once('spawn', () => { child.unref(); resolve(); });
  });
}
function createChromeProfileChoice({ root, coreHome, dialog, window, executable, language, launch = openProfile }) {
  const file = path.join(coreHome, 'chrome-profile-bindings.json');
  function bindings() { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Saved Chrome profile selection is unreadable'); } }
  return async ({ accountId, accountLabel, signal }) => {
    validateAccountId(accountId);
    const ru = language() === 'ru';
    let profiles;
    try { profiles = readProfiles(root); }
    catch { throw new Error(ru ? 'Не удалось прочитать список профилей Chrome. Проверьте доступ NEKODEX; новый профиль автоматически не создавался.' : 'Could not read Chrome profiles. Check NEKODEX access; no new profile was created.'); }
    const saved = bindings();
    let selected = selectMatch(profiles, accountLabel, saved[accountId]);
    if (profiles.length) {
      const listed = selected ? [selected, ...profiles.filter(p => p.id !== selected.id)] : profiles;
      const result = await dialog.showMessageBox(window(), { type:'question',
        title:ru?'Профиль Chrome для этого аккаунта':'Chrome profile for this account',
        message:ru?'Выберите существующий профиль Chrome':'Choose an existing Chrome profile',
        detail:ru?'Выбор запомнится для этого аккаунта NEKODEX. Почта профиля Google не подтверждает вход в ChatGPT — он проверяется отдельно. Если подходящего профиля нет, выберите новый.' : 'This choice is remembered for this NEKODEX account. Google profile email does not prove ChatGPT sign-in; that is verified separately. Choose a new profile only if none matches.',
        buttons:[ru?'Отмена':'Cancel',...listed.map(p=>`${p.name}${p.email ? ` — ${p.email}` : ''}`),ru?'Нет подходящего — новый профиль':'None matches — new profile'],defaultId:selected ? 1 : 0,cancelId:0,noLink:true,signal });
      if (result.response === 0) return {kind:'cancel'};
      if (result.response === listed.length+1) return {kind:'new'};
      selected = listed[result.response-1];
      if (!selected?.email) throw new Error(ru?'У профиля нет адреса Google. Сначала войдите в этот профиль Chrome.':'This profile has no Google email. Sign in to this Chrome profile first.');
    }
    if (!selected) return {kind:'new'};
    signal?.throwIfAborted();
    await launch(executable(), selected.id);
    saved[accountId] = {id:selected.id,email:selected.email};
    writePrivateFileAtomic(file, JSON.stringify(saved)+'\n', {durable:true});
    return {kind:'existing',email:selected.email,id:selected.id};
  };
}
module.exports={readProfiles,selectMatch,openProfile,createChromeProfileChoice};
