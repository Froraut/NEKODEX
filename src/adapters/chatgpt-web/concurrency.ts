import { getConfigDir } from "../../config";
import { runtimeBrowserCapacity } from "../../../launcher/electron/browser-capacity.cjs";

// Read once per runtime. Worker and session registry share this same limit.
// Launcher-managed processes receive the launcher's pinned startup value.
export const MAX_CHATGPT_BROWSER_TABS: number = runtimeBrowserCapacity(getConfigDir());
// Queued owners hold no browser tab. Their separate bound must not reject the 17th
// request before the launcher can apply backpressure to a 16-tab workspace.
export const MAX_CHATGPT_QUEUED_TURNS = 64;
export const MAX_CHATGPT_OUTSTANDING_TURNS = MAX_CHATGPT_BROWSER_TABS + MAX_CHATGPT_QUEUED_TURNS;
