const copy = require('./admission-failure-copy.json');

/** Predispatch account-readiness causes. Each one proves that nothing was sent to ChatGPT. */
const READINESS_CODES = new Set(Object.keys(copy.en.codes));

function languageCopy(language) { return copy[language] ?? copy.en; }

/**
 * Audited text for a readiness cause, in the launcher's language. Only the code and the user's own
 * account label are interpolated; no browser, provider or exception text reaches Codex.
 */
function admissionFailureMessage(code, language, accountLabel) {
  const text = languageCopy(language);
  const entry = text.codes[READINESS_CODES.has(code) ? code : 'account_not_ready'];
  const label = typeof accountLabel === 'string' ? accountLabel.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 80) : '';
  const subject = code === 'account_not_ready' || !READINESS_CODES.has(code) ? text.anyAccount
    : label ? text.account.replace('{account}', label) : text.accountUnknown;
  return text.prefix + entry.message.replace('{subject}', subject);
}

module.exports = { READINESS_CODES, admissionFailureMessage };
