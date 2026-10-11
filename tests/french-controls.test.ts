import { expect, test } from "bun:test";
import { chromium } from "playwright-core";
import { CHATGPT_STOP_BUTTON_SELECTOR } from "../src/chatgpt-session";
import { dismissChatGptTemporaryChatOnboarding, resolveChatGptToolConfirmation,
  throwIfChatGptSessionFailureAlert, throwIfChatGptRateLimitDialog } from "../src/adapters/chatgpt-web/browser-page-guards";

test.skipIf(!process.env.CHATGPT_DOM_TEST_BROWSER)("French controls preserve generation, exact current-action approval and provider stops", async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHATGPT_DOM_TEST_BROWSER, headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<form data-chatgpt-composer><button type="button" aria-label="Arrêter"></button></form>');
    expect(await page.locator(CHATGPT_STOP_BUTTON_SELECTOR).isVisible()).toBe(true);
    await page.setContent('<div role="dialog"><p>Autoriser ChatGPT à utiliser Codex (DEV)+ ?</p><button onclick="document.body.dataset.choice=\'once\';this.parentNode.remove()">Autoriser une fois</button><button onclick="this.parentNode.dataset.choice=\'persistent\'">Toujours autoriser</button></div>');
    expect(await resolveChatGptToolConfirmation(page, 'Codex (DEV)+ Other', true)).toBe(false);
    expect(await resolveChatGptToolConfirmation(page, 'Codex (DEV)+', true)).toBe(true);
    expect(await page.locator('body').getAttribute('data-choice')).toBe('once');
    await page.setContent('<div role="dialog">Pas de conservation dans l’historique. Aucun entraînement de modèle. Mémoire désactivée.<button onclick="this.parentNode.remove()">Continuer</button></div>');
    expect(await dismissChatGptTemporaryChatOnboarding(page)).toBe(true);
    await page.setContent('<div role="dialog">Trop de requêtes. Vous envoyez des demandes trop rapidement.<button>Compris</button></div>');
    await expect(throwIfChatGptRateLimitDialog(page)).rejects.toThrow('rate limit');
    await page.setContent('<div role="alert">Votre session a expiré</div>');
    await expect(throwIfChatGptSessionFailureAlert(page)).rejects.toThrow('session has expired');
    await page.setContent('<div role="dialog">Nous détectons une activité suspecte</div>');
    await expect(throwIfChatGptSessionFailureAlert(page)).rejects.toThrow('suspicious account activity');
  } finally { await browser.close(); }
}, 15_000);
