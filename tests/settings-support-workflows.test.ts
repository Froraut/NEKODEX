import { expect, test } from 'bun:test';
import { exportSupportReportSafely } from '../launcher/src/support-report-action';
import { workflowHelpCopy } from '../launcher/src/workflow-help-copy';
import { filterSettingsSearchEntries, type SettingsSearchEntry } from '../launcher/src/settings-search';
import type { Language } from '../launcher/src/types';

test('support export exposes only outcomes and never a destination or raw failure', async () => {
  const destination = '/private/account-secret/support.json';
  expect(await exportSupportReportSafely(async () => destination)).toBe('saved');
  expect(await exportSupportReportSafely(async () => null)).toBe('cancelled');
  expect(await exportSupportReportSafely()).toBe('unavailable');
  let calls = 0;
  const result = await exportSupportReportSafely(async () => {
    calls++;
    throw new Error('Authorization: Bearer private-key /private/account-secret');
  });
  expect(result).toBe('failed');
  expect(calls).toBe(1);
});

test('new workflow destinations remain discoverable in every supported language', () => {
  const languages: Language[] = ['en', 'ru', 'zh-CN', 'zh-TW', 'ja', 'ko'];
  for (const language of languages) {
    const copy = workflowHelpCopy(language);
    const entries = Object.values(copy.guides).map(guide => ({
      title: guide.title, description: guide.body, section: '', unavailable: false,
    } as SettingsSearchEntry));
    for (const guide of Object.values(copy.guides)) {
      const found = filterSettingsSearchEntries(entries, guide.title);
      expect(found.length).toBe(1);
      expect(found[0]?.description).toBe(guide.body);
    }
  }
});
