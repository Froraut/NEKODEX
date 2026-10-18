import { useState } from 'react';
import { Button } from './design';
import { messageOf } from './launcher-ui';
import type { Language } from './types';

const copy: Record<Language, { action: string; body: string; saved: string }> = {
  en: { action: 'Export support report', body: 'Versions, readiness, task receipts and process statistics, with private content excluded.', saved: 'Support report saved.' },
  ru: { action: 'Экспортировать отчёт поддержки', body: 'Версии, готовность, подтверждения задач и статистика процессов без личного содержимого.', saved: 'Отчёт поддержки сохранён.' },
  'zh-CN': { action: '导出支持报告', body: '版本、就绪状态、任务回执和进程统计，不含私人内容。', saved: '支持报告已保存。' },
  'zh-TW': { action: '匯出支援報告', body: '版本、就緒狀態、工作回執和程序統計，不含私人內容。', saved: '支援報告已儲存。' },
  ja: { action: 'サポートレポートを出力', body: 'バージョン、準備状態、タスクの受領記録、プロセス統計。個人の内容は除外されます。', saved: 'サポートレポートを保存しました。' },
  ko: { action: '지원 보고서 내보내기', body: '개인 내용을 제외한 버전, 준비 상태, 작업 수신 기록 및 프로세스 통계입니다.', saved: '지원 보고서를 저장했습니다.' },
};

export const supportReportCopy = (language: Language) => copy[language];

export function SupportReportButton({ language, disabled = false, onError }: {
  language: Language; disabled?: boolean; onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const text = copy[language];
  return <span className="support-report-action">
    <Button icon="external" busy={busy} disabled={disabled || busy} title={text.body} onClick={async () => {
      if (busy) return;
      setBusy(true); setSaved(false);
      try { setSaved(Boolean(await window.codexWebLauncher!.exportSupportReport())); }
      catch (error) { onError(messageOf(error)); }
      finally { setBusy(false); }
    }}>{text.action}</Button>
    <span className="nk-visually-hidden" role="status">{saved ? text.saved : ''}</span>
  </span>;
}
