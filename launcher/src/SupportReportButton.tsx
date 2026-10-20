import { useRef, useState } from 'react';
import { Button } from './design';
import { exportSupportReportSafely, type SupportReportOutcome } from './support-report-action';
import type { Language } from './types';
import './surfaces/support-report.css';

const copy: Record<Language, { action: string; body: string; saved: string; cancelled: string; unavailable: string; failed: string }> = {
  en: { action: 'Export support report', body: 'Versions, readiness, task receipts and process statistics, with private content excluded.', saved: 'Support report saved.', cancelled: "Report export cancelled.", unavailable: "Support export is unavailable in this window. Open NEKODEX and export from Settings or Activity.", failed: "Could not save the support report. Choose a writable destination and try again; inspect Activity if the problem continues." },
  ru: { action: 'Экспортировать отчёт поддержки', body: 'Версии, готовность, подтверждения задач и статистика процессов без личного содержимого.', saved: 'Отчёт поддержки сохранён.', cancelled: "Экспорт отчёта отменён.", unavailable: "Экспорт недоступен в этом окне. Откройте NEKODEX и экспортируйте отчёт из настроек или активности.", failed: "Не удалось сохранить отчёт. Выберите доступную для записи папку и повторите; если ошибка сохранится, откройте активность." },
  'zh-CN': { action: '导出支持报告', body: '版本、就绪状态、任务回执和进程统计，不含私人内容。', saved: '支持报告已保存。', cancelled: "已取消报告导出。", unavailable: "此窗口无法导出。请在 NEKODEX 设置或活动中导出。", failed: "无法保存报告。请选择可写位置后重试；如仍有问题，请检查活动。" },
  'zh-TW': { action: '匯出支援報告', body: '版本、就緒狀態、工作回執和程序統計，不含私人內容。', saved: '支援報告已儲存。', cancelled: "已取消報告匯出。", unavailable: "此視窗無法匯出。請在 NEKODEX 設定或活動中匯出。", failed: "無法儲存報告。請選擇可寫入位置後重試；如仍有問題，請檢查活動。" },
  ja: { action: 'サポートレポートを出力', body: 'バージョン、準備状態、タスクの受領記録、プロセス統計。個人の内容は除外されます。', saved: 'サポートレポートを保存しました。', cancelled: "出力をキャンセルしました。", unavailable: "この画面では出力できません。NEKODEX の設定またはアクティビティから出力してください。", failed: "保存できませんでした。書き込み可能な場所を選んで再試行し、解決しない場合はアクティビティを確認してください。" },
  ko: { action: '지원 보고서 내보내기', body: '개인 내용을 제외한 버전, 준비 상태, 작업 수신 기록 및 프로세스 통계입니다.', saved: '지원 보고서를 저장했습니다.', cancelled: "보고서 내보내기를 취소했습니다.", unavailable: "이 창에서는 내보낼 수 없습니다. NEKODEX 설정 또는 활동에서 내보내세요.", failed: "저장하지 못했습니다. 쓸 수 있는 위치를 선택하여 재시도하고, 문제가 계속되면 활동을 확인하세요." },
};

export const supportReportCopy = (language: Language) => copy[language];

export function SupportReportButton({ language, disabled = false, onError }: {
  language: Language; disabled?: boolean; onError: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [outcome, setOutcome] = useState<SupportReportOutcome | null>(null);
  const text = copy[language];
  return <span className="support-report-action">
    <Button icon="external" busy={busy} disabled={disabled || busy} title={text.body} onClick={async () => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true); setOutcome(null);
      try {
        const api = window.codexWebLauncher;
        const result = await exportSupportReportSafely(api?.exportSupportReport
          ? () => api.exportSupportReport() : undefined);
        setOutcome(result);
        if (result === 'failed' || result === 'unavailable') onError(text[result]);
      } finally { pending.current = false; setBusy(false); }
    }}>{text.action}</Button>
    <span className="support-report-action__result nk-type-caption" role="status" aria-atomic="true">{outcome ? text[outcome] : ''}</span>
  </span>;
}
