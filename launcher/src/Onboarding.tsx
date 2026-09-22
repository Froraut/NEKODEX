import { useState } from "react";
import languages from "../electron/languages.json";
import { BrandMark } from "./BrandMark";
import { Icon } from "./icons";
import { copyFor } from "./i18n";
import { messageOf, handleRadioGroupKeys, InteractionModePicker, PrimaryButton } from "./launcher-ui";
import type { BrowserInteractionMode, Language, LauncherSnapshot, LauncherState } from "./types";
const api = window.codexWebLauncher;

export function Onboarding({
  language,
  setError,
  snapshot,
  updateState,
}: {
  language: Language;
  setError: (error: string | null) => void;
  snapshot: LauncherSnapshot;
  updateState: (state: LauncherState) => void;
}) {
  const [stage, setStage] = useState<"language" | "interaction" | "support">(
    snapshot.state.language ? "interaction" : "language",
  );
  const [selectedLanguage, setSelectedLanguage] = useState<Language>(language);
  const [selectedInteractionMode, setSelectedInteractionMode] = useState<BrowserInteractionMode>(
    snapshot.state.browserInteractionMode,
  );
  const [localBusy, setBusy] = useState(false);
  const busy = localBusy || Boolean(snapshot.lifecycle?.transition);
  const localized = copyFor(selectedLanguage);
  const isLanguage = stage === "language";
  const isInteraction = stage === "interaction";
  const stageIndex = isLanguage ? 0 : isInteraction ? 1 : 2;

  const chooseLanguage = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      updateState(await api!.setLanguage(selectedLanguage));
      setStage("interaction");
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      updateState(await api!.completeOnboarding(selectedLanguage, selectedInteractionMode));
    } catch (cause) {
      setError(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className="welcome"
      lang={selectedLanguage}
    >
      <header className="welcome-top draggable">
        <div className="welcome-brand no-drag">
          <BrandMark small />
          <span>{localized.product}</span>
          {snapshot.profile === "development" ? <em className="dev-profile-badge">{localized.devBadge}</em> : null}
        </div>
        <span className="welcome-version no-drag">v{snapshot.version}</span>
      </header>

        <section
          className="welcome-stage"
          key={stage}
        >
          <span className="welcome-kicker">0{stageIndex + 1}</span>
          <h1>{isLanguage
            ? localized.chooseLanguage
            : isInteraction ? localized.interactionMode : localized.welcomeReady}</h1>
          <p>{isLanguage
            ? localized.chooseLanguageHint
            : isInteraction ? localized.interactionModeOnboardingBody : localized.welcomeReadyBody}</p>

          {isLanguage ? (
            <div className="welcome-options" role="radiogroup" aria-label={localized.chooseLanguage} onKeyDown={handleRadioGroupKeys}>
              {(Object.entries(languages) as Array<[Language, { label: string; marker: string }]>).map(([code, option]) => (
                <WelcomeOption
                  active={selectedLanguage === code}
                  key={code}
                  label={option.label}
                  language={code}
                  marker={option.marker}
                  onClick={() => setSelectedLanguage(code)}
                />
              ))}
            </div>
          ) : isInteraction ? (
            <InteractionModePicker
              className="welcome-interaction-mode-picker"
              copy={localized}
              disabled={busy}
              mode={selectedInteractionMode}
              onChange={setSelectedInteractionMode}
            />
          ) : (
            <div className="welcome-features">
              {([
                ["accounts", localized.welcomeAccounts, localized.welcomeAccountsBody],
                ["mcp", localized.welcomeTools, localized.welcomeToolsBody],
                ["settings", localized.welcomePrivacy, localized.welcomePrivacyBody],
              ] as const).map(([icon, title, body]) => <div key={icon}><Icon name={icon} /><span><strong>{title}</strong><small>{body}</small></span></div>)}
            </div>
          )}
        </section>

      <footer className="welcome-footer">
        <div>
          {!isLanguage ? (
            <button
              className="text-button"
              disabled={busy}
              onClick={() => setStage(isInteraction ? "language" : "interaction")}
              type="button"
            >
              {localized.previous}
            </button>
          ) : null}
        </div>
        <div className="welcome-progress" aria-label={`${stageIndex + 1} / 3`}>
          {[0, 1, 2].map(index => (
            <span
              className={index < stageIndex ? "is-complete" : index === stageIndex ? "is-active" : ""}
              key={index}
            />
          ))}
        </div>
        <PrimaryButton
          disabled={busy}
          onClick={isLanguage
            ? chooseLanguage
            : isInteraction ? () => setStage("support") : finish}
        >
          {stage === "support" ? localized.finishWelcome : localized.continue}
        </PrimaryButton>
      </footer>
    </main>
  );
}

function WelcomeOption({
  active,
  label,
  language,
  marker,
  onClick,
}: {
  active: boolean;
  label: string;
  language: Language;
  marker: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-checked={active}
      className={`welcome-option${active ? " is-active" : ""}`}
      lang={language}
      onClick={onClick}
      role="radio"
      tabIndex={active ? 0 : -1}
      type="button"
    >
      <span>{marker}</span>
      <strong>{label}</strong>
      {active ? <Icon name="check" /> : null}
    </button>
  );
}
