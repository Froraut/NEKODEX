import type { Language } from "./types";

/** Activity surface strings that are not in the shared catalog (event log view switch, usage dashboard wording). */
export interface ActivityCopy {
  /** Accessible name of the view switch (Recent events · Local usage). */
  views: string;
  levelError: string;
  levelWarning: string;
  noMatchingEvents: string;
  /** Body under the shared "No runtime events yet." title: what will appear here. */
  noEventsBody: string;
  clearFilters: string;
  usageUnavailableBody: string;
  retryUsage: string;
  showComparison: string;
  hideComparison: string;
  showDailyTable: string;
  hideDailyTable: string;
  acceptedMessages: string;
  nativeRequests: string;
  activeDays: string;
  /** "{active} of {days}" — a count pair, so no plural forms are needed. */
  activeDaysValue: string;
  /** "{label}: {value}" */
  pair: string;
  /** "{value} effort" */
  effort: string;
  efforts: Record<"minimal" | "low" | "medium" | "high" | "xhigh", string>;
  /** "{model} ({source})" */
  sourced: string;
  versionSource: Record<"observed" | "pinned", string>;
  modelSource: Record<"reported" | "requested", string>;
  messageKind: Record<"task" | "context_stage" | "compaction", string>;
}

const copy: Record<Language, ActivityCopy> = {
  en: {
    views: "Activity sections",
    levelError: "Error",
    levelWarning: "Warning",
    noMatchingEvents: "No matching events",
    noEventsBody: "Events appear here as NEKODEX starts, signs in and runs browser tasks.",
    clearFilters: "Clear filters",
    usageUnavailableBody: "The local usage report could not be read. Try again, or check Recent events for the cause.",
    retryUsage: "Retry usage report",
    showComparison: "Show comparison table",
    hideComparison: "Hide comparison table",
    showDailyTable: "Show daily table",
    hideDailyTable: "Hide daily table",
    acceptedMessages: "Accepted messages",
    nativeRequests: "Native proxied requests",
    activeDays: "Active days",
    activeDaysValue: "{active} of {days}",
    pair: "{label}: {value}",
    effort: "{value} effort",
    efforts: { minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Extra high" },
    sourced: "{model} ({source})",
    versionSource: { observed: "observed", pinned: "pinned" },
    modelSource: { reported: "reported", requested: "requested" },
    messageKind: { task: "Task", context_stage: "Context staging", compaction: "Compaction" },
  },
  ru: {
    views: "Разделы событий",
    levelError: "Ошибка",
    levelWarning: "Предупреждение",
    noMatchingEvents: "Подходящих событий нет",
    noEventsBody: "События появятся здесь, когда NEKODEX запустится, выполнит вход и начнёт выполнять браузерные задачи.",
    clearFilters: "Сбросить фильтры",
    usageUnavailableBody: "Не удалось прочитать локальный отчёт о статистике. Повторите попытку или найдите причину в разделе «Последние события».",
    retryUsage: "Повторить загрузку статистики",
    showComparison: "Показать таблицу сравнения",
    hideComparison: "Скрыть таблицу сравнения",
    showDailyTable: "Показать таблицу по дням",
    hideDailyTable: "Скрыть таблицу по дням",
    acceptedMessages: "Принятые сообщения",
    nativeRequests: "Запросы через native-прокси",
    activeDays: "Активные дни",
    activeDaysValue: "{active} из {days}",
    pair: "{label}: {value}",
    effort: "Усилие: {value}",
    efforts: { minimal: "минимальное", low: "низкое", medium: "среднее", high: "высокое", xhigh: "очень высокое" },
    sourced: "{model} ({source})",
    versionSource: { observed: "наблюдаемая", pinned: "закреплённая" },
    modelSource: { reported: "сообщённая", requested: "запрошенная" },
    messageKind: { task: "Задача", context_stage: "Передача контекста", compaction: "Сжатие" },
  },
  "zh-CN": {
    views: "活动分区",
    levelError: "错误",
    levelWarning: "警告",
    noMatchingEvents: "没有匹配的事件",
    noEventsBody: "NEKODEX 启动、登录并运行浏览器任务时，事件会显示在这里。",
    clearFilters: "清除筛选",
    usageUnavailableBody: "无法读取本地使用统计报告。请重试，或在“最近事件”中查看原因。",
    retryUsage: "重新加载使用统计报告",
    showComparison: "显示对比表",
    hideComparison: "隐藏对比表",
    showDailyTable: "显示每日表格",
    hideDailyTable: "隐藏每日表格",
    acceptedMessages: "已接受的消息",
    nativeRequests: "原生代理请求",
    activeDays: "活跃天数",
    activeDaysValue: "{active} / {days}",
    pair: "{label}：{value}",
    effort: "推理强度：{value}",
    efforts: { minimal: "最低", low: "低", medium: "中", high: "高", xhigh: "超高" },
    sourced: "{model}（{source}）",
    versionSource: { observed: "观察到", pinned: "固定" },
    modelSource: { reported: "已报告", requested: "已请求" },
    messageKind: { task: "任务", context_stage: "上下文分段", compaction: "压缩" },
  },
  "zh-TW": {
    views: "活動分區",
    levelError: "錯誤",
    levelWarning: "警告",
    noMatchingEvents: "沒有符合的事件",
    noEventsBody: "NEKODEX 啟動、登入並執行瀏覽器任務時，事件會顯示在這裡。",
    clearFilters: "清除篩選",
    usageUnavailableBody: "無法讀取本機使用統計報告。請重試，或在「最近事件」中查看原因。",
    retryUsage: "重新載入使用統計報告",
    showComparison: "顯示比較表",
    hideComparison: "隱藏比較表",
    showDailyTable: "顯示每日表格",
    hideDailyTable: "隱藏每日表格",
    acceptedMessages: "已接受的訊息",
    nativeRequests: "原生代理請求",
    activeDays: "活躍天數",
    activeDaysValue: "{active} / {days}",
    pair: "{label}：{value}",
    effort: "推理強度：{value}",
    efforts: { minimal: "最低", low: "低", medium: "中", high: "高", xhigh: "超高" },
    sourced: "{model}（{source}）",
    versionSource: { observed: "觀察到", pinned: "固定" },
    modelSource: { reported: "已回報", requested: "已請求" },
    messageKind: { task: "任務", context_stage: "上下文分段", compaction: "壓縮" },
  },
  ja: {
    views: "アクティビティの表示",
    levelError: "エラー",
    levelWarning: "警告",
    noMatchingEvents: "該当するイベントなし",
    noEventsBody: "NEKODEX の起動、サインイン、ブラウザータスクの実行に伴って、イベントがここに表示されます。",
    clearFilters: "絞り込みを解除",
    usageUnavailableBody: "ローカル使用状況のレポートを読み取れませんでした。再試行するか、「最近のイベント」で原因を確認してください。",
    retryUsage: "使用状況レポートを再読み込み",
    showComparison: "比較表を表示",
    hideComparison: "比較表を隠す",
    showDailyTable: "日別の表を表示",
    hideDailyTable: "日別の表を隠す",
    acceptedMessages: "受理済みメッセージ",
    nativeRequests: "ネイティブプロキシ経由のリクエスト",
    activeDays: "利用日数",
    activeDaysValue: "{days} 日中 {active} 日",
    pair: "{label}：{value}",
    effort: "推論強度：{value}",
    efforts: { minimal: "最小", low: "低", medium: "中", high: "高", xhigh: "最高" },
    sourced: "{model}（{source}）",
    versionSource: { observed: "観測", pinned: "固定" },
    modelSource: { reported: "報告", requested: "要求" },
    messageKind: { task: "タスク", context_stage: "コンテキスト分割", compaction: "圧縮" },
  },
  ko: {
    views: "활동 섹션",
    levelError: "오류",
    levelWarning: "경고",
    noMatchingEvents: "일치하는 이벤트 없음",
    noEventsBody: "NEKODEX가 시작되고 로그인하며 브라우저 작업을 실행하면 여기에 이벤트가 표시됩니다.",
    clearFilters: "필터 지우기",
    usageUnavailableBody: "로컬 사용량 보고서를 읽을 수 없습니다. 다시 시도하거나 ‘최근 이벤트’에서 원인을 확인하세요.",
    retryUsage: "사용량 보고서 다시 불러오기",
    showComparison: "비교 표 보기",
    hideComparison: "비교 표 숨기기",
    showDailyTable: "일별 표 보기",
    hideDailyTable: "일별 표 숨기기",
    acceptedMessages: "수락된 메시지",
    nativeRequests: "네이티브 프록시 요청",
    activeDays: "활동 일수",
    activeDaysValue: "{days}일 중 {active}일",
    pair: "{label}: {value}",
    effort: "추론 강도: {value}",
    efforts: { minimal: "최소", low: "낮음", medium: "중간", high: "높음", xhigh: "매우 높음" },
    sourced: "{model} ({source})",
    versionSource: { observed: "관찰됨", pinned: "고정됨" },
    modelSource: { reported: "보고됨", requested: "요청됨" },
    messageKind: { task: "작업", context_stage: "문맥 분할", compaction: "압축" },
  },
};

export const activityCopy = (language: Language): ActivityCopy => copy[language] ?? copy.en;

const fill = (template: string, fields: Record<string, string>) =>
  template.replace(/\{(\w+)\}/g, (match, key: string) => fields[key] ?? match);

/** Localised identity words for usage groups; unknown raw values pass through unchanged (never guessed). */
export function usageIdentityWords(text: ActivityCopy) {
  const lookup = <K extends string>(table: Record<K, string>, value: string) =>
    Object.prototype.hasOwnProperty.call(table, value) ? table[value as K] : value;
  return {
    effort: (value: string) => value === "max" ? "Pro" : fill(text.effort, { value: lookup(text.efforts, value) }),
    versioned: (model: string, source: string | null) => source && Object.prototype.hasOwnProperty.call(text.versionSource, source)
      ? fill(text.sourced, { model, source: lookup(text.versionSource, source) }) : model,
    reported: (model: string, source: string | null) => source && Object.prototype.hasOwnProperty.call(text.modelSource, source)
      ? fill(text.sourced, { model, source: lookup(text.modelSource, source) }) : model,
    messageKind: (value: string) => lookup(text.messageKind, value),
  };
}

/** "Accepted messages: 27 · Active days: 6 of 7" (the day pair is left out of a one-day period). */
export function usageCalendarSummary(text: ActivityCopy, web: boolean, total: string, active: string, days: number, daysLabel: string) {
  const count = fill(text.pair, { label: web ? text.acceptedMessages : text.nativeRequests, value: total });
  return days <= 1 ? count
    : `${count} · ${fill(text.pair, { label: text.activeDays, value: fill(text.activeDaysValue, { active, days: daysLabel }) })}`;
}
