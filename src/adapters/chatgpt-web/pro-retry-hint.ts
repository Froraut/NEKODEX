import type { Locator } from "playwright-core";
import { CHATGPT_EFFORT_ITEM_SELECTOR } from "../../chatgpt-session";

const RETRY_DATE = /\bTry again after (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2}), (\d{4})(?=\.|\s|$)/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function retrySentence(text: string): string | undefined {
  const match = text.match(RETRY_DATE);
  if (!match) return undefined;
  const month = MONTHS.indexOf(match[1]!);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const maxDay = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month]!;
  if (day < 1 || day > maxDay) return undefined;
  // Preserve the date supplied by the UI without inventing a time or timezone.
  // Other tooltip text must not become part of the user-facing error.
  return `${match[0]}.`;
}

/**
 * Optional detail only: Pro selection must still fail with its existing error.
 * Upstream #432 reports a hover portal, but provides no captured ownership DOM.
 * Accept explicit accessibility linkage only; unlinked portals are deliberately
 * unsupported until their association can be established from observed evidence.
 */
export async function chatGptProUsageLimitTooltip(
  menu: Locator,
  { timeoutMs = 1_500 }: { timeoutMs?: number } = {},
): Promise<string | undefined> {
  try {
    const pro = menu.locator(CHATGPT_EFFORT_ITEM_SELECTOR).filter({ hasText: /^\s*Pro\s*$/ }).filter({ visible: true });
    if (await pro.count() !== 1) return undefined;
    await pro.hover({ timeout: 1_500 });
    const deadline = Date.now() + Math.max(0, timeoutMs);
    do {
      const texts = await pro.evaluate(element => {
        const document = element.ownerDocument;
        const descriptionIds = (element.getAttribute("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
        const texts: string[] = [];
        for (const id of new Set(descriptionIds)) {
          const tooltip = document.getElementById(id);
          if (!tooltip || tooltip.getAttribute("role") !== "tooltip") continue;
          // A description must never authorize reading conversation or composer
          // content, even if that content is incorrectly labelled as a tooltip.
          const conversationContent = '[data-message-author-role], [data-testid^="conversation-turn-"], article, [contenteditable="true"], textarea';
          if (tooltip.closest(conversationContent) || tooltip.querySelector(conversationContent)) continue;
          const rect = tooltip.getBoundingClientRect();
          const style = document.defaultView?.getComputedStyle(tooltip);
          if (rect.width <= 0 || rect.height <= 0 || style?.visibility === "hidden" || style?.visibility === "collapse") continue;
          texts.push(tooltip.innerText);
        }
        return texts;
      });
      const hints = new Set(texts.map(retrySentence).filter((hint): hint is string => hint !== undefined));
      if (hints.size === 1) return [...hints][0];
      // Conflicting descriptions cannot establish a single retry date.
      if (hints.size > 1 || Date.now() >= deadline) return undefined;
      await new Promise(resolve => setTimeout(resolve, Math.min(50, Math.max(0, deadline - Date.now()))));
    } while (Date.now() <= deadline);
  } catch {
    // A missing, detached or unreadable optional tooltip never replaces the
    // caller's original fail-closed model-control error.
  }
  return undefined;
}
