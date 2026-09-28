import type { Language } from "./types";

export type OnboardingCopy = {
  /** The step eyebrow and the progress list's accessible name, e.g. "Step 2 of 3". */
  step: (current: number, total: number) => string;
};

const copy: Record<Language, OnboardingCopy> = {
  en: { step: (current, total) => `Step ${current} of ${total}` },
  ru: { step: (current, total) => `Шаг ${current} из ${total}` },
  "zh-CN": { step: (current, total) => `第 ${current} 步，共 ${total} 步` },
  "zh-TW": { step: (current, total) => `第 ${current} 步，共 ${total} 步` },
  ja: { step: (current, total) => `ステップ ${current} / ${total}` },
  ko: { step: (current, total) => `${total}단계 중 ${current}단계` },
};

export const onboardingCopy = (language: Language): OnboardingCopy => copy[language] ?? copy.en;
