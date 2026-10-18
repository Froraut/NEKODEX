import { expect, test } from "bun:test";
import { filterSettingsSearchEntries, navigateToSetting, type SettingsSearchEntry } from "../launcher/src/settings-search";
import { settingsSearchCopy } from "../launcher/src/settings-search-copy";
import type { Language } from "../launcher/src/types";

test("localized search navigates to the exact control without changing drafts or activating it", () => {
  const destinations = [
    ["en", "Parallel agents", "Agent behaviour", "Simultaneous browser tasks", "AGENT simultaneous"],
    ["ru", "Параллельные агенты", "Поведение агентов", "Количество одновременных задач", "АГЕНТОВ количество"],
    ["zh-CN", "并行代理", "代理行为", "同时运行的浏览器任务", "代理行为 浏览器"],
    ["zh-TW", "平行代理", "代理行為", "同時執行的瀏覽器任務", "代理行為 瀏覽器"],
    ["ja", "並列エージェント", "エージェントの動作", "同時に実行するタスク", "動作 タスク"],
    ["ko", "병렬 에이전트", "에이전트 동작", "동시에 실행할 작업", "동작 작업"],
  ] as const;
  const events: string[] = [];
  const control = {
    value: "23",
    isConnected: true,
    hasAttribute: () => false,
    getAttribute: () => null,
    focus: () => events.push("focus input"),
  } as unknown as HTMLInputElement;
  const row = {
    isConnected: true,
    scrollIntoView: () => events.push("scroll row"),
    focus: () => events.push("focus row"),
  } as unknown as HTMLElement;
  for (const [language, title, section, description, query] of destinations) {
    const entry: SettingsSearchEntry = { row, control, title, section, description, unavailable: false };
    expect(filterSettingsSearchEntries([entry], query)).toEqual([entry]);
    expect(filterSettingsSearchEntries([entry], "  ")).toEqual([]);
    expect(filterSettingsSearchEntries([entry], "zzzz-no-match")).toEqual([]);
    expect(settingsSearchCopy(language as Language).results).toContain("{count}");
    events.length = 0;
    expect(navigateToSetting(entry, () => events.push("open disclosure"))).toBe(true);
    expect(events).toEqual(["open disclosure", "scroll row", "focus input"]);
    expect(control.value).toBe("23");
    // A temporarily disabled setting stays discoverable, without gaining activation authority.
    control.hasAttribute = name => name === "disabled";
    events.length = 0;
    navigateToSetting(entry, () => events.push("open disclosure"));
    expect(events).toEqual(["open disclosure", "scroll row", "focus row"]);
    control.hasAttribute = () => false;
  }
  const russian = { row, control, title: "Сохранённые чаты", section: "", description: "", unavailable: false };
  expect(filterSettingsSearchEntries([russian], "СОХРАНЕННЫЕ")).toEqual([russian]);
});
