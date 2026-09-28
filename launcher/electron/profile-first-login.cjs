const { deferredCaptureTransfer, isCloudflareChallengedVerification, verifiedCaptureTransfer,
  verifyCapturedAccount } = require('./chrome-session-identity.cjs');
const { safeProfileLoginError } = require('./chrome-profile-error-guidance.cjs');

async function captureProfileSession({ runtime, onProgress, profileClaim, context, selectConnectionFile }) {
  const { signal } = context;
  signal?.throwIfAborted();
  try { return await runtime.captureExistingChromeLogin(onProgress, { profileClaim }); }
  catch (error) {
    signal?.throwIfAborted();
    if (error?.code !== 'chrome-profile-access-denied' || runtime.platform !== 'darwin'
      || typeof selectConnectionFile !== 'function') throw error;
    // The failed helper has settled and removed its transfer. Ask macOS for the
    // exact discovery file, then retry once under the same account/profile claim.
    const selectedDiscoveryContents = await selectConnectionFile(context);
    signal?.throwIfAborted();
    if (selectedDiscoveryContents === null) {
      throw Object.assign(new Error('Sign-in cancelled'), { code: 'profile-login-cancelled' });
    }
    return runtime.captureExistingChromeLogin(onProgress, { profileClaim, selectedDiscoveryContents });
  }
}

function createProfileFirstLogin({choose, runtime, session, dialog, window, language, selectConnectionFile}) {
  const login = async (onProgress, context) => {
    const {signal}=context;
    signal?.throwIfAborted();
    let choice;
    try { choice=await choose(context); }
    catch (error) {
      runtime.logger?.warn?.('runtime.chrome_profile_choice_failed', {
        stage: error?.profileChoiceStage ?? 'selection', name: error?.name ?? 'Error',
        code: typeof error?.code === 'string' ? error.code : null,
        ...(error?.profileChoiceStage === 'picker' ? { detail: String(error.message).slice(0, 240) } : {}),
      });
      // The guide settles this operation and exposes its specific retry action.
      throw error;
    }
    signal?.throwIfAborted();
    if(choice.kind==='cancel') throw Object.assign(new Error('Sign-in cancelled'),{code:'profile-login-cancelled'});
    if(choice.kind==='new') {
      let isolatedCapture;
      try {
        isolatedCapture=await runtime.capturePasskeyLogin(onProgress,'chrome');
        signal?.throwIfAborted();
        let identity;
        try {
          identity=await verifyCapturedAccount(session,isolatedCapture,{signal,accountId:context.accountId,
            configureSession:context.configureVerificationSession});
        } catch(error) {
          // Cloudflare challenged the out-of-page check; verify on the visible ChatGPT page instead.
          if(isCloudflareChallengedVerification(error)) return deferredCaptureTransfer(isolatedCapture);
          throw error;
        }
        return verifiedCaptureTransfer(isolatedCapture,identity);
      } catch(error) {
        try { if(isolatedCapture)await isolatedCapture.cleanup(); }
        catch { throw safeProfileLoginError({code:'existing_chrome_cleanup_failed'}); }
        // The isolated runtime still reports these lifecycle failures as text.
        // Preserve the caller's recovery classification using fixed diagnostics.
        if (/(cleanup|clearing|removing|did not exit|termination|refused)/i.test(error?.message ?? '')) {
          throw safeProfileLoginError({code:'existing_chrome_cleanup_failed'});
        }
        if (/timed out/i.test(error?.message ?? '')) {
          throw safeProfileLoginError({code:'profile-login-timeout'});
        }
        throw error;
      }
    }
    const ru=language()==='ru';
    const profileName=choice.profile.name || choice.profile.id;
    onProgress({ chromeProfileLabel: `${profileName} · ${choice.profile.googleEmail || choice.profile.id}` });
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
      signal?.throwIfAborted();
      // Existing-Chrome phases belong to a different progress protocol. Keep the
      // passkey operation active/cancellable while Chrome approves and captures it.
      capture=await captureProfileSession({ runtime, profileClaim, context, selectConnectionFile,
        onProgress: patch=>onProgress({phase:'importing', chromePhase:patch.phase,
          ...(patch.deadlineAt ? {deadlineAt:patch.deadlineAt} : {})}) });
      signal?.throwIfAborted();
      const previous=choice.previousBinding;
      onProgress({ phase:'verifying', chromePhase:'verifying' });
      // The binding dialog runs for an identity verified before installation or, when Cloudflare
      // challenged that check, for the identity the installed ChatGPT page reports.
      const confirmBinding=async identity=>{
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
        return { knownPrincipalFingerprint:previous?.principalFingerprint??null,
          actualIdentityConfirmed:!previous||previous.principalFingerprint!==identity.principalFingerprint };
      };
      const commitBinding=identity=>choice.commitBinding({ ...identity, browserUserAgent: capture.browserUserAgent });
      let identity;
      try {
        identity=await verifyCapturedAccount(session,capture,{signal,accountId:context.accountId,
          configureSession:context.configureVerificationSession});
      } catch(error) {
        runtime.logger?.warn?.('runtime.chrome_capture_verification_failed', {
          code: error?.code === 'chrome-account-unverified' ? error.code : 'verification-unavailable',
          reason: ['invalid-response', 'provider-error', 'missing-user', 'invalid-expiry', 'expired-session', 'missing-principal'].includes(error?.verificationReason)
            ? error.verificationReason : null,
          httpStatus: Number.isInteger(error?.httpStatus) ? error.httpStatus : null,
          authCookieCount: Number.isInteger(error?.authCookieCount) ? error.authCookieCount : null,
        });
        if(!isCloudflareChallengedVerification(error)) throw error;
        return deferredCaptureTransfer(capture,{resolveIdentityIntent:confirmBinding,
          commit:(_receipt,adopted)=>commitBinding(adopted),rollback:()=>choice.rollbackBinding()});
      }
      const identityIntent=await confirmBinding(identity);
      return verifiedCaptureTransfer(capture,identity,{commit:()=>commitBinding(identity),
        rollback:()=>choice.rollbackBinding(),identityIntent});
    } catch(error) {
      let failure = safeProfileLoginError(error);
      // A cleanup failure must not be hidden by cancellation or expose private paths.
      try { choice.rollbackBinding(); }
      catch { failure = safeProfileLoginError({code:'existing_chrome_cleanup_failed'}); }
      try { if(capture)await capture.cleanup(); }
      catch { failure = safeProfileLoginError({code:'existing_chrome_cleanup_failed'}); }
      // The browser guide owns terminal feedback and retry. A modal here held the
      // operation in "importing" until dismissed and hid the real Chrome failure.
      throw failure;
    } finally {
      signal?.removeEventListener('abort',abort);
      choice.cleanupCapture?.();
    }
  };
  return async (...args) => {
    try { return await login(...args); }
    catch (error) {
      // Every producer crosses the same boundary, including profile selection and
      // isolated capture. Only the installer may attest that a session was restored.
      throw safeProfileLoginError(error);
    }
  };
}
module.exports={createProfileFirstLogin,verifyCapturedAccount,captureProfileSession};
