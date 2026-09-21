const { randomUUID } = require('node:crypto');
const { validatePasskeyLoginState } = require('./passkey-login-state.cjs');

async function verifyCapturedAccount(sessionApi, transfer, expectedEmail, signal) {
  const isolated = sessionApi.fromPartition(`nekodex-profile-verification-${randomUUID()}`, {cache:false});
  try {
    const state = validatePasskeyLoginState(transfer.storageState);
    for (const cookie of state.cookies) { signal?.throwIfAborted(); await isolated.cookies.set(cookie); }
    const response = await isolated.fetch('https://chatgpt.com/api/auth/session', {
      credentials:'include',redirect:'error',cache:'no-store',
      signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000),
      headers:{accept:'application/json'},
    });
    if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Session verification unavailable');
    const reader = response.body.getReader(); let size=0; const chunks=[];
    try {
      for (;;) { const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>256*1024)throw new Error('Session response too large');chunks.push(Buffer.from(value)); }
    } finally { await reader.cancel().catch(()=>{}); }
    const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const actual=typeof payload.user?.email==='string'?payload.user.email.trim().toLowerCase():null;
    if (!actual || actual!==expectedEmail || payload.error || (payload.expires && (!Number.isFinite(Date.parse(payload.expires)) || Date.parse(payload.expires)<=Date.now()))) {
      throw Object.assign(new Error('Chrome returned a different or unverified ChatGPT account'),{code:'chrome-account-mismatch'});
    }
  } finally { await isolated.clearStorageData(); isolated.closeAllConnections(); }
}

function createProfileFirstLogin({choose, runtime, session, dialog, window, language}) {
  return async (onProgress, context) => {
    const {signal}=context;
    signal?.throwIfAborted();
    let choice;
    try { choice=await choose(context); }
    catch (error) {
      if (!signal?.aborted) await dialog.showMessageBox(window(), {type:'error',
        message:language()==='ru'?'Не удалось открыть выбранный профиль Chrome':'Could not open the selected Chrome profile',
        detail:language()==='ru'?'Проверьте доступ NEKODEX к списку профилей и наличие Google Chrome. Новый профиль автоматически не создавался.':'Check NEKODEX access to the profile list and that Google Chrome is installed. No new profile was created.',buttons:['OK']});
      throw error;
    }
    signal?.throwIfAborted();
    if(choice.kind==='cancel') throw Object.assign(new Error('Sign-in cancelled'),{code:'profile-login-cancelled'});
    if(choice.kind==='new') return runtime.capturePasskeyLogin(onProgress,'chrome');
    const ru=language()==='ru';
    const result=await dialog.showMessageBox(window(),{type:'info',
      title:ru?'Вход в существующем Chrome':'Sign in with existing Chrome',
      message:ru?`Открыт профиль ${choice.email}`:`Opened profile ${choice.email}`,
      detail:ru?'В открытом профиле войдите в ChatGPT под этим же адресом. Затем включите chrome://inspect/#remote-debugging и нажмите «Импортировать». Chrome отдельно запросит разрешение. NEKODEX прочитает только сессию ChatGPT/OpenAI и проверит адрес перед подключением. Другой аккаунт импортирован не будет.':'Sign in to ChatGPT with this same email in the opened profile. Enable chrome://inspect/#remote-debugging, then choose Import. Chrome asks separately for permission. NEKODEX reads only the ChatGPT/OpenAI session and verifies its email before connecting. A different account will not be imported.',
      buttons:[ru?'Отмена':'Cancel',ru?'Импортировать':'Import'],defaultId:0,cancelId:0,noLink:true,signal});
    signal?.throwIfAborted();
    if(result.response!==1)throw Object.assign(new Error('Sign-in cancelled'),{code:'profile-login-cancelled'});
    onProgress({phase:'importing'});
    const abort=()=>{void runtime.cancelExistingChromeLogin().catch(()=>{});};
    signal?.addEventListener('abort',abort,{once:true});
    let capture;
    try {
      capture=await runtime.captureExistingChromeLogin(()=>{});
      signal?.throwIfAborted();
      await verifyCapturedAccount(session,capture,choice.email,signal);
      return capture;
    } catch(error) {
      if(capture)await capture.cleanup();
      if (!signal?.aborted) await dialog.showMessageBox(window(), {type:'error',
        message:ru?'Вход не подключён':'Sign-in was not connected',
        detail:error?.code==='chrome-account-mismatch'
          ? (ru?'В Chrome обнаружен другой аккаунт ChatGPT. Войдите в ChatGPT под почтой выбранного профиля и повторите. Текущая сессия NEKODEX не заменена.':'Chrome returned a different ChatGPT account. Sign in with the selected profile email and retry. The current NEKODEX session was not replaced.')
          : (ru?'Не удалось подтвердить вход из выбранного Chrome. Проверьте вход в ChatGPT и разрешение Chrome на подключение. Новый профиль автоматически не создавался.':'Could not verify sign-in from the selected Chrome profile. Check ChatGPT sign-in and Chrome connection approval. No new profile was created.'),buttons:['OK']});
      throw error;
    } finally {signal?.removeEventListener('abort',abort);}
  };
}
module.exports={createProfileFirstLogin,verifyCapturedAccount};
