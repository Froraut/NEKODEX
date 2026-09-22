import type { BrowserTaskState, Language } from "./types";
export interface TaskCenterCopy {
  title: string;
  empty: string;
  open: string;
  dismiss: string;
  cancel: string;
  retrySafe: string;
  inspectFirst: string;
  observationStopped: string;
  cancelWarning: string;
  keepWorking: string;
  documentUnavailable: string;
  search: string;
  status: string;
  all: string;
  active: string;
  attention: string;
  completed: string;
  account: string;
  allAccounts: string;
  clearFilters: string;
  noMatches: string;
  recordCount: string;
  dismissWarning: string;
  keepRecord: string;
  confirmDismiss: string;
  historyUnavailable: string;
  phases: Record<BrowserTaskState["phase"], string>;
}
const copy: Record<Language, TaskCenterCopy> = {
  "en": {
    "title": "Task center",
    "empty": "No recorded tasks",
    "open": "Open conversation",
    "dismiss": "Dismiss",
    "cancel": "Cancel this task",
    "retrySafe": "Not sent. You can retry in the original Codex task.",
    "inspectFirst": "Inspect this conversation before retrying. Nothing will be resent automatically.",
    "observationStopped": "Local observation stopped; provider work may continue.",
    "phases": {
      "preparing": "Preparing",
      "sending-context": "Sending context",
      "context-accepted": "Context accepted",
      "sending": "Sending — acceptance not confirmed",
      "accepted": "Accepted by ChatGPT",
      "responding": "Receiving response",
      "waiting-tools": "Waiting for tools",
      "completed": "Completed",
      "failed-before-send": "Failed before sending",
      "send-uncertain": "Sending uncertain",
      "failed-after-send": "Response interrupted after sending",
      "cancelled": "Observation cancelled",
      "interrupted": "Interrupted by restart"
    },
    "cancelWarning": "Stop observing this task? Completed external actions cannot be undone.",
    "keepWorking": "Keep working",
    "documentUnavailable": "The browser document is no longer available. Check the original Codex task; do not resend an uncertain submission.",
    "search": "Search trace, account or model",
    "status": "Status",
    "all": "All",
    "active": "Active",
    "attention": "Needs attention",
    "completed": "Completed",
    "account": "Account",
    "allAccounts": "All accounts",
    "clearFilters": "Clear filters",
    "noMatches": "No matching tasks",
    "recordCount": "{shown} of {total} available records",
    "dismissWarning": "Close the retained browser page and remove this record? Check the conversation before retrying; do not resend an uncertain submission. This does not delete provider chat history.",
    "keepRecord": "Keep record",
    "confirmDismiss": "Close page and remove record",
    "historyUnavailable": "Task history unavailable for this account. Available records may be incomplete."
  },
  "ru": {
    "title": "Центр задач",
    "empty": "Записанных задач нет",
    "open": "Открыть беседу",
    "dismiss": "Убрать запись",
    "cancel": "Отменить эту задачу",
    "retrySafe": "Не отправлено. Можно повторить в исходной задаче Codex.",
    "inspectFirst": "Проверьте беседу перед повтором. Автоматической повторной отправки не будет.",
    "observationStopped": "Локальное наблюдение остановлено; работа на стороне провайдера может продолжаться.",
    "phases": {
      "preparing": "Подготовка",
      "sending-context": "Отправка контекста",
      "context-accepted": "Контекст принят",
      "sending": "Отправка — принятие не подтверждено",
      "accepted": "Принято ChatGPT",
      "responding": "Получение ответа",
      "waiting-tools": "Ожидание инструментов",
      "completed": "Завершено",
      "failed-before-send": "Сбой до отправки",
      "send-uncertain": "Отправка не подтверждена",
      "failed-after-send": "Ответ прерван после отправки",
      "cancelled": "Наблюдение отменено",
      "interrupted": "Прервано перезапуском"
    },
    "cancelWarning": "Остановить наблюдение за этой задачей? Выполненные внешние действия не откатываются.",
    "keepWorking": "Продолжить работу",
    "documentUnavailable": "Браузерная страница больше недоступна. Проверьте исходную задачу Codex; не повторяйте отправку с неопределённым результатом.",
    "search": "Поиск по trace ID, аккаунту или модели",
    "status": "Статус",
    "all": "Все",
    "active": "Активные",
    "attention": "Требуют внимания",
    "completed": "Завершённые",
    "account": "Аккаунт",
    "allAccounts": "Все аккаунты",
    "clearFilters": "Сбросить фильтры",
    "noMatches": "Совпадений нет",
    "recordCount": "{shown} из {total} доступных записей",
    "dismissWarning": "Закрыть сохранённую страницу браузера и убрать запись? Проверьте беседу перед повтором; не повторяйте отправку с неопределённым результатом. История бесед у провайдера не удаляется.",
    "keepRecord": "Оставить запись",
    "confirmDismiss": "Закрыть страницу и убрать запись",
    "historyUnavailable": "История задач этого аккаунта недоступна. Доступные записи могут быть неполными."
  },
  "zh-CN": {
    "title": "任务中心",
    "empty": "暂无任务记录",
    "open": "打开对话",
    "dismiss": "移除记录",
    "cancel": "取消此任务",
    "retrySafe": "尚未发送，可在原 Codex 任务中重试。",
    "inspectFirst": "重试前检查对话，不会自动重新发送。",
    "observationStopped": "本地观察已停止，提供方可能仍在工作。",
    "phases": {
      "preparing": "准备中",
      "sending-context": "正在发送上下文",
      "context-accepted": "上下文已接受",
      "sending": "发送中，尚未确认接受",
      "accepted": "ChatGPT 已接受",
      "responding": "正在接收回复",
      "waiting-tools": "等待工具",
      "completed": "已完成",
      "failed-before-send": "发送前失败",
      "send-uncertain": "发送状态不确定",
      "failed-after-send": "发送后回复中断",
      "cancelled": "观察已取消",
      "interrupted": "重启导致中断"
    },
    "cancelWarning": "停止观察此任务？已完成的外部操作无法撤销。",
    "keepWorking": "继续工作",
    "documentUnavailable": "浏览器页面已不可用。检查原 Codex 任务；不要重复发送状态不确定的请求。",
    "search": "搜索跟踪 ID、账号或模型",
    "status": "状态",
    "all": "全部",
    "active": "进行中",
    "attention": "需要关注",
    "completed": "已完成",
    "account": "账号",
    "allAccounts": "全部账号",
    "clearFilters": "清除筛选",
    "noMatches": "没有匹配的任务",
    "recordCount": "{shown} / {total} 条可用记录",
    "dismissWarning": "关闭保留的浏览器页面并移除此记录？重试前请检查对话；不要重新发送状态不确定的请求。这不会删除提供方的聊天历史。",
    "keepRecord": "保留记录",
    "confirmDismiss": "关闭页面并移除记录",
    "historyUnavailable": "此账号的任务历史不可用。可用记录可能不完整。"
  },
  "zh-TW": {
    "title": "任務中心",
    "empty": "暫無任務記錄",
    "open": "開啟對話",
    "dismiss": "移除記錄",
    "cancel": "取消此任務",
    "retrySafe": "尚未傳送，可在原 Codex 任務中重試。",
    "inspectFirst": "重試前檢查對話，不會自動重新傳送。",
    "observationStopped": "本機觀察已停止，提供方可能仍在工作。",
    "phases": {
      "preparing": "準備中",
      "sending-context": "正在傳送內容",
      "context-accepted": "內容已接受",
      "sending": "傳送中，尚未確認接受",
      "accepted": "ChatGPT 已接受",
      "responding": "正在接收回覆",
      "waiting-tools": "等待工具",
      "completed": "已完成",
      "failed-before-send": "傳送前失敗",
      "send-uncertain": "傳送狀態不確定",
      "failed-after-send": "傳送後回覆中斷",
      "cancelled": "觀察已取消",
      "interrupted": "重新啟動導致中斷"
    },
    "cancelWarning": "停止觀察此任務？已完成的外部操作無法復原。",
    "keepWorking": "繼續工作",
    "documentUnavailable": "瀏覽器頁面已無法使用。檢查原 Codex 任務；不要重複傳送狀態不確定的請求。",
    "search": "搜尋追蹤 ID、帳號或模型",
    "status": "狀態",
    "all": "全部",
    "active": "進行中",
    "attention": "需要關注",
    "completed": "已完成",
    "account": "帳號",
    "allAccounts": "全部帳號",
    "clearFilters": "清除篩選",
    "noMatches": "沒有符合的任務",
    "recordCount": "{shown} / {total} 筆可用記錄",
    "dismissWarning": "關閉保留的瀏覽器頁面並移除此記錄？重試前請檢查對話；不要重新傳送狀態不確定的請求。這不會刪除提供方的聊天歷史。",
    "keepRecord": "保留記錄",
    "confirmDismiss": "關閉頁面並移除記錄",
    "historyUnavailable": "此帳號的任務歷史無法使用。可用記錄可能不完整。"
  },
  "ja": {
    "title": "タスクセンター",
    "empty": "記録されたタスクなし",
    "open": "会話を開く",
    "dismiss": "記録を閉じる",
    "cancel": "このタスクをキャンセル",
    "retrySafe": "未送信です。元の Codex タスクで再試行できます。",
    "inspectFirst": "再試行前に会話を確認してください。自動再送信はしません。",
    "observationStopped": "ローカル観測を停止しました。提供元の処理は続く場合があります。",
    "phases": {
      "preparing": "準備中",
      "sending-context": "コンテキスト送信中",
      "context-accepted": "コンテキスト受信済み",
      "sending": "送信中・受信未確認",
      "accepted": "ChatGPT 受信済み",
      "responding": "応答受信中",
      "waiting-tools": "ツール待機中",
      "completed": "完了",
      "failed-before-send": "送信前に失敗",
      "send-uncertain": "送信状態不明",
      "failed-after-send": "送信後に応答中断",
      "cancelled": "観測キャンセル済み",
      "interrupted": "再起動により中断"
    },
    "cancelWarning": "このタスクの観測を停止しますか？完了した外部操作は元に戻せません。",
    "keepWorking": "作業を続ける",
    "documentUnavailable": "ブラウザーページは利用できません。元の Codex タスクを確認し、送信状態が不明な要求を再送しないでください。",
    "search": "トレース ID・アカウント・モデルを検索",
    "status": "状態",
    "all": "すべて",
    "active": "実行中",
    "attention": "要確認",
    "completed": "完了",
    "account": "アカウント",
    "allAccounts": "すべてのアカウント",
    "clearFilters": "絞り込みを解除",
    "noMatches": "該当するタスクなし",
    "recordCount": "利用可能な {total} 件中 {shown} 件",
    "dismissWarning": "保持されたブラウザーページを閉じて記録を削除しますか？再試行前に会話を確認し、送信状態が不明な要求を再送しないでください。提供元のチャット履歴は削除されません。",
    "keepRecord": "記録を残す",
    "confirmDismiss": "ページを閉じて記録を削除",
    "historyUnavailable": "このアカウントのタスク履歴は利用できません。表示できる記録が不完全な可能性があります。"
  },
  "ko": {
    "title": "작업 센터",
    "empty": "기록된 작업 없음",
    "open": "대화 열기",
    "dismiss": "기록 닫기",
    "cancel": "이 작업 취소",
    "retrySafe": "전송되지 않았습니다. 원래 Codex 작업에서 재시도할 수 있습니다.",
    "inspectFirst": "재시도 전에 대화를 확인하세요. 자동으로 다시 전송하지 않습니다.",
    "observationStopped": "로컬 관찰이 중지되었습니다. 제공자의 작업은 계속될 수 있습니다.",
    "phases": {
      "preparing": "준비 중",
      "sending-context": "컨텍스트 전송 중",
      "context-accepted": "컨텍스트 수락됨",
      "sending": "전송 중 — 수락 미확인",
      "accepted": "ChatGPT 수락됨",
      "responding": "응답 수신 중",
      "waiting-tools": "도구 대기 중",
      "completed": "완료",
      "failed-before-send": "전송 전 실패",
      "send-uncertain": "전송 불확실",
      "failed-after-send": "전송 후 응답 중단",
      "cancelled": "관찰 취소됨",
      "interrupted": "재시작으로 중단됨"
    },
    "cancelWarning": "이 작업의 관찰을 중지할까요? 완료된 외부 작업은 되돌릴 수 없습니다.",
    "keepWorking": "계속 작업",
    "documentUnavailable": "브라우저 페이지를 사용할 수 없습니다. 원래 Codex 작업을 확인하고 전송 상태가 불확실한 요청을 다시 보내지 마세요.",
    "search": "추적 ID, 계정 또는 모델 검색",
    "status": "상태",
    "all": "전체",
    "active": "진행 중",
    "attention": "확인 필요",
    "completed": "완료",
    "account": "계정",
    "allAccounts": "모든 계정",
    "clearFilters": "필터 지우기",
    "noMatches": "일치하는 작업 없음",
    "recordCount": "사용 가능한 {total}개 기록 중 {shown}개",
    "dismissWarning": "보관된 브라우저 페이지를 닫고 기록을 삭제할까요? 재시도 전에 대화를 확인하고 전송 상태가 불확실한 요청을 다시 보내지 마세요. 제공자의 대화 기록은 삭제되지 않습니다.",
    "keepRecord": "기록 유지",
    "confirmDismiss": "페이지 닫기 및 기록 삭제",
    "historyUnavailable": "이 계정의 작업 기록을 사용할 수 없습니다. 표시되는 기록이 불완전할 수 있습니다."
  }
};
export const taskCenterCopy = (language: Language): TaskCenterCopy => copy[language] ?? copy.en;
export const taskCenterTitle = (language: Language) => taskCenterCopy(language).title;
