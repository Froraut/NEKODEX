import { selectLanguage } from "./language-selection";
import { useEffect, useRef, useState } from "react";
import languages from "../electron/languages.json";
import { Badge, Button, Icon, Mark, Notice, Page, Panel, PhaseSteps, SurfaceHeader, cx, type PhaseStep } from "./design";
import { localizeLauncherError } from "./i18n";
import { useLocaleCopy } from "./useLocaleCopy";
import { LocaleNotice } from "./LocaleNotice";
import { messageOf, handleRadioGroupKeys, InteractionModePicker } from "./launcher-ui";
import { onboardingCopy } from "./onboarding-copy";
import type { BrowserInteractionMode, Language, LauncherSnapshot, LauncherState } from "./types";
import "./surfaces/onboarding.css";
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
  // A failed save is shown on this page, above the footer, so it never covers the button that retries it.
  const [failure, setFailure] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const footerRef = useRef<HTMLElement>(null);
  const languageGroupRef = useRef<HTMLDivElement>(null);
  const focusLanguageAfterBack = useRef(false);
  const focusHeadingAfterStep = useRef(false);
  const locale = useLocaleCopy(selectedLanguage);
  const busy = localBusy || locale.status !== "ready" || Boolean(snapshot.lifecycle?.transition);
  const localized = locale.copy;
  const isLanguage = stage === "language";
  const isInteraction = stage === "interaction";
  const stageIndex = isLanguage ? 0 : isInteraction ? 1 : 2;
  const stepLabels = [localized.language, localized.interactionMode, localized.workspace];
  const stepLabel = onboardingCopy(locale.language).step(stageIndex + 1, stepLabels.length);
  const steps: PhaseStep[] = stepLabels.map((label, index) => ({
    label,
    state: index < stageIndex ? "complete" : index === stageIndex ? "current" : "upcoming",
  }));

  // Each step opens at the top. Continue moves focus to the new step's title, so the step change is announced
  // and Tab starts at its choices. Back from the second step removes the Back button itself, so focus moves
  // to the selected language instead of falling to the document.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
    if (focusHeadingAfterStep.current) {
      focusHeadingAfterStep.current = false;
      const active = document.activeElement;
      // Only when focus is still on the footer (or was dropped); a choice made meanwhile keeps its focus.
      if (active && active !== document.body && !footerRef.current?.contains(active)) return;
      const heading = scrollRef.current?.querySelector<HTMLHeadingElement>("h1");
      if (!heading) return;
      heading.tabIndex = -1;
      heading.focus({ preventScroll: true });
      return;
    }
    if (stage !== "language" || !focusLanguageAfterBack.current) return;
    focusLanguageAfterBack.current = false;
    languageGroupRef.current?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus();
  }, [stage]);

  const goForward = (next: "interaction" | "support") => {
    focusHeadingAfterStep.current = true;
    setStage(next);
  };

  const goBack = (event: { currentTarget: HTMLElement }) => {
    focusLanguageAfterBack.current = isInteraction && document.activeElement === event.currentTarget;
    setFailure(null);
    setStage(isInteraction ? "language" : "interaction");
  };

  const chooseLanguage = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFailure(null);
    try {
      const state = await selectLanguage(selectedLanguage, next => api!.setLanguage(next));
      if (state) { updateState(state); goForward("interaction"); }
    } catch (cause) {
      setFailure(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  const finish = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    setFailure(null);
    try {
      const state = await selectLanguage(selectedLanguage, next => api!.completeOnboarding(next, selectedInteractionMode));
      if (state) updateState(state);
    } catch (cause) {
      setFailure(messageOf(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main
      className="nk-onboarding"
      lang={locale.language}
    >
      <header className="nk-onboarding__bar draggable">
        {/* macOS draws the traffic lights over this reserve; other platforms hide it. */}
        <span aria-hidden="true" className="nk-onboarding__controls" />
        <div className="nk-onboarding__brand no-drag">
          <Mark label={null} size={32} />
          <span className="nk-wordmark"><strong>{localized.product}</strong></span>
          {snapshot.profile === "development" ? <span className="nk-dev-tag">{localized.devBadge}</span> : null}
        </div>
        <span className="nk-onboarding__version nk-type-code no-drag">v{snapshot.version}</span>
      </header>

      <div className="nk-onboarding__scroll" ref={scrollRef}>
        <Page key={stage} width="narrow">
          <SurfaceHeader
            eyebrow={stepLabel}
            subtitle={isLanguage
              ? localized.chooseLanguageHint
              : isInteraction ? localized.interactionModeOnboardingBody : localized.welcomeReadyBody}
            title={isLanguage
              ? localized.chooseLanguage
              : isInteraction ? localized.interactionMode : localized.welcomeReady}
          />

          {isLanguage ? (
            <div
              aria-label={localized.chooseLanguage}
              className="nk-choice-group"
              onKeyDown={handleRadioGroupKeys}
              ref={languageGroupRef}
              role="radiogroup"
            >
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
              copy={localized}
              disabled={busy}
              mode={selectedInteractionMode}
              onChange={setSelectedInteractionMode}
            />
          ) : (
            <Panel as="ul" className="nk-onboarding__features" padding="flush">
              {([
                ["accounts", localized.welcomeAccounts, localized.welcomeAccountsBody],
                ["mcp", localized.welcomeTools, localized.welcomeToolsBody],
                ["settings", localized.welcomePrivacy, localized.welcomePrivacyBody],
              ] as const).map(([icon, title, body]) => (
                <li key={icon}>
                  <span aria-hidden="true" className="nk-onboarding__feature-icon"><Icon className="nk-icon" name={icon} /></span>
                  <span className="nk-onboarding__feature-copy"><strong>{title}</strong><small>{body}</small></span>
                </li>
              ))}
            </Panel>
          )}
        </Page>
      </div>

      {locale.status !== "ready" || failure ? (
        <div className="nk-onboarding__notices">
          {locale.status !== "ready" ? (
            <LocaleNotice language={selectedLanguage} copy={localized} failed={locale.status === "failed"} />
          ) : null}
          {failure ? <Notice title={localized.error} tone="error">{localizeLauncherError(localized, failure)}</Notice> : null}
        </div>
      ) : null}
      <footer className="nk-onboarding__footer" ref={footerRef}>
        <div className="nk-onboarding__back">
          {!isLanguage ? (
            <Button
              disabled={localBusy || Boolean(snapshot.lifecycle?.transition)}
              icon="back"
              onClick={goBack}
              variant="ghost"
            >
              {localized.previous}
            </Button>
          ) : null}
        </div>
        <PhaseSteps className="nk-onboarding__steps" label={stepLabel} steps={steps} />
        <Button
          busy={localBusy}
          className="nk-onboarding__next"
          disabled={busy}
          onClick={isLanguage
            ? chooseLanguage
            : isInteraction ? () => goForward("support") : finish}
          variant="primary"
        >
          {stage === "support" ? localized.finishWelcome : localized.continue}
        </Button>
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
  // The marker stays before the label in the DOM (accessible name "EN English"); CSS shows it at the end.
  return (
    <button
      aria-checked={active}
      className={cx("nk-choice", "nk-onboarding__language", active && "is-selected")}
      lang={language}
      onClick={onClick}
      role="radio"
      tabIndex={active ? 0 : -1}
      type="button"
    >
      <span aria-hidden="true" className="nk-choice__mark">{active ? <Icon className="nk-icon" name="check" /> : null}</span>
      <Badge className="nk-onboarding__marker">{marker}</Badge>
      <span className="nk-choice__copy"><strong>{label}</strong></span>
    </button>
  );
}
