import { getConfigDir } from "../../config";
import { runtimeBrowserCapacity } from "../../../launcher/electron/browser-capacity.cjs";

// Read once per runtime. Worker and session registry share this same limit.
// Launcher-managed processes receive the launcher's pinned startup value.
export const MAX_CHATGPT_BROWSER_TABS: number = runtimeBrowserCapacity(getConfigDir());
