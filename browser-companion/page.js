/** Bundled code only, injected into the selected main-frame isolated world. No background capture. */
export function pageOperation(request) {
  const key = "__nekodexCompanionV1";
  if (request.kind === "select") {
    globalThis[key]?.dispose?.();
    const state = {
      epoch: crypto.randomUUID(), scopeId: request.scopeId, href: location.href, revision: 0,
      observationId: null, observationRevision: -1, refs: new Map(),
    };
    const invalidate = () => { state.revision++; };
    const human = event => { if (event.isTrusted) invalidate(); };
    const events = ["pointerdown", "keydown", "input", "scroll", "popstate", "hashchange", "pageshow"];
    for (const event of events) addEventListener(event, human, true);
    const observer = new MutationObserver(invalidate);
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    state.dispose = () => { observer.disconnect(); for (const event of events) removeEventListener(event, human, true); };
    state.observer = observer;
    globalThis[key] = state;
  }
  const state = globalThis[key];
  if (!state || state.scopeId !== request.scopeId || state.href !== location.href || (request.documentEpoch && state.epoch !== request.documentEpoch)) return { outcome: "rejected", executed: false, reason: "Selected document or user scope changed; select this tab again" };
  // MutationObserver callbacks run after this task; inspect queued records before input too.
  if (state.observer.takeRecords().length) state.revision++;
  if (request.kind === "act") {
    if (request.observationId !== state.observationId || state.observationRevision !== state.revision || document.visibilityState !== "visible") return { outcome: "rejected", executed: false, reason: "Observation is stale or the tab is hidden; obtain a fresh observation" };
    const element = state.refs.get(request.action?.ref);
    if (!element?.isConnected || element.disabled || element.readOnly || element.matches('input[type="password"], input[type="file"], input[type="hidden"]')) return { outcome: "rejected", executed: false, reason: "Observed element is unavailable" };
    const rect = element.getBoundingClientRect();
    const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
    const hit = document.elementFromPoint(x, y);
    if (!rect.width || !rect.height || !hit || !(hit === element || element.contains(hit))) return { outcome: "rejected", executed: false, reason: "Observed element is outside the viewport or obscured" };
    state.observationId = null; state.refs.clear();
    try {
      if (request.action.kind === "click") element.click();
      else if (request.action.kind === "type" && typeof request.action.text === "string" && request.action.text.length <= 8000 && ((element instanceof HTMLInputElement && ["text", "search", "email", "url", "tel"].includes(element.type)) || element instanceof HTMLTextAreaElement || element.isContentEditable)) {
        element.focus();
        if (element.isContentEditable) element.textContent = request.action.text;
        else {
          const proto = element instanceof HTMLInputElement ? HTMLInputElement.prototype : HTMLTextAreaElement.prototype;
          Object.getOwnPropertyDescriptor(proto, "value").set.call(element, request.action.text);
        }
        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
      } else return { outcome: "rejected", executed: false, reason: "Unsupported action or element" };
      return { outcome: "completed", executed: true };
    } catch { return { outcome: "unknown", executed: true, reason: "Input began but no terminal execution receipt is available" }; }
  }
  if (!["observe", "select"].includes(request.kind)) return { outcome: "rejected", executed: false, reason: "Unsupported operation" };
  if (document.visibilityState !== "visible") return { outcome: "rejected", executed: false, reason: "Selected tab must be visible" };
  state.refs.clear();
  const refs = [];
  for (const element of document.querySelectorAll('button,a[href],input:not([type="password"]):not([type="file"]):not([type="hidden"]),textarea,[contenteditable="true"],[role="button"]')) {
    if (refs.length >= 100) break;
    const box = element.getBoundingClientRect();
    if (!box.width || !box.height || box.bottom <= 0 || box.right <= 0 || box.top >= innerHeight || box.left >= innerWidth || element.disabled || element.readOnly || getComputedStyle(element).visibility === "hidden") continue;
    const role = (element instanceof HTMLInputElement && ["text", "search", "email", "url", "tel"].includes(element.type)) || element instanceof HTMLTextAreaElement || element.isContentEditable ? "textbox" : element.matches("a[href]") ? "link" : "button";
    const ref = crypto.randomUUID();
    const label = (element.getAttribute("aria-label") || element.getAttribute("placeholder") || (role === "textbox" ? element.getAttribute("name") : element.textContent) || role).trim().slice(0, 240);
    state.refs.set(ref, element); refs.push({ ref, role, label });
  }
  state.observationId = crypto.randomUUID(); state.observationRevision = state.revision;
  return { outcome: "completed", executed: false, snapshot: {
    documentEpoch: state.epoch, observationId: state.observationId, url: location.href,
    title: document.title.slice(0, 512), text: (document.body?.innerText || "").slice(0, 16_000), refs,
  } };
}
