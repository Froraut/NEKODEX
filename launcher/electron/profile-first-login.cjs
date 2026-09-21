const { verifiedCaptureTransfer, verifyCapturedAccount } = require('./chrome-session-identity.cjs');

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
    if(choice.kind==='new') {
      let isolatedCapture;
      try {
        isolatedCapture=await runtime.capturePasskeyLogin(onProgress,'chrome');
        const identity=await verifyCapturedAccount(session,isolatedCapture,{signal,accountId:context.accountId,
          configureSession:context.configureVerificationSession});
        return verifiedCaptureTransfer(isolatedCapture,identity);
      } catch(error) {
        if(isolatedCapture)await isolatedCapture.cleanup();
        throw error;
      }
    }
    const ru=language()==='ru';
    const profileName=choice.profile.name || choice.profile.id;
    const googleMetadata=choice.profile.googleEmail
      ? (ru?`Аккаунт Google в метаданных: ${choice.profile.googleEmail}`:`Google account in profile metadata: ${choice.profile.googleEmail}`)
      : (ru?'В метаданных профиля нет почты Google. Это не мешает отдельно проверить аккаунт ChatGPT.':'This profile has no Google email metadata. NEKODEX can still verify the ChatGPT account separately.');
    const result=await dialog.showMessageBox(window(),{type:'info',
      title:ru?'Вход в существующем Chrome':'Sign in with existing Chrome',
      message:ru?`Открыт профиль Chrome Stable «${profileName}»`:`Opened Chrome Stable profile “${profileName}”`,
      detail:ru?`${googleMetadata}\n\nВ открытом профиле войдите в нужный аккаунт ChatGPT. Затем включите chrome://inspect/#remote-debugging и нажмите «Проверить аккаунт». Chrome отдельно запросит разрешение. Перед заменой сессии NEKODEX проверит фактический аккаунт ChatGPT и попросит подтвердить новую привязку.`:`${googleMetadata}\n\nSign in to the intended ChatGPT account in the opened profile. Enable chrome://inspect/#remote-debugging, then choose Verify account. Chrome asks separately for permission. Before replacing the session, NEKODEX verifies the actual ChatGPT account and asks you to confirm a new binding.`,
      buttons:[ru?'Отмена':'Cancel',ru?'Проверить аккаунт':'Verify account'],defaultId:0,cancelId:0,noLink:true,signal});
    signal?.throwIfAborted();
    if(result.response!==1){choice.rollbackBinding();throw Object.assign(new Error('Sign-in cancelled'),{code:'profile-login-cancelled'});}
    onProgress({phase:'importing'});
    const abort=()=>{void runtime.cancelExistingChromeLogin().catch(()=>{});};
    signal?.addEventListener('abort',abort,{once:true});
    let capture;
    try {
      const profileClaim=await choice.prepareCapture();
      // Existing-Chrome phases belong to a different progress protocol. Keep the
      // passkey operation active/cancellable while Chrome approves and captures it.
      capture=await runtime.captureExistingChromeLogin(patch=>onProgress({phase:'importing',
        ...(patch.deadlineAt ? {deadlineAt:patch.deadlineAt} : {})}), {profileClaim});
      signal?.throwIfAborted();
      const identity=await verifyCapturedAccount(session,capture,{signal,accountId:context.accountId,
        configureSession:context.configureVerificationSession});
      const previous=choice.previousBinding;
      if ((!previous || previous.principalFingerprint!==identity.principalFingerprint) && !identity.label) {
        throw Object.assign(new Error('ChatGPT identity has no user-visible label'),{code:'chrome-account-unidentified'});
      }
      if (!previous || previous.principalFingerprint!==identity.principalFingerprint) {
        const replacement=Boolean(previous);
        const confirmation=await dialog.showMessageBox(window(),{type:replacement?'warning':'question',
          title:ru?'Подтвердите аккаунт ChatGPT':'Confirm ChatGPT account',
          message:replacement
            ? (ru?`Заменить привязку «${previous.chatgptLabel || 'аккаунт ChatGPT'}» на «${identity.label}»?`:`Replace the “${previous.chatgptLabel || 'ChatGPT account'}” binding with “${identity.label}”?`)
            : (ru?`Подключить аккаунт ChatGPT «${identity.label}»?`:`Connect ChatGPT account “${identity.label}”?`),
          detail:ru
            ? `Профиль Google: ${choice.profile.googleEmail || 'не указан'}. Фактический аккаунт ChatGPT проверен отдельно. Изменение будет сохранено только после успешного входа в NEKODEX.`
            : `Google profile metadata: ${choice.profile.googleEmail || 'not provided'}. The actual ChatGPT account was verified separately. The change is saved only after NEKODEX signs in successfully.`,
          buttons:[ru?'Отмена':'Cancel',replacement?(ru?'Заменить':'Replace'):(ru?'Подключить':'Connect')],defaultId:0,cancelId:0,noLink:true,signal});
        signal?.throwIfAborted();
        if(confirmation.response!==1)throw Object.assign(new Error('Sign-in cancelled'),{code:'profile-login-cancelled'});
      }
      return verifiedCaptureTransfer(capture,identity,{commit:()=>choice.commitBinding(identity),
        rollback:()=>choice.rollbackBinding(),identityIntent:{
          knownPrincipalFingerprint:previous?.principalFingerprint??null,
          actualIdentityConfirmed:!previous||previous.principalFingerprint!==identity.principalFingerprint,
        }});
    } catch(error) {
      choice.rollbackBinding();
      if(capture)await capture.cleanup();
      if (!signal?.aborted && error?.code!=='profile-login-cancelled') await dialog.showMessageBox(window(), {type:'error',
        message:ru?'Вход не подключён':'Sign-in was not connected',
        detail:error?.code==='chrome-account-mismatch'
          ? (ru?'Chrome вернул другой ранее привязанный аккаунт ChatGPT. Текущая сессия NEKODEX и сохранённая привязка не изменены.':'Chrome returned a different previously bound ChatGPT account. The current NEKODEX session and saved binding were not changed.')
          : error?.code==='chrome-profile-claim-missing'
            ? (ru?'Не удалось найти служебную вкладку выбранного профиля через разрешённое соединение Chrome. Оставьте окно выбранного профиля открытым и повторите подключение. Сессия NEKODEX не изменена.':'The selected profile’s connection tab was not found through the approved Chrome connection. Keep the selected profile window open and retry connecting. The NEKODEX session was not changed.')
            : (ru?'Не удалось подтвердить вход из выбранного Chrome. Проверьте вход в ChatGPT и разрешение Chrome на подключение. Сессия NEKODEX и сохранённая привязка не изменены.':'Could not verify sign-in from the selected Chrome profile. Check ChatGPT sign-in and Chrome connection approval. The NEKODEX session and saved binding were not changed.'),buttons:['OK']});
      throw error;
    } finally {
      signal?.removeEventListener('abort',abort);
      choice.cleanupCapture?.();
    }
  };
}
module.exports={createProfileFirstLogin,verifyCapturedAccount};
